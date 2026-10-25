import type { VillageSite } from './planetSurface';
import { Culture, PALETTE, Role, dimOf, encodeKind, variantFor } from './culture';
import { hashKey } from './globalGrid';
import { SegIndex, buildGraph, nearestNode, overlap, corners, type Door, type Item, type Park, type Plaza, type Rect, type Settlement, type Street } from './settlement';

// Paesi e citta' dei pianeti (docs/stile.md, "Urbanistica"). Ogni abitato ha una forma (radiale, a griglia, organica, lineare,
// medina) scelta dalla cultura e dal seme; sopra lo scheletro (arterie curve che arrivano alle porte, anelli, assi) una crescita
// organica di strade secondarie e vicoli riempie gli isolati; poi rotonde, mura storiche con porte, piazze con i monumenti,
// parchi, e i lotti lungo le strade: centro storico a schiera, fasce residenziali, quartieri di palazzi, centro direzionale con
// i grattacieli, zona industriale, periferia di villette e orti. Nelle citta' una sopraelevata scavalca arterie e anelli
// (sotto passano le strade: sottopassi). Tutto in metri (u, w) dal centro, entro `radius` (262 paesi, 500 citta').

// le porte (angoli, rad): dove le strade tra gli abitati entrano ed escono; dipendono solo dal sito (lib/village.ts: strade tra abitati)
export function gateAnglesOf(seed: number, v: VillageSite): number[] {
  const n = v.tier >= 3 ? 6 : v.tier === 2 ? 4 : 2;
  const a0 = hashKey(v.id + 1, 71, seed | 0) * Math.PI * 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(a0 + (i / n) * Math.PI * 2 + (hashKey(v.id + 1, 72 + i, seed | 0) - 0.5) * (v.tier >= 3 ? 0.28 : 0.4));
  return out;
}
export const gatePoint = (v: VillageSite, a: number): [number, number] => [Math.cos(a) * v.radius * 0.985, Math.sin(a) * v.radius * 0.985];

type Pt = [number, number];
const TAU = Math.PI * 2;
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const angDiff = (a: number, b: number) => Math.abs(((a - b + Math.PI) % TAU + TAU) % TAU - Math.PI);

// griglia spaziale dei rettangoli piazzati (celle da 12 m)
class RectGrid {
  cells = new Map<number, Rect[]>();
  stamp = 0;
  seen = new Map<Rect, number>();
  private k(ix: number, iz: number) { return (ix + 1024) * 2048 + (iz + 1024); }
  add(r: Rect) {
    const rad = Math.hypot(r.hw, r.hd) + 0.5;
    for (let ix = Math.floor((r.u - rad) / 12); ix <= Math.floor((r.u + rad) / 12); ix++) for (let iz = Math.floor((r.w - rad) / 12); iz <= Math.floor((r.w + rad) / 12); iz++) {
      const c = this.cells.get(this.k(ix, iz));
      if (c) c.push(r);
      else this.cells.set(this.k(ix, iz), [r]);
    }
  }
  hits(r: Rect, margin: number): boolean {
    const rad = Math.hypot(r.hw, r.hd) + margin + 0.5;
    this.stamp++;
    for (let ix = Math.floor((r.u - rad) / 12); ix <= Math.floor((r.u + rad) / 12); ix++) for (let iz = Math.floor((r.w - rad) / 12); iz <= Math.floor((r.w + rad) / 12); iz++) {
      const c = this.cells.get(this.k(ix, iz));
      if (!c) continue;
      for (const o of c) {
        if (this.seen.get(o) === this.stamp) continue;
        this.seen.set(o, this.stamp);
        if (overlap(r, o, margin)) return true;
      }
    }
    return false;
  }
}

export function generateTown(seed: number, v: VillageSite): Settlement {
  const culture = v.culture, tier = v.tier, RAD = v.radius;
  const big = tier >= 3;
  const rs = ((seed ^ 0x7a31) + v.id * 7919 + culture * 131) | 0;
  let n = 0;
  const rnd = () => hashKey(++n, 11, rs);
  const pal = PALETTE[culture];
  const items: Item[] = [];
  const streets: Street[] = [];
  const idx = new SegIndex();
  const placed = new RectGrid();
  const doors: Array<{ index: number; u: number; w: number }> = [];
  const plazas: Plaza[] = [];
  const parks: Park[] = [];
  const wallTint = () => pal.walls[Math.floor(rnd() * pal.walls.length) % pal.walls.length];
  const variantPick = () => Math.floor(rnd() * 8);

  // ---- forma ----
  const formsFor: Record<number, string[]> = {
    [Culture.Med]: big ? ['radial', 'grid', 'radial'] : ['radial', 'organic', 'grid'],
    [Culture.Alp]: big ? ['linear', 'radial'] : ['linear', 'organic', 'radial'],
    [Culture.Mag]: big ? ['medina', 'grid'] : ['medina', 'medina', 'organic'],
    [Culture.Asia]: big ? ['grid', 'radial', 'grid'] : ['grid', 'organic'],
  };
  const fl = formsFor[culture];
  const form = fl[Math.floor(rnd() * fl.length) % fl.length];
  const gates = gateAnglesOf(seed, v);
  const rot = gates[0]; // l'orientamento della griglia segue la prima porta
  const oc = big ? 0.3 + rnd() * 0.07 : 0.46 + rnd() * 0.12; // raggio (frazione) del centro storico
  const walled = culture === Culture.Mag ? true : culture === Culture.Med ? rnd() < 0.7 : culture === Culture.Asia ? big || rnd() < 0.5 : rnd() < 0.25;
  const squareWall = culture === Culture.Asia && form === 'grid';
  const cbdA = rnd() * TAU, cbd = big && culture !== Culture.Alp ? { u: Math.cos(cbdA) * RAD * 0.36, w: Math.sin(cbdA) * RAD * 0.36, r: RAD * (culture === Culture.Asia ? 0.2 : 0.15) } : null;
  const indA = cbdA + Math.PI + (rnd() - 0.5) * 1.2;
  const industrial = big || (tier === 2 && culture !== Culture.Alp && rnd() < 0.6) ? { a: indA, half: big ? 0.5 : 0.4 } : null;
  const radiusAt = (u: number, w: number) => Math.hypot(u, w) / RAD;

  // ---- strade ----
  const addStreet = (pts: Pt[], width: number, kind: Street['kind'], extra: Partial<Street> = {}): Street => {
    const st: Street = { pts, width, kind, ...extra };
    streets.push(st);
    idx.addStreet(st, streets.length - 1);
    return st;
  };
  // percorso curvo da a a b: scostamento laterale dolce (somma di seni a bassa frequenza), campioni ogni `step` m
  const curve = (a: Pt, b: Pt, amp: number, step = 7): Pt[] => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nn = Math.max(2, Math.round(len / step));
    const nx = -(b[1] - a[1]) / (len || 1), nz = (b[0] - a[0]) / (len || 1);
    const p1 = rnd() * TAU, p2 = rnd() * TAU, f1 = 0.7 + rnd() * 0.7, f2 = 1.6 + rnd() * 1.4;
    const out: Pt[] = [];
    for (let k = 0; k <= nn; k++) {
      const t = k / nn;
      const lat = amp * (0.65 * Math.sin(TAU * t * f1 * 0.5 + p1) + 0.35 * Math.sin(TAU * t * f2 * 0.5 + p2)) * Math.pow(Math.sin(Math.PI * t), 0.6);
      out.push([a[0] + (b[0] - a[0]) * t + nx * lat, a[1] + (b[1] - a[1]) * t + nz * lat]);
    }
    return out;
  };
  const arcPath = (r: number, a0: number, a1: number, amp: number, step = 8, cx = 0, cz = 0): Pt[] => {
    const nn = Math.max(4, Math.round((Math.abs(a1 - a0) * r) / step));
    const p1 = rnd() * TAU, f1 = 1 + Math.floor(rnd() * 3);
    return Array.from({ length: nn + 1 }, (_, k) => {
      const a = a0 + ((a1 - a0) * k) / nn, rr = r + amp * Math.sin(a * f1 + p1) * Math.sin((Math.PI * k) / nn + 0.2);
      return [cx + Math.cos(a) * rr, cz + Math.sin(a) * rr] as Pt;
    });
  };

  // piazza principale (il cuore): forma per cultura
  const main: Plaza = culture === Culture.Med ? { shape: 'circle', r: big ? 19 : 15, hw: 0, hd: 0 }
    : culture === Culture.Alp ? { shape: 'circle', r: 12, hw: 0, hd: 0 }
    : culture === Culture.Mag ? { shape: 'rect', r: 0, hw: big ? 20 : 15, hd: big ? 15 : 12 }
    : { shape: 'rect', r: 0, hw: big ? 22 : 16, hd: big ? 16 : 12 };
  if (main.shape === 'rect') main.r = Math.hypot(main.hw, main.hd);
  plazas.push(main);
  const plazaR = main.shape === 'circle' ? main.r : main.r * 0.95;

  // arterie: dalla piazza a ogni porta (curve, larghe), poi lo scheletro della forma
  const wMain = big ? 11 : 8.5;
  const gatePts = gates.map((a) => gatePoint(v, a));
  const arterial: Street[] = [];
  gates.forEach((a, i) => {
    const start: Pt = [Math.cos(a) * (plazaR + 2), Math.sin(a) * (plazaR + 2)];
    const amp = form === 'medina' ? RAD * 0.06 : form === 'grid' ? RAD * 0.012 : RAD * 0.05;
    const st = addStreet(curve(start, gatePts[i], amp * (0.5 + rnd())), form === 'medina' ? 5.2 : wMain, 'main', { sw: form === 'medina' ? 0.4 : big ? 2.6 : 1.8 });
    arterial.push(st);
  });
  // anello della piazza
  if (main.shape === 'circle') addStreet(arcPath(main.r + 4.5, 0, TAU, 0, 6), 6.4, 'ring', { sw: 1.2 });
  else addStreet([[-main.hw - 4.5, -main.hd - 4.5], [main.hw + 4.5, -main.hd - 4.5], [main.hw + 4.5, main.hd + 4.5], [-main.hw - 4.5, main.hd + 4.5], [-main.hw - 4.5, -main.hd - 4.5]], 6, 'ring', { sw: 1 });

  const ringAt = (r: number, w: number, kind: Street['kind'] = 'ring', skipChance = 0.12) => {
    // anello ad archi tra le arterie (qualche tratto manca)
    const sorted = gates.slice().sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      if (rnd() < skipChance) continue;
      const a0 = sorted[i], a1 = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + TAU;
      addStreet(arcPath(r, a0, a1, r * 0.04, 8), w, kind, { sw: 2 });
    }
  };
  if (form === 'radial') {
    // raggi in piu' tra le porte e anelli concentrici
    const extra = big ? 5 : 3;
    for (let i = 0; i < extra; i++) {
      const a = rnd() * TAU, r1 = RAD * (0.55 + rnd() * 0.35);
      addStreet(curve([Math.cos(a) * (plazaR + 5), Math.sin(a) * (plazaR + 5)], [Math.cos(a) * r1, Math.sin(a) * r1], RAD * 0.03), big ? 7.5 : 6.4, 'side', { sw: 1.6 });
    }
    const gap = big ? 70 + rnd() * 20 : 55 + rnd() * 12;
    for (let r = plazaR + 38; r < RAD * 0.92; r += gap * (r > RAD * 0.5 ? 1.25 : 1)) ringAt(r, r > RAD * 0.5 ? 8 : 6.4);
  } else if (form === 'grid') {
    // griglia ruotata, un po' piegata; due assi principali larghi
    const sx = big ? 62 + rnd() * 14 : 50 + rnd() * 10, sz = big ? 54 + rnd() * 12 : 44 + rnd() * 8;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const warpA = RAD * 0.015 * (0.5 + rnd()), warpL = 90 + rnd() * 80, warpP = rnd() * TAU;
    const lim = RAD * 0.93;
    const toXY = (a: number, b: number): Pt => {
      const aw = a + warpA * Math.sin(b / warpL + warpP), bw = b + warpA * Math.cos(a / warpL + warpP + 1);
      return [aw * cs - bw * sn, aw * sn + bw * cs];
    };
    for (const [pitch, other, axisIsA] of [[sx, sz, true], [sz, sx, false]] as Array<[number, number, boolean]>) {
      void other;
      for (let c = -Math.floor(lim / pitch); c <= Math.floor(lim / pitch); c++) {
        const off = c * pitch;
        if (Math.abs(off) < plazaR + 8) continue;
        const half = Math.sqrt(Math.max(0, lim * lim - off * off));
        if (half < 30) continue;
        const pts: Pt[] = [];
        for (let t = -half; t <= half + 0.1; t += 9) pts.push(axisIsA ? toXY(off, t) : toXY(t, off));
        addStreet(pts, Math.abs(c) % 3 === 0 ? (big ? 8 : 6.6) : 5.2, Math.abs(c) % 3 === 0 ? 'side' : 'alley', { sw: Math.abs(c) % 3 === 0 ? 2 : 1.4 });
      }
    }
  } else if (form === 'linear') {
    // una via maestra lungo la valle (due porte opposte), strade a pettine che salgono sui due lati
    const g0 = gatePts[0], g1 = gatePts[Math.floor(gates.length / 2)];
    addStreet(curve(g0, g1, RAD * 0.08, 9), big ? 10 : 8, 'main', { sw: 2 });
    const along = Math.atan2(g1[1] - g0[1], g1[0] - g0[0]);
    const count = big ? 9 : 6;
    for (let i = 0; i < count; i++) {
      const t = -0.7 + (i / (count - 1)) * 1.4;
      for (const side of [-1, 1]) {
        if (rnd() < 0.25) continue;
        const bu = Math.cos(along) * t * RAD * 0.9, bw = Math.sin(along) * t * RAD * 0.9;
        const nu = -Math.sin(along) * side, nw = Math.cos(along) * side;
        const len = RAD * (0.28 + rnd() * 0.3);
        if (Math.abs(t) * RAD * 0.9 < plazaR + 6) continue;
        addStreet(curve([bu + nu * 6, bw + nw * 6], [bu + nu * len, bw + nw * len], len * 0.18), 6, 'side', { sw: 1.4 });
      }
    }
  } else if (form === 'medina') {
    // vicoli stretti e tortuosi: tutto da crescita; un anello interno
    addStreet(arcPath(RAD * 0.34, 0.3, 5.5, RAD * 0.03, 7), 3.6, 'alley', { sw: 0 });
  }
  // organica: solo arterie + crescita

  // ---- crescita di strade secondarie e vicoli (riempie gli isolati) ----
  const gap = (u: number, w: number) => {
    const f = radiusAt(u, w);
    const g = form === 'medina' ? 15 : f < oc ? (big ? 24 : 21) : f < 0.7 ? (big ? 30 : 27) : 40;
    return form === 'grid' ? g * 1.15 : g;
  };
  const growAttempts = big ? 3200 : 1300;
  let totalLen = 0;
  for (const s of streets) for (let i = 0; i + 1 < s.pts.length; i++) totalLen += Math.hypot(s.pts[i + 1][0] - s.pts[i][0], s.pts[i + 1][1] - s.pts[i][1]);
  for (let a = 0; a < growAttempts; a++) {
    // origine: un punto qualsiasi di una strada esistente (non l'anello della piazza)
    const si = Math.floor(rnd() * streets.length) % streets.length;
    const src = streets[si];
    if (src.kind === 'pedal' || src.kind === 'expr' || src.noParcel) continue;
    const pi = Math.floor(rnd() * (src.pts.length - 1));
    const pa = src.pts[pi], pb = src.pts[pi + 1];
    const seg = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1;
    const t = rnd();
    const px = pa[0] + (pb[0] - pa[0]) * t, pz = pa[1] + (pb[1] - pa[1]) * t;
    if (Math.hypot(px, pz) < plazaR + 14 || Math.hypot(px, pz) > RAD * 0.94) continue;
    const side = rnd() < 0.5 ? 1 : -1;
    const tx = (pb[0] - pa[0]) / seg, tz = (pb[1] - pa[1]) / seg;
    let dir = Math.atan2(tx, -tz) * 0 + Math.atan2(tz, tx) + side * (Math.PI / 2 + (form === 'grid' ? 0 : (rnd() - 0.5) * 0.7));
    const g0 = gap(px, pz);
    let cx = px + Math.cos(dir) * (src.width / 2 + 0.6), cz = pz + Math.sin(dir) * (src.width / 2 + 0.6);
    // niente stradine parallele troppo vicine: attorno all'origine, oltre la strada madre, non deve esserci altro
    const nearStart = idx.nearest(cx + Math.cos(dir) * g0 * 0.45, cz + Math.sin(dir) * g0 * 0.45, g0 * 0.42, si);
    if (nearStart) continue;
    const pts: Pt[] = [[px, pz]];
    let len = 0, end: 'free' | 'snap' | 'dead' = 'free';
    let snapPt: Pt | null = null, snapStreet = -1;
    const maxLen = (form === 'medina' ? 60 : 110) + rnd() * 40;
    const step = form === 'medina' ? 6 : 8;
    let wander = (rnd() - 0.5) * 0.04;
    for (let k = 0; k < 40 && len < maxLen; k++) {
      wander += (rnd() - 0.5) * (form === 'medina' ? 0.28 : form === 'grid' ? 0.0 : 0.1);
      wander = Math.max(-0.14, Math.min(0.14, wander));
      dir += wander * (form === 'grid' ? 0 : 1);
      cx += Math.cos(dir) * step; cz += Math.sin(dir) * step; len += step;
      const rr = Math.hypot(cx, cz);
      if (rr > RAD * 0.95) { end = 'dead'; break; }
      const hit = len > 12 ? idx.nearest(cx, cz, g0 * 0.7, si) : null;
      pts.push([cx, cz]);
      if (hit) {
        // vicino a un'altra strada: se abbastanza vicino ci si innesta (T), altrimenti si ferma
        if (hit.d < g0 * 0.62 && hit.d > 0) {
          const o = hit.seg * 5;
          const abx = idx.segs[o + 2] - idx.segs[o], abz = idx.segs[o + 3] - idx.segs[o + 1];
          snapPt = [idx.segs[o] + abx * hit.t, idx.segs[o + 1] + abz * hit.t];
          snapStreet = hit.street;
          end = 'snap';
        } else end = 'dead';
        break;
      }
    }
    if (len < 16 || pts.length < 3) continue;
    if (end === 'snap' && snapPt) {
      pts.pop();
      pts.push(snapPt);
      // il punto d'innesto diventa un vertice anche nell'altra strada (nodo comune del grafo)
      const tgt = streets[snapStreet];
      if (tgt) {
        let bi = 0, bd = Infinity;
        for (let i = 0; i + 1 < tgt.pts.length; i++) {
          const d = Math.hypot((tgt.pts[i][0] + tgt.pts[i + 1][0]) / 2 - snapPt[0], (tgt.pts[i][1] + tgt.pts[i + 1][1]) / 2 - snapPt[1]);
          if (d < bd) { bd = d; bi = i; }
        }
        tgt.pts.splice(bi + 1, 0, [snapPt[0], snapPt[1]]);
      }
    }
    const f = radiusAt(pts[1][0], pts[1][1]);
    const cls = form === 'medina' ? 'alley' : (src.kind === 'main' || src.kind === 'ring') && len > 70 && f < 0.7 && rnd() < 0.5 ? 'side' : (f < oc ? 'alley' : rnd() < 0.5 ? 'side' : 'alley');
    const old = f < oc;
    addStreet(pts, form === 'medina' ? 2.6 + rnd() * 0.6 : cls === 'side' ? (big ? 7 : 6) : old ? 3.8 : 4.8, cls, { sw: form === 'medina' ? 0 : old ? 0.5 : 1.5 });
  }

  // ---- rotonde agli incroci tra le arterie ----
  const mains = streets.filter((s) => s.kind === 'main' || (s.kind === 'ring' && s.width >= 7));
  const rounds: Pt[] = [];
  const nRound = big ? 5 : 2;
  const crossOf = (A: Street, B: Street): Pt | null => {
    for (let i = 0; i + 1 < A.pts.length; i++) for (let j = 0; j + 1 < B.pts.length; j++) {
      const p = A.pts[i], q = A.pts[i + 1], r = B.pts[j], s = B.pts[j + 1];
      const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]);
      if (Math.abs(d) < 1e-6) continue;
      const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d;
      const u2 = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
      if (t >= 0 && t <= 1 && u2 >= 0 && u2 <= 1) return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    }
    return null;
  };
  if (culture !== Culture.Mag || big) for (let i = 0; i < mains.length && rounds.length < nRound; i++) for (let j = i + 1; j < mains.length && rounds.length < nRound; j++) {
    const c = crossOf(mains[i], mains[j]);
    if (!c) continue;
    const rr = Math.hypot(c[0], c[1]);
    if (rr < plazaR + 40 || rr > RAD * 0.85) continue;
    if (rounds.some((o) => Math.hypot(o[0] - c[0], o[1] - c[1]) < 110)) continue;
    rounds.push(c);
  }
  for (const c of rounds) addStreet(arcPath(13, 0, TAU, 0, 5, c[0], c[1]), 7.6, 'ring', { sw: 1.2, noParcel: true });

  // ---- sopraelevata: nelle citta', una strada rialzata che scavalca arterie e anelli (sotto passano le strade) ----
  if (big && rnd() < 0.85) {
    const gi = Math.floor(rnd() * gates.length), gj = (gi + 2 + Math.floor(rnd() * 2)) % gates.length;
    const A = gatePts[gi], B = gatePts[gj];
    // curva che si avvicina al centro fino a ~0.4 RAD (il controllo e' il punto medio spostato verso il centro)
    const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2, ml = Math.hypot(mx, mz) || 1;
    const want = RAD * 0.42, pull = Math.max(0, ml - want);
    const ctl: Pt = [mx - (mx / ml) * pull * 2, mz - (mz / ml) * pull * 2];
    const pts: Pt[] = [];
    for (let k = 0; k <= 56; k++) {
      const t = k / 56, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), c = t * t;
      pts.push([a * A[0] + b * ctl[0] + c * B[0], a * A[1] + b * ctl[1] + c * B[1]]);
    }
    // lunghezza e quota: rampe da 140 m (pendenza ~5%)
    const cum: number[] = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = cum[cum.length - 1], ramp = Math.min(150, L * 0.3), top = 7.6;
    const elev = cum.map((s) => top * sstep(0, ramp, s) * sstep(0, ramp, L - s));
    addStreet(pts, 14, 'expr', { elev, sw: 0 });
  }

  // ---- mura storiche con porte ----
  const items0 = items.length;
  void items0;
  const addItem = (role: number, u: number, w: number, f: number, o: { sx?: number; sy?: number; sz?: number; s?: number; tint?: number; variant?: number; check?: boolean; margin?: number; street?: number; solid?: boolean } = {}): number => {
    const d = dimOf(culture, role);
    const sx = o.sx ?? 1, sy = o.sy ?? 1, sz = o.sz ?? 1, s = o.s ?? 1;
    const rect: Rect = { u, w, hw: (d.w * sx * s) / 2, hd: (d.d * sz * s) / 2, f };
    if (Math.hypot(u, w) + Math.hypot(rect.hw, rect.hd) > RAD * 0.995) return -1;
    if (o.check !== false) {
      if (placed.hits(rect, o.margin ?? 0.3)) return -1;
      for (const c of corners(rect)) if (idx.clearance(c[0], c[1]) < (o.street ?? -0.2)) return -1;
      const free = role === Role.Fountain || role === Role.Well || role === Role.Stall || role === Role.Lamp || role === Role.Lantern || role === Role.TreeA || role === Role.TreeB || role === Role.Bench || role === Role.Temple || role === Role.Tower;
      if (!free) for (const p of plazas) {
        const pu = u - (p.u ?? 0), pw = w - (p.w ?? 0);
        const pr = p.shape === 'circle' ? p.r - Math.hypot(pu, pw) : Math.min(p.hw - Math.abs(pu), p.hd - Math.abs(pw));
        if (pr > -Math.min(rect.hw, rect.hd) * 0.3) return -1;
      }
      for (const pk of parks) if (role !== Role.TreeA && role !== Role.TreeB && role !== Role.Bench && Math.abs(u - pk.u) < pk.hw + rect.hw && Math.abs(w - pk.w) < pk.hd + rect.hd) return -1;
    }
    if (d.solid !== false && (o.solid ?? true)) placed.add(rect);
    items.push({ kind: encodeKind(role, o.variant ?? variantFor(role, rnd(), true), culture), u, w, f, s, sx, sy, sz, tint: o.tint ?? wallTint() });
    return items.length - 1;
  };
  const faceCenter = (u: number, w: number, cu = 0, cw = 0) => Math.atan2(cu - u, cw - w);

  if (walled) {
    const rw = RAD * oc * 1.04;
    const wallTintC = culture === Culture.Mag ? 0xd8c29c : culture === Culture.Asia ? 0xd8d2c2 : 0xdccfb8;
    const segLen = dimOf(culture, Role.Wall).w;
    const per = squareWall ? 8 * rw : TAU * rw;
    const cnt = Math.round(per / segLen);
    let lastTower = -99;
    for (let i = 0; i < cnt; i++) {
      let wu: number, ww: number, f: number;
      if (squareWall) {
        const p = (i / cnt) * 4, side = Math.floor(p), t = (p - side) * 2 - 1;
        const rr = rw * 0.92;
        [wu, ww, f] = side === 0 ? [t * rr, -rr, Math.PI] : side === 1 ? [rr, t * rr, -Math.PI / 2] : side === 2 ? [-t * rr, rr, 0] : [-rr, -t * rr, Math.PI / 2];
      } else {
        const a = (i / cnt) * TAU;
        wu = Math.cos(a) * rw; ww = Math.sin(a) * rw; f = Math.atan2(-Math.cos(a), -Math.sin(a));
      }
      const cl = idx.clearance(wu, ww);
      if (cl < 2.5) {
        // una strada attraversa le mura: porta (grandi) o varco con arco (piccole)
        const hit = idx.nearest(wu, ww, 7);
        const wd = hit ? streets[hit.street].width : 4;
        if (wd >= 5 && i - lastTower > 3) { addItem(Role.Gate, wu, ww, f, { check: false, tint: wallTintC }); lastTower = i; }
        continue;
      }
      addItem(Role.Wall, wu, ww, f, { check: false, tint: wallTintC, variant: 0 });
      if (i % 9 === 0) addItem(Role.Pillar, wu, ww, 0, { check: false, tint: wallTintC });
    }
  }

  // ---- piazze: la principale con fontana, tempio e torre; le altre sul bordo delle arterie ----
  const tdim = dimOf(culture, Role.Temple);
  const bigTemple = big ? 1.12 : 1;
  const mainTemple = () => {
    if (main.shape === 'circle') {
      const a = rnd() * TAU;
      const tu = Math.cos(a) * (main.r + tdim.d * bigTemple / 2 + 6), tw = Math.sin(a) * (main.r + tdim.d * bigTemple / 2 + 6);
      addItem(Role.Temple, tu, tw, faceCenter(tu, tw), { check: false, tint: 0xf4ece0, variant: 0, s: bigTemple });
      const bu = Math.cos(a + 0.4) * (main.r + 9), bw = Math.sin(a + 0.4) * (main.r + 9);
      addItem(Role.Tower, bu, bw, faceCenter(bu, bw), { check: false, tint: 0xf1e6d2, variant: 0, s: bigTemple });
    } else {
      const side = rnd() < 0.5 ? 1 : -1;
      const tw = side * (main.hd + tdim.d * bigTemple / 2 + 8);
      addItem(Role.Temple, (rnd() - 0.5) * 8, tw, side > 0 ? Math.PI : 0, { check: false, tint: 0xf0e6cf, variant: 0, s: bigTemple });
      addItem(Role.Tower, main.hw + 6, side * (main.hd + 12), side > 0 ? Math.PI : 0, { check: false, tint: 0xe9dcc0, variant: 0, s: bigTemple });
    }
  };
  addItem(Role.Fountain, 0, 0, 0, { check: false, tint: 0xffffff, s: big ? 1.25 : 1 });
  mainTemple();
  for (let i = 0; i < (big ? 8 : 5); i++) {
    const a = rnd() * TAU, rr = (main.shape === 'circle' ? main.r : main.r) * 0.8;
    addItem(Role.Stall, Math.cos(a) * rr, Math.sin(a) * rr, faceCenter(Math.cos(a) * rr, Math.sin(a) * rr), { check: false, tint: wallTint() });
  }
  // altre piazze: sul margine di un'arteria, fra 0.45 e 0.8 del raggio, con fontana e una chiesetta
  const nPlaza = big ? 3 : 1;
  for (let k = 0, tries = 0; k < nPlaza && tries < 60; tries++) {
    const st = mains[Math.floor(rnd() * mains.length) % Math.max(1, mains.length)];
    if (!st) break;
    const p = st.pts[Math.floor(rnd() * st.pts.length) % st.pts.length];
    const rr = Math.hypot(p[0], p[1]) / RAD;
    if (rr < 0.45 || rr > 0.8) continue;
    const r = 10 + rnd() * 3;
    const off = st.width / 2 + r + 3;
    const side = rnd() < 0.5 ? 1 : -1;
    const dirA = Math.atan2(p[1], p[0]) + Math.PI / 2 * side;
    const pu = p[0] + Math.cos(dirA) * off, pw = p[1] + Math.sin(dirA) * off;
    if (idx.clearance(pu, pw) < r + 2 || plazas.some((q) => Math.hypot((q.u ?? 0) - pu, (q.w ?? 0) - pw) < 90)) continue;
    plazas.push({ shape: 'circle', r, hw: 0, hd: 0, u: pu, w: pw });
    placed.add({ u: pu, w: pw, hw: r, hd: r, f: 0 });
    addItem(Role.Fountain, pu, pw, 0, { check: false, tint: 0xffffff });
    const ta = Math.atan2(pw, pu);
    const tu = pu + Math.cos(ta) * (r + tdim.d * 0.35 + 3), tw = pw + Math.sin(ta) * (r + tdim.d * 0.35 + 3);
    addItem(Role.Temple, tu, tw, faceCenter(tu, tw, pu, pw), { tint: 0xf4ece0, variant: 0, s: 0.8 });
    k++;
  }

  // ---- parchi ----
  const nParks = big ? 6 : 2;
  for (let k = 0, tries = 0; k < nParks && tries < 120; tries++) {
    const a = rnd() * TAU, rr = RAD * (0.28 + rnd() * 0.58);
    const pu = Math.cos(a) * rr, pw = Math.sin(a) * rr;
    const hw = 26 + rnd() * 30, hd = 22 + rnd() * 24;
    if (Math.hypot(pu, pw) + Math.hypot(hw, hd) > RAD * 0.94) continue;
    // niente strade dentro
    let ok = true;
    for (let i = -2; i <= 2 && ok; i++) for (let j = -2; j <= 2 && ok; j++) if (idx.clearance(pu + (i / 2) * hw, pw + (j / 2) * hd) < 3) ok = false;
    if (!ok) continue;
    if (plazas.some((q) => Math.hypot((q.u ?? 0) - pu, (q.w ?? 0) - pw) < (q.shape === 'circle' ? q.r : q.r) + Math.hypot(hw, hd))) continue;
    if (parks.some((q) => Math.hypot(q.u - pu, q.w - pw) < Math.hypot(hw, hd) + Math.hypot(q.hw, q.hd))) continue;
    if (placed.hits({ u: pu, w: pw, hw, hd, f: 0 }, 1)) continue;
    parks.push({ u: pu, w: pw, hw, hd, f: 0 });
    placed.add({ u: pu, w: pw, hw, hd, f: 0 });
    // alberi sparsi, panchine lungo un viale, uno specchio d'acqua (fontana)
    const nTrees = Math.round((hw * hd) / 55);
    for (let i = 0; i < nTrees; i++) {
      const tu = pu + (rnd() * 2 - 1) * (hw - 2), tw = pw + (rnd() * 2 - 1) * (hd - 2);
      addItem(rnd() < 0.5 ? Role.TreeA : Role.TreeB, tu, tw, rnd() * 6, { check: false, s: 0.8 + rnd() * 0.5, tint: 0xffffff });
    }
    for (let i = 0; i < 4; i++) addItem(Role.Bench, pu - hw * 0.5 + i * hw * 0.33, pw, 0, { check: false, tint: 0xffffff });
    addItem(Role.Fountain, pu, pw + hd * 0.4, 0, { check: false, tint: 0xffffff });
    k++;
  }

  // ---- lotti lungo le strade ----
  const inCbd = (u: number, w: number) => cbd ? Math.hypot(u - cbd.u, w - cbd.w) < cbd.r : false;
  const inIndustry = (u: number, w: number) => {
    if (!industrial) return false;
    const f = radiusAt(u, w);
    return f > 0.5 && f < 0.92 && angDiff(Math.atan2(w, u), industrial.a) < industrial.half * (big ? 1 : 0.8);
  };
  type Choice = { role: number; sx: number; sy?: number; sz: number; variant?: number } | null;
  const pick = (u: number, w: number, st: Street): Choice => {
    const f = radiusAt(u, w);
    const x = rnd();
    if (inCbd(u, w)) {
      const dc = Math.hypot(u - cbd!.u, w - cbd!.w) / cbd!.r;
      return x < (0.55 - dc * 0.3) ? { role: Role.Skyscraper, sx: 0.8 + rnd() * 0.35, sy: 0.65 + (1 - dc) * 0.9 + rnd() * 0.5, sz: 0.85 + rnd() * 0.3, variant: Math.floor(rnd() * 3) } : { role: Role.Block, sx: 0.9 + rnd() * 0.4, sy: 0.9 + rnd() * 0.7, sz: 1, variant: Math.floor(rnd() * 4) };
    }
    if (inIndustry(u, w)) return x < 0.7 ? { role: Role.Warehouse, sx: 0.7 + rnd() * 0.6, sz: 0.8 + rnd() * 0.4, variant: Math.floor(rnd() * 4) } : x < 0.8 ? { role: Role.Chimney, sx: 1, sz: 1 } : { role: Role.Shed, sx: 1.5, sz: 1.5 };
    if (f < oc) {
      // centro storico: case a schiera piu' alte vicino alla piazza
      const pr = Math.hypot(u, w);
      if (pr < RAD * oc * 0.5) return x < 0.55 ? { role: Role.RowHigh, sx: 0.9 + rnd() * 0.45, sz: 1 } : x < 0.9 ? { role: Role.RowMid, sx: 0.9 + rnd() * 0.45, sz: 1 } : { role: Role.HouseL, sx: 1, sz: 1 };
      return x < 0.35 ? { role: Role.RowMid, sx: 0.9 + rnd() * 0.45, sz: 1 } : x < 0.7 ? { role: Role.RowLow, sx: 0.9 + rnd() * 0.5, sz: 1 } : x < 0.88 ? { role: Role.HouseM, sx: 1, sz: 1 } : { role: Role.HouseS, sx: 1, sz: 1 };
    }
    if (f < 0.66) {
      // cintura: palazzi dell'Ottocento e del Novecento
      if (big && x < 0.28) return { role: Role.Block, sx: 0.9 + rnd() * 0.5, sy: 0.8 + rnd() * 0.5, sz: 1, variant: Math.floor(rnd() * 4) };
      return x < 0.4 ? { role: Role.RowMid, sx: 0.9 + rnd() * 0.5, sz: 1 } : x < 0.6 ? { role: Role.RowHigh, sx: 0.9 + rnd() * 0.4, sz: 1 } : x < 0.85 ? { role: Role.HouseM, sx: 1, sz: 1 } : { role: Role.HouseL, sx: 1, sz: 1 };
    }
    if (f < 0.88) {
      if (big && st.kind === 'main' && x < 0.18) return { role: Role.Block, sx: 0.9 + rnd() * 0.3, sy: 0.7 + rnd() * 0.4, sz: 1, variant: Math.floor(rnd() * 4) };
      return x < 0.4 ? { role: Role.HouseS, sx: 1, sz: 1 } : x < 0.78 ? { role: Role.HouseM, sx: 1, sz: 1 } : x < 0.92 ? { role: Role.HouseL, sx: 1, sz: 1 } : { role: Role.RowLow, sx: 1, sz: 1 };
    }
    return x < 0.45 ? { role: Role.HouseS, sx: 1, sz: 1 } : x < 0.65 ? { role: Role.Granary, sx: 1, sz: 1 } : x < 0.85 ? { role: Role.Shed, sx: 1, sz: 1 } : { role: Role.HouseM, sx: 1, sz: 1 };
  };
  const registerDoor = (i: number, role: number, u: number, w: number, f: number, sz: number) => {
    const d = dimOf(culture, role);
    const off = (d.d * sz) / 2 + 1.1;
    doors.push({ index: i, u: u + Math.sin(f) * off, w: w + Math.cos(f) * off });
  };
  const order = streets.map((s, i) => i).sort((a, b) => streets[b].width - streets[a].width);
  for (const si of order) {
    const st = streets[si];
    if (st.kind === 'expr' || st.kind === 'pedal' || st.noParcel) continue;
    for (const side of [1, -1]) {
      let carry = 0.5;
      for (let i = 0; i + 1 < st.pts.length; i++) {
        const a = st.pts[i], b = st.pts[i + 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.1) continue;
        const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len;
        const nx = -tz * side, nz = tx * side;
        let t = carry;
        while (t < len) {
          const mu = a[0] + tx * t, mw = a[1] + tz * t;
          if (Math.hypot(mu, mw) > RAD * 0.97) break;
          const ch = pick(mu, mw, st);
          if (!ch) { t += 4; continue; }
          const d = dimOf(culture, ch.role);
          const sy = ch.sy ?? 1;
          const wdt = d.w * ch.sx, dep = d.d * ch.sz;
          const f0 = radiusAt(mu, mw);
          const attached = f0 < 0.66 || ch.role === Role.Block || ch.role === Role.Skyscraper;
          const setback = Math.max(st.sw ?? 1, 0.3) + (f0 < oc ? 0.3 : f0 < 0.66 ? 1.4 : f0 < 0.88 ? 3.5 + rnd() * 3 : 5 + rnd() * 5) + (ch.role === Role.Skyscraper ? 5 : 0);
          const off = st.width / 2 + setback + dep / 2;
          const cu = mu + nx * off + tx * wdt / 2, cw = mw + nz * off + tz * wdt / 2;
          const f = Math.atan2(-nx, -nz);
          const idxI = addItem(ch.role, cu, cw, f, { sx: ch.sx, sy, sz: ch.sz, margin: attached ? -0.2 : 0.4, variant: ch.variant, tint: ch.role === Role.Skyscraper ? 0xffffff : undefined });
          if (idxI >= 0) {
            if (ch.role <= Role.RowHigh) registerDoor(idxI, ch.role, cu, cw, f, ch.sz);
            t += wdt + (attached ? 0 : 1 + rnd() * 4);
          } else t += 3;
        }
        carry = t - len;
      }
    }
  }

  // ---- riempimento degli isolati: villette, orti, capanni, alberi nei vuoti lontani dalle strade ----
  const fillTries = big ? 5200 : 1900;
  for (let k = 0; k < fillTries; k++) {
    const a = rnd() * TAU, rr = Math.sqrt(rnd()) * RAD * 0.96;
    const u = Math.cos(a) * rr, w = Math.sin(a) * rr;
    const cl = idx.clearance(u, w);
    if (cl < 7) continue;
    if (inCbd(u, w)) continue;
    const near = idx.nearest(u, w, 40);
    const fcng = near ? (() => { const o = near.seg * 5; const abx = idx.segs[o + 2] - idx.segs[o], abz = idx.segs[o + 3] - idx.segs[o + 1]; const l2 = abx * abx + abz * abz || 1; const t2 = Math.max(0, Math.min(1, ((u - idx.segs[o]) * abx + (w - idx.segs[o + 1]) * abz) / l2)); return Math.atan2(idx.segs[o] + abx * t2 - u, idx.segs[o + 1] + abz * t2 - w); })() : rnd() * 6;
    const f = radiusAt(u, w);
    const x = rnd();
    if (f < oc) {
      if (x < 0.5) addItem(Role.Garden, u, w, fcng, { tint: 0xffffff });
      else if (x < 0.65) addItem(Role.TreeB, u, w, rnd() * 6, { s: 0.8 + rnd() * 0.4, tint: 0xffffff });
      else if (x < 0.8) addItem(Role.Laundry, u, w, fcng, { tint: 0xffffff });
      else addItem(Role.Shed, u, w, fcng, {});
    } else if (f < 0.88) {
      if (x < 0.34) addItem(Role.HouseS, u, w, fcng, {});
      else if (x < 0.5) addItem(Role.Garden, u, w, fcng, { tint: 0xffffff });
      else if (x < 0.7) addItem(rnd() < 0.5 ? Role.TreeA : Role.TreeB, u, w, rnd() * 6, { s: 0.8 + rnd() * 0.5, tint: 0xffffff });
      else if (x < 0.8) addItem(Role.Shed, u, w, fcng, {});
    } else {
      if (x < 0.4) addItem(Role.Garden, u, w, fcng, { tint: 0xffffff });
      else if (x < 0.7) addItem(rnd() < 0.5 ? Role.TreeA : Role.TreeB, u, w, rnd() * 6, { s: 0.8 + rnd() * 0.5, tint: 0xffffff });
      else if (x < 0.85) addItem(Role.Stack, u, w, rnd() * 6, { tint: 0xf0d060 });
    }
  }

  // ---- arredi stradali: lampioni e alberi lungo i viali ----
  for (const st of streets) {
    if (st.kind === 'expr' || st.kind === 'pedal' || st.kind === 'alley') continue;
    const every = st.kind === 'main' ? 22 : 30;
    let acc = every * 0.5, side = 1, acc2 = 8, side2 = -1;
    for (let i = 0; i + 1 < st.pts.length; i++) {
      const a = st.pts[i], b = st.pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len;
      let t = acc;
      while (t < len) {
        const nx = -tz * side, nz = tx * side;
        const off = st.width / 2 + Math.max(0.9, (st.sw ?? 1) * 0.5);
        const pu = a[0] + tx * t + nx * off, pw = a[1] + tz * t + nz * off;
        if (idx.clearance(pu, pw, -1) > -0.5) addItem(Role.Lamp, pu, pw, Math.atan2(-nx, -nz), { check: false, tint: 0xffffff });
        side = -side;
        t += every;
      }
      acc = t - len;
      // viali alberati: grandi arterie fuori dal centro storico
      if (st.kind === 'main' && st.width >= 8 && form !== 'medina') {
        let t2 = acc2;
        while (t2 < len) {
          const nx = -tz * side2, nz = tx * side2;
          const off = st.width / 2 + Math.max(1.6, (st.sw ?? 1) * 0.8);
          const pu = a[0] + tx * t2 + nx * off, pw = a[1] + tz * t2 + nz * off;
          if (radiusAt(pu, pw) > 0.08) addItem(culture === Culture.Asia && rnd() < 0.5 ? Role.TreeA : Role.TreeB, pu, pw, rnd() * 6, { check: false, s: 0.85 + rnd() * 0.3, tint: 0xffffff });
          side2 = -side2;
          t2 += 15;
        }
        acc2 = t2 - len;
      }
    }
  }
  // rotonde: aiuola al centro
  for (const c of rounds) addItem(rnd() < 0.5 ? Role.TreeB : Role.TreeA, c[0], c[1], 0, { check: false, s: 1.1, tint: 0xffffff });

  // ---- pile della sopraelevata: due colonne ogni ~20 m, spostate se cadono su una strada ----
  streets.forEach((st, si) => {
    if (st.kind !== 'expr' || !st.elev) return;
    let acc = 0;
    for (let i = 0; i + 1 < st.pts.length; i++) {
      const a = st.pts[i], b = st.pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len;
      acc += len;
      if (acc < 22) continue;
      acc = 0;
      const e = (st.elev[i] + st.elev[i + 1]) / 2;
      if (e < 1.6) continue;
      // se la pila cadrebbe su un'altra strada si prova a spostarla lungo l'asse
      let best = 0, ok = false;
      for (const sh of [0, 4, -4, 8, -8]) {
        const mu = (a[0] + b[0]) / 2 + tx * sh, mw = (a[1] + b[1]) / 2 + tz * sh;
        if (idx.clearance(mu, mw, si) > 2.4) { best = sh; ok = true; break; }
      }
      if (!ok) continue;
      const mu = (a[0] + b[0]) / 2 + tx * best, mw = (a[1] + b[1]) / 2 + tz * best;
      for (const o of [-1, 1]) {
        const nx = -tz * o, nz = tx * o;
        addItem(Role.Pier, mu + nx * (st.width / 2 - 2.6), mw + nz * (st.width / 2 - 2.6), Math.atan2(tx, tz) + 0, { check: false, sy: Math.max(0.5, e - 1.0), tint: 0xcfcac2 });
      }
    }
  });

  // ---- campagna ai margini: fienili e orti ----
  for (let i = 0; i < (big ? 18 : 8); i++) {
    const a = rnd() * TAU, rr = RAD * (0.9 + rnd() * 0.08);
    addItem(rnd() < 0.5 ? Role.Granary : Role.Shed, Math.cos(a) * rr, Math.sin(a) * rr, a + Math.PI, {});
  }

  const graph = buildGraph(streets, idx);
  const doorList: Door[] = doors.map((d) => ({ ...d, node: nearestNode(graph, d.u, d.w) }));
  const paveAt = (u: number, w: number) => {
    const f = radiusAt(u, w);
    return f < oc ? 1 : f < 0.66 ? 0.85 : f < 0.88 ? 0.35 : 0.1;
  };
  void totalLen;
  return {
    culture, tier, streets, plaza: main, plazas, parks, items, doors: doorList, graph, radius: RAD, fieldSpan: big ? 190 : 150,
    fieldAngle: rnd() * 3.1416, idx, pave: big ? 0.85 : 0.7, paveAt,
  };
}
