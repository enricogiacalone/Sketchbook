import React, { useMemo } from "react";
import * as THREE from "three";
import { RigidBody, HeightfieldCollider } from "@react-three/rapier";
import { CollisionGroups, groupsExcluding } from "../../enums/CollisionGroups";
import { planetGeometry, isPlazaBlock, onPlanetRebuild } from "../../lib/planet";
import { getCurrentSite, wildHeight, wildSample, type Site } from "../../lib/site";
import { surfaceColor } from "../../lib/planetSurface";
import { getTerrainData, setTerrainData, setTerrainWindowHalf, TERRAIN_STEP, type TerrainData } from "../../lib/terrainData";

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

const cityHeight = (x: number, z: number): number => {
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

// --- terreno del sito ---------------------------------------------------------------------------
// Citta': piatta e con le colline del parco e dei cortili dentro il rettangolo CITY_HALF; fuori il terreno
// procedurale del pianeta (curvatura + montagne + boschi) sale piano dalla pianura (BLEND m di fusione).
// Sito selvaggio: solo il terreno del pianeta. Le quote vengono dalla griglia (collider e mesh) se c'e',
// altrimenti si calcolano.
const CITY_MARGIN = 50;
const BLEND = 220;
let cityHalf = planetGeometry().roadExtent + CITY_MARGIN;
onPlanetRebuild(() => {
  cityHalf = planetGeometry().roadExtent + CITY_MARGIN;
});
export const getCityHalf = () => cityHalf;

const cityWeight = (site: Site, x: number, z: number): number =>
  site.kind === 'wild' ? 1 : smooth(cityHalf, cityHalf + BLEND, Math.max(Math.abs(x), Math.abs(z)));

const computeHeight = (site: Site, x: number, z: number): number => {
  const w = cityWeight(site, x, z);
  if (w === 0) return cityHeight(x, z);
  const wild = wildHeight(x, z, site);
  return w === 1 ? wild : cityHeight(x, z) * (1 - w) + wild * w;
};

const sampleGrid = (d: TerrainData, x: number, z: number): number => {
  const half = d.size / 2;
  const fx = (x + half) / TERRAIN_STEP;
  const fz = (z + half) / TERRAIN_STEP;
  const r0 = Math.min(d.segments - 1, Math.max(0, Math.floor(fx)));
  const c0 = Math.min(d.segments - 1, Math.max(0, Math.floor(fz)));
  const tx = Math.min(1, Math.max(0, fx - r0));
  const tz = Math.min(1, Math.max(0, fz - c0));
  const n = d.segments + 1;
  const h = d.heights;
  const h00 = h[c0 * n + r0], h10 = h[c0 * n + r0 + 1], h01 = h[(c0 + 1) * n + r0], h11 = h[(c0 + 1) * n + r0 + 1];
  return h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz;
};

export const getTerrainHeight = (x: number, z: number, maxHeight: number = 0): number => {
  void maxHeight;
  const site = getCurrentSite();
  if (site.kind === 'city' && Math.abs(x) < cityHalf && Math.abs(z) < cityHalf) return cityHeight(x, z);
  const d = getTerrainData(site.id);
  if (d && Math.abs(x) < d.size / 2 - TERRAIN_STEP && Math.abs(z) < d.size / 2 - TERRAIN_STEP) return sampleGrid(d, x, z);
  return computeHeight(site, x, z);
};

export const terrainWindowHalf = (site: Site): number => (site.kind === 'city' ? planetGeometry().roadExtent + 900 : 800);

// costruzione a pezzetti (generatore: a ogni `yield` si puo' cedere il controllo ai frame)
const BUDGET_MS = 12;
function* terrainJob(site: Site): Generator<void, TerrainData, void> {
  const half = terrainWindowHalf(site);
  const segments = Math.round((half * 2) / TERRAIN_STEP);
  const size = segments * TERRAIN_STEP;
  const n = segments + 1;
  const heights = new Float32Array(n * n);
  const vertices = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);
  const dark = new THREE.Color('#1a1a1a');
  const green = new THREE.Color('#24401a');
  const c = new THREE.Color();
  const wc = new THREE.Color();
  const rock = new THREE.Color('#6a6560');
  let t0 = performance.now();
  // 1) quote e colore di base del bioma (una sola risoluzione della direzione per punto)
  const baseCol = new Float32Array(n * n * 3);
  const infoH = new Float32Array(n * n);
  for (let row = 0; row < n; row++) {
    const x = -size / 2 + row * TERRAIN_STEP;
    for (let col = 0; col < n; col++) {
      const z = -size / 2 + col * TERRAIN_STEP;
      const i = col * n + row;
      const w = cityWeight(site, x, z);
      if (w === 0) {
        heights[i] = cityHeight(x, z);
        continue;
      }
      const smp = wildSample(x, z, site);
      heights[i] = w === 1 ? smp.y : cityHeight(x, z) * (1 - w) + smp.y * w;
      surfaceColor(site.planetSeed, smp.info, wc);
      baseCol[i * 3] = wc.r;
      baseCol[i * 3 + 1] = wc.g;
      baseCol[i * 3 + 2] = wc.b;
      infoH[i] = smp.info.h;
    }
    if (performance.now() - t0 > BUDGET_MS) {
      yield;
      t0 = performance.now();
    }
  }
  // 2) vertici, normali (differenze centrali), colori
  for (let row = 0; row < n; row++) {
    const x = -size / 2 + row * TERRAIN_STEP;
    for (let col = 0; col < n; col++) {
      const z = -size / 2 + col * TERRAIN_STEP;
      const i = col * n + row; // (colonna-maggiore: coincide con l'ordine del collider)
      const k = i * 3;
      vertices[k] = x;
      vertices[k + 1] = heights[i];
      vertices[k + 2] = z;
      const hl = heights[col * n + Math.max(0, row - 1)], hr = heights[col * n + Math.min(n - 1, row + 1)];
      const hd = heights[Math.max(0, col - 1) * n + row], hu = heights[Math.min(n - 1, col + 1) * n + row];
      const nx = (hl - hr) / (2 * TERRAIN_STEP), nz = (hd - hu) / (2 * TERRAIN_STEP);
      const il = 1 / Math.hypot(nx, 1, nz);
      normals[k] = nx * il;
      normals[k + 1] = il;
      normals[k + 2] = nz * il;
      const w = cityWeight(site, x, z);
      c.copy(dark).lerp(green, w === 1 ? 0 : greenness(x, z));
      if (w > 0) {
        wc.setRGB(baseCol[k], baseCol[k + 1], baseCol[k + 2]);
        wc.lerp(rock, smooth(0.3, 0.6, 1 - normals[k + 1]) * (infoH[i] > 0 ? 1 : 0.4));
        c.lerp(wc, w);
      }
      colors[k] = c.r;
      colors[k + 1] = c.g;
      colors[k + 2] = c.b;
    }
    if (performance.now() - t0 > BUDGET_MS) {
      yield;
      t0 = performance.now();
    }
  }
  // 3) indici
  const indices = new Uint32Array(segments * segments * 6);
  let q = 0;
  for (let row = 0; row < segments; row++) {
    for (let col = 0; col < segments; col++) {
      const a = col * n + row, b = col * n + row + 1, d = (col + 1) * n + row, e = (col + 1) * n + row + 1;
      indices[q++] = a;
      indices[q++] = d;
      indices[q++] = b;
      indices[q++] = b;
      indices[q++] = d;
      indices[q++] = e;
    }
    if (performance.now() - t0 > BUDGET_MS) {
      yield;
      t0 = performance.now();
    }
  }
  return { siteId: site.id, size, segments, heights, vertices, normals, colors, indices };
}

// versione "scalda": costruisce a pezzetti tra un frame e l'altro (a mondo smontato)
export async function warmTerrain(site: Site = getCurrentSite()): Promise<void> {
  if (getTerrainData(site.id)) return;
  setTerrainWindowHalf(terrainWindowHalf(site));
  const job = terrainJob(site);
  for (;;) {
    const r = job.next();
    if (r.done) {
      setTerrainData(r.value);
      return;
    }
    await new Promise<void>((res) => requestAnimationFrame(() => res()));
  }
}

const buildTerrainSync = (site: Site): TerrainData => {
  const job = terrainJob(site);
  for (;;) {
    const r = job.next();
    if (r.done) return r.value;
  }
};

const Terrain: React.FC = () => {
  const site = getCurrentSite();
  const data = useMemo(() => {
    const d = getTerrainData(site.id) ?? buildTerrainSync(site);
    setTerrainData(d);
    return d;
  }, [site.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const { size, segments, heights, vertices, normals, colors, indices } = data;

  return (
    <>
      <RigidBody type="fixed" colliders={false} position={[0, 0, 0]} friction={0.7} restitution={0}>
        <HeightfieldCollider
          args={[segments, segments, heights as unknown as number[], { x: size, y: 1, z: size }]}
          // Escludi gli altri TrimeshColliders (le strade): sono tutti statici
          collisionGroups={groupsExcluding(CollisionGroups.TrimeshColliders, CollisionGroups.TrimeshColliders)}
        />
      </RigidBody>
      <mesh receiveShadow position={[0, 0, 0]} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[vertices, 3]} count={vertices.length / 3} array={vertices} itemSize={3} />
          <bufferAttribute attach="attributes-normal" args={[normals, 3]} count={normals.length / 3} array={normals} itemSize={3} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} count={colors.length / 3} array={colors} itemSize={3} />
          <bufferAttribute attach="index" args={[indices, 1]} count={indices.length} array={indices} itemSize={1} />
        </bufferGeometry>
        <meshStandardMaterial vertexColors roughness={0.9} />
      </mesh>
    </>
  );
};

export default Terrain;
