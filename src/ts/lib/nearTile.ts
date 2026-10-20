import * as THREE from 'three';
import { PLANET_RADIUS as R, hEff, noise3, seaColor, surfaceColor, surfaceHeight, surfaceInfo } from './planetSurface';
import { GRID, TILES, tileOfDir, tileParts, tileVertexDir, faceDir } from './cubeTiles';
import { cellDir, cellOf, hashKey, makeCell } from './globalGrid';
import { planetCatalog } from './planet';

// Costruzione (a pezzetti, con un generatore) delle tessere del pianeta e della loro vegetazione. Tutto nel riferimento
// del PIANETA: nessuna dipendenza dal sito, quindi nessun salto cambiando sito.
const N1 = GRID + 1;
export const TILE_VERTS = N1 * N1;
const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface TileBuffers {
  pos: Float32Array;
  nor: Float32Array;
  col: Float32Array;
  wpos: Float32Array;
  wcol: Float32Array;
  hasWater: boolean;
}
export const makeTileBuffers = (): TileBuffers => ({
  pos: new Float32Array(TILE_VERTS * 3),
  nor: new Float32Array(TILE_VERTS * 3),
  col: new Float32Array(TILE_VERTS * 3),
  wpos: new Float32Array(TILE_VERTS * 3),
  wcol: new Float32Array(TILE_VERTS * 3),
  hasWater: false,
});

// la zolla piatta della citta' (polo nord) sta sotto la mesh della citta' (components/Environment/Terrain.tsx, solo siti
// 'city'): la tessera li' si abbassa di un metro e mezzo per non sovrapporsi (niente fessure ne' z-fighting)
const CITY_DROP = 1.5;
const cityDrop = (ang: number) => CITY_DROP * (1 - smooth(0.07, 0.1, ang));

const ROCK = new THREE.Color('#6a6560');
const SHALLOW = new THREE.Color('#58b9b4');
const BUDGET_MS = 4;

// terreno e acqua della tessera `key` del pianeta `seed`: riempie `out`
export function* buildTileMesh(key: number, seed: number, out: TileBuffers): Generator<void, void, void> {
  const B = GRID + 3; // con un giro di bordo per le normali
  const P = new Float32Array(B * B * 3);
  const dirs = new Float32Array(B * B * 3);
  const raw = new Float32Array(B * B);
  const d = new THREE.Vector3();
  let t0 = performance.now();
  for (let gj = -1; gj <= GRID + 1; gj++) {
    for (let gi = -1; gi <= GRID + 1; gi++) {
      tileVertexDir(key, gi, gj, d);
      const k = ((gj + 1) * B + (gi + 1));
      const h = surfaceHeight(seed, d.x, d.y, d.z);
      raw[k] = h;
      dirs[k * 3] = d.x;
      dirs[k * 3 + 1] = d.y;
      dirs[k * 3 + 2] = d.z;
      const r = R + hEff(h) - cityDrop(Math.acos(Math.min(1, Math.max(-1, d.y))));
      P[k * 3] = d.x * r;
      P[k * 3 + 1] = d.y * r;
      P[k * 3 + 2] = d.z * r;
    }
    if (performance.now() - t0 > BUDGET_MS) {
      yield;
      t0 = performance.now();
    }
  }
  const seaDeep = seaColor(seed);
  const colr = new THREE.Color();
  const wcol = new THREE.Color();
  let hasWater = false;
  const ax = new THREE.Vector3(), bx = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let gj = 0; gj <= GRID; gj++) {
    for (let gi = 0; gi <= GRID; gi++) {
      const k = (gj + 1) * B + (gi + 1);
      const kl = k - 1, kr = k + 1, kd = k - B, ku = k + B;
      ax.set(P[kr * 3] - P[kl * 3], P[kr * 3 + 1] - P[kl * 3 + 1], P[kr * 3 + 2] - P[kl * 3 + 2]);
      bx.set(P[ku * 3] - P[kd * 3], P[ku * 3 + 1] - P[kd * 3 + 1], P[ku * 3 + 2] - P[kd * 3 + 2]);
      nn.crossVectors(ax, bx).normalize();
      const o = (gj * N1 + gi) * 3;
      out.pos[o] = P[k * 3];
      out.pos[o + 1] = P[k * 3 + 1];
      out.pos[o + 2] = P[k * 3 + 2];
      out.nor[o] = nn.x;
      out.nor[o + 1] = nn.y;
      out.nor[o + 2] = nn.z;
      const dx = dirs[k * 3], dy = dirs[k * 3 + 1], dz = dirs[k * 3 + 2];
      const h = raw[k];
      const info = surfaceInfo(seed, dx, dy, dz, h);
      surfaceColor(seed, info, colr);
      // le pendenze forti diventano roccia (sott'acqua meno)
      d.set(dx, dy, dz);
      colr.lerp(ROCK, rockMix(seed, d, h));
      out.col[o] = colr.r;
      out.col[o + 1] = colr.g;
      out.col[o + 2] = colr.b;
      // acqua: opaca, piu' chiara dove il fondale e' basso
      const rw = R + 0.05;
      out.wpos[o] = dx * rw;
      out.wpos[o + 1] = dy * rw;
      out.wpos[o + 2] = dz * rw;
      const depth = Math.max(0, -h);
      if (h < 0.5) hasWater = true;
      wcol.copy(SHALLOW).lerp(seaDeep, smooth(0, 9, depth));
      out.wcol[o] = wcol.r;
      out.wcol[o + 1] = wcol.g;
      out.wcol[o + 2] = wcol.b;
    }
    if (performance.now() - t0 > BUDGET_MS) {
      yield;
      t0 = performance.now();
    }
  }
  out.hasWater = hasWater;
}

// --- vegetazione -----------------------------------------------------------------------------------------------
export interface VegItem {
  m: THREE.Matrix4; // posizione + orientamento (alto lungo la normale) + scala, nel riferimento del pianeta
  x: number;
  y: number;
  z: number; // posizione (per il culling)
  t: number; // 0..99: modello d'albero
  color?: number;
}
export interface Vegetation {
  trees: VegItem[];
  rocks: VegItem[];
  tufts: VegItem[];
}

export const TREE_CELL = 12;
export const TUFT_CELL = 6;

const _q = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _axis = new THREE.Vector3(0, 1, 0);
function placeMatrix(dir: THREE.Vector3, rad: number, yaw: number, sx: number, sy: number, sz: number): THREE.Matrix4 {
  _q.setFromUnitVectors(_up, dir);
  _qy.setFromAxisAngle(_axis, yaw);
  _q.multiply(_qy);
  _pos.copy(dir).multiplyScalar(rad);
  _scl.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_pos, _q, _scl);
}

// l'area della citta' (rettangolo piatto al polo): niente vegetazione dentro
export function inCityRect(seed: number, dx: number, dy: number, dz: number, margin = 120): boolean {
  if (dy <= 0.5) return false;
  const gr = planetCatalog().find((p) => p.seed === seed)?.gridRadius ?? 2;
  const half = (gr + 1) * 60 + margin;
  const x = (R + 6) * (dx / dy), z = (R + 6) * (dz / dy);
  return Math.abs(x) < half && Math.abs(z) < half;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _ux = new THREE.Vector3(1, 0, 0);
// pendenza (m/m) del terreno nella direzione d, su 3 m
export function slopeAt(seed: number, d: THREE.Vector3, h: number): number {
  _a.crossVectors(d, Math.abs(d.y) > 0.9 ? _ux : _up).normalize();
  _b.crossVectors(d, _a);
  const e = 3 / R;
  _c.copy(d).addScaledVector(_a, e).normalize();
  const h1 = hEff(surfaceHeight(seed, _c.x, _c.y, _c.z));
  _c.copy(d).addScaledVector(_b, e).normalize();
  const h2 = hEff(surfaceHeight(seed, _c.x, _c.y, _c.z));
  const h0 = hEff(h);
  return Math.max(Math.abs(h1 - h0), Math.abs(h2 - h0)) / 3;
}

// quanta roccia sulle pendenze (0..1): dalla pendenza ANALITICA su 3 m, non dai triangoli della mesh, cosi' il colore e' lo
// stesso a qualunque risoluzione (tessera, livelli di dettaglio): niente cambio di colore quando il dettaglio aumenta
export function rockMix(seed: number, d: THREE.Vector3, h: number): number {
  const g = slopeAt(seed, d, h);
  return smooth(0.3, 0.6, 1 - 1 / Math.hypot(1, g)) * (h > 0 ? 1 : 0.4);
}

// alberi e rocce (e, se `withTufts`, prato) di una tessera, per cella della griglia lat/lon del pianeta
export function* buildTileVegetation(key: number, seed: number, what: 'base' | 'tufts', out: Vegetation): Generator<void, void, void> {
  const { face, i, j } = tileParts(key);
  const cell = makeCell();
  const seen = new Set<number>();
  const d = new THREE.Vector3(), dj = new THREE.Vector3();
  const tseed = (seed ^ 0x7a11) | 0;
  const rseed = (seed ^ 0x51ed) | 0;
  let t0 = performance.now();
  const tileLen = (Math.PI * R) / 2 / TILES;

  const drive = function* (size: number, fn: (c: ReturnType<typeof makeCell>, dd: THREE.Vector3, h: number) => void): Generator<void, void, void> {
    seen.clear();
    const steps = Math.ceil((tileLen * 1.15) / (size / 2));
    for (let sj = 0; sj < steps; sj++) {
      for (let si = 0; si < steps; si++) {
        faceDir(face, (i + (si + 0.5) / steps) / TILES, (j + (sj + 0.5) / steps) / TILES, d);
        cellOf(d.x, d.y, d.z, size, cell);
        if (seen.has(cell.key)) continue;
        seen.add(cell.key);
        cellDir(cell, size, hashKey(cell.key, 1, rseed), hashKey(cell.key, 2, rseed), dj);
        if (tileOfDir(dj.x, dj.y, dj.z) !== key) continue;
        if (inCityRect(seed, dj.x, dj.y, dj.z)) continue;
        fn(cell, dj, surfaceHeight(seed, dj.x, dj.y, dj.z));
      }
      if (performance.now() - t0 > BUDGET_MS) {
        yield;
        t0 = performance.now();
      }
    }
  };

  // alberi e rocce
  if (what === 'base') yield* drive(TREE_CELL, (c, dd, h) => {
    const info = surfaceInfo(seed, dd.x, dd.y, dd.z, h);
    if (info.h < 3) return; // acqua / spiaggia
    const k = c.key;
    const roll = hashKey(k, 3, rseed);
    const rad = R + hEff(h);
    if (info.forest > 0.05 && roll < info.forest * 0.85) {
      if (slopeAt(seed, dd, h) < 0.6) {
        const s = 0.17 + hashKey(k, 5, rseed) * 0.14;
        out.trees.push({ m: placeMatrix(dd, rad, hashKey(k, 4, rseed) * Math.PI * 2, s, s, s), x: dd.x * rad, y: dd.y * rad, z: dd.z * rad, t: Math.floor(hashKey(k, 6, rseed) * 100) });
      }
    } else if (roll > 0.9) {
      const sl = slopeAt(seed, dd, h);
      if (sl > 0.35 || info.rock > 0.3) {
        const s = 0.5 + hashKey(k, 7, rseed) * 2.4;
        const r2 = rad + s * 0.2;
        out.rocks.push({ m: placeMatrix(dd, r2, hashKey(k, 8, rseed) * Math.PI * 2, s * 1.3, s * 0.8, s), x: dd.x * r2, y: dd.y * r2, z: dd.z * r2, t: 0 });
      }
    }
  });
  if (what !== 'tufts') return;
  // prato: a chiazze (rumore sul pianeta a ~35 m e ~9 m), piu' fitto dove e' alto
  const green = new THREE.Color();
  yield* drive(TUFT_CELL, (c, dd, h) => {
    const k = c.key;
    const sx = dd.x * R, sy = dd.y * R, sz = dd.z * R;
    const patch = noise3(sx / 35, sy / 35, sz / 35, tseed + 2) * 0.7 + noise3(sx / 9, sy / 9, sz / 9, tseed + 3) * 0.3;
    if (hashKey(k, 4, tseed) > Math.max(0, patch - 0.3) * 2.1) return;
    const info = surfaceInfo(seed, dd.x, dd.y, dd.z, h);
    if (info.h < 1.5 || info.sand > 0.3 || info.snow > 0.1 || info.rock > 0.3) return;
    if (slopeAt(seed, dd, h) > 0.5) return;
    const rad = R + hEff(h);
    const sc = 1 + hashKey(k, 5, tseed) * 1.1;
    green.setHSL(0.2 + hashKey(k, 6, tseed) * 0.1, 0.5, 0.45 + hashKey(k, 7, tseed) * 0.15);
    out.tufts.push({ m: placeMatrix(dd, rad, hashKey(k, 8, tseed) * Math.PI * 2, sc, sc * (0.8 + hashKey(k, 9, tseed) * 0.6), sc), x: dd.x * rad, y: dd.y * rad, z: dd.z * rad, t: 0, color: green.getHex() });
  });
}
