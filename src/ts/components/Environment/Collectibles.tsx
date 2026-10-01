import React, { useMemo, useRef, useLayoutEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getTerrainHeight } from './Terrain';
import { ROAD_OFFSETS, getRoadOffset } from './Road';
import { CITY_LAYOUT } from './City';
import { useStore } from '../../store';

// "aggiungi oggetti da collezionare per tutta la citta" -- small glowing
// gems scattered across every kind of space the city already has: one per
// street intersection, a handful in the park, one on the roof of the
// tallest building in each courtyard block (a reward for actually climbing
// up there -- see City.tsx's "rendi i palazzi esplorabili"), and a couple
// in each open plaza.
//
// Rendered as ONE instancedMesh (not one mesh + one useFrame per gem) --
// same reasoning as Grass/Clouds/City's windows: a few dozen small
// rotating meshes would be cheap either way, but this keeps the pattern
// consistent with the rest of Environment/ and costs one draw call
// instead of ~80. Pickup is a plain distance check against the player's
// position every frame (like every other "am I near X" check in this
// game, e.g. Player.tsx's vehicle-entrance range) -- no RigidBody/collider
// at all, since a pickup doesn't need to physically block anything.
// "nn riesco a prenderli (ci passo attraverso)": il controllo vecchio
// aspettava isPlayerGrounded, che pubblicava solo il boxman (Player.tsx) --
// col manichino restava falso per sempre. Ora si prende quando il gioiello
// tocca il CORPO: un cilindro verticale dai piedi alla testa (a piedi),
// una sfera attorno all'auto o al drone (che quindi puo' prendere quelli
// sui tetti).
const PICKUP_RADIUS = 1.0; // m, orizzontale, a piedi
const PICKUP_BODY_LOW = -0.3; // m sotto i piedi
const PICKUP_BODY_HIGH = 2.1; // m sopra i piedi
const PICKUP_VEHICLE_RADIUS = 2.2; // m, in auto o col drone
// playerPos a piedi e' 0.5 m sopra i piedi (PlayerCombatSoldier.tsx)
const PLAYER_POS_ABOVE_FEET = 0.5;
const BOB_AMPLITUDE = 0.28;
const BOB_SPEED = 2.2;
const SPIN_SPEED = 1.6;
const POP_DURATION = 0.35; // seconds -- shrink-and-rise once collected, then hidden for good

interface CollectibleSpot {
  id: string;
  x: number;
  y: number; // base height (ground/roof), bobbing is added on top each frame
  z: number;
}

// "in piu posizionali randomicamente": posti nuovi a ogni partita. A terra
// ovunque nella citta' (strade, marciapiedi, parco, piazze) tranne dentro
// i palazzi, distanziati fra loro; qualcuno sui tetti (col drone).
const GROUND_COUNT = 34;
const ROOF_COUNT = 6;
const MIN_SPACING = 9; // m fra due gioielli a terra
const BUILDING_MARGIN = 1.2; // m fuori dal perimetro dei palazzi
const HEIGHT_ABOVE_GROUND = 1.2;

const insideBuilding = (x: number, z: number) => {
  for (const b of CITY_LAYOUT.buildings) {
    if (Math.abs(x - b.x) < b.w / 2 + BUILDING_MARGIN && Math.abs(z - b.z) < b.d / 2 + BUILDING_MARGIN) return true;
  }
  return false;
};

function randomSpots(): CollectibleSpot[] {
  const spots: CollectibleSpot[] = [];
  const min = Math.min(...ROAD_OFFSETS) - 4;
  const max = Math.max(...ROAD_OFFSETS) + 4;
  let tries = 0;
  while (spots.length < GROUND_COUNT && tries++ < 5000) {
    const x = min + Math.random() * (max - min);
    const z = min + Math.random() * (max - min);
    if (insideBuilding(x, z)) continue;
    if (spots.some((p) => Math.hypot(p.x - x, p.z - z) < MIN_SPACING)) continue;
    const y = getTerrainHeight(x, z) + getRoadOffset(x, z) + HEIGHT_ABOVE_GROUND;
    spots.push({ id: `ground-${spots.length}`, x, z, y });
  }
  const roofs = [...CITY_LAYOUT.buildings].sort(() => Math.random() - 0.5).slice(0, ROOF_COUNT);
  roofs.forEach((b, i) => spots.push({ id: `roof-${i}`, x: b.x, z: b.z, y: b.by + b.h + 1.0 }));
  return spots;
}

const _dummy = new THREE.Object3D();

const Collectibles: React.FC = () => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  // Per-instance collection timestamp (elapsed seconds), -1 while still
  // uncollected. Kept OUTSIDE React state -- this needs to change every
  // frame during the brief pop animation without triggering re-renders,
  // exactly like every other instancedMesh animation in Environment/.
  const ALL_SPOTS = useMemo(() => randomSpots(), []);
  const collectedAt = useRef<Float32Array>(new Float32Array(ALL_SPOTS.length).fill(-1));
  const setCollectiblesTotal = useStore((state) => state.setCollectiblesTotal);
  const collectItem = useStore((state) => state.collectItem);

  // "spawna sopra un collectible, sento il suono, sparisce, ma nn viene
  // contato -- poi gli altri nn vanno" -- root cause, confirmed live via
  // the debug log below (store showed total=0 at the very first pickup):
  // this used to be a plain useEffect, which React runs ASYNCHRONOUSLY
  // after commit -- late enough that, when the player spawns already
  // overlapping a collectible, Collectibles.tsx's OWN useFrame pickup
  // check can tick (via the Canvas's requestAnimationFrame loop) before
  // this effect has actually run once. collectItem() then computes
  // Math.min(0, found + 1) = 0 forever for that pickup (and the same race
  // can recur on remounts). useLayoutEffect runs SYNCHRONOUSLY right after
  // the commit, guaranteed to finish before the browser paints or any
  // subsequent requestAnimationFrame tick -- so collectiblesTotal is
  // always correct before the very first pickup check can run.
  useLayoutEffect(() => {
    setCollectiblesTotal(ALL_SPOTS.length);
    if (import.meta.env.DEV) (window as any).__collectibles = { spots: ALL_SPOTS, collectedAt: collectedAt.current };
  }, [setCollectiblesTotal, ALL_SPOTS]);

  const playPickupSound = useMemo(
    () => () => {
      // Small synthesized "coin" ding -- reuses the same shared
      // AudioContext App.tsx already unlocks on the first click (for the
      // video billboards' PositionalAudio), so no new asset/context is
      // needed just for this.
      try {
        const ctx = THREE.AudioContext.getContext() as unknown as AudioContext;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.22);
      } catch {
        // Audio context not unlocked yet / unavailable -- picking the item
        // up still works, it's just silent.
      }
    },
    []
  );

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const t = state.clock.elapsedTime;
    const storeState = useStore.getState();
    const playerPos = storeState.playerPos;
    const onFoot = storeState.currentControllable === 'player' || storeState.currentControllable === 'combatSoldier';
    const feetY = playerPos[1] - PLAYER_POS_ABOVE_FEET;
    const times = collectedAt.current;

    for (let i = 0; i < ALL_SPOTS.length; i++) {
      const spot = ALL_SPOTS[i];

      if (times[i] < 0) {
        const dx = spot.x - playerPos[0];
        const dz = spot.z - playerPos[2];
        let touching: boolean;
        if (onFoot) {
          const rel = spot.y - feetY;
          touching = dx * dx + dz * dz < PICKUP_RADIUS * PICKUP_RADIUS && rel > PICKUP_BODY_LOW && rel < PICKUP_BODY_HIGH;
        } else {
          const dy = spot.y - playerPos[1];
          touching = dx * dx + dy * dy + dz * dz < PICKUP_VEHICLE_RADIUS * PICKUP_VEHICLE_RADIUS;
        }
        if (touching) {
          times[i] = t;
          collectItem();
          playPickupSound();
        }
      }

      const sinceCollected = times[i] < 0 ? -1 : t - times[i];

      if (sinceCollected >= POP_DURATION) {
        // Fully collected and animation finished -- scale to nothing and
        // skip, cheapest possible steady state for the rest of the game.
        _dummy.scale.setScalar(0);
        _dummy.position.set(spot.x, spot.y, spot.z);
        _dummy.rotation.set(0, 0, 0);
        _dummy.updateMatrix();
        mesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }

      if (sinceCollected >= 0) {
        // Popping: quick rise + shrink over POP_DURATION.
        const p = sinceCollected / POP_DURATION;
        _dummy.position.set(spot.x, spot.y + p * 1.6, spot.z);
        _dummy.rotation.set(0, t * SPIN_SPEED * 3, 0);
        _dummy.scale.setScalar(Math.max(0, 1 - p));
      } else {
        // Idle: gentle bob + spin, phase offset per-instance so they
        // don't all bounce in lockstep.
        const phase = i * 0.7;
        const bobY = Math.sin(t * BOB_SPEED + phase) * BOB_AMPLITUDE;
        _dummy.position.set(spot.x, spot.y + bobY, spot.z);
        _dummy.rotation.set(0, t * SPIN_SPEED, 0);
        _dummy.scale.setScalar(1);
      }
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;

  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined as any, undefined as any, ALL_SPOTS.length]}
      key={ALL_SPOTS.length}
      frustumCulled={false}
      castShadow
    >
      <octahedronGeometry args={[0.4, 0]} />
      <meshStandardMaterial
        color="#ffd54a"
        emissive="#ffaa00"
        emissiveIntensity={1.1}
        metalness={0.3}
        roughness={0.25}
      />
    </instancedMesh>
  );
};

export default Collectibles;
