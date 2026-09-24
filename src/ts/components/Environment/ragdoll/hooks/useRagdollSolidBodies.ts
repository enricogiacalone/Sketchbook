import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { useRapier } from "@react-three/rapier";
import { registerShootableCollider, unregisterShootableCollider } from "../../weapons/shootableRegistry";
import type {
  RigidBody as RapierRigidBody,
  Collider,
  KinematicCharacterController,
} from "@dimforge/rapier3d-compat";
import {
  SOLID_BODY_SEGMENTS,
} from "../ragdollConfig";
import {
  SOLID_BODY_GROUPS,
} from "../../../../enums/CollisionGroups";

interface SolidBodyEntry {
  body: RapierRigidBody;
  collider: Collider;
  halfHeight: number;
  radius: number;
}

export interface SolidBodySegmentDebug {
  name: string;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  halfHeight: number;
  radius: number;
}

export function useRagdollSolidBodies(
  modelRootRef: React.RefObject<THREE.Object3D | null>,
  resolveBones: () => Record<string, THREE.Bone> | null,
  // Proprietario dei collider per i proiettili (vedi shootableRegistry.ts)
  ownerId?: string
) {
  const { world, rapier } = useRapier();
  const solidBodiesRef = useRef<Record<string, SolidBodyEntry>>({});
  const ownColliderHandlesRef = useRef<Set<number>>(new Set());
  const solidControllerRef = useRef<KinematicCharacterController | null>(null);

  const _solidV1 = new THREE.Vector3();
  const _solidV2 = new THREE.Vector3();
  const _solidDir = new THREE.Vector3();
  const _solidCenter = new THREE.Vector3();
  const _solidRot = new THREE.Quaternion();
  const _solidBumpPoint = new THREE.Vector3();
  const _solidBumpDir = new THREE.Vector3();
  const _yAxis = new THREE.Vector3(0, 1, 0);

  const ensureSolidBody = useCallback((): boolean => {
    if (Object.keys(solidBodiesRef.current).length > 0) return true;
    const bones = resolveBones();
    if (!bones) return false;

    if (!solidControllerRef.current) {
      const controller = world.createCharacterController(0.02);
      controller.setSlideEnabled(false);
      solidControllerRef.current = controller;
    }

    const entries = solidBodiesRef.current;
    for (const segment of SOLID_BODY_SEGMENTS) {
      const bone = bones[segment.drivingBone];
      const toBone = bones[segment.toBone];
      if (!bone || !toBone) continue;

      bone.getWorldPosition(_solidV1);
      toBone.getWorldPosition(_solidV2);
      const length = Math.max(0.05, _solidV1.distanceTo(_solidV2) * (segment.lengthScale ?? 0.92));
      const halfHeight = Math.max(0.01, length / 2 - segment.radius);

      const dir = _solidDir.copy(_solidV2).sub(_solidV1);
      const dist = dir.length() || 1;
      dir.normalize();
      const center = _solidCenter.copy(_solidV1).addScaledVector(dir, Math.min(dist / 2, length / 2));
      const rot = _solidRot.setFromUnitVectors(_yAxis, dir);

      const bodyDesc = rapier.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(center.x, center.y, center.z)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
      const body = world.createRigidBody(bodyDesc);
      const colliderDesc = rapier.ColliderDesc.capsule(halfHeight, segment.radius)
        .setCollisionGroups(SOLID_BODY_GROUPS)
        .setSolverGroups(SOLID_BODY_GROUPS);
      const collider = world.createCollider(colliderDesc, body);

      entries[segment.name] = { body, collider, halfHeight, radius: segment.radius };
      ownColliderHandlesRef.current.add(collider.handle);
      if (ownerId) registerShootableCollider(collider.handle, { ownerId, segment: segment.name });
    }
    return Object.keys(entries).length > 0;
  }, [rapier, world, resolveBones, ownerId]);

  const syncSolidBody = useCallback(() => {
    const entries = solidBodiesRef.current;
    if (Object.keys(entries).length === 0) return;
    const bones = resolveBones();
    if (!bones) return;

    for (const segment of SOLID_BODY_SEGMENTS) {
      const entry = entries[segment.name];
      if (!entry) continue;
      const bone = bones[segment.drivingBone];
      const toBone = bones[segment.toBone];
      if (!bone || !toBone) continue;

      bone.getWorldPosition(_solidV1);
      toBone.getWorldPosition(_solidV2);
      const dir = _solidDir.copy(_solidV2).sub(_solidV1);
      const dist = dir.length() || 1;
      dir.normalize();
      const length = entry.halfHeight * 2 + entry.radius * 2;
      const center = _solidCenter.copy(_solidV1).addScaledVector(dir, Math.min(dist / 2, length / 2));
      const rot = _solidRot.setFromUnitVectors(_yAxis, dir);

      entry.body.setTranslation({ x: center.x, y: center.y, z: center.z }, true);
      entry.body.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }, true);
    }
    world.propagateModifiedBodyPositionsToColliders();
  }, [resolveBones, world]);

  const resolveBodyMovement = useCallback(
    (
      desiredX: number,
      desiredZ: number,
      bagSolidHandle: number | null,
      onBagBump?: (worldPoint: THREE.Vector3, worldDir: THREE.Vector3, blockedAmount: number) => void
    ): { x: number; z: number } => {
      if (!ensureSolidBody()) return { x: desiredX, z: desiredZ };
      const controller = solidControllerRef.current;
      const entries = solidBodiesRef.current;
      if (!controller) return { x: desiredX, z: desiredZ };

      const desiredMagSq = desiredX * desiredX + desiredZ * desiredZ;
      let bestX = desiredX;
      let bestZ = desiredZ;
      let bestMagSq = desiredMagSq;

      const names = Object.keys(entries);
      const ownHandles = ownColliderHandlesRef.current;
      const excludeOwnParts = (c: Collider) => !ownHandles.has(c.handle);
      for (const name of names) {
        const entry = entries[name];
        controller.computeColliderMovement(
          entry.collider,
          { x: desiredX, y: 0, z: desiredZ },
          undefined,
          SOLID_BODY_GROUPS,
          excludeOwnParts
        );
        const corrected = controller.computedMovement();
        const magSq = corrected.x * corrected.x + corrected.z * corrected.z;
        if (magSq < bestMagSq) {
          bestMagSq = magSq;
          bestX = corrected.x;
          bestZ = corrected.z;
        }

        if (onBagBump && bagSolidHandle !== null) {
          const numCollisions = controller.numComputedCollisions();
          for (let i = 0; i < numCollisions; i++) {
            const collision = controller.computedCollision(i);
            if (!collision || !collision.collider) continue;
            if (collision.collider.handle !== bagSolidHandle) continue;
            const remaining = collision.translationDeltaRemaining;
            const blocked = Math.hypot(remaining.x, remaining.z);
            if (blocked <= 0.0005) continue;
            _solidBumpPoint.set(collision.witness1.x, collision.witness1.y, collision.witness1.z);
            _solidBumpDir.set(desiredX, 0, desiredZ);
            onBagBump(_solidBumpPoint, _solidBumpDir, blocked);
          }
        }
      }

      for (const name of names) {
        const entry = entries[name];
        const t = entry.body.translation();
        entry.body.setTranslation({ x: t.x + bestX, y: t.y, z: t.z + bestZ }, true);
      }
      world.propagateModifiedBodyPositionsToColliders();

      return { x: bestX, z: bestZ };
    },
    [ensureSolidBody, world]
  );

  const getSolidBodySegments = useCallback((): SolidBodySegmentDebug[] => {
    const entries = solidBodiesRef.current;
    const out: SolidBodySegmentDebug[] = [];
    for (const name of Object.keys(entries)) {
      const e = entries[name];
      const t = e.body.translation();
      const r = e.body.rotation();
      out.push({ name, x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w, halfHeight: e.halfHeight, radius: e.radius });
    }
    return out;
  }, []);

  useEffect(
    () => () => {
      for (const name of Object.keys(solidBodiesRef.current)) {
        unregisterShootableCollider(solidBodiesRef.current[name].collider.handle);
        world.removeRigidBody(solidBodiesRef.current[name].body);
      }
      solidBodiesRef.current = {};
      ownColliderHandlesRef.current.clear();
      if (solidControllerRef.current) {
        world.removeCharacterController(solidControllerRef.current);
        solidControllerRef.current = null;
      }
    },
    [world]
  );

  return {
    syncSolidBody,
    resolveBodyMovement,
    getSolidBodySegments,
  };
}
