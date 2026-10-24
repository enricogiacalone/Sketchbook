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

// --- villaggi --------------------------------------------------------------------------------------------------
// Ogni pianeta ha alcuni villaggi sparsi (come la citta', una zolla piatta sul piano tangente al loro centro, che il
// pianeta include nella sua superficie, raccordata al rilievo). I siti si scelgono dal seme su terra asciutta e poco
// ripida; case e strade stanno in lib/village.ts.
export interface VillageSite {
  id: number;
  x: number; y: number; z: number; // direzione unitaria del centro
  h: number; // quota (m) della zolla
  yaw: number; // orientamento delle strade
  flat: number; // m: raggio della zolla piatta
}
export const VILLAGE_BLEND = 55; // m: raccordo al rilievo oltre la zolla
const VILLAGE_FLAT = 118;
// base ortonormale tangente in d (e1 = d x u, e2 = d x e1, con u un asse non parallelo a d): [e1, e2]
export function tangentBasis(dx: number, dy: number, dz: number): [number, number, number, number, number, number] {
  const ux = Math.abs(dy) > 0.9 ? 1 : 0, uy = Math.abs(dy) > 0.9 ? 0 : 1;
  let e1x = -dz * uy, e1y = dz * ux, e1z = dx * uy - dy * ux;
  const l1 = Math.hypot(e1x, e1y, e1z) || 1;
  e1x /= l1; e1y /= l1; e1z /= l1;
  return [e1x, e1y, e1z, dy * e1z - dz * e1y, dz * e1x - dx * e1z, dx * e1y - dy * e1x];
}
const villageCache = new Map<number, VillageSite[]>();
export function villagesOf(seed: number): VillageSite[] {
  const key = seed & 0x7fffffff;
  let list = villageCache.get(key);
  if (list) return list;
  list = [];
  villageCache.set(key, list); // (prima di cercare: surfaceHeightBase non guarda i villaggi, ma cosi' non c'e' ricorsione possibile)
  const want = 6;
  const ringR = 150 / PLANET_RADIUS;
  for (let a = 0; a < 2500 && list.length < want; a++) {
    // il primo villaggio sta a ~1,3 km dalla citta' (si vede salendo sulle colline), gli altri ovunque
    let dx: number, dy: number, dz: number;
    if (list.length === 0 && a < 700) {
      const th = 0.36 + hash3(key, a, 3, 555) * 0.22, az = hash3(key, a, 4, 555) * Math.PI * 2;
      dx = Math.sin(th) * Math.cos(az); dy = Math.cos(th); dz = Math.sin(th) * Math.sin(az);
    } else {
      dy = 1 - 2 * hash3(key, a, 1, 555);
      const az = hash3(key, a, 2, 555) * Math.PI * 2, rr = Math.sqrt(Math.max(0, 1 - dy * dy));
      dx = rr * Math.cos(az); dz = rr * Math.sin(az);
    }
    if (Math.abs(dy) > 0.82 || dy > 0.9) continue; // niente calotte polari ne' pianura della citta'
    if (list.some((v) => Math.acos(Math.min(1, v.x * dx + v.y * dy + v.z * dz)) < 0.22)) continue;
    // terra asciutta e poco ripida nel centro e su un anello di 150 m
    const h0 = surfaceHeightBase(seed, dx, dy, dz);
    if (h0 < 9 || h0 > 110) continue;
    const [e1x, e1y, e1z, e2x, e2y, e2z] = tangentBasis(dx, dy, dz);
    let ok = true, sum = h0;
    for (let k = 0; k < 12 && ok; k++) {
      const ang = (k / 12) * Math.PI * 2;
      let px = dx + (Math.cos(ang) * e1x + Math.sin(ang) * e2x) * ringR, py = dy + (Math.cos(ang) * e1y + Math.sin(ang) * e2y) * ringR, pz = dz + (Math.cos(ang) * e1z + Math.sin(ang) * e2z) * ringR;
      const l = Math.hypot(px, py, pz);
      px /= l; py /= l; pz /= l;
      const h = surfaceHeightBase(seed, px, py, pz);
      if (h < 5 || Math.abs(h - h0) > 30) ok = false;
      sum += h;
    }
    if (!ok) continue;
    list.push({ id: list.length, x: dx, y: dy, z: dz, h: sum / 13, yaw: hash3(key, a, 5, 555) * Math.PI, flat: VILLAGE_FLAT });
  }
  return list;
}
// villaggio piu' vicino (se la direzione e' entro `range` metri dal suo centro): la distanza in metri
export function villageNear(seed: number, x: number, y: number, z: number, range: number): { v: VillageSite; dist: number } | null {
  const vs = villagesOf(seed);
  const cosR = Math.cos(range / PLANET_RADIUS);
  for (const v of vs) {
    const dot = v.x * x + v.y * y + v.z * z;
    if (dot > cosR) return { v, dist: Math.acos(Math.min(1, dot)) * PLANET_RADIUS };
  }
  return null;
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
  const vn = villageNear(seed, x, y, z, VILLAGE_FLAT + VILLAGE_BLEND);
  if (vn) {
    const { v, dist } = vn;
    const a = dist / PLANET_RADIUS;
    const flat = v.h + (PLANET_RADIUS + v.h) * (1 / Math.cos(a) - 1);
    const w = 1 - smoothstep(v.flat, v.flat + VILLAGE_BLEND, dist);
    h = h + (flat - h) * w;
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
