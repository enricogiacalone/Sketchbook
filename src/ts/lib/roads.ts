import * as THREE from 'three';
import { PLANET_RADIUS as R, hEff, siteLocal, surfaceHeight, villagesOf, type VillageSite } from './planetSurface';
import { hashKey } from './globalGrid';
import { gateAnglesOf, gatePoint } from './town';
import { tileOfDir, TILE_CENTERS, TILE_RADIUS } from './cubeTiles';
import { Culture, PALETTE } from './culture';

// La rete stradale tra gli abitati: ogni abitato si collega al piu' vicino di taglia pari o maggiore (i casali ai villaggi, questi ai
// paesi, i paesi alle citta'), e paesi e citta' fra loro con le autostrade. I tracciati si cercano con la programmazione dinamica
// (Viterbi) su posizioni laterali a ogni stazione (ogni ~36 m): costa la salita (pendenza al quadrato), l'acqua e le curve strette,
// cosi' la strada segue vallate e pianori invece di tagliare le montagne, poi si arrotonda con una spline. Le estremita' sono le
// porte degli abitati (citta' e paesi) o il bordo (villaggi e casali). Il fondo si dipinge nella maschera dei sentieri
// (`roadMask`, nearTile.ts) e le strade vere (autostrade, strade) sono nastri con segnaletica (`globalRoadStrips`, roadMesh.ts).
export interface RoadDef {
  a: THREE.Vector3; b: THREE.Vector3; cls: 0 | 1 | 2; // 0 sterrata, 1 strada, 2 autostrada
  width: number;
  c: THREE.Vector3; cosHalf: number;
  pts: Float32Array | null; n: number;
  tiles: Map<number, number[]> | null; // segmento -> per tessera
}
const cache = new Map<number, RoadDef[]>();
const WIDTH = [3.4, 5.6, 8.4];
const STATION = 36, SHIFT = 14, J = 8;

const ang = (a: THREE.Vector3, b: THREE.Vector3) => Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
const dirAt = (v: VillageSite, u: number, w: number) => new THREE.Vector3(v.x, v.y, v.z).multiplyScalar(R).add(new THREE.Vector3(v.ax, v.ay, v.az).multiplyScalar(u)).add(new THREE.Vector3(v.bx, v.by, v.bz).multiplyScalar(w)).normalize();

// estremita' di una strada che da `v` va verso `target`: la porta piu' vicina alla direzione, o un punto del bordo
function endFor(seed: number, v: VillageSite, target: THREE.Vector3): THREE.Vector3 {
  const [tu, tw] = siteLocal(v, target.x, target.y, target.z);
  const bearing = Math.atan2(tw, tu);
  if (v.tier >= 2) {
    let best = 0, bd = Infinity;
    for (const g of gateAnglesOf(seed, v)) { const d = Math.abs(((g - bearing + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI); if (d < bd) { bd = d; best = g; } }
    const [u, w] = gatePoint(v, best);
    return dirAt(v, u, w);
  }
  const r = v.radius * 0.97;
  return dirAt(v, Math.cos(bearing) * r, Math.sin(bearing) * r);
}

export function roadsOf(seed: number): RoadDef[] {
  const key = seed & 0x7fffffff;
  let roads = cache.get(key);
  if (roads) return roads;
  roads = [];
  cache.set(key, roads);
  const vs = villagesOf(seed);
  const dirs = vs.map((v) => new THREE.Vector3(v.x, v.y, v.z));
  const seen = new Set<string>();
  const add = (i: number, j: number, cls: 0 | 1 | 2) => {
    const k = i < j ? `${i}-${j}` : `${j}-${i}`;
    if (seen.has(k)) return;
    seen.add(k);
    const a = endFor(seed, vs[i], dirs[j]), b = endFor(seed, vs[j], dirs[i]);
    const total = ang(a, b);
    const c = a.clone().add(b).normalize();
    roads!.push({ a, b, cls, width: WIDTH[cls], c, cosHalf: Math.cos(total / 2 + 0.07), pts: null, n: 0, tiles: null });
  };
  // ogni abitato verso il piu' vicino di taglia >= alla sua
  vs.forEach((v, i) => {
    let best = -1, bd = Infinity;
    vs.forEach((o, j) => {
      if (j === i || o.tier < v.tier) return;
      const d = ang(dirs[i], dirs[j]);
      if (d < bd) { bd = d; best = j; }
    });
    if (best >= 0 && bd < 1.3) add(i, best, Math.min(v.tier, vs[best].tier) >= 2 ? 2 : Math.min(v.tier, vs[best].tier) >= 1 ? 1 : 0);
  });
  // paesi e citta': due collegamenti ciascuno con i piu' vicini dello stesso rango (autostrade ad anello)
  vs.forEach((v, i) => {
    if (v.tier < 2) return;
    const near = vs.map((o, j) => ({ j, d: ang(dirs[i], dirs[j]), o })).filter((x) => x.j !== i && x.o.tier >= 2 && x.d < 1.6).sort((p, q) => p.d - q.d).slice(0, 2);
    for (const x of near) add(i, x.j, 2);
  });
  // i villaggi: un secondo collegamento al villaggio/paese piu' vicino, se vicino (strade secondarie ad anello)
  vs.forEach((v, i) => {
    if (v.tier !== 1) return;
    const near = vs.map((o, j) => ({ j, d: ang(dirs[i], dirs[j]), o })).filter((x) => x.j !== i && x.o.tier >= 1 && x.d < 0.5).sort((p, q) => p.d - q.d)[1];
    if (near) add(i, near.j, 1);
  });
  return roads;
}

// il tracciato (lazy): punti unitari, circa ogni 12 m
function solve(seed: number, r: RoadDef) {
  const total = ang(r.a, r.b);
  const len = total * R;
  const N = Math.max(3, Math.ceil(len / STATION));
  const mid = r.a.clone().add(r.b).normalize();
  const tangent = r.b.clone().sub(r.a).normalize();
  const side = new THREE.Vector3().crossVectors(mid, tangent).normalize();
  const base: THREE.Vector3[] = [];
  const sn = Math.sin(total) || 1;
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    base.push(r.a.clone().multiplyScalar(Math.sin((1 - t) * total) / sn).addScaledVector(r.b, Math.sin(t * total) / sn).normalize());
  }
  const W = 2 * J + 1;
  const P: THREE.Vector3[][] = [], H: number[][] = [];
  for (let k = 0; k <= N; k++) {
    const row: THREE.Vector3[] = [], hr: number[] = [];
    for (let j = -J; j <= J; j++) {
      const ok = k > 0 && k < N ? true : j === 0;
      const p = ok ? base[k].clone().addScaledVector(side, (j * SHIFT) / R).normalize() : base[k].clone();
      row.push(p);
      hr.push(ok ? surfaceHeight(seed, p.x, p.y, p.z) : surfaceHeight(seed, base[k].x, base[k].y, base[k].z));
    }
    P.push(row); H.push(hr);
  }
  const cost: number[][] = [], from: number[][] = [];
  for (let k = 0; k <= N; k++) { cost.push(new Array(W).fill(Infinity)); from.push(new Array(W).fill(0)); }
  cost[0][J] = 0;
  for (let k = 1; k <= N; k++) {
    for (let j = 0; j < W; j++) {
      if ((k === N && j !== J)) continue;
      const h = H[k][j];
      let here = 0;
      if (h < 1.2) here += 260 + (h < -6 ? 900 : 0); // acqua: si evita, e se serve un ponte corto vale meno
      if (h > 140) here += (h - 140) * 6; // le cime
      for (let dj = -1; dj <= 1; dj++) {
        const pj = j + dj;
        if (pj < 0 || pj >= W || cost[k - 1][pj] === Infinity) continue;
        const dist = P[k][j].distanceTo(P[k - 1][pj]) * R;
        const slope = Math.abs(h - H[k - 1][pj]) / Math.max(1, dist);
        const c = cost[k - 1][pj] + dist * (1 + 38 * slope * slope + (slope > 0.12 ? 60 * (slope - 0.12) : 0)) + here + (dj !== 0 ? 3 : 0);
        if (c < cost[k][j]) { cost[k][j] = c; from[k][j] = pj; }
      }
    }
  }
  const chosen: THREE.Vector3[] = new Array(N + 1);
  let j = J;
  for (let k = N; k >= 0; k--) { chosen[k] = P[k][j]; j = from[k][j]; }
  // spline di Catmull-Rom sui punti scelti, campioni ogni ~12 m
  const per = Math.max(2, Math.round(STATION / 12));
  const out: number[] = [];
  const cr = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, t: number) => {
    const t2 = t * t, t3 = t2 * t;
    return new THREE.Vector3(
      0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
      0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
    ).normalize();
  };
  for (let k = 0; k < N; k++) {
    const p0 = chosen[Math.max(0, k - 1)], p1 = chosen[k], p2 = chosen[k + 1], p3 = chosen[Math.min(N, k + 2)];
    for (let s = 0; s < per; s++) { const p = cr(p0, p1, p2, p3, s / per); out.push(p.x, p.y, p.z); }
  }
  out.push(chosen[N].x, chosen[N].y, chosen[N].z);
  r.pts = new Float32Array(out);
  r.n = out.length / 3 - 1;
}

export function roadPts(seed: number, r: RoadDef): Float32Array {
  if (!r.pts) solve(seed, r);
  return r.pts!;
}

const _r0 = new THREE.Vector3(), _r1 = new THREE.Vector3(), _rd = new THREE.Vector3();
// 0..1: quanta strada (tra gli abitati) c'e' nella direzione d; ai bordi sfuma su ~3 m
export function roadMask(seed: number, dx: number, dy: number, dz: number): number {
  const roads = roadsOf(seed);
  if (roads.length === 0) return 0;
  let best = Infinity, bw = 3;
  for (const r of roads) {
    if (r.c.x * dx + r.c.y * dy + r.c.z * dz < r.cosHalf) continue;
    const pts = roadPts(seed, r);
    _rd.set(dx * R, dy * R, dz * R);
    for (let k = 0; k < r.n; k++) {
      _r0.set(pts[k * 3] * R, pts[k * 3 + 1] * R, pts[k * 3 + 2] * R);
      _r1.set(pts[k * 3 + 3] * R, pts[k * 3 + 4] * R, pts[k * 3 + 5] * R);
      const abx = _r1.x - _r0.x, aby = _r1.y - _r0.y, abz = _r1.z - _r0.z;
      const apx = _rd.x - _r0.x, apy = _rd.y - _r0.y, apz = _rd.z - _r0.z;
      let t = (apx * abx + apy * aby + apz * abz) / (abx * abx + aby * aby + abz * abz || 1);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = apx - abx * t, ey = apy - aby * t, ez = apz - abz * t;
      const d2 = ex * ex + ey * ey + ez * ez - (r.width * r.width) / 4 * 0.5; // (la strada vera copre: il sentiero dipinto e' il suo fondo)
      if (d2 < best) { best = d2; bw = r.width; }
    }
  }
  if (best === Infinity) return 0;
  const d = Math.sqrt(Math.max(0, best));
  const t = Math.min(1, Math.max(0, (d - bw * 0.35) / 3.2));
  return 1 - t * t * (3 - 2 * t);
}

// segmenti di strada vera (autostrade e strade) per tessera: punti in coordinate del pianeta (m) con il tipo
export interface GlobalStrip { pts: Float32Array; i0: number; i1: number; width: number; cls: number }
export function globalRoadSegs(seed: number, key: number): Array<{ r: RoadDef; list: number[] }> {
  const out: Array<{ r: RoadDef; list: number[] }> = [];
  const cx = TILE_CENTERS[key * 3], cy = TILE_CENTERS[key * 3 + 1], cz = TILE_CENTERS[key * 3 + 2];
  for (const r of roadsOf(seed)) {
    if (r.cls === 0) continue;
    if (r.c.x * cx + r.c.y * cy + r.c.z * cz < r.cosHalf - TILE_RADIUS / R) continue;
    const pts = roadPts(seed, r);
    if (!r.tiles) {
      r.tiles = new Map();
      for (let k = 0; k < r.n; k++) {
        const mx = pts[k * 3] + pts[k * 3 + 3], my = pts[k * 3 + 1] + pts[k * 3 + 4], mz = pts[k * 3 + 2] + pts[k * 3 + 5];
        const l = Math.hypot(mx, my, mz) || 1;
        const t = tileOfDir(mx / l, my / l, mz / l);
        const arr = r.tiles.get(t);
        if (arr) arr.push(k);
        else r.tiles.set(t, [k]);
      }
    }
    const list = r.tiles.get(key);
    if (list) out.push({ r, list });
  }
  return out;
}
void hashKey; void hEff; void Culture; void PALETTE;
