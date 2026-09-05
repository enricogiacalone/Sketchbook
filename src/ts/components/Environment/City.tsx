import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useBox } from '@react-three/cannon';
import { getTerrainHeight } from './Terrain';
import { getRoadOffset } from './Road';
import { CollisionGroups } from '../../enums/CollisionGroups';

// Mirrors the original's TerrainGrid, which marks Road cells so buildings
// (and everything else the VillageGenerator/Trees place) are generated
// around them instead of on top of them. We don't have a full occupancy
// grid here, so we do the equivalent check directly against the road
// layout: a building whose footprint comes within ROAD_WIDTH/2 of any
// road strip is considered blocked.
const footprintOverlapsRoad = (x: number, z: number, width: number, depth: number): boolean => {
  const halfW = width / 2;
  const halfD = depth / 2;
  const samplePoints: [number, number][] = [
    [x, z],
    [x - halfW, z - halfD], [x + halfW, z - halfD],
    [x - halfW, z + halfD], [x + halfW, z + halfD],
    [x, z - halfD], [x, z + halfD], [x - halfW, z], [x + halfW, z],
  ];
  return samplePoints.some(([px, pz]) => getRoadOffset(px, pz) > 0);
};

const Building: React.FC<{ x: number, z: number, width: number, depth: number, height: number, color: string }> = ({ x, z, width, depth, height, color }) => {
  const y = getTerrainHeight(x, z);

  const [ref] = useBox<THREE.Mesh>(() => ({
    type: 'Static',
    args: [width, height, depth],
    position: [x, y + height / 2, z],
    // Same group the original's BoxCollider used for GLTF-authored physics
    // props (see WorldBuilder._processSceneChild): Default, colliding with
    // everything -- characters and vehicles both need to be blocked by it.
    collisionFilterGroup: CollisionGroups.Default,
    collisionFilterMask: -1,
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

        // The central block (i=0, j=0, blockX/blockZ = 30/30) is the park
        // instead -- see Park.tsx, rendered from Scene.tsx.
        if (i === 0 && j === 0) continue;

        // Add 2-4 buildings per block
        const count = 2 + Math.floor(Math.random() * 3);
        for (let k = 0; k < count; k++) {
            const w = 10 + Math.random() * 15;
            const d = 10 + Math.random() * 15;
            const h = 20 + Math.random() * 80;
            const color = buildingColors[Math.floor(Math.random() * buildingColors.length)];

            // Retry a handful of times to find a spot that doesn't straddle
            // a road; a block that just can't fit one (edge blocks with a
            // wide/offset building) simply gets fewer buildings, same as
            // the original skipping already-occupied TerrainGrid cells.
            for (let attempt = 0; attempt < 8; attempt++) {
                const offsetX = (Math.random() - 0.5) * 30;
                const offsetZ = (Math.random() - 0.5) * 30;
                const x = blockX + offsetX;
                const z = blockZ + offsetZ;
                if (!footprintOverlapsRoad(x, z, w, d)) {
                    arr.push({ x, z, w, d, h, color });
                    break;
                }
            }
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
