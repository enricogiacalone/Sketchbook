import * as THREE from 'three';
import { PLANET_RADIUS as R, hEff, noise3, seaColor, surfaceColor, surfaceHeight, surfaceInfo } from './planetSurface';
import { GRID, faceDir } from './cubeTiles';
import { rockMix, pathMix, pathColor } from './nearTile';

// Un nodo del quadtree del pianeta (una faccia della cubo-sfera, livello 0 = tutta la faccia, livello MAX_LEVEL = tessera da
// ~4.6 m): una griglia GRID x GRID di celle, piu' una "gonna" lungo i bordi (copre le fessure tra livelli diversi) e per
// ogni vertice la posizione/normale/colore del PADRE (bersaglio del geomorphing: un vertice dispari sta a meta' tra due
// vertici del livello sopra), cosi' passare da un livello all'altro non fa saltare niente.
export const MAX_LEVEL = 4;
const N1 = GRID + 1;
export const GRID_VERTS = N1 * N1;
export const NODE_VERTS = GRID_VERTS + 4 * N1; // griglia + gonna
const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface NodeBuffers {
  pos: Float32Array;
  nor: Float32Array;
  col: Float32Array;
  mpos: Float32Array; // bersaglio del morph (padre)
  mnor: Float32Array;
  mcol: Float32Array;
  wpos: Float32Array; // acqua (solo griglia)
  wcol: Float32Array;
  hasWater: boolean;
}
export const makeNodeBuffers = (): NodeBuffers => ({
  pos: new Float32Array(NODE_VERTS * 3),
  nor: new Float32Array(NODE_VERTS * 3),
  col: new Float32Array(NODE_VERTS * 3),
  mpos: new Float32Array(NODE_VERTS * 3),
  mnor: new Float32Array(NODE_VERTS * 3),
  mcol: new Float32Array(NODE_VERTS * 3),
  wpos: new Float32Array(GRID_VERTS * 3),
  wcol: new Float32Array(GRID_VERTS * 3),
  hasWater: false,
});

// la zolla piatta della citta' sta sotto la mesh della citta' (Terrain.tsx): li' la superficie si abbassa di 1.5 m
const CITY_DROP = 1.5;
const cityDrop = (ang: number) => CITY_DROP * (1 - smooth(0.07, 0.1, ang));
const ROCK = new THREE.Color('#6a6560');
const DRY = new THREE.Color('#b0a05a');
const MOSS = new THREE.Color('#3f5a2a');
const LITTER = new THREE.Color('#4a3a22');
const SHALLOW = new THREE.Color('#58b9b4');
const BUDGET_MS = 3;

// lato di un nodo del livello `level` (m, al centro faccia)
export const nodeSize = (level: number) => (Math.PI * R) / 2 / (1 << level);

export function* buildNodeMesh(face: number, level: number, ni: number, nj: number, seed: number, out: NodeBuffers): Generator<void, void, void> {
  const B = GRID + 3;
  const P = new Float32Array(B * B * 3);
  const dirs = new Float32Array(B * B * 3);
  const raw = new Float32Array(B * B);
  const d = new THREE.Vector3();
  const T = 1 << level;
  let t0 = performance.now();
  for (let gj = -1; gj <= GRID + 1; gj++) {
    for (let gi = -1; gi <= GRID + 1; gi++) {
      faceDir(face, (ni + gi / GRID) / T, (nj + gj / GRID) / T, d);
      const k = (gj + 1) * B + (gi + 1);
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
  const ax = new THREE.Vector3(), bx = new THREE.Vector3(), nn = new THREE.Vector3();
  let hasWater = false;
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
      d.set(dx, dy, dz);
      const rm = rockMix(seed, d, h);
      colr.lerp(ROCK, rm);
      // il suolo non e' di un colore solo: chiazze piu' chiare e piu' scure (35 m e 9 m), erba che vira al secco, nel bosco
      // lettiera scura e muschio; sulla riva e in acqua niente
      if (h > 1.5) {
        const sx = dx * R, sy = dy * R, sz = dz * R;
        const v = (noise3(sx / 38, sy / 38, sz / 38, seed + 404) - 0.5) * 0.34 + (noise3(sx / 9, sy / 9, sz / 9, seed + 405) - 0.5) * 0.12;
        colr.multiplyScalar(1 + v);
        const dry = Math.max(0, noise3(sx / 140, sy / 140, sz / 140, seed + 406) - 0.58) * 1.8 * (1 - info.forest);
        if (dry > 0) colr.lerp(DRY, Math.min(0.4, dry * 0.3));
        if (info.forest > 0.2) colr.lerp(noise3(sx / 21, sy / 21, sz / 21, seed + 407) > 0.5 ? MOSS : LITTER, Math.min(0.5, info.forest * 0.45));
      }
      // sentieri: solo dai nodi piu' fini (livello 3: celle di ~9 m, livello 4: ~4.6 m): sotto non sono risolvibili
      if (level >= 3) {
        const pm = pathMix(seed, d.x, d.y, d.z, h, rm) * (level === 3 ? 0.65 : 1);
        if (pm > 0.002) colr.lerp(pathColor(), pm * 0.85);
      }
      out.col[o] = colr.r;
      out.col[o + 1] = colr.g;
      out.col[o + 2] = colr.b;
      const rw = R + 0.05;
      out.wpos[o] = dx * rw;
      out.wpos[o + 1] = dy * rw;
      out.wpos[o + 2] = dz * rw;
      if (h < 0.5) hasWater = true;
      wcol.copy(SHALLOW).lerp(seaDeep, smooth(0, 9, Math.max(0, -h)));
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

  // bersagli del morph: la quota/normale/colore che avrebbe il livello PADRE in ogni vertice (i dispari stanno sulla media dei
  // vertici pari vicini: lungo un lato la media dei due estremi, al centro di una cella del padre la media sulla diagonale
  // usata dalla triangolazione, b-d)
  const setM = (dst: Float32Array, o: number, x: number, y: number, z: number) => {
    dst[o] = x;
    dst[o + 1] = y;
    dst[o + 2] = z;
  };
  const mid = (src: Float32Array, dst: Float32Array, o: number, a: number, b: number, norm: boolean) => {
    let x = (src[a] + src[b]) / 2, y = (src[a + 1] + src[b + 1]) / 2, z = (src[a + 2] + src[b + 2]) / 2;
    if (norm) {
      const l = Math.hypot(x, y, z) || 1;
      x /= l;
      y /= l;
      z /= l;
    }
    setM(dst, o, x, y, z);
  };
  for (let gj = 0; gj <= GRID; gj++) {
    for (let gi = 0; gi <= GRID; gi++) {
      const o = (gj * N1 + gi) * 3;
      const oddI = gi & 1, oddJ = gj & 1;
      let a: number, b: number;
      if (!oddI && !oddJ) {
        setM(out.mpos, o, out.pos[o], out.pos[o + 1], out.pos[o + 2]);
        setM(out.mnor, o, out.nor[o], out.nor[o + 1], out.nor[o + 2]);
        setM(out.mcol, o, out.col[o], out.col[o + 1], out.col[o + 2]);
        continue;
      }
      if (oddI && !oddJ) {
        a = (gj * N1 + gi - 1) * 3;
        b = (gj * N1 + gi + 1) * 3;
      } else if (!oddI && oddJ) {
        a = ((gj - 1) * N1 + gi) * 3;
        b = ((gj + 1) * N1 + gi) * 3;
      } else {
        a = ((gj - 1) * N1 + gi + 1) * 3; // b della cella del padre
        b = ((gj + 1) * N1 + gi - 1) * 3; // d della cella del padre
      }
      mid(out.pos, out.mpos, o, a, b, false);
      mid(out.nor, out.mnor, o, a, b, true);
      mid(out.col, out.mcol, o, a, b, false);
    }
  }
  // gonna: copia dei vertici di bordo spinta verso il centro del pianeta (copre le fessure tra livelli diversi)
  const depth = 0.6 * (nodeSize(level) / GRID);
  const sides: Array<(k: number) => number> = [
    (k) => k, // gj = 0
    (k) => GRID * N1 + k, // gj = GRID
    (k) => k * N1, // gi = 0
    (k) => k * N1 + GRID, // gi = GRID
  ];
  for (let s = 0; s < 4; s++) {
    for (let k = 0; k <= GRID; k++) {
      const src = sides[s](k) * 3;
      const dst = (GRID_VERTS + s * N1 + k) * 3;
      for (const arr of [out.pos, out.mpos]) {
        const px = arr[src], py = arr[src + 1], pz = arr[src + 2];
        const l = Math.hypot(px, py, pz) || 1;
        arr[dst] = px - (px / l) * depth;
        arr[dst + 1] = py - (py / l) * depth;
        arr[dst + 2] = pz - (pz / l) * depth;
      }
      for (const arr of [out.nor, out.mnor, out.col, out.mcol]) {
        arr[dst] = arr[src];
        arr[dst + 1] = arr[src + 1];
        arr[dst + 2] = arr[src + 2];
      }
    }
  }
}

// indici condivisi da tutti i nodi: griglia + gonna
export const NODE_INDEX = (() => {
  const idx: number[] = [];
  for (let j = 0; j < GRID; j++)
    for (let i = 0; i < GRID; i++) {
      const a = j * N1 + i, b = a + 1, dd = a + N1, e = dd + 1;
      idx.push(a, b, dd, b, e, dd);
    }
  // gonna: per ogni lato, strisce tra il bordo e la sua copia abbassata (visibile da entrambi i lati: material DoubleSide non
  // serve, si aggiungono i due versi)
  const edge = [
    (k: number) => k,
    (k: number) => GRID * N1 + k,
    (k: number) => k * N1,
    (k: number) => k * N1 + GRID,
  ];
  for (let s = 0; s < 4; s++) {
    for (let k = 0; k < GRID; k++) {
      const a = edge[s](k), b = edge[s](k + 1);
      const c = GRID_VERTS + s * N1 + k, e = GRID_VERTS + s * N1 + k + 1;
      idx.push(a, b, c, b, e, c, a, c, b, b, c, e);
    }
  }
  return idx;
})();
