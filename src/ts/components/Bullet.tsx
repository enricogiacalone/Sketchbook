import React, { useEffect } from 'react';
import { RigidBody, BallCollider, interactionGroups } from '@react-three/rapier';
import { CollisionGroups } from '../enums/CollisionGroups';

interface BulletProps {
  id: string;
  position: [number, number, number];
  velocity: [number, number, number];
  onKill: (id: string) => void;
}

const Bullet: React.FC<BulletProps> = ({ id, position, velocity, onKill }) => {
  // Auto-kill bullet after 2 seconds if it doesn't hit anything
  useEffect(() => {
    const timer = setTimeout(() => onKill(id), 2000);
    return () => clearTimeout(timer);
  }, [id, onKill]);

  return (
    <RigidBody
      type="dynamic"
      colliders={false}
      position={position}
      linearVelocity={velocity}
      userData={{ type: 'bullet' }}
    >
      <BallCollider
        args={[0.1]}
        mass={0.1}
        // Migrated from cannon's collisionFilterGroup/Mask. This is an
        // INCLUSIVE mask (collide with exactly these two groups), unlike
        // the "everything except X" pattern CollisionGroups.groupsExcluding
        // was written for -- so interactionGroups is called directly here.
        // Group 4 was TrimeshColliders (terrain/road), not Bullet -- that
        // mislabeling coincidentally reused the value the terrain/road
        // physics bodies also use, which is how enemies ended up taking
        // bullet damage just from touching the ground (see Enemy.tsx's
        // onCollisionEnter, keyed off userData instead of this group
        // number).
        collisionGroups={interactionGroups([CollisionGroups.Bullet], [CollisionGroups.Default, CollisionGroups.Characters])}
        onCollisionEnter={() => onKill(id)}
      />
      <mesh castShadow>
        <sphereGeometry args={[0.1, 8, 8]} />
        <meshBasicMaterial color="yellow" />
      </mesh>
    </RigidBody>
  );
};

export default Bullet;
