import React, { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { SkyShader } from '../../lib/shaders/SkyShader';

const Sky: React.FC = () => {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const sunPosition = useRef(new THREE.Vector3());

  const uniforms = useMemo(() => {
    return THREE.UniformsUtils.clone(SkyShader.uniforms);
  }, []);

  useFrame((state, delta) => {
    // Simplified Day/Night Cycle (240s for full cycle)
    const timeOfDay = (state.clock.elapsedTime / 240) * 24 % 24;
    
    // Calculate sun elevation (phi) and azimuth (theta)
    const hourFactor = (timeOfDay - 12) / 12;
    const phi = (90 - Math.sin(hourFactor * Math.PI) * 90) * Math.PI / 180;
    const theta = (270 + (timeOfDay / 24) * 360) * Math.PI / 180;

    const sunDistance = 10;
    sunPosition.current.set(
      sunDistance * Math.sin(theta) * Math.cos(phi),
      sunDistance * Math.sin(phi),
      sunDistance * Math.cos(theta) * Math.cos(phi)
    );

    if (meshRef.current) {
      const material = meshRef.current.material as THREE.ShaderMaterial;
      material.uniforms.sunPosition.value.copy(sunPosition.current);
      material.uniforms.cameraPos.value.copy(camera.position);
      meshRef.current.position.copy(camera.position);
    }
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[1000, 24, 12]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={SkyShader.vertexShader}
        fragmentShader={SkyShader.fragmentShader}
        side={THREE.BackSide}
      />
    </mesh>
  );
};

export default Sky;
