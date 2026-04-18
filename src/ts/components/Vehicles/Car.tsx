import React, { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useBox, useRaycastVehicle } from '@react-three/cannon';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useInput } from '../../hooks/useInput';
import { useStore } from '../../store';

const Car: React.FC = () => {
  const { scene } = useGLTF('car.glb');
  const input = useInput();
  const { currentControllable, setCurrentControllable } = useStore();
  const [isReady, setIsReady] = useState(false);

  const chassisArgs: [number, number, number] = [1.2, 0.7, 3];
  const wheelRadius = 0.35;

  // Chassis Body
  const [chassisRef, chassisApi] = useBox<THREE.Mesh>(() => ({
    allowSleep: false,
    args: chassisArgs,
    mass: 150, // Più pesante per stabilità
    position: [10, 15, 0],
    collisionFilterGroup: 1,
  }));

  // Wheel Refs - Creati con useRef in modo stabile
  const w1 = useRef<THREE.Mesh>(null);
  const w2 = useRef<THREE.Mesh>(null);
  const w3 = useRef<THREE.Mesh>(null);
  const w4 = useRef<THREE.Mesh>(null);
  const wheelRefs = useMemo(() => [w1, w2, w3, w4], []);

  const wheelInfos = useMemo(() => {
    const common = { 
        radius: wheelRadius, 
        directionLocal: [0, -1, 0], 
        suspensionStiffness: 30, 
        suspensionRestLength: 0.3, 
        axleLocal: [-1, 0, 0], 
        frictionSlip: 5, 
        dampingRelaxation: 2.3, 
        dampingCompression: 4.4,
        maxSuspensionForce: 100000,
        rollInfluence: 0.01
    };
    return [
        { ...common, chassisConnectionPointLocal: [-0.75, -0.1, 1.2] },
        { ...common, chassisConnectionPointLocal: [0.75, -0.1, 1.2] },
        { ...common, chassisConnectionPointLocal: [-0.75, -0.1, -1.2] },
        { ...common, chassisConnectionPointLocal: [0.75, -0.1, -1.2] },
    ];
  }, []);

  const [vehicleRef, vehicleApi] = useRaycastVehicle<THREE.Group>(() => ({
    chassisBody: chassisRef,
    wheelInfos,
    wheels: wheelRefs as any,
  }));

  useEffect(() => {
    const unsub = chassisApi.position.subscribe(() => setIsReady(true));
    return unsub;
  }, [chassisApi]);

  useFrame(() => {
    if (!isReady || currentControllable !== 'car') return;

    const engineForce = 1500;
    const steerValue = 0.5;

    // Steering
    if (input.left) {
        vehicleApi.setSteeringValue(steerValue, 0);
        vehicleApi.setSteeringValue(steerValue, 1);
    } else if (input.right) {
        vehicleApi.setSteeringValue(-steerValue, 0);
        vehicleApi.setSteeringValue(-steerValue, 1);
    } else {
        vehicleApi.setSteeringValue(0, 0);
        vehicleApi.setSteeringValue(0, 1);
    }

    // Engine
    if (input.forward) {
        vehicleApi.applyEngineForce(-engineForce, 2);
        vehicleApi.applyEngineForce(-engineForce, 3);
    } else if (input.backward) {
        vehicleApi.applyEngineForce(engineForce, 2);
        vehicleApi.applyEngineForce(engineForce, 3);
    } else {
        vehicleApi.applyEngineForce(0, 2);
        vehicleApi.applyEngineForce(0, 3);
    }

    if (input.jump) {
        for(let i=0; i<4; i++) vehicleApi.setBrake(20, i);
    } else {
        for(let i=0; i<4; i++) vehicleApi.setBrake(0, i);
    }

    if (input.enter) setCurrentControllable('player');
  });

  return (
    <group ref={vehicleRef}>
      <mesh ref={chassisRef}>
        <boxGeometry args={chassisArgs} />
        <meshStandardMaterial visible={false} />
        <primitive object={scene} position={[0, -0.4, 0]} />
      </mesh>
      {wheelRefs.map((ref, i) => (
        <mesh ref={ref as any} key={i}>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[wheelRadius, wheelRadius, 0.2, 16]} />
            <meshStandardMaterial color="#222" />
          </mesh>
        </mesh>
      ))}
    </group>
  );
};

export default Car;
