import * as THREE from 'three';
import { PLANET_RADIUS as R, hEff, surfaceHeight, villagesOf, type VillageSite } from './planetSurface';
import { TILE_CENTERS, TILE_RADIUS, tileOfDir } from './cubeTiles';
import { PALETTE, Culture } from './culture';
import { planeHeight, settlementOf, villageFrame, type VillageFrame } from './village';
import type { Settlement, Street } from './settlement';
import { globalRoadSegs, roadPts } from './roads';

// Le strade degli abitati come nastri veri sul terreno (marciapiedi, asfalto o selciato, segnaletica) e la sopraelevata come
// impalcato con parapetti, sottofondo e pile (le pile sono pezzi del villaggio: Role.Pier). Una tessera disegna i segmenti il
// cui punto medio cade in lei; i vertici dipendono solo dai punti vicini, cosi' le tessere accanto combaciano. Il nastro sta
// pochi centimetri sopra il suolo (marciapiede 3, asfalto 10, segni 17) con polygonOffset nel materiale.
export interface RoadBuf { pos: Float32Array; nor: Float32Array; col: Float32Array }

const _c = new THREE.Color();
const cache = new Map<Settlement, { buckets: Map<number, Array<[number, number]>>; cum: number[][] }>();

const dirOf = (fr: VillageFrame, u: number, w: number, out: THREE.Vector3) =>
  out.copy(fr.c).multiplyScalar(R).addScaledVector(fr.A, u).addScaledVector(fr.B, w).normalize();

function infoOf(seed: number, v: VillageSite, S: Settlement) {
  let c = cache.get(S);
  if (c) return c;
  const fr = villageFrame(v, seed);
  const buckets = new Map<number, Array<[number, number]>>();
  const cum: number[][] = [];
  const d = new THREE.Vector3();
  S.streets.forEach((st, si) => {
    const cc = [0];
    for (let i = 1; i < st.pts.length; i++) cc.push(cc[i - 1] + Math.hypot(st.pts[i][0] - st.pts[i - 1][0], st.pts[i][1] - st.pts[i - 1][1]));
    cum.push(cc);
    if (st.kind === 'pedal') return;
    for (let i = 0; i + 1 < st.pts.length; i++) {
      dirOf(fr, (st.pts[i][0] + st.pts[i + 1][0]) / 2, (st.pts[i][1] + st.pts[i + 1][1]) / 2, d);
      const k = tileOfDir(d.x, d.y, d.z);
      const l = buckets.get(k);
      if (l) l.push([si, i]);
      else buckets.set(k, [[si, i]]);
    }
  });
  c = { buckets, cum };
  cache.set(S, c);
  return c;
}

class Out {
  pos: number[] = []; nor: number[] = []; col: number[] = [];
  // quadrilatero a-b-c-d (in ordine): la normale voluta decide il verso dei triangoli
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, n: THREE.Vector3, color: THREE.Color, shade = 1) {
    const e1x = b.x - a.x, e1y = b.y - a.y, e1z = b.z - a.z, e2x = c.x - a.x, e2y = c.y - a.y, e2z = c.z - a.z;
    const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
    const flip = cx * n.x + cy * n.y + cz * n.z < 0;
    const tri = flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d];
    for (const p of tri) {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(n.x, n.y, n.z);
      this.col.push(color.r * shade, color.g * shade, color.b * shade);
    }
  }
}

const _d = new THREE.Vector3();
const hAt = (v: VillageSite, u: number, w: number, d: THREE.Vector3): number => {
  // dentro la zolla il suolo e' il piano; oltre, il terreno vero
  if (Math.hypot(u, w) < v.flat - 4) return planeHeight(v, u, w);
  return hEff(surfaceHeight(0, d.x, d.y, d.z));
};

export function buildRoadsForTile(seed: number, key: number): RoadBuf | null {
  const out = new Out();
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3(), N = new THREE.Vector3(), M = new THREE.Vector3();
  for (const v of villagesOf(seed)) {
    if (v.tier < 1) continue; // i casali hanno solo sentieri (dipinti)
    const dot = v.x * TILE_CENTERS[key * 3] + v.y * TILE_CENTERS[key * 3 + 1] + v.z * TILE_CENTERS[key * 3 + 2];
    if (Math.acos(Math.min(1, dot)) * R > v.radius + 60 + TILE_RADIUS) continue;
    const S = settlementOf(seed, v);
    const info = infoOf(seed, v, S);
    const list = info.buckets.get(key);
    if (!list) continue;
    const fr = villageFrame(v, seed);
    const pal = PALETTE[S.culture];
    // quota e posizione di un punto del nastro
    const place = (u: number, w: number, lift: number, e: number, to: THREE.Vector3) => {
      dirOf(fr, u, w, _d);
      const h = Math.hypot(u, w) < v.flat - 4 ? planeHeight(v, u, w) : hEff(surfaceHeight(seed, _d.x, _d.y, _d.z));
      void hAt;
      return to.copy(_d).multiplyScalar(R + h + lift + e);
    };
    for (const [si, i] of list) {
      const st: Street = S.streets[si];
      const pts = st.pts;
      const p0 = pts[i], p1 = pts[i + 1];
      const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      if (L < 0.05) continue;
      // tangenti agli estremi (medie con i segmenti adiacenti) e normali con giunzione a spigolo
      const tan = (k: number): [number, number] => {
        const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
      };
      const sx = (p1[0] - p0[0]) / L, sz = (p1[1] - p0[1]) / L;
      const frame = (k: number) => {
        const t = tan(k);
        const nx = -t[1], nz = t[0];
        const cosA = Math.max(0.65, nx * -sz + nz * sx);
        return { nx, nz, k: 1 / cosA };
      };
      const f0 = frame(i), f1 = frame(i + 1);
      const e0 = st.elev ? st.elev[i] : 0, e1 = st.elev ? st.elev[i + 1] : 0;
      const half = st.width / 2;
      const cls = st.kind === 'main' ? 3 : st.kind === 'ring' ? 2 : st.kind === 'side' ? 1 : 0;
      const old = st.kind === 'alley' || (st.sw ?? 1) <= 0.5;
      const asphalt = st.kind === 'expr' || !(old && S.tier <= 2) || false;
      const roadCol = st.kind === 'expr' ? _c.set('#3c3d40') : (old ? _c.set(pal.street).multiplyScalar(0.82) : _c.set(S.culture === Culture.Mag && cls < 2 ? '#8a7a62' : '#46474b'));
      const road = roadCol.clone();
      void asphalt;
      const quadAt = (o0: number, o1: number, lift: number, color: THREE.Color, shade = 1, up = true) => {
        place(p0[0] + f0.nx * o0 * f0.k, p0[1] + f0.nz * o0 * f0.k, lift, e0, A);
        place(p0[0] + f0.nx * o1 * f0.k, p0[1] + f0.nz * o1 * f0.k, lift, e0, B);
        place(p1[0] + f1.nx * o1 * f1.k, p1[1] + f1.nz * o1 * f1.k, lift, e1, C);
        place(p1[0] + f1.nx * o0 * f1.k, p1[1] + f1.nz * o0 * f1.k, lift, e1, D);
        N.copy(A).add(C).normalize();
        out.quad(A, B, C, D, up ? N : N.negate(), color, shade);
      };
      if (st.kind === 'expr') {
        // impalcato: piano, sottofondo, fianchi, parapetti (new jersey) con la cima
        const conc = _c.set('#b9b5ad').clone(), concD = _c.set('#8f8b84').clone();
        quadAt(-half, half, 0.0, road);
        quadAt(-half, half, -1.0, concD, 0.8, false);
        for (const sg of [-1, 1]) {
          const o = sg * half;
          // fianco esterno (verticale)
          place(p0[0] + f0.nx * o * f0.k, p0[1] + f0.nz * o * f0.k, 0.0, e0, A);
          place(p1[0] + f1.nx * o * f1.k, p1[1] + f1.nz * o * f1.k, 0.0, e1, B);
          place(p1[0] + f1.nx * o * f1.k, p1[1] + f1.nz * o * f1.k, -1.0, e1, C);
          place(p0[0] + f0.nx * o * f0.k, p0[1] + f0.nz * o * f0.k, -1.0, e0, D);
          M.set(f0.nx * sg, 0, f0.nz * sg);
          N.copy(A).add(B).normalize(); // verticale locale
          const side = new THREE.Vector3().crossVectors(N, B.clone().sub(A)).normalize().multiplyScalar(sg > 0 ? 1 : -1);
          out.quad(A, B, C, D, side, conc, 0.95);
          // parapetto: faccia interna, cima, faccia esterna
          const bo = [o, o - sg * 0.45];
          const pa = (q: number, lift: number, to: THREE.Vector3, k: 0 | 1) => place(k === 0 ? p0[0] + f0.nx * q * f0.k : p1[0] + f1.nx * q * f1.k, k === 0 ? p0[1] + f0.nz * q * f0.k : p1[1] + f1.nz * q * f1.k, lift, k === 0 ? e0 : e1, to);
          const top = new THREE.Vector3(), a2 = new THREE.Vector3(), b2 = new THREE.Vector3(), c2 = new THREE.Vector3(), d2 = new THREE.Vector3();
          pa(bo[0], 0.95, a2, 0); pa(bo[1], 0.95, b2, 0); pa(bo[1], 0.95, c2, 1); pa(bo[0], 0.95, d2, 1);
          top.copy(a2).add(c2).normalize();
          out.quad(a2, b2, c2, d2, top, conc, 1);
          // faccia interna del parapetto
          pa(bo[1], 0, a2, 0); pa(bo[1], 0.95, b2, 0); pa(bo[1], 0.95, c2, 1); pa(bo[1], 0, d2, 1);
          const inN = new THREE.Vector3(-f0.nx * sg, 0, -f0.nz * sg);
          // (normale approssimata: orizzontale verso l'interno nel riferimento locale -> si usa il prodotto con la verticale)
          const upv = a2.clone().normalize();
          const al = new THREE.Vector3().crossVectors(upv, d2.clone().sub(a2)).normalize();
          const toIn = M.set(0, 0, 0).sub(inN);
          void toIn;
          out.quad(a2, b2, c2, d2, al.multiplyScalar(sg > 0 ? -1 : 1), conc, 0.9);
          // faccia esterna
          pa(bo[0], 0, a2, 0); pa(bo[0], 0.95, b2, 0); pa(bo[0], 0.95, c2, 1); pa(bo[0], 0, d2, 1);
          const al2 = new THREE.Vector3().crossVectors(a2.clone().normalize(), d2.clone().sub(a2)).normalize();
          out.quad(a2, b2, c2, d2, al2.multiplyScalar(sg > 0 ? 1 : -1), conc, 0.85);
        }
      } else {
        const sw = st.sw ?? 1.2;
        if (sw > 0.4) quadAt(-half - sw, half + sw, 0.03, _c.set(pal.plaza).multiplyScalar(0.98).clone(), 1);
        quadAt(-half, half, 0.1 + cls * 0.006, road);
      }
      // segnaletica: asse tratteggiato e righe di bordo sulle strade larghe e moderne
      if ((st.kind === 'main' || st.kind === 'expr' || (st.kind === 'ring' && st.width >= 7)) && !old) {
        const cc = info.cum[si];
        const s0 = cc[i], s1 = cc[i + 1];
        const lift = st.kind === 'expr' ? 0.05 : 0.17;
        const white = _c.set('#e9e6dc').clone(), yel = _c.set('#d8b94a').clone();
        const mid = (u: number, w: number) => S.idx.clearance(u, w, si) > -0.8;
        // righe di bordo (continue) sulle arterie
        if (st.kind !== 'ring' || st.width >= 8) {
          const pmx = (p0[0] + p1[0]) / 2, pmz = (p0[1] + p1[1]) / 2;
          if (st.kind === 'expr' || mid(pmx, pmz)) for (const sg of [-1, 1]) quadAt(sg * (half - 0.55) - 0.07, sg * (half - 0.55) + 0.07, lift, white, 1);
        }
        // asse a tratti da 3 m ogni 9
        const per = 9, dash = 3.2;
        for (let s = Math.floor(s0 / per) * per; s < s1; s += per) {
          const a = Math.max(s, s0), b = Math.min(s + dash, s1);
          if (b - a < 0.3) continue;
          const ta = (a - s0) / (s1 - s0), tb = (b - s0) / (s1 - s0);
          const mu = p0[0] + (p1[0] - p0[0]) * (ta + tb) / 2, mw = p0[1] + (p1[1] - p0[1]) * (ta + tb) / 2;
          if (st.kind !== 'expr' && !mid(mu, mw)) continue;
          const au = p0[0] + (p1[0] - p0[0]) * ta, aw = p0[1] + (p1[1] - p0[1]) * ta, bu = p0[0] + (p1[0] - p0[0]) * tb, bw = p0[1] + (p1[1] - p0[1]) * tb;
          for (const o of st.kind === 'expr' ? [-0.12, 0.12] : [0]) {
            const ee = (t: number) => e0 + (e1 - e0) * t;
            place(au + f0.nx * (o - 0.09), aw + f0.nz * (o - 0.09), lift, ee(ta), A);
            place(au + f0.nx * (o + 0.09), aw + f0.nz * (o + 0.09), lift, ee(ta), B);
            place(bu + f0.nx * (o + 0.09), bw + f0.nz * (o + 0.09), lift, ee(tb), C);
            place(bu + f0.nx * (o - 0.09), bw + f0.nz * (o - 0.09), lift, ee(tb), D);
            N.copy(A).add(C).normalize();
            out.quad(A, B, C, D, N, st.kind === 'expr' ? yel : white, 1);
          }
        }
      }
    }
  }
  // strade tra gli abitati (autostrade e strade): nastri sul terreno vero, senza i tratti in acqua (li' ci sono i ponti)
  {
    const P = new THREE.Vector3(), Q = new THREE.Vector3(), up = new THREE.Vector3(), tan = new THREE.Vector3(), lat = new THREE.Vector3();
    const a4 = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const nrm = new THREE.Vector3();
    for (const { r, list } of globalRoadSegs(seed, key)) {
      const pts = roadPts(seed, r);
      const half = r.width / 2;
      const col = (r.cls === 2 ? _c.set('#3d3e42') : _c.set('#5a5a55')).clone();
      const shoulder = _c.set('#9d9a8e').clone();
      const white = _c.set('#e9e6dc').clone();
      const at = (k: number, to: THREE.Vector3, lift: number, o: number, tz: THREE.Vector3) => {
        // punto k della strada spostato di `o` m di lato, alla quota del terreno + lift
        const x = pts[k * 3], y = pts[k * 3 + 1], z = pts[k * 3 + 2];
        up.set(x, y, z);
        const k0 = Math.max(0, k - 1), k1 = Math.min(r.n, k + 1);
        tan.set(pts[k1 * 3] - pts[k0 * 3], pts[k1 * 3 + 1] - pts[k0 * 3 + 1], pts[k1 * 3 + 2] - pts[k0 * 3 + 2]).normalize();
        lat.crossVectors(up, tan).normalize();
        const h = hEff(surfaceHeight(seed, x, y, z));
        to.copy(up).multiplyScalar(R + h + lift).addScaledVector(lat, o);
        tz.copy(up);
        return h;
      };
      for (const k of list) {
        const hh0 = surfaceHeight(seed, pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2]), hh1 = surfaceHeight(seed, pts[k * 3 + 3], pts[k * 3 + 4], pts[k * 3 + 5]);
        if (hh0 < 0.5 || hh1 < 0.5) continue;
        const strip = (o0: number, o1: number, lift: number, color: THREE.Color) => {
          at(k, a4[0], lift, o0, nrm); at(k, a4[1], lift, o1, nrm); at(k + 1, a4[2], lift, o1, nrm); at(k + 1, a4[3], lift, o0, nrm);
          out.quad(a4[0], a4[1], a4[2], a4[3], nrm.copy(a4[0]).add(a4[2]).normalize(), color, 1);
        };
        if (r.cls === 2) strip(-half - 1.2, half + 1.2, 0.04, shoulder);
        strip(-half, half, 0.1, col);
        const lift = 0.17;
        if (r.cls === 2) for (const sg of [-1, 1]) strip(sg * (half - 0.4) - 0.08, sg * (half - 0.4) + 0.08, lift, white);
        if (k % 3 === 0) strip(-0.09, 0.09, lift, r.cls === 2 ? white : _c.set('#d8d2bc').clone());
      }
      void P; void Q;
    }
  }
  if (out.pos.length === 0) return null;
  return { pos: new Float32Array(out.pos), nor: new Float32Array(out.nor), col: new Float32Array(out.col) };
}

// i segmenti dell'impalcato di una sopraelevata (per i collider): centro, direzione, lunghezza e larghezza, nel riferimento del pianeta
export interface DeckSeg { c: THREE.Vector3; up: THREE.Vector3; t: THREE.Vector3; len: number; width: number }
const deckCache = new Map<Settlement, DeckSeg[]>();
export function deckSegments(seed: number, v: VillageSite): DeckSeg[] {
  const S = settlementOf(seed, v);
  let list = deckCache.get(S);
  if (list) return list;
  list = [];
  deckCache.set(S, list);
  const fr = villageFrame(v, seed);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
  for (const st of S.streets) {
    if (st.kind !== 'expr' || !st.elev) continue;
    for (let i = 0; i + 1 < st.pts.length; i++) {
      const e0 = st.elev[i], e1 = st.elev[i + 1];
      if (e0 < 0.3 && e1 < 0.3) continue;
      const pos = (u: number, w: number, e: number, to: THREE.Vector3) => { dirOf(fr, u, w, d); return to.copy(d).multiplyScalar(R + planeHeight(v, u, w) + e); };
      pos(st.pts[i][0], st.pts[i][1], e0, a); pos(st.pts[i + 1][0], st.pts[i + 1][1], e1, b);
      const c = a.clone().add(b).multiplyScalar(0.5);
      list.push({ c, up: c.clone().normalize(), t: b.clone().sub(a).normalize(), len: a.distanceTo(b), width: st.width });
    }
  }
  return list;
}
