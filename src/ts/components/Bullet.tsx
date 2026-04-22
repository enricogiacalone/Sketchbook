import React, { useRef, useEffect } from 'react';
import { useSphere } from '@react-three/cannon';
import * as THREE from 'three';

interface BulletProps {
  id: string;
  position: [number, number, number];
  velocity: [number, number, number];
  onKill: (id: string) => void;
}

const Bullet: React.FC<BulletProps> = ({ id, position, velocity, onKill }) => {
  const [ref, api] = useSphere<THREE.Mesh>(() => ({
    mass: 0.1,
    position,
    velocity,
    args: [0.1],
    onCollide: (e) => {
        // Bullets should disappear on any collision
        onKill(id);
    },
    // Bullet collision group
    collisionFilterGroup: 4, // Group 4 for bullets
    collisionFilterMask: 1 | 2, // Collide with ground (1) and characters/enemies (2)
    userData: { type: 'bullet' }
  }));

  // Auto-kill bullet after 2 seconds if it doesn't hit anything
  useEffect(() => {
    const timer = setTimeout(() => onKill(id), 2000);
    return () => clearTimeout(timer);
  }, [id, onKill]);

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.1, 8, 8]} />
      <meshBasicMaterial color="yellow" />
    </mesh>
  );
};

export default Bullet;
