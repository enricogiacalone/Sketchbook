import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CITY_LAYOUT } from './City';
import { getSunDirection, getDayFactor } from '../../lib/SunCycle';

// "i led devono emettere luce la notte" -- BuildingLeds.tsx's roofline
// trim only ever made those thin box meshes glow (unlit MeshBasicMaterial,
// same self-lit-only trick as the streetlamp bulbs before StreetLampGlow.tsx
// existed) -- it never actually cast light onto the building's own facade
// or its neighbors. Exactly the same gap, exactly the same fix: light
// pooling instead of one real <pointLight> per building (~70-90 of them,
// which is the same "three.js evaluates every light for every lit
// fragment" cost problem the streetlamps already ran into -- see
// StreetLampGlow.tsx's own comment for the full story).
//
// One light per BUILDING (not per roofline segment -- 4x more, and a
// single light near the roof centre lights the whole trim's surroundings
// well enough), colored with that building's own ledColor so the pooled
// lights actually match the colored trim they're standing in for, sorted
// to the buildings nearest the camera each frame, same as StreetLampGlow.
const POOL_SIZE = 12;
const LIGHT_DISTANCE = 28;
// decay=2 (the physically-"correct" inverse-square falloff three.js
// defaults to) needs intensity in the HUNDREDS-to-THOUSANDS of candela to
// read as visible at all at a 10-20 unit range -- confirmed live: "i led
// devono emettere luce" -> implemented -> "nn si vedono", with intensity
// still at streetlamp-lamp-post scale (~11, tuned for a light sitting
// right next to the ground/player). These sit way up at roof height,
// firing down onto their own building's upper facade from much farther
// away, so they need both a softer falloff (decay=1: illuminance ~ 1/d
// instead of 1/d^2, MUCH brighter at 10+ units for the same intensity
// number) and a real candela bump to actually register after tone
// mapping, rather than trying to brute-force it with decay=2's much
// steeper falloff.
const LIGHT_DECAY = 1;
const LIGHT_INTENSITY = 260;

interface BuildingLightSpot {
  x: number;
  y: number;
  z: number;
  color: THREE.Color;
}

// Computed ONCE at import time (same trick as everywhere else in
// Environment/) -- one light position per building, centered over the
// roof at the same height as its LED trim (BuildingLeds.tsx), using that
// building's own ledColor.
const ALL_BUILDING_LIGHTS: BuildingLightSpot[] = CITY_LAYOUT.buildings.map((b) => ({
  x: b.x,
  y: b.by + b.h + 0.3,
  z: b.z,
  color: new THREE.Color(b.ledColor),
}));

// Scratch array, sorted in place every frame -- avoids allocating a fresh
// array 60 times a second just to find the nearest POOL_SIZE buildings.
const _sorted: BuildingLightSpot[] = [...ALL_BUILDING_LIGHTS];

// Mounted exactly once (in Scene.tsx, alongside BuildingLeds).
const BuildingLedGlow: React.FC = () => {
  const { camera } = useThree();
  const lightRefs = useRef<Array<THREE.PointLight | null>>([]);

  useFrame((state) => {
    const dir = getSunDirection(state.clock.elapsedTime);
    const dayFactor = getDayFactor(dir.y);
    const nightFactor = 1 - dayFactor;

    // Daytime: every pool light OFF *and* invisible -- see StreetLampGlow's
    // matching note. intensity=0 alone still costs the full per-light
    // shader evaluation on every lit fragment in the scene; light.visible
    // = false actually removes it from that list, which is what "ok ma
    // dobbiamo ottimizzare le performance perche e rallentato il gioco"
    // was really asking to fix -- 20+16 real point lights sitting
    // "invisible" at intensity 0 all day were still costing their full
    // per-fragment share the whole time.
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
      const spot = _sorted[i];
      if (!spot) {
        light.intensity = 0;
        light.visible = false;
        continue;
      }
      light.visible = true;
      light.position.set(spot.x, spot.y, spot.z);
      light.color.copy(spot.color);
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
          distance={LIGHT_DISTANCE}
          decay={LIGHT_DECAY}
          intensity={0}
          castShadow={false}
        />
      ))}
    </>
  );
};

export default BuildingLedGlow;
