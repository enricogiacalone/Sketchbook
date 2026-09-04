import React, { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useBox } from '@react-three/cannon';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useInput } from '../../hooks/useInput';
import { useStore } from '../../store';

interface CarProps {
  position?: [number, number, number];
  id?: string;
}

const Car: React.FC<CarProps> = ({ position = [10, 5, 0], id = 'car-1' }) => {
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
  const { currentControllable, controlledEntityId, setCurrentControllable, updateEntity, setPlayerInfo } = useStore();
  const [isReady, setIsReady] = useState(false);

  const chassisArgs: [number, number, number] = [1.2, 0.7, 3];

  // Chassis Body - Now the ONLY physical body for the car
  const [chassisRef, chassisApi] = useBox<THREE.Mesh>(() => ({
    allowSleep: false,
    args: chassisArgs,
    mass: 150,
    position: position,
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
        updateEntity(id, { 
          type: 'car', 
          position: p as [number, number, number] 
        });
        setIsReady(true);
      }
    });
    return () => { unsubVel(); unsubPos(); };
  }, [chassisApi, updateEntity, id]);

  const prevControllable = useRef(currentControllable);

  useFrame((state, delta) => {
    const isCarActive = currentControllable === 'car' && controlledEntityId === id;
    const wasCarActive = prevControllable.current === 'car' && controlledEntityId === id;
    prevControllable.current = currentControllable;

    if (!isReady || !isCarActive || !chassisRef.current) return;

    const moveSpeed = 45;
    const turnSpeed = 2.5;
    
    const quat = chassisRef.current.quaternion;
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);

    // Dampen lateral (sideways) velocity to simulate tire grip
    const velVec = new THREE.Vector3(...velocity.current);
    const lateralSpeed = velVec.dot(right);
    const lateralCorrection = right.clone().multiplyScalar(-lateralSpeed * 0.92);
    // Car mass is 150
    chassisApi.applyImpulse([lateralCorrection.x * 150, lateralCorrection.y * 150, lateralCorrection.z * 150], [0, 0, 0]);

    // Simple movement logic without wheels
    if (input.forward) {
        chassisApi.applyImpulse([forward.x * moveSpeed, forward.y * moveSpeed, forward.z * moveSpeed], [0, 0, 0]);
    }
    if (input.backward) {
        chassisApi.applyImpulse([-forward.x * moveSpeed, -forward.y * moveSpeed, -forward.z * moveSpeed], [0, 0, 0]);
    }

    if (input.left) {
        chassisApi.applyTorque([0, turnSpeed * 65, 0]);
    }
    if (input.right) {
        chassisApi.applyTorque([0, -turnSpeed * 65, 0]);
    }

    // Dampen rotation when not turning
    if (!input.left && !input.right) {
        chassisApi.angularVelocity.set(0, 0, 0);
    }

    const carPos = new THREE.Vector3();
    chassisRef.current.getWorldPosition(carPos);
    const carEuler = new THREE.Euler().setFromQuaternion(quat, 'YXZ');
    
    // Update player info so camera/minimap follow the car
    setPlayerInfo([carPos.x, carPos.y, carPos.z], carEuler.y);

    if (state.clock.getElapsedTime() % 0.1 < 0.02) {
      updateEntity(id, {
        type: 'car',
        position: [carPos.x, carPos.y, carPos.z],
        rotation: carEuler.y
      });
    }

    if (wasCarActive && input.consumeJustPressed('enter')) setCurrentControllable('player');
  });

  return (
    <mesh ref={chassisRef} name={id}>
      <boxGeometry args={chassisArgs} />
      <meshStandardMaterial visible={false} />
      <primitive object={clonedScene} position={[0, -0.4, 0]} />
    </mesh>
  );
};

export default Car;
