import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { RigidBody, CapsuleCollider, RapierRigidBody, IntersectionEnterHandler } from '@react-three/rapier';
import { CollisionGroups, groupsExcluding } from '../../enums/CollisionGroups';
import { getTerrainHeight } from './Terrain';
import { getRoadOffset } from './Road';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';

interface PedestrianProps {
  id: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  speed?: number;
  phase?: number;
  // Owned by CityDetails, not this component -- true for as long as this
  // pedestrian's id is in its pedestrianEnemies list (i.e. a real Enemy.tsx
  // is currently standing in for it). Used to be local state here
  // (`isEnemy`) that only ever went true and never back, so a converted
  // pedestrian stayed a hostile Enemy forever even once it gave up
  // chasing. Controlling it from the parent instead means Enemy.tsx's own
  // "give up after a while" timeout (see GIVE_UP_TIME there) can hand a
  // pedestrian its old life back: CityDetails drops the id from
  // pedestrianEnemies, this flips back to false, and this component just
  // resumes its patrol from wherever its (never-reset) t/dir refs were
  // frozen -- it was only ever skipped, not destroyed.
  isHostile: boolean;
  // Called once, the moment the player (on foot or in any vehicle) gets
  // close enough to this pedestrian to count as a hit -- CityDetails.tsx
  // uses it to spawn a real Enemy.tsx in this pedestrian's place. Passed
  // down rather than reaching into the store directly so this component
  // stays a dumb "walk back and forth, report a hit" thing and doesn't
  // need to know how the resulting enemy is actually managed/rendered.
  onBecomeEnemy: (id: string, position: [number, number, number]) => void;
}

// Background crowd filler -- same boxman.glb as the player, walking back
// and forth along a short fixed sidewalk segment. Purely decorative: no
// RigidBody/collider at all (unlike the street furniture in CityDetails.tsx),
// so the player can walk straight through one. Good enough for ambient city
// life without adding ~20 more physics bodies for something nobody is meant
// to actually bump into meaningfully.
//
// boxman.glb has no separate "walk" clip (checked its animation list
// directly: idle/run/sprint/jump*/sit*/stand*/etc, no walk) -- using 'run'
// at a slow linear speed reads a little brisk up close, but at the
// distances these are actually seen from around the city it's a fine
// stand-in, and matches the run cycle Player.tsx itself already uses.
const Pedestrian: React.FC<PedestrianProps> = ({ id, x1, z1, x2, z2, speed = 1.2, phase = 0, isHostile, onBecomeEnemy }) => {
  const { scene, animations } = useGLTF('boxman.glb');
  // Plain scene.clone() (Object3D.clone) does NOT re-bind skinned-mesh
  // skeletons -- every clone's SkinnedMesh would keep pointing at the
  // ORIGINAL scene's bones, which are never part of any rendered tree here
  // (only clones get mounted via <primitive>) and so never get their
  // matrixWorld updated. Net effect: the mesh renders frozen at its bind
  // pose with a stale/identity world matrix -- effectively invisible.
  // Player.tsx hits the same GLB the same way and already uses
  // SkeletonUtils.clone for exactly this reason; match it here.
  const clonedScene = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { actions } = useAnimations(animations, clonedScene);
  const groupRef = useRef<THREE.Group>(null);
  // Physics body for the "se sparo ai pedoni diventano nemici" sensor
  // collider below -- purely a bullet-detection volume, never a solid
  // obstacle (see the RigidBody comment further down), so it's driven by
  // setNextKinematicTranslation from the same t/dir walk logic that used
  // to just poke groupRef.current.position directly.
  const bodyRef = useRef<RapierRigidBody>(null);

  const start = useMemo(() => new THREE.Vector3(x1, 0, z1), [x1, z1]);
  const end = useMemo(() => new THREE.Vector3(x2, 0, z2), [x2, z2]);
  const segmentLength = useMemo(() => start.distanceTo(end), [start, end]);
  const initialPos = useMemo(() => {
    const p = new THREE.Vector3().lerpVectors(start, end, phase);
    const y = getTerrainHeight(p.x, p.z) + getRoadOffset(p.x, p.z);
    return [p.x, y, p.z] as [number, number, number];
  }, [start, end, phase]);
  // Last computed world position, kept alongside the RigidBody (which only
  // exposes its CURRENT translation, not the "next" one just queued via
  // setNextKinematicTranslation below) so handleBulletHit can report an
  // up-to-date spot to onBecomeEnemy without waiting a physics step.
  const lastPos = useRef<[number, number, number]>(initialPos);

  const t = useRef(phase);
  const dir = useRef(1);
  const currentAnim = useRef<string | null>(null);
  const pauseTimer = useRef(0);
  const scratchPos = useRef(new THREE.Vector3());
  const { playerPos, currentControllable } = useStore(
    useShallow((state) => ({ playerPos: state.playerPos, currentControllable: state.currentControllable }))
  );
  // Getting run over on foot is a lot more precise than getting clipped by
  // a 2m-wide car -- give vehicles a much more forgiving hit radius so
  // driving anywhere near one reliably counts, instead of needing to line
  // up the car's exact footprint against a stationary point target.
  const HIT_RADIUS = currentControllable === 'player' ? 1.1 : 2.2;
  // "la pallottola attraversa i pedoni.. nn li colpisce" -- root cause: this
  // was a small BallCollider centered at the RigidBody's own origin, which
  // sits at GROUND level (the body tracks the character's feet, same
  // convention as the old groupRef.current.position.set(pos.x, y, pos.z)
  // it replaced -- the model itself has no extra offset, unlike
  // Player.tsx's -RADIUS or Enemy.tsx's -bodyBottomOffset, because
  // boxman.glb's root bone is already at the feet). A 0.4-radius ball
  // there only covers shin height, while bullets fly past at
  // chest/arm height -- always a clean miss. A vertical capsule spanning
  // roughly ground to head height (matching Enemy.tsx's three-stacked-
  // spheres coverage, ~0 to ~1.6m) catches a bullet at any height instead.
  const BULLET_HIT_HALF_HEIGHT = 0.5;
  const BULLET_HIT_RADIUS = 0.3;
  const BULLET_HIT_CENTER_Y = 0.8;

  const playAnim = (name: string) => {
    if (currentAnim.current === name || !actions[name]) return;
    currentAnim.current = name;
    Object.values(actions).forEach((a) => a?.fadeOut(0.2));
    actions[name]!.reset().fadeIn(0.2).play();
  };

  // "se sparo ai pedoni diventano nemici e anche loro mi possono sparare" --
  // fires when a bullet's sensor intersection starts against this
  // pedestrian's collider. Reuses the EXISTING onBecomeEnemy callback (same
  // one the run-over hit check below already calls) rather than a separate
  // code path, so CityDetails.tsx's freeze/spawn-Enemy/eventual
  // give-up-and-revert cycle handles this exactly like a run-over hit --
  // its own pedestrianEnemies dedup-by-id already makes a repeat call
  // harmless. Only a 'player'-owned bullet counts, so an Enemy's own shots
  // (owner:'enemy', see Enemy.tsx) can't turn a pedestrian hostile.
  const handleBulletHit: IntersectionEnterHandler = (payload) => {
    const otherData = payload.other.rigidBodyObject?.userData as { type?: string; owner?: string } | undefined;
    if (!isHostile && otherData?.type === 'bullet' && otherData?.owner === 'player') {
      onBecomeEnemy(id, lastPos.current);
    }
  };

  useFrame((_state, delta) => {
    // Frozen (not destroyed) for as long as CityDetails considers this id
    // hostile -- Enemy.tsx is standing in for it during that time. Its
    // t/dir/pauseTimer refs just stop advancing here and pick back up
    // exactly where they left off once isHostile goes false again.
    if (isHostile || !groupRef.current || !bodyRef.current || segmentLength < 0.01) return;

    if (pauseTimer.current > 0) {
      pauseTimer.current -= delta;
      playAnim('idle');
    } else {
      t.current += (dir.current * speed * delta) / segmentLength;
      if (t.current >= 1) {
        t.current = 1;
        dir.current = -1;
        pauseTimer.current = 1 + Math.random() * 1.5;
      } else if (t.current <= 0) {
        t.current = 0;
        dir.current = 1;
        pauseTimer.current = 1 + Math.random() * 1.5;
      }
      playAnim('run');
    }

    const pos = scratchPos.current.lerpVectors(start, end, t.current);
    const y = getTerrainHeight(pos.x, pos.z) + getRoadOffset(pos.x, pos.z);
    lastPos.current = [pos.x, y, pos.z];
    // Moves the sensor collider (physics-step-integrated, unlike a plain
    // setTranslation) -- the visible model, parented UNDER this body now
    // (see the JSX), rides along for free and only needs its own cosmetic
    // facing rotation set below, not a position.
    bodyRef.current.setNextKinematicTranslation({ x: pos.x, y, z: pos.z });

    const facing = dir.current >= 0 ? end : start;
    const dx = facing.x - pos.x;
    const dz = facing.z - pos.z;
    if (Math.hypot(dx, dz) > 0.01) {
      groupRef.current.rotation.y = Math.atan2(dx, dz);
    }

    // Hit check, last -- uses this frame's just-computed position/ground Y
    // so the spawned Enemy picks up exactly where this pedestrian was
    // standing, not last frame's stale spot.
    const hitDx = playerPos[0] - pos.x;
    const hitDz = playerPos[2] - pos.z;
    if (hitDx * hitDx + hitDz * hitDz < HIT_RADIUS * HIT_RADIUS) {
      // CityDetails.tsx's own pedestrianEnemies state already no-ops a
      // repeat hit for an id it's already tracking, so calling this again
      // on the few frames before isHostile actually flips true (one
      // render round-trip through the parent) is harmless.
      onBecomeEnemy(id, [pos.x, y, pos.z]);
    }
  });

  // The pedestrian itself disappears the instant it "becomes" the enemy --
  // Enemy.tsx (spawned by the onBecomeEnemy callback above) takes over
  // rendering/physics/AI at this same spot from here on, until it either
  // catches the player or gives up and this goes back to false.
  if (isHostile) return null;

  return (
    <RigidBody
      ref={bodyRef}
      type="kinematicPosition"
      colliders={false}
      position={initialPos}
    >
      {/* Sensor, not solid -- a pedestrian was always walk-through (see the
          module comment above about having no collider at all before this
          feature), so this exists purely to detect bullets, never to block
          the player or anything else physically. A sensor pair fires
          onIntersectionEnter, not onCollisionEnter -- matched by Bullet.tsx
          now having both handlers. Same collisionGroups convention as
          Enemy.tsx (Characters membership, excluding TrimeshColliders) so
          the existing bullet mask (which already includes Characters)
          reaches it with no changes needed there. Vertical capsule, not a
          single small ball -- see BULLET_HIT_* comment above. */}
      <CapsuleCollider
        args={[BULLET_HIT_HALF_HEIGHT, BULLET_HIT_RADIUS]}
        position={[0, BULLET_HIT_CENTER_Y, 0]}
        sensor
        collisionGroups={groupsExcluding(CollisionGroups.Characters, CollisionGroups.TrimeshColliders)}
        onIntersectionEnter={handleBulletHit}
      />
      <group ref={groupRef}>
        <primitive object={clonedScene} />
      </group>
    </RigidBody>
  );
};

export default Pedestrian;
