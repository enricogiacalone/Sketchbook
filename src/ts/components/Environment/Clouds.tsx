import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// Create a single cloud texture to be reused
const createCloudTexture = (opacity: number): THREE.CanvasTexture => {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Failed to get 2d context");
  }

  const gradient = context.createRadialGradient(
    canvas.width / 2,
    canvas.height / 2,
    0,
    canvas.width / 2,
    canvas.height / 2,
    canvas.width / 2
  );
  gradient.addColorStop(0, `rgba(255,255,255,${opacity})`);
  gradient.addColorStop(0.5, `rgba(255,255,255,${opacity * 0.5})`);
  gradient.addColorStop(1, "rgba(255,255,255,0)");

  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
};

const Clouds: React.FC = () => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  
  // Configuration
  const CLOUD_COUNT = 40;
  const PARTICLES_PER_CLOUD = 10;
  const TOTAL_INSTANCES = CLOUD_COUNT * PARTICLES_PER_CLOUD;
  
  const texture = useMemo(() => createCloudTexture(0.8), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Generate initial cloud data
  const clouds = useMemo(() => {
    const data = [];
    const SPREAD = 800;
    const BASE_HEIGHT = 150;
    const HEIGHT_VARIATION = 100;

    for (let i = 0; i < CLOUD_COUNT; i++) {
      const cloudPos = new THREE.Vector3(
        (Math.random() - 0.5) * SPREAD,
        BASE_HEIGHT + (Math.random() - 0.5) * HEIGHT_VARIATION,
        (Math.random() - 0.5) * SPREAD
      );
      const cloudScale = 50 + Math.random() * 100;
      const driftSpeed = (Math.random() - 0.5) * 2;

      const particles = [];
      for (let j = 0; j < PARTICLES_PER_CLOUD; j++) {
        particles.push({
          offset: new THREE.Vector3(
            (Math.random() - 0.5) * cloudScale * 0.8,
            (Math.random() - 0.5) * cloudScale * 0.2,
            (Math.random() - 0.5) * cloudScale * 0.8
          ),
          rotation: Math.random() * Math.PI * 2,
          scale: (0.8 + Math.random() * 0.4) * cloudScale
        });
      }

      data.push({ position: cloudPos, particles, driftSpeed });
    }
    return data;
  }, []);

  // Set initial instances
  useEffect(() => {
    if (!meshRef.current) return;

    let instanceIdx = 0;
    clouds.forEach((cloud) => {
      cloud.particles.forEach((p) => {
        dummy.position.copy(cloud.position).add(p.offset);
        dummy.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), p.rotation);
        dummy.scale.set(p.scale, p.scale, 1);
        dummy.updateMatrix();
        meshRef.current!.setMatrixAt(instanceIdx++, dummy.matrix);
      });
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [clouds, dummy]);

  // Animate clouds (slow drift)
  useFrame((state, delta) => {
    if (!meshRef.current) return;

    let instanceIdx = 0;
    clouds.forEach((cloud) => {
      // Drifting
      cloud.position.x += cloud.driftSpeed * delta;
      
      // Wrap around
      if (cloud.position.x > 500) cloud.position.x = -500;
      if (cloud.position.x < -500) cloud.position.x = 500;

      cloud.particles.forEach((p) => {
        dummy.position.copy(cloud.position).add(p.offset);
        // Face the camera!
        dummy.quaternion.copy(state.camera.quaternion);
        // Apply individual particle rotation
        const zRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), p.rotation + state.clock.elapsedTime * 0.05);
        dummy.quaternion.multiply(zRotation);
        
        dummy.scale.set(p.scale, p.scale, 1);
        dummy.updateMatrix();
        meshRef.current!.setMatrixAt(instanceIdx++, dummy.matrix);
      });
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, TOTAL_INSTANCES]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial 
        map={texture} 
        transparent 
        depthWrite={false} 
        side={THREE.DoubleSide}
        opacity={0.6}
      />
    </instancedMesh>
  );
};

export default Clouds;
