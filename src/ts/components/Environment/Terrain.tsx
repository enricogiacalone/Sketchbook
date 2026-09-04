import React, { useMemo } from "react";
import * as THREE from "three";
import { useHeightfield } from "@react-three/cannon";

export const getTerrainHeight = (
  x: number,
  z: number,
  maxHeight: number = 0.5
): number => {
  return Math.sin(x / 30) * Math.cos(z / 20) * maxHeight;
};

const Terrain: React.FC = () => {
  const size = 600;
  const segments = 40; 
  const maxHeight = 0.5;

  // Visual Mesh Data - Centered at [0,0,0]
  const { vertices, visualIndices } = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, getTerrainHeight(x, z, maxHeight));
    }
    geometry.computeVertexNormals();

    return {
      vertices: pos.array as Float32Array,
      visualIndices: geometry.index?.array as Uint32Array,
    };
  }, [size, segments, maxHeight]);

  // Physics Heightfield Data
  // Cannon Heightfield expects a 2D array [x][z]
  const heights = useMemo(() => {
    const matrix: number[][] = [];
    const step = size / segments;
    
    for (let i = 0; i <= segments; i++) {
      matrix[i] = [];
      const worldX = -size / 2 + i * step;
      for (let j = 0; j <= segments; j++) {
        const worldZ = -size / 2 + j * step;
        // In Cannon, the second dimension of the heightfield 
        // maps to its local Y, which will be our world -Z after rotation.
        // We calculate height based on the world coordinates.
        matrix[i][j] = getTerrainHeight(worldX, worldZ, maxHeight);
      }
    }
    return matrix;
  }, [size, segments, maxHeight]);

  // We create the physics body but DON'T attach the ref to the visual mesh
  // to keep the coordinate systems independent and clean.
  useHeightfield(() => ({
    args: [heights, { elementSize: size / segments }],
    position: [-size / 2, 0, size / 2], // Offset to align with centered visual mesh
    rotation: [-Math.PI / 2, 0, 0], // Rotate to lay on XZ plane
    type: 'Static',
    material: 'ground',
    collisionFilterGroup: 4, 
    collisionFilterMask: -1,
  }));

  return (
    <mesh receiveShadow position={[0, 0, 0]}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={vertices.length / 3}
          array={vertices}
          itemSize={3}
        />
        <bufferAttribute
          attach="index"
          count={visualIndices.length}
          array={visualIndices}
          itemSize={1}
        />
      </bufferGeometry>
      <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
    </mesh>
  );
};

export default Terrain;
