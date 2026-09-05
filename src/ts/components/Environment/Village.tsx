import React, { useMemo } from 'react';
import * as THREE from 'three';
import { RigidBody, CuboidCollider, CylinderCollider } from '@react-three/rapier';
import { getTerrainHeight } from './Terrain';

const House: React.FC<{ x: number, z: number, width: number, depth: number, height: number }> = ({ x, z, width, depth, height }) => {
  const y = getTerrainHeight(x, z);
  const roofHeight = 3;

  return (
    <group>
      {/* Migrated from cannon's useBox({type:'Static', args:[full dims]})
          -- Rapier's CuboidCollider args are half-extents. */}
      <RigidBody type="fixed" colliders={false} position={[x, y + height / 2, z]}>
        <CuboidCollider args={[width / 2, height / 2, depth / 2]} />
        <mesh castShadow receiveShadow>
          <boxGeometry args={[width, height, depth]} />
          <meshStandardMaterial color="#8b4513" />
        </mesh>
      </RigidBody>
      <mesh position={[x, y + height + roofHeight / 2, z]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[Math.max(width, depth) / 1.2, roofHeight, 4]} />
        <meshStandardMaterial color="#a00000" />
      </mesh>
    </group>
  );
};

const Well: React.FC<{ x: number, z: number }> = ({ x, z }) => {
  const y = getTerrainHeight(x, z);
  const radius = 1.5;
  const height = 2;

  return (
    <group>
      {/* Migrated from cannon's useCylinder({type:'Static',
          args:[radiusTop,radiusBottom,height,segments]}) -- Rapier's
          CylinderCollider args are [halfHeight, radius]. */}
      <RigidBody type="fixed" colliders={false} position={[x, y + height / 2, z]}>
        <CylinderCollider args={[height / 2, radius]} />
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[radius, radius, height, 16]} />
          <meshStandardMaterial color="#6e6e6e" />
        </mesh>
      </RigidBody>
      {/* Supports and roof */}
      <mesh position={[x - radius, y + height + 1.5, z]} castShadow>
        <boxGeometry args={[0.2, 3, 0.2]} />
        <meshStandardMaterial color="#8b4513" />
      </mesh>
      <mesh position={[x + radius, y + height + 1.5, z]} castShadow>
        <boxGeometry args={[0.2, 3, 0.2]} />
        <meshStandardMaterial color="#8b4513" />
      </mesh>
      <mesh position={[x, y + height + 3, z]} castShadow>
        <boxGeometry args={[4, 0.2, 2]} />
        <meshStandardMaterial color="#8b4513" />
      </mesh>
    </group>
  );
};

const Village: React.FC = () => {
  const houses = useMemo(() => {
    return [
      { x: 20, z: 20, w: 5, d: 5, h: 6 },
      { x: -20, z: 25, w: 6, d: 4, h: 7 },
      { x: 30, z: -15, w: 4, d: 6, h: 5 },
      { x: -25, z: -25, w: 7, d: 7, h: 8 },
      { x: 10, z: 40, w: 5, d: 5, h: 6 },
    ];
  }, []);

  return (
    <group>
      {houses.map((h, i) => (
        <House key={i} x={h.x} z={h.z} width={h.w} depth={h.d} height={h.h} />
      ))}
      <Well x={0} z={20} />
    </group>
  );
};

export default Village;
