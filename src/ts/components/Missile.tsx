import React, { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, BallCollider, RapierRigidBody, interactionGroups } from '@react-three/rapier';
import * as THREE from 'three';
import { useStore } from '../store';
import { CollisionGroups } from '../enums/CollisionGroups';
import Explosion from './Environment/Explosion';

// "stessa ... sparatoria" -- droneWorld's secondary-fire "missile"
// (src/controls/index.js: a homing sphere toward selectNearestTargetInSight(),
// exploding within 10 units and doing target.userData.life -= 25). This
// project has no existing target-lock/HUD system to port that selection
// UI from, so the simplification (disclosed to the user) is: Player.tsx
// picks the nearest 'enemy' store entity inside a forward-facing cone at
// FIRE time (once, like droneWorld's own one-shot lock), and this
// component re-steers toward wherever that same entity is EACH frame
// after that (a real "homing" missile, not just a straight shot at where
// the target used to be) -- if the target is destroyed or was never
// found, it just flies straight until MISSILE_LIFETIME runs out.
// Same 25-damage contract as a regular Bullet (userData type/owner below
// exactly matches Bullet.tsx, so Enemy.tsx's existing handleBulletHit
// fires unmodified) -- droneWorld's own missile does the exact same 25,
// so no new damage tuning was even needed.
interface MissileProps {
  id: string;
  position: [number, number, number];
  initialVelocity: [number, number, number];
  targetId: string | null;
  onKill: (id: string) => void;
}

const MISSILE_SPEED = 26; // m/s -- slower than a bullet's 50, "heavier" projectile feel
const MISSILE_TURN_RATE = 3.2; // rad/s-equivalent turn authority toward the target (see the lerp factor below)
const MISSILE_LIFETIME = 4; // seconds -- auto-explodes if it never reaches anything, same idea as Bullet.tsx's 2s auto-kill timer
const MISSILE_PROXIMITY = 3; // explode once this close to the target -- droneWorld's own 10 units, scaled down for this project's smaller characters/city blocks
const MISSILE_TARGET_Y_OFFSET = 0.8; // aim at roughly enemy chest-height, not its feet-level store position

const _pos = new THREE.Vector3();
const _toTarget = new THREE.Vector3();

const Missile: React.FC<MissileProps> = ({ id, position, initialVelocity, targetId, onKill }) => {
  const ref = useRef<RapierRigidBody>(null);
  const dir = useRef(new THREE.Vector3(...initialVelocity).normalize());
  const age = useRef(0);
  const [exploded, setExploded] = useState(false);
  const explodePos = useRef<[number, number, number]>(position);

  const explode = () => {
    if (exploded) return;
    const t = ref.current?.translation();
    if (t) explodePos.current = [t.x, t.y, t.z];
    setExploded(true);
  };

  useFrame((_state, delta) => {
    if (exploded || !ref.current) return;
    age.current += delta;
    if (age.current > MISSILE_LIFETIME) {
      explode();
      return;
    }

    const t = ref.current.translation();
    _pos.set(t.x, t.y, t.z);

    const target = targetId ? useStore.getState().entities.get(targetId) : undefined;
    if (target) {
      _toTarget.set(
        target.position[0] - _pos.x,
        target.position[1] + MISSILE_TARGET_Y_OFFSET - _pos.y,
        target.position[2] - _pos.z
      );
      const dist = _toTarget.length();
      if (dist < MISSILE_PROXIMITY) {
        explode();
        return;
      }
      _toTarget.normalize();
      // Steer the travel direction toward the target at a limited rate
      // (lerp-then-renormalize, same cheap small-angle technique
      // Player.tsx's own drone flight uses for its rotation integration)
      // rather than snapping straight at it -- a real chase, not a laser.
      dir.current.lerp(_toTarget, Math.min(1, MISSILE_TURN_RATE * delta)).normalize();
    }

    const v = dir.current;
    ref.current.setLinvel({ x: v.x * MISSILE_SPEED, y: v.y * MISSILE_SPEED, z: v.z * MISSILE_SPEED }, true);
  });

  if (exploded) {
    return <Explosion position={explodePos.current} scale={1.8} color="orangered" onFinish={() => onKill(id)} />;
  }

  return (
    <RigidBody
      ref={ref}
      type="dynamic"
      colliders={false}
      position={position}
      linearVelocity={initialVelocity}
      gravityScale={0}
      userData={{ type: 'bullet', owner: 'player' }}
    >
      <BallCollider
        args={[0.25]}
        mass={0.5}
        collisionGroups={interactionGroups([CollisionGroups.Bullet], [CollisionGroups.Default, CollisionGroups.Characters])}
        onCollisionEnter={explode}
        onIntersectionEnter={explode}
      />
      <mesh castShadow>
        <cylinderGeometry args={[0.08, 0.13, 0.55, 8]} />
        <meshStandardMaterial color="#333333" emissive="orangered" emissiveIntensity={1.5} />
      </mesh>
    </RigidBody>
  );
};

export default Missile;
