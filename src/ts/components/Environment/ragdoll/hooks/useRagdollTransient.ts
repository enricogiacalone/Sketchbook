import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { useRapier } from "@react-three/rapier";
import type {
  RigidBody as RapierRigidBody,
  ImpulseJoint,
} from "@dimforge/rapier3d-compat";
import {
  RAGDOLL_PULSE_NEARBY,
  RAGDOLL_SEGMENTS,
  RAGDOLL_HINGE_LIMITS_DEG,
  RAGDOLL_CONE_LIMIT_DEG,
  RAGDOLL_SEGMENT_FROZEN_BONES,
  RagdollSegment,
} from "../ragdollConfig";
import {
  groupsExcluding,
  CollisionGroups,
} from "../../../../enums/CollisionGroups";

interface BodyEntry {
  segment: RagdollSegment;
  body: RapierRigidBody;
  bone: THREE.Bone;
  restLocalPos: THREE.Vector3;
  restQuat: THREE.Quaternion;
  restRelativeQuat?: THREE.Quaternion;
}

interface AnchorEntry {
  body: RapierRigidBody;
  bone: THREE.Bone;
}

interface RagdollState {
  active: boolean;
  isDeath: boolean;
  pulseElapsed: number;
  blendElapsed: number;
  chainElapsed: number;
}

const RAGDOLL_CONE_LIMIT_RAD: Record<string, number> = {};
for (const key of Object.keys(RAGDOLL_CONE_LIMIT_DEG)) {
  RAGDOLL_CONE_LIMIT_RAD[key] = THREE.MathUtils.degToRad(RAGDOLL_CONE_LIMIT_DEG[key]);
}

const SEGMENT_MAP: Record<string, RagdollSegment> = {};
for (const seg of RAGDOLL_SEGMENTS) SEGMENT_MAP[seg.name] = seg;

export function useRagdollTransient(
  modelRootRef: React.RefObject<THREE.Object3D | null>,
  resolveBones: () => Record<string, THREE.Bone> | null
) {
  const { world, rapier } = useRapier();
  const bodiesRef = useRef<Record<string, BodyEntry>>({});
  const anchorsRef = useRef<Record<string, AnchorEntry>>({});
  const jointsRef = useRef<ImpulseJoint[]>([]);
  const frozenBoneRestQuatRef = useRef<Record<string, THREE.Quaternion>>({});
  const stateRef = useRef<RagdollState>({ active: false, isDeath: false, pulseElapsed: 0, blendElapsed: 0, chainElapsed: 0 });

  const _v1 = new THREE.Vector3();
  const _q1 = new THREE.Quaternion();
  const _v2 = new THREE.Vector3();
  const _q2 = new THREE.Quaternion();
  const _v3 = new THREE.Vector3();
  const _identityQuat = new THREE.Quaternion();
  const _worldMatrix = new THREE.Matrix4();
  const _parentInverse = new THREE.Matrix4();
  const _unitScale = new THREE.Vector3(1, 1, 1);

  const buildBodies = useCallback(
    (activeSegments?: Set<string>) => {
      const bones = resolveBones();
      if (!bones) return;

      const sideways = new THREE.Vector3(1, 0, 0);
      const thighL = bones["thigh_l"];
      const thighR = bones["thigh_r"];
      if (thighL && thighR) {
        thighL.getWorldPosition(_v1);
        thighR.getWorldPosition(_v2);
        sideways.subVectors(_v1, _v2);
        if (sideways.lengthSq() > 0.0001) sideways.normalize();
        else sideways.set(1, 0, 0);
      }

      const segmentsToBuild = (
        activeSegments
          ? RAGDOLL_SEGMENTS.filter((s) => activeSegments.has(s.name))
          : RAGDOLL_SEGMENTS
      ).filter((s) => !bodiesRef.current[s.name]);
      if (segmentsToBuild.length === 0) return;

      const entries = bodiesRef.current;
      const anchors = anchorsRef.current;

      const getOrCreateAnchor = (parentSegmentName: string): AnchorEntry | null => {
        const existing = anchors[parentSegmentName];
        if (existing) return existing;
        const parentSegment = SEGMENT_MAP[parentSegmentName];
        const parentBone = parentSegment ? bones[parentSegment.drivingBone] : null;
        if (!parentBone) return null;
        parentBone.getWorldPosition(_v1);
        parentBone.getWorldQuaternion(_q1);
        const anchorDesc = rapier.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(_v1.x, _v1.y, _v1.z)
          .setRotation({ x: _q1.x, y: _q1.y, z: _q1.z, w: _q1.w });
        const anchorBody = world.createRigidBody(anchorDesc);
        const entry: AnchorEntry = { body: anchorBody, bone: parentBone };
        anchors[parentSegmentName] = entry;
        return entry;
      };

      for (const segment of segmentsToBuild) {
        const bone = bones[segment.drivingBone];
        const toBone = bones[segment.toBone];
        if (!bone || !toBone) continue;

        bone.getWorldPosition(_v1);
        bone.getWorldQuaternion(_q1);
        toBone.getWorldPosition(_v2);

        const length = Math.max(0.05, _v1.distanceTo(_v2) * (segment.lengthScale ?? 0.92));
        const halfHeight = Math.max(0.01, length / 2 - segment.radius);

        const bodyDesc = rapier.RigidBodyDesc.dynamic()
          .setTranslation(_v1.x, _v1.y, _v1.z)
          .setRotation({ x: _q1.x, y: _q1.y, z: _q1.z, w: _q1.w })
          .setLinearDamping(0.5)
          .setAngularDamping(0.9);
        const body = world.createRigidBody(bodyDesc);

        const localDir = _v3.copy(_v2).sub(_v1).applyQuaternion(_q2.copy(_q1).invert());
        const localLen = localDir.length() || 1;
        localDir.normalize();
        const capsuleRot = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), localDir);
        const capsuleOffset = localDir.clone().multiplyScalar(Math.min(localLen / 2, length / 2));

        const colliderDesc = rapier.ColliderDesc.capsule(halfHeight, segment.radius)
          .setTranslation(capsuleOffset.x, capsuleOffset.y, capsuleOffset.z)
          .setRotation({ x: capsuleRot.x, y: capsuleRot.y, z: capsuleRot.z, w: capsuleRot.w })
          .setCollisionGroups(groupsExcluding(CollisionGroups.Ragdoll, CollisionGroups.Characters))
          .setDensity(1.0);
        world.createCollider(colliderDesc, body);

        entries[segment.name] = {
          segment,
          body,
          bone,
          restLocalPos: bone.position.clone(),
          restQuat: bone.quaternion.clone(),
        };

        const frozenNamesForThisSegment = RAGDOLL_SEGMENT_FROZEN_BONES[segment.name];
        if (frozenNamesForThisSegment) {
          for (const frozenName of frozenNamesForThisSegment) {
            const frozenBone = bones[frozenName];
            if (frozenBone) {
              frozenBoneRestQuatRef.current[frozenName] = frozenBone.quaternion.clone();
            }
          }
        }

        if (segment.parent) {
          const parentEntry = entries[segment.parent];
          const parentBody = parentEntry ? parentEntry.body : getOrCreateAnchor(segment.parent)?.body;
          const parentBone = parentEntry ? parentEntry.bone : anchors[segment.parent]?.bone;
          if (parentBody && parentBone) {
            parentBone.getWorldPosition(_v1);
            parentBone.getWorldQuaternion(_q1);
            bone.getWorldPosition(_v2);
            const anchor1 = _v2.clone().sub(_v1).applyQuaternion(_q1.clone().invert());

            const hingeLimitsDeg = RAGDOLL_HINGE_LIMITS_DEG[segment.name];
            let jointData;
            if (hingeLimitsDeg) {
              const axisLocal = sideways.clone().applyQuaternion(_q1.clone().invert());
              jointData = rapier.JointData.revolute(
                { x: anchor1.x, y: anchor1.y, z: anchor1.z },
                { x: 0, y: 0, z: 0 },
                { x: axisLocal.x, y: axisLocal.y, z: axisLocal.z }
              );
              jointData.limitsEnabled = true;
              jointData.limits = [
                THREE.MathUtils.degToRad(hingeLimitsDeg[0]),
                THREE.MathUtils.degToRad(hingeLimitsDeg[1]),
              ];
            } else {
              jointData = rapier.JointData.spherical(
                { x: anchor1.x, y: anchor1.y, z: anchor1.z },
                { x: 0, y: 0, z: 0 }
              );
              bone.getWorldQuaternion(_q2);
              entries[segment.name].restRelativeQuat = _q1.clone().invert().multiply(_q2);
            }

            const joint = world.createImpulseJoint(jointData, parentBody, body, true);
            jointsRef.current.push(joint);
          }
        }
      }
    },
    [rapier, world, resolveBones]
  );

  const destroyBodies = useCallback(() => {
    for (const joint of jointsRef.current) {
      world.removeImpulseJoint(joint, true);
    }
    jointsRef.current = [];
    for (const key of Object.keys(bodiesRef.current)) {
      world.removeRigidBody(bodiesRef.current[key].body);
    }
    bodiesRef.current = {};
    for (const key of Object.keys(anchorsRef.current)) {
      world.removeRigidBody(anchorsRef.current[key].body);
    }
    anchorsRef.current = {};
  }, [world]);

  const restoreBonesToAnimation = useCallback(() => {
    const bones = resolveBones();
    if (bones) {
      for (const key of Object.keys(bodiesRef.current)) {
        const entry = bodiesRef.current[key];
        entry.bone.quaternion.copy(entry.restQuat);
      }
      const rest = frozenBoneRestQuatRef.current;
      for (const name of Object.keys(rest)) {
        const bone = bones[name];
        if (bone) bone.quaternion.copy(rest[name]);
      }
    }
    frozenBoneRestQuatRef.current = {};
  }, [resolveBones]);

  const syncAnchors = useCallback(() => {
    const anchors = anchorsRef.current;
    for (const key of Object.keys(anchors)) {
      const { body, bone } = anchors[key];
      bone.updateWorldMatrix(true, false);
      bone.getWorldPosition(_v1);
      bone.getWorldQuaternion(_q1);
      body.setNextKinematicTranslation({ x: _v1.x, y: _v1.y, z: _v1.z });
      body.setNextKinematicRotation({ x: _q1.x, y: _q1.y, z: _q1.z, w: _q1.w });
    }
  }, []);

  const syncBonesFromPhysics = useCallback(
    (weight: number, entries: Record<string, BodyEntry> = bodiesRef.current) => {
      for (const key of Object.keys(entries)) {
        const { body, bone, restLocalPos } = entries[key];
        if (!bone.parent) continue;
        const t = body.translation();
        const r = body.rotation();
        _v1.set(t.x, t.y, t.z);
        _q1.set(r.x, r.y, r.z, r.w);

        _worldMatrix.compose(_v1, _q1, _unitScale);
        _parentInverse.copy(bone.parent.matrixWorld).invert();
        _worldMatrix.premultiply(_parentInverse);
        _worldMatrix.decompose(_v2, _q2, _v3);

        if (weight >= 1) {
          bone.position.copy(_v2);
          bone.quaternion.copy(_q2);
        } else {
          bone.position.lerpVectors(restLocalPos, _v2, weight);
          bone.quaternion.slerp(_q2, weight);
        }
        bone.updateMatrixWorld(true);
      }

      const bones = resolveBones();
      if (bones) {
        const drivenBoneNames = new Set<string>();
        for (const k of Object.keys(entries)) {
          drivenBoneNames.add(entries[k].segment.drivingBone);
        }
        for (const key of Object.keys(entries)) {
          const frozenNames = RAGDOLL_SEGMENT_FROZEN_BONES[key];
          if (!frozenNames) continue;
          for (const boneName of frozenNames) {
            if (drivenBoneNames.has(boneName)) continue;
            const bone = bones[boneName];
            if (!bone) continue;
            if (weight >= 1) bone.quaternion.identity();
            else bone.quaternion.slerp(_identityQuat, weight);
          }
        }
      }
    },
    [resolveBones]
  );

  const clampJointCones = useCallback(() => {
    const entries = bodiesRef.current;
    const anchors = anchorsRef.current;
    const _coneParentQuat = new THREE.Quaternion();
    const _coneChildQuat = new THREE.Quaternion();
    const _coneRelQuat = new THREE.Quaternion();
    const _coneDeltaQuat = new THREE.Quaternion();
    const _coneClampedDelta = new THREE.Quaternion();
    const _coneCorrectedRel = new THREE.Quaternion();
    const _coneCorrectedWorld = new THREE.Quaternion();

    for (const key of Object.keys(entries)) {
      const entry = entries[key];
      if (!entry.restRelativeQuat || !entry.segment.parent) continue;
      const maxAngle = RAGDOLL_CONE_LIMIT_RAD[entry.segment.name];
      if (maxAngle === undefined) continue;

      const parentEntry = entries[entry.segment.parent];
      const parentAnchor = anchors[entry.segment.parent];
      const parentRot = parentEntry ? parentEntry.body.rotation() : parentAnchor ? parentAnchor.body.rotation() : null;
      if (!parentRot) continue;

      _coneParentQuat.set(parentRot.x, parentRot.y, parentRot.z, parentRot.w);
      const childRot = entry.body.rotation();
      _coneChildQuat.set(childRot.x, childRot.y, childRot.z, childRot.w);

      _coneRelQuat.copy(_coneParentQuat).invert().multiply(_coneChildQuat);
      _coneDeltaQuat.copy(entry.restRelativeQuat).invert().multiply(_coneRelQuat);

      const w = THREE.MathUtils.clamp(Math.abs(_coneDeltaQuat.w), -1, 1);
      const angle = 2 * Math.acos(w);
      if (angle <= maxAngle || angle < 1e-5) continue;

      const t = maxAngle / angle;
      _coneClampedDelta.copy(_identityQuat).slerp(_coneDeltaQuat, t);
      _coneCorrectedRel.copy(entry.restRelativeQuat).multiply(_coneClampedDelta);
      _coneCorrectedWorld.copy(_coneParentQuat).multiply(_coneCorrectedRel);
      entry.body.setRotation({ x: _coneCorrectedWorld.x, y: _coneCorrectedWorld.y, z: _coneCorrectedWorld.z, w: _coneCorrectedWorld.w }, true);

      const av = entry.body.angvel();
      entry.body.setAngvel({ x: av.x * 0.2, y: av.y * 0.2, z: av.z * 0.2 }, true);
    }
  }, []);

  const clampBodyVelocities = useCallback(() => {
    const HIT_MAX_LINVEL = 3;
    const entries = bodiesRef.current;
    for (const key of Object.keys(entries)) {
      const { body } = entries[key];
      const v = body.linvel();
      const speedSq = v.x * v.x + v.y * v.y + v.z * v.z;
      if (speedSq > HIT_MAX_LINVEL * HIT_MAX_LINVEL) {
        const scale = HIT_MAX_LINVEL / Math.sqrt(speedSq);
        body.setLinvel({ x: v.x * scale, y: v.y * scale, z: v.z * scale }, true);
      }
    }
  }, []);

  return {
    buildBodies,
    destroyBodies,
    restoreBonesToAnimation,
    syncAnchors,
    syncBonesFromPhysics,
    clampJointCones,
    clampBodyVelocities,
    stateRef,
    bodiesRef,
    jointsRef,
    anchorsRef,
    frozenBoneRestQuatRef,
  };
}
