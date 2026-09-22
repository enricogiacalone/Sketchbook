import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { useRapier } from "@react-three/rapier";
import type {
  RigidBody as RapierRigidBody,
  Collider,
} from "@dimforge/rapier3d-compat";
import { HURTBOX_HEIGHT, HURTBOX_RADIUS, HURTBOX_GROUPS } from "../ragdollConfig";

interface Hurtbox {
  body: RapierRigidBody;
  collider: Collider;
}

export function useRagdollHurtbox(modelRootRef: React.RefObject<THREE.Object3D | null>) {
  const { world, rapier } = useRapier();
  const hurtboxRef = useRef<Hurtbox | null>(null);
  const _v1 = new THREE.Vector3();

  const ensureHurtbox = useCallback((): Hurtbox | null => {
    if (hurtboxRef.current) return hurtboxRef.current;
    const root = modelRootRef.current;
    if (!root) return null;
    root.getWorldPosition(_v1);
    const bodyDesc =
      rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(
        _v1.x,
        _v1.y + HURTBOX_HEIGHT / 2,
        _v1.z
      );
    const body = world.createRigidBody(bodyDesc);
    const halfHeight = Math.max(0.01, HURTBOX_HEIGHT / 2 - HURTBOX_RADIUS);
    const colliderDesc = rapier.ColliderDesc.capsule(halfHeight, HURTBOX_RADIUS)
      .setSensor(true)
      .setCollisionGroups(HURTBOX_GROUPS)
      .setSolverGroups(HURTBOX_GROUPS);
    const collider = world.createCollider(colliderDesc, body);
    const entry = { body, collider };
    hurtboxRef.current = entry;
    return entry;
  }, [rapier, world, modelRootRef]);

  const syncHurtbox = useCallback(() => {
    const entry = ensureHurtbox();
    if (!entry) return;
    const root = modelRootRef.current;
    if (!root) return;
    root.getWorldPosition(_v1);
    entry.body.setNextKinematicTranslation({
      x: _v1.x,
      y: _v1.y + HURTBOX_HEIGHT / 2,
      z: _v1.z,
    });
  }, [ensureHurtbox, modelRootRef]);

  useEffect(
    () => () => {
      if (hurtboxRef.current) {
        world.removeRigidBody(hurtboxRef.current.body);
        hurtboxRef.current = null;
      }
    },
    [world]
  );

  return {
    syncHurtbox,
    getHurtboxHandle: () => hurtboxRef.current ? hurtboxRef.current.collider.handle : null,
  };
}
