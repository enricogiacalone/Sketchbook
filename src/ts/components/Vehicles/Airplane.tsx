import React, { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useBox } from '@react-three/cannon';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useInput } from '../../hooks/useInput';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';

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

const Airplane: React.FC<AirplaneProps> = ({ position = [-10, 5, -10], id = 'airplane-1' }) => {
  const { scene } = useGLTF('airplane.glb');
  const clonedScene = useMemo(() => scene.clone(), [scene]);
  const input = useInput();
  // Vehicle entry/exit (including the exit key) is orchestrated centrally
  // by Player.tsx (see vehicleTransition there).
  const { currentControllable, controlledEntityId, isVehicleTransitioning, updateEntity, setPlayerInfo } = useStore(
    useShallow((state) => ({
      currentControllable: state.currentControllable,
      controlledEntityId: state.controlledEntityId,
      isVehicleTransitioning: state.isVehicleTransitioning,
      updateEntity: state.updateEntity,
      setPlayerInfo: state.setPlayerInfo,
    }))
  );
  const [ready, setReady] = useState(false);

  const chassisArgs: [number, number, number] = [1.5, 1, 4];
  
  const [chassisRef, chassisApi] = useBox<THREE.Mesh>(() => ({
    allowSleep: false,
    args: chassisArgs,
    mass: 50,
    position: position,
    collisionFilterGroup: 1, // Default
    collisionFilterMask: -1, // Collide with everything
  }));

  const velocity = useRef([0, 0, 0]);
  useEffect(() => {
    const unsubVel = chassisApi.velocity.subscribe((v) => (velocity.current = v));
    const unsubPos = chassisApi.position.subscribe((p) => {
        if (p) {
            updateEntity(id, { 
                type: 'airplane', 
                position: p as [number, number, number] 
            });
            setReady(true);
        }
    });
    return () => { unsubVel(); unsubPos(); };
  }, [chassisApi, updateEntity, id]);

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
    const isAirplaneActive = currentControllable === 'airplane' && controlledEntityId === id && !isVehicleTransitioning;

    if (!ready || !isAirplaneActive || !chassisRef.current) {
      if (enginePower.current > 0) enginePower.current = Math.max(0, enginePower.current - delta * 0.12);
      return;
    }

    if (enginePower.current < 1) enginePower.current = Math.min(1, enginePower.current + delta * 0.4);

    if (rotorRef.current) {
        rotorRef.current.rotateX(enginePower.current * delta * 60);
    }

    _planeForward.set(0, 0, 1).applyQuaternion(chassisRef.current.quaternion);
    const forward = _planeForward;
    _planeUp.set(0, 1, 0).applyQuaternion(chassisRef.current.quaternion);
    const up = _planeUp;
    _planeRight.set(1, 0, 0).applyQuaternion(chassisRef.current.quaternion);
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
        chassisApi.applyImpulse(
            [forward.x * thrustForce * enginePower.current * dt60, forward.y * thrustForce * enginePower.current * dt60, forward.z * thrustForce * enginePower.current * dt60],
            [0, 0, 0]
        );
    }

    // Torques
    const torqueFactor = 2 * flightModeInfluence * enginePower.current * dt60;
    if (input.forward) chassisApi.applyTorque([right.x * torqueFactor, right.y * torqueFactor, right.z * torqueFactor]);
    if (input.backward) chassisApi.applyTorque([-right.x * torqueFactor, -right.y * torqueFactor, -right.z * torqueFactor]);
    if (input.left) chassisApi.applyTorque([forward.x * torqueFactor * 1.5, forward.y * torqueFactor * 1.5, forward.z * torqueFactor * 1.5]);
    if (input.right) chassisApi.applyTorque([-forward.x * torqueFactor * 1.5, -forward.y * torqueFactor * 1.5, -forward.z * torqueFactor * 1.5]);

    // Yaw (Q/E)
    const yawTorqueFactor = 1.0 * flightModeInfluence * enginePower.current * dt60;
    if (input.yawLeft) chassisApi.applyTorque([up.x * yawTorqueFactor, up.y * yawTorqueFactor, up.z * yawTorqueFactor]);
    if (input.yawRight) chassisApi.applyTorque([-up.x * yawTorqueFactor, -up.y * yawTorqueFactor, -up.z * yawTorqueFactor]);

    // Lift
    const liftForce = Math.min(1.8, currentSpeed * 0.08) * enginePower.current * 20 * 50 * delta; 
    if (liftForce > 0) {
        chassisApi.applyImpulse([up.x * liftForce, up.y * liftForce, up.z * liftForce], [0, 0, 0]);
    }

    // Drag
    const drag = currentSpeed * 0.01 * enginePower.current * dt60;
    chassisApi.applyImpulse([-velVec.x * drag, -velVec.y * drag, -velVec.z * drag], [0, 0, 0]);

    chassisRef.current.getWorldPosition(_planePos);
    const planePos = _planePos;
    _planeEuler.setFromQuaternion(chassisRef.current.quaternion, 'YXZ');
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
    <mesh ref={chassisRef} name={id}>
      <boxGeometry args={chassisArgs} />
      <meshStandardMaterial visible={false} />
      {/* Chassis box half-height is 0.5; the glb's lowest point (the
          landing gear) sits 0.265 below the model's own origin, so
          -0.24 aligns the wheels with the box's bottom face. */}
      <primitive object={clonedScene} position={[0, -0.24, 0]} />
    </mesh>
  );
};

export default Airplane;
