import React, { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { WaterShader } from '../../lib/shaders/WaterShader';

const Ocean: React.FC = () => {
  const meshRef = useRef<THREE.Mesh>(null);
  const { size, camera } = useThree();

  const uniforms = useMemo(() => {
    const u = THREE.UniformsUtils.clone(WaterShader.uniforms);
    u.iResolution.value.set(size.width, size.height);
    return u;
  }, [size]);

  useFrame((state, delta) => {
    if (meshRef.current) {
      const material = meshRef.current.material as THREE.ShaderMaterial;
      material.uniforms.iGlobalTime.value += delta;
      material.uniforms.cameraPos.value.copy(camera.position);
      
      // Assume a default light direction for now, can be linked to sky later
      material.uniforms.lightDir.value.set(100, 20, 100).normalize();
    }
  });

  return (
    <mesh 
      ref={meshRef} 
      rotation={[-Math.PI / 2, 0, 0]} 
      position={[0, -0.5, 0]} // Slightly below floor
    >
      <planeGeometry args={[1000, 1000]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={WaterShader.vertexShader}
        fragmentShader={WaterShader.fragmentShader}
        transparent={true}
      />
    </mesh>
  );
};

export default Ocean;
