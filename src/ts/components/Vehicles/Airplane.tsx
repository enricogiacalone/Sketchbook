import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, CuboidCollider, RapierRigidBody } from '@react-three/rapier';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useInput } from '../../hooks/useInput';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { CollisionGroups, groupsExcluding } from '../../enums/CollisionGroups';

interface AirplaneProps {
  position?: [number, number, number];
  id?: string;
}

const _planeForward = new THREE.Vector3();
const _planeUp = new THREE.Vector3();
const _planeRight = new THREE.Vector3();
const _planeVelVec = new THREE.Vector3();
const _planePos = new THREE.Vector3();
const _planeEuler = new THREE.Euler();
const _planeQuat = new THREE.Quaternion();

const Airplane: React.FC<AirplaneProps> = ({ position = [-10, 5, -10], id = 'airplane-1' }) => {
  const { scene } = useGLTF('airplane.glb');
  const clonedScene = useMemo(() => scene.clone(), [scene]);
  const input = useInput();
  // Vehicle entry/exit (including the exit key) is orchestrated centrally
  // by Player.tsx (see vehicleTransition there).
  const { currentControllable, controlledEntityId, isVehicleTransitioning, updateEntity, setPlayerInfo, isPaused } = useStore(
    useShallow((state) => ({
      currentControllable: state.currentControllable,
      controlledEntityId: state.controlledEntityId,
      isVehicleTransitioning: state.isVehicleTransitioning,
      updateEntity: state.updateEntity,
      setPlayerInfo: state.setPlayerInfo,
      isPaused: state.isPaused,
    }))
  );

  // Migrated from @react-three/cannon's useBox to @react-three/rapier's
  // <RigidBody>/<CuboidCollider>. Rapier's CuboidCollider args are
  // half-extents (like raw cannon-es), whereas @react-three/cannon's useBox
  // took FULL dimensions -- so the old [1.5, 1, 4] full-size box becomes
  // [0.75, 0.5, 2] half-extents here. collisionGroups with no excluded
  // groups (groupsExcluding(CollisionGroups.Default)) matches the old
  // collisionFilterMask: -1 -- a member of Default that collides with
  // everything.
  const chassisHalfExtents: [number, number, number] = [0.75, 0.5, 2];
  const chassisRef = useRef<RapierRigidBody>(null);

  useEffect(() => {
    // Populate the store immediately instead of waiting for the first
    // render-rate updateEntity below, so this plane has a valid entry (for
    // e.g. Player.tsx's nearest-vehicle search) as soon as it spawns.
    if (!chassisRef.current) return;
    const t = chassisRef.current.translation();
    updateEntity(id, { type: 'airplane', position: [t.x, t.y, t.z] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const velocity = useRef([0, 0, 0]);

  const enginePower = useRef(0);
  const rotorRef = useRef<THREE.Object3D | undefined>(undefined);

  useEffect(() => {
    if (scene) {
      scene.traverse((child) => {
        if (child.userData.data === 'rotor') rotorRef.current = child;
      });
    }
  }, [scene]);

  useFrame((state, delta) => {
    const body = chassisRef.current;
    const isAirplaneActive = currentControllable === 'airplane' && controlledEntityId === id && !isVehicleTransitioning;

    if (!body) return;
    // Unlike Car.tsx, all of this vehicle's control logic (engine power,
    // forces, rotation) lives in this plain useFrame rather than
    // useBeforePhysicsStep, so <Physics paused> alone doesn't stop it --
    // needs its own explicit check, same as Player.tsx/Car.tsx.
    if (isPaused) return;

    // Synchronous Rapier read (no more worker-subscription lag -- see
    // Player.tsx's rigidBodyRef comment for the general explanation).
    const lv = body.linvel();
    velocity.current[0] = lv.x;
    velocity.current[1] = lv.y;
    velocity.current[2] = lv.z;

    if (!isAirplaneActive) {
      if (enginePower.current > 0) enginePower.current = Math.max(0, enginePower.current - delta * 0.12);
      return;
    }

    if (enginePower.current < 1) enginePower.current = Math.min(1, enginePower.current + delta * 0.4);

    if (rotorRef.current) {
        rotorRef.current.rotateX(enginePower.current * delta * 60);
    }

    const rot = body.rotation();
    _planeQuat.set(rot.x, rot.y, rot.z, rot.w);

    _planeForward.set(0, 0, 1).applyQuaternion(_planeQuat);
    const forward = _planeForward;
    _planeUp.set(0, 1, 0).applyQuaternion(_planeQuat);
    const up = _planeUp;
    _planeRight.set(1, 0, 0).applyQuaternion(_planeQuat);
    const right = _planeRight;

    _planeVelVec.set(velocity.current[0], velocity.current[1], velocity.current[2]);
    const velVec = _planeVelVec;
    const currentSpeed = velVec.dot(forward);
    const flightModeInfluence = THREE.MathUtils.clamp(currentSpeed / 10, 0, 1);

    // Thrust, pitch/roll/yaw torques below are all fixed impulses applied
    // once per RENDERED frame with no time scaling -- so, like the car,
    // their actual per-second effect depended entirely on the display's
    // refresh rate (double the force on a 120Hz ProMotion display versus
    // 60Hz). dt60 renormalizes to the tuning's implicit 60fps baseline
    // (dt60 == 1 at exactly 60fps). liftForce and drag below already do
    // their own delta scaling and are left alone.
    // Clamped so a dropped/backgrounded frame (a big one-off `delta`)
    // can't fling the plane with a single huge impulse -- caps the
    // renormalization at 3x the 60fps baseline instead of following an
    // arbitrarily large delta.
    const dt60 = Math.min(delta * 60, 3);

    // Thrust
    let thrustForce = 0;
    if (input.shift) thrustForce = 28; 
    else if (input.jump) thrustForce = -15; 
    
    if (enginePower.current > 0.1) {
        body.applyImpulse(
            { x: forward.x * thrustForce * enginePower.current * dt60, y: forward.y * thrustForce * enginePower.current * dt60, z: forward.z * thrustForce * enginePower.current * dt60 },
            true
        );
    }

    // Torques
    const torqueFactor = 2 * flightModeInfluence * enginePower.current * dt60;
    if (input.forward) body.applyTorqueImpulse({ x: right.x * torqueFactor, y: right.y * torqueFactor, z: right.z * torqueFactor }, true);
    if (input.backward) body.applyTorqueImpulse({ x: -right.x * torqueFactor, y: -right.y * torqueFactor, z: -right.z * torqueFactor }, true);
    if (input.left) body.applyTorqueImpulse({ x: forward.x * torqueFactor * 1.5, y: forward.y * torqueFactor * 1.5, z: forward.z * torqueFactor * 1.5 }, true);
    if (input.right) body.applyTorqueImpulse({ x: -forward.x * torqueFactor * 1.5, y: -forward.y * torqueFactor * 1.5, z: -forward.z * torqueFactor * 1.5 }, true);

    // Yaw (Q/E)
    const yawTorqueFactor = 1.0 * flightModeInfluence * enginePower.current * dt60;
    if (input.yawLeft) body.applyTorqueImpulse({ x: up.x * yawTorqueFactor, y: up.y * yawTorqueFactor, z: up.z * yawTorqueFactor }, true);
    if (input.yawRight) body.applyTorqueImpulse({ x: -up.x * yawTorqueFactor, y: -up.y * yawTorqueFactor, z: -up.z * yawTorqueFactor }, true);

    // Lift
    const liftForce = Math.min(1.8, currentSpeed * 0.08) * enginePower.current * 20 * 50 * delta; 
    if (liftForce > 0) {
        body.applyImpulse({ x: up.x * liftForce, y: up.y * liftForce, z: up.z * liftForce }, true);
    }

    // Drag
    const drag = currentSpeed * 0.01 * enginePower.current * dt60;
    body.applyImpulse({ x: -velVec.x * drag, y: -velVec.y * drag, z: -velVec.z * drag }, true);

    const t = body.translation();
    _planePos.set(t.x, t.y, t.z);
    const planePos = _planePos;
    _planeEuler.setFromQuaternion(_planeQuat, 'YXZ');
    const planeEuler = _planeEuler;

    // Update player info so camera/minimap follow the plane
    setPlayerInfo([planePos.x, planePos.y, planePos.z], planeEuler.y);

    if (state.clock.getElapsedTime() % 0.1 < 0.02) {
      updateEntity(id, {
        type: 'airplane',
        position: [planePos.x, planePos.y, planePos.z],
        rotation: planeEuler.y
      });
    }
  });

  return (
    <RigidBody
      ref={chassisRef}
      name={id}
      type="dynamic"
      colliders={false}
      position={position}
      canSleep={false}
      collisionGroups={groupsExcluding(CollisionGroups.Default)}
    >
      <CuboidCollider args={chassisHalfExtents} mass={50} />
      {/* Chassis box half-height is 0.5; the glb's lowest point (the
          landing gear) sits 0.265 below the model's own origin, so
          -0.24 aligns the wheels with the box's bottom face. */}
      <primitive object={clonedScene} position={[0, -0.24, 0]} />
    </RigidBody>
  );
};

export default Airplane;
