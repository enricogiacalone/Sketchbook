import * as THREE from 'three';
import { styleFromSeed } from './planet';

// La superficie procedurale di un pianeta: quota (montagne, colline, mari) e colori/boschi in
// funzione della DIREZIONE dal centro, derivati dal seme. E' l'unica fonte: la sfera vista dallo
// spazio (SpacePlanets.tsx) e il terreno su cui si atterra (lib/site.ts, Terrain.tsx) la campionano
// entrambe, quindi la montagna che si vede da lontano e' quella su cui si cammina.
//
// La citta' sta al polo nord (0,1,0): attorno c'e' una pianura (PLAIN_ANGLE) che sale in
// montagne, colline e boschi a qualche chilometro. Il livello del mare e' la sfera di raggio R.

export const PLANET_RADIUS = 3000; // m (lo stesso di lib/space.ts PLANET_R)
export const MIN_FLOOR = -25; // il fondale non scende oltre (sotto il mare resta visibile, ci si cammina sopra)
export const hEff = (h: number) => Math.max(h, MIN_FLOOR);
export const SEA_LEVEL = 0;
const PLAIN_ANGLE = 0.12; // rad dal polo (~1000 m): sotto, pianura; poi il rilievo sale
const PLAIN_BLEND = 0.3; // rad su cui il rilievo cresce
const PLATEAU_FROM = 0.085; // rad: la zolla piatta della citta' (~255 m) poi si raccorda al rilievo
const PLATEAU_TO = 0.19;

// --- rumore 3D a valori, ripetibile -------------------------------------------------------
function hash3(x: number, y: number, z: number, s: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + Math.imul(s, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const fade = (t: number) => t * t * (3 - 2 * t);
export function noise3(x: number, y: number, z: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = fade(xf), v = fade(yf), w = fade(zf);
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, s);
  const x00 = c(0, 0, 0) + (c(1, 0, 0) - c(0, 0, 0)) * u;
  const x10 = c(0, 1, 0) + (c(1, 1, 0) - c(0, 1, 0)) * u;
  const x01 = c(0, 0, 1) + (c(1, 0, 1) - c(0, 0, 1)) * u;
  const x11 = c(0, 1, 1) + (c(1, 1, 1) - c(0, 1, 1)) * u;
  const y0 = x00 + (x10 - x00) * v;
  const y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w; // 0..1
}
function fbm(x: number, y: number, z: number, s: number, oct: number): number {
  let a = 0.5, f = 1, sum = 0, tot = 0;
  for (let i = 0; i < oct; i++) {
    sum += a * noise3(x * f, y * f, z * f, s + i * 31);
    tot += a;
    a *= 0.5;
    f *= 2.03;
  }
  return sum / tot;
}
// montagne a creste: 1 sulle creste
function ridged(x: number, y: number, z: number, s: number, oct: number): number {
  let a = 0.5, f = 1, sum = 0, tot = 0;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(noise3(x * f, y * f, z * f, s + i * 17) * 2 - 1);
    sum += a * n * n;
    tot += a;
    a *= 0.5;
    f *= 2.1;
  }
  return sum / tot;
}
const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// quota (m) sulla direzione unitaria d = (x,y,z) del pianeta `seed` (rispetto al livello del mare), senza i villaggi
function surfaceHeightBase(seed: number, x: number, y: number, z: number): number {
  const s = seed & 0x7fffffff;
  // continenti: dove il campo e' alto c'e' terra
  const cont = fbm(x * 1.7 + 11.3, y * 1.7, z * 1.7, s, 4); // ~0.2..0.8
  const land = smoothstep(0.42, 0.56, cont); // 0 mare, 1 terra
  // rilievo: colline ovunque, montagne a creste dove la terra e' alta
  const hills = (fbm(x * 9, y * 9, z * 9, s + 101, 4) - 0.5) * 70;
  const mount = ridged(x * 3.2, y * 3.2, z * 3.2, s + 202, 5) * smoothstep(0.5, 0.75, cont) * 360;
  const shelf = -60 + (cont / 0.42) * 55; // fondale: da -60 al largo a ~-5 vicino alla costa
  let h = cont < 0.42 ? shelf : land * (8 + hills * 0.6 + mount) + (1 - land) * -4;
  // laghi e fiumi: scavano la terra bassa sotto il livello del mare (l'acqua e' una sola superficie, a
  // quota 0); sulle montagne spariscono. Fiumi = linee dove un rumore (con un po' di meandro) vale 0.5.
  if (land > 0 && h > -3) {
    const lowland = 1 - smoothstep(35, 90, h);
    const lk = fbm(x * 5.5 + 3.1, y * 5.5, z * 5.5 + 7.7, s + 505, 3);
    const lake = smoothstep(0.57, 0.64, lk) * lowland;
    const wx = (noise3(x * 30, y * 30, z * 30, s + 606) - 0.5) * 0.06;
    const rv = Math.abs(fbm(x * 5 + wx + 21.7, y * 5 + wx, z * 5 + 4.2, s + 707, 2) - 0.5);
    const river = (1 - smoothstep(0.006, 0.03, rv)) * lowland * smoothstep(0.46, 0.52, cont);
    const carve = Math.max(lake, river);
    if (carve > 0) h = h + (Math.min(h, -4 - 5 * lake) - h) * carve;
  }
  // pianura attorno alla citta' (polo nord): all'asciutto
  const ang = Math.acos(Math.min(1, Math.max(-1, y)));
  const relief = smoothstep(PLAIN_ANGLE, PLAIN_ANGLE + PLAIN_BLEND, ang);
  const plain = 6 + (fbm(x * 40, y * 40, z * 40, s + 303, 2) - 0.5) * 3;
  h = plain + (h - plain) * relief;
  // la citta' e' piatta (zolla sul piano tangente al polo): il pianeta la include nella sua superficie, cosi' la
  // sfera vista da lontano, i suoi livelli di dettaglio e il terreno su cui si cammina coincidono. Piano a
  // raggio (R+h0)/cos(angolo), poi raccordo al rilievo naturale.
  if (ang < PLATEAU_TO) {
    const h0 = 6 + (fbm(0, 40, 0, s + 303, 2) - 0.5) * 3;
    const flat = h0 + (PLANET_RADIUS + h0) * (1 / Math.cos(ang) - 1);
    const sp = smoothstep(PLATEAU_FROM, PLATEAU_TO, ang);
    h = flat + (h - flat) * sp;
  }
  // acqua vicino alla citta': ogni pianeta ha un lago e un fiume (a lati opposti) a poche centinaia di metri
  // dal polo, cosi' si vedono subito dalla citta' (posizioni dal seme)
  const az = hash3(s, 7, 13, 99) * Math.PI * 2;
  const th = 0.27;
  const cx = Math.sin(th) * Math.cos(az), cy = Math.cos(th), cz = Math.sin(th) * Math.sin(az);
  const da = Math.acos(Math.min(1, Math.max(-1, x * cx + y * cy + z * cz)));
  const shore = (noise3(x * 25, y * 25, z * 25, s + 808) - 0.5) * 0.03;
  const lakeA = 1 - smoothstep(0.05 + shore, 0.078 + shore, da);
  const k = Math.sqrt(1 - 0.22 * 0.22);
  const psi = az + Math.PI;
  const q = x * k * Math.cos(psi) + y * 0.22 + z * k * Math.sin(psi);
  const wig = (noise3(x * 22, y * 22, z * 22, s + 909) - 0.5) * 0.03;
  const riverA = 1 - smoothstep(0.004, 0.012, Math.abs(q + wig));
  if (lakeA > 0) h = h + (Math.min(h, -12) - h) * lakeA;
  if (riverA > 0) h = h + (Math.min(h, -6) - h) * riverA;
  return h;
}

// --- civilta': insediamenti di ogni taglia ---------------------------------------------------------------------------------
// Ogni pianeta ha una gerarchia di insediamenti: poche citta', qualche citta' piccola, molti paesi e villaggi, tanti casali, distribuiti
// su terra asciutta e poco ripida, ognuno con la sua cultura (regioni del pianeta: lib/culture.ts) e la sua pianta (lib/settlement.ts).
// Un insediamento sta su una zolla "piatta in quota" (stessa quota radiale: segue la curvatura del pianeta, a differenza di un piano
// tangente) con un piano appena inclinato che segue il pendio, raccordata al rilievo. Le strade tra insediamenti: lib/roads.ts.
// base ortonormale tangente in d (e1 = d x u, e2 = d x e1, con u un asse non parallelo a d): [e1, e2]
export function tangentBasis(dx: number, dy: number, dz: number): [number, number, number, number, number, number] {
  const ux = Math.abs(dy) > 0.9 ? 1 : 0, uy = Math.abs(dy) > 0.9 ? 0 : 1;
  let e1x = -dz * uy, e1y = dz * ux, e1z = dx * uy - dy * ux;
  const l1 = Math.hypot(e1x, e1y, e1z) || 1;
  e1x /= l1; e1y /= l1; e1z /= l1;
  return [e1x, e1y, e1z, dy * e1z - dz * e1y, dz * e1x - dx * e1z, dx * e1y - dy * e1x];
}
export interface VillageSite {
  id: number;
  tier: 0 | 1 | 2 | 3; // 0 casale, 1 villaggio, 2 paese, 3 citta'
  x: number; y: number; z: number; // direzione unitaria del centro
  h: number; // quota (m) del centro della zolla
  gx: number; gw: number; // pendenza (m/m) del piano lungo A e B
  yaw: number; // orientamento dell'asse A
  flat: number; // m: raggio della zolla (quota fissa)
  radius: number; // m: raggio dell'abitato
  blend: number; // m: raccordo al rilievo oltre la zolla
  culture: number; // regione culturale
  ax: number; ay: number; az: number; bx: number; by: number; bz: number; // assi del piano (A, B) in tangente al centro
}
// per taglia: quanti, distanza minima in rad tra i centri, raggio della zolla piatta, raggio dell'abitato, raccordo minimo al rilievo,
// dislivello massimo tollerato (terrazzamento) e quanti candidati si provano
const TIER_DEF: Array<{ n: number; minSep: number; flat: number; radius: number; blend: number; relief: number; tries: number; minLand: number }> = [
  { n: 28, minSep: 0.075, flat: 50, radius: 46, blend: 30, relief: 26, tries: 1400, minLand: 5 },
  { n: 14, minSep: 0.16, flat: 112, radius: 106, blend: 55, relief: 40, tries: 1800, minLand: 5 },
  { n: 6, minSep: 0.27, flat: 270, radius: 262, blend: 90, relief: 62, tries: 2400, minLand: 6 },
  { n: 3, minSep: 0.5, flat: 520, radius: 500, blend: 130, relief: 90, tries: 3200, minLand: 6 },
];
export const VILLAGE_BLEND = 55;
const siteCache = new Map<number, VillageSite[]>();
// griglia di celle sulla sfera (cubo, 96 x 96 per faccia: celle di ~200 m) per trovare in fretta gli insediamenti vicini a una direzione
const CELLS = 96;
function cellKey(x: number, y: number, z: number): number {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let f: number, a: number, b: number, d: number;
  if (ax >= ay && ax >= az) { f = x > 0 ? 0 : 1; d = ax; a = y; b = z; }
  else if (ay >= az) { f = y > 0 ? 2 : 3; d = ay; a = x; b = z; }
  else { f = z > 0 ? 4 : 5; d = az; a = x; b = y; }
  const i = Math.min(CELLS - 1, Math.max(0, Math.floor((a / d * 0.5 + 0.5) * CELLS)));
  const j = Math.min(CELLS - 1, Math.max(0, Math.floor((b / d * 0.5 + 0.5) * CELLS)));
  return (f * CELLS + i) * CELLS + j;
}
const siteGrid = new Map<number, Map<number, number[]>>();
function gridOf(seed: number): Map<number, number[]> {
  const key = seed & 0x7fffffff;
  let g = siteGrid.get(key);
  if (g) return g;
  g = new Map();
  siteGrid.set(key, g);
  const list = villagesOf(seed);
  list.forEach((v, idx) => {
    const reach = (Math.max(v.flat + v.blend, v.radius + 200)) / PLANET_RADIUS + 0.012;
    // si marcano le celle in un quadrato attorno al centro (sulla sfera: campioni su una griglia di direzioni)
    const [e1x, e1y, e1z, e2x, e2y, e2z] = tangentBasis(v.x, v.y, v.z);
    const step = 0.0085;
    const n = Math.ceil(reach / step);
    for (let i = -n; i <= n; i++) for (let k = -n; k <= n; k++) {
      if (Math.hypot(i, k) * step > reach + step) continue;
      let px = v.x + (e1x * i + e2x * k) * step, py = v.y + (e1y * i + e2y * k) * step, pz = v.z + (e1z * i + e2z * k) * step;
      const l = Math.hypot(px, py, pz);
      px /= l; py /= l; pz /= l;
      const ck = cellKey(px, py, pz);
      let arr = g!.get(ck);
      if (!arr) { arr = []; g!.set(ck, arr); }
      if (!arr.includes(idx)) arr.push(idx);
    }
  });
  return g;
}
// regioni culturali: alcuni centri sul pianeta, a ognuno una cultura; un insediamento ha quella del centro piu' vicino
export function regionsOf(seed: number): Array<{ x: number; y: number; z: number; culture: number }> {
  const key = seed & 0x7fffffff;
  const out: Array<{ x: number; y: number; z: number; culture: number }> = [];
  const n = 5;
  const order = [0, 1, 2, 3, Math.floor(hash3(key, 1, 1, 321) * 4)];
  // un po' mescolate per pianeta
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(hash3(key, i, 2, 321) * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  for (let i = 0; i < n; i++) {
    const y = 1 - 2 * ((i + 0.5 + (hash3(key, i, 3, 321) - 0.5) * 0.5) / n), az = hash3(key, i, 4, 321) * Math.PI * 2 + i * 2.4, r = Math.sqrt(Math.max(0, 1 - y * y));
    out.push({ x: r * Math.cos(az), y, z: r * Math.sin(az), culture: order[i] });
  }
  return out;
}
export function cultureAtDir(seed: number, x: number, y: number, z: number): number {
  const rg = regionsOf(seed);
  let best = 0, bd = -2;
  rg.forEach((r, i) => { const d = r.x * x + r.y * y + r.z * z; if (d > bd) { bd = d; best = i; } });
  return rg[best].culture;
}

export function villagesOf(seed: number): VillageSite[] {
  const key = seed & 0x7fffffff;
  let list = siteCache.get(key);
  if (list) return list;
  list = [];
  siteCache.set(key, list); // (surfaceHeightBase non guarda gli insediamenti: nessuna ricorsione possibile)
  for (let tier = 3; tier >= 0; tier--) {
    const def = TIER_DEF[tier];
    // si provano molti candidati: terra asciutta e poco ripida; poi si scelgono i piu' piani (a parita' di taglia) rispettando le distanze
    interface Cand { dx: number; dy: number; dz: number; relief: number; h: number; gx: number; gw: number; yaw: number; A: [number, number, number]; B: [number, number, number] }
    const cands: Cand[] = [];
    for (let a = 0; a < def.tries; a++) {
      const dy = 1 - 2 * hash3(key, a, 1 + tier * 7, 555), az = hash3(key, a, 2 + tier * 7, 555) * Math.PI * 2, rr = Math.sqrt(Math.max(0, 1 - dy * dy));
      const dx = rr * Math.cos(az), dz = rr * Math.sin(az);
      if (Math.abs(dy) > 0.83) continue; // niente ghiacci
      const polar = Math.acos(Math.min(1, Math.max(-1, dy)));
      if (polar < (tier >= 2 ? 0.46 : 0.3)) continue; // la citta' di partenza sta al polo
      const h0 = surfaceHeightBase(seed, dx, dy, dz);
      if (h0 < def.minLand + 4 || h0 > 95) continue;
      const [e1x, e1y, e1z, e2x, e2y, e2z] = tangentBasis(dx, dy, dz);
      const yaw = hash3(key, a, 5 + tier * 7, 555) * Math.PI;
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      const A: [number, number, number] = [e1x * cs + e2x * sn, e1y * cs + e2y * sn, e1z * cs + e2z * sn];
      const B: [number, number, number] = [-e1x * sn + e2x * cs, -e1y * sn + e2y * cs, -e1z * sn + e2z * cs];
      // campioni a 0.7 del raggio piatto in 8 direzioni: terra asciutta e dislivello contenuto
      let hmin = h0, hmax = h0, sum = h0, sux = 0, suw = 0, ok = true;
      const rad = def.flat * 0.7;
      for (let k = 0; k < 8 && ok; k++) {
        const ang = (k / 8) * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
        const du = ca * rad / PLANET_RADIUS, dw = sa * rad / PLANET_RADIUS;
        const px = dx + A[0] * du + B[0] * dw, py = dy + A[1] * du + B[1] * dw, pz = dz + A[2] * du + B[2] * dw;
        const l = Math.hypot(px, py, pz);
        const h = surfaceHeightBase(seed, px / l, py / l, pz / l);
        if (h < def.minLand) ok = false;
        hmin = Math.min(hmin, h); hmax = Math.max(hmax, h);
        sum += h; sux += h * ca; suw += h * sa;
      }
      if (!ok || hmax - hmin > def.relief) continue;
      const slope = (v: number) => Math.max(-0.06, Math.min(0.06, v));
      cands.push({ dx, dy, dz, relief: hmax - hmin, h: sum / 9, gx: slope(sux / (4 * rad)), gw: slope(suw / (4 * rad)), yaw, A, B });
    }
    cands.sort((p, q) => p.relief - q.relief);
    let made = 0;
    for (const c of cands) {
      if (made >= def.n) break;
      let ok = true;
      for (const o of list) {
        const sep = Math.max(def.minSep, TIER_DEF[o.tier].minSep * 0.55);
        if (Math.acos(Math.min(1, o.x * c.dx + o.y * c.dy + o.z * c.dz)) < sep) { ok = false; break; }
      }
      if (!ok) continue;
      // il raccordo cresce col dislivello: pendii piu' dolci attorno a una zolla che ha dovuto tagliare di piu'
      const blend = Math.max(def.blend, c.relief * 2.6);
      list.push({
        id: list.length, tier: tier as 0 | 1 | 2 | 3, x: c.dx, y: c.dy, z: c.dz, h: c.h, gx: c.gx, gw: c.gw, yaw: c.yaw,
        flat: def.flat, radius: def.radius, blend, culture: cultureAtDir(seed, c.dx, c.dy, c.dz),
        ax: c.A[0], ay: c.A[1], az: c.A[2], bx: c.B[0], by: c.B[1], bz: c.B[2],
      });
      made++;
    }
  }
  return list;
}
// insediamento piu' vicino se la direzione sta entro `range` m dal suo centro: la distanza in metri
export function villageNear(seed: number, x: number, y: number, z: number, range: number): { v: VillageSite; dist: number } | null {
  const vs = villagesOf(seed);
  const cell = gridOf(seed).get(cellKey(x, y, z));
  if (!cell) return null;
  let best: { v: VillageSite; dist: number } | null = null;
  for (const i of cell) {
    const v = vs[i];
    const dot = v.x * x + v.y * y + v.z * z;
    const dist = Math.acos(Math.min(1, dot)) * PLANET_RADIUS;
    if (dist < range && (!best || dist < best.dist)) best = { v, dist };
  }
  return best;
}
// insediamento piu' vicino se la direzione sta entro il suo raggio piu' `pad` m: la distanza dal centro in metri
export function siteNear(seed: number, x: number, y: number, z: number, pad: number): { v: VillageSite; dist: number } | null {
  const vs = villagesOf(seed);
  const cell = gridOf(seed).get(cellKey(x, y, z));
  if (!cell) return null;
  let best: { v: VillageSite; dist: number } | null = null;
  for (const i of cell) {
    const v = vs[i];
    const dot = v.x * x + v.y * y + v.z * z;
    if (dot < 0.9) continue;
    const dist = Math.acos(Math.min(1, dot)) * PLANET_RADIUS;
    if (dist < v.radius + pad && (!best || dist < best.dist)) best = { v, dist };
  }
  return best;
}
// coordinate locali (u lungo A, w lungo B) in m di una direzione rispetto al centro di un insediamento (gnomoniche: sulla sfera)
export function siteLocal(v: VillageSite, x: number, y: number, z: number): [number, number] {
  const dot = v.x * x + v.y * y + v.z * z;
  const k = PLANET_RADIUS / Math.max(0.2, dot);
  const px = x * k - v.x * PLANET_RADIUS, py = y * k - v.y * PLANET_RADIUS, pz = z * k - v.z * PLANET_RADIUS;
  return [px * v.ax + py * v.ay + pz * v.az, px * v.bx + py * v.by + pz * v.bz];
}

// --- rovine ---------------------------------------------------------------------------------------------------------------
// Qualche rovina antica per pianeta (muri spezzati, colonne, un arco), su terra asciutta lontano dai villaggi e dalla citta'.
// Non spianano il terreno: ogni pezzo sta sulla quota vera (lib/village.ts `ruinItems`, nearTile.ts).
export interface RuinSite { id: number; x: number; y: number; z: number; yaw: number; h: number }
const ruinCache = new Map<number, RuinSite[]>();
export function ruinsOf(seed: number): RuinSite[] {
  const key = seed & 0x7fffffff;
  let list = ruinCache.get(key);
  if (list) return list;
  list = [];
  ruinCache.set(key, list);
  const vs = villagesOf(seed);
  for (let a = 0; a < 1800 && list.length < 5; a++) {
    const dy = 1 - 2 * hash3(key, a, 11, 777), az = hash3(key, a, 12, 777) * Math.PI * 2, rr = Math.sqrt(Math.max(0, 1 - dy * dy));
    const dx = rr * Math.cos(az), dz = rr * Math.sin(az);
    if (dy > 0.93 || Math.abs(dy) > 0.85) continue; // non sulla citta' ne' sui ghiacci
    if (vs.some((v) => Math.acos(Math.min(1, v.x * dx + v.y * dy + v.z * dz)) < 0.12)) continue;
    if (list.some((r) => Math.acos(Math.min(1, r.x * dx + r.y * dy + r.z * dz)) < 0.3)) continue;
    const h0 = surfaceHeightBase(seed, dx, dy, dz);
    if (h0 < 10 || h0 > 150) continue;
    const [e1x, e1y, e1z, e2x, e2y, e2z] = tangentBasis(dx, dy, dz);
    let ok = true;
    for (let k = 0; k < 8 && ok; k++) {
      const ang = (k / 8) * Math.PI * 2, rad = 30 / PLANET_RADIUS;
      const px = dx + (Math.cos(ang) * e1x + Math.sin(ang) * e2x) * rad, py = dy + (Math.cos(ang) * e1y + Math.sin(ang) * e2y) * rad, pz = dz + (Math.cos(ang) * e1z + Math.sin(ang) * e2z) * rad;
      const l = Math.hypot(px, py, pz);
      const h = surfaceHeightBase(seed, px / l, py / l, pz / l);
      if (h < 5 || Math.abs(h - h0) > 9) ok = false;
    }
    if (ok) list.push({ id: list.length, x: dx, y: dy, z: dz, yaw: hash3(key, a, 13, 777) * Math.PI, h: h0 });
  }
  return list;
}
export function ruinNear(seed: number, x: number, y: number, z: number, range: number): boolean {
  const cosR = Math.cos(range / PLANET_RADIUS);
  return ruinsOf(seed).some((r) => r.x * x + r.y * y + r.z * z > cosR);
}

export function surfaceHeight(seed: number, x: number, y: number, z: number): number {
  let h = surfaceHeightBase(seed, x, y, z);
  // insediamenti: zolla a quota fissa (con piano inclinato) raccordata al rilievo; le cime e le valli si livellano
  const vn = villageNear(seed, x, y, z, 1900);
  if (vn) {
    const { v, dist } = vn;
    const w = 1 - smoothstep(v.flat, v.flat + v.blend, dist);
    if (w > 0) {
      const [u, ww] = siteLocal(v, x, y, z);
      h = h + (v.h + v.gx * u + v.gw * ww - h) * w;
    }
  }
  return h;
}

export interface SurfaceInfo {
  h: number;
  forest: number; // 0..1 densita' di bosco
  snow: number; // 0..1
  rock: number; // 0..1
  sand: number; // 0..1
}
export function surfaceInfo(seed: number, x: number, y: number, z: number, h = surfaceHeight(seed, x, y, z)): SurfaceInfo {
  const s = seed & 0x7fffffff;
  const moist = fbm(x * 4 + 5.1, y * 4, z * 4 + 9.7, s + 404, 3);
  const polar = Math.abs(y); // ghiacci ai poli (la citta' sta al polo nord: le calotte stanno piu' in la')
  const snowLine = 210 - polar * 90;
  const snow = smoothstep(snowLine, snowLine + 50, h);
  const sand = h > -2 && h < 3 ? smoothstep(3, 0.4, h) : 0;
  const forest = smoothstep(0.38, 0.55, moist) * (1 - snow) * smoothstep(5, 18, h) * (1 - smoothstep(130, 190, h));
  const rock = smoothstep(120, 190, h) * (1 - snow);
  return { h, forest, snow, rock, sand };
}

// colori (sRGB) del pianeta: terra, bosco, roccia, sabbia, neve, fondale, tinti dal seme
const _c = new THREE.Color();
const _fog = new THREE.Color();
interface Palette { grass: THREE.Color; dirt: THREE.Color; forest: THREE.Color; fogTint: THREE.Color }
const paletteCache = new Map<number, Palette>();
const ROCK = new THREE.Color('#6d6a66');
const SAND = new THREE.Color('#c9b98a');
const SNOW = new THREE.Color('#eef3f8');
const SEABED = new THREE.Color().setHSL(0.58, 0.35, 0.14, THREE.SRGBColorSpace);
function palette(seed: number): Palette {
  let p = paletteCache.get(seed);
  if (!p) {
    const st = styleFromSeed(seed);
    const hue = ((seed * 7) % 360) / 360;
    p = {
      grass: new THREE.Color().setHSL(0.24 + (hue - 0.5) * 0.12, 0.38, 0.30, THREE.SRGBColorSpace),
      dirt: new THREE.Color().setHSL(0.09 + (hue - 0.5) * 0.08, 0.30, 0.34, THREE.SRGBColorSpace),
      forest: new THREE.Color().setHSL(0.30 + (hue - 0.5) * 0.1, 0.42, 0.16, THREE.SRGBColorSpace),
      fogTint: new THREE.Color(st.fogTint),
    };
    paletteCache.set(seed, p);
  }
  return p;
}
export function surfaceColor(seed: number, info: SurfaceInfo, out: THREE.Color = _c): THREE.Color {
  const pal = palette(seed);
  if (info.h < 0) return out.copy(SEABED).lerp(SAND, Math.min(1, (info.h + 12) / 12 > 0 ? (info.h + 12) / 12 : 0));
  out.copy(pal.grass).lerp(pal.dirt, 0.08 + 0.22 * (1 - info.forest));
  out.lerp(pal.forest, info.forest * 0.85);
  out.lerp(ROCK, info.rock);
  out.lerp(SAND, info.sand);
  out.lerp(SNOW, info.snow);
  // tinta del pianeta (foschia): un velo leggero
  out.lerp(_fog.copy(pal.fogTint), 0.05);
  return out;
}

// colore del mare (e dei laghi e fiumi): lo stesso per la sfera vista da lontano e per l'acqua del sito
export function seaColor(seed: number, out: THREE.Color = new THREE.Color()): THREE.Color {
  return out.setHSL(0.56 + (((seed * 5) % 20) - 10) / 400, 0.8, 0.26, THREE.SRGBColorSpace).lerp(palette(seed).fogTint, 0.04);
}

// altezza e normale cos sulla sfera: p (direzione) -> punto 3D sulla superficie (centro nell'origine)
export function surfacePoint(seed: number, x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  const h = surfaceHeight(seed, x, y, z);
  const r = PLANET_RADIUS + hEff(h);
  return out.set(x * r, y * r, z * r);
}
