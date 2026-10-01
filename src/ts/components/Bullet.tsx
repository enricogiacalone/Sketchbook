import React, { useEffect, useRef } from 'react';
import { RigidBody, BallCollider, interactionGroups } from '@react-three/rapier';
import * as THREE from 'three';
import { CollisionGroups } from '../enums/CollisionGroups';
import { getShootableCollider, damageFighter } from './Environment/weapons/shootableRegistry';

// Colpo di un nemico sul manichino del giocatore (per segmento: la testa
// fa piu' male). Velocita' della spinta sul ragdoll attivo in m/s.
const ENEMY_BULLET_DAMAGE: Record<string, number> = { Head: 35, Torso: 15, Hips: 12 };
const ENEMY_BULLET_DAMAGE_LIMB = 8;
const ENEMY_BULLET_HIT_SPEED = 2.5;
const _dir = new THREE.Vector3();
const _pt = new THREE.Vector3();

interface BulletProps {
  id: string;
  position: [number, number, number];
  velocity: [number, number, number];
  // Who fired this bullet -- checked by Player.tsx (only 'enemy' bullets
  // damage the player) and Enemy.tsx (only 'player' bullets damage an
  // enemy, preventing enemy-vs-enemy friendly fire), and by
  // Pedestrian.tsx (only 'player' bullets turn a pedestrian hostile).
  owner: 'player' | 'enemy';
  onKill: (id: string) => void;
}

const Bullet: React.FC<BulletProps> = ({ id, position, velocity, owner, onKill }) => {
  // un proiettile colpisce una volta sola (piu' capsule nello stesso passo)
  const spentRef = useRef(false);
  // Auto-kill bullet after 2 seconds if it doesn't hit anything
  useEffect(() => {
    const timer = setTimeout(() => onKill(id), 2000);
    return () => clearTimeout(timer);
  }, [id, onKill]);

  return (
    <RigidBody
      type="dynamic"
      // 50 m/s = 80 cm per frame: senza CCD attraversa le gambe del
      // manichino (capsule di 10 cm) senza mai toccarle
      ccd
      colliders={false}
      position={position}
      linearVelocity={velocity}
      userData={{ type: 'bullet', owner }}
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
        onCollisionEnter={(payload) => {
          // "i proiettili dei nemici non feriscono il manichino": il corpo
          // solido del manichino (capsule per segmento) ferma il proiettile
          // e dice chi e dove ha colpito
          const other = payload.other.collider;
          const info = owner === 'enemy' && other && !spentRef.current ? getShootableCollider(other.handle) : undefined;
          if (info) {
            const self = payload.target.rigidBody;
            const v = self?.linvel();
            const p = self?.translation();
            if (v && p) {
              spentRef.current = true;
              _dir.set(v.x, v.y, v.z);
              if (_dir.lengthSq() < 1e-6) _dir.set(velocity[0], velocity[1], velocity[2]);
              _dir.normalize();
              _pt.set(p.x, p.y, p.z);
              damageFighter(info.ownerId, {
                segment: info.segment,
                damage: ENEMY_BULLET_DAMAGE[info.segment] ?? ENEMY_BULLET_DAMAGE_LIMB,
                dirWorld: _dir,
                speed: ENEMY_BULLET_HIT_SPEED,
                pointWorld: _pt,
              });
            }
          }
          onKill(id);
        }}
        // Pedestrian.tsx's collider is a SENSOR (so pedestrians don't
        // physically block bullets/players) -- a sensor pair fires
        // onIntersectionEnter instead of onCollisionEnter, so this bullet
        // needs both handlers to despawn against either kind of target.
        onIntersectionEnter={() => onKill(id)}
      />
      <mesh castShadow>
        <sphereGeometry args={[0.1, 8, 8]} />
        <meshBasicMaterial color="yellow" />
      </mesh>
    </RigidBody>
  );
};

export default Bullet;
