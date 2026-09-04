import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useBox } from '@react-three/cannon';
import { getTerrainHeight } from './Terrain';

const Building: React.FC<{ x: number, z: number, width: number, depth: number, height: number, color: string }> = ({ x, z, width, depth, height, color }) => {
  const y = getTerrainHeight(x, z);

  const [ref] = useBox<THREE.Mesh>(() => ({
    type: 'Static',
    args: [width, height, depth],
    position: [x, y + height / 2, z],
  }));

  return (
    <group>
      <mesh ref={ref} castShadow receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.5} />
      </mesh>
      {/* Decorative Windows */}
      <mesh position={[x, y + height / 2, z]} scale={[1.01, 0.9, 1.01]}>
         <boxGeometry args={[width, height, depth]} />
         <meshStandardMaterial color="#333" emissive="#111" wireframe />
      </mesh>
    </group>
  );
};

const City: React.FC = () => {
  const buildings = useMemo(() => {
    const arr = [];
    const gridSpacing = 60;
    const buildingColors = ['#222', '#333', '#444', '#111', '#555'];
    
    // Generate buildings in the blocks
    for (let i = -3; i <= 3; i++) {
      for (let j = -3; j <= 3; j++) {
        // Center of the block
        const blockX = i * gridSpacing + gridSpacing / 2;
        const blockZ = j * gridSpacing + gridSpacing / 2;

        // Skip blocks too far from center
        if (Math.abs(i) > 3 || Math.abs(j) > 3) continue;

        // Add 2-4 buildings per block
        const count = 2 + Math.floor(Math.random() * 3);
        for (let k = 0; k < count; k++) {
            const offsetX = (Math.random() - 0.5) * 30;
            const offsetZ = (Math.random() - 0.5) * 30;
            const w = 10 + Math.random() * 15;
            const d = 10 + Math.random() * 15;
            const h = 20 + Math.random() * 80;
            const color = buildingColors[Math.floor(Math.random() * buildingColors.length)];
            
            arr.push({ x: blockX + offsetX, z: blockZ + offsetZ, w, d, h, color });
        }
      }
    }
    return arr;
  }, []);

  return (
    <group>
      {buildings.map((b, i) => (
        <Building key={i} x={b.x} z={b.z} width={b.w} depth={b.d} height={b.h} color={b.color} />
      ))}
    </group>
  );
};

export default City;
