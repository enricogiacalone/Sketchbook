import * as THREE from 'three';
import { PLANET_RADIUS as R, hEff, noise3, seaColor, surfaceColor, surfaceHeight, surfaceInfo } from './planetSurface';
import { GRID, TILES, tileOfDir, tileParts, tileVertexDir, faceDir } from './cubeTiles';
import { cellDir, cellOf, hashKey, makeCell } from './globalGrid';
import { planetCatalog } from './planet';
import { BRIDGE_BASE } from './culture';
import { buildRoadsForTile, type RoadBuf } from './roadMesh';
import { roadMask } from './roads';
import { villageFieldTint, ruinItemPlacement, ruinItems, villageBlocked, villageFrame, villageGround, villageItemMatrix, villageItemPos, villageItems, villageLocal, villageTileItems } from './village';
import { villagesOf, siteNear, tangentBasis, ruinsOf, ruinNear } from './planetSurface';

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
  houses: VegItem[]; // villaggi: t = tipo (VK), color = tinta; m include la scala
  roads?: RoadBuf | null; // nastri delle strade degli abitati (lib/roadMesh.ts)
}

export const TREE_CELL = 8.4;
export const TUFT_CELL = 2.7;
// copertura del suolo (campo `t` dei 'tufts'): 0 erba, 1 fiori, 2 felci, 3 cespugli
export const COVER_GRASS = 0, COVER_FLOWER = 1, COVER_FERN = 2, COVER_BUSH = 3, COVER_TALL = 4;

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

const _fieldc = new THREE.Color();
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

// --- sentieri ------------------------------------------------------------------------------------------------------
// Linee di livello del rumore sul pianeta: dove il rumore vale 0.5 passa un sentiero. La distanza dalla linea (in metri) si
// stima dal valore e dal gradiente (|n - 0.5| / |grad n|), cosi' la larghezza e' vera anche dove il rumore e' piatto.
// Due famiglie: i sentieri principali (lunghi, larghi) e i viottoli (piu' sottili, a tratti).
const PATH_MAIN = 520; // m: scala del rumore dei sentieri principali
const PATH_MINOR = 190;
const PATH_COLOR = new THREE.Color('#8b7350');
function lineDist(seed: number, sx: number, sy: number, sz: number, scale: number, off: number): number {
  const x = sx / scale + off, y = sy / scale + off * 0.7, z = sz / scale - off * 0.4;
  const e = 0.02;
  const n0 = noise3(x, y, z, seed);
  const gx = (noise3(x + e, y, z, seed) - n0) / e;
  const gy = (noise3(x, y + e, z, seed) - n0) / e;
  const gz = (noise3(x, y, z + e, seed) - n0) / e;
  const g = Math.max(0.12, Math.hypot(gx, gy, gz));
  return (Math.abs(n0 - 0.5) / g) * scale;
}
// 0..1: quanto sentiero c'e' nel punto (direzione unitaria)
export function pathMask(seed: number, dx: number, dy: number, dz: number): number {
  const rm = roadMask(seed, dx, dy, dz);
  if (rm > 0.98) return 1;
  const sx = dx * R, sy = dy * R, sz = dz * R;
  const ps = (seed ^ 0x9a71) | 0;
  const wob = (noise3(sx / 55, sy / 55, sz / 55, ps + 5) - 0.5) * 7; // i bordi ondeggiano
  const d1 = lineDist(seed ^ 0x3c1d, sx, sy, sz, PATH_MAIN, 7.3) + wob;
  // (bordo morbido: i vertici del terreno sono ogni ~4.6 m, un bordo netto farebbe i gradini)
  let m = 1 - smooth(1.2, 6.0, d1);
  m = Math.max(m, rm);
  // viottoli: solo dove un rumore largo lo permette
  if (m < 1) {
    const on = noise3(sx / 400 + 2, sy / 400, sz / 400, ps + 9);
    if (on > 0.34) {
      const d2 = lineDist(seed ^ 0x6b2f, sx, sy, sz, PATH_MINOR, 3.1) + wob * 0.5;
      m = Math.max(m, (1 - smooth(0.6, 3.6, d2)) * smooth(0.34, 0.5, on));
    }
  }
  return m;
}
// il sentiero sul colore del terreno: non sull'acqua, sulla spiaggia, sulla neve, sulle pendenze forti (rocciose)
export function pathMix(seed: number, dx: number, dy: number, dz: number, h: number, rock: number): number {
  if (h < 1.2 || h > 150) return 0;
  const m = pathMask(seed, dx, dy, dz);
  return m * (1 - Math.min(1, rock * 1.6));
}
export const pathColor = (): THREE.Color => PATH_COLOR;

// specie dell'albero (indice nei modelli di PlanetNearField, vedi PLANET_TREE_SPECIES: 0-7 latifoglie, 8-11 pini): i pini
// salgono di quota, le querce stanno in basso, frassini e pioppi in mezzo; un po' di tutto ovunque
function speciesAt(h: number, a: number, b: number): number {
  const pine = smooth(35, 110, h) * 0.9 + 0.06;
  if (a < pine) return 8 + Math.floor(b * 4) % 4;
  // latifoglie: querce (4-7) in basso, frassini e pioppi (0-3) piu' su
  const oak = 1 - smooth(20, 80, h);
  return b < oak ? 4 + Math.floor((b / Math.max(0.01, oak)) * 4) % 4 : Math.floor(((b - oak) / Math.max(0.01, 1 - oak)) * 4) % 4;
}


// --- ponti ---------------------------------------------------------------------------------------------------------
// Dove un sentiero attraversa l'acqua (fiume o lago stretto) c'e' un ponte di legno. Si cerca per tessera su una griglia di
// BRIDGE_GRID m: dove il sentiero e' forte e il terreno e' sotto il livello del mare si segue la direzione del sentiero nei due
// versi fino alla terra; se il tratto e' < BRIDGE_MAX m si piazza un ponte (kind BRIDGE_BASE + lunghezza/4) al centro, appartiene
// alla tessera che contiene il centro (niente doppioni). Il piano del ponte e' tangente: quota = riva piu' alta + 0.4 m.
export { BRIDGE_BASE } from './culture'; // ponti: kind = BRIDGE_BASE + b (lunghezza 4*b metri, b = 3..22)
export const BRIDGE_WIDTH = 4.2;
const BRIDGE_GRID = 10;
const BRIDGE_MAX = 78;
const BRIDGE_STEP = 2.5;
interface Bridge { c: THREE.Vector3; t: THREE.Vector3; deck: number; len: number }
const _bd = new THREE.Vector3(), _bp = new THREE.Vector3(), _bt = new THREE.Vector3();
function offsetDir(d: THREE.Vector3, e1: number[], e2: number[], ang: number, dist: number, out: THREE.Vector3): THREE.Vector3 {
  const k = dist / R, c = Math.cos(ang) * k, s = Math.sin(ang) * k;
  return out.set(d.x + e1[0] * c + e2[0] * s, d.y + e1[1] * c + e2[1] * s, d.z + e1[2] * c + e2[2] * s).normalize();
}
function findBridge(seed: number, d: THREE.Vector3): Bridge | null {
  const b = tangentBasis(d.x, d.y, d.z);
  const e1 = [b[0], b[1], b[2]], e2 = [b[3], b[4], b[5]];
  // direzione del sentiero: l'angolo dove la maschera e' alta da entrambi i lati
  let best = -1;
  let ang = 0;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI;
    const m = pathMask(seed, ...(offsetDir(d, e1, e2, a, 12, _bp).toArray() as [number, number, number])) + pathMask(seed, ...(offsetDir(d, e1, e2, a + Math.PI, 12, _bp).toArray() as [number, number, number]));
    if (m > best) { best = m; ang = a; }
  }
  if (best < 1.0) return null;
  // tra qualche angolo vicino alla direzione del sentiero si prende l'attraversamento piu' corto (il ponte taglia il fiume
  // quasi dritto invece di seguirlo di sbieco); verso la terra, nei due versi
  let ends: Array<{ s: number; h: number }> | null = null;
  let span = Infinity;
  let angUsed = ang;
  for (const da of [0, -0.26, 0.26, -0.52, 0.52]) {
    const e: Array<{ s: number; h: number }> = [];
    for (const sign of [1, -1]) {
      let found: { s: number; h: number } | null = null;
      for (let s = BRIDGE_STEP; s <= BRIDGE_MAX / 2 + 6; s += BRIDGE_STEP) {
        offsetDir(d, e1, e2, ang + da, sign * s, _bp);
        const h = surfaceHeight(seed, _bp.x, _bp.y, _bp.z);
        if (h > 1.4) { found = { s: sign * s, h }; break; }
      }
      if (!found) break;
      e.push(found);
    }
    if (e.length < 2) continue;
    const sp = Math.abs(e[0].s - e[1].s);
    if (sp < span - 1) { span = sp; ends = e; angUsed = ang + da; }
  }
  if (!ends) return null;
  ang = angUsed;
  if (span < 6 || span > BRIDGE_MAX) return null;
  const mid = (ends[0].s + ends[1].s) / 2;
  const c = offsetDir(d, e1, e2, ang, mid, new THREE.Vector3());
  // la tangente al centro (verso il bordo '+')
  offsetDir(d, e1, e2, ang, mid + 1, _bd);
  _bt.copy(_bd).sub(c);
  _bt.addScaledVector(c, -_bt.dot(c)).normalize();
  // le rive: la quota piu' alta + 0.4 m (e almeno 2.2 m sull'acqua)
  const deck = Math.max(2.2, Math.max(ends[0].h, ends[1].h) + 0.4);
  return { c, t: _bt.clone(), deck, len: span + 5 };
}

// alberi e rocce (e, se `withTufts`, prato) di una tessera, per cella della griglia lat/lon del pianeta
export function* buildTileVegetation(key: number, seed: number, what: 'base' | 'tufts', out: Vegetation, withRoads = true): Generator<void, void, void> {
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

  // abitati: case e arredi di questa tessera (le posizioni sono sul piano della zolla, riportate sulla sfera)
  if (what === 'base') {
    for (const v of villagesOf(seed)) {
      const list = villageTileItems(seed, v, key);
      if (list.length === 0) continue;
      const fr = villageFrame(v, seed);
      for (const it of list) {
        villageItemPos(it, fr, _pos);
        const m = villageItemMatrix(it, fr);
        out.houses.push({ m, x: _pos.x, y: _pos.y, z: _pos.z, t: it.kind, color: it.tint });
      }
    }
  }
  if (what === 'base' && withRoads) out.roads = buildRoadsForTile(seed, key);
  // rovine: ogni pezzo alla quota vera del terreno
  if (what === 'base') {
    const rd = new THREE.Vector3(), rm = new THREE.Matrix4();
    for (const r of ruinsOf(seed)) {
      for (const it of ruinItems(seed, r)) {
        if (!ruinItemPlacement(seed, r, it, rm, rd)) continue;
        if (tileOfDir(rd.x, rd.y, rd.z) !== key) continue;
        const e = rm.elements;
        out.houses.push({ m: rm.clone(), x: e[12], y: e[13], z: e[14], t: it.kind, color: it.tint });
      }
    }
  }
  // ponti: dove un sentiero attraversa l'acqua
  if (what === 'base') {
    const n = Math.ceil((tileLen * 1.05) / BRIDGE_GRID);
    const done = new Set<string>();
    const centers: THREE.Vector3[] = [];
    const bd = new THREE.Vector3();
    for (let sj = 0; sj < n; sj++) {
      for (let si = 0; si < n; si++) {
        faceDir(face, (i + (si + 0.5) / n) / TILES, (j + (sj + 0.5) / n) / TILES, bd);
        if (pathMask(seed, bd.x, bd.y, bd.z) < 0.3) continue;
        if (surfaceHeight(seed, bd.x, bd.y, bd.z) > -0.3) continue; // solo dove c'e' acqua
        if (inCityRect(seed, bd.x, bd.y, bd.z)) continue;
        // vicino a un ponte gia' trovato in questa tessera: niente doppioni
        if (centers.some((c) => c.distanceToSquared(bd) < (100 / R) ** 2)) continue;
        const br = findBridge(seed, bd);
        if (!br) continue;
        if (tileOfDir(br.c.x, br.c.y, br.c.z) !== key) continue;
        const k = `${Math.round(br.c.x * R / 8)},${Math.round(br.c.y * R / 8)},${Math.round(br.c.z * R / 8)}`;
        if (done.has(k)) continue;
        done.add(k);
        centers.push(br.c.clone());
        const bucket = Math.min(22, Math.max(3, Math.ceil(br.len / 4)));
        const rad = R + br.deck;
        const x = new THREE.Vector3().crossVectors(br.c, br.t);
        const m = new THREE.Matrix4().makeBasis(x, br.c, br.t).setPosition(br.c.x * rad, br.c.y * rad, br.c.z * rad);
        out.houses.push({ m, x: br.c.x * rad, y: br.c.y * rad, z: br.c.z * rad, t: BRIDGE_BASE + bucket, color: 0xffffff });
      }
      if (performance.now() - t0 > BUDGET_MS) {
        yield;
        t0 = performance.now();
      }
    }
  }
  // alberi e rocce
  if (what === 'base') yield* drive(TREE_CELL, (c, dd, h) => {
    const info = surfaceInfo(seed, dd.x, dd.y, dd.z, h);
    if (info.h < 3) return; // acqua / spiaggia
    if (pathMask(seed, dd.x, dd.y, dd.z) > 0.1) return; // i sentieri restano liberi
    if (siteNear(seed, dd.x, dd.y, dd.z, 26)) return; // niente alberi ne' rocce dentro l'abitato
    if (siteNear(seed, dd.x, dd.y, dd.z, 200) && villageFieldTint(seed, dd.x, dd.y, dd.z, _fieldc) > 0.3) return; // ne' sui campi coltivati
    if (ruinNear(seed, dd.x, dd.y, dd.z, 16)) return; // le rovine restano libere (l'erba invece le copre)
    const k = c.key;
    const roll = hashKey(k, 3, rseed);
    const rad = R + hEff(h);
    if (info.forest > 0.05 && roll < info.forest * 0.92) {
      if (slopeAt(seed, dd, h) < 0.6) {
        const s = 0.17 + hashKey(k, 5, rseed) * 0.14;
        out.trees.push({ m: placeMatrix(dd, rad, hashKey(k, 4, rseed) * Math.PI * 2, s, s, s), x: dd.x * rad, y: dd.y * rad, z: dd.z * rad, t: speciesAt(info.h, hashKey(k, 11, rseed), hashKey(k, 6, rseed)) });
      }
    } else if (info.forest <= 0.05 && info.h > 4 && info.h < 140 && info.snow < 0.05 && info.sand < 0.2 && roll < 0.06 * (0.3 + noise3((dd.x * R) / 90, (dd.y * R) / 90, (dd.z * R) / 90, rseed + 21) * 1.4)) {
      // alberi sparsi nei prati (a gruppetti, piu' piccoli)
      if (slopeAt(seed, dd, h) < 0.45) {
        const s = 0.13 + hashKey(k, 5, rseed) * 0.1;
        out.trees.push({ m: placeMatrix(dd, rad, hashKey(k, 4, rseed) * Math.PI * 2, s, s, s), x: dd.x * rad, y: dd.y * rad, z: dd.z * rad, t: speciesAt(info.h, hashKey(k, 11, rseed), hashKey(k, 6, rseed)) });
      }
    } else if (roll > 0.86) {
      const sl = slopeAt(seed, dd, h);
      if (sl > 0.3 || info.rock > 0.25 || (roll > 0.985 && sl > 0.08)) {
        const s = 0.5 + hashKey(k, 7, rseed) * 2.4;
        const r2 = rad + s * 0.2;
        out.rocks.push({ m: placeMatrix(dd, r2, hashKey(k, 8, rseed) * Math.PI * 2, s * 1.3, s * 0.8, s), x: dd.x * r2, y: dd.y * r2, z: dd.z * r2, t: 0 });
      }
    }
  });
  if (what !== 'tufts') return;
  // copertura del suolo: erba a chiazze (rumore sul pianeta a ~35 m e ~9 m), con felci e cespugli nel bosco, fiori a macchie
  // di un colore nei prati e qualche cespuglio; piu' fitta dove e' alto; mai sui sentieri (ai bordi si dirada)
  const green = new THREE.Color();
  const bloom = [0xfff9e6, 0xffe96b, 0xffb3cc, 0xd2bcff, 0xb5d6ff, 0xffc08a]; // pastelli: sul prato scuro i colori saturi diventano marroni
  yield* drive(TUFT_CELL, (c, dd, h) => {
    const k = c.key;
    const sx = dd.x * R, sy = dd.y * R, sz = dd.z * R;
    const patch = noise3(sx / 35, sy / 35, sz / 35, tseed + 2) * 0.7 + noise3(sx / 9, sy / 9, sz / 9, tseed + 3) * 0.3;
    const pm = pathMask(seed, dd.x, dd.y, dd.z);
    if (pm > 0.35) return;
    if (siteNear(seed, dd.x, dd.y, dd.z, 200) && villageFieldTint(seed, dd.x, dd.y, dd.z, _fieldc) > 0.3) return; // campi: terra e colture, non erba selvatica
    const vl = villageLocal(seed, dd.x, dd.y, dd.z, 20);
    if (vl) {
      // nel villaggio l'erba cresce solo fuori dalle strade e dalle case, piu' rada
      if (villageGround(seed, dd.x, dd.y, dd.z) > 0.12 || hashKey(k, 12, tseed) > 0.45 || villageBlocked(seed, vl.v, vl.u, vl.w, 1.8)) return;
    }
    // (soglia piu' bassa di prima: il prato copre di piu'; ai bordi dei sentieri si dirada)
    if (hashKey(k, 4, tseed) > Math.max(0, patch - 0.04) * 3.9 * (1 - pm * 2)) return;
    const info = surfaceInfo(seed, dd.x, dd.y, dd.z, h);
    if (info.h < 1.5 || info.sand > 0.3 || info.snow > 0.1 || info.rock > 0.3) return;
    if (slopeAt(seed, dd, h) > 0.5) return;
    const rad = R + hEff(h);
    const roll = hashKey(k, 10, tseed);
    const yaw = hashKey(k, 8, tseed) * Math.PI * 2;
    let kind = COVER_GRASS;
    // erba alta e bassa mescolate (i ciuffi piu' alti arrivano a ~2 m)
    let sc = 0.9 + Math.pow(hashKey(k, 5, tseed), 1.6) * 1.7;
    let sy2 = sc * (0.8 + hashKey(k, 9, tseed) * 0.6);
    let hex = 0;
    if (info.forest > 0.25) {
      // sottobosco: felci e cespugli
      if (roll < 0.24) {
        kind = COVER_FERN;
        sc = 0.9 + hashKey(k, 5, tseed) * 0.8;
        sy2 = sc * (0.8 + hashKey(k, 9, tseed) * 0.5);
        green.setHSL(0.27 + hashKey(k, 6, tseed) * 0.05, 0.5, 0.26 + hashKey(k, 7, tseed) * 0.14);
        hex = green.getHex();
      } else if (roll < 0.34) {
        kind = COVER_BUSH;
        sc = 0.8 + hashKey(k, 5, tseed) * 1.1;
        sy2 = sc * (0.75 + hashKey(k, 9, tseed) * 0.4);
        green.setHSL(0.26 + hashKey(k, 6, tseed) * 0.06, 0.42, 0.2 + hashKey(k, 7, tseed) * 0.14);
        hex = green.getHex();
      }
    } else {
      // prato aperto: macchie di fiori (un colore per macchia), cespugli sparsi
      const fl = noise3(sx / 16, sy / 16, sz / 16, tseed + 11);
      const tall = noise3(sx / 28, sy / 28, sz / 28, tseed + 19);
      if (tall > 0.56 && roll < 0.5) {
        // erba alta da prateria (spighe), a macchie larghe
        kind = COVER_TALL;
        sc = 0.9 + hashKey(k, 5, tseed) * 0.9;
        sy2 = sc * (0.8 + hashKey(k, 9, tseed) * 0.7);
        green.setHSL(0.15 + hashKey(k, 6, tseed) * 0.07, 0.45, 0.46 + hashKey(k, 7, tseed) * 0.14);
        hex = green.getHex();
      } else if (fl > 0.5 && roll < 0.6) {
        kind = COVER_FLOWER;
        sc = 0.8 + hashKey(k, 5, tseed) * 0.6;
        sy2 = sc * (0.85 + hashKey(k, 9, tseed) * 0.4);
        hex = bloom[Math.floor(noise3(sx / 60, sy / 60, sz / 60, tseed + 13) * 5.99) % bloom.length];
      } else if (roll > 0.94) {
        kind = COVER_BUSH;
        sc = 0.7 + hashKey(k, 5, tseed) * 0.9;
        sy2 = sc * (0.75 + hashKey(k, 9, tseed) * 0.4);
        green.setHSL(0.24 + hashKey(k, 6, tseed) * 0.08, 0.45, 0.24 + hashKey(k, 7, tseed) * 0.14);
        hex = green.getHex();
      }
    }
    if (kind === COVER_GRASS) {
      // erba: verdi vari, con chiazze secche (gialle) dove il rumore e' alto
      const dry = Math.max(0, noise3(sx / 70, sy / 70, sz / 70, tseed + 17) - 0.58) * 2.4;
      green.setHSL(0.2 + hashKey(k, 6, tseed) * 0.1 - dry * 0.06, 0.5 - dry * 0.1, 0.42 + hashKey(k, 7, tseed) * 0.16 + dry * 0.05);
      hex = green.getHex();
    }
    out.tufts.push({ m: placeMatrix(dd, rad, yaw, sc, sy2, sc), x: dd.x * rad, y: dd.y * rad, z: dd.z * rad, t: kind, color: hex });
  });
}
