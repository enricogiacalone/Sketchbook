import * as THREE from 'three';
import { PLANET_RADIUS as R, VILLAGE_BLEND, hEff, ruinsOf, surfaceHeight, tangentBasis, villageNear, villagesOf, type RuinSite, type VillageSite } from './planetSurface';
import { hashKey } from './globalGrid';

// I villaggi dei pianeti (siti scelti in planetSurface.ts: zolla piatta sul piano tangente al centro). Qui: la pianta
// (strade, piazza, case, fienili, chiesa, pozzo, lampioni, bancarelle, recinti), calcolata dal seme con coordinate locali (u lungo
// la strada principale A, w lungo quella trasversale B, in metri dal centro), poi portata nel riferimento del pianeta.
// Modelli e collider: components/Environment/villageModels.ts (le dimensioni stanno qui sotto, in VILLAGE_SPECS).
export enum VK { Cottage, Farm, Barn, Chapel, Well, Haystack, Stall, Lamp, Fence, Long, Shed, Cart, Barrels, Woodpile, Garden, Laundry, RuinWall, RuinColumn, RuinBlock, RuinArch, RuinFallen }
// il tipo salvato (`t`) = VK + ROOF_STEP * variante del tetto (0..3): stessa pianta, tetto di un altro colore
export const ROOF_STEP = 32;
export const ROOF_VARIANTS = 4;
export const kindOf = (t: number) => t % ROOF_STEP;
// dimensioni (m): larghezza x, altezza y, profondita' z del volume pieno (per i collider); fronte = +z del modello
export const VILLAGE_SPECS: Record<number, { w: number; h: number; d: number; solid: boolean }> = {
  [VK.Cottage]: { w: 6, h: 4.6, d: 5, solid: true },
  [VK.Farm]: { w: 8.5, h: 7, d: 6.5, solid: true },
  [VK.Barn]: { w: 11, h: 7.5, d: 8.5, solid: true },
  [VK.Chapel]: { w: 6, h: 8, d: 10, solid: true },
  [VK.Well]: { w: 2.2, h: 1, d: 2.2, solid: true },
  [VK.Haystack]: { w: 3, h: 3.4, d: 3, solid: true },
  [VK.Stall]: { w: 3, h: 2.6, d: 2, solid: true },
  [VK.Lamp]: { w: 0.4, h: 4.2, d: 0.4, solid: true },
  [VK.Fence]: { w: 4, h: 1.1, d: 0.2, solid: true },
  [VK.Long]: { w: 12, h: 4.4, d: 4.8, solid: true },
  [VK.Shed]: { w: 3.2, h: 2.8, d: 3, solid: true },
  [VK.Cart]: { w: 1.8, h: 1.1, d: 3.2, solid: true },
  [VK.Barrels]: { w: 2, h: 1.1, d: 1.4, solid: true },
  [VK.Woodpile]: { w: 3, h: 1.4, d: 1.2, solid: true },
  [VK.Garden]: { w: 5, h: 0.5, d: 3.5, solid: false },
  [VK.Laundry]: { w: 4, h: 2.2, d: 0.3, solid: false },
  [VK.RuinWall]: { w: 4, h: 2.2, d: 0.7, solid: true },
  [VK.RuinColumn]: { w: 1, h: 3.2, d: 1, solid: true },
  [VK.RuinBlock]: { w: 1.4, h: 0.9, d: 1.4, solid: true },
  [VK.RuinArch]: { w: 5.4, h: 5.3, d: 1.1, solid: false },
  [VK.RuinFallen]: { w: 0.9, h: 0.9, d: 4, solid: true },
};
export const VILLAGE_KINDS = Object.keys(VILLAGE_SPECS).map(Number);

export interface VillageItem {
  kind: number;
  u: number; w: number; // metri dal centro (A, B)
  f: number; // rad: il fronte punta verso A*sin f + B*cos f
  s: number; // scala (~1)
  tint: number; // colore (0xRRGGBB) che moltiplica i colori del modello
}
const WALLS = [0xfff4e0, 0xf5e1b8, 0xe9d7c4, 0xf0c9b0, 0xd9e6ec, 0xe6efd2, 0xf7e9d4, 0xe8c8a0];
const ROOF_TINT = 0xffffff;

const itemCache = new Map<string, VillageItem[]>();
export function villageItems(seed: number, v: VillageSite): VillageItem[] {
  const ck = `${seed}:${v.id}`;
  let list = itemCache.get(ck);
  if (list) return list;
  list = [];
  itemCache.set(ck, list);
  const rs = ((seed ^ 0x77e1) + v.id * 7919) | 0;
  let n = 0;
  const rnd = () => hashKey(++n, 1, rs);
  // il tetto cambia da villaggio a villaggio (una variante dominante) e da casa a casa (un po' di mescolanza)
  const roofMain = Math.floor(rnd() * ROOF_VARIANTS);
  const roof = () => (rnd() < 0.65 ? roofMain : Math.floor(rnd() * ROOF_VARIANTS));
  const add = (kind: number, u: number, w: number, f: number, s = 1, tint = ROOF_TINT) => list!.push({ kind: kind + (kind === VK.Cottage || kind === VK.Farm || kind === VK.Long || kind === VK.Shed ? ROOF_STEP * roof() : 0), u, w, f, s, tint });
  const density = 0.72 + rnd() * 0.28; // villaggi piu' o meno fitti
  const hasChapel = rnd() < 0.8;
  const barnsN = 1 + Math.floor(rnd() * 3);
  const wall = () => WALLS[Math.floor(rnd() * WALLS.length) % WALLS.length];
  // piazza: pozzo, bancarelle in cerchio, lampioni
  add(VK.Well, 0, 0, 0);
  const stalls = 3 + Math.floor(rnd() * 2);
  for (let k = 0; k < stalls; k++) {
    const a = (k / stalls) * Math.PI * 2 + rnd() * 0.5;
    add(VK.Stall, Math.cos(a) * 8.5, Math.sin(a) * 8.5, angleToCenter(Math.cos(a), Math.sin(a)), 1, wall());
  }
  // case lungo la strada principale (w = 0, u in -92..92) e lungo la trasversale (u = 0, w in -75..75), con gli annessi
  const lineHouses = (axis: 'u' | 'w', from: number, to: number, skip: number) => {
    for (const side of [1, -1]) {
      let t = from + rnd() * 5;
      while (t < to) {
        if (Math.abs(t) > skip) {
          const r = rnd();
          const kind = r < 0.22 ? VK.Farm : r < 0.34 ? VK.Long : VK.Cottage;
          const off = (kind === VK.Farm ? 11.5 : kind === VK.Long ? 9.5 : 9) + rnd() * 1.6;
          const wall0 = wall();
          const jitter = (rnd() - 0.5) * 0.18;
          const present = rnd() < density; // (i buchi fanno vedere il villaggio meno uniforme)
          const front = axis === 'u' ? (side > 0 ? Math.PI + jitter : jitter) : side > 0 ? -Math.PI / 2 + jitter : Math.PI / 2 + jitter;
          const at = (a: number, b: number): [number, number] => (axis === 'u' ? [t + a, side * (off + b)] : [side * (off + b), t + a]);
          if (present) {
            const [hu, hw] = at(0, 0);
            add(kind, hu, hw, front, 0.92 + rnd() * 0.2, wall0);
            // dietro la casa (lontano dalla strada): orto, capanno, panni stesi, legna; davanti: carretto, botti
            const back = 8 + (kind === VK.Farm ? 3 : 0);
            const extra = rnd();
            if (extra < 0.3) { const [u2, w2] = at(rnd() * 3, back + 2); add(VK.Garden, u2, w2, front, 1); }
            else if (extra < 0.5) { const [u2, w2] = at(5, back); add(VK.Shed, u2, w2, front + Math.PI, 1, wall()); }
            else if (extra < 0.65) { const [u2, w2] = at(-4.5, back - 2); add(VK.Laundry, u2, w2, front, 1, 0xffffff); }
            const front2 = rnd();
            if (front2 < 0.18) { const [u2, w2] = at(4.5, -(kind === VK.Farm ? 6 : 5.5)); add(VK.Barrels, u2, w2, front + (rnd() - 0.5), 1, 0xffffff); }
            else if (front2 < 0.32) { const [u2, w2] = at(-4, -6.5); add(VK.Cart, u2, w2, front + (rnd() - 0.5) * 0.6, 1, 0xffffff); }
            else if (front2 < 0.45) { const [u2, w2] = at(4.8, -4.5); add(VK.Woodpile, u2, w2, front, 1, 0xffffff); }
          }
          t += (kind === VK.Farm ? 13 : kind === VK.Long ? 15 : 10.5) + rnd() * 4;
        } else t += 5;
      }
    }
  };
  lineHouses('u', -92, 92, 17);
  lineHouses('w', -64, 52, 17);
  // chiesa in fondo alla strada trasversale, col fronte verso la piazza (non in tutti i villaggi)
  if (hasChapel) add(VK.Chapel, 0, 70, Math.PI, 1, 0xf6efe2);
  // lampioni sulla strada principale
  for (let t = -80; t <= 80; t += 20) {
    if (Math.abs(t) < 10) continue;
    add(VK.Lamp, t, 4.3, 0);
    add(VK.Lamp, t + 10, -4.3, 0);
  }
  for (let t = -56; t <= 56; t += 28) if (Math.abs(t) > 18) add(VK.Lamp, 4.3, t, 0);
  // fienili con pagliai e recinto, ai margini
  for (let k = 0; k < barnsN; k++) {
    const su = (rnd() < 0.5 ? -1 : 1), sw = k % 2 === 0 ? 1 : -1;
    const bu = su * (50 + rnd() * 18), bw = sw * (30 + rnd() * 18);
    const bf = rnd() * Math.PI * 2;
    add(VK.Barn, bu, bw, bf, 1, 0xc9573f);
    for (let h = 0; h < 3; h++) add(VK.Haystack, bu + (rnd() - 0.5) * 22, bw + (rnd() - 0.5) * 22, rnd() * 6, 0.8 + rnd() * 0.5, 0xf0d060);
    // recinto 26 x 22 attorno al fienile (a segmenti di 4 m, con un varco davanti)
    const hw = 13, hd = 11, cb = Math.cos(bf), sb = Math.sin(bf);
    const fence = (lx: number, lz: number, f: number) => add(VK.Fence, bu - lx * cb + lz * sb, bw + lx * sb + lz * cb, f, 1, 0xd9c7a3);
    for (let lx = -hw + 2; lx <= hw - 2; lx += 4) {
      fence(lx, -hd, bf + Math.PI);
      if (Math.abs(lx) > 3) fence(lx, hd, bf);
    }
    for (let lz = -hd + 2; lz <= hd - 2; lz += 4) {
      fence(-hw, lz, bf + Math.PI / 2);
      fence(hw, lz, bf - Math.PI / 2);
    }
  }
  return list;
}
const angleToCenter = (x: number, z: number) => Math.atan2(-x, -z);

// punto locale (u, w) -> riferimento del pianeta (piano tangente al centro del villaggio)
const _frame = new Map<number, { c: THREE.Vector3; A: THREE.Vector3; B: THREE.Vector3; rad: number }>();
export function villageFrame(v: VillageSite, seed: number) {
  const key = (seed & 0x7fffffff) * 16 + v.id;
  let f = _frame.get(key);
  if (!f) {
    const [e1x, e1y, e1z, e2x, e2y, e2z] = tangentBasis(v.x, v.y, v.z);
    const cs = Math.cos(v.yaw), sn = Math.sin(v.yaw);
    f = {
      c: new THREE.Vector3(v.x, v.y, v.z),
      A: new THREE.Vector3(e1x * cs + e2x * sn, e1y * cs + e2y * sn, e1z * cs + e2z * sn),
      B: new THREE.Vector3(-e1x * sn + e2x * cs, -e1y * sn + e2y * cs, -e1z * sn + e2z * cs),
      rad: R + v.h,
    };
    _frame.set(key, f);
  }
  return f;
}

// matrice di un elemento nel riferimento del pianeta: x = -A, y = normale, z = B ruotato di -f attorno alla normale
const _p = new THREE.Vector3(), _x = new THREE.Vector3(), _z = new THREE.Vector3();
export function villageItemMatrix(it: VillageItem, fr: ReturnType<typeof villageFrame>, out: THREE.Matrix4 = new THREE.Matrix4()): THREE.Matrix4 {
  _p.copy(fr.c).multiplyScalar(fr.rad).addScaledVector(fr.A, it.u).addScaledVector(fr.B, it.w);
  const sf = Math.sin(it.f), cf = Math.cos(it.f);
  // fronte (z del modello) = A*sin f + B*cos f ; x = y_up x z
  _z.copy(fr.A).multiplyScalar(sf).addScaledVector(fr.B, cf);
  _x.crossVectors(fr.c, _z);
  const m = out.makeBasis(_x.multiplyScalar(it.s), fr.c.clone().multiplyScalar(it.s), _z.multiplyScalar(it.s));
  return m.setPosition(_p);
}
export function villageItemPos(it: VillageItem, fr: ReturnType<typeof villageFrame>, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(fr.c).multiplyScalar(fr.rad).addScaledVector(fr.A, it.u).addScaledVector(fr.B, it.w);
}

// coordinate locali (u, w) di una direzione, o null se fuori dal villaggio piu' il raccordo
const STREET_W = 2.6;
export function villageLocal(seed: number, dx: number, dy: number, dz: number, range = 170): { v: VillageSite; u: number; w: number; dist: number } | null {
  const vn = villageNear(seed, dx, dy, dz, range);
  if (!vn) return null;
  const fr = villageFrame(vn.v, seed);
  const k = fr.c.x * dx + fr.c.y * dy + fr.c.z * dz;
  // il punto sul piano tangente: d * (rad / (d.c)) meno il centro
  const s = fr.rad / Math.max(0.2, k);
  const px = dx * s - fr.c.x * fr.rad, py = dy * s - fr.c.y * fr.rad, pz = dz * s - fr.c.z * fr.rad;
  return { v: vn.v, u: px * fr.A.x + py * fr.A.y + pz * fr.A.z, w: px * fr.B.x + py * fr.B.y + pz * fr.B.z, dist: vn.dist };
}
const sm = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// 0..1: strada battuta e piazza (colore del suolo e vegetazione)
export function villageGround(seed: number, dx: number, dy: number, dz: number): number {
  const L = villageLocal(seed, dx, dy, dz, 140);
  if (!L) return 0;
  const { u, w } = L;
  const d1 = Math.abs(w) + Math.max(0, Math.abs(u) - 98) * 1.5; // strada principale
  const d2 = Math.abs(u) + Math.max(0, Math.abs(w) - 72) * 1.5; // trasversale (fino alla chiesa)
  const dc = Math.hypot(u, w);
  const street = 1 - sm(STREET_W, STREET_W + 2.4, Math.min(d1, d2));
  const square = 1 - sm(12, 15, dc);
  return Math.max(street, square) * (1 - sm(100, 125, dc));
}
// c'e' un elemento a meno di `margin` m da (u, w)? (per sgombrare erba e simili)
export function villageBlocked(seed: number, v: VillageSite, u: number, w: number, margin: number): boolean {
  for (const it of villageItems(seed, v)) {
    const kd = kindOf(it.kind);
    if (kd === VK.Lamp || kd === VK.Fence || kd === VK.Garden || kd === VK.Laundry) continue;
    const sp = VILLAGE_SPECS[kd];
    const r = Math.hypot(sp.w, sp.d) / 2 * it.s + margin;
    if (Math.abs(it.u - u) < r && Math.abs(it.w - w) < r && Math.hypot(it.u - u, it.w - w) < r) return true;
  }
  return false;
}
export { villagesOf, VILLAGE_BLEND };

// --- strade tra villaggi e citta' ------------------------------------------------------------------------------------------
// I nodi sono la citta' (polo nord) e i villaggi; si collegano con un albero di costo minimo (Prim) sulle distanze angolari, con un
// percorso un po' sinuoso (poligonale di punti ogni ~40 m su cerchio massimo + deviazione laterale). Gli estremi sono le
// fini delle strade del villaggio piu' vicine all'altro nodo, o il bordo della zolla della citta'. `roadMask` (0..1) va nella
// maschera dei sentieri (nearTile.ts): colore del suolo, niente alberi sopra, ponti dove la strada attraversa l'acqua.
interface Road { pts: Float32Array; n: number; c: THREE.Vector3; cosHalf: number }
const roadCache = new Map<number, Road[]>();
const ROAD_SEG = 40; // m
const ROAD_MAX_RAD = 1.4; // collegamenti piu' lunghi non si fanno (> ~4 km)
export function villageRoads(seed: number): Road[] {
  const key = seed & 0x7fffffff;
  let roads = roadCache.get(key);
  if (roads) return roads;
  roads = [];
  roadCache.set(key, roads);
  const vs = villagesOf(seed);
  // nodi: 0 = citta'
  const nodes: THREE.Vector3[] = [new THREE.Vector3(0, 1, 0), ...vs.map((v) => new THREE.Vector3(v.x, v.y, v.z))];
  const ang = (a: THREE.Vector3, b: THREE.Vector3) => Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
  const inTree = new Set<number>([0]);
  const edges: Array<[number, number]> = [];
  while (inTree.size < nodes.length) {
    let best: [number, number] | null = null, bd = Infinity;
    for (const i of inTree) for (let j = 0; j < nodes.length; j++) {
      if (inTree.has(j)) continue;
      const d = ang(nodes[i], nodes[j]);
      if (d < bd) { bd = d; best = [i, j]; }
    }
    if (!best) break;
    inTree.add(best[1]);
    if (bd <= ROAD_MAX_RAD) edges.push(best);
  }
  // una scorciatoia in piu' tra i due villaggi non collegati piu' vicini (un po' di anelli)
  let extra: [number, number] | null = null, ed = Infinity;
  for (let i = 1; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    if (edges.some((e) => (e[0] === i && e[1] === j) || (e[0] === j && e[1] === i))) continue;
    const d = ang(nodes[i], nodes[j]);
    if (d < ed && d < 0.9) { ed = d; extra = [i, j]; }
  }
  if (extra) edges.push(extra);
  const endFor = (i: number, target: THREE.Vector3): THREE.Vector3 => {
    if (i === 0) {
      // bordo della zolla della citta' (0.19 rad) verso il bersaglio
      const t = target.clone().setY(0).normalize();
      return new THREE.Vector3(t.x * Math.sin(0.19), Math.cos(0.19), t.z * Math.sin(0.19));
    }
    const v = vs[i - 1];
    const fr = villageFrame(v, seed);
    let best = fr.c.clone(), bd = Infinity;
    for (const sgn of [1, -1]) for (const ax of [fr.A, fr.B]) {
      const p = fr.c.clone().multiplyScalar(fr.rad).addScaledVector(ax, sgn * 100).normalize();
      const d = ang(p, target);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };
  edges.forEach(([i, j], ei) => {
    const a = endFor(i, nodes[j]), b = endFor(j, nodes[i]);
    const total = ang(a, b);
    const len = total * R;
    const n = Math.max(3, Math.ceil(len / ROAD_SEG));
    const mid = a.clone().add(b).normalize();
    const tangent = b.clone().sub(a).normalize();
    const side = new THREE.Vector3().crossVectors(mid, tangent).normalize();
    const amp = Math.min(70, len * 0.06), ph = hashKey(ei + 3, 5, key) * 6.28;
    const pts = new Float32Array((n + 1) * 3);
    const p = new THREE.Vector3();
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      // slerp
      const s0 = Math.sin((1 - t) * total) / Math.sin(total || 1), s1 = Math.sin(t * total) / Math.sin(total || 1);
      p.copy(a).multiplyScalar(s0).addScaledVector(b, s1);
      const lat = Math.sin(t * Math.PI) * (Math.sin(t * 9 + ph) * 0.6 + Math.sin(t * 23 + ph * 2) * 0.25) * amp;
      p.addScaledVector(side, lat / R).normalize();
      pts[k * 3] = p.x; pts[k * 3 + 1] = p.y; pts[k * 3 + 2] = p.z;
    }
    roads!.push({ pts, n, c: mid, cosHalf: Math.cos(total / 2 + 0.03) });
  });
  return roads;
}
const _r0 = new THREE.Vector3(), _r1 = new THREE.Vector3(), _rd = new THREE.Vector3();
// 0..1: quanta strada (tra villaggi) c'e' nella direzione d; ai bordi sfuma su ~3 m
export function roadMask(seed: number, dx: number, dy: number, dz: number): number {
  const roads = villageRoads(seed);
  if (roads.length === 0) return 0;
  let best = Infinity;
  for (const r of roads) {
    if (r.c.x * dx + r.c.y * dy + r.c.z * dz < r.cosHalf) continue;
    _rd.set(dx * R, dy * R, dz * R);
    for (let k = 0; k < r.n; k++) {
      _r0.set(r.pts[k * 3] * R, r.pts[k * 3 + 1] * R, r.pts[k * 3 + 2] * R);
      _r1.set(r.pts[k * 3 + 3] * R, r.pts[k * 3 + 4] * R, r.pts[k * 3 + 5] * R);
      // distanza punto-segmento (corda: i segmenti sono ~40 m)
      const abx = _r1.x - _r0.x, aby = _r1.y - _r0.y, abz = _r1.z - _r0.z;
      const apx = _rd.x - _r0.x, apy = _rd.y - _r0.y, apz = _rd.z - _r0.z;
      let t = (apx * abx + apy * aby + apz * abz) / (abx * abx + aby * aby + abz * abz || 1);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = apx - abx * t, ey = apy - aby * t, ez = apz - abz * t;
      const d2 = ex * ex + ey * ey + ez * ez;
      if (d2 < best) best = d2;
    }
  }
  if (best === Infinity) return 0;
  const d = Math.sqrt(best);
  const t = Math.min(1, Math.max(0, (d - 1.8) / 3.2));
  return 1 - t * t * (3 - 2 * t);
}

// --- rovine (pezzi nel piano locale della rovina, ma ognuno alla quota vera del terreno) -----------------------------------
const ruinCache = new Map<string, VillageItem[]>();
export function ruinItems(seed: number, r: RuinSite): VillageItem[] {
  const ck = `${seed}:${r.id}`;
  let list = ruinCache.get(ck);
  if (list) return list;
  list = [];
  ruinCache.set(ck, list);
  const rs = ((seed ^ 0x3be5) + r.id * 6007) | 0;
  let n = 0;
  const rnd = () => hashKey(++n, 3, rs);
  const MOSS = [0xc9cdc2, 0xbfc4b4, 0xd2d2c8, 0xaeb89e];
  const add = (kind: number, u: number, w: number, f: number, s = 1) => list!.push({ kind, u, w, f, s, tint: MOSS[Math.floor(rnd() * MOSS.length) % MOSS.length] });
  // pianta rettangolare 16 x 11 con muri a pezzi (con varchi), colonne agli angoli e dentro, un arco all'ingresso, blocchi caduti
  const W = 8, D = 5.5;
  for (let x = -W + 2; x <= W - 2; x += 4) {
    if (rnd() < 0.8) add(VK.RuinWall, x, -D, Math.PI, 0.9 + rnd() * 0.2);
    if (rnd() < 0.55 && Math.abs(x) > 2) add(VK.RuinWall, x, D, 0, 0.9 + rnd() * 0.2);
  }
  for (let z = -D + 2; z <= D - 2; z += 4) {
    if (rnd() < 0.7) add(VK.RuinWall, -W, z, Math.PI / 2, 0.9 + rnd() * 0.2);
    if (rnd() < 0.6) add(VK.RuinWall, W, z, -Math.PI / 2, 0.9 + rnd() * 0.2);
  }
  for (const [x, z] of [[-W, -D], [W, -D], [-W, D], [W, D], [-3, 0], [3.5, -1.5]]) if (rnd() < 0.85) add(VK.RuinColumn, x + (rnd() - 0.5), z + (rnd() - 0.5), rnd() * 6, 0.85 + rnd() * 0.3);
  add(VK.RuinArch, 0, D + 0.4, 0, 1);
  for (let k = 0; k < 7; k++) add(VK.RuinBlock, (rnd() * 2 - 1) * (W + 3), (rnd() * 2 - 1) * (D + 3), rnd() * 6, 0.6 + rnd() * 0.7);
  for (let k = 0; k < 2; k++) add(VK.RuinFallen, (rnd() * 2 - 1) * (W - 1), (rnd() * 2 - 1) * (D - 1), rnd() * 6, 0.8 + rnd() * 0.3);
  return list;
}
const _rp = new THREE.Vector3(), _rz = new THREE.Vector3(), _rx = new THREE.Vector3(), _ry = new THREE.Vector3();
// matrice di un pezzo di rovina alla quota vera del terreno (su = radiale), e la sua direzione/quota (per tessera e collider)
export function ruinItemPlacement(seed: number, r: RuinSite, it: VillageItem, out: THREE.Matrix4, dirOut: THREE.Vector3): boolean {
  const c = new THREE.Vector3(r.x, r.y, r.z);
  const [e1x, e1y, e1z, e2x, e2y, e2z] = tangentBasis(r.x, r.y, r.z);
  const cs = Math.cos(r.yaw), sn = Math.sin(r.yaw);
  const A = new THREE.Vector3(e1x * cs + e2x * sn, e1y * cs + e2y * sn, e1z * cs + e2z * sn);
  const B = new THREE.Vector3(-e1x * sn + e2x * cs, -e1y * sn + e2y * cs, -e1z * sn + e2z * cs);
  _rp.copy(c).addScaledVector(A, it.u / R).addScaledVector(B, it.w / R).normalize();
  dirOut.copy(_rp);
  const h = surfaceHeight(seed, _rp.x, _rp.y, _rp.z);
  if (h < 2) return false; // niente in acqua
  const rad = R + hEff(h) - 0.12;
  _ry.copy(_rp);
  _rz.copy(A).multiplyScalar(Math.sin(it.f)).addScaledVector(B, Math.cos(it.f));
  _rz.addScaledVector(_ry, -_rz.dot(_ry)).normalize();
  _rx.crossVectors(_ry, _rz);
  out.makeBasis(_rx.multiplyScalar(it.s), _ry.clone().multiplyScalar(it.s), _rz.multiplyScalar(it.s));
  out.setPosition(_rp.x * rad, _rp.y * rad, _rp.z * rad);
  return true;
}

// posizione di un elemento del villaggio nel riferimento del sito (y = quota del piano + `up` metri)
export function villageItemSitePos(seed: number, v: VillageSite, it: VillageItem, site: { quat: THREE.Quaternion; hN: number }, up: number, out: THREE.Vector3): THREE.Vector3 {
  const fr = villageFrame(v, seed);
  villageItemPos(it, fr, out);
  out.addScaledVector(fr.c, up).applyQuaternion(site.quat);
  out.y -= R + site.hN;
  return out;
}
