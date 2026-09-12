import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getTerrainHeight } from './Terrain';

const Grass: React.FC = () => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  // "serve ottimizzare ancora" -- this is a blind uniform scatter across
  // the WHOLE 400x400 map with no exclusion for roads or buildings (unlike
  // ParkTrees.tsx's GrassPatch, added later for "hai dimenticato l'erba e
  // i fiori", which is properly bounded to courtyards/park/plazas and now
  // covers all the areas that actually need grass). A large fraction of
  // these blades were rendering pointlessly under road surfaces and
  // building footprints -- cut from 20000 to 6000, still enough for
  // ground cover out past the city grid where GrassPatch has no reach, at
  // a third of the vertex/shader cost.
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

  useFrame((state) => {
    if (meshRef.current) {
      (meshRef.current.material as THREE.ShaderMaterial).uniforms.uTime.value = state.clock.elapsedTime;
    }
  });

  // Mock Shaders based on original files
  const vertexShader = `
    varying vec2 vUv;
    uniform float uTime;
    void main() {
      vUv = uv;
      vec3 pos = position;
      float wave = sin(uTime + instanceMatrix[3][0] * 0.5) * 0.1 * (1.0 - uv.y);
      pos.x += wave;
      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
    }
  `;

  const fragmentShader = `
    varying vec2 vUv;
    void main() {
      vec3 color = mix(vec3(0.1, 0.4, 0.1), vec3(0.4, 0.7, 0.2), vUv.y);
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  return (
    <instancedMesh ref={meshRef} args={[null as any, null as any, count]}>
      <planeGeometry args={[0.2, 1, 1, 4]} />
      <shaderMaterial 
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={{ uTime: { value: 0 } }}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  );
};

export default Grass;
