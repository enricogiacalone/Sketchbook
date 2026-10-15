import { CITY_LAYOUT } from './City';
import { ROAD_OFFSETS, ROAD_WIDTH, SIDEWALK_WIDTH, SIDEWALK_HEIGHT, ROAD_Y_OFFSET } from './Road';
import { worldRng } from '../../lib/worldSeed';
import type { InstanceXform } from './StaticInstances';

// Arredo urbano: dove sta ogni cosa. Tutto calcolato una volta sola e sempre
// uguale a parita' di seme della citta' (worldRng): cassonetti, alberi lungo i
// marciapiedi, fermate dell'autobus, chioschi, distributori, cabine,
// parchimetri, cartelli, cartelloni e le strisce a terra (linee di stop,
// frecce, dossi, passaggi pedonali a meta' isolato). Il disegno e' in blocco
// (StreetProps.tsx); qui i dati, i collider e gli ostacoli per la folla.

export const SW_Y = ROAD_Y_OFFSET + SIDEWALK_HEIGHT; // quota del marciapiede
export const LOT_RECTS = [-90, 30, 150].map((z) => ({ minX: -163, maxX: -122, minZ: z - 14, maxZ: z + 14 }));
// Ospedale e stazione di polizia (CityServices.tsx): blocchi vuoti a ovest
export const HOSPITAL = { x: -148, z: -30, w: 30, d: 22, h: 15 };
export const POLICE_STATION = { x: -148, z: 90, w: 30, d: 22, h: 12 };
const rectOf = (b: { x: number; z: number; w: number; d: number }, m = 0) => ({
  minX: b.x - b.w / 2 - m,
  maxX: b.x + b.w / 2 + m,
  minZ: b.z - b.d / 2 - m,
  maxZ: b.z + b.d / 2 + m,
});
const EXCLUDE = [...LOT_RECTS, rectOf(HOSPITAL, 2), rectOf(POLICE_STATION, 2)];

// dove si respawna (davanti agli ingressi, UI/PlayerFate.tsx)
export const HOSPITAL_SPAWN: [number, number] = [HOSPITAL.x + HOSPITAL.w / 2 + 5, HOSPITAL.z];
export const POLICE_SPAWN: [number, number] = [POLICE_STATION.x + POLICE_STATION.w / 2 + 5, POLICE_STATION.z];

export type GeoKey = 'box' | 'cyl' | 'sph' | 'plane';
export type MatKey = 'paint' | 'metal' | 'glass' | 'neon' | 'dark';
interface Part {
  geo: GeoKey;
  mat: MatKey;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  color?: string;
  ry?: number;
}
interface Plate {
  atlas: 'sign' | 'poster';
  cell: number;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
}
interface Solid {
  cx: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
}
interface Kind {
  offset: number; // dal centro della strada
  fp: [number, number]; // ingombro (larghezza, profondita') per i palazzi vicini
  parts: (rnd: () => number) => Part[];
  plates?: (rnd: () => number) => Plate[];
  solids?: Solid[];
  circle?: number; // ostacolo tondo per la folla (se non ha solidi)
  weight: number;
  big?: boolean;
}

const pick = <T,>(a: T[], rnd: () => number) => a[Math.floor(rnd() * a.length)];
const VIVID = ['#d84315', '#1565c0', '#2e7d32', '#f9a825', '#6a1b9a', '#00838f', '#c62828'];
const PASTEL = ['#ffcc80', '#a5d6a7', '#90caf9', '#f48fb1', '#ce93d8', '#fff59d'];
const FOLIAGE = ['#2e6b2e', '#3b7d34', '#4f8a3a', '#2f5d3a', '#5a8f3d'];

const KINDS: Record<string, Kind> = {
  tree: {
    offset: 4.75,
    fp: [1.2, 1.2],
    weight: 0.26,
    solids: [{ cx: 0, cz: 0, hx: 0.22, hy: 1.5, hz: 0.22 }],
    circle: 0.4,
    parts: (rnd) => [
      { geo: 'cyl', mat: 'paint', x: 0, y: 1.5, z: 0, sx: 0.3, sy: 3, sz: 0.3, color: '#5d4037' },
      { geo: 'sph', mat: 'paint', x: 0, y: 3.9, z: 0, sx: 3.2, sy: 2.9, sz: 3.2, color: pick(FOLIAGE, rnd) },
      { geo: 'sph', mat: 'paint', x: 0.5, y: 3.4, z: 0.3, sx: 2.1, sy: 1.9, sz: 2.1, color: pick(FOLIAGE, rnd) },
      { geo: 'box', mat: 'dark', x: 0, y: 0.02, z: 0, sx: 0.9, sy: 0.04, sz: 0.9 },
    ],
  },
  sign: {
    offset: 5.2,
    fp: [0.4, 0.4],
    weight: 0.1,
    solids: [{ cx: 0, cz: 0, hx: 0.08, hy: 1.3, hz: 0.08 }],
    circle: 0.15,
    parts: () => [{ geo: 'cyl', mat: 'metal', x: 0, y: 1.3, z: 0, sx: 0.09, sy: 2.6, sz: 0.09, color: '#8a9096' }],
    plates: (rnd) => [{ atlas: 'sign', cell: Math.floor(rnd() * 4), x: 0, y: 2.35, z: 0.07, w: 0.75, h: 0.75 }],
  },
  mailbox: {
    offset: 5.15,
    fp: [0.7, 0.7],
    weight: 0.05,
    solids: [{ cx: 0, cz: 0, hx: 0.26, hy: 0.55, hz: 0.24 }],
    parts: () => [
      { geo: 'box', mat: 'paint', x: 0, y: 0.6, z: 0, sx: 0.5, sy: 0.9, sz: 0.45, color: '#1e4fa3' },
      { geo: 'cyl', mat: 'paint', x: 0, y: 1.08, z: 0, sx: 0.5, sy: 0.45, sz: 0.5, color: '#1a4690', ry: 0 },
      { geo: 'box', mat: 'paint', x: 0, y: 0.1, z: 0, sx: 0.4, sy: 0.2, sz: 0.35, color: '#333' },
    ],
  },
  bag: {
    offset: 5.2,
    fp: [0.9, 0.9],
    weight: 0.07,
    circle: 0.45,
    parts: (rnd) => [
      { geo: 'sph', mat: 'dark', x: 0, y: 0.3, z: 0, sx: 0.65, sy: 0.6, sz: 0.65 },
      { geo: 'sph', mat: 'paint', x: 0.4, y: 0.22, z: 0.15, sx: 0.5, sy: 0.45, sz: 0.5, color: pick(['#222', '#3a3a3a', '#1b3a2a'], rnd) },
      { geo: 'sph', mat: 'dark', x: -0.3, y: 0.2, z: 0.2, sx: 0.45, sy: 0.4, sz: 0.45 },
    ],
  },
  meter: {
    offset: 4.2,
    fp: [0.4, 0.4],
    weight: 0.1,
    circle: 0.16,
    parts: () => [
      { geo: 'cyl', mat: 'metal', x: 0, y: 0.55, z: 0, sx: 0.08, sy: 1.1, sz: 0.08, color: '#9aa0a6' },
      { geo: 'box', mat: 'paint', x: 0, y: 1.2, z: 0, sx: 0.2, sy: 0.32, sz: 0.14, color: '#2b4a7a' },
      { geo: 'plane', mat: 'neon', x: 0, y: 1.25, z: 0.075, sx: 0.12, sy: 0.12, sz: 1, color: '#7cff8a' },
    ],
  },
  vending: {
    offset: 6.1,
    fp: [1.1, 1.0],
    weight: 0.05,
    solids: [{ cx: 0, cz: 0, hx: 0.48, hy: 0.95, hz: 0.42 }],
    parts: (rnd) => {
      const c = pick(VIVID, rnd);
      return [
        { geo: 'box', mat: 'paint', x: 0, y: 0.97, z: 0, sx: 0.95, sy: 1.94, sz: 0.85, color: c },
        { geo: 'plane', mat: 'neon', x: -0.1, y: 1.15, z: 0.432, sx: 0.55, sy: 1.1, sz: 1, color: '#ffffff' },
        { geo: 'plane', mat: 'neon', x: 0.33, y: 1.0, z: 0.432, sx: 0.12, sy: 0.4, sz: 1, color: '#ffd54f' },
      ];
    },
  },
  phone: {
    offset: 5.05,
    fp: [1.1, 1.1],
    weight: 0.03,
    solids: [{ cx: 0, cz: 0, hx: 0.48, hy: 1.15, hz: 0.48 }],
    parts: () => {
      const r: Part[] = [{ geo: 'box', mat: 'paint', x: 0, y: 2.34, z: 0, sx: 1.0, sy: 0.14, sz: 1.0, color: '#c62828' }];
      for (const sx of [-0.45, 0.45]) for (const sz of [-0.45, 0.45]) r.push({ geo: 'box', mat: 'paint', x: sx, y: 1.15, z: sz, sx: 0.08, sy: 2.3, sz: 0.08, color: '#c62828' });
      r.push({ geo: 'plane', mat: 'glass', x: 0, y: 1.2, z: 0.46, sx: 0.84, sy: 2.0, sz: 1 });
      r.push({ geo: 'plane', mat: 'glass', x: 0, y: 1.2, z: -0.46, sx: 0.84, sy: 2.0, sz: 1, ry: Math.PI });
      r.push({ geo: 'plane', mat: 'neon', x: 0, y: 2.1, z: -0.44, sx: 0.5, sy: 0.14, sz: 1, color: '#fff3b0', ry: 0 });
      return r;
    },
  },
  dumpster: {
    offset: 6.1,
    fp: [2.1, 1.3],
    weight: 0.06,
    solids: [{ cx: 0, cz: 0, hx: 0.97, hy: 0.6, hz: 0.52 }],
    parts: () => [
      { geo: 'box', mat: 'paint', x: 0, y: 0.6, z: 0, sx: 1.9, sy: 1.1, sz: 1.0, color: '#2e7d32' },
      { geo: 'box', mat: 'dark', x: 0, y: 1.18, z: 0, sx: 1.96, sy: 0.08, sz: 1.06 },
      { geo: 'box', mat: 'dark', x: 0.8, y: 0.08, z: 0.4, sx: 0.12, sy: 0.16, sz: 0.12 },
      { geo: 'box', mat: 'dark', x: -0.8, y: 0.08, z: 0.4, sx: 0.12, sy: 0.16, sz: 0.12 },
    ],
  },
  kiosk: {
    offset: 6.9,
    fp: [3.0, 2.4],
    weight: 0.04,
    big: true,
    solids: [{ cx: 0, cz: 0, hx: 1.3, hy: 1.15, hz: 1.0 }],
    parts: (rnd) => {
      const c = pick(PASTEL, rnd);
      const a = pick(VIVID, rnd);
      return [
        { geo: 'box', mat: 'paint', x: 0, y: 1.1, z: 0, sx: 2.6, sy: 2.2, sz: 2.0, color: c },
        { geo: 'box', mat: 'paint', x: 0, y: 2.38, z: 0.55, sx: 3.0, sy: 0.1, sz: 1.2, color: a },
        { geo: 'box', mat: 'dark', x: 0, y: 1.35, z: 1.01, sx: 2.0, sy: 0.9, sz: 0.04 },
        { geo: 'box', mat: 'paint', x: 0, y: 0.95, z: 1.15, sx: 2.2, sy: 0.08, sz: 0.4, color: '#795548' },
        { geo: 'plane', mat: 'neon', x: 0, y: 2.7, z: 1.02, sx: 2.0, sy: 0.4, sz: 1, color: a },
      ];
    },
  },
  shelter: {
    offset: 6.5,
    fp: [3.6, 2.0],
    weight: 0.05,
    big: true,
    solids: [{ cx: 0, cz: -0.8, hx: 1.55, hy: 1.0, hz: 0.12 }],
    parts: () => [
      { geo: 'box', mat: 'paint', x: 0, y: 2.55, z: 0, sx: 3.3, sy: 0.12, sz: 1.8, color: '#37474f' },
      { geo: 'cyl', mat: 'metal', x: -1.5, y: 1.25, z: 0.7, sx: 0.1, sy: 2.5, sz: 0.1, color: '#90a4ae' },
      { geo: 'cyl', mat: 'metal', x: 1.5, y: 1.25, z: 0.7, sx: 0.1, sy: 2.5, sz: 0.1, color: '#90a4ae' },
      { geo: 'cyl', mat: 'metal', x: -1.5, y: 1.25, z: -0.8, sx: 0.1, sy: 2.5, sz: 0.1, color: '#90a4ae' },
      { geo: 'cyl', mat: 'metal', x: 1.5, y: 1.25, z: -0.8, sx: 0.1, sy: 2.5, sz: 0.1, color: '#90a4ae' },
      { geo: 'plane', mat: 'glass', x: 0, y: 1.3, z: -0.8, sx: 3.0, sy: 2.3, sz: 1 },
      { geo: 'box', mat: 'paint', x: 0, y: 0.5, z: -0.45, sx: 2.4, sy: 0.07, sz: 0.5, color: '#6d4c41' },
      { geo: 'box', mat: 'metal', x: -1.0, y: 0.25, z: -0.45, sx: 0.06, sy: 0.5, sz: 0.4, color: '#455a64' },
      { geo: 'box', mat: 'metal', x: 1.0, y: 0.25, z: -0.45, sx: 0.06, sy: 0.5, sz: 0.4, color: '#455a64' },
      { geo: 'cyl', mat: 'metal', x: 2.1, y: 1.3, z: 0.8, sx: 0.07, sy: 2.6, sz: 0.07, color: '#8a9096' },
    ],
    plates: (rnd) => [
      { atlas: 'poster', cell: Math.floor(rnd() * 4), x: 1.62, y: 1.4, z: -0.2, w: 0.01, h: 0.01 }, // segnaposto: vedi sotto
      { atlas: 'sign', cell: 4, x: 2.1, y: 2.4, z: 0.86, w: 0.75, h: 0.75 },
    ],
  },
  planter: {
    offset: 5.95,
    fp: [1.6, 1.0],
    weight: 0.08,
    solids: [{ cx: 0, cz: 0, hx: 0.72, hy: 0.4, hz: 0.38 }],
    parts: (rnd) => [
      { geo: 'box', mat: 'paint', x: 0, y: 0.35, z: 0, sx: 1.4, sy: 0.7, sz: 0.7, color: '#9e9e9e' },
      { geo: 'sph', mat: 'paint', x: -0.2, y: 0.95, z: 0, sx: 1.0, sy: 0.8, sz: 0.8, color: pick(FOLIAGE, rnd) },
      { geo: 'sph', mat: 'paint', x: 0.35, y: 0.9, z: 0.05, sx: 0.7, sy: 0.6, sz: 0.7, color: pick(FOLIAGE, rnd) },
    ],
  },
  billboard: {
    offset: 6.6,
    fp: [5.0, 1.0],
    weight: 0.03,
    big: true,
    solids: [
      { cx: -1.8, cz: 0, hx: 0.14, hy: 2.5, hz: 0.14 },
      { cx: 1.8, cz: 0, hx: 0.14, hy: 2.5, hz: 0.14 },
    ],
    parts: () => [
      { geo: 'cyl', mat: 'metal', x: -1.8, y: 2.5, z: 0, sx: 0.24, sy: 5, sz: 0.24, color: '#5f666d' },
      { geo: 'cyl', mat: 'metal', x: 1.8, y: 2.5, z: 0, sx: 0.24, sy: 5, sz: 0.24, color: '#5f666d' },
      { geo: 'box', mat: 'paint', x: 0, y: 5.1, z: 0, sx: 4.6, sy: 2.5, sz: 0.2, color: '#263238' },
    ],
    plates: (rnd) => {
      const c = Math.floor(rnd() * 4);
      return [
        { atlas: 'poster', cell: c, x: 0, y: 5.1, z: 0.11, w: 4.4, h: 2.3 },
      ];
    },
  },
};

const KIND_LIST = Object.entries(KINDS);
const TOTAL_W = KIND_LIST.reduce((a, [, k]) => a + k.weight, 0);

export interface PartItem extends InstanceXform {}
export interface PlateItem {
  atlas: 'sign' | 'poster';
  cell: number;
  x: number;
  y: number;
  z: number;
  ry: number;
  w: number;
  h: number;
}
export interface StreetPropsData {
  parts: Record<string, InstanceXform[]>; // 'geo|mat' -> istanze
  plates: PlateItem[];
  solids: Array<{ x: number; y: number; z: number; hx: number; hy: number; hz: number }>;
  crowdRects: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
  crowdCircles: Array<{ x: number; z: number; r: number }>;
}

const hitsRect = (x0: number, x1: number, z0: number, z1: number, r: { minX: number; maxX: number; minZ: number; maxZ: number }) =>
  x1 > r.minX && x0 < r.maxX && z1 > r.minZ && z0 < r.maxZ;

let cache: StreetPropsData | null = null;

export function getStreetProps(): StreetPropsData {
  if (cache) return cache;
  const rnd = worldRng('street-props');
  const out: StreetPropsData = { parts: {}, plates: [], solids: [], crowdRects: [], crowdCircles: [] };
  const bRects = CITY_LAYOUT.buildings.map((b) => ({
    minX: b.x - b.w / 2 - 0.4,
    maxX: b.x + b.w / 2 + 0.4,
    minZ: b.z - b.d / 2 - 0.4,
    maxZ: b.z + b.d / 2 + 0.4,
  }));
  // il parco (blocco centrale) e le piazze hanno il loro arredo
  const SKIP = [
    { minX: 0, maxX: 60, minZ: 0, maxZ: 60 },
    { minX: -120, maxX: -60, minZ: 120, maxZ: 180 },
    { minX: 120, maxX: 180, minZ: -120, maxZ: -60 },
  ];
  const placed: Array<{ x: number; z: number; r: number }> = [];

  const add = (key: string, it: InstanceXform) => {
    (out.parts[key] ??= []).push(it);
  };

  const place = (name: string, k: Kind, wx: number, wz: number, yaw: number) => {
    const swap = Math.abs(Math.sin(yaw)) > 0.5;
    const fx = (swap ? k.fp[1] : k.fp[0]) / 2;
    const fz = (swap ? k.fp[0] : k.fp[1]) / 2;
    if (EXCLUDE.some((r) => hitsRect(wx - fx, wx + fx, wz - fz, wz + fz, r))) return false;
    if (SKIP.some((r) => hitsRect(wx - fx, wx + fx, wz - fz, wz + fz, r))) return false;
    if (bRects.some((r) => hitsRect(wx - fx, wx + fx, wz - fz, wz + fz, r))) return false;
    for (const p of placed) if (Math.hypot(p.x - wx, p.z - wz) < p.r + Math.max(fx, fz)) return false;
    placed.push({ x: wx, z: wz, r: Math.max(fx, fz) });

    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // locale (lx, lz) -> mondo: rotazione attorno a Y
    const toW = (lx: number, lz: number) => [wx + lx * c + lz * s, wz - lx * s + lz * c] as const;
    const sc = name === 'tree' ? 0.85 + rnd() * 0.35 : 1;
    for (const p of k.parts(rnd)) {
      const [px, pz] = toW(p.x * sc, p.z * sc);
      add(`${p.geo}|${p.mat}`, {
        x: px,
        y: SW_Y + p.y * sc,
        z: pz,
        ry: yaw + (p.ry ?? 0),
        sx: p.sx * sc,
        sy: p.sy * sc,
        sz: p.sz * sc,
        color: p.color,
      });
    }
    if (k.plates) {
      for (const pl of k.plates(rnd)) {
        if (pl.w < 0.05) continue; // segnaposto
        const [px, pz] = toW(pl.x, pl.z);
        out.plates.push({ atlas: pl.atlas, cell: pl.cell, x: px, y: SW_Y + pl.y, z: pz, ry: yaw, w: pl.w, h: pl.h });
      }
    }
    if (name === 'shelter') {
      // manifesto sul retro della pensilina
      const [px, pz] = toW(0, -0.72);
      out.plates.push({ atlas: 'poster', cell: Math.floor(rnd() * 4), x: px, y: SW_Y + 1.35, z: pz, ry: yaw + Math.PI, w: 1.0, h: 1.5 });
    }
    if (k.solids) {
      for (const sol of k.solids) {
        const [px, pz] = toW(sol.cx, sol.cz);
        out.solids.push({
          x: px,
          y: SW_Y + sol.hy,
          z: pz,
          hx: swap ? sol.hz : sol.hx,
          hy: sol.hy,
          hz: swap ? sol.hx : sol.hz,
        });
        const hx = swap ? sol.hz : sol.hx;
        const hz = swap ? sol.hx : sol.hz;
        out.crowdRects.push({ minX: px - hx - 0.1, maxX: px + hx + 0.1, minZ: pz - hz - 0.1, maxZ: pz + hz + 0.1 });
      }
    } else if (k.circle) {
      out.crowdCircles.push({ x: wx, z: wz, r: k.circle });
    }
    return true;
  };

  const half = ROAD_WIDTH / 2;
  void half;
  // lungo ogni tratto di strada (tra due incroci), da entrambi i lati
  for (let ai = 0; ai < 2; ai++) {
    for (const line of ROAD_OFFSETS) {
      for (let i = 0; i < ROAD_OFFSETS.length - 1; i++) {
        const a = ROAD_OFFSETS[i];
        for (const side of [-1, 1] as const) {
          let lastBig = -99;
          let shelterDone = false;
          for (let sIdx = 0; sIdx < 7; sIdx++) {
            const along = a + 12 + sIdx * 6 + (rnd() - 0.5) * 1.5;
            if (rnd() > 0.55) continue;
            // panchine, cestini, idranti e cartelli gia' ci sono sui marciapiedi dei
            // lati est-ovest (CityDetails): non sopra di loro
            const rel = along - (a + 30);
            if (ai === 0 && ((side > 0 && rel > -13 && rel < -5) || (side < 0 && rel > 5 && rel < 13))) continue;
            // quale oggetto
            let r = rnd() * TOTAL_W;
            let chosen = KIND_LIST[0];
            for (const e of KIND_LIST) {
              r -= e[1].weight;
              if (r <= 0) {
                chosen = e;
                break;
              }
            }
            const [name, k] = chosen;
            if (k.big && (sIdx - lastBig < 2 || (name === 'shelter' && shelterDone))) continue;
            const off = k.offset + (name === 'tree' || name === 'sign' ? (rnd() - 0.5) * 0.2 : 0);
            let wx: number;
            let wz: number;
            let yaw: number;
            if (ai === 0) {
              wx = along;
              wz = line + side * off;
              yaw = side > 0 ? Math.PI : 0;
            } else {
              wz = along;
              wx = line + side * off;
              yaw = side > 0 ? -Math.PI / 2 : Math.PI / 2;
            }
            if (place(name, k, wx, wz, yaw)) {
              if (k.big) lastBig = sIdx;
              if (name === 'shelter') shelterDone = true;
            }
          }
        }
      }
    }
  }
  // colonnine di ricarica ai parcheggi (lato ovest, di muso alle auto)
  for (const r of LOT_RECTS) {
    const lz = (r.minZ + r.maxZ) / 2;
    for (let k = 0; k < 4; k++) {
      const z = lz - 9 + k * 6;
      add('box|paint', { x: -159.9, y: SW_Y - 0.04 + 0.05 + 0.6, z, sx: 0.35, sy: 1.2, sz: 0.3, color: '#eceff1' });
      add('plane|neon', { x: -159.72, y: SW_Y + 0.95, z, ry: Math.PI / 2, sx: 0.18, sy: 0.45, sz: 1, color: '#5cff9a' });
      out.crowdCircles.push({ x: -159.9, z, r: 0.3 });
    }
  }
  cache = out;
  return out;
}

// --- segnaletica orizzontale (a terra) -----------------------------------------
export interface Markings {
  stops: InstanceXform[]; // linee di stop
  arrows: InstanceXform[]; // frecce dritte
  bumps: InstanceXform[]; // dossi
  zebra: InstanceXform[]; // strisce dei passaggi pedonali a meta' isolato
}
let markCache: Markings | null = null;
export const STOP_LINE_DC = 9.2; // distanza dal centro dell'incrocio

export function getMarkings(): Markings {
  if (markCache) return markCache;
  const rnd = worldRng('street-markings');
  const LIM = ROAD_OFFSETS[ROAD_OFFSETS.length - 1];
  const stops: InstanceXform[] = [];
  const arrows: InstanceXform[] = [];
  const bumps: InstanceXform[] = [];
  const zebra: InstanceXform[] = [];
  const y = ROAD_Y_OFFSET + 0.014;
  for (const ox of ROAD_OFFSETS) {
    for (const oz of ROAD_OFFSETS) {
      // quattro avvicinamenti: (dx, dz) = direzione di marcia, la corsia e' a destra
      for (const [hx, hz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        // di la' non c'e' strada: niente
        if (Math.abs(ox - hx * 60) > LIM || Math.abs(oz - hz * 60) > LIM) continue;
        // destra di (hx,hz): per +x e' +z, per -x e' -z, per +z e' -x, per -z e' +x
        const rx = -hz;
        const rz = hx;
        const lane = 2.0;
        const cx = ox - hx * STOP_LINE_DC + rx * lane;
        const cz = oz - hz * STOP_LINE_DC + rz * lane;
        // linea di stop: sottile lungo la marcia, larga come la corsia
        stops.push({ x: cx, y, z: cz, sx: hx !== 0 ? 0.5 : 3.8, sz: hx !== 0 ? 3.8 : 0.5, sy: 1 });
        // freccia dritta 12 m prima della linea
        const ax = cx - hx * 12;
        const az = cz - hz * 12;
        arrows.push({ x: ax, y, z: az, ry: Math.atan2(-hx, -hz), s: 1 });
      }
    }
  }
  // dossi e passaggi a meta' isolato su alcuni tratti
  for (let ai = 0; ai < 2; ai++) {
    for (const line of ROAD_OFFSETS) {
      for (let i = 0; i < ROAD_OFFSETS.length - 1; i++) {
        const a = ROAD_OFFSETS[i];
        const mid = a + 30;
        const r = rnd();
        if (r < 0.2) {
          bumps.push(ai === 0 ? { x: mid + 8, y: ROAD_Y_OFFSET + 0.035, z: line, ry: Math.PI / 2 } : { x: line, y: ROAD_Y_OFFSET + 0.035, z: mid + 8 });
        } else if (r < 0.45) {
          for (let k = 0; k < 6; k++) {
            const o = (k - 2.5) * 1.2;
            zebra.push(ai === 0 ? { x: mid - 6, y, z: line + o, ry: Math.PI / 2 } : { x: line + o, y, z: mid - 6 });
          }
        }
      }
    }
  }
  markCache = { stops, arrows, bumps, zebra };
  return markCache;
}

void SIDEWALK_WIDTH;
