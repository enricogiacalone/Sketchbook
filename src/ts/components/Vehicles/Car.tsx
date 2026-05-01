import React, { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useBox } from '@react-three/cannon';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useInput } from '../../hooks/useInput';
import { useStore } from '../../store';

const Car: React.FC = () => {
  const { scene } = useGLTF('car.glb');
  const clonedScene = useMemo(() => {
    const s = scene.clone();
    s.traverse((child) => {
      // Hide all wheel models as requested
      if (child.userData.data === 'wheel' || child.name.toLowerCase().includes('wheel')) {
        child.visible = false;
      }
    });
    return s;
  }, [scene]);
  
  const input = useInput();
  const { currentControllable, setCurrentControllable, updateEntity } = useStore();
  const [isReady, setIsReady] = useState(false);

  const chassisArgs: [number, number, number] = [1.2, 0.7, 3];

  // Chassis Body - Now the ONLY physical body for the car
  const [chassisRef, chassisApi] = useBox<THREE.Mesh>(() => ({
    allowSleep: false,
    args: chassisArgs,
    mass: 150,
    position: [10, 15, 0],
    linearDamping: 0.5,
    angularDamping: 0.5,
    collisionFilterGroup: 1, // Default
    collisionFilterMask: -1, // Collide with everything
  }));

  const velocity = useRef([0, 0, 0]);
  useEffect(() => {
    const unsubVel = chassisApi.velocity.subscribe(v => velocity.current = v);
    const unsubPos = chassisApi.position.subscribe((p) => {
      if (p) {
        updateEntity('car-1', { 
          type: 'car', 
          position: p as [number, number, number] 
        });
        setIsReady(true);
      }
    });
    return () => { unsubVel(); unsubPos(); };
  }, [chassisApi, updateEntity]);

  useFrame((state, delta) => {
    if (!isReady || currentControllable !== 'car' || !chassisRef.current) return;

    const moveSpeed = 30;
    const turnSpeed = 2;
    
    const quat = chassisRef.current.quaternion;
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);

    // Simple movement logic without wheels
    if (input.forward) {
        chassisApi.applyImpulse([forward.x * moveSpeed, forward.y * moveSpeed, forward.z * moveSpeed], [0, 0, 0]);
    }
    if (input.backward) {
        chassisApi.applyImpulse([-forward.x * moveSpeed, -forward.y * moveSpeed, -forward.z * moveSpeed], [0, 0, 0]);
    }

    if (input.left) {
        chassisApi.applyTorque([0, turnSpeed * 50, 0]);
    }
    if (input.right) {
        chassisApi.applyTorque([0, -turnSpeed * 50, 0]);
    }

    // Dampen rotation when not turning
    if (!input.left && !input.right) {
        chassisApi.angularVelocity.set(0, 0, 0);
    }

    if (input.consumeJustPressed('enter')) setCurrentControllable('player');
  });

  return (
    <mesh ref={chassisRef}>
      <boxGeometry args={chassisArgs} />
      <meshStandardMaterial visible={false} />
      <primitive object={clonedScene} position={[0, -0.4, 0]} />
    </mesh>
  );
};

export default Car;
