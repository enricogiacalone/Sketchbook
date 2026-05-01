import React, { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useBox } from '@react-three/cannon';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useInput } from '../../hooks/useInput';
import { useStore } from '../../store';

const Airplane: React.FC = () => {
  const { scene } = useGLTF('airplane.glb');
  const clonedScene = useMemo(() => scene.clone(), [scene]);
  const input = useInput();
  const { currentControllable, setCurrentControllable, updateEntity } = useStore();
  const [ready, setReady] = useState(false);

  const chassisArgs: [number, number, number] = [1.5, 1, 4];
  
  const [chassisRef, chassisApi] = useBox<THREE.Mesh>(() => ({
    allowSleep: false,
    args: chassisArgs,
    mass: 50,
    position: [-10, 15, -10],
    collisionFilterGroup: 1, // Default
    collisionFilterMask: -1, // Collide with everything
  }));

  const velocity = useRef([0, 0, 0]);
  useEffect(() => {
    const unsubVel = chassisApi.velocity.subscribe((v) => (velocity.current = v));
    const unsubPos = chassisApi.position.subscribe((p) => {
        if (p) {
            updateEntity('airplane-1', { 
                type: 'airplane', 
                position: p as [number, number, number] 
            });
            setReady(true);
        }
    });
    return () => { unsubVel(); unsubPos(); };
  }, [chassisApi, updateEntity]);

  const [enginePower, setEnginePower] = useState(0);
  const rotorRef = useRef<THREE.Object3D>();

  useEffect(() => {
    if (scene) {
      scene.traverse((child) => {
        if (child.userData.data === 'rotor') rotorRef.current = child;
      });
    }
  }, [scene]);

  useFrame((state, delta) => {
    if (!ready || currentControllable !== 'airplane' || !chassisRef.current) {
      if (enginePower > 0) setEnginePower(prev => Math.max(0, prev - delta * 0.12));
      return;
    }

    if (enginePower < 1) setEnginePower(prev => Math.min(1, prev + delta * 0.4));

    if (rotorRef.current) {
        rotorRef.current.rotateX(enginePower * delta * 60);
    }

    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(chassisRef.current.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(chassisRef.current.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(chassisRef.current.quaternion);

    const velVec = new THREE.Vector3(...velocity.current);
    const currentSpeed = velVec.dot(forward);
    const flightModeInfluence = THREE.MathUtils.clamp(currentSpeed / 10, 0, 1);

    // Thrust
    let thrustForce = 0;
    if (input.shift) thrustForce = 15; 
    else if (input.jump) thrustForce = -10; 
    
    if (enginePower > 0.1) {
        chassisApi.applyImpulse(
            [forward.x * thrustForce * enginePower, forward.y * thrustForce * enginePower, forward.z * thrustForce * enginePower],
            [0, 0, 0]
        );
    }

    // Torques
    const torqueFactor = 2 * flightModeInfluence * enginePower;
    if (input.forward) chassisApi.applyTorque([right.x * torqueFactor, right.y * torqueFactor, right.z * torqueFactor]);
    if (input.backward) chassisApi.applyTorque([-right.x * torqueFactor, -right.y * torqueFactor, -right.z * torqueFactor]);
    if (input.left) chassisApi.applyTorque([forward.x * torqueFactor * 1.5, forward.y * torqueFactor * 1.5, forward.z * torqueFactor * 1.5]);
    if (input.right) chassisApi.applyTorque([-forward.x * torqueFactor * 1.5, -forward.y * torqueFactor * 1.5, -forward.z * torqueFactor * 1.5]);

    // Lift
    const lift = Math.min(0.5, currentSpeed * 0.05) * enginePower;
    if (lift > 0) {
        chassisApi.applyImpulse([up.x * lift, up.y * lift, up.z * lift], [0, 0, 0]);
    }

    // Drag
    const drag = currentSpeed * 0.01 * enginePower;
    chassisApi.applyImpulse([-velVec.x * drag, -velVec.y * drag, -velVec.z * drag], [0, 0, 0]);

    if (input.consumeJustPressed('enter')) {
        setCurrentControllable('player');
    }
  });

  return (
    <mesh ref={chassisRef}>
      <boxGeometry args={chassisArgs} />
      <meshStandardMaterial visible={false} />
      <primitive object={clonedScene} position={[0, -0.5, 0]} />
    </mesh>
  );
};

export default Airplane;
