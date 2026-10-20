import * as THREE from 'three';
import { PLANET_RADIUS as R } from './planetSurface';
import type { Site } from './site';

// Una griglia in latitudine/longitudine sul pianeta, fissa: alberi, rocce, prato e nuvole si piazzano per cella del
// PIANETA (non del sito), cosi' la stessa pianta sta sempre nello stesso punto, qualunque sia il sito su cui il mondo e'
// montato: cambiare sito (rebase) non sposta niente. Le celle hanno lato ~`cell` m: fasce di latitudine, e in ogni
// fascia tante celle in longitudine quante ne stanno nella circonferenza di quel parallelo.

export interface Cell {
  band: number;
  lon: number;
  n: number; // celle nella fascia
  key: number; // identificatore unico della cella
}

export const makeCell = (): Cell => ({ band: 0, lon: 0, n: 1, key: 0 });

// la cella che contiene la direzione unitaria (dx, dy, dz) (riferimento del pianeta)
export function cellOf(dx: number, dy: number, dz: number, cell: number, out: Cell): Cell {
  const lat = Math.asin(Math.max(-1, Math.min(1, dy)));
  const band = Math.round((lat * R) / cell);
  const c = Math.cos((band * cell) / R);
  const n = Math.max(1, Math.floor((2 * Math.PI * R * Math.max(c, 0)) / cell));
  const u = (Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI);
  out.band = band;
  out.n = n;
  out.lon = Math.min(n - 1, Math.floor(u * n));
  out.key = (band + 8192) * 65536 + out.lon;
  return out;
}

// un punto della cella (jx, jy in 0..1: posizione dentro la cella), come direzione unitaria
export function cellDir(c: Cell, cell: number, jx: number, jy: number, out: THREE.Vector3): THREE.Vector3 {
  const lat = (c.band + (jy - 0.5)) * (cell / R);
  const lon = ((c.lon + jx) / c.n) * Math.PI * 2 - Math.PI;
  const cl = Math.cos(lat);
  return out.set(cl * Math.cos(lon), Math.sin(lat), cl * Math.sin(lon));
}

// numero pseudo-casuale 0..1 stabile per (chiave, sale)
export function hashKey(key: number, salt: number, seed: number): number {
  let h = (Math.imul(key, 374761393) + Math.imul(salt, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// da direzione del pianeta + distanza dal centro a coordinate locali del sito (lo stesso della superficie del terreno)
const _v = new THREE.Vector3();
export function localFromDir(s: Site, d: THREE.Vector3, rad: number, out: THREE.Vector3): THREE.Vector3 {
  _v.copy(d).applyQuaternion(s.quat);
  return out.set(_v.x * rad, _v.y * rad - (R + s.hN), _v.z * rad);
}
