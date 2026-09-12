import React, { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getSunDirection, getDayFactor, getWarmth } from '../../lib/SunCycle';

// The actual lighting rig behind the sky dome -- "sistemiamo il cielo...
// sole vero collegato alla luce". Before this, the sky shader computed a
// full day/night sun position that NOTHING in the scene actually used:
// lighting was one fixed pointLight + a flat ambientLight(0.5), both
// constant no matter what the sky looked like (see git history / chat).
// This replaces both with:
//  - a directionalLight that tracks the same sun direction as the sky
//    dome, casts real shadows, and shifts color (warm near the horizon,
//    neutral at noon) and intensity (bright by day, near-zero at night)
//  - a hemisphereLight for ambient fill (sky-color from above, ground-
//    color from below) that dims and cools off at night instead of
//    staying a flat constant -- this is what actually makes "night" read
//    as dark rather than just a dark dome over a daylit-looking city.
//
// The directional light's position is re-centered on the camera every
// frame (offset along the sun direction) rather than fixed at some world
// coordinate -- this is a large open world, so a shadow camera frustum
// sized for the whole map would have terrible texel density; following
// the camera keeps the (necessarily limited-range) shadow frustum useful
// wherever the player actually is, the standard trick for this without
// going as far as full cascaded shadow maps.
const SHADOW_DISTANCE = 120;
const SHADOW_FRUSTUM = 90;

const SunLight: React.FC = () => {
  const { camera } = useThree();
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const moonLightRef = useRef<THREE.DirectionalLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const lightColor = useMemo(() => new THREE.Color(), []);
  const skyColor = useMemo(() => new THREE.Color(), []);
  const groundColor = useMemo(() => new THREE.Color(), []);

  useFrame((state) => {
    const dir = getSunDirection(state.clock.elapsedTime);
    const dayFactor = getDayFactor(dir.y);
    const warmth = getWarmth(dir.y);

    if (lightRef.current) {
      const light = lightRef.current;
      light.position.set(
        camera.position.x + dir.x * SHADOW_DISTANCE,
        camera.position.y + dir.y * SHADOW_DISTANCE,
        camera.position.z + dir.z * SHADOW_DISTANCE
      );
      target.position.copy(camera.position);
      light.target = target;

      // Warm orange near the horizon (sunrise/sunset), cooling toward
      // neutral white as the sun climbs toward zenith.
      lightColor.setRGB(1, THREE.MathUtils.lerp(1, 0.78, warmth), THREE.MathUtils.lerp(1, 0.55, warmth));
      light.color.copy(lightColor);
      // Bright by day, off at night -- moonlight (below) and the
      // hemisphere ambient carry night visibility instead.
      light.intensity = THREE.MathUtils.lerp(0, 2.0, dayFactor);
    }

    // "un po' di luce lunare" -- a second, cheap directional light (no
    // shadow map of its own, so it's basically free next to the real sun
    // light above) shining from the OPPOSITE direction, matching where
    // NightSky.tsx's moon sprite actually sits. Fades in as the sun goes
    // down and out again by day, giving night scenes a bit of directional
    // definition instead of flat ambient-only darkness.
    if (moonLightRef.current) {
      const moon = moonLightRef.current;
      moon.position.set(
        camera.position.x - dir.x * SHADOW_DISTANCE,
        camera.position.y - dir.y * SHADOW_DISTANCE,
        camera.position.z - dir.z * SHADOW_DISTANCE
      );
      moon.target = target;
      moon.intensity = (1 - dayFactor) * 0.3;
    }

    if (hemiRef.current) {
      const hemi = hemiRef.current;
      // Sky-color fill tints toward the same warm tone at sunset/sunrise,
      // and drops to a dim cool blue at night instead of going fully
      // black -- a real night sky still has some ambient moon/starlight.
      skyColor.setRGB(
        THREE.MathUtils.lerp(0.05, 0.55, dayFactor),
        THREE.MathUtils.lerp(0.06, THREE.MathUtils.lerp(0.55, 0.75, 1 - warmth), dayFactor),
        THREE.MathUtils.lerp(0.12, THREE.MathUtils.lerp(0.55, 0.95, 1 - warmth), dayFactor)
      );
      groundColor.setRGB(
        THREE.MathUtils.lerp(0.03, 0.25, dayFactor),
        THREE.MathUtils.lerp(0.03, 0.22, dayFactor),
        THREE.MathUtils.lerp(0.04, 0.18, dayFactor)
      );
      hemi.color.copy(skyColor);
      hemi.groundColor.copy(groundColor);
      hemi.intensity = THREE.MathUtils.lerp(0.15, 0.9, dayFactor);
    }
  });

  return (
    <>
      <primitive object={target} />
      <directionalLight
        ref={lightRef}
        castShadow
        // "serve ottimizzare ancora" -- this shadow map can't be cached
        // frame-to-frame like a static one: the camera-following recenter
        // above means its position/target genuinely change every frame, so
        // three.js has to fully redraw it every frame no matter what.
        // Halving the resolution (2048 -> 1024) cuts that redraw cost to a
        // quarter for a real, ongoing per-frame cost, at the price of
        // slightly blockier shadow edges -- a good trade given this is the
        // one shadow-casting light in the whole scene running every frame.
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-SHADOW_FRUSTUM}
        shadow-camera-right={SHADOW_FRUSTUM}
        shadow-camera-top={SHADOW_FRUSTUM}
        shadow-camera-bottom={-SHADOW_FRUSTUM}
        shadow-camera-near={1}
        shadow-camera-far={400}
        shadow-bias={-0.0006}
      />
      <directionalLight ref={moonLightRef} color="#aabfff" />
      <hemisphereLight ref={hemiRef} />
    </>
  );
};

export default SunLight;
