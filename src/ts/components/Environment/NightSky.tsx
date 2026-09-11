import React, { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getSunDirection, getDayFactor } from '../../lib/SunCycle';

// "Notte vera con stelle e luna" -- before this, the sky dome shader
// dimmed toward black at night (and only partway, see SunCycle.ts's fix
// to the elevation formula this now actually reaches) but nothing filled
// the dark sky in: no stars, no moon, so the day/night cycle only really
// showed up as "the sky got dimmer", not as an actual night. Both fade in
///out with the same getDayFactor() every other new sky/lighting piece
// uses, so they appear exactly as the sun crosses the horizon and the
// directional light/fog are already dimming to match.
const STAR_COUNT = 2000;
const SPHERE_RADIUS = 900;

// Soft radial-gradient disc, same technique Clouds.tsx already uses for
// its cloud sprites -- reused here for a moon glow instead of a hard-
// edged flat circle.
const createMoonTexture = (): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,250,235,1)');
  gradient.addColorStop(0.35, 'rgba(255,248,225,0.9)');
  gradient.addColorStop(0.7, 'rgba(255,244,210,0.25)');
  gradient.addColorStop(1, 'rgba(255,244,210,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return new THREE.CanvasTexture(canvas);
};

const NightSky: React.FC = () => {
  const { camera } = useThree();
  const starsRef = useRef<THREE.Points>(null);
  const starsMatRef = useRef<THREE.PointsMaterial>(null);
  const moonRef = useRef<THREE.Sprite>(null);
  const moonMatRef = useRef<THREE.SpriteMaterial>(null);
  const moonTexture = useMemo(() => createMoonTexture(), []);

  // Uniform-on-a-sphere distribution (not naive lat/long random, which
  // clusters points at the poles) -- generated once, positions never
  // change, only the whole group is recentered on the camera every frame
  // (same trick Sky.tsx uses for its dome) so stars read as infinitely
  // far away regardless of how far the player wanders.
  const starPositions = useMemo(() => {
    const positions = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      positions[i * 3] = SPHERE_RADIUS * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = SPHERE_RADIUS * Math.cos(phi);
      positions[i * 3 + 2] = SPHERE_RADIUS * Math.sin(phi) * Math.sin(theta);
    }
    return positions;
  }, []);

  useFrame((state) => {
    const dir = getSunDirection(state.clock.elapsedTime);
    const dayFactor = getDayFactor(dir.y);
    const nightFactor = 1 - dayFactor;

    if (starsRef.current) {
      starsRef.current.position.copy(camera.position);
    }
    if (starsMatRef.current) {
      // Fades in well before full dayFactor=0 so stars are already out
      // by the time the sky is properly dark, not popping in at the last
      // instant.
      starsMatRef.current.opacity = nightFactor;
    }

    if (moonRef.current) {
      // Opposite side of the sky from the sun -- a common convention
      // (not always astronomically exact, but reads correctly for a
      // day/night cycle: moon up when the sun's down).
      moonRef.current.position
        .copy(camera.position)
        .addScaledVector(dir, -SPHERE_RADIUS * 0.9);
    }
    if (moonMatRef.current) {
      moonMatRef.current.opacity = nightFactor;
    }
  });

  return (
    <>
      <points ref={starsRef} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[starPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={starsMatRef}
          color="#ffffff"
          size={2.2}
          sizeAttenuation
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      <sprite ref={moonRef} scale={[70, 70, 1]} frustumCulled={false}>
        <spriteMaterial
          ref={moonMatRef}
          map={moonTexture}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
    </>
  );
};

export default NightSky;
