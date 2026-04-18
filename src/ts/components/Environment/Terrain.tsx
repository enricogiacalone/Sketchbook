import React, { useMemo } from "react";
import * as THREE from "three";
import { useTrimesh } from "@react-three/cannon";

export const getTerrainHeight = (
  x: number,
  z: number,
  maxHeight: number = 10
): number => {
  return Math.sin(x / 30) * Math.cos(z / 20) * maxHeight;
};

const Terrain: React.FC = () => {
  const size = 400;
  const segments = 60;
  const maxHeight = 10;

  const { vertices, physicsIndices, visualIndices } = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, getTerrainHeight(x, z, maxHeight));
    }
    geometry.computeVertexNormals();

    const rawIndices = geometry.index?.array || new Uint32Array();

    return {
      vertices: pos.array as Float32Array,
      physicsIndices: new Int32Array(rawIndices), // Cannon vuole Int32
      visualIndices: new Uint32Array(rawIndices), // WebGL vuole Uint32
    };
  }, [size, segments, maxHeight]);

  const [ref] = useTrimesh<THREE.Mesh>(() => ({
    args: [vertices, physicsIndices],
    mass: 0,
    material: "ground",
    collisionFilterGroup: 1,
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
        <bufferAttribute
          attach="index"
          count={visualIndices.length}
          array={visualIndices}
          itemSize={1}
        />
      </bufferGeometry>
      <meshStandardMaterial color="#33691e" roughness={0.8} />
    </mesh>
  );
};

export default Terrain;
