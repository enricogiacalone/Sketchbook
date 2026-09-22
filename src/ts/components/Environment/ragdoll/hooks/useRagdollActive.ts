import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { useRapier } from "@react-three/rapier";
import type {
  RigidBody as RapierRigidBody,
  ImpulseJoint,
} from "@dimforge/rapier3d-compat";
import {
  ACTIVE_RAGDOLL_SEGMENTS,
  RAGDOLL_MOTOR_STIFFNESS,
  RAGDOLL_MOTOR_DAMPING_RATIO,
  RAGDOLL_MOTOR_STIFFNESS_BY_SEGMENT,
  RAGDOLL_HIPS_POSITION_STIFFNESS,
  RAGDOLL_HIPS_POSITION_DAMPING,
  ACTIVE_RAGDOLL_CONE_LIMIT_DEG,
  RAGDOLL_HINGE_LIMITS_DEG,
  RAGDOLL_SEGMENT_FROZEN_BONES,
  CORE_TENSION_STIFFNESS,
  CORE_TENSION_DAMPING_RATIO,
  ACTIVE_RAGDOLL_WEIGHT_IDLE,
  ACTIVE_RAGDOLL_WEIGHT_MOVING,
  ACTIVE_RAGDOLL_WEIGHT_SMOOTH_RATE,
} from "../ragdollConfig";
import {
  groupsExcluding,
  CollisionGroups,
} from "../../../../enums/CollisionGroups";

interface BodyEntry {
  segment: any;
  body: RapierRigidBody;
  bone: THREE.Bone;
  restLocalPos: THREE.Vector3;
  restQuat: THREE.Quaternion;
  restRelativeQuat?: THREE.Quaternion;
}

const ACTIVE_RAGDOLL_CONE_LIMIT_RAD: Record<string, number> = {};
for (const key of Object.keys(ACTIVE_RAGDOLL_CONE_LIMIT_DEG)) {
  ACTIVE_RAGDOLL_CONE_LIMIT_RAD[key] = THREE.MathUtils.degToRad(ACTIVE_RAGDOLL_CONE_LIMIT_DEG[key]);
}

const ACTIVE_RAGDOLL_MOTOR_MAX_ERROR_RAD = THREE.MathUtils.degToRad(45);
const HIPS_ABSOLUTE_CLAMP_RAD = THREE.MathUtils.degToRad(20);
const TORSO_ABSOLUTE_CLAMP_RAD = THREE.MathUtils.degToRad(25);

export function useRagdollActive(
  modelRootRef: React.RefObject<THREE.Object3D | null>,
  resolveBones: () => Record<string, THREE.Bone> | null
) {
  const { world, rapier } = useRapier();
  const activeBodiesRef = useRef<Record<string, BodyEntry>>({});
  const activeJointsRef = useRef<ImpulseJoint[]>([]);
  const activeFrozenBoneRestQuatRef = useRef<Record<string, THREE.Quaternion>>({});
  // Current animazione<->fisica blend weight for the render pose (see
  // ACTIVE_RAGDOLL_WEIGHT_IDLE/_MOVING's own comment in ragdollConfig.ts).
  // Starts at the "moving" end so a fighter that spawns mid-action doesn't
  // pop straight to full ragdoll on frame one.
  const activeRagdollWeightRef = useRef(ACTIVE_RAGDOLL_WEIGHT_MOVING);

  // Scratch variables to avoid allocation in frames
  const _v1 = new THREE.Vector3();
  const _q1 = new THREE.Quaternion();
  const _v2 = new THREE.Vector3();
  const _q2 = new THREE.Quaternion();
  const _activeTargetQuat = new THREE.Quaternion();
  const _activeCurQuat = new THREE.Quaternion();
  const _activeErrQuat = new THREE.Quaternion();
  const _activeTorqueAxis = new THREE.Vector3();
  const _activePosTarget = new THREE.Vector3();
  const _activePosError = new THREE.Vector3();
  const _activeParentTargetQuat = new THREE.Quaternion();
  const _activeParentCurQuat = new THREE.Quaternion();
  const _activeTargetRelQuat = new THREE.Quaternion();
  const _activeCurRelQuat = new THREE.Quaternion();
  const _identityQuat = new THREE.Quaternion();
  const _yAxis = new THREE.Vector3(0, 1, 0);
  const _currentUp = new THREE.Vector3();
  const _coreAxis = new THREE.Vector3();

  const _coneParentQuat = new THREE.Quaternion();
  const _coneChildQuat = new THREE.Quaternion();
  const _coneRelQuat = new THREE.Quaternion();
  const _coneDeltaQuat = new THREE.Quaternion();
  const _coneClampedDelta = new THREE.Quaternion();
  const _coneCorrectedRel = new THREE.Quaternion();
  const _coneCorrectedWorld = new THREE.Quaternion();

  // Scratch for syncActiveBonesBlended's world->parent-local decompose.
  const _blendWorldMatrix = new THREE.Matrix4();
  const _blendParentInverse = new THREE.Matrix4();
  const _blendUnitScale = new THREE.Vector3(1, 1, 1);
  const _blendLocalPos = new THREE.Vector3();
  const _blendLocalQuat = new THREE.Quaternion();
  const _blendLocalScale = new THREE.Vector3();

  const ensureActiveRagdoll = useCallback((): boolean => {
    if (Object.keys(activeBodiesRef.current).length > 0) return true;
    const bones = resolveBones();
    if (!bones) return false;

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

    const entries = activeBodiesRef.current;
    for (const segment of ACTIVE_RAGDOLL_SEGMENTS) {
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

      const localDir = new THREE.Vector3().copy(_v2).sub(_v1).applyQuaternion(_q1.clone().invert());
      const localLen = localDir.length() || 1;
      localDir.normalize();
      const capsuleRot = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), localDir);
      const capsuleOffset = localDir.clone().multiplyScalar(Math.min(localLen / 2, length / 2));

      const colliderDesc = rapier.ColliderDesc.capsule(halfHeight, segment.radius)
        .setTranslation(capsuleOffset.x, capsuleOffset.y, capsuleOffset.z)
        .setRotation({ x: capsuleRot.x, y: capsuleRot.y, z: capsuleRot.z, w: capsuleRot.w })
        .setCollisionGroups(groupsExcluding(CollisionGroups.Ragdoll, CollisionGroups.Characters, CollisionGroups.Ragdoll))
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
            activeFrozenBoneRestQuatRef.current[frozenName] = frozenBone.quaternion.clone();
          }
        }
      }

      if (segment.parent) {
        const parentEntry = entries[segment.parent];
        if (parentEntry) {
          const parentBody = parentEntry.body;
          const parentBone = parentEntry.bone;
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
          activeJointsRef.current.push(joint);
        }
      }
    }
    return true;
  }, [rapier, world, resolveBones]);

  const syncActiveRagdollMotors = useCallback((delta: number) => {
    const entries = activeBodiesRef.current;
    if (typeof window !== "undefined") {
      (window as any).__activeRagdollDebug = (window as any).__activeRagdollDebug || {};
    }
    for (const key of Object.keys(entries)) {
      const entry = entries[key];
      const { body, bone, segment } = entry;
      const parentEntry = segment.parent ? entries[segment.parent] : undefined;

      if (parentEntry) {
        bone.getWorldQuaternion(_activeTargetQuat);
        parentEntry.bone.getWorldQuaternion(_activeParentTargetQuat);
        _activeTargetRelQuat.copy(_activeParentTargetQuat).invert().multiply(_activeTargetQuat);
        const r = body.rotation();
        _activeCurQuat.set(r.x, r.y, r.z, r.w);
        const pr = parentEntry.body.rotation();
        _activeParentCurQuat.set(pr.x, pr.y, pr.z, pr.w);
        _activeCurRelQuat.copy(_activeParentCurQuat).invert().multiply(_activeCurQuat);
        _activeErrQuat.copy(_activeTargetRelQuat).multiply(_activeCurRelQuat.invert());
        const cav = body.angvel();
        const pav = parentEntry.body.angvel();
        const angVelX = cav.x - pav.x;
        const angVelY = cav.y - pav.y;
        const angVelZ = cav.z - pav.z;

        let ew = _activeErrQuat.w;
        let ex = _activeErrQuat.x;
        let ey = _activeErrQuat.y;
        let ez = _activeErrQuat.z;
        if (ew < 0) { ew = -ew; ex = -ex; ey = -ey; ez = -ez; }
        const angle = 2 * Math.acos(Math.min(1, Math.max(-1, ew)));
        _activeTorqueAxis.set(ex, ey, ez);
        const axisLen = _activeTorqueAxis.length();
        if (axisLen > 1e-6 && angle > 1e-5) {
          _activeTorqueAxis.divideScalar(axisLen);
          const stiffness = RAGDOLL_MOTOR_STIFFNESS_BY_SEGMENT[segment.name] ?? RAGDOLL_MOTOR_STIFFNESS;
          const inertia = body.principalInertia();
          const inertiaScale = (inertia.x + inertia.y + inertia.z) / 3;
          const damping = 2 * Math.sqrt(stiffness) * RAGDOLL_MOTOR_DAMPING_RATIO;
          const motorAngle = Math.min(angle, ACTIVE_RAGDOLL_MOTOR_MAX_ERROR_RAD);
          body.applyTorqueImpulse(
            {
              x: (_activeTorqueAxis.x * motorAngle * stiffness - angVelX * damping) * inertiaScale * delta,
              y: (_activeTorqueAxis.y * motorAngle * stiffness - angVelY * damping) * inertiaScale * delta,
              z: (_activeTorqueAxis.z * motorAngle * stiffness - angVelZ * damping) * inertiaScale * delta,
            },
            true
          );
        }
      } else {
        bone.getWorldQuaternion(_activeTargetQuat);
        const r = body.rotation();
        _activeCurQuat.set(r.x, r.y, r.z, r.w);
        _activeErrQuat.copy(_activeTargetQuat).multiply(_activeCurQuat.invert());
        const av = body.angvel();
        const angVelX = av.x;
        const angVelY = av.y;
        const angVelZ = av.z;

        let ew = _activeErrQuat.w;
        let ex = _activeErrQuat.x;
        let ey = _activeErrQuat.y;
        let ez = _activeErrQuat.z;
        if (ew < 0) { ew = -ew; ex = -ex; ey = -ey; ez = -ez; }
        const angle = 2 * Math.acos(Math.min(1, Math.max(-1, ew)));
        _activeTorqueAxis.set(ex, ey, ez);
        const axisLen = _activeTorqueAxis.length();
        if (axisLen > 1e-6 && angle > 1e-5) {
          _activeTorqueAxis.divideScalar(axisLen);
          const stiffness = RAGDOLL_MOTOR_STIFFNESS_BY_SEGMENT[segment.name] ?? RAGDOLL_MOTOR_STIFFNESS;
          const inertia = body.principalInertia();
          const inertiaScale = (inertia.x + inertia.y + inertia.z) / 3;
          const damping = 2 * Math.sqrt(stiffness) * RAGDOLL_MOTOR_DAMPING_RATIO;
          const motorAngle = Math.min(angle, ACTIVE_RAGDOLL_MOTOR_MAX_ERROR_RAD);
          body.applyTorqueImpulse(
            {
              x: (_activeTorqueAxis.x * motorAngle * stiffness - angVelX * damping) * inertiaScale * delta,
              y: (_activeTorqueAxis.y * motorAngle * stiffness - angVelY * damping) * inertiaScale * delta,
              z: (_activeTorqueAxis.z * motorAngle * stiffness - angVelZ * damping) * inertiaScale * delta,
            },
            true
          );
        }
      }

      if (segment.name === "Hips") {
        const inertia = body.principalInertia();
        const inertiaScale = (inertia.x + inertia.y + inertia.z) / 3;

        // --- CORE TENSION (UPRIGHT STABILITY) ---
        // Alignment torque to keep the character upright (Hips local Y aligned with World Y)
        _currentUp.copy(_yAxis).applyQuaternion(_activeCurQuat);
        _coreAxis.crossVectors(_currentUp, _yAxis);
        const coreAngle = Math.acos(THREE.MathUtils.clamp((_currentUp as THREE.Vector3).dot(_yAxis), -1, 1));
        const coreStiffness = CORE_TENSION_STIFFNESS;
        const coreDamping = 2 * Math.sqrt(coreStiffness) * CORE_TENSION_DAMPING_RATIO;
        const av = body.angvel();
        const angVelAlongAxis = av.x * _coreAxis.x + av.y * _coreAxis.y + av.z * _coreAxis.z;
        const coreTorqueMag = (coreAngle * coreStiffness - angVelAlongAxis * coreDamping) * inertiaScale * delta;
        body.applyTorqueImpulse({
          x: _coreAxis.x * coreTorqueMag,
          y: _coreAxis.y * coreTorqueMag,
          z: _coreAxis.z * coreTorqueMag,
        }, true);

        bone.getWorldPosition(_activePosTarget);
        const t = body.translation();
        _activePosError.set(_activePosTarget.x - t.x, _activePosTarget.y - t.y, _activePosTarget.z - t.z);
        const v = body.linvel();
        const mass = body.mass();
        body.applyImpulse(
          {
            x: (_activePosError.x * RAGDOLL_HIPS_POSITION_STIFFNESS - v.x * RAGDOLL_HIPS_POSITION_DAMPING) * mass * delta,
            y: (_activePosError.y * RAGDOLL_HIPS_POSITION_STIFFNESS - v.y * RAGDOLL_HIPS_POSITION_DAMPING) * mass * delta,
            z: (_activePosError.z * RAGDOLL_HIPS_POSITION_STIFFNESS - v.z * RAGDOLL_HIPS_POSITION_DAMPING) * mass * delta,
          },
          true
        );
      }
    }
  }, []);

  const clampActiveSegmentAbsolute = useCallback(
    (segmentName: string, maxAngle: number) => {
      const entry = activeBodiesRef.current[segmentName];
      if (!entry) return;
      entry.bone.getWorldQuaternion(_activeTargetQuat);
      const r = entry.body.rotation();
      _activeCurQuat.set(r.x, r.y, r.z, r.w);
      _activeErrQuat.copy(_activeTargetQuat).multiply(_activeCurQuat.invert());
      const w = THREE.MathUtils.clamp(Math.abs(_activeErrQuat.w), -1, 1);
      const angle = 2 * Math.acos(w);
      if (angle <= maxAngle || angle < 1e-5) return;
      const f = (angle - maxAngle) / angle;
      _coneCorrectedWorld.copy(_activeCurQuat).slerp(_activeTargetQuat, f);
      entry.body.setRotation({ x: _coneCorrectedWorld.x, y: _coneCorrectedWorld.y, z: _coneCorrectedWorld.z, w: _coneCorrectedWorld.w }, true);
      const av = entry.body.angvel();
      entry.body.setAngvel({ x: av.x * 0.2, y: av.y * 0.2, z: av.z * 0.2 }, true);
    },
    []
  );

  const clampActiveHipsAbsolute = useCallback(() => {
    clampActiveSegmentAbsolute("Hips", HIPS_ABSOLUTE_CLAMP_RAD);
    clampActiveSegmentAbsolute("Torso", TORSO_ABSOLUTE_CLAMP_RAD);
  }, [clampActiveSegmentAbsolute]);

  const clampActiveJointCones = useCallback(() => {
    const entries = activeBodiesRef.current;
    for (const key of Object.keys(entries)) {
      const entry = entries[key];
      if (!entry.restRelativeQuat || !entry.segment.parent) continue;
      const maxAngle = ACTIVE_RAGDOLL_CONE_LIMIT_RAD[entry.segment.name];
      if (maxAngle === undefined) continue;
      const parentEntry = entries[entry.segment.parent];
      if (!parentEntry) continue;
      const parentRot = parentEntry.body.rotation();
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

  const clampActiveRagdollVelocities = useCallback(() => {
    const ACTIVE_RAGDOLL_MAX_LINVEL = 3;
    const ACTIVE_RAGDOLL_MAX_ANGVEL = 8;
    const entries = activeBodiesRef.current;
    for (const key of Object.keys(entries)) {
      const { body } = entries[key];
      const v = body.linvel();
      const speedSq = v.x * v.x + v.y * v.y + v.z * v.z;
      if (speedSq > ACTIVE_RAGDOLL_MAX_LINVEL * ACTIVE_RAGDOLL_MAX_LINVEL) {
        const scale = ACTIVE_RAGDOLL_MAX_LINVEL / Math.sqrt(speedSq);
        body.setLinvel({ x: v.x * scale, y: v.y * scale, z: v.z * scale }, true);
      }
      const w = body.angvel();
      const angSpeedSq = w.x * w.x + w.y * w.y + w.z * w.z;
      if (angSpeedSq > ACTIVE_RAGDOLL_MAX_ANGVEL * ACTIVE_RAGDOLL_MAX_ANGVEL) {
        const scale = ACTIVE_RAGDOLL_MAX_ANGVEL / Math.sqrt(angSpeedSq);
        body.setAngvel({ x: w.x * scale, y: w.y * scale, z: w.z * scale }, true);
      }
    }
  }, []);

  // "voglio un mix perfetto tra il ragdoll e l'animazione... quando il
  // personaggio si ferma da piu' valore al ragdoll" -- finora il chiamante
  // (useRagdoll.ts) sovrascriveva SEMPRE le ossa col risultato fisico al
  // 100% (era un semplice syncBonesFromPhysics(1, ...)). Questa funzione
  // fa lo stesso lavoro (world->parent-local del body fisico) ma sfuma
  // (`weight`) tra quel risultato e la posa che il mixer di animazione ha
  // GIA' scritto su bone.position/bone.quaternion questo stesso frame
  // (syncActiveBonesBlended gira DOPO mixer.update() ma prima di
  // toccare le ossa, quindi a weight=0 la posa e' ancora quella
  // dell'animazione pura, intatta -- diverso da syncBonesFromPhysics's
  // stesso weight<1, che sfuma verso restLocalPos, una posa di riposo
  // FISSA congelata alla creazione del rig, adatta al blend-out di un
  // impulso di colpo ma non a questo caso). `weight` stesso viene
  // smussato frame per frame verso l'obiettivo (fermo/in movimento) cosi'
  // il cambio e' una dissolvenza.
  const syncActiveBonesBlended = useCallback((delta: number, isIdle: boolean) => {
    const targetWeight = isIdle ? ACTIVE_RAGDOLL_WEIGHT_IDLE : ACTIVE_RAGDOLL_WEIGHT_MOVING;
    const rate = Math.min(1, Math.max(0, delta) * ACTIVE_RAGDOLL_WEIGHT_SMOOTH_RATE);
    activeRagdollWeightRef.current += (targetWeight - activeRagdollWeightRef.current) * rate;
    const weight = activeRagdollWeightRef.current;

    const entries = activeBodiesRef.current;
    for (const key of Object.keys(entries)) {
      const { body, bone } = entries[key];
      if (!bone.parent) continue;
      if (weight <= 0.001) continue; // lascia l'osso esattamente come l'ha lasciato il mixer

      const t = body.translation();
      const r = body.rotation();
      _v1.set(t.x, t.y, t.z);
      _q1.set(r.x, r.y, r.z, r.w);
      _blendWorldMatrix.compose(_v1, _q1, _blendUnitScale);
      _blendParentInverse.copy(bone.parent.matrixWorld).invert();
      _blendWorldMatrix.premultiply(_blendParentInverse);
      _blendWorldMatrix.decompose(_blendLocalPos, _blendLocalQuat, _blendLocalScale);

      if (weight >= 0.999) {
        bone.position.copy(_blendLocalPos);
        bone.quaternion.copy(_blendLocalQuat);
      } else {
        bone.position.lerp(_blendLocalPos, weight);
        bone.quaternion.slerp(_blendLocalQuat, weight);
      }
      bone.updateMatrixWorld(true);
    }
  }, []);

  const checkActiveRagdollRunaway = useCallback(() => {
    const ACTIVE_RAGDOLL_RUNAWAY_ANGVEL = 30;
    const entries = activeBodiesRef.current;
    const thresholdSq = ACTIVE_RAGDOLL_RUNAWAY_ANGVEL * ACTIVE_RAGDOLL_RUNAWAY_ANGVEL;
    for (const key of Object.keys(entries)) {
      const av = entries[key].body.angvel();
      const magSq = av.x * av.x + av.y * av.y + av.z * av.z;
      if (!(magSq <= thresholdSq) || !Number.isFinite(magSq)) return true;
      const lv = entries[key].body.linvel();
      if (!Number.isFinite(lv.x) || !Number.isFinite(lv.y) || !Number.isFinite(lv.z)) {
        return true;
      }
    }
    return false;
  }, []);

  const resyncActiveRagdollToBones = useCallback(() => {
    const entries = activeBodiesRef.current;
    for (const key of Object.keys(entries)) {
      const { body, bone } = entries[key];
      bone.getWorldPosition(_v1);
      bone.getWorldQuaternion(_q1);
      body.setTranslation({ x: _v1.x, y: _v1.y, z: _v1.z }, true);
      body.setRotation({ x: _q1.x, y: _q1.y, z: _q1.z, w: _q1.w }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }, []);

  const destroyActiveRagdoll = useCallback(() => {
    for (const joint of activeJointsRef.current) {
      world.removeImpulseJoint(joint, true);
    }
    activeJointsRef.current = [];
    for (const key of Object.keys(activeBodiesRef.current)) {
      world.removeRigidBody(activeBodiesRef.current[key].body);
    }
    activeBodiesRef.current = {};
    const bones = resolveBones();
    if (bones) {
      const rest = activeFrozenBoneRestQuatRef.current;
      for (const name of Object.keys(rest)) {
        const bone = bones[name];
        if (bone) bone.quaternion.copy(rest[name]);
      }
    }
    activeFrozenBoneRestQuatRef.current = {};
    activeRagdollWeightRef.current = ACTIVE_RAGDOLL_WEIGHT_MOVING;
  }, [world, resolveBones]);

  useEffect(
    () => () => {
      for (const joint of activeJointsRef.current) {
        world.removeImpulseJoint(joint, true);
      }
      activeJointsRef.current = [];
      for (const name of Object.keys(activeBodiesRef.current)) {
        world.removeRigidBody(activeBodiesRef.current[name].body);
      }
      activeBodiesRef.current = {};
      activeFrozenBoneRestQuatRef.current = {};
    },
    [world]
  );

  return {
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
  };
}
