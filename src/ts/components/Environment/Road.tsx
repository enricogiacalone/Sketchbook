import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useTrimesh } from '@react-three/cannon';
import { getTerrainHeight } from './Terrain';

interface RoadSectionProps {
  axis: 'x' | 'z';
  size: number;
}

const RoadSection: React.FC<RoadSectionProps> = ({ axis, size }) => {
  const roadWidth = 8;
  const segmentsAlong = 80;
  const segmentsAcross = 10;
  const yOffset = 0.15;

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
    collisionFilterGroup: 4, 
    collisionFilterMask: -1, 
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
  return (
    <group>
      <RoadSection axis="x" size={400} />
      <RoadSection axis="z" size={400} />
    </group>
  );
};

export default Road;
