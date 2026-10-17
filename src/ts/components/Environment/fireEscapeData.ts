import { CITY_LAYOUT, type CityBuildingRecord } from './City';
import { HOSPITAL, POLICE_STATION, BANK, LOT_RECTS, getStreetProps } from './streetPropsData';
import { worldRng } from '../../lib/worldSeed';
import { onPlanetRebuild } from '../../lib/planet';

// Scale antincendio su alcuni palazzi alti: piattaforme a zig-zag una per
// piano, collegate da scale a pioli. Dati puri (posizioni): il disegno e i
// collider stanno in FireEscapes.tsx.
//
// Schema (u = lungo il muro, v = fuori dal muro, y = quota sopra il suolo):
//   piattaforma k dispari: u in [-3.4, 0];  pari: u in [0, 3.4]; profondita' 1.3
//   scala dal suolo alla 1: sul lato u = -3.4; poi ogni scala sale dal
//   bordo che le piattaforme dispari/pari hanno in comune (u = 0).
// Ogni piattaforma e' a filo del pavimento di una stanza (y = k * altezza del
// piano) e ha davanti il centro di una finestra: dalla piattaforma si
// scavalca il davanzale (City.tsx, davanzali arrampicabili) ed e' dentro.

export const FE_W = 3.4; // larghezza di una piattaforma = passo delle finestre (City.tsx: 3.4 m)
export const FE_D = 1.3; // sporgenza dal muro
export const FE_LADDER_HALF = 0.35;

export interface FireEscape {
  id: string;
  // origine sul muro (u = 0, v = 0) e assi unitari sul piano XZ
  ox: number;
  oz: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  groundY: number;
  spacing: number; // m tra un piano e l'altro
  levels: number;
}

const AREA_U: [number, number] = [-5.2, 3.6];
const AREA_V: [number, number] = [-0.1, 1.9];

let cache: FireEscape[] | null = null;
onPlanetRebuild(() => {
  cache = null;
});

function blockCentre(v: number) {
  return Math.floor(v / 60) * 60 + 30;
}

export function getFireEscapes(): FireEscape[] {
  if (cache) return cache;
  const out: FireEscape[] = [];
  const rnd = worldRng('fire-escapes');
  const solids = getStreetProps().solids;
  const avoid = [HOSPITAL, POLICE_STATION, BANK].map((b) => ({
    minX: b.x - b.w / 2 - 4,
    maxX: b.x + b.w / 2 + 4 + 8,
    minZ: b.z - b.d / 2 - 4,
    maxZ: b.z + b.d / 2 + 4,
  }));
  for (const r of LOT_RECTS) avoid.push({ minX: r.minX - 2, maxX: r.maxX + 2, minZ: r.minZ - 2, maxZ: r.maxZ + 2 });

  // solo palazzi con finestre vere (i grattacieli di vetro non ne hanno) e almeno 3 piani
  const tall = CITY_LAYOUT.buildings.filter((b) => b.style !== 'glass' && b.numFloors >= 3);
  // ordine casuale ma sempre uguale
  const order = tall.map((b, i) => ({ b, k: rnd() + i * 1e-6 })).sort((a, b) => a.k - b.k);

  for (const { b } of order) {
    if (out.length >= 14) break;
    const faces = pickFaces(b, rnd);
    for (const f of faces) {
      const aabb = footprint(f);
      const bx = blockCentre(b.x);
      const bz = blockCentre(b.z);
      // dentro il blocco, senza invadere marciapiede e arredo
      if (aabb.minX < bx - 22.5 || aabb.maxX > bx + 22.5 || aabb.minZ < bz - 22.5 || aabb.maxZ > bz + 22.5) continue;
      const hitsRect = (r: { minX: number; maxX: number; minZ: number; maxZ: number }) =>
        aabb.maxX > r.minX && aabb.minX < r.maxX && aabb.maxZ > r.minZ && aabb.minZ < r.maxZ;
      if (avoid.some(hitsRect)) continue;
      if (CITY_LAYOUT.buildings.some((o) => o !== b && hitsRect({ minX: o.x - o.w / 2 - 1, maxX: o.x + o.w / 2 + 1, minZ: o.z - o.d / 2 - 1, maxZ: o.z + o.d / 2 + 1 }))) continue;
      if (solids.some((s) => hitsRect({ minX: s.x - s.hx, maxX: s.x + s.hx, minZ: s.z - s.hz, maxZ: s.z + s.hz }))) continue;
      if (out.some((o) => Math.hypot(o.ox - f.ox, o.oz - f.oz) < 18)) continue;
      const spacing = b.floorHeight;
      const levels = Math.min(6, b.numFloors - 1);
      out.push({ ...f, id: `fe-${out.length}`, groundY: b.by, spacing, levels });
      break;
    }
  }
  cache = out;
  return out;
}

type Frame = Pick<FireEscape, 'ox' | 'oz' | 'tx' | 'tz' | 'nx' | 'nz'>;

// le facce (e i due versi dell'asse lungo il muro) in ordine casuale, con
// l'origine scelta perche' i centri delle piattaforme cadano sulle finestre
const WINDOW_STEP = 3.4; // come in City.tsx
const WALL_HALF = 0.15; // mezzo spessore dei muri
function pickFaces(b: CityBuildingRecord, rnd: () => number): Frame[] {
  const faces: Frame[] = [];
  // [normale x, normale z, lunghezza della faccia, centro lungo la faccia]
  const defs: Array<[number, number, number]> = [
    [1, 0, b.d],
    [-1, 0, b.d],
    [0, 1, b.w],
    [0, -1, b.w],
  ];
  for (const [nx, nz, len] of defs) {
    const count = Math.min(6, Math.max(1, Math.floor(len / WINDOW_STEP) - 1));
    if (count < 2) continue;
    for (const sg of [1, -1]) {
      const tx = -nz * sg;
      const tz = nx * sg;
      const alongX = Math.abs(tx) > 0.5;
      const centre = alongX ? b.x : b.z;
      const sign = alongX ? tx : tz;
      const j1 = Math.floor(rnd() * (count - 1)); // finestra della piattaforma 1; la 2 e' la successiva
      const a1 = centre + sign * (j1 - (count - 1) / 2) * WINDOW_STEP;
      const a0 = a1 + sign * (WINDOW_STEP / 2); // u = 0
      // sul piano del muro (faccia esterna)
      const px = nx !== 0 ? b.x + nx * (b.w / 2 + WALL_HALF) : a0;
      const pz = nz !== 0 ? b.z + nz * (b.d / 2 + WALL_HALF) : a0;
      faces.push({ ox: px, oz: pz, tx, tz, nx, nz });
    }
  }
  return faces.map((f) => ({ f, k: rnd() })).sort((a, b2) => a.k - b2.k).map((x) => x.f);
}

function footprint(f: Frame) {
  const xs: number[] = [];
  const zs: number[] = [];
  for (const u of AREA_U) {
    for (const v of AREA_V) {
      xs.push(f.ox + f.tx * u + f.nx * v);
      zs.push(f.oz + f.tz * u + f.nz * v);
    }
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}
