import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { CollisionGroups } from "../../../enums/CollisionGroups";
import { useStore } from "../../../store";
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
  type ObstacleContact,
  type SolidBodySegmentDebug,
} from "./hooks/useRagdollSolidBodies";

export type { SolidBodySegmentDebug };
import { useRagdollTransient } from "./hooks/useRagdollTransient";
import {
  useRagdollActive,
  type ActiveRagdollSegmentDebug,
} from "./hooks/useRagdollActive";
import type { JointRange } from "./activeRagdollFrames";
import { registerFighterHitHandler } from "../weapons/shootableRegistry";

export type { ActiveRagdollSegmentDebug };

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
  // "vorrei si comportasse piu' da ragdoll se il colpo e' forte" -- colpo
  // forte: il corpo attivo va KO (motori spenti, gravita' piena) e vola con
  // la spinta; poi chi chiama lo rimette in piedi (standUp) quando si e'
  // fermato. false se non c'e' il layer attivo.
  knockDown: (dir: THREE.Vector3, speed: number) => boolean;
  standUp: () => void;
  isKnockedDown: () => boolean;
  // stato del corpo a terra: fermo? a pancia in su? bacino e direzione della testa
  getLyingState: () => LyingState | null;
  // si gira sulla schiena (se e' caduto a pancia in giu')
  rollOver: () => void;
  pulseHit: (
    worldImpulseDir: THREE.Vector3,
    magnitude: number,
    atSegment?: string,
    attackerX?: number,
    attackerZ?: number
  ) => void;
  update: (delta: number, activeRagdollEnabled?: boolean, isIdle?: boolean, isPassive?: boolean) => void;
  // Da chiamare a INIZIO useFrame, prima di mixer.update() (vedi
  // restoreActiveAnimationPose in useRagdollActive.ts).
  beginFrame: () => void;
  // Clip la cui posa iniziale fa da "zero" dei giunti del ragdoll attivo
  // (la guardia) -- vedi captureClipPose in activeRagdollFrames.ts.
  setNeutralClip: (clip: THREE.AnimationClip | null) => void;
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
  // ostacoli dell'arena: esce dalle compenetrazioni e dice chi lo sta
  // spingendo (vedi useRagdollSolidBodies.resolveObstacleContacts)
  resolveObstacleContacts: (skipHandle: number | null, dt: number) => ObstacleContact;
  getSolidBodySegments: () => SolidBodySegmentDebug[];
  // Vedi ActiveRagdollSegmentDebug in useRagdollActive.ts -- collider
  // fisico e collider bersaglio (animazione) di ogni corpo del layer
  // attivo, con errori e angoli dei giunti rispetto ai limiti.
  getActiveRagdollDebugSegments: () => ActiveRagdollSegmentDebug[];
  // Banco di prova: colpo di prova sul layer attivo e misura dei range
  // dei giunti chiesti dalle clip di animazione.
  testActiveHit: (segmentName: string, dirWorld: THREE.Vector3, speed: number) => boolean;
  measureClipRanges: (
    clips: THREE.AnimationClip[]
  ) => { all: Record<string, JointRange>; perClip: Record<string, Record<string, JointRange>> } | null;
}

// Colpo sul layer attivo: pulseHit riceve una "magnitudo" pensata per il
// sistema transitorio (variazione di velocita' ~0.3 m/s); qui diventa una
// variazione di velocita' vera sul segmento colpito.
const ACTIVE_HIT_SPEED_PER_MAGNITUDE = 40;

const SPINE_LEAN_BONES = ["spine_02", "spine_03"];
const SPINE_LEAN_CHILD_BONE: Record<string, string> = {
  spine_02: "spine_03",
  spine_03: "neck_01",
};
const SPINE_LEAN_MAX_RAD = THREE.MathUtils.degToRad(40);
const SPINE_TWIST_MAX_RAD = THREE.MathUtils.degToRad(80);

export function useRagdoll(
  modelRootRef: React.RefObject<THREE.Object3D | null>,
  // id del combattente (FighterData.id): i suoi collider vengono
  // registrati per i proiettili (weapons/shootableRegistry.ts)
  ownerId?: string
): RagdollController {
  const { world, rapier } = useRapier();
  const { scene } = useThree();

  const { resolveBones } = useRagdollBones(modelRootRef);
  const { syncHurtbox, getHurtboxHandle: internalGetHurtboxHandle } =
    useRagdollHurtbox(modelRootRef);
  const { syncSolidBody, setRagdollBlocker, resolveBodyMovement, resolveObstacleContacts, getSolidBodySegments } =
    useRagdollSolidBodies(modelRootRef, resolveBones, ownerId);
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
    activeBodiesRef,
    ensureActiveRagdoll,
    destroyActiveRagdoll,
    rebuildIfRequested,
    captureActiveTargets,
    driveActiveRagdoll,
    syncActiveBonesBlended,
    restoreActiveAnimationPose,
    resyncActiveRagdollToBones,
    checkActiveRagdollRunaway,
    applyActiveHit,
    getActiveRagdollDebugSegments,
    measureClipRanges,
    setNeutralClip,
  } = useRagdollActive(modelRootRef, resolveBones, ownerId);
  // KO del layer attivo (morte con ragdoll attivo acceso): motori spenti,
  // gravita' piena, finche' il combattente non viene ricreato/deactivate.
  const activeKnockedOutRef = useRef(false);
  const hasActiveRig = () => Object.keys(activeBodiesRef.current).length > 0;

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
    // Con il ragdoll attivo acceso la morte e' il layer attivo che va KO
    // (motori spenti, gravita' piena) -- niente secondo rig transitorio
    // sovrapposto.
    if (hasActiveRig()) {
      activeKnockedOutRef.current = true;
      return;
    }
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

  const knockDown = useCallback((dir: THREE.Vector3, speed: number): boolean => {
    if (!hasActiveRig() || stateRef.current.isDeath) return false;
    activeKnockedOutRef.current = true;
    const entries = activeBodiesRef.current;
    const upper = /^(Head|Spine|Torso|Clavicle|UpperArm|ForeArm)/;
    for (const key of Object.keys(entries)) {
      const b = entries[key].body;
      const v = b.linvel();
      // parte alta spinta di piu' della bassa: il corpo si ribalta
      const k = upper.test(key) ? 1 : key === 'Hips' ? 0.8 : 0.55;
      b.setLinvel({ x: v.x + dir.x * speed * k, y: v.y + Math.max(0, dir.y) * speed * k + 0.15 * speed, z: v.z + dir.z * speed * k }, true);
    }
    const head = entries.Head?.body.translation();
    if (head) triggerHitMarker(new THREE.Vector3(head.x, head.y, head.z));
    return true;
  }, [triggerHitMarker]);

  const standUp = useCallback(() => {
    if (stateRef.current.isDeath) return;
    activeKnockedOutRef.current = false;
  }, []);

  const isKnockedDown = useCallback(() => activeKnockedOutRef.current, []);

  // DEV: KO a comando dal browser (misure di compenetrazione)
  useEffect(() => {
    if (!import.meta.env.DEV || !ownerId) return;
    const reg = ((window as any).__ragdollApi ??= {});
    reg[ownerId] = { knockDown, standUp, isKnockedDown };
    return () => { delete reg[ownerId]; };
  }, [ownerId, knockDown, standUp, isKnockedDown]);

  const _ly = useRef({ h: new THREE.Vector3(), s: new THREE.Vector3(), n: new THREE.Vector3() });
  const getLyingState = useCallback((): LyingState | null => {
    const e = activeBodiesRef.current;
    if (!e.Hips || !e.Head || !e.UpperArm_L || !e.UpperArm_R) return null;
    const hp = e.Hips.body.translation(), hd = e.Head.body.translation();
    const l = e.UpperArm_L.body.translation(), r = e.UpperArm_R.body.translation();
    const { h, s: sh, n } = _ly.current;
    h.set(hd.x - hp.x, hd.y - hp.y, hd.z - hp.z);
    sh.set(r.x - l.x, r.y - l.y, r.z - l.z);
    // davanti del corpo = testa x spalle (in piedi guarda +Z del modello)
    n.crossVectors(h, sh).normalize();
    let maxV = 0;
    for (const key of Object.keys(e)) {
      const v = e[key].body.linvel();
      maxV = Math.max(maxV, Math.hypot(v.x, v.y, v.z));
    }
    return {
      settled: maxV < 0.5,
      maxSpeed: maxV,
      faceUp: n.y > 0,
      pelvis: new THREE.Vector3(hp.x, hp.y, hp.z),
      headDir: new THREE.Vector3(h.x, 0, h.z).normalize(),
    };
  }, []);

  const rollOver = useCallback(() => {
    const e = activeBodiesRef.current;
    if (!e.Hips || !e.Head) return;
    const hp = e.Hips.body.translation(), hd = e.Head.body.translation();
    // rotazione attorno all'asse bacino->testa: mezzo giro in ~0.4 s
    const ax = new THREE.Vector3(hd.x - hp.x, 0, hd.z - hp.z).normalize().multiplyScalar(8);
    for (const key of Object.keys(e)) {
      const b = e[key].body;
      const t = b.translation();
      const r = new THREE.Vector3(t.x - hp.x, t.y - hp.y, t.z - hp.z);
      const v = new THREE.Vector3().crossVectors(ax, r);
      b.setLinvel({ x: v.x, y: v.y + 1.2, z: v.z }, true);
      b.setAngvel({ x: ax.x, y: ax.y, z: ax.z }, true);
    }
  }, []);

  const pulseHit = useCallback(
    (
      worldImpulseDir: THREE.Vector3,
      magnitude: number,
      atSegment: string = "Torso",
      attackerX?: number,
      attackerZ?: number
    ) => {
      if (stateRef.current.isDeath) return;
      // a terra (KO da colpo forte): il corpo e' gia' tutto fisica
      if (activeKnockedOutRef.current && hasActiveRig()) return;

      // "ragdoll stile euphoria" -- con il layer attivo presente il colpo
      // e' un impulso vero sul corpo attivo colpito (che si piega/incassa
      // e poi i motori lo riportano in guardia), non un secondo rig
      // transitorio sovrapposto.
      if (hasActiveRig() && !activeKnockedOutRef.current) {
        const entry = activeBodiesRef.current[atSegment] ?? activeBodiesRef.current.Torso;
        if (entry) {
          const t = entry.body.translation();
          const dir = new THREE.Vector3();
          if (attackerX !== undefined && attackerZ !== undefined) {
            dir.set(t.x - attackerX, 0, t.z - attackerZ);
            if (dir.lengthSq() < 1e-6) dir.copy(worldImpulseDir);
            dir.normalize();
            dir.y = 0.15;
          } else {
            dir.copy(worldImpulseDir);
          }
          const point = new THREE.Vector3(t.x, t.y, t.z);
          if (attackerX !== undefined && attackerZ !== undefined) {
            const off = new THREE.Vector3(attackerX - t.x, 0, attackerZ - t.z);
            if (off.lengthSq() > 1e-6) point.add(off.normalize().multiplyScalar(entry.segment.radius));
          }
          applyActiveHit(entry.segment.name, dir, magnitude * ACTIVE_HIT_SPEED_PER_MAGNITUDE);
          triggerHitMarker(point);
          return;
        }
      }

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
    [buildBodies, triggerHitMarker, applyActiveHit, activeBodiesRef]
  );

  const update = useCallback(
    (
      delta: number,
      activeRagdollEnabled: boolean = false,
      isIdle: boolean = false,
      isPassive: boolean = false
    ) => {
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
          rebuildIfRequested();
          const passive = isPassive || activeKnockedOutRef.current;
          // a terra: le proprie capsule solide non devono spingere il
          // proprio ragdoll (vedi CollisionGroups.RagdollBody)
          setRagdollBlocker(!passive);
          // Ordine: bersagli dall'animazione (gia' aggiornata da
          // mixer.update / skeleton.pose) -> motori -> ossa dalla fisica.
          captureActiveTargets(delta);
          if (!passive && checkActiveRagdollRunaway()) {
            resyncActiveRagdollToBones();
          }
          driveActiveRagdoll(delta, passive);
          syncActiveBonesBlended(delta, isIdle, passive ? 1 : undefined);
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
      setRagdollBlocker,
      ensureActiveRagdoll,
      rebuildIfRequested,
      captureActiveTargets,
      checkActiveRagdollRunaway,
      driveActiveRagdoll,
      syncActiveBonesBlended,
      resyncActiveRagdollToBones,
      destroyActiveRagdoll,
    ]
  );

  const deactivate = useCallback(() => {
    activeKnockedOutRef.current = false;
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

  const testActiveHit = useCallback(
    (segmentName: string, dirWorld: THREE.Vector3, speed: number): boolean => {
      const ok = applyActiveHit(segmentName, dirWorld, speed);
      const e = activeBodiesRef.current[segmentName];
      if (ok && e) {
        const t = e.body.translation();
        triggerHitMarker(new THREE.Vector3(t.x, t.y, t.z));
      }
      return ok;
    },
    [applyActiveHit, activeBodiesRef, triggerHitMarker]
  );

  // "estrai la pistola e la logica di sparo" -- reazione fisica a un
  // proiettile: impulso sul segmento colpito del ragdoll attivo nel punto
  // esatto d'impatto (stile Euphoria: il corpo incassa e poi i motori lo
  // riportano in posa). Senza layer attivo si ripiega sul colpo
  // transitorio, sul segmento equivalente piu' vicino.
  const shotReactionRef = useRef<(segment: string, dir: THREE.Vector3, speed: number, point: THREE.Vector3) => void>(() => {});
  shotReactionRef.current = (segment, dir, speed, point) => {
    if (hasActiveRig()) {
      applyActiveHit(segment, dir, speed, point);
      return;
    }
    const fallback: Record<string, string> = { SpineMid: 'Torso', SpineHigh: 'Torso', ClavicleL: 'UpperArm_L', ClavicleR: 'UpperArm_R', Hand_L: 'ForeArm_L', Hand_R: 'ForeArm_R' };
    pulseHit(dir, speed / ACTIVE_HIT_SPEED_PER_MAGNITUDE, fallback[segment] ?? segment);
  };
  useEffect(() => {
    if (!ownerId) return;
    return registerFighterHitHandler(ownerId, (segment, dir, speed, point) => shotReactionRef.current(segment, dir, speed, point));
  }, [ownerId]);

  return {
    isActive: () => stateRef.current.active,
    isDeath: () => stateRef.current.isDeath,
    activateDeath,
    knockDown,
    standUp,
    isKnockedDown,
    getLyingState,
    rollOver,
    pulseHit,
    update,
    beginFrame: restoreActiveAnimationPose,
    setNeutralClip,
    deactivate,
    getBoneWorldPosition,
    getHurtboxHandle: internalGetHurtboxHandle,
    pointIntersectsHurtbox,
    applySpineLean,
    resolveBodyMovement,
    resolveObstacleContacts,
    getSolidBodySegments,
    getActiveRagdollDebugSegments,
    testActiveHit,
    measureClipRanges,
  };
}

export interface LyingState {
  settled: boolean;
  maxSpeed: number;
  faceUp: boolean;
  pelvis: THREE.Vector3;
  headDir: THREE.Vector3; // orizzontale, dal bacino verso la testa
}
