import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RigidBody, TrimeshCollider, CylinderCollider } from '@react-three/rapier';
import { getTerrainHeight } from './Terrain';
import { CollisionGroups, groupsExcluding } from '../../enums/CollisionGroups';
import { getSunDirection, getDayFactor } from '../../lib/SunCycle';
import { StaticInstances, type InstanceXform } from './StaticInstances';

// Shared road-grid layout, also consumed by Player.tsx (getRoadOffset) so the
// character's manual ground-snapping agrees with the actual road geometry
// instead of relying on physics contact response (see Player.tsx for why).
export const ROAD_SIZE = 600;
export const ROAD_GRID_SPACING = 60;
export const ROAD_WIDTH = 8;
export const ROAD_Y_OFFSET = 0.15;
export const SIDEWALK_WIDTH = 1.5;
// Lowered from 0.15 (Claude): the vehicle controller's wheel raycasts
// don't simulate real curb-climbing -- combined with the chassis now
// physically colliding with the ground (see the car-flip fix above), a
// full 0.15 step right at the road edge acted like a solid wall the car
// would slam into instead of bumping over, any time a wheel drifted even
// slightly off the road (see git history / chat: "ci sbatto con l'auto").
// A much shallower lip still reads visually as a curb without stopping
// the car dead.
export const SIDEWALK_HEIGHT = 0.04;
// How far down (world units) the road/sidewalk slabs extrude below their
// own top surface. Both used to be single infinitely-thin planes sitting
// ON TOP of the terrain -- fine from directly above, but at a grazing
// angle (walking/driving right up to a curb, or looking along the road
// edge) you could see straight under the paper-thin mesh into the gap
// between it and the terrain surface below, since nothing filled that gap
// in (see git history / chat: "non sono piani senza spessore"). 1.0 is
// comfortably more than the +0.15/+0.30 the road/sidewalk sit above the
// terrain, so the slab's underside always dips below the actual ground
// surface (even accounting for the terrain's own gentle slope across the
// road's width) no matter where you look from.
export const ROAD_THICKNESS = 1.0;

// "fai la citta piu piccola" -- kept one ring wider than City.tsx's own
// gridRadius (1), same convention as before (was city radius 2 / road
// radius 3): a spare outer perimeter road with no buildings past it.
export const ROAD_OFFSETS: number[] = (() => {
  const arr: number[] = [];
  for (let i = -2; i <= 2; i++) {
    arr.push(i * ROAD_GRID_SPACING);
  }
  return arr;
})();

// Streetlamp world positions across the whole road grid, computed ONCE by
// mirroring the exact placement formula used in Road()'s JSX below (two
// StreetLights per intersection, at the corners diagonal from the traffic
// lights). Needed by StreetLampGlow.tsx (light-pooling: "la citta nn e
// colpita dai lampioni") to know where every lamp bulb is without a real
// per-lamp light living here -- see the removed-pointLight comment on
// StreetLight below for why there isn't one already.
export const STREET_LIGHT_POLE_HEIGHT = 6;
export const STREET_LIGHT_POSITIONS: Array<{ x: number; z: number }> = (() => {
  const positions: Array<{ x: number; z: number }> = [];
  for (const ox of ROAD_OFFSETS) {
    for (const oz of ROAD_OFFSETS) {
      positions.push({ x: ox - ROAD_WIDTH / 2 - 1, z: oz - ROAD_WIDTH / 2 - 1 });
      positions.push({ x: ox + ROAD_WIDTH / 2 + 1, z: oz + ROAD_WIDTH / 2 + 1 });
    }
  }
  return positions;
})();

// Returns the ground surface's extra elevation above the raw terrain height
// at (x, z) -- road, sidewalk, or 0 if the point isn't over either. Mirrors
// the road/sidewalk grid built by <Road />, so this must stay in sync with
// it: Player.tsx's character controller never gets a real physics contact
// response from these trimeshes (see Player.tsx's collisionGroups), it
// snaps its own Y purely from this function, so any patch of ground this
// misses is a patch the character will sink into or hover above instead of
// standing on properly.
// Pavimento piatto che sostituisce strade/marciapiedi dentro un
// rettangolo (la sala delle casse del duello, AudioArena.tsx): li' la
// strada non viene disegnata e il pavimento e' un'unica lastra ad
// altezza costante, quindi chiunque ci cammini deve stare a quella quota.
let flatGroundOverride: { minX: number; maxX: number; minZ: number; maxZ: number; y: number } | null = null;
export const setFlatGroundOverride = (o: typeof flatGroundOverride) => {
  flatGroundOverride = o;
};

export const getRoadOffset = (x: number, z: number): number => {
  const fo = flatGroundOverride;
  if (fo && x >= fo.minX && x <= fo.maxX && z >= fo.minZ && z <= fo.maxZ) return fo.y;
  const half = ROAD_WIDTH / 2;
  const sidewalkOuter = half + SIDEWALK_WIDTH;

  // Roads first, in a full pass -- a road strip and its own sidewalk can
  // never overlap, so this only matters at intersections, where we want
  // the (flatter, lower) road surface to win over a perpendicular road's
  // sidewalk band.
  for (const offset of ROAD_OFFSETS) {
    // Horizontal strip (axis="x"): runs along world X, centered at z = offset
    if (Math.abs(z - offset) <= half) return ROAD_Y_OFFSET;
    // Vertical strip (axis="z"): runs along world Z, centered at x = offset
    if (Math.abs(x - offset) <= half) return ROAD_Y_OFFSET;
  }
  // Then sidewalks -- the band just outside each road strip, both sides.
  for (const offset of ROAD_OFFSETS) {
    const dz = Math.abs(z - offset);
    if (dz > half && dz <= sidewalkOuter) return ROAD_Y_OFFSET + SIDEWALK_HEIGHT;
    const dx = Math.abs(x - offset);
    if (dx > half && dx <= sidewalkOuter) return ROAD_Y_OFFSET + SIDEWALK_HEIGHT;
  }
  return 0;
};

// Extrudes a flat top-surface grid down by `thickness` and closes the
// perimeter with side walls, turning what would otherwise be an
// infinitely-thin plane into a solid slab (see ROAD_THICKNESS above for
// why). `topPositions` must be a row-major grid of `rows` rows by `cols`
// columns -- vertex (r, c) at index r*cols+c -- which is exactly how
// THREE.PlaneGeometry lays its own position attribute out, so every
// caller here can just hand this the top-surface positions it already
// built (after sampling terrain height into Y) with that grid's own
// rows/cols.
function extrudeGrid(
  topPositions: Float32Array,
  rows: number,
  cols: number,
  thickness: number
): { positions: Float32Array; indices: Uint32Array } {
  const n = rows * cols;
  const positions = new Float32Array(n * 2 * 3);
  positions.set(topPositions, 0);
  for (let i = 0; i < n; i++) {
    positions[n * 3 + i * 3 + 0] = topPositions[i * 3 + 0];
    positions[n * 3 + i * 3 + 1] = topPositions[i * 3 + 1] - thickness;
    positions[n * 3 + i * 3 + 2] = topPositions[i * 3 + 2];
  }

  const indices: number[] = [];

  // Top face.
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = r * cols + c + 1;
      const cc = (r + 1) * cols + c;
      const d = (r + 1) * cols + c + 1;
      indices.push(a, b, d, a, d, cc);
    }
  }
  // Bottom face -- same winding as the top, offset into the bottom vertex
  // block. The material is double-sided (see callers below) so the exact
  // winding only affects shading, never visibility, and this is mostly
  // buried in the terrain anyway.
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c + n;
      const b = r * cols + c + 1 + n;
      const cc = (r + 1) * cols + c + n;
      const d = (r + 1) * cols + c + 1 + n;
      indices.push(a, b, d, a, d, cc);
    }
  }
  // Side skirts around the full perimeter (both long edges + both ends)
  // connecting each top edge vertex straight down to its bottom
  // counterpart.
  const addWall = (topIndexAt: (i: number) => number, count: number) => {
    for (let i = 0; i < count - 1; i++) {
      const a = topIndexAt(i);
      const b = topIndexAt(i + 1);
      indices.push(a, b, b + n, a, b + n, a + n);
    }
  };
  addWall((r) => r * cols, rows); // c = 0 edge
  addWall((r) => r * cols + (cols - 1), rows); // c = cols-1 edge
  addWall((c) => c, cols); // r = 0 edge
  addWall((c) => (rows - 1) * cols + c, cols); // r = rows-1 edge

  return { positions, indices: new Uint32Array(indices) };
}

interface RoadSectionProps {
  axis: 'x' | 'z';
  size: number;
}

const RoadSection: React.FC<RoadSectionProps> = ({ axis, size }) => {
  const roadWidth = ROAD_WIDTH;
  const segmentsAlong = 80;
  const segmentsAcross = 10;
  const yOffset = ROAD_Y_OFFSET;

  const { vertices, indices } = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(
      axis === 'x' ? size : roadWidth,
      axis === 'z' ? size : roadWidth,
      axis === 'x' ? segmentsAlong : segmentsAcross,
      axis === 'z' ? segmentsAlong : segmentsAcross
    );

    geometry.rotateX(-Math.PI / 2);

    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, getTerrainHeight(x, z) + yOffset);
    }

    // rows/cols of the grid PlaneGeometry just built above -- see
    // extrudeGrid's own comment for why this (row-major, r*cols+c) layout
    // matters. widthSegments/heightSegments swap with `axis` the same way
    // the PlaneGeometry dimensions above do.
    const cols = (axis === 'x' ? segmentsAlong : segmentsAcross) + 1;
    const rows = (axis === 'x' ? segmentsAcross : segmentsAlong) + 1;
    const slab = extrudeGrid(pos.array as Float32Array, rows, cols, ROAD_THICKNESS);

    return {
      vertices: slab.positions,
      indices: slab.indices,
    };
  }, [axis, size]);

  // Dashed lane markings
  const dashCount = Math.floor(size / 6);
  const dashMeshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Sidewalks -- two strips, one on each side, each extruded into its own
  // solid slab (see extrudeGrid/ROAD_THICKNESS above) and then merged.
  const { sidewalkVertices, sidewalkIndices } = useMemo(() => {
    const swWidth = SIDEWALK_WIDTH;
    const swY = yOffset + SIDEWALK_HEIGHT;
    const swCols = (axis === 'x' ? segmentsAlong : 2) + 1;
    const swRows = (axis === 'x' ? 2 : segmentsAlong) + 1;

    const buildStrip = (side: 1 | -1) => {
      const geo = new THREE.PlaneGeometry(
        axis === 'x' ? size : swWidth,
        axis === 'z' ? size : swWidth,
        axis === 'x' ? segmentsAlong : 2,
        axis === 'z' ? segmentsAlong : 2
      );
      geo.rotateX(-Math.PI / 2);
      const p = geo.attributes.position;
      const offset = (roadWidth / 2 + swWidth / 2) * side;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i) + (axis === 'z' ? offset : 0);
        const z = p.getZ(i) + (axis === 'x' ? offset : 0);
        p.setX(i, x);
        p.setZ(i, z);
        p.setY(i, getTerrainHeight(x, z) + swY);
      }
      return extrudeGrid(p.array as Float32Array, swRows, swCols, ROAD_THICKNESS);
    };

    // side=-1 matches the original "left" strip's `-offsetL`, side=1 the
    // original "right" strip's `+offsetR`.
    const left = buildStrip(-1);
    const right = buildStrip(1);
    const leftVertexCount = left.positions.length / 3;

    const combinedPos = new Float32Array(left.positions.length + right.positions.length);
    combinedPos.set(left.positions);
    combinedPos.set(right.positions, left.positions.length);

    const combinedIndices = new Uint32Array(left.indices.length + right.indices.length);
    combinedIndices.set(left.indices);
    combinedIndices.set(
      right.indices.map((idx) => idx + leftVertexCount),
      left.indices.length
    );

    return {
      sidewalkVertices: combinedPos,
      sidewalkIndices: combinedIndices,
    };
  }, [axis, size]);

  // Both trimeshes are static/fixed, tagged TrimeshColliders and excluded
  // from colliding with each other (asphalt vs sidewalk vs terrain
  // heightfield) -- all mass-0 bodies, so any contact between them would be
  // a costly no-op with no dynamic response to produce.
  const roadGroups = useMemo(() => groupsExcluding(CollisionGroups.TrimeshColliders, CollisionGroups.TrimeshColliders), []);

  return (
    <group>
      {/* Asphalt */}
      <RigidBody type="fixed" colliders={false} friction={0.8} restitution={0}>
        <TrimeshCollider args={[vertices, indices]} collisionGroups={roadGroups} />
        <mesh receiveShadow>
          <bufferGeometry onUpdate={(self) => self.computeVertexNormals()}>
            <bufferAttribute attach="attributes-position" args={[vertices, 3]} count={vertices.length / 3} array={vertices} itemSize={3} />
            <bufferAttribute attach="index" args={[indices, 1]} count={indices.length} array={indices} itemSize={1} />
          </bufferGeometry>
          {/* DoubleSide -- now a solid slab (see extrudeGrid), not a single
                thin plane, so the bottom face and side skirts need to render
                too regardless of the exact winding extrudeGrid gave them. */}
          <meshStandardMaterial color="#222" roughness={0.8} side={THREE.DoubleSide} />
        </mesh>
      </RigidBody>

      {/* Sidewalks */}
      <RigidBody type="fixed" colliders={false} friction={0.8} restitution={0}>
        <TrimeshCollider args={[sidewalkVertices, sidewalkIndices]} collisionGroups={roadGroups} />
        <mesh receiveShadow>
          <bufferGeometry onUpdate={(self) => self.computeVertexNormals()}>
            <bufferAttribute
              attach="attributes-position"
              args={[sidewalkVertices, 3]}
              count={sidewalkVertices.length / 3}
              array={sidewalkVertices}
              itemSize={3}
            />
            <bufferAttribute
              attach="index"
              args={[sidewalkIndices, 1]}
              count={sidewalkIndices.length}
              array={sidewalkIndices}
              itemSize={1}
            />
          </bufferGeometry>
          <meshStandardMaterial color="#777" roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
      </RigidBody>

      {/* Dashes */}
      <instancedMesh
        ref={dashMeshRef}
        args={[null as any, null as any, dashCount]}
        onUpdate={(self) => {
          for (let i = 0; i < dashCount; i++) {
            const step = size / dashCount;
            const posAlong = -size / 2 + i * step + step / 2;
            const x = axis === 'x' ? posAlong : 0;
            const z = axis === 'z' ? posAlong : 0;
            const y = getTerrainHeight(x, z) + yOffset + 0.01;

            dummy.position.set(x, y, z);
            dummy.rotation.set(-Math.PI / 2, 0, axis === 'x' ? 0 : Math.PI / 2);
            dummy.scale.set(axis === 'x' ? 2 : 0.2, axis === 'z' ? 2 : 0.2, 1);
            dummy.updateMatrix();
            self.setMatrixAt(i, dummy.matrix);
          }
          self.instanceMatrix.needsUpdate = true;
        }}
      >
        <planeGeometry args={[1, 1]} />
        <meshStandardMaterial color="#fff" />
      </instancedMesh>
    </group>
  );
};

// Shared streetlamp bulb material -- "accendi i lampioni di notte". Every
// StreetLight (Road.tsx, ~100 across the grid) AND Park.tsx's own
// StreetLamp share this ONE material object (imported there), mutated by
// the single StreetLampCycle below -- exactly the same trick
// TrafficLightCycle/_trafficRedMat already use, for the same reason: one
// useFrame + one material update lights up every lamp in the city at once,
// instead of each of ~100 lamps running its own useFrame or owning its own
// material. Emissive-only (see the removed-pointLight comment below this
// used to sit on) -- intensity now tracks day/night instead of being a
// constant "always lit" 2, so lamps actually look off in daylight.
export const streetLampBulbMaterial = new THREE.MeshStandardMaterial({
  color: '#ffe9b0',
  emissive: '#ffcf70',
  emissiveIntensity: 0,
});

// Mounted exactly once (in Road() below), same pattern as
// TrafficLightCycle just above -- see that component's comment.
const StreetLampCycle: React.FC = () => {
  useFrame((state) => {
    const dir = getSunDirection(state.clock.elapsedTime);
    const dayFactor = getDayFactor(dir.y);
    streetLampBulbMaterial.emissiveIntensity = THREE.MathUtils.lerp(2.2, 0, dayFactor);
  });
  return null;
};

// Shared, mutated-in-place materials -- every TrafficLight instance across
// the whole grid renders using these exact same two THREE.Material OBJECTS
// (passed via the `material` prop below, not a fresh <meshStandardMaterial>
// per instance), so ONE useFrame here toggling .emissiveIntensity lights up
// every signal in the city simultaneously, independent of how many
// intersections there are -- same reasoning as the emissive-only streetlamp
// bulbs above, just applied to keeping the update cost flat instead of the
// light-source cost.
const _trafficRedMat = new THREE.MeshStandardMaterial({ color: '#330000', emissive: '#ff0000', emissiveIntensity: 0 });
const _trafficGreenMat = new THREE.MeshStandardMaterial({ color: '#003300', emissive: '#00ff00', emissiveIntensity: 0 });
const TRAFFIC_CYCLE_SECONDS = 4;

// Mounted exactly once (in Road() below) regardless of how many
// intersections exist -- see the shared-material comment above.
const TrafficLightCycle: React.FC = () => {
  useFrame((state) => {
    const isRed = Math.floor(state.clock.elapsedTime / TRAFFIC_CYCLE_SECONDS) % 2 === 0;
    _trafficRedMat.emissiveIntensity = isRed ? 2.5 : 0;
    _trafficGreenMat.emissiveIntensity = isRed ? 0 : 2.5;
  });
  return null;
};

// Arredo degli incroci disegnato in blocco (StaticInstances): strisce
// pedonali, lampioni e semafori di tutta la citta' in poche draw call per
// zona invece di ~900 mesh singole; i pali hanno i loro collider tutti in un
// unico corpo fisso. I semafori sono decorativi (nessuno li rispetta): tutti
// in fase sullo stesso timer (TrafficLightCycle).
const STRIPE_COUNT = 6;
const STRIPE_W = 0.5;
const STRIPE_L = 4;
const TRAFFIC_POLE_H = 4.5;
const LAMP_POLE_R = 0.15;
const POLE_GROUPS = groupsExcluding(CollisionGroups.Default, CollisionGroups.Characters);

const _stripeGeo = new THREE.PlaneGeometry(STRIPE_W, STRIPE_L);
const _stripeMat = new THREE.MeshStandardMaterial({ color: '#fff' });
const _lampPoleGeo = new THREE.CylinderGeometry(LAMP_POLE_R, LAMP_POLE_R, STREET_LIGHT_POLE_HEIGHT, 8);
const _lampPoleMat = new THREE.MeshStandardMaterial({ color: '#333' });
const _lampBulbGeo = new THREE.SphereGeometry(0.4, 8, 8);
const _trafficPoleGeo = new THREE.CylinderGeometry(0.1, 0.1, TRAFFIC_POLE_H, 8);
const _trafficPoleMat = new THREE.MeshStandardMaterial({ color: '#333', metalness: 0.4, roughness: 0.6 });
const _trafficBoxGeo = new THREE.BoxGeometry(0.35, 0.9, 0.35);
const _trafficBoxMat = new THREE.MeshStandardMaterial({ color: '#111' });
const _trafficBulbGeo = new THREE.SphereGeometry(0.12, 8, 8);

const IntersectionDetails: React.FC = () => {
  const d = useMemo(() => {
    const stripes: InstanceXform[] = [];
    const lampPoles: InstanceXform[] = [];
    const lampBulbs: InstanceXform[] = [];
    const tPoles: InstanceXform[] = [];
    const tBoxes: InstanceXform[] = [];
    const tRed: InstanceXform[] = [];
    const tGreen: InstanceXform[] = [];
    const yOff = ROAD_Y_OFFSET + 0.01;
    const half = ROAD_WIDTH / 2 + 2;
    for (const ox of ROAD_OFFSETS) {
      for (const oz of ROAD_OFFSETS) {
        for (let i = 0; i < STRIPE_COUNT; i++) {
          const o = (i - (STRIPE_COUNT - 1) / 2) * 1.2;
          // nord/sud: strisce lungo Z; est/ovest: ruotate di 90 gradi
          for (const sz of [-1, 1]) {
            const x = ox + o,
              z = oz + sz * half;
            stripes.push({ x, y: getTerrainHeight(x, z) + yOff, z, rx: -Math.PI / 2 });
          }
          for (const sx of [-1, 1]) {
            const x = ox + sx * half,
              z = oz + o;
            stripes.push({ x, y: getTerrainHeight(x, z) + yOff, z, rx: -Math.PI / 2, rz: Math.PI / 2 });
          }
        }
        const c = ROAD_WIDTH / 2 + 1;
        for (const [lx, lz] of [
          [ox - c, oz - c],
          [ox + c, oz + c],
        ]) {
          const y = getTerrainHeight(lx, lz);
          lampPoles.push({ x: lx, y: y + STREET_LIGHT_POLE_HEIGHT / 2, z: lz });
          lampBulbs.push({ x: lx, y: y + STREET_LIGHT_POLE_HEIGHT, z: lz });
        }
        for (const [tx, tz] of [
          [ox - c, oz + c],
          [ox + c, oz - c],
        ]) {
          const y = getTerrainHeight(tx, tz);
          tPoles.push({ x: tx, y: y + TRAFFIC_POLE_H / 2, z: tz });
          tBoxes.push({ x: tx, y: y + TRAFFIC_POLE_H + 0.35, z: tz });
          tRed.push({ x: tx, y: y + TRAFFIC_POLE_H + 0.6, z: tz + 0.19 });
          tGreen.push({ x: tx, y: y + TRAFFIC_POLE_H + 0.1, z: tz + 0.19 });
        }
      }
    }
    return { stripes, lampPoles, lampBulbs, tPoles, tBoxes, tRed, tGreen };
  }, []);

  return (
    <>
      <StaticInstances name="crosswalks" geometry={_stripeGeo} material={_stripeMat} items={d.stripes} receiveShadow />
      <StaticInstances name="lamp-poles" geometry={_lampPoleGeo} material={_lampPoleMat} items={d.lampPoles} castShadow receiveShadow />
      <StaticInstances name="lamp-bulbs" geometry={_lampBulbGeo} material={streetLampBulbMaterial} items={d.lampBulbs} />
      <StaticInstances
        name="traffic-poles"
        geometry={_trafficPoleGeo}
        material={_trafficPoleMat}
        items={d.tPoles}
        castShadow
        receiveShadow
      />
      <StaticInstances name="traffic-boxes" geometry={_trafficBoxGeo} material={_trafficBoxMat} items={d.tBoxes} castShadow />
      <StaticInstances name="traffic-red" geometry={_trafficBulbGeo} material={_trafficRedMat} items={d.tRed} />
      <StaticInstances name="traffic-green" geometry={_trafficBulbGeo} material={_trafficGreenMat} items={d.tGreen} />
      {/* pali: niente Characters (sottili, nessuno ci deve stare sopra);
          auto e proiettili ci sbattono */}
      <RigidBody type="fixed" colliders={false}>
        {d.lampPoles.map((p, i) => (
          <CylinderCollider
            key={`lp-${i}`}
            args={[STREET_LIGHT_POLE_HEIGHT / 2, LAMP_POLE_R]}
            position={[p.x, p.y, p.z]}
            collisionGroups={POLE_GROUPS}
          />
        ))}
        {d.tPoles.map((p, i) => (
          <CylinderCollider key={`tp-${i}`} args={[TRAFFIC_POLE_H / 2, 0.1]} position={[p.x, p.y, p.z]} collisionGroups={POLE_GROUPS} />
        ))}
      </RigidBody>
    </>
  );
};

const Road: React.FC = () => {
  const offsets = ROAD_OFFSETS;

  return (
    <group>
      {offsets.map((offset, i) => (
        <React.Fragment key={`road-grid-${i}`}>
          <group position={[0, 0, offset]}>
            <RoadSection axis="x" size={ROAD_SIZE} />
          </group>
          <group position={[offset, 0, 0]}>
            <RoadSection axis="z" size={ROAD_SIZE} />
          </group>
        </React.Fragment>
      ))}
      {/* Intersections Details */}
      <TrafficLightCycle />
      <StreetLampCycle />
      <IntersectionDetails />
    </group>
  );
};

export default Road;
