import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getTerrainHeight } from './Terrain';
import { uv, Fn, vec3, vec4, mix } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

const Grass: React.FC = () => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = 6000;
  
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const { matrices } = useMemo(() => {
    const mat = [];
    for (let i = 0; i < count; i++) {
      const x = Math.random() * 400 - 200;
      const z = Math.random() * 400 - 200;
      const y = getTerrainHeight(x, z);

      dummy.position.set(x, y, z);
      dummy.rotation.y = Math.random() * Math.PI;
      dummy.scale.setScalar(0.5 + Math.random() * 0.5);
      dummy.updateMatrix();
      
      mat.push(dummy.matrix.clone());
    }
    return { matrices: mat };
  }, [count, dummy]);

  useEffect(() => {
    if (meshRef.current) {
      matrices.forEach((matrix, i) => {
        meshRef.current!.setMatrixAt(i, matrix);
      });
      meshRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [matrices]);

  const material = useMemo(() => {
    const mat = new MeshBasicNodeMaterial() as any;
    mat.side = THREE.DoubleSide;
    mat.colorNode = Fn(() => {
      const uvCoord = uv();
      const color = mix(vec3(0.1, 0.4, 0.1), vec3(0.4, 0.7, 0.2), uvCoord.y);
      return vec4(color, 1.0);
    })();
    return mat;
  }, []);

  return (
    <instancedMesh ref={meshRef} args={[null as any, null as any, count]} material={material as any}>
      <planeGeometry args={[0.2, 1, 1, 4]} />
    </instancedMesh>
  );
};

export default Grass;
