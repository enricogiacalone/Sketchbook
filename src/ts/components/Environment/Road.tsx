import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useTrimesh } from '@react-three/cannon';
import { getTerrainHeight } from './Terrain';
import { CollisionGroups } from '../../enums/CollisionGroups';

// Shared road-grid layout, also consumed by Player.tsx (getRoadOffset) so the
// character's manual ground-snapping agrees with the actual road geometry
// instead of relying on physics contact response (see Player.tsx for why).
export const ROAD_SIZE = 600;
export const ROAD_GRID_SPACING = 60;
export const ROAD_WIDTH = 8;
export const ROAD_Y_OFFSET = 0.15;

const ROAD_OFFSETS: number[] = (() => {
  const arr: number[] = [];
  for (let i = -3; i <= 3; i++) {
    arr.push(i * ROAD_GRID_SPACING);
  }
  return arr;
})();

// Returns the road surface's extra elevation above the raw terrain height at
// (x, z), or 0 if the point isn't over any road strip. Mirrors the road grid
// built by <Road />, so this must stay in sync with it.
export const getRoadOffset = (x: number, z: number): number => {
  const half = ROAD_WIDTH / 2;
  for (const offset of ROAD_OFFSETS) {
    // Horizontal strip (axis="x"): runs along world X, centered at z = offset
    if (Math.abs(z - offset) <= half) return ROAD_Y_OFFSET;
    // Vertical strip (axis="z"): runs along world Z, centered at x = offset
    if (Math.abs(x - offset) <= half) return ROAD_Y_OFFSET;
  }
  return 0;
};

interface RoadSectionProps {
  axis: 'x' | 'z';
  size: number;
}

const RoadSection: React.FC<RoadSectionProps> = ({ axis, size }) => {
  const roadWidth = ROAD_WIDTH;
  const segmentsAlong = 80;
  const segmentsAcross = 10;
  const yOffset = ROAD_Y_OFFSET;

  const { vertices, physicsIndices, visualIndices } = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(
        axis === 'x' ? size : roadWidth,
        axis === 'z' ? size : roadWidth,
        axis === 'x' ? segmentsAlong : segmentsAcross,
        axis === 'z' ? segmentsAlong : segmentsAcross
    );

    geometry.rotateX(-Math.PI / 2);
    
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        pos.setY(i, getTerrainHeight(x, z) + yOffset);
    }
    geometry.computeVertexNormals();

    const rawIndices = geometry.index?.array || new Uint32Array();

    return {
        vertices: pos.array as Float32Array,
        physicsIndices: new Int32Array(rawIndices),
        visualIndices: new Uint32Array(rawIndices)
    };
  }, [axis, size]);

  const [ref] = useTrimesh<THREE.Mesh>(() => ({
    type: 'Static',
    args: [vertices, physicsIndices],
    mass: 0,
    material: 'ground',
    collisionFilterGroup: CollisionGroups.TrimeshColliders,
    // Exclude other TrimeshColliders (the terrain heightfield and the other
    // road strips): all static, mass-0 bodies colliding with each other for
    // no dynamic effect, just wasted broadphase/narrowphase work every step.
    collisionFilterMask: ~CollisionGroups.TrimeshColliders,
  }));

  return (
    <mesh ref={ref} receiveShadow>
        <bufferGeometry>
            <bufferAttribute
                attach="attributes-position"
                count={vertices.length / 3}
                array={vertices}
                itemSize={3}
            />
            {visualIndices && (
                <bufferAttribute
                    attach="index"
                    count={visualIndices.length}
                    array={visualIndices}
                    itemSize={1}
                />
            )}
        </bufferGeometry>
        <meshStandardMaterial color="#444" roughness={0.8} />
    </mesh>
  );
};

const Road: React.FC = () => {
  const offsets = ROAD_OFFSETS;

  return (
    <group>
      {offsets.map((offset, i) => (
        <React.Fragment key={`road-grid-${i}`}>
          <group position={[0, 0, offset]}>
            <RoadSection axis="x" size={ROAD_SIZE} />
          </group>
          <group position={[offset, 0, 0]}>
            <RoadSection axis="z" size={ROAD_SIZE} />
          </group>
        </React.Fragment>
      ))}
    </group>
  );
};

export default Road;
