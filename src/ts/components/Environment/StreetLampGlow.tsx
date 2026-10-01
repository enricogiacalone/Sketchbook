import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getTerrainHeight } from './Terrain';
import { getSunDirection, getDayFactor } from '../../lib/SunCycle';
import { STREET_LIGHT_POSITIONS, STREET_LIGHT_POLE_HEIGHT } from './Road';
import { LAMP_POSITIONS, PARK_LAMP_POLE_HEIGHT } from './Park';

// "la citta nn e colpita dai lampioni.. cioe nn irraggiano luce" -- the
// emissive streetlamp bulb material (Road.tsx/Park.tsx, streetLampBulbMaterial)
// only ever made the bulb MESH glow -- it was never a real light source, so
// nothing near a lamp actually got lit. That was deliberate: see the big
// comment on StreetLight in Road.tsx -- a real <pointLight> per lamp across
// the ~100-107 lamps in the city was "almost certainly the single biggest
// cost in the whole scene" (three.js evaluates every light in the scene for
// every lit fragment on every mesh, so per-lamp lights don't scale with
// lamp count).
//
// Light pooling is the standard fix for "many light sources, small light
// budget": keep a small FIXED pool of real, non-shadow-casting point
// lights, and every frame reposition them onto the N lamps nearest the
// camera. Distant lamps just don't get a real light -- at a distance where
// you can barely see the lamp itself, you can't tell the ground under it
// isn't lit either. Cost stays flat at POOL_SIZE real lights no matter how
// many hundred lamps exist in the world.
const POOL_SIZE = 10;
const LIGHT_DISTANCE = 16;
// Same fix as BuildingLedGlow.tsx: three.js's default decay=2 (inverse-
// square, "physically correct" candela units) needs intensity in the
// hundreds to be visible at all more than a couple units out -- a plain
// intensity=9 at decay=2 was almost certainly rendering as imperceptible,
// same failure mode later confirmed live on the building LEDs ("i led
// devono emettere luce" -> "nn si vedono"). decay=1 (illuminance ~ 1/d
// instead of 1/d^2) plus a real candela bump actually lights the ground
// under/near a lamp instead of only the lamp's own emissive bulb mesh
// being visible.
const LIGHT_DECAY = 1;
const LIGHT_INTENSITY = 70;
const LIGHT_COLOR = '#ffcf70';

interface LampPos {
  x: number;
  y: number;
  z: number;
}

// Computed ONCE at import time (same module-scope-IIFE trick as Road.tsx's
// ROAD_OFFSETS / City.tsx's CITY_LAYOUT) -- combines every Road.tsx
// intersection lamp (~100, STREET_LIGHT_POSITIONS) and every Park.tsx lamp
// (8, LAMP_POSITIONS) into one flat list of world positions, bulb height
// included, so the per-frame nearest-neighbor search below has nothing
// left to do but compare distances.
const ALL_LAMPS: LampPos[] = [
  ...STREET_LIGHT_POSITIONS.map(({ x, z }) => ({
    x,
    z,
    y: getTerrainHeight(x, z) + STREET_LIGHT_POLE_HEIGHT,
  })),
  ...LAMP_POSITIONS.map(([x, z]) => ({
    x,
    z,
    y: getTerrainHeight(x, z) + PARK_LAMP_POLE_HEIGHT + 0.15,
  })),
];

// Scratch array, sorted in place every frame -- avoids allocating a fresh
// array 60 times a second just to find the nearest POOL_SIZE lamps.
const _sorted: LampPos[] = [...ALL_LAMPS];

// Mounted exactly once (in App.tsx, alongside SunLight/WorldFog/NightSky).
const StreetLampGlow: React.FC = () => {
  const { camera } = useThree();
  const lightRefs = useRef<Array<THREE.PointLight | null>>([]);

  useFrame((state) => {
    const dir = getSunDirection(state.clock.elapsedTime);
    const dayFactor = getDayFactor(dir.y);
    const nightFactor = 1 - dayFactor;

    // Daytime: every pool light OFF *and* invisible. Setting intensity=0
    // alone still leaves the light registered with three.js's renderer,
    // which evaluates every visible light in the scene for every lit
    // fragment on every mesh regardless of its intensity -- "ok ma dobbiamo
    // ottimizzare le performance perche e rallentato il gioco" traced back
    // to exactly this (see BuildingLedGlow.tsx's own note): intensity=0
    // was paying the full per-light shader cost 24/7, day included.
    // light.visible=false actually drops it from that per-frame light
    // list, so daytime -- most of the play session -- now costs nothing
    // for either pool.
    if (nightFactor <= 0.01) {
      for (const light of lightRefs.current) {
        if (light) { light.intensity = 0; light.visible = false; }
      }
      return;
    }

    const camX = camera.position.x;
    const camZ = camera.position.z;
    _sorted.sort((a, b) => {
      const da = (a.x - camX) * (a.x - camX) + (a.z - camZ) * (a.z - camZ);
      const db = (b.x - camX) * (b.x - camX) + (b.z - camZ) * (b.z - camZ);
      return da - db;
    });

    for (let i = 0; i < POOL_SIZE; i++) {
      const light = lightRefs.current[i];
      if (!light) continue;
      const lamp = _sorted[i];
      if (!lamp) {
        light.intensity = 0;
        light.visible = false;
        continue;
      }
      light.visible = true;
      light.position.set(lamp.x, lamp.y, lamp.z);
      light.intensity = nightFactor * LIGHT_INTENSITY;
    }
  });

  return (
    <>
      {Array.from({ length: POOL_SIZE }).map((_, i) => (
        <pointLight
          key={i}
          ref={(el) => {
            lightRefs.current[i] = el;
          }}
          color={LIGHT_COLOR}
          distance={LIGHT_DISTANCE}
          decay={LIGHT_DECAY}
          intensity={0}
          castShadow={false}
        />
      ))}
    </>
  );
};

export default StreetLampGlow;
