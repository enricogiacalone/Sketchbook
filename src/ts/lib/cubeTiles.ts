import * as THREE from 'three';
import { PLANET_RADIUS as R } from './planetSurface';

// Tessere del pianeta su una cubo-sfera: 6 facce, ognuna divisa in TILES x TILES tessere quadrate, ogni tessera una
// griglia di N x N celle. Non ci sono singolarita' (la citta' sta al centro della faccia +Y) e due tessere vicine
// condividono gli stessi vertici sul bordo (stessa risoluzione, stessi punti 3D), quindi niente fessure. Le tessere
// stanno nel riferimento del PIANETA (fisso): il mondo sotto la camera e' lo stesso qualunque sito sia montato.
export const TILES = 16; // tessere per lato di faccia (~295 m al centro di una faccia)
export const GRID = 64; // celle per lato di tessera (~4.6 m)
export const TILE_COUNT = 6 * TILES * TILES;

const FACE_N = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const FACE_U = [
  [0, 1, 0],
  [0, 0, 1],
  [0, 0, 1],
  [1, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
];
const FACE_V = [
  [0, 0, 1],
  [0, 1, 0],
  [1, 0, 0],
  [0, 0, 1],
  [0, 1, 0],
  [1, 0, 0],
];

const QPI = Math.PI / 4;

// direzione unitaria del punto (s, t) in 0..1 della faccia `face` (mappa equiangolare: tessere piu' uniformi)
export function faceDir(face: number, s: number, t: number, out: THREE.Vector3): THREE.Vector3 {
  const a = Math.tan(QPI * (2 * s - 1)), b = Math.tan(QPI * (2 * t - 1));
  const n = FACE_N[face], u = FACE_U[face], v = FACE_V[face];
  out.set(n[0] + a * u[0] + b * v[0], n[1] + a * u[1] + b * v[1], n[2] + a * u[2] + b * v[2]);
  return out.normalize();
}

export const tileKey = (face: number, i: number, j: number) => (face * TILES + j) * TILES + i;
export const tileParts = (key: number) => ({ face: Math.floor(key / (TILES * TILES)), j: Math.floor(key / TILES) % TILES, i: key % TILES });

// la tessera che contiene la direzione d
export function tileOfDir(dx: number, dy: number, dz: number): number {
  const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
  let face: number;
  if (ax >= ay && ax >= az) face = dx > 0 ? 0 : 1;
  else if (ay >= az) face = dy > 0 ? 2 : 3;
  else face = dz > 0 ? 4 : 5;
  const n = FACE_N[face], u = FACE_U[face], v = FACE_V[face];
  const dn = dx * n[0] + dy * n[1] + dz * n[2];
  const a = (dx * u[0] + dy * u[1] + dz * u[2]) / dn;
  const b = (dx * v[0] + dy * v[1] + dz * v[2]) / dn;
  const s = (Math.atan(a) / QPI + 1) / 2, t = (Math.atan(b) / QPI + 1) / 2;
  const i = Math.min(TILES - 1, Math.max(0, Math.floor(s * TILES)));
  const j = Math.min(TILES - 1, Math.max(0, Math.floor(t * TILES)));
  return tileKey(face, i, j);
}

// direzione del vertice (gi, gj) della griglia della tessera (0..GRID; fuori dal bordo ammesso, per le normali)
export function tileVertexDir(key: number, gi: number, gj: number, out: THREE.Vector3): THREE.Vector3 {
  const { face, i, j } = tileParts(key);
  return faceDir(face, (i + gi / GRID) / TILES, (j + gj / GRID) / TILES, out);
}

// centri delle tessere (per scegliere quali stanno vicino alla camera)
export const TILE_CENTERS: Float32Array = (() => {
  const arr = new Float32Array(TILE_COUNT * 3);
  const d = new THREE.Vector3();
  for (let k = 0; k < TILE_COUNT; k++) {
    const { face, i, j } = tileParts(k);
    faceDir(face, (i + 0.5) / TILES, (j + 0.5) / TILES, d);
    arr[k * 3] = d.x;
    arr[k * 3 + 1] = d.y;
    arr[k * 3 + 2] = d.z;
  }
  return arr;
})();

// raggio (m) approssimato di una tessera (semidiagonale al centro faccia)
export const TILE_RADIUS = ((Math.PI * R) / 2 / TILES) * 0.75;

// faccia e coordinate (s, t) in 0..1 (anche poco fuori) della direzione d
export function dirToFaceST(dx: number, dy: number, dz: number, out: { face: number; s: number; t: number }) {
  const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
  let face: number;
  if (ax >= ay && ax >= az) face = dx > 0 ? 0 : 1;
  else if (ay >= az) face = dy > 0 ? 2 : 3;
  else face = dz > 0 ? 4 : 5;
  const n = FACE_N[face], u = FACE_U[face], v = FACE_V[face];
  const dn = dx * n[0] + dy * n[1] + dz * n[2];
  out.face = face;
  out.s = (Math.atan((dx * u[0] + dy * u[1] + dz * u[2]) / dn) / QPI + 1) / 2;
  out.t = (Math.atan((dx * v[0] + dy * v[1] + dz * v[2]) / dn) / QPI + 1) / 2;
  return out;
}
