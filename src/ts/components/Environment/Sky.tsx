import React, { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { SkyShader } from '../../lib/shaders/SkyShader';
import { getSunDirection } from '../../lib/SunCycle';

// Distance the sun position is projected out to before being sent to the
// shader. The vertex shader's vSunfade term divides sunPosition.y by
// 450000 -- with the old code's sunDistance=10, that division always
// landed near 0 regardless of time of day (10/450000 is negligible no
// matter the elevation), so vSunfade was effectively a constant and the
// shader's own day/night rayleigh-coefficient adjustment never actually
// varied. Matching this scale to what the shader's formula expects is
// what makes it respond to the real elevation now (see SunCycle.ts for
// the elevation-vs-time fix that makes this worth fixing).
const SUN_DISTANCE = 400000;

const Sky: React.FC = () => {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const sunPosition = useRef(new THREE.Vector3());

  const uniforms = useMemo(() => {
    return THREE.UniformsUtils.clone(SkyShader.uniforms);
  }, []);

  useFrame((state) => {
    const dir = getSunDirection(state.clock.elapsedTime);
    sunPosition.current.copy(dir).multiplyScalar(SUN_DISTANCE);

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
