import React, { useRef, useEffect } from 'react';
import { useSphere } from '@react-three/cannon';
import * as THREE from 'three';
import { CollisionGroups } from '../enums/CollisionGroups';

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
    // Group 4 was TrimeshColliders (terrain/road), not Bullet -- that
    // mislabeling coincidentally reused the value the terrain/road physics
    // bodies also use, which is how enemies ended up taking bullet damage
    // just from touching the ground (see Enemy.tsx's onCollide, now fixed
    // to key off userData instead of this group number).
    collisionFilterGroup: CollisionGroups.Bullet,
    collisionFilterMask: CollisionGroups.Default | CollisionGroups.Characters,

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
