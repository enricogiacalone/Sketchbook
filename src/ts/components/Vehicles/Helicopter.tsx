import React, { useRef, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useBox } from '@react-three/cannon';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useInput } from '../../hooks/useInput';
import { useStore } from '../../store';

const Helicopter: React.FC = () => {
  const { scene } = useGLTF('heli.glb');
  const input = useInput();
  const { currentControllable, setCurrentControllable } = useStore();
  const [ready, setReady] = useState(false);

  const chassisArgs: [number, number, number] = [1.2, 1.5, 4];
  const [ref, api] = useBox<THREE.Mesh>(() => ({
    mass: 50,
    position: [-15, 20, 15],
    args: chassisArgs,
    collisionFilterGroup: 1,
  }));

  const velocity = useRef([0, 0, 0]);
  useEffect(() => {
    const unsubVel = api.velocity.subscribe((v) => (velocity.current = v));
    const unsubPos = api.position.subscribe(() => setReady(true));
    return () => { unsubVel(); unsubPos(); };
  }, [api]);

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

  useFrame((state, delta) => {
    if (!ready || currentControllable !== 'helicopter' || !ref.current) {
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
    const throttleFactor = 7.5 * enginePower;
    if (input.shift) {
        api.applyImpulse([up.x * throttleFactor, up.y * throttleFactor, up.z * throttleFactor], [0, 0, 0]);
    }
    if (input.jump) {
        api.applyImpulse([-up.x * throttleFactor, -up.y * throttleFactor, -up.z * throttleFactor], [0, 0, 0]);
    }

    // 2. Vertical Stabilization (Gravity compensation)
    const gravity = 9.81;
    let gravityCompensation = gravity * 50 * delta * 0.98;
    const dot = globalUp.dot(up);
    gravityCompensation *= Math.sqrt(THREE.MathUtils.clamp(dot, 0, 1));
    
    const vertStab = up.clone().multiplyScalar(gravityCompensation * enginePower);
    api.applyImpulse([vertStab.x, vertStab.y, vertStab.z], [0, 0, 0]);

    // 3. Positional Damping
    const damping = 1 - (0.005 * enginePower);
    api.velocity.set(velocity.current[0] * damping, velocity.current[1], velocity.current[2] * damping);

    // 4. Rotation Stabilization
    const rotStabQuat = new THREE.Quaternion().setFromUnitVectors(up, globalUp);
    const rotStabEuler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(
        rotStabQuat.x * 0.3, rotStabQuat.y * 0.3, rotStabQuat.z * 0.3, rotStabQuat.w * 0.3
    ));
    api.angularVelocity.set(
        velocity.current[0] * 0.97 + rotStabEuler.x * enginePower,
        velocity.current[1] * 0.97 + rotStabEuler.y * enginePower,
        velocity.current[2] * 0.97 + rotStabEuler.z * enginePower
    );

    // 5. Controls (Torques)
    const torqueFactor = 3.5 * enginePower;
    // Pitch (W/S)
    if (input.forward) api.applyTorque([right.x * torqueFactor, right.y * torqueFactor, right.z * torqueFactor]);
    if (input.backward) api.applyTorque([-right.x * torqueFactor, -right.y * torqueFactor, -right.z * torqueFactor]);

    // Roll (A/D)
    if (input.left) api.applyTorque([forward.x * torqueFactor, forward.y * torqueFactor, forward.z * torqueFactor]);
    if (input.right) api.applyTorque([-forward.x * torqueFactor, -forward.y * torqueFactor, -forward.z * torqueFactor]);

    if (input.enter) {
        setCurrentControllable('player');
    }
  });

  return (
    <mesh ref={ref}>
        <boxGeometry args={chassisArgs} />
        <meshStandardMaterial visible={false} />
        <primitive object={scene} position={[0, -0.5, 0]} />
    </mesh>
  );
};

export default Helicopter;
