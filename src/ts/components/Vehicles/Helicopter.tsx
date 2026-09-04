import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useBox } from '@react-three/cannon';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useInput } from '../../hooks/useInput';
import { useStore } from '../../store';

interface HelicopterProps {
  position?: [number, number, number];
  id?: string;
}

const Helicopter: React.FC<HelicopterProps> = ({ position = [-15, 20, 15], id = 'heli-1' }) => {
  const { scene } = useGLTF('heli.glb');
  const clonedScene = useMemo(() => scene.clone(), [scene]);
  const input = useInput();
  const { currentControllable, controlledEntityId, setCurrentControllable, updateEntity, setPlayerInfo } = useStore();
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

  const [enginePower, setEnginePower] = useState(0);
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

  const prevControllable = useRef(currentControllable);

  useFrame((state, delta) => {
    const isHeliActive = currentControllable === 'helicopter' && controlledEntityId === id;
    const wasHeliActive = prevControllable.current === 'helicopter' && controlledEntityId === id;
    prevControllable.current = currentControllable;

    if (!ready || !isHeliActive || !ref.current) {
      if (enginePower > 0) setEnginePower(prev => Math.max(0, prev - delta * 0.06));
      return;
    }

    if (enginePower < 1) setEnginePower(prev => Math.min(1, prev + delta * 0.2));

    rotorsRef.current.forEach(rotor => {
        rotor.rotateX(enginePower * delta * 30);
    });

    const quat = ref.current.quaternion;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
    const globalUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);

    // 1. Throttle (Ascend/Descend)
    const throttleFactor = 15 * enginePower;
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
    
    const vertStab = up.clone().multiplyScalar(gravityCompensation * enginePower);
    api.applyImpulse([vertStab.x, vertStab.y, vertStab.z], [0, 0, 0]);

    // 3. Positional Damping
    const damping = 1 - (0.005 * enginePower);
    api.velocity.set(velocity.current[0] * damping, velocity.current[1], velocity.current[2] * damping);

    // 4. Rotation Stabilization & Yaw
    const rotStabQuat = new THREE.Quaternion().setFromUnitVectors(up, globalUp);
    const rotStabEuler = new THREE.Euler().setFromQuaternion(rotStabQuat);
    
    let yawSpeed = 0;
    if (input.yawLeft) yawSpeed = 1.8 * enginePower;
    if (input.yawRight) yawSpeed = -1.8 * enginePower;

    api.angularVelocity.set(
        angularVelocity.current[0] * 0.95 + rotStabEuler.x * enginePower * 2.0,
        angularVelocity.current[1] * 0.95 + yawSpeed,
        angularVelocity.current[2] * 0.95 + rotStabEuler.z * enginePower * 2.0
    );

    // 5. Controls (Torques)
    const torqueFactor = 3.5 * enginePower;
    // Pitch (W/S)
    if (input.forward) api.applyTorque([right.x * torqueFactor, right.y * torqueFactor, right.z * torqueFactor]);
    if (input.backward) api.applyTorque([-right.x * torqueFactor, -right.y * torqueFactor, -right.z * torqueFactor]);

    // Roll (A/D)
    if (input.left) api.applyTorque([forward.x * torqueFactor, forward.y * torqueFactor, forward.z * torqueFactor]);
    if (input.right) api.applyTorque([-forward.x * torqueFactor, -forward.y * torqueFactor, -forward.z * torqueFactor]);

    const heliPos = new THREE.Vector3();
    ref.current.getWorldPosition(heliPos);
    const heliEuler = new THREE.Euler().setFromQuaternion(quat, 'YXZ');
    
    // Update player info so camera/minimap follow the helicopter
    setPlayerInfo([heliPos.x, heliPos.y, heliPos.z], heliEuler.y);

    if (state.clock.getElapsedTime() % 0.1 < 0.02) {
      updateEntity(id, {
        type: 'helicopter',
        position: [heliPos.x, heliPos.y, heliPos.z],
        rotation: heliEuler.y
      });
    }

    if (wasHeliActive && input.consumeJustPressed('enter')) {
        setCurrentControllable('player');
    }
  });

  return (
    <mesh ref={ref} name={id}>
        <boxGeometry args={chassisArgs} />
        <meshStandardMaterial visible={false} />
        <primitive object={clonedScene} position={[0, -0.5, 0]} />
    </mesh>
  );
};

export default Helicopter;
