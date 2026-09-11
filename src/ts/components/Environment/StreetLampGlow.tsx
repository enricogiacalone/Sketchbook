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
const POOL_SIZE = 16;
const LIGHT_DISTANCE = 13;
const LIGHT_DECAY = 2;
const LIGHT_INTENSITY = 9;
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

    // Daytime: every pool light off, skip the sort entirely.
    if (nightFactor <= 0.01) {
      for (const light of lightRefs.current) {
        if (light) light.intensity = 0;
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
        continue;
      }
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
