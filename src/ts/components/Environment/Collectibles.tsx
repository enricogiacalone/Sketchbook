import React, { useMemo, useRef, useLayoutEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getTerrainHeight } from './Terrain';
import { ROAD_OFFSETS } from './Road';
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
const PICKUP_RADIUS = 1.7;
// "quando il personaggio entra si sente subito che prende un collectable
// prima di toccare terra" / "ora ci cade sopra ma nn lo prende" -- a pure
// 3D-distance check can't tell "resting at the right height" apart from
// "passing through it mid-fall", and a fixed post-spawn timer can't win
// either way (expires too early if still falling, or too late once the
// player's already walked off from PICKUP_RADIUS=1.7 at normal move
// speed). The actual fix needed real ground-state info: store.ts's
// isPlayerGrounded now mirrors Player.tsx's own isGrounded ref every
// frame (see there), so this can gate on the real thing instead of
// guessing a duration.
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

// Computed ONCE at import time, same module-level-IIFE trick as
// Road.tsx's ROAD_OFFSETS / City.tsx's CITY_LAYOUT -- one canonical list of
// every pickup in the world, independent of this component's own
// mount/unmount.
const ALL_SPOTS: CollectibleSpot[] = (() => {
  const spots: CollectibleSpot[] = [];

  // One per street intersection (7x7 grid, ROAD_OFFSETS) -- floating above
  // the crosswalk, clear of the streetlight/traffic-light poles which sit
  // at the diagonal corners, not the center.
  for (const ox of ROAD_OFFSETS) {
    for (const oz of ROAD_OFFSETS) {
      spots.push({ id: `street-${ox}-${oz}`, x: ox, z: oz, y: getTerrainHeight(ox, oz) + 1.3 });
    }
  }

  // A handful inside the park (block (0,0), roughly x/z in [9,51] -- see
  // Park.tsx's AREA_MIN/AREA_MAX), spaced away from the fountain at the
  // center and from Park.tsx's own LAMP_POSITIONS.
  const parkSpots: Array<[number, number]> = [
    [18, 18], [42, 18], [18, 42], [42, 42],
    [30, 16], [30, 44], [16, 30], [44, 30],
  ];
  for (const [x, z] of parkSpots) {
    spots.push({ id: `park-${x}-${z}`, x, z, y: getTerrainHeight(x, z) + 1.2 });
  }

  // One on the roof of the tallest building in each courtyard block --
  // reachable only by actually climbing the stairs (getBuildingHeightOffset
  // in City.tsx), as a payoff for exploring buildings top to bottom.
  for (const c of CITY_LAYOUT.courtyards) {
    let tallest: (typeof CITY_LAYOUT.buildings)[number] | null = null;
    for (const b of CITY_LAYOUT.buildings) {
      if (Math.hypot(b.x - c.x, b.z - c.z) > 30) continue;
      if (!tallest || b.h > tallest.h) tallest = b;
    }
    if (tallest) {
      spots.push({
        id: `roof-${c.x}-${c.z}`,
        x: tallest.x,
        z: tallest.z,
        y: tallest.by + tallest.h + 1.0,
      });
    }
  }

  // A couple in each open plaza.
  for (const p of CITY_LAYOUT.plazas) {
    for (const [dx, dz] of [[-5, 0], [5, 0]] as const) {
      const x = p.x + dx;
      const z = p.z + dz;
      spots.push({ id: `plaza-${p.x}-${p.z}-${dx}`, x, z, y: getTerrainHeight(x, z) + 1.2 });
    }
  }

  return spots;
})();

const _dummy = new THREE.Object3D();

const Collectibles: React.FC = () => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  // Per-instance collection timestamp (elapsed seconds), -1 while still
  // uncollected. Kept OUTSIDE React state -- this needs to change every
  // frame during the brief pop animation without triggering re-renders,
  // exactly like every other instancedMesh animation in Environment/.
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
  }, [setCollectiblesTotal]);

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
    const isGrounded = storeState.isPlayerGrounded;
    const times = collectedAt.current;

    // TEMP DEBUG (Claude) -- "ci passo attraverso e nn lo raccoglie" but
    // the pickup math here looks correct on paper (distance check against
    // the exact same spot.x/y/z used for the render matrix below, so
    // "passing through visually" should mean "within PICKUP_RADIUS"). Can't
    // browser-test this myself (standing instruction), so exposing the
    // live nearest-uncollected-spot distance for a console check instead
    // of guessing further -- window.__collectibleDebug in devtools while
    // standing on/near one. Remove once the real cause is found.
    let __nearestId = "";
    let __nearestDist = Infinity;

    for (let i = 0; i < ALL_SPOTS.length; i++) {
      const spot = ALL_SPOTS[i];
      const collectedTime = times[i];

      if (collectedTime < 0) {
        const dx = spot.x - playerPos[0];
        const dy = spot.y - playerPos[1];
        const dz = spot.z - playerPos[2];
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < __nearestDist) {
          __nearestDist = distSq;
          __nearestId = spot.id;
        }
        if (isGrounded && distSq < PICKUP_RADIUS * PICKUP_RADIUS) {
          times[i] = t;
          collectItem();
          playPickupSound();
          if (import.meta.env.DEV) {
            // Direct instrumentation of the actual STORE values right after
            // collectItem() -- the earlier __collectibleDebug's "totalSpots"
            // was ALL_SPOTS.length (a local constant, always 43), NOT
            // state.collectiblesTotal, so it couldn't actually reveal
            // whether the store's own total/found were the real problem.
            // This logs unconditionally, exactly once per real pickup --
            // no proximity timing needed, just walk over one.
            const s = useStore.getState();
            // eslint-disable-next-line no-console
            console.log('[collectible PICKED UP]', spot.id, 'store now: found=', s.collectiblesFound, 'total=', s.collectiblesTotal);
          }
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

    if (import.meta.env.DEV) {
      const s = useStore.getState();
      const debugSnapshot = {
        playerPos: [...playerPos],
        nearestId: __nearestId,
        nearestDist: Math.sqrt(__nearestDist),
        pickupRadius: PICKUP_RADIUS,
        // Real store values now (was ALL_SPOTS.length before, a local
        // constant that's always 43 regardless of whether the STORE's own
        // total ever actually got set -- couldn't tell us anything about
        // the real bug).
        storeFound: s.collectiblesFound,
        storeTotal: s.collectiblesTotal,
        isGrounded: s.isPlayerGrounded,
      };
      (window as any).__collectibleDebug = debugSnapshot;
      // A single manual console read of __collectibleDebug is easy to miss
      // by the time you've actually walked onto one (nearestDist was 9+
      // last time -- nowhere near a pickup, so that snapshot just wasn't
      // taken at the right instant). Auto-logging a few times a second
      // ONLY while genuinely close means the real moment of passing
      // through shows up in the console history on its own, no perfect
      // timing needed -- just walk over one, then scroll back/search the
      // console for "collectible debug".
      if (debugSnapshot.nearestDist < 3 && t % 0.2 < 0.02) {
        // eslint-disable-next-line no-console
        console.log('[collectible debug]', debugSnapshot);
      }
    }
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined as any, undefined as any, ALL_SPOTS.length]}
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
