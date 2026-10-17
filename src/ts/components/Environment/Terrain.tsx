import React, { useMemo } from "react";
import * as THREE from "three";
import { RigidBody, HeightfieldCollider } from "@react-three/rapier";
import { CollisionGroups, groupsExcluding } from "../../enums/CollisionGroups";
import { planetGeometry, isPlazaBlock, onPlanetRebuild } from "../../lib/planet";

// Flattened (Claude): this used to default to a +/-0.5 sine wave over a
// 20-30 unit wavelength. On open ground that read as gentle rolling hills,
// but roads/sidewalks sample this same function to follow the ground (see
// Road.tsx) -- an 8-unit-wide road rising/falling 0.5 units every ~20-30
// units visibly undulates/curves along its length instead of reading as a
// flat, straight road, and at intersections two perpendicular road strips
// riding two different local slopes of the same wave no longer meet at a
// consistent angle, so their (now solid/extruded, see ROAD_THICKNESS)
// slabs visibly clash into each other instead of lying flush (see git
// history / chat: "perche il terrain e le strade sembrano curvarsi... si
// compenetrano"). maxHeight now defaults to 0 -- perfectly flat -- fixing
// both. The x/z/wave machinery is left in place (not deleted) in case
// gentle relief away from the road grid is wanted again later; just bump
// this default back up (and reconcile it with Road.tsx's flatness
// assumption above) if so.
// ---------------------------------------------------------------------------
// Zone verdi non piatte: il parco e i cortili verdi hanno colline dolci
// ("fai il terreno delle zone verdi non regolare, non piatto"). Fuori da
// queste zone il terreno resta esattamente piatto (strade e marciapiedi lo
// campionano per seguirlo, vedi il commento sopra). Le colline sfumano a zero
// ai bordi e attorno a tutto quello che e' piatto per costruzione: i sentieri
// e la fontana del parco, il Bar Da Vito, i palazzi vicini ai cortili.
// Tutto il resto (erba, alberi, fiori, lampioni) legge gia' questa funzione.
// ---------------------------------------------------------------------------
const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// colline: tre onde incrociate (lunghezze d'onda 15-30 m). Pendenza massima ~0.4
const hills = (x: number, z: number, ph: number, amp: number) =>
  amp *
  (0.8 * Math.sin(x * 0.2 + ph) * Math.cos(z * 0.17 - ph * 0.7) +
    0.35 * Math.sin(x * 0.33 - z * 0.29 + ph * 1.9) +
    0.12 * Math.sin((x + z) * 0.6 + ph * 3.1));

const PARK = { min: 6, max: 54, cx: 30, cz: 30 };
const COURT_HALF = 10; // i cortili verdi sono 20x20
const makeCourtBlocks = (): Array<[number, number]> => {
  const R = planetGeometry().gridRadius;
  const out: Array<[number, number]> = [];
  for (let i = -R; i <= R; i++)
    for (let j = -R; j <= R; j++) {
      if ((i === 0 && j === 0) || isPlazaBlock(i, j, R)) continue;
      out.push([i * 60 + 30, j * 60 + 30]);
    }
  return out;
};
const courtKey = (bx: number, bz: number) => `${bx},${bz}`;
let COURT_BLOCKS = makeCourtBlocks();
let COURT_SET = new Set(COURT_BLOCKS.map(([x, z]) => courtKey(x, z)));
onPlanetRebuild(() => {
  COURT_BLOCKS = makeCourtBlocks();
  COURT_SET = new Set(COURT_BLOCKS.map(([x, z]) => courtKey(x, z)));
  courtBuildings = new Map();
});
// palazzi vicini a ogni cortile (rettangoli x/z), registrati da City.tsx appena
// il layout della citta' esiste: lì il terreno resta piatto
let courtBuildings = new Map<string, Array<{ minX: number; maxX: number; minZ: number; maxZ: number }>>();
export function setTerrainBuildings(rects: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }>) {
  const m = new Map<string, Array<{ minX: number; maxX: number; minZ: number; maxZ: number }>>();
  for (const [bx, bz] of COURT_BLOCKS) {
    m.set(
      courtKey(bx, bz),
      rects.filter((r) => r.maxX > bx - 40 && r.minX < bx + 40 && r.maxZ > bz - 40 && r.minZ < bz + 40)
    );
  }
  courtBuildings = m;
}

// quanto e' "verde" (0..1) in (x, z): serve al colore del terreno
export function greenness(x: number, z: number): number {
  if (x > PARK.min - 1 && x < PARK.max + 1 && z > PARK.min - 1 && z < PARK.max + 1) {
    return smooth(0, 4, Math.min(x - PARK.min, PARK.max - x, z - PARK.min, PARK.max - z));
  }
  const bx = Math.floor(x / 60) * 60 + 30;
  const bz = Math.floor(z / 60) * 60 + 30;
  if (!COURT_SET.has(courtKey(bx, bz))) return 0;
  const m = Math.min(x - (bx - COURT_HALF), bx + COURT_HALF - x, z - (bz - COURT_HALF), bz + COURT_HALF - z);
  return m <= 0 ? 0 : smooth(0, 2, m);
}

export const getTerrainHeight = (
  x: number,
  z: number,
  maxHeight: number = 0
): number => {
  void maxHeight;
  // parco
  if (x > PARK.min && x < PARK.max && z > PARK.min && z < PARK.max) {
    const edge = smooth(0, 9, Math.min(x - PARK.min, PARK.max - x, z - PARK.min, PARK.max - z));
    const path = smooth(2.2, 5.5, Math.min(Math.abs(x - PARK.cx), Math.abs(z - PARK.cz)));
    const fountain = smooth(7, 11, Math.hypot(x - PARK.cx, z - PARK.cz));
    // Bar Da Vito e i tavolini: x 31..45, z 5..17
    const dxBar = Math.max(31 - x, 0, x - 45);
    const dzBar = Math.max(5 - z, 0, z - 17);
    const bar = smooth(0, 5, Math.hypot(dxBar, dzBar));
    return hills(x, z, 0.6, 0.85) * edge * path * fountain * bar;
  }
  // cortili verdi
  const bx = Math.floor(x / 60) * 60 + 30;
  const bz = Math.floor(z / 60) * 60 + 30;
  if (Math.abs(x - bx) < COURT_HALF && Math.abs(z - bz) < COURT_HALF && COURT_SET.has(courtKey(bx, bz))) {
    const edge = smooth(0, 3.5, Math.min(x - (bx - COURT_HALF), bx + COURT_HALF - x, z - (bz - COURT_HALF), bz + COURT_HALF - z));
    let near = 1;
    const rects = courtBuildings.get(courtKey(bx, bz));
    if (rects) {
      for (const r of rects) {
        const d = Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ));
        if (d < 4) near = Math.min(near, smooth(1, 4, d));
      }
    }
    return hills(x, z, bx * 0.013 + bz * 0.007, 0.65) * edge * near;
  }
  return 0;
};

const Terrain: React.FC = () => {
  const size = planetGeometry().roadSize;
  const segments = Math.round(size / 2); // 2 m: le colline del parco hanno onde di 15+ m
  const maxHeight = 0;

  // Visual Mesh Data - Centered at [0,0,0]
  const { vertices, normals, colors, visualIndices } = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, getTerrainHeight(x, z, maxHeight));
    }
    geometry.computeVertexNormals();
    // colore: terra scura, verde dove ci sono le zone verdi (si vedono le colline)
    const colors = new Float32Array(pos.count * 3);
    const dark = new THREE.Color('#1a1a1a');
    const green = new THREE.Color('#24401a');
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      c.copy(dark).lerp(green, greenness(pos.getX(i), pos.getZ(i)));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    return {
      vertices: pos.array as Float32Array,
      normals: geometry.attributes.normal.array as Float32Array,
      colors,
      visualIndices: geometry.index?.array as Uint32Array,
    };
  }, [size, segments, maxHeight]);

  // Physics Heightfield Data.
  //
  // Rapier's Heightfield shape is column-major, `heights[col * (nrows+1) +
  // row]`, and -- unlike cannon's heightfield, which lives in the local XY
  // plane and needs a -90deg X rotation to lay flat -- Rapier's already
  // uses the local X/Z plane with height along local Y, and is CENTERED on
  // the body's origin (cannon's was corner-anchored, hence the old
  // `position: [-size/2, 0, size/2]` offset). So this body sits at world
  // origin with identity rotation, matching the centered visual mesh above
  // directly. Row = local X, column = local Z (verified live against
  // getTerrainHeight with a raycast test while migrating off cannon).
  const heights = useMemo(() => {
    const nrows = segments;
    const ncols = segments;
    const flat = new Array<number>((nrows + 1) * (ncols + 1));
    const step = size / segments;

    for (let row = 0; row <= nrows; row++) {
      const worldX = -size / 2 + row * step;
      for (let col = 0; col <= ncols; col++) {
        const worldZ = -size / 2 + col * step;
        flat[col * (nrows + 1) + row] = getTerrainHeight(worldX, worldZ, maxHeight);
      }
    }
    return flat;
  }, [size, segments, maxHeight]);

  // (niente muri ai bordi: la citta' e' su un pianeta, vedi lib/space.ts; chi cade nel vuoto: SpaceController)

  return (
    <>
      <RigidBody type="fixed" colliders={false} position={[0, 0, 0]} friction={0.7} restitution={0}>
        <HeightfieldCollider
          args={[segments, segments, heights, { x: size, y: 1, z: size }]}
          // Exclude other TrimeshColliders (the road sections): every road
          // strip and this heightfield are all static, fixed bodies, so
          // colliding them with each other can only ever be a costly no-op
          // -- there's no dynamic response to produce.
          collisionGroups={groupsExcluding(CollisionGroups.TrimeshColliders, CollisionGroups.TrimeshColliders)}
        />
      </RigidBody>
      {/* niente piu' muri invisibili ai bordi (si puo' uscire dalla citta'; chi cade nel vuoto: SpaceController) */}
      <mesh receiveShadow position={[0, 0, 0]}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[vertices, 3]}
            count={vertices.length / 3}
            array={vertices}
            itemSize={3}
          />
          <bufferAttribute attach="attributes-normal" args={[normals, 3]} count={normals.length / 3} array={normals} itemSize={3} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} count={colors.length / 3} array={colors} itemSize={3} />
          <bufferAttribute
            attach="index"
            args={[visualIndices, 1]}
            count={visualIndices.length}
            array={visualIndices}
            itemSize={1}
          />
        </bufferGeometry>
        <meshStandardMaterial vertexColors roughness={0.9} />
      </mesh>
    </>
  );
};

export default Terrain;
