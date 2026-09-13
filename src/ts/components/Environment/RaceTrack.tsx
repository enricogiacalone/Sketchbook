import React, { useMemo } from 'react';
import * as THREE from 'three';
import { RigidBody, CylinderCollider } from '@react-three/rapier';
import { CollisionGroups, groupsExcluding } from '../../enums/CollisionGroups';

// "ora crea uno scenario corsa in auto.. una gara contro 3 poliziotti in un
// percorso con curve e dossi" -- a dedicated closed-loop race track, driven
// on Scene.tsx's testScene==='race' (see there and debug/simDebug.ts's
// startRace()). Reuses Car.tsx's existing `patrolRoute` AI (the same
// waypoint-follower the city's 2 patrol police already use) for the 3
// police racers, so this file only has to define the TRACK GEOMETRY --
// where the road is, where the bumps are -- not any new driving logic.
//
// Layout: a rounded rectangle (corner radius 45) with two chicane
// insertions (right + top straights) for actual curves, not 4 sharp
// 90-degree turns like Scene.tsx's own POLICE_ROUTE_OUTER. Deliberately
// kept at z >= -180 -- comfortably clear of the airport (runway z
// -251..-269, heliport z=-260, see Airport.tsx's RUNWAY_CENTER/
// HELIPORT_CENTER) -- and within +/-240 on x / +/-180..260 on z, well
// inside the terrain's +/-300 boundary walls (see Terrain.tsx, "l'auto e'
// caduta dal piano dove circolava") with a wide margin on every side.
// Renders only while testScene==='race' (isCleanTest), so there's no city/
// traffic/collectibles sharing the ground with it -- same "senza citta e
// distrazioni" treatment as the airplane/helicopter/car test scenarios.
export const TRACK_WIDTH = 20;

// Waypoints (x, z), generated as: 4 rounded corners (radius 45, 6 arc
// segments each) plus one 2-point chicane spliced into the right straight
// and one into the top straight. The gap between the last point and the
// first (both on the bottom edge, z=-180) IS the long start/finish
// straight -- see RACE_GRID below, patrolRoute wraps index N-1 -> 0
// automatically (Car.tsx).
export const RACE_TRACK: [number, number][] = [
  [195.0, -180.0],
  [206.6, -178.5],
  [217.5, -174.0],
  [226.8, -166.8],
  [234.0, -157.5],
  [238.5, -146.6],
  [240.0, -135.0],
  [205.0, 10.0],
  [240.0, 70.0],
  [238.5, 226.6],
  [234.0, 237.5],
  [226.8, 246.8],
  [217.5, 254.0],
  [206.6, 258.5],
  [195.0, 260.0],
  [30.0, 225.0],
  [-30.0, 260.0],
  [-206.6, 258.5],
  [-217.5, 254.0],
  [-226.8, 246.8],
  [-234.0, 237.5],
  [-238.5, 226.6],
  [-240.0, 215.0],
  [-238.5, -146.6],
  [-234.0, -157.5],
  [-226.8, -166.8],
  [-217.5, -174.0],
  [-206.6, -178.5],
  [-195.0, -180.0],
];

// Starting grid -- a SINGLE ROW, all 4 cars at the same x, side by side
// across 4 lanes in z. Originally this was a 2x2 grid (2 rows, front/back
// in x) -- caught live (window.__sim telemetry): with every car facing +X
// and the 3 AI cops gunning it for RACE_TRACK[0] the instant they spawn
// (every Car's aiTargetIndex starts at 0, see Car.tsx), a "back row" car
// shared its EXACT lane (z) with a "front row" car directly ahead of it in
// the travel direction -- the back car accelerated straight into the
// front one from behind and launched it hundreds of units down the
// straight before the player had touched a key. A single row side by side
// means no car ever starts in front of another along the direction of
// travel, so there's nothing to rear-end at the start. Facing +X matches
// this codebase's own convention for "rotation aligned with a route's
// first leg" (see Scene.tsx's POLICE_ROUTE rotation comment). All 4 lanes
// sit inside TRACK_WIDTH's +/-10 corridor around z=-180 with margin to
// spare.
export const RACE_START_ROTATION: [number, number, number] = [0, Math.PI / 2, 0];
export const RACE_GRID = {
  player: [-150, 1.2, -187] as [number, number, number],
  cop1: [-150, 1.2, -181] as [number, number, number],
  cop2: [-150, 1.2, -175] as [number, number, number],
  cop3: [-150, 1.2, -169] as [number, number, number],
};

// Speed bumps ("dossi") -- deliberately placed ONLY on the two long,
// axis-aligned straights (bottom start/finish straight, travel along X;
// the long right-side straight after the chicane, travel along Z), so a
// bump's cylinder axis just needs a single 90-degree rotation around a
// cardinal axis to lie flat crossing the track -- no per-bump yaw/heading
// math. A half-buried CylinderCollider gives a smooth, continuously curved
// ramp a wheel rolls up and over -- deliberately NOT a CuboidCollider,
// whose flat vertical face is exactly what turned the old missing terrain
// boundary / the sidewalk's original 0.15 lip into a car-flinging "wall"
// (see Terrain.tsx / git history, "l'auto ... si e' ribaltata"/"ci sbatto
// con l'auto"). Kept away from the start grid and from the corner-slowdown
// zones near each waypoint (see Car.tsx's PATROL_CORNER_SLOWDOWN_DIST) so
// a bump is never also where a cop is trying to brake into a turn.
const BUMP_RADIUS = 1.4;
const BUMP_RISE = 0.16; // how far the bump's crest pokes above the flat ground (y=0)
const BUMP_CENTER_Y = -BUMP_RADIUS + BUMP_RISE;
type Bump = { pos: [number, number]; axis: 'x' | 'z' };
const BUMPS: Bump[] = [
  // Bottom straight (z=-180, travel along +X) -- axis along Z.
  { pos: [-100, -180], axis: 'z' },
  { pos: [40, -180], axis: 'z' },
  { pos: [130, -180], axis: 'z' },
  // Long right straight (x~239, travel along +Z) -- axis along X.
  { pos: [239, 100], axis: 'x' },
  { pos: [239, 150], axis: 'x' },
  { pos: [239, 200], axis: 'x' },
];

// Flat asphalt-colored ribbon following RACE_TRACK, purely a visual guide
// (double-sided so per-triangle winding doesn't matter) -- the actual
// driving surface underneath is still Terrain.tsx's own flat, already-
// collidable ground; this never adds a second physics surface, only paint.
function buildRibbonGeometry(): THREE.BufferGeometry {
  const half = TRACK_WIDTH / 2;
  const n = RACE_TRACK.length;
  const positions: number[] = [];
  const indices: number[] = [];
  const dir = new THREE.Vector2();
  const perp = new THREE.Vector2();

  for (let i = 0; i < n; i++) {
    const [x0, z0] = RACE_TRACK[i];
    const [x1, z1] = RACE_TRACK[(i + 1) % n];
    dir.set(x1 - x0, z1 - z0).normalize();
    perp.set(-dir.y, dir.x).multiplyScalar(half);

    const base = positions.length / 3;
    positions.push(
      x0 + perp.x, 0.03, z0 + perp.y,
      x0 - perp.x, 0.03, z0 - perp.y,
      x1 - perp.x, 0.03, z1 - perp.y,
      x1 + perp.x, 0.03, z1 + perp.y
    );
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const RaceTrack: React.FC = () => {
  const ribbonGeometry = useMemo(() => buildRibbonGeometry(), []);
  // Stripe sits on the track's own centerline (z=-180 -- see RACE_TRACK's
  // bottom edge), NOT derived from any one car's individual starting lane
  // (RACE_GRID's 4 lanes straddle z=-180 symmetrically), so it visually
  // crosses squarely in front of the whole starting row.
  const [gridX] = RACE_GRID.player;
  const gridZ = -180;

  return (
    <group>
      <mesh geometry={ribbonGeometry} receiveShadow>
        <meshStandardMaterial color="#4a4a4a" roughness={0.95} side={THREE.DoubleSide} />
      </mesh>

      {/* Start/finish stripe -- a short (3-unit) band crossing the full
          TRACK_WIDTH, centered just ahead of the grid. This straight runs
          along +X (see RACE_START_ROTATION), so the stripe's short side
          (3) stays along local X (world X after the flattening rotation
          below) and its long side (TRACK_WIDTH) becomes the one that maps
          to world Z, i.e. actually crosses the track instead of running
          along it. */}
      <mesh position={[gridX + 8, 0.04, gridZ]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[3, TRACK_WIDTH]} />
        <meshStandardMaterial color="#ffffff" side={THREE.DoubleSide} />
      </mesh>

      {BUMPS.map((b, i) => (
        <RigidBody
          key={i}
          type="fixed"
          colliders={false}
          position={[b.pos[0], BUMP_CENTER_Y, b.pos[1]]}
          rotation={b.axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, Math.PI / 2]}
          friction={0.9}
          restitution={0}
        >
          <CylinderCollider
            args={[TRACK_WIDTH / 2, BUMP_RADIUS]}
            collisionGroups={groupsExcluding(CollisionGroups.Default)}
          />
        </RigidBody>
      ))}
    </group>
  );
};

export default RaceTrack;
