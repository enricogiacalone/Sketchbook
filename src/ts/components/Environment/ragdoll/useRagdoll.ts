import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { CollisionGroups } from "../../../enums/CollisionGroups";
import {
  RAGDOLL_PULSE_NEARBY,
  HURTBOX_HEIGHT,
  HURTBOX_RADIUS,
  HURTBOX_GROUPS,
} from "./ragdollConfig";

import { useRagdollBones } from "./hooks/useRagdollBones";
import { useRagdollHurtbox } from "./hooks/useRagdollHurtbox";
import {
  useRagdollSolidBodies,
  type SolidBodySegmentDebug,
} from "./hooks/useRagdollSolidBodies";

export type { SolidBodySegmentDebug };
import { useRagdollTransient } from "./hooks/useRagdollTransient";
import { useRagdollActive } from "./hooks/useRagdollActive";

const HIT_PULSE_DURATION = 0.22;
const HIT_BLEND_OUT_DURATION = 0.22;
const MAX_CHAIN_DURATION = 0.9;
const HIT_MARKER_DURATION = 0.3;
const HAND_QUERY_RADIUS = 0.06;
const _identityRot = { x: 0, y: 0, z: 0, w: 1 };

export interface RagdollController {
  isActive: () => boolean;
  isDeath: () => boolean;
  activateDeath: () => void;
  pulseHit: (
    worldImpulseDir: THREE.Vector3,
    magnitude: number,
    atSegment?: string,
    attackerX?: number,
    attackerZ?: number
  ) => void;
  update: (delta: number, activeRagdollEnabled?: boolean, isIdle?: boolean) => void;
  deactivate: () => void;
  getBoneWorldPosition: (boneName: string, target: THREE.Vector3) => boolean;
  getHurtboxHandle: () => number | null;
  pointIntersectsHurtbox: (
    worldPos: THREE.Vector3,
    targetHandle: number
  ) => boolean;
  applySpineLean: (pitchRad: number, yawRad: number) => void;
  resolveBodyMovement: (
    desiredX: number,
    desiredZ: number,
    bagSolidHandle: number | null,
    onBagBump?: (
      worldPoint: THREE.Vector3,
      worldDir: THREE.Vector3,
      blockedAmount: number
    ) => void
  ) => { x: number; z: number };
  getSolidBodySegments: () => SolidBodySegmentDebug[];
}

const SPINE_LEAN_BONES = ["spine_02", "spine_03"];
const SPINE_LEAN_CHILD_BONE: Record<string, string> = {
  spine_02: "spine_03",
  spine_03: "neck_01",
};
const SPINE_LEAN_MAX_RAD = THREE.MathUtils.degToRad(40);
const SPINE_TWIST_MAX_RAD = THREE.MathUtils.degToRad(80);

export function useRagdoll(
  modelRootRef: React.RefObject<THREE.Object3D | null>
): RagdollController {
  const { world, rapier } = useRapier();
  const { scene } = useThree();

  const { resolveBones } = useRagdollBones(modelRootRef);
  const { syncHurtbox, getHurtboxHandle: internalGetHurtboxHandle } =
    useRagdollHurtbox(modelRootRef);
  const { syncSolidBody, resolveBodyMovement, getSolidBodySegments } =
    useRagdollSolidBodies(modelRootRef, resolveBones);
  const {
    buildBodies,
    destroyBodies,
    restoreBonesToAnimation,
    syncAnchors,
    syncBonesFromPhysics,
    clampJointCones,
    clampBodyVelocities,
    stateRef,
    bodiesRef,
  } = useRagdollTransient(modelRootRef, resolveBones);
  const {
    ensureActiveRagdoll,
    syncActiveRagdollMotors,
    clampActiveRagdollVelocities,
    clampActiveJointCones,
    clampActiveHipsAbsolute,
    checkActiveRagdollRunaway,
    resyncActiveRagdollToBones,
    destroyActiveRagdoll,
    activeBodiesRef,
    syncActiveBonesBlended,
  } = useRagdollActive(modelRootRef, resolveBones);

  const markerRef = useRef<THREE.Mesh | null>(null);
  const markerElapsedRef = useRef(0);

  const ensureMarker = useCallback((): THREE.Mesh | null => {
    if (markerRef.current) return markerRef.current;
    const geometry = new THREE.IcosahedronGeometry(0.12, 1);
    const material = new THREE.MeshBasicMaterial({
      color: 0xfff2a8,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.renderOrder = 999;
    mesh.frustumCulled = false;
    scene.add(mesh);
    markerRef.current = mesh;
    return mesh;
  }, [scene]);

  const triggerHitMarker = useCallback(
    (worldPos: THREE.Vector3) => {
      const marker = ensureMarker();
      if (!marker) return;
      marker.position.copy(worldPos);
      marker.visible = true;
      marker.scale.setScalar(0.4);
      (marker.material as THREE.MeshBasicMaterial).opacity = 1;
      markerElapsedRef.current = 0;
    },
    [ensureMarker]
  );

  const activateDeath = useCallback(() => {
    if (stateRef.current.active && stateRef.current.isDeath) return;
    destroyBodies();
    buildBodies();
    stateRef.current = {
      active: true,
      isDeath: true,
      pulseElapsed: 0,
      blendElapsed: 0,
      chainElapsed: 0,
    };
  }, [buildBodies, destroyBodies]);

  const pulseHit = useCallback(
    (
      worldImpulseDir: THREE.Vector3,
      magnitude: number,
      atSegment: string = "Torso",
      attackerX?: number,
      attackerZ?: number
    ) => {
      if (stateRef.current.isDeath) return;

      const nearbyOptions = RAGDOLL_PULSE_NEARBY[atSegment] ?? [];
      const nearby = nearbyOptions.length
        ? nearbyOptions[Math.floor(Math.random() * nearbyOptions.length)]
        : [];
      const activeSegments = new Set<string>([atSegment, ...nearby]);

      if (!stateRef.current.active) {
        buildBodies(activeSegments);
        stateRef.current = {
          active: true,
          isDeath: false,
          pulseElapsed: 0,
          blendElapsed: 0,
          chainElapsed: 0,
        };
      } else {
        buildBodies(activeSegments);
        if (stateRef.current.chainElapsed < MAX_CHAIN_DURATION) {
          stateRef.current.pulseElapsed = 0;
          stateRef.current.blendElapsed = 0;
        }
      }

      const entry = bodiesRef.current[atSegment] ?? bodiesRef.current.Torso;
      if (entry && magnitude > 0) {
        const mass = entry.body.mass();
        const dir = worldImpulseDir
          .clone()
          .normalize()
          .multiplyScalar(magnitude * mass);
        entry.body.applyImpulse({ x: dir.x, y: dir.y, z: dir.z }, true);

        const t = entry.body.translation();
        const worldPos = new THREE.Vector3(t.x, t.y, t.z);
        if (attackerX !== undefined && attackerZ !== undefined) {
          const offset = new THREE.Vector3(attackerX - t.x, 0, attackerZ - t.z);
          if (offset.lengthSq() > 0.0001) {
            offset.normalize().multiplyScalar(entry.segment.radius);
            worldPos.x += offset.x;
            worldPos.z += offset.z;
          }
        }
        triggerHitMarker(worldPos);
      }
    },
    [buildBodies, triggerHitMarker]
  );

  const update = useCallback(
    (delta: number, activeRagdollEnabled: boolean = false, isIdle: boolean = false) => {
      if (markerRef.current && markerRef.current.visible) {
        markerElapsedRef.current += delta;
        const t = Math.min(1, markerElapsedRef.current / HIT_MARKER_DURATION);
        (markerRef.current.material as THREE.MeshBasicMaterial).opacity = 1 - t;
        markerRef.current.scale.setScalar(0.4 + t * 0.6);
        if (t >= 1) markerRef.current.visible = false;
      }

      syncHurtbox();
      syncSolidBody();

      const s = stateRef.current;
      if (!s.active) {
        if (activeRagdollEnabled) {
          ensureActiveRagdoll();
          if (checkActiveRagdollRunaway()) {
            resyncActiveRagdollToBones();
          } else {
            syncActiveRagdollMotors(delta);
            clampActiveRagdollVelocities();
            clampActiveJointCones();
            clampActiveHipsAbsolute();
          }
          syncActiveBonesBlended(delta, isIdle);
        } else if (Object.keys(activeBodiesRef.current).length > 0) {
          destroyActiveRagdoll();
        }
        return;
      }

      if (s.isDeath) {
        clampJointCones();
        syncBonesFromPhysics(1);
        if (activeRagdollEnabled) resyncActiveRagdollToBones();
        return;
      }

      syncAnchors();
      clampBodyVelocities();
      clampJointCones();

      s.chainElapsed += delta;
      s.pulseElapsed += delta;
      if (s.pulseElapsed < HIT_PULSE_DURATION) {
        syncBonesFromPhysics(1);
        if (activeRagdollEnabled) resyncActiveRagdollToBones();
        return;
      }

      s.blendElapsed += delta;
      const weight = Math.max(0, 1 - s.blendElapsed / HIT_BLEND_OUT_DURATION);
      if (weight <= 0) {
        restoreBonesToAnimation();
        destroyBodies();
        stateRef.current = {
          active: false,
          isDeath: false,
          pulseElapsed: 0,
          blendElapsed: 0,
          chainElapsed: 0,
        };
        if (activeRagdollEnabled) resyncActiveRagdollToBones();
        return;
      }
      syncBonesFromPhysics(weight);
      if (activeRagdollEnabled) resyncActiveRagdollToBones();
    },
    [
      syncBonesFromPhysics,
      destroyBodies,
      restoreBonesToAnimation,
      syncAnchors,
      clampBodyVelocities,
      clampJointCones,
      syncHurtbox,
      syncSolidBody,
      ensureActiveRagdoll,
      checkActiveRagdollRunaway,
      syncActiveRagdollMotors,
      clampActiveRagdollVelocities,
      clampActiveJointCones,
      clampActiveHipsAbsolute,
      resyncActiveRagdollToBones,
      destroyActiveRagdoll,
    ]
  );

  const deactivate = useCallback(() => {
    destroyBodies();
    stateRef.current = {
      active: false,
      isDeath: false,
      pulseElapsed: 0,
      blendElapsed: 0,
      chainElapsed: 0,
    };
  }, [destroyBodies]);

  useEffect(
    () => () => {
      destroyBodies();
      if (markerRef.current) {
        scene.remove(markerRef.current);
        markerRef.current.geometry.dispose();
        (markerRef.current.material as THREE.Material).dispose();
        markerRef.current = null;
      }
    },
    [destroyBodies, scene]
  );

  const getBoneWorldPosition = useCallback(
    (boneName: string, target: THREE.Vector3): boolean => {
      const bones = resolveBones();
      const bone = bones?.[boneName];
      if (!bone) return false;
      bone.getWorldPosition(target);
      return true;
    },
    [resolveBones]
  );

  const pointIntersectsHurtbox = useCallback(
    (worldPos: THREE.Vector3, targetHandle: number): boolean => {
      let hit = false;
      const shape = new rapier.Ball(HAND_QUERY_RADIUS);
      world.intersectionsWithShape(
        { x: worldPos.x, y: worldPos.y, z: worldPos.z },
        _identityRot,
        shape,
        (collider) => {
          if (collider.handle === targetHandle) {
            hit = true;
            return false;
          }
          return true;
        },
        undefined,
        HURTBOX_GROUPS
      );
      return hit;
    },
    [rapier, world]
  );

  const applySpineLean = useCallback(
    (pitchRad: number, yawRad: number) => {
      if (stateRef.current.active) return;
      const bones = resolveBones();
      if (!bones) return;
      const clampedPitch = THREE.MathUtils.clamp(
        pitchRad,
        -SPINE_LEAN_MAX_RAD,
        SPINE_LEAN_MAX_RAD
      );
      const clampedYaw = THREE.MathUtils.clamp(
        yawRad,
        -SPINE_TWIST_MAX_RAD,
        SPINE_TWIST_MAX_RAD
      );
      const perBonePitch = -clampedPitch / SPINE_LEAN_BONES.length;
      const perBoneYaw = clampedYaw / SPINE_LEAN_BONES.length;
      for (const boneName of SPINE_LEAN_BONES) {
        const bone = bones[boneName];
        if (!bone) continue;
        const child = bones[SPINE_LEAN_CHILD_BONE[boneName]];
        if (child && child.position.lengthSq() > 1e-8) {
          const twistAxis = new THREE.Vector3()
            .copy(child.position)
            .normalize();
          const pitchQuat = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(1, 0, 0),
            perBonePitch
          );
          const twistQuat = new THREE.Quaternion().setFromAxisAngle(
            twistAxis,
            perBoneYaw
          );
          bone.quaternion.copy(twistQuat).multiply(pitchQuat);
        }
      }
    },
    [resolveBones]
  );

  return {
    isActive: () => stateRef.current.active,
    isDeath: () => stateRef.current.isDeath,
    activateDeath,
    pulseHit,
    update,
    deactivate,
    getBoneWorldPosition,
    getHurtboxHandle: internalGetHurtboxHandle,
    pointIntersectsHurtbox,
    applySpineLean,
    resolveBodyMovement,
    getSolidBodySegments,
  };
}
