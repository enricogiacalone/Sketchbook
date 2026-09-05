import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useBox } from '@react-three/cannon';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useInput } from '../../hooks/useInput';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';

interface HelicopterProps {
  position?: [number, number, number];
  id?: string;
}

const _heliUp = new THREE.Vector3();
const _heliGlobalUp = new THREE.Vector3(0, 1, 0);
const _heliRight = new THREE.Vector3();
const _heliForward = new THREE.Vector3();
const _heliRotStabQuat = new THREE.Quaternion();
const _heliRotStabEuler = new THREE.Euler();
const _heliVertStab = new THREE.Vector3();
const _heliPos = new THREE.Vector3();
const _heliEuler = new THREE.Euler();

const Helicopter: React.FC<HelicopterProps> = ({ position = [-15, 20, 15], id = 'heli-1' }) => {
  const { scene } = useGLTF('heli.glb');
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

  const chassisArgs: [number, number, number] = [1.2, 1.5, 4];
  const [ref, api] = useBox<THREE.Mesh>(() => ({
    mass: 50,
    position: position,
    args: chassisArgs,
    collisionFilterGroup: 1, // Default
    collisionFilterMask: -1, // Collide with everything
  }));

  const velocity = useRef([0, 0, 0]);
  const angularVelocity = useRef([0, 0, 0]);
  useEffect(() => {
    const unsubVel = api.velocity.subscribe((v) => (velocity.current = v));
    const unsubAngVel = api.angularVelocity.subscribe((av) => (angularVelocity.current = av));
    const unsubPos = api.position.subscribe((p) => {
        if (p) {
            updateEntity(id, { 
                type: 'helicopter', 
                position: p as [number, number, number] 
            });
            setReady(true);
        }
    });
    return () => { unsubVel(); unsubAngVel(); unsubPos(); };
  }, [api, updateEntity, id]);

  const enginePower = useRef(0);
  const rotorsRef = useRef<THREE.Object3D[]>([]);

  useEffect(() => {
    if (scene) {
      const rotors: THREE.Object3D[] = [];
      scene.traverse((child) => {
        if (child.userData.data === 'rotor') rotors.push(child);
      });
      rotorsRef.current = rotors;
    }
  }, [scene]);

  useFrame((state, delta) => {
    const isHeliActive = currentControllable === 'helicopter' && controlledEntityId === id && !isVehicleTransitioning;

    if (!ready || !isHeliActive || !ref.current) {
      if (enginePower.current > 0) enginePower.current = Math.max(0, enginePower.current - delta * 0.06);
      return;
    }

    if (enginePower.current < 1) enginePower.current = Math.min(1, enginePower.current + delta * 0.2);

    for (let i = 0; i < rotorsRef.current.length; i++) {
      rotorsRef.current[i].rotateX(enginePower.current * delta * 30);
    }

    const quat = ref.current.quaternion;
    _heliUp.set(0, 1, 0).applyQuaternion(quat);
    const up = _heliUp;
    const globalUp = _heliGlobalUp;
    _heliRight.set(1, 0, 0).applyQuaternion(quat);
    const right = _heliRight;
    _heliForward.set(0, 0, 1).applyQuaternion(quat);
    const forward = _heliForward;

    // Throttle and the pitch/roll torques below are fixed impulses applied
    // once per RENDERED frame with no time scaling -- so, like the car and
    // airplane, their actual per-second effect depended entirely on the
    // display's refresh rate. dt60 renormalizes to the tuning's implicit
    // 60fps baseline (dt60 == 1 at exactly 60fps). The gravity-compensation
    // impulse below already does its own delta scaling and is left alone.
    // Clamped so a dropped/backgrounded frame (a big one-off `delta`)
    // can't fling the helicopter with a single huge impulse -- caps the
    // renormalization at 3x the 60fps baseline instead of following an
    // arbitrarily large delta.
    const dt60 = Math.min(delta * 60, 3);

    // 1. Throttle (Ascend/Descend)
    const throttleFactor = 15 * enginePower.current * dt60;
    if (input.shift) {
        api.applyImpulse([up.x * throttleFactor, up.y * throttleFactor, up.z * throttleFactor], [0, 0, 0]);
    }
    if (input.jump) {
        api.applyImpulse([-up.x * throttleFactor, -up.y * throttleFactor, -up.z * throttleFactor], [0, 0, 0]);
    }

    // 2. Vertical Stabilization (Gravity compensation)
    const gravity = 20;
    let gravityCompensation = gravity * 50 * delta * 0.98;
    const dot = globalUp.dot(up);
    gravityCompensation *= Math.sqrt(THREE.MathUtils.clamp(dot, 0, 1));
    
    _heliVertStab.copy(up).multiplyScalar(gravityCompensation * enginePower.current);
    api.applyImpulse([_heliVertStab.x, _heliVertStab.y, _heliVertStab.z], [0, 0, 0]);

    // 3. Positional Damping
    const damping = 1 - (0.005 * enginePower.current);
    api.velocity.set(velocity.current[0] * damping, velocity.current[1], velocity.current[2] * damping);

    // 4. Rotation Stabilization & Yaw
    _heliRotStabQuat.setFromUnitVectors(up, globalUp);
    _heliRotStabEuler.setFromQuaternion(_heliRotStabQuat);

    let yawSpeed = 0;
    if (input.yawLeft) yawSpeed = 1.8 * enginePower.current;
    if (input.yawRight) yawSpeed = -1.8 * enginePower.current;

    api.angularVelocity.set(
        angularVelocity.current[0] * 0.95 + _heliRotStabEuler.x * enginePower.current * 2.0,
        angularVelocity.current[1] * 0.95 + yawSpeed,
        angularVelocity.current[2] * 0.95 + _heliRotStabEuler.z * enginePower.current * 2.0
    );

    // 5. Controls (Torques)
    const torqueFactor = 3.5 * enginePower.current * dt60;
    // Pitch (W/S)
    if (input.forward) api.applyTorque([right.x * torqueFactor, right.y * torqueFactor, right.z * torqueFactor]);
    if (input.backward) api.applyTorque([-right.x * torqueFactor, -right.y * torqueFactor, -right.z * torqueFactor]);

    // Roll (A/D)
    if (input.left) api.applyTorque([forward.x * torqueFactor, forward.y * torqueFactor, forward.z * torqueFactor]);
    if (input.right) api.applyTorque([-forward.x * torqueFactor, -forward.y * torqueFactor, -forward.z * torqueFactor]);

    ref.current.getWorldPosition(_heliPos);
    const heliPos = _heliPos;
    _heliEuler.setFromQuaternion(quat, 'YXZ');
    const heliEuler = _heliEuler;

    // Update player info so camera/minimap follow the helicopter
    setPlayerInfo([heliPos.x, heliPos.y, heliPos.z], heliEuler.y);

    if (state.clock.getElapsedTime() % 0.1 < 0.02) {
      updateEntity(id, {
        type: 'helicopter',
        position: [heliPos.x, heliPos.y, heliPos.z],
        rotation: heliEuler.y
      });
    }
  });

  return (
    <mesh ref={ref} name={id}>
        <boxGeometry args={chassisArgs} />
        <meshStandardMaterial visible={false} />
        {/* Chassis box half-height is 0.75; the glb's lowest point sits
            0.673 below the model's own origin, so -0.08 aligns it with
            the box's bottom face. */}
        <primitive object={clonedScene} position={[0, -0.08, 0]} />
    </mesh>
  );
};

export default Helicopter;
