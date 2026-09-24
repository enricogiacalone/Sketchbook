import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RigidBody, RapierRigidBody, CuboidCollider, CylinderCollider, BallCollider, interactionGroups } from '@react-three/rapier';
import { CollisionGroups } from '../../enums/CollisionGroups';
import { getTerrainHeight } from './Terrain';

const SOLID_BODY_GROUPS = interactionGroups([CollisionGroups.Characters], [CollisionGroups.Characters]);

export const ArenaObstacles: React.FC = () => {
  const pendulum1Ref = useRef<RapierRigidBody>(null);
  const pendulum2Ref = useRef<RapierRigidBody>(null);
  const spinnerRef = useRef<RapierRigidBody>(null);
  const piston1Ref = useRef<RapierRigidBody>(null);
  const piston2Ref = useRef<RapierRigidBody>(null);

  const timeRef = useRef(0);

  useFrame((state, delta) => {
    timeRef.current += delta;
    const t = timeRef.current;

    // 1. Swinging Pendulum 1 (oscillating rotation around Z axis)
    if (pendulum1Ref.current) {
      const angle = Math.sin(t * 2.5) * 1.2;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
      pendulum1Ref.current.setNextKinematicRotation(q);
    }

    // 2. Swinging Pendulum 2 (oscillating rotation around X axis)
    if (pendulum2Ref.current) {
      const angle = Math.sin(t * 2.0 + 1.5) * 1.4;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
      pendulum2Ref.current.setNextKinematicRotation(q);
    }

    // 3. Rotating Spinner (spinning 360 deg around Y axis)
    if (spinnerRef.current) {
      const rotY = t * 3.0;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      spinnerRef.current.setNextKinematicRotation(q);
    }

    // 4. Spring Punches / Pistons (extending and retracting periodically)
    if (piston1Ref.current) {
      const cycle = (Math.sin(t * 4.0) + 1) * 0.5; // 0 to 1
      const offsetZ = -4.0 - cycle * 3.0;
      const tPos = piston1Ref.current.translation();
      piston1Ref.current.setNextKinematicTranslation({ x: tPos.x, y: tPos.y, z: offsetZ });
    }

    if (piston2Ref.current) {
      const cycle = (Math.sin(t * 3.5 + 2.0) + 1) * 0.5;
      const offsetX = 5.0 + cycle * 3.0;
      const tPos = piston2Ref.current.translation();
      piston2Ref.current.setNextKinematicTranslation({ x: offsetX, y: tPos.y, z: tPos.z });
    }
  });

  const groundY = getTerrainHeight(0, 0);

  return (
    <group position={[0, groundY, 0]}>
      {/* --- Ostacolo Oscillante 1 (Pendolo con mazza pesante) --- */}
      <group position={[0, 4.5, -5]}>
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[0.4, 0.4, 0.4]} />
          <meshStandardMaterial color="#333333" metalness={0.8} roughness={0.2} />
        </mesh>
        <RigidBody ref={pendulum1Ref} type="kinematicPosition" colliders={false} collisionGroups={SOLID_BODY_GROUPS}>
          <mesh position={[0, -1.5, 0]}>
            <cylinderGeometry args={[0.1, 0.1, 3.0, 12]} />
            <meshStandardMaterial color="#eab308" metalness={0.6} roughness={0.3} />
          </mesh>
          <CuboidCollider args={[0.15, 1.5, 0.15]} position={[0, -1.5, 0]} />
          <mesh position={[0, -3.0, 0]}>
            <boxGeometry args={[1.2, 0.8, 1.2]} />
            <meshStandardMaterial color="#dc2626" metalness={0.5} roughness={0.4} />
          </mesh>
          <CuboidCollider args={[0.6, 0.4, 0.6]} position={[0, -3.0, 0]} />
        </RigidBody>
      </group>

      {/* --- Ostacolo Oscillante 2 (Pendolo con sfera) --- */}
      <group position={[-6, 5.0, 0]}>
        <RigidBody ref={pendulum2Ref} type="kinematicPosition" colliders={false} collisionGroups={SOLID_BODY_GROUPS}>
          <mesh position={[0, -1.8, 0]}>
            <cylinderGeometry args={[0.12, 0.12, 3.5, 12]} />
            <meshStandardMaterial color="#3b82f6" metalness={0.6} roughness={0.3} />
          </mesh>
          <CuboidCollider args={[0.18, 1.75, 0.18]} position={[0, -1.8, 0]} />
          <mesh position={[0, -3.5, 0]}>
            <sphereGeometry args={[0.8, 16, 16]} />
            <meshStandardMaterial color="#9333ea" metalness={0.7} roughness={0.3} />
          </mesh>
          <BallCollider args={[0.8]} position={[0, -3.5, 0]} />
        </RigidBody>
      </group>

      {/* --- Pale Rotanti (Spinner a croce sul terreno) --- */}
      <group position={[0, 0.6, 5]}>
        <RigidBody ref={spinnerRef} type="kinematicPosition" colliders={false} collisionGroups={SOLID_BODY_GROUPS}>
          <mesh position={[0, 0, 0]}>
            <cylinderGeometry args={[0.6, 0.6, 1.2, 16]} />
            <meshStandardMaterial color="#1f2937" metalness={0.9} roughness={0.1} />
          </mesh>
          <CylinderCollider args={[0.6, 0.6]} position={[0, 0, 0]} />
          <mesh position={[2.5, 0, 0]}>
            <boxGeometry args={[4.5, 0.5, 0.8]} />
            <meshStandardMaterial color="#f97316" metalness={0.8} roughness={0.2} />
          </mesh>
          <CuboidCollider args={[2.25, 0.25, 0.4]} position={[2.5, 0, 0]} />
          <mesh position={[-2.5, 0, 0]}>
            <boxGeometry args={[4.5, 0.5, 0.8]} />
            <meshStandardMaterial color="#f97316" metalness={0.8} roughness={0.2} />
          </mesh>
          <CuboidCollider args={[2.25, 0.25, 0.4]} position={[-2.5, 0, 0]} />
        </RigidBody>
      </group>

      {/* --- Pugni a Molla / Pistoni da parete (Spring Punches) --- */}
      <group position={[0, 1.2, 0]}>
        <RigidBody ref={piston1Ref} type="kinematicPosition" colliders={false} collisionGroups={SOLID_BODY_GROUPS}>
          <mesh>
            <boxGeometry args={[1.0, 1.0, 2.0]} />
            <meshStandardMaterial color="#e11d48" metalness={0.5} roughness={0.3} />
          </mesh>
          <CuboidCollider args={[0.5, 0.5, 1.0]} />
          <mesh position={[0, 0, -1.1]}>
            <sphereGeometry args={[0.6, 16, 16]} />
            <meshStandardMaterial color="#ffffff" roughness={0.2} />
          </mesh>
          <BallCollider args={[0.6]} position={[0, 0, -1.1]} />
        </RigidBody>

        <RigidBody ref={piston2Ref} type="kinematicPosition" colliders={false} collisionGroups={SOLID_BODY_GROUPS}>
          <mesh>
            <boxGeometry args={[2.0, 1.0, 1.0]} />
            <meshStandardMaterial color="#0284c7" metalness={0.5} roughness={0.3} />
          </mesh>
          <CuboidCollider args={[1.0, 0.5, 0.5]} />
          <mesh position={[-1.1, 0, 0]}>
            <sphereGeometry args={[0.6, 16, 16]} />
            <meshStandardMaterial color="#facc15" roughness={0.2} />
          </mesh>
          <BallCollider args={[0.6]} position={[-1.1, 0, 0]} />
        </RigidBody>
      </group>
    </group>
  );
};

export default ArenaObstacles;
