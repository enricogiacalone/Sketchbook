import { Culture, PALETTE, Role, dimOf, encodeKind, variantFor } from './culture';
import { hashKey } from './globalGrid';

// Urbanistica dei villaggi (docs/stile.md): per ogni cultura una pianta diversa, costruita con regole vere: una gerarchia di strade
// (principale, secondarie, vicoli), una piazza con fontana, un edificio religioso e il suo campanile/minareto/pagoda sulla piazza,
// lotti lungo le strade con le facciate verso la strada (a schiera nei centri compatti, isolati nei villaggi sparsi), mura e porte
// dove servono, lampioni, cortili e orti dietro le case, alberi della cultura. Coordinate locali (u, w) in metri dal centro della
// zolla (raggio piatto 118 m): tutto sta entro MAX_R.
export const MAX_R = 104;

export interface Item {
  kind: number; // encodeKind(ruolo, variante, cultura)
  u: number; w: number;
  f: number; // il fronte punta verso (sin f, cos f) in (u, w)
  s: number; // scala uniforme
  sx: number; sy: number; sz: number; // allungamenti (case a schiera di larghezza diversa)
  tint: number; // colore che moltiplica i colori del modello (pareti)
}
// kind: 'main' (via principale / viale), 'side' (collettrice), 'alley' (vicolo), 'ring' (anello), 'expr' (sopraelevata: la quota e'
// in `elev`, una per punto: m sopra il suolo), 'pedal' (percorso nel parco, senza fondo stradale)
export interface Street { pts: Array<[number, number]>; width: number; kind: 'main' | 'side' | 'alley' | 'ring' | 'expr' | 'pedal'; elev?: number[]; surface?: number; sw?: number; noParcel?: boolean }
export interface Plaza { shape: 'circle' | 'rect'; r: number; hw: number; hd: number; u?: number; w?: number }
export interface Park { u: number; w: number; hw: number; hd: number; f: number }
export interface Door { index: number; u: number; w: number; node: number }
export interface Graph { nodes: Array<[number, number]>; adj: number[][] }
export interface Settlement {
  culture: number;
  tier: number;
  streets: Street[];
  plaza: Plaza;
  plazas: Plaza[]; // la principale e le altre
  parks: Park[];
  items: Item[];
  doors: Door[]; // porte delle case (per gli abitanti)
  graph: Graph;
  radius: number; // raggio dell'abitato (campi oltre)
  fieldSpan: number; // m di campi attorno all'abitato
  fieldAngle: number;
  idx: SegIndex;
  pave: number; // 0..1: quanto e' lastricato il suolo dell'abitato (citta' fitte: 0.8, borghi: 0)
  paveAt: (u: number, w: number) => number; // 0..1: densita' dell'abitato nel punto (cala verso la periferia)
}

export interface Rect { u: number; w: number; hw: number; hd: number; f: number }
export const corners = (r: Rect): Array<[number, number]> => {
  const fx = Math.sin(r.f), fz = Math.cos(r.f); // asse del fronte (u, w)
  const rx = fz, rz = -fx; // asse laterale
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [r.u + rx * r.hw * a + fx * r.hd * b, r.w + rz * r.hw * a + fz * r.hd * b] as [number, number]);
};
// SAT tra due rettangoli orientati, con un margine
export function overlap(a: Rect, b: Rect, margin: number): boolean {
  if (Math.hypot(a.u - b.u, a.w - b.w) > Math.hypot(a.hw, a.hd) + Math.hypot(b.hw, b.hd) + margin) return false;
  const A = corners({ ...a, hw: a.hw + margin / 2, hd: a.hd + margin / 2 }), B = corners({ ...b, hw: b.hw + margin / 2, hd: b.hd + margin / 2 });
  for (const r of [a, b]) {
    const fx = Math.sin(r.f), fz = Math.cos(r.f);
    for (const [ax, az] of [[fx, fz], [fz, -fx]]) {
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (const [x, z] of A) { const p = x * ax + z * az; amin = Math.min(amin, p); amax = Math.max(amax, p); }
      for (const [x, z] of B) { const p = x * ax + z * az; bmin = Math.min(bmin, p); bmax = Math.max(bmax, p); }
      if (amax < bmin || bmax < amin) return false;
    }
  }
  return true;
}
export function segDist(px: number, pz: number, a: [number, number], b: [number, number]): number {
  const abx = b[0] - a[0], abz = b[1] - a[1], l2 = abx * abx + abz * abz || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * abx + (pz - a[1]) * abz) / l2));
  return Math.hypot(px - (a[0] + abx * t), pz - (a[1] + abz * t));
}
export function streetClearance(streets: Street[], u: number, w: number): number {
  let m = Infinity;
  for (const s of streets) for (let i = 0; i + 1 < s.pts.length; i++) m = Math.min(m, segDist(u, w, s.pts[i], s.pts[i + 1]) - s.width / 2);
  return m;
}

// indice spaziale dei segmenti stradali (celle da 16 m): distanza dal bordo della carreggiata piu' vicina, vera fino a ~6 m dal
// bordo (oltre vale 6 + qualcosa); serve ai controlli dei lotti e a ogni vertice del terreno nelle citta' grandi
const SEG_CELL = 16;
const SEG_PAD = 7;
export class SegIndex {
  cells = new Map<number, number[]>();
  segs: number[] = []; // ax, az, bx, bz, mezza larghezza (5 per segmento)
  kinds: number[] = []; // per segmento: indice nell'elenco delle strade
  private key(ix: number, iz: number) { return (ix + 2048) * 4096 + (iz + 2048); }
  addStreet(st: Street, si: number) {
    for (let i = 0; i + 1 < st.pts.length; i++) this.addSeg(st.pts[i], st.pts[i + 1], st.width / 2, si);
  }
  addSeg(a: [number, number], b: [number, number], half: number, si: number) {
    const id = this.kinds.length;
    this.segs.push(a[0], a[1], b[0], b[1], half);
    this.kinds.push(si);
    const r = half + SEG_PAD;
    const x0 = Math.floor((Math.min(a[0], b[0]) - r) / SEG_CELL), x1 = Math.floor((Math.max(a[0], b[0]) + r) / SEG_CELL);
    const z0 = Math.floor((Math.min(a[1], b[1]) - r) / SEG_CELL), z1 = Math.floor((Math.max(a[1], b[1]) + r) / SEG_CELL);
    // (una diagonale lunga tocca molte celle del suo riquadro, ma il costo e' trascurabile per segmenti da ~8 m)
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const k = this.key(ix, iz);
      const c = this.cells.get(k);
      if (c) c.push(id);
      else this.cells.set(k, [id]);
    }
  }
  // distanza minima dal bordo della carreggiata (negativa dentro); `skip` esclude una strada
  clearance(u: number, w: number, skip = -1): number {
    const c = this.cells.get(this.key(Math.floor(u / SEG_CELL), Math.floor(w / SEG_CELL)));
    let m = SEG_PAD + 1;
    if (!c) return m;
    const sg = this.segs;
    for (const id of c) {
      if (id < 0 || this.kinds[id] === skip) continue;
      const o = id * 5;
      const abx = sg[o + 2] - sg[o], abz = sg[o + 3] - sg[o + 1], l2 = abx * abx + abz * abz || 1;
      const t = Math.max(0, Math.min(1, ((u - sg[o]) * abx + (w - sg[o + 1]) * abz) / l2));
      const d = Math.hypot(u - (sg[o] + abx * t), w - (sg[o + 1] + abz * t)) - sg[o + 4];
      if (d < m) m = d;
    }
    return m;
  }
  // indice della strada piu' vicina (entro `max` m dal bordo) e la distanza
  nearest(u: number, w: number, max: number, skip = -1): { street: number; d: number; seg: number; t: number } | null {
    const c = this.cells.get(this.key(Math.floor(u / SEG_CELL), Math.floor(w / SEG_CELL)));
    if (!c) return null;
    const sg = this.segs;
    let best: { street: number; d: number; seg: number; t: number } | null = null;
    for (const id of c) {
      if (this.kinds[id] === skip) continue;
      const o = id * 5;
      const abx = sg[o + 2] - sg[o], abz = sg[o + 3] - sg[o + 1], l2 = abx * abx + abz * abz || 1;
      const t = Math.max(0, Math.min(1, ((u - sg[o]) * abx + (w - sg[o + 1]) * abz) / l2));
      const d = Math.hypot(u - (sg[o] + abx * t), w - (sg[o + 1] + abz * t));
      if (d <= max && (!best || d < best.d)) best = { street: this.kinds[id], d, seg: id, t };
    }
    return best;
  }
}

export const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// polilinea di punti ogni ~step m da una lista di vertici (con oscillazione laterale morbida)
export function polyline(verts: Array<[number, number]>, step: number, wobble: number, rnd: () => number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < verts.length; i++) {
    const [a, b] = [verts[i], verts[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(len / step));
    const nx = -(b[1] - a[1]) / (len || 1), nz = (b[0] - a[0]) / (len || 1);
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      const lat = k === 0 || (i + 1 === verts.length - 1 && k === n) ? 0 : (rnd() - 0.5) * 2 * wobble;
      out.push([a[0] + (b[0] - a[0]) * t + nx * lat, a[1] + (b[1] - a[1]) * t + nz * lat]);
    }
  }
  return out;
}
export function arc(r: number, a0: number, a1: number, step: number, wobble: number, rnd: () => number): Array<[number, number]> {
  const n = Math.max(3, Math.round(Math.abs(a1 - a0) * r / step));
  return Array.from({ length: n + 1 }, (_, k) => {
    const a = a0 + ((a1 - a0) * k) / n, rr = r + (k === 0 || k === n ? 0 : (rnd() - 0.5) * 2 * wobble);
    return [Math.cos(a) * rr, Math.sin(a) * rr] as [number, number];
  });
}

export function buildGraph(streets: Street[], idx?: SegIndex): Graph {
  const nodes: Array<[number, number]> = [];
  const adj: number[][] = [];
  const grid = new Map<number, number[]>();
  const key = (cx: number, cz: number) => (cx + 4096) * 8192 + (cz + 4096);
  const find = (p: [number, number]) => {
    const cx = Math.floor(p[0] / 3), cz = Math.floor(p[1] / 3);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const c = grid.get(key(cx + dx, cz + dz));
      if (c) for (const i of c) if (Math.hypot(nodes[i][0] - p[0], nodes[i][1] - p[1]) < 2.2) return i;
    }
    nodes.push([p[0], p[1]]);
    adj.push([]);
    const k = key(cx, cz);
    const c = grid.get(k);
    if (c) c.push(nodes.length - 1);
    else grid.set(k, [nodes.length - 1]);
    return nodes.length - 1;
  };
  const link = (a: number, b: number) => {
    if (a !== b && !adj[a].includes(b)) { adj[a].push(b); adj[b].push(a); }
  };
  streets.forEach((s) => {
    if (s.kind === 'expr') return; // la sopraelevata non e' percorribile dagli abitanti
    let prev = -1;
    for (const p of s.pts) {
      const i = find(p);
      if (prev >= 0) link(prev, i);
      prev = i;
    }
  });
  // (un incrocio a T: l'estremo di una strada che cade su un'altra la spezza in quel punto)
  streets.forEach((s, si) => {
    if (s.kind === 'expr') return;
    for (const end of [s.pts[0], s.pts[s.pts.length - 1]]) {
      const i = find(end);
      if (idx) {
        const hit = idx.nearest(end[0], end[1], 2.6 + 3, si);
        if (hit && streets[hit.street].kind !== 'expr') {
          const o = hit.seg * 5;
          link(i, find([idx.segs[o], idx.segs[o + 1]]));
          link(i, find([idx.segs[o + 2], idx.segs[o + 3]]));
        }
      } else {
        for (const o of streets) {
          if (o === s || o.kind === 'expr') continue;
          for (let k = 0; k + 1 < o.pts.length; k++) {
            if (segDist(end[0], end[1], o.pts[k], o.pts[k + 1]) < 2.4) { link(i, find(o.pts[k])); link(i, find(o.pts[k + 1])); }
          }
        }
      }
    }
  });
  return { nodes, adj };
}
export function nearestNode(g: Graph, u: number, w: number): number {
  let best = 0, bd = Infinity;
  g.nodes.forEach((n, i) => { const d = Math.hypot(n[0] - u, n[1] - w); if (d < bd) { bd = d; best = i; } });
  return best;
}
// cammino piu' corto (A* semplice) tra due nodi: lista di nodi
export function shortestPath(g: Graph, from: number, to: number): number[] {
  if (from === to) return [from];
  const dist = new Array(g.nodes.length).fill(Infinity), prev = new Array(g.nodes.length).fill(-1), open = new Set<number>([from]);
  dist[from] = 0;
  while (open.size) {
    let cur = -1, bf = Infinity;
    for (const n of open) { const f = dist[n] + Math.hypot(g.nodes[n][0] - g.nodes[to][0], g.nodes[n][1] - g.nodes[to][1]); if (f < bf) { bf = f; cur = n; } }
    if (cur === to) break;
    open.delete(cur);
    for (const nb of g.adj[cur]) {
      const nd = dist[cur] + Math.hypot(g.nodes[cur][0] - g.nodes[nb][0], g.nodes[cur][1] - g.nodes[nb][1]);
      if (nd < dist[nb]) { dist[nb] = nd; prev[nb] = cur; open.add(nb); }
    }
  }
  if (prev[to] < 0) return [from];
  const path = [to];
  while (path[0] !== from && prev[path[0]] >= 0) path.unshift(prev[path[0]]);
  return path;
}

export function generateSettlement(seed: number, vid: number, culture: number, tier = 1): Settlement {
  const rs = ((seed ^ 0x51a3) + vid * 7919 + culture * 131) | 0;
  let n = 0;
  const rnd = () => hashKey(++n, 7, rs);
  const pal = PALETTE[culture];
  const items: Item[] = [];
  const placed: Rect[] = [];
  const streets: Street[] = [];
  const doors: Array<{ index: number; u: number; w: number }> = [];
  const wallTint = () => pal.walls[Math.floor(rnd() * pal.walls.length) % pal.walls.length];
  const variantPick = () => Math.floor(rnd() * 8);
  const plaza: Plaza = { shape: 'circle', r: 12, hw: 0, hd: 0 };
  const maxR = tier === 0 ? 44 : MAX_R;
  const idx = new SegIndex();

  // aggiunge un pezzo; con `check` lo scarta se tocca un altro pezzo o una strada. Ritorna l'indice o -1
  const add = (role: number, u: number, w: number, f: number, o: { sx?: number; sy?: number; sz?: number; s?: number; tint?: number; variant?: number; check?: boolean; margin?: number; street?: number; solid?: boolean } = {}): number => {
    const d = dimOf(culture, role);
    const sx = o.sx ?? 1, sy = o.sy ?? 1, sz = o.sz ?? 1, s = o.s ?? 1;
    const rect: Rect = { u, w, hw: (d.w * sx * s) / 2, hd: (d.d * sz * s) / 2, f };
    if (Math.hypot(u, w) + Math.hypot(rect.hw, rect.hd) > maxR) return -1;
    if (o.check !== false) {
      for (const p of placed) if (overlap(rect, p, o.margin ?? 0.3)) return -1;
      // lontano dalle strade (il bordo del pezzo non entra nella carreggiata)
      for (const c of corners(rect)) if (idx.clearance(c[0], c[1]) < (o.street ?? -0.2)) return -1;
      const pr = plaza.shape === 'circle' ? plaza.r - Math.hypot(u, w) : Math.min(plaza.hw - Math.abs(u), plaza.hd - Math.abs(w));
      if (role !== Role.Fountain && role !== Role.Well && role !== Role.Trough && role !== Role.Stall && role !== Role.Lamp && role !== Role.Lantern && role !== Role.TreeA && role !== Role.TreeB && pr > -Math.min(rect.hw, rect.hd) * 0.3) {
        // dentro la piazza: solo arredi (le chiese stanno sul bordo: hanno il centro fuori)
        if (role !== Role.Temple && role !== Role.Tower) return -1;
      }
    }
    if (d.solid !== false && (o.solid ?? true)) placed.push(rect);
    items.push({ kind: encodeKind(role, o.variant ?? variantFor(role, rnd()), culture), u, w, f, s, sx, sy, sz, tint: o.tint ?? wallTint() });
    return items.length - 1;
  };
  const addStreet = (pts: Array<[number, number]>, width: number, kind: Street['kind']) => {
    streets.push({ pts, width, kind });
    idx.addStreet(streets[streets.length - 1], streets.length - 1);
    return streets[streets.length - 1];
  };
  const registerDoor = (idx: number, role: number, u: number, w: number, f: number, sz: number) => {
    const d = dimOf(culture, role);
    const off = (d.d * sz) / 2 + 1.1;
    doors.push({ index: idx, u: u + Math.sin(f) * off, w: w + Math.cos(f) * off });
  };

  // lotti lungo una strada: per ogni lato, passo dopo passo; `pick` sceglie ruolo e larghezza dal punto (distanza dal centro)
  const parcels = (st: Street, o: { sides?: number[]; gap?: [number, number]; setback: number; pick: (r: number, u: number, w: number) => { role: number; sx: number; sz: number } | null; fill?: number; attach?: boolean; skipNear?: number; start?: number }) => {
    const sides = o.sides ?? [1, -1];
    for (const side of sides) {
      let carry = o.start ?? 0.5;
      for (let i = 0; i + 1 < st.pts.length; i++) {
        const a = st.pts[i], b = st.pts[i + 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.1) continue;
        const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len;
        const nx = -tz * side, nz = tx * side; // normale verso il lato
        let t = carry;
        while (t < len) {
          const mu = a[0] + tx * t, mw = a[1] + tz * t;
          const r = Math.hypot(mu, mw);
          const choice = rnd() < (o.fill ?? 1) ? o.pick(r, mu, mw) : null;
          if (!choice || r < (o.skipNear ?? 0)) { t += 4; continue; }
          const d = dimOf(culture, choice.role);
          const wdt = d.w * choice.sx, dep = d.d * choice.sz;
          const cu = mu + tx * wdt / 2 * 0 + nx * (st.width / 2 + o.setback + dep / 2), cw = mw + nz * (st.width / 2 + o.setback + dep / 2);
          // il fronte guarda la strada; il lato largo corre lungo la tangente
          const f = Math.atan2(-nx, -nz);
          const centerU = cu + tx * wdt / 2, centerW = cw + tz * wdt / 2;
          const idx = add(choice.role, centerU, centerW, f, { sx: choice.sx, sz: choice.sz, margin: o.attach ? -0.2 : 0.3 });
          if (idx >= 0) {
            if (choice.role <= Role.RowHigh) registerDoor(idx, choice.role, centerU, centerW, f, choice.sz);
            t += wdt + (o.attach ? 0 : o.gap ? o.gap[0] + rnd() * (o.gap[1] - o.gap[0]) : 0.4);
          } else t += 3;
        }
        carry = t - len;
      }
    }
  };

  const lampsAlong = (st: Street, every: number, role = Role.Lamp, off = 0.9) => {
    let acc = every * 0.5, side = 1;
    for (let i = 0; i + 1 < st.pts.length; i++) {
      const a = st.pts[i], b = st.pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len;
      let t = acc;
      while (t < len) {
        const nx = -tz * side, nz = tx * side;
        add(role, a[0] + tx * t + nx * (st.width / 2 + off), a[1] + tz * t + nz * (st.width / 2 + off), Math.atan2(-nx, -nz), { check: false, tint: 0xffffff });
        side = -side;
        t += every;
      }
      acc = t - len;
    }
  };

  const plazaEdge = (ang: number, extra = 0) => {
    const r = plaza.shape === 'circle' ? plaza.r : Math.min(plaza.hw, plaza.hd);
    return [Math.cos(ang) * (r + extra), Math.sin(ang) * (r + extra)] as [number, number];
  };

  if (tier === 0) {
    // casale: pochi edifici lungo un sentiero che si curva, un pozzo, la stalla e il fienile, qualche albero e l'orto
    plaza.r = 3;
    const a0 = rnd() * 6.283, bend = (rnd() - 0.5) * 0.9;
    const lane: Array<[number, number]> = [];
    for (let t = -40; t <= 40; t += 8) { const a = a0 + bend * (t / 40); lane.push([Math.cos(a0) * t - Math.sin(a0) * Math.sin(t / 22 + bend * 3) * 5, Math.sin(a0) * t + Math.cos(a0) * Math.sin(t / 22 + bend * 3) * 5]); void a; }
    const st = addStreet(lane, culture === Culture.Asia ? 2.8 : 3.4, 'side');
    add(Role.Well, 0, 0, 0, { check: false, tint: 0xffffff });
    const pick = () => { const x = rnd(); return x < 0.45 ? { role: Role.HouseS, sx: 1, sz: 1 } : x < 0.8 ? { role: Role.HouseM, sx: 1, sz: 1 } : { role: Role.HouseL, sx: 1, sz: 1 }; };
    parcels(st, { setback: 2 + rnd() * 2, gap: [3, 9], pick, fill: 0.7, skipNear: 5 });
    const base = items.length;
    for (let i = 0; i < base; i++) {
      const it = items[i], role = it.kind & 63;
      if (role > Role.HouseL) continue;
      const dx = Math.sin(it.f), dz = Math.cos(it.f), d = dimOf(culture, role), back = d.d / 2 + 4;
      const x = rnd();
      if (x < 0.35) add(Role.Granary, it.u - dx * back - dz * 5, it.w - dz * back + dx * 5, it.f, { s: 0.75 });
      else if (x < 0.65) add(Role.Garden, it.u - dx * back, it.w - dz * back, it.f, {});
      else if (x < 0.85) add(Role.Shed, it.u - dx * back + dz * 4, it.w - dz * back - dx * 4, it.f, {});
    }
    for (let i = 0; i < 8; i++) { const a = rnd() * 6.283, r = 18 + rnd() * 24; add(rnd() < 0.5 ? Role.TreeA : Role.TreeB, Math.cos(a) * r, Math.sin(a) * r, rnd() * 6, { s: 0.8 + rnd() * 0.5 }); }
    for (let i = 0; i < 3; i++) { const a = rnd() * 6.283, r = 10 + rnd() * 28; add(rnd() < 0.5 ? Role.Cart : Role.Barrels, Math.cos(a) * r, Math.sin(a) * r, rnd() * 6, {}); }
  } else if (culture === Culture.Med) {
    // borgo collinare: piazza circolare con fontana, chiesa e campanile sul bordo, 5-6 strade radiali, due anelli parziali, porta sulla principale
    plaza.r = 11 + rnd() * 3.5;
    const nRad = 5 + (rnd() < 0.5 ? 1 : 0);
    const a0 = rnd() * 6.283;
    const angs: number[] = [];
    for (let i = 0; i < nRad; i++) angs.push(a0 + (i / nRad) * 6.283 + (rnd() - 0.5) * 0.34);
    const templeAng = angs[1] + (angs[2] - angs[1]) / 2; // fra due radiali: la facciata sulla piazza
    const mainIdx = 0;
    const radials: Street[] = angs.map((a, i) => {
      const r0 = plaza.r + 1.2, r1 = 84 + rnd() * 18;
      const verts: Array<[number, number]> = [[Math.cos(a) * r0, Math.sin(a) * r0]];
      for (let k = 1; k <= 5; k++) { const rr = r0 + ((r1 - r0) * k) / 5, aa = a + (rnd() - 0.5) * 0.09; verts.push([Math.cos(aa) * rr, Math.sin(aa) * rr]); }
      return addStreet(polyline(verts, 11, 0.9, rnd), i === mainIdx ? 5.4 : 4, i === mainIdx ? 'main' : 'side');
    });
    // anello della piazza e due anelli parziali
    addStreet(arc(plaza.r + 1.2, 0, 6.283, 7, 0, rnd), 3.6, 'ring');
    for (const [rr, w] of [[40, 3.4], [68, 3.4]] as Array<[number, number]>) {
      for (let i = 0; i < nRad; i++) {
        if (rnd() < 0.22) continue;
        const aa = angs[i], ab = angs[(i + 1) % nRad] + (i + 1 === nRad ? 6.283 : 0);
        addStreet(arc(rr, aa, ab, 9, 1.6, rnd), w, 'ring');
      }
    }
    // pezzi fissi: fontana, chiesa e campanile
    add(Role.Fountain, 0, 0, 0, { check: false, tint: 0xffffff });
    const [tu, tw] = plazaEdge(templeAng, dimOf(culture, Role.Temple).d / 2 + 0.8);
    add(Role.Temple, tu, tw, Math.atan2(-tu, -tw), { check: false, tint: 0xf6efe2, variant: 0 });
    const [bu, bw] = plazaEdge(templeAng + 0.33, 3.6);
    add(Role.Tower, bu, bw, Math.atan2(-bu, -bw), { check: false, tint: 0xf1e6d2, variant: 0 });
    // edifici lungo le strade: piu' alti e compatti vicino alla piazza
    const pick = (r: number) => {
      const x = rnd();
      if (r < 34) return x < 0.55 ? { role: Role.RowHigh, sx: 0.9 + rnd() * 0.45, sz: 1 } : { role: Role.RowMid, sx: 0.9 + rnd() * 0.4, sz: 1 };
      if (r < 66) return x < 0.4 ? { role: Role.RowMid, sx: 0.9 + rnd() * 0.4, sz: 1 } : x < 0.7 ? { role: Role.RowLow, sx: 0.9 + rnd() * 0.5, sz: 1 } : { role: Role.HouseS, sx: 1, sz: 1 };
      return x < 0.45 ? { role: Role.HouseS, sx: 1, sz: 1 } : x < 0.75 ? { role: Role.HouseM, sx: 1, sz: 1 } : { role: Role.RowLow, sx: 0.9 + rnd() * 0.4, sz: 1 };
    };
    for (const st of streets) parcels(st, { setback: 0.5, attach: st.kind !== 'side' || true, pick, skipNear: plaza.r - 1, sides: st.kind === 'ring' && st.pts.length > 20 ? [1] : [1, -1] });
    // porta sulla radiale principale e tratti di mura attorno
    const mainEnd = radials[mainIdx].pts[radials[mainIdx].pts.length - 1];
    const gAng = Math.atan2(mainEnd[1], mainEnd[0]);
    const gR = Math.hypot(mainEnd[0], mainEnd[1]) + 4;
    add(Role.Gate, Math.cos(gAng) * gR, Math.sin(gAng) * gR, Math.atan2(-Math.cos(gAng), -Math.sin(gAng)), { check: false, tint: 0xe2d6bf });
    for (const sgn of [-1, 1]) {
      const pa = gAng + sgn * (3.9 / gR), pr = dimOf(culture, Role.Gate).w / 2;
      void pr;
      add(Role.Pillar, Math.cos(pa) * gR, Math.sin(pa) * gR, 0, { check: false, tint: 0xe2d6bf });
    }
    for (let a = 0; a < 6.283; a += 6 / gR) {
      const d = Math.abs(((a - gAng + 3.1416) % 6.283 + 6.283) % 6.283 - 3.1416);
      if (d < 0.14 || d > 1.35 || rnd() < 0.38) continue;
      add(Role.Wall, Math.cos(a) * gR, Math.sin(a) * gR, Math.atan2(-Math.cos(a), -Math.sin(a)) + 0, { check: false, tint: 0xd9ccb3 });
    }
    // piazza: bancarelle del mercato, lampioni lungo le strade, barili, cipressi attorno alla chiesa, ulivi ai margini
    for (let i = 0; i < 4; i++) {
      const a = templeAng + 1.2 + i * 1.25 + rnd() * 0.2;
      const [su, sw] = plazaEdge(a, -3.2);
      add(Role.Stall, su, sw, Math.atan2(-su, -sw), { check: false, tint: wallTint() });
    }
    for (const st of streets) if (st.kind === 'main' || st.kind === 'side') lampsAlong(st, 22);
    for (let i = 0; i < 6; i++) add(Role.TreeA, tu * 1.45 + (rnd() - 0.5) * 16, tw * 1.45 + (rnd() - 0.5) * 16, rnd() * 6, { s: 0.9 + rnd() * 0.3 });
    for (let i = 0; i < 14; i++) { const a = rnd() * 6.283, r = 76 + rnd() * 22; add(Role.TreeB, Math.cos(a) * r, Math.sin(a) * r, rnd() * 6, { s: 0.8 + rnd() * 0.5 }); }
    for (let i = 0; i < 3; i++) { const a = rnd() * 6.283, r = 80 + rnd() * 12; add(Role.Granary, Math.cos(a) * r, Math.sin(a) * r, a + 3.14, {}); }
    for (let i = 0; i < 8; i++) { const a = rnd() * 6.283, r = 25 + rnd() * 55; add(rnd() < 0.5 ? Role.Barrels : Role.Cart, Math.cos(a) * r, Math.sin(a) * r, rnd() * 6, {}); }
  } else if (culture === Culture.Alp) {
    // villaggio lineare lungo una strada con ruscello: case isolate con orto e catasta di legna, fienili su palafitte, chiesa e fontana
    plaza.r = 9;
    const phase = rnd() * 6.283, amp = 4 + rnd() * 5;
    const mainPts: Array<[number, number]> = [];
    for (let u = -98; u <= 98; u += 9) mainPts.push([u, amp * (Math.sin(u / 34 + phase) - Math.sin(phase)) * (0.4 + 0.6 * smooth(0, 30, Math.abs(u)))]);
    const main = addStreet(mainPts, 5, 'main');
    // vicoli laterali che salgono dalla strada
    const nSide = 4 + (rnd() < 0.5 ? 1 : 0);
    for (let i = 0; i < nSide; i++) {
      const u = -78 + (i + 0.5) * (156 / nSide) + (rnd() - 0.5) * 10, side = i % 2 ? 1 : -1;
      if (Math.abs(u) < 14) continue;
      const base = mainPts.reduce((b, p) => (Math.abs(p[0] - u) < Math.abs(b[0] - u) ? p : b), mainPts[0]);
      const len = 26 + rnd() * 24;
      addStreet(polyline([[base[0], base[1]], [base[0] + (rnd() - 0.5) * 10, base[1] + side * len * 0.5], [base[0] + (rnd() - 0.5) * 18, base[1] + side * len]], 8, 0.8, rnd), 3.2, 'side');
    }
    // fontana-abbeveratoio, chiesa e campanile sul lato nord della strada vicino al centro
    add(Role.Trough, 0, 0.5, 0, { check: false, tint: 0xffffff });
    add(Role.Fountain, 0, -5.2, 0, { check: false, tint: 0xffffff });
    const chU = 7 + rnd() * 6, chSide = rnd() < 0.5 ? 1 : -1;
    const chW = chSide * (dimOf(culture, Role.Temple).d / 2 + 6.5);
    add(Role.Temple, chU, chW, Math.atan2(0, -chSide), { check: false, tint: 0xf1ead8, variant: 0 });
    add(Role.Tower, chU - 8.5, chSide * 7.5, Math.atan2(0, -chSide), { check: false, tint: 0xd8cdb6, variant: 0 });
    const pick = (r: number) => {
      const x = rnd();
      return x < 0.45 ? { role: Role.HouseS, sx: 1, sz: 1 } : x < 0.8 ? { role: Role.HouseM, sx: 1, sz: 1 } : { role: Role.HouseL, sx: 1, sz: 1 };
    };
    for (const st of streets) parcels(st, { setback: st.kind === 'main' ? 4 + rnd() * 3 : 2.5, gap: [4, 10], pick, fill: st.kind === 'main' ? 0.75 : 0.5, skipNear: 6, sides: [1, -1] });
    // fienili su palafitte dietro le case, recinti, cataste, orti, bucato
    const base = items.length;
    for (let i = 0; i < base; i++) {
      const it = items[i];
      if (it.kind >> 9 !== culture) continue;
      const role = it.kind & 63;
      if (role > Role.HouseL) continue;
      const dx = Math.sin(it.f), dz = Math.cos(it.f); // verso la strada
      const d = dimOf(culture, role);
      const back = d.d / 2 + 4.5;
      const bu = it.u - dx * back, bw = it.w - dz * back;
      const x = rnd();
      if (x < 0.3) add(Role.Granary, bu - dz * 6, bw + dx * 6, it.f, { s: 0.75 });
      else if (x < 0.55) add(Role.Woodpile, bu + dz * 5, bw - dx * 5, it.f + 1.57, {});
      else if (x < 0.75) add(Role.Garden, bu, bw, it.f, {});
      else if (x < 0.85) add(Role.Laundry, it.u + dz * 5, it.w - dx * 5, it.f, { check: false });
      if (rnd() < 0.45) {
        // recinto di legno lungo il fronte
        const fu = it.u + dx * (d.d / 2 + 5), fw = it.w + dz * (d.d / 2 + 5);
        for (let k = -2; k <= 2; k++) add(Role.Fence, fu + dz * k * 4, fw - dx * k * 4, it.f + 1.5708, { check: false, tint: 0xd9c7a3 });
      }
    }
    lampsAlong(main, 28);
    for (let i = 0; i < 18; i++) { const a = rnd() * 6.283, r = 70 + rnd() * 30; add(Role.TreeA, Math.cos(a) * r, Math.sin(a) * r, rnd() * 6, { s: 0.85 + rnd() * 0.4 }); }
    for (let i = 0; i < 10; i++) add(Role.TreeB, (rnd() * 2 - 1) * 80, (rnd() * 2 - 1) * 40, rnd() * 6, { s: 0.7 + rnd() * 0.4 });
    for (let i = 0; i < 12; i++) { const a = rnd() * 6.283, r = 45 + rnd() * 50; add(Role.Wall, Math.cos(a) * r, Math.sin(a) * r, a + 1.5708, { s: 1, tint: 0xa9a399 }); }
    for (let i = 0; i < 7; i++) { const a = rnd() * 6.283, r = 55 + rnd() * 40; add(Role.Stack, Math.cos(a) * r, Math.sin(a) * r, rnd() * 6, { s: 0.9 + rnd() * 0.3, tint: 0xf0d060 }); }
  } else if (culture === Culture.Mag) {
    // medina murata: ovale di mura con torri e due porte, via principale da porta a porta attraverso il suk, vicoli stretti e tortuosi,
    // case a cortile addossate le une alle altre con tetti piani, moschea e minareto sul suk, palme
    plaza.shape = 'rect';
    plaza.hw = 9 + rnd() * 2;
    plaza.hd = 8 + rnd() * 2;
    plaza.r = Math.hypot(plaza.hw, plaza.hd);
    const rw = 90 + rnd() * 6;
    const ang0 = rnd() * 6.283;
    const gateA = ang0, gateB = ang0 + 3.1416 + (rnd() - 0.5) * 0.4;
    const gp = (a: number) => [Math.cos(a) * (rw - 1), Math.sin(a) * (rw - 1)] as [number, number];
    const mainVerts: Array<[number, number]> = [gp(gateA), [Math.cos(gateA) * rw * 0.45, Math.sin(gateA) * rw * 0.45 + (rnd() - 0.5) * 8], [-plaza.hw - 2.5, (rnd() - 0.5) * 3], [plaza.hw + 2.5, (rnd() - 0.5) * 3], [Math.cos(gateB) * rw * 0.45, Math.sin(gateB) * rw * 0.45 + (rnd() - 0.5) * 8], gp(gateB)];
    // la via passa dal suk: ordinata per u crescente se i due capi sono su lati opposti
    const orderU = mainVerts.slice().sort((a, b) => a[0] - b[0]);
    const main = addStreet(polyline(orderU, 8, 0.7, rnd), 4.2, 'main');
    // vicoli: partono dalla via principale e dal suk, serpeggiano, alcuni si chiudono (vicoli ciechi)
    const nAl = 9 + Math.floor(rnd() * 3);
    for (let i = 0; i < nAl; i++) {
      const u0 = (rnd() * 2 - 1) * rw * 0.75;
      const base = main.pts.reduce((b, p) => (Math.abs(p[0] - u0) < Math.abs(b[0] - u0) ? p : b), main.pts[0]);
      if (Math.abs(base[0]) < plaza.hw + 3) continue;
      const side = rnd() < 0.5 ? 1 : -1, len = 28 + rnd() * 38;
      const verts: Array<[number, number]> = [[base[0], base[1]]];
      let cu = base[0], cw = base[1], dir = side * 1.5708 + (rnd() - 0.5) * 0.5;
      for (let k = 0; k < 4; k++) { dir += (rnd() - 0.5) * 0.9; cu += Math.cos(dir) * len / 4; cw += Math.sin(dir) * len / 4; if (Math.hypot(cu, cw) > rw - 8) break; verts.push([cu, cw]); }
      if (verts.length > 1) addStreet(polyline(verts, 7, 0.4, rnd), 2.4, 'alley');
    }
    // vicolo ad anello interno
    addStreet(arc(rw * 0.58, 0.4, 5.2, 8, 1.2, rnd), 2.6, 'alley');
    // mura: segmenti da 6 m lungo l'ellisse con porte e torri
    const wallAt = (a: number) => [Math.cos(a) * rw, Math.sin(a) * rw * 0.96] as [number, number];
    const segs = Math.round((6.283 * rw) / 6);
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * 6.283;
      const dA = Math.abs(((a - gateA + 3.1416) % 6.283 + 6.283) % 6.283 - 3.1416), dB = Math.abs(((a - gateB + 3.1416) % 6.283 + 6.283) % 6.283 - 3.1416);
      if (dA < 0.075 || dB < 0.075) continue;
      const [wu, ww] = wallAt(a);
      add(Role.Wall, wu, ww, Math.atan2(-Math.cos(a), -Math.sin(a)) + 0, { check: false, tint: 0xd8c29c, variant: 0 });
      if (i % 12 === 0) add(Role.Pillar, wu, ww, 0, { check: false, tint: 0xd8c29c });
    }
    for (const g of [gateA, gateB]) {
      const [gu, gw] = wallAt(g);
      add(Role.Gate, gu, gw, Math.atan2(-Math.cos(g), -Math.sin(g)), { check: false, tint: 0xd8c29c });
      for (const sgn of [-1, 1]) { const a = g + sgn * 0.0745 * 1.0; const [pu, pw] = wallAt(a); add(Role.Pillar, pu, pw, 0, { check: false, tint: 0xd2b98c }); }
    }
    // suk: fontana, moschea e minareto, bancarelle lungo la via principale
    add(Role.Fountain, 0, 0, 0, { check: false, tint: 0xffffff });
    const mSide = rnd() < 0.5 ? 1 : -1;
    const tdim = dimOf(culture, Role.Temple);
    add(Role.Temple, (rnd() - 0.5) * 6, mSide * (plaza.hd + tdim.d / 2 + 1.2), Math.atan2(0, -mSide), { check: false, tint: 0xf0e6cf, variant: 0 });
    add(Role.Tower, plaza.hw + 1.5, mSide * (plaza.hd + 3.6), Math.atan2(0, -mSide), { check: false, tint: 0xe9dcc0, variant: 0 });
    const pick = (r: number) => {
      const x = rnd();
      if (r < 30) return x < 0.4 ? { role: Role.RowMid, sx: 0.9 + rnd() * 0.5, sz: 1 } : x < 0.7 ? { role: Role.RowHigh, sx: 0.9 + rnd() * 0.4, sz: 1 } : { role: Role.RowLow, sx: 0.9 + rnd() * 0.5, sz: 1 };
      return x < 0.35 ? { role: Role.RowLow, sx: 0.9 + rnd() * 0.6, sz: 1 } : x < 0.6 ? { role: Role.HouseS, sx: 1, sz: 1 } : x < 0.85 ? { role: Role.HouseM, sx: 1, sz: 1 } : { role: Role.HouseL, sx: 1, sz: 1 };
    };
    for (const st of streets) parcels(st, { setback: 0.3, attach: true, pick, skipNear: 4 });
    for (let i = 0; i < 10; i++) { const a = rnd() * 6.283, r = 10 + rnd() * 70; if (Math.abs(Math.sin(a) * r) < 6) continue; add(Role.Stall, Math.cos(a) * r, Math.sin(a) * r * 0.9, rnd() * 6, { s: 0.9 }); }
    for (const st of streets) if (st.kind === 'main') lampsAlong(st, 16);
    for (let i = 0; i < 10; i++) { const a = rnd() * 6.283, r = 16 + rnd() * 66; add(Role.TreeA, Math.cos(a) * r, Math.sin(a) * r * 0.9, rnd() * 6, { s: 0.8 + rnd() * 0.4 }); }
    for (let i = 0; i < 6; i++) { const a = rnd() * 6.283, r = 18 + rnd() * 60; add(Role.Archway, Math.cos(a) * r, Math.sin(a) * r * 0.9, rnd() * 6, { check: false, tint: wallTint() }); }
  } else {
    // villaggio asiatico: via principale sinuosa con vicoli a gradoni, piazza con vasca e lanterne, santuario e pagoda, torii all'ingresso,
    // case di legno a tetto curvo con murette, magazzini bianchi, pini e ciliegi
    plaza.shape = 'rect';
    plaza.hw = 9 + rnd() * 3;
    plaza.hd = 7 + rnd() * 2;
    plaza.r = Math.hypot(plaza.hw, plaza.hd);
    const phase = rnd() * 6.283, amp = 7 + rnd() * 6;
    const mainPts: Array<[number, number]> = [];
    for (let u = -98; u <= 98; u += 8) mainPts.push([u, amp * (Math.sin(u / 29 + phase) - Math.sin(phase)) * (0.3 + 0.7 * smooth(0, 28, Math.abs(u))) + 0]);
    const main = addStreet(mainPts, 4, 'main');
    for (let i = 0; i < 6; i++) {
      const u = -80 + (i + 0.5) * 26.6 + (rnd() - 0.5) * 8, side = i % 2 ? 1 : -1;
      if (Math.abs(u) < plaza.hw + 4) continue;
      const base = mainPts.reduce((b, p) => (Math.abs(p[0] - u) < Math.abs(b[0] - u) ? p : b), mainPts[0]);
      const len = 26 + rnd() * 24;
      addStreet(polyline([[base[0], base[1]], [base[0] + (rnd() - 0.5) * 8, base[1] + side * len * 0.55], [base[0] + (rnd() - 0.5) * 12, base[1] + side * len]], 7, 0.5, rnd), 2.8, 'side');
    }
    add(Role.Fountain, 0, 0, 0, { check: false, tint: 0xffffff });
    for (const x of [-3.5, 3.5]) add(Role.Lantern, x, 3.4, 0, { check: false, tint: 0xffffff });
    const tdim = dimOf(culture, Role.Temple), sSide = rnd() < 0.5 ? 1 : -1;
    add(Role.Temple, 2, sSide * (plaza.hd + tdim.d / 2 + 3), Math.atan2(0, -sSide), { check: false, tint: 0xf3ede0, variant: 0 });
    add(Role.Tower, -plaza.hw - 8, sSide * (plaza.hd + 9), Math.atan2(0, -sSide), { check: false, tint: 0xf0ead8, variant: 0 });
    const pick = (r: number) => {
      const x = rnd();
      return x < 0.34 ? { role: Role.RowLow, sx: 0.9 + rnd() * 0.5, sz: 1 } : x < 0.52 ? { role: Role.RowMid, sx: 0.9 + rnd() * 0.4, sz: 1 } : x < 0.78 ? { role: Role.HouseS, sx: 1, sz: 1 } : x < 0.93 ? { role: Role.HouseM, sx: 1, sz: 1 } : { role: Role.HouseL, sx: 1, sz: 1 };
    };
    for (const st of streets) parcels(st, { setback: 1.6, gap: [0.4, 2.6], pick, skipNear: 4, fill: 0.9 });
    // porte torii alle due estremita' della via, lanterne di pietra lungo la via, magazzini bianchi, muretti, alberi
    for (const sgn of [-1, 1]) {
      const end = main.pts[sgn < 0 ? 0 : main.pts.length - 1];
      add(Role.Gate, end[0] + sgn * 3, end[1], sgn < 0 ? 1.5708 : -1.5708, { check: false, tint: 0xffffff });
      for (const o of [-2.4, 2.4]) add(Role.Pillar, end[0] + sgn * 3, end[1] + o, 0, { check: false, tint: 0xffffff });
    }
    lampsAlong(main, 15, Role.Lantern, 1.4);
    for (let i = 0; i < 3; i++) { const a = rnd() * 6.283, r = 72 + rnd() * 20; add(Role.Granary, Math.cos(a) * r, Math.sin(a) * r, a + 3.14, { tint: 0xf4f0e6 }); }
    for (let i = 0; i < 16; i++) { const a = rnd() * 6.283, r = 25 + rnd() * 70; add(Role.Wall, Math.cos(a) * r, Math.sin(a) * r, a + 1.5708, { tint: 0xcfc6b2 }); }
    for (let i = 0; i < 22; i++) { const a = rnd() * 6.283, r = 30 + rnd() * 68; add(rnd() < 0.55 ? Role.TreeA : Role.TreeB, Math.cos(a) * r, Math.sin(a) * r, rnd() * 6, { s: 0.8 + rnd() * 0.5 }); }
    for (let i = 0; i < 6; i++) { const a = rnd() * 6.283, r = 20 + rnd() * 60; add(Role.Garden, Math.cos(a) * r, Math.sin(a) * r, rnd() * 6, {}); }
  }

  // case: indici delle porte -> nodo piu' vicino del grafo stradale
  const graph = buildGraph(streets, idx);
  // il centro e' collegato: se non c'e' nessun nodo vicino alla fontana si aggiunge
  const doorList: Door[] = doors.map((d) => ({ ...d, node: nearestNode(graph, d.u, d.w) }));
  return { culture, tier, streets, plaza, plazas: [plaza], parks: [], items, doors: doorList, graph, radius: maxR, fieldSpan: 130, fieldAngle: rnd() * 3.1416, idx, pave: 0, paveAt: () => 0 };
}
