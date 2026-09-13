import React, { useMemo } from 'react';
import * as THREE from 'three';

// "aggiungi i pianeti gia presenti" -- ported from the old pre-React engine
// (src/ts/world/Planet.ts + PlanetsGenerator.ts, both excluded from
// tsconfig.json's include list -- dead code, never actually reachable from
// the current React/R3F app, which is why nothing showed up when this was
// grepped for). Faithful to the original's own numbers (3 planets, size
// 50-100, scattered across a +/-750 x/z, y 200-400 box, random per-planet
// color, a noisy canvas texture) -- just re-expressed as a plain R3F
// component instead of a THREE.Mesh + CANNON.Body pair hand-managed by the
// old World/EntityManager.
//
// Deliberately visual-only, no physics body (the original's was a static,
// mass:0 CANNON.Sphere -- effectively unreachable background dressing
// anyway, since +/-750 is well past the terrain's own +/-300 boundary
// walls, see Terrain.tsx). Given this whole session's running lesson about
// hidden colliders turning into unexpected "walls" (the terrain edge, the
// old sidewalk lip), a decorative sky object floating in a spot nothing
// should ever physically reach is exactly the case for skipping a
// collider entirely rather than adding one nothing was asked to use.
//
// Rendered unconditionally in Scene.tsx (like Ocean) -- sky backdrop, not
// a "distrazione" that competes with a vehicle test's own physics/render
// budget, so it stays visible even in the clean test scenarios.
const PLANET_COUNT = 3;
const PLANET_SIZE_BASE = 50;
const PLANET_SIZE_RANDOM = 50;
const PLANET_POSITION_RANDOM_X = 1500;
const PLANET_POSITION_BASE_Y = 200;
const PLANET_POSITION_RANDOM_Y = 200;
const PLANET_POSITION_RANDOM_Z = 1500;

interface PlanetDef {
  position: [number, number, number];
  size: number;
  texture: THREE.CanvasTexture;
}

// 1:1 port of Planet.ts's createPlanetTexture: a flat base color plus a
// scatter of low-alpha white dots for a bit of surface noise/craters,
// instead of a flat, obviously-fake solid sphere.
function createPlanetTexture(color: THREE.Color): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = `#${color.getHexString()}`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 1000; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const alpha = Math.random() * 0.2;
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, Math.random() * 2, 0, Math.PI * 2);
    ctx.fill();
  }

  return new THREE.CanvasTexture(ctx.canvas);
}

const Planets: React.FC = () => {
  // Generated once per mount, same as the original (a fresh Math.random()
  // roll for color/size/position every time PlanetsGenerator.generate()
  // ran) -- no fixed seed, so the sky's planets differ from one session to
  // the next, matching the old behavior rather than "fixing" it into
  // something deterministic nobody asked for.
  const planets = useMemo<PlanetDef[]>(() => {
    return Array.from({ length: PLANET_COUNT }, () => {
      const color = new THREE.Color(Math.random(), Math.random(), Math.random());
      const size = PLANET_SIZE_BASE + Math.random() * PLANET_SIZE_RANDOM;
      const position: [number, number, number] = [
        (Math.random() - 0.5) * PLANET_POSITION_RANDOM_X,
        PLANET_POSITION_BASE_Y + Math.random() * PLANET_POSITION_RANDOM_Y,
        (Math.random() - 0.5) * PLANET_POSITION_RANDOM_Z,
      ];
      return { position, size, texture: createPlanetTexture(color) };
    });
  }, []);

  return (
    <group>
      {planets.map((p, i) => (
        // renderOrder -1, matching the original's "render planets behind
        // clouds" comment.
        <mesh key={i} position={p.position} renderOrder={-1}>
          <sphereGeometry args={[p.size, 32, 32]} />
          <meshBasicMaterial map={p.texture} fog={false} />
        </mesh>
      ))}
    </group>
  );
};

export default Planets;
