import * as THREE from 'three';
import { PLANET_RADIUS as R, VILLAGE_BLEND, hEff, ruinsOf, siteLocal, siteNear, surfaceHeight, tangentBasis, villagesOf, type RuinSite, type VillageSite } from './planetSurface';
import { hashKey } from './globalGrid';
import { devTime } from './devTime';
import { TILE_CENTERS, TILE_RADIUS, tileOfDir } from './cubeTiles';
import { getCurrentSite } from './site';

// I villaggi dei pianeti (siti scelti in planetSurface.ts: zolla piatta sul piano tangente al centro). La civilta' di un pianeta
// (lib/culture.ts) decide la pianta (lib/settlement.ts: strade, piazza, lotti, mura) e i modelli; qui le coordinate locali (u, w)
// in metri dal centro vengono portate nel riferimento del pianeta e del sito, piu' il colore del suolo, i campi, le strade tra
// villaggi e le rovine. Modelli e collider: components/Environment/villageModels.ts (dimensioni in lib/culture.ts, KIT).
import { Culture, KIT, Role, cultureOfKind, cultureOfPlanet, dimOf, encodeKind, FIELD_COLORS, PALETTE, roleOf, type Dim } from './culture';
import { generateSettlement, type Settlement } from './settlement';
import { generateTown } from './town';
export { Role as VK, roleOf as kindOf, cultureOfKind, cultureOfPlanet, dimOf, KIT };

export interface VillageItem {
  kind: number; // encodeKind(ruolo, variante, cultura)
  u: number; w: number; // metri dal centro (A, B)
  f: number; // rad: il fronte punta verso A*sin f + B*cos f
  s: number; // scala uniforme (~1)
  sx?: number; sy?: number; sz?: number; // allungamenti (case a schiera)
  tint: number; // colore (0xRRGGBB) che moltiplica i colori del modello
}

const settleCache = new Map<string, Settlement>();
export function settlementOf(seed: number, v: VillageSite): Settlement {
  const key = `${seed}:${v.id}:${v.culture}`;
  let s = settleCache.get(key);
  if (!s) {
    s = devTime(`settlement t${v.tier} #${v.id}`, () => (v.tier >= 2 ? generateTown(seed, v) : generateSettlement(seed, v.id, v.culture, v.tier)));
    settleCache.set(key, s);
  }
  return s;
}
// gli elementi di un abitato divisi per tessera del pianeta (si calcola una volta per abitato)
const tileBuckets = new Map<Settlement, Map<number, VillageItem[]>>();
export function villageTileItems(seed: number, v: VillageSite, tile: number): VillageItem[] {
  // l'abitato (raggio + qualche metro) tocca questa tessera?
  const dot = v.x * TILE_CENTERS[tile * 3] + v.y * TILE_CENTERS[tile * 3 + 1] + v.z * TILE_CENTERS[tile * 3 + 2];
  if (Math.acos(Math.min(1, dot)) * R > v.radius + 40 + TILE_RADIUS) return [];
  const S = settlementOf(seed, v);
  let b = tileBuckets.get(S);
  if (!b) {
    b = new Map();
    const fr = villageFrame(v, seed);
    const p = new THREE.Vector3();
    for (const it of S.items) {
      villageItemPos(it, fr, p);
      const l = p.length();
      const k = tileOfDir(p.x / l, p.y / l, p.z / l);
      const list = b.get(k);
      if (list) list.push(it);
      else b.set(k, [it]);
    }
    tileBuckets.set(S, b);
  }
  return b.get(tile) ?? [];
}
export const villageItems = (seed: number, v: VillageSite): VillageItem[] => settlementOf(seed, v).items;

// punto locale (u, w) -> riferimento del pianeta. Le coordinate sono gnomoniche (sul piano tangente al centro, a raggio R): la
// direzione del punto e' normalize(c R + A u + B w); la quota e' quella del piano della zolla (v.h + gx u + gw w), sulla sfera,
// cosi' un abitato largo mezzo chilometro segue la curvatura del pianeta (i singoli edifici stanno dritti sulla verticale locale).
export interface VillageFrame { c: THREE.Vector3; A: THREE.Vector3; B: THREE.Vector3; v: VillageSite }
const _frame = new Map<number, VillageFrame>();
export function villageFrame(v: VillageSite, seed: number): VillageFrame {
  const key = (seed & 0x7fffffff) * 128 + v.id;
  let f = _frame.get(key);
  if (!f) {
    f = { c: new THREE.Vector3(v.x, v.y, v.z), A: new THREE.Vector3(v.ax, v.ay, v.az), B: new THREE.Vector3(v.bx, v.by, v.bz), v };
    _frame.set(key, f);
  }
  return f;
}
export const planeHeight = (v: VillageSite, u: number, w: number) => v.h + v.gx * u + v.gw * w;

// matrice di un elemento nel riferimento del pianeta: y = verticale locale, z = (A sin f + B cos f) proiettato sul suolo, x = y x z
const _p = new THREE.Vector3(), _x = new THREE.Vector3(), _z = new THREE.Vector3(), _d = new THREE.Vector3();
export function villageItemPos(it: { u: number; w: number; y?: number }, fr: VillageFrame, out: THREE.Vector3): THREE.Vector3 {
  _d.copy(fr.c).multiplyScalar(R).addScaledVector(fr.A, it.u).addScaledVector(fr.B, it.w).normalize();
  return out.copy(_d).multiplyScalar(R + planeHeight(fr.v, it.u, it.w) + (it.y ?? 0));
}
export function villageItemMatrix(it: VillageItem, fr: VillageFrame, out: THREE.Matrix4 = new THREE.Matrix4()): THREE.Matrix4 {
  villageItemPos(it, fr, _p);
  _d.copy(_p).normalize();
  const sf = Math.sin(it.f), cf = Math.cos(it.f);
  _z.copy(fr.A).multiplyScalar(sf).addScaledVector(fr.B, cf);
  _z.addScaledVector(_d, -_z.dot(_d)).normalize();
  _x.crossVectors(_d, _z);
  const m = out.makeBasis(_x.multiplyScalar(it.s * (it.sx ?? 1)), _d.clone().multiplyScalar(it.s * (it.sy ?? 1)), _z.multiplyScalar(it.s * (it.sz ?? 1)));
  return m.setPosition(_p);
}

// coordinate locali (u, w) di una direzione, o null se oltre l'abitato piu' `pad` m
export function villageLocal(seed: number, dx: number, dy: number, dz: number, pad = 30): { v: VillageSite; u: number; w: number; dist: number } | null {
  const vn = siteNear(seed, dx, dy, dz, pad);
  if (!vn) return null;
  const [u, w] = siteLocal(vn.v, dx, dy, dz);
  return { v: vn.v, u, w, dist: vn.dist };
}
const sm = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const _gc = new THREE.Color();
const _pc = new THREE.Color();
// l'inizio dei campi e quanti metri ne cingono l'abitato
// 0..1: strada battuta, piazza e lastricato (colore del suolo e vegetazione); scrive in `out` il colore (selciato, ghiaia, terra battuta...)
export function villageGroundTint(seed: number, dx: number, dy: number, dz: number, out: THREE.Color): number {
  const L = villageLocal(seed, dx, dy, dz, 14);
  if (!L) return 0;
  const { u, w } = L;
  const S = settlementOf(seed, L.v);
  const dc = Math.hypot(u, w);
  const edge = 1 - sm(S.radius - 6, S.radius + 14, dc);
  if (edge <= 0.002) return 0;
  const cl = S.idx.clearance(u, w); // < 0 sulla carreggiata
  const street = 1 - sm(0, 1.8, cl);
  let plaza = 0;
  for (const p of S.plazas) {
    const pu = u - (p.u ?? 0), pw = w - (p.w ?? 0);
    if (p.shape === 'circle') plaza = Math.max(plaza, 1 - sm(p.r - 1, p.r + 0.8, Math.hypot(pu, pw)));
    else plaza = Math.max(plaza, (1 - sm(p.hw - 1, p.hw + 0.8, Math.abs(pu))) * (1 - sm(p.hd - 1, p.hd + 0.8, Math.abs(pw))));
  }
  let pave = 0;
  if (S.pave > 0) {
    pave = S.pave * sm(0.0, 0.5, S.paveAt(u, w));
    for (const p of S.parks) { const k = (1 - sm(p.hw - 1.5, p.hw, Math.abs(u - p.u))) * (1 - sm(p.hd - 1.5, p.hd, Math.abs(w - p.w))); pave *= 1 - k; }
  }
  const pal = PALETTE[S.culture];
  const m = Math.max(street, plaza, pave);
  if (m <= 0.002) return 0;
  // la piazza e' piu' chiara della strada; il selciato ha una trama leggera; l'asfalto delle grandi arterie e' scuro
  out.set(pal.street).lerp(_gc.set(pal.plaza), plaza * 0.9);
  if (street > 0.5 && S.tier >= 2) out.lerp(_gc.set('#6f6d6a'), 0.45);
  else if (pave > street && pave > plaza) out.lerp(_gc.set(pal.plaza), 0.35).multiplyScalar(0.88);
  const tex = 0.94 + 0.12 * (((Math.floor(u * 1.7) * 7 + Math.floor(w * 1.7) * 13) & 7) / 7);
  out.multiplyScalar(tex);
  return m * edge;
}
export function villageGround(seed: number, dx: number, dy: number, dz: number): number {
  return villageGroundTint(seed, dx, dy, dz, _gc);
}

// i campi attorno all'abitato (lavori): rettangoli di colore per cultura tra l'abitato e `fieldSpan` m oltre; 0..1 e il colore in `out`
const _fc = new THREE.Color();
export function villageFieldTint(seed: number, dx: number, dy: number, dz: number, out: THREE.Color): number {
  const L = villageLocal(seed, dx, dy, dz, 200);
  if (!L) return 0;
  const S = settlementOf(seed, L.v);
  const dc = Math.hypot(L.u, L.w);
  const r0 = S.radius, r1 = S.radius + S.fieldSpan;
  if (dc < r0 || dc > r1) return 0;
  const c = S.culture;
  const cols = FIELD_COLORS[c];
  // griglia di parcelle ruotata: dimensione per cultura (risaie piccole, prati grandi)
  const size = c === Culture.Asia ? [11, 17] : c === Culture.Alp ? [34, 46] : c === Culture.Mag ? [16, 22] : [14, 40];
  const ca = Math.cos(S.fieldAngle), sa = Math.sin(S.fieldAngle);
  const pu = L.u * ca + L.w * sa, pw = -L.u * sa + L.w * ca;
  const iu = Math.floor(pu / size[0]), iw = Math.floor(pw / size[1]);
  const h = hashKey(iu * 73856093 ^ iw * 19349663, 3, (seed ^ L.v.id) | 0);
  // non tutte le parcelle sono coltivate; piu' fitte vicino all'abitato
  const fill = 0.9 - sm(r0, r1, dc) * 0.55;
  if (h > fill) return 0;
  out.set(cols[Math.floor(hashKey(iu, iw, seed | 0) * cols.length) % cols.length]);
  // arginelli / bordi: linee piu' scure fra le parcelle (nelle risaie bordi chiari)
  const eu = Math.min(pu - iu * size[0], (iu + 1) * size[0] - pu), ew = Math.min(pw - iw * size[1], (iw + 1) * size[1] - pw);
  const edge = Math.min(eu, ew);
  if (edge < 0.7) out.lerp(_fc.set(c === Culture.Asia ? '#c9c19a' : '#5b5030'), 0.55);
  else if (c === Culture.Med || c === Culture.Mag) out.multiplyScalar(0.92 + 0.12 * (((Math.floor(pw * 0.9)) & 1) ? 1 : 0)); // solchi
  return (1 - sm(r1 - 12, r1, dc)) * sm(r0, r0 + 4, dc) * 0.9;
}

// c'e' un elemento a meno di `margin` m da (u, w)? (per sgombrare erba e simili); si usa una griglia da 8 m degli elementi
const blockGrids = new Map<Settlement, Map<number, number[]>>();
const BCELL = 8;
export function villageBlocked(seed: number, v: VillageSite, u: number, w: number, margin: number): boolean {
  const S = settlementOf(seed, v);
  let g = blockGrids.get(S);
  if (!g) {
    g = new Map();
    S.items.forEach((it, i) => {
      const role = roleOf(it.kind);
      if (role === Role.Lamp || role === Role.Fence || role === Role.Garden || role === Role.Laundry || role === Role.Lantern) return;
      const d: Dim = dimOf(cultureOfKind(it.kind), role);
      const r = Math.hypot(d.w * (it.sx ?? 1), d.d * (it.sz ?? 1)) / 2 * it.s;
      const x0 = Math.floor((it.u - r - 3) / BCELL), x1 = Math.floor((it.u + r + 3) / BCELL), z0 = Math.floor((it.w - r - 3) / BCELL), z1 = Math.floor((it.w + r + 3) / BCELL);
      for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
        const k = (ix + 1024) * 2048 + (iz + 1024);
        const c = g!.get(k);
        if (c) c.push(i);
        else g!.set(k, [i]);
      }
    });
    blockGrids.set(S, g);
  }
  const c = g.get((Math.floor(u / BCELL) + 1024) * 2048 + (Math.floor(w / BCELL) + 1024));
  if (!c) return false;
  for (const i of c) {
    const it = S.items[i];
    const d: Dim = dimOf(cultureOfKind(it.kind), roleOf(it.kind));
    const r = (Math.hypot(d.w * (it.sx ?? 1), d.d * (it.sz ?? 1)) / 2) * it.s + margin;
    if (Math.abs(it.u - u) < r && Math.abs(it.w - w) < r && Math.hypot(it.u - u, it.w - w) < r) return true;
  }
  return false;
}
export { villagesOf, VILLAGE_BLEND };

// (le strade tra gli abitati: lib/roads.ts)
export { roadMask } from './roads';

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
  const add = (kind: number, u: number, w: number, f: number, s = 1) => list!.push({ kind: encodeKind(kind, 0, 0), u, w, f, s, tint: MOSS[Math.floor(rnd() * MOSS.length) % MOSS.length] });
  // pianta rettangolare 16 x 11 con muri a pezzi (con varchi), colonne agli angoli e dentro, un arco all'ingresso, blocchi caduti
  const W = 8, D = 5.5;
  for (let x = -W + 2; x <= W - 2; x += 4) {
    if (rnd() < 0.8) add(Role.RuinWall, x, -D, Math.PI, 0.9 + rnd() * 0.2);
    if (rnd() < 0.55 && Math.abs(x) > 2) add(Role.RuinWall, x, D, 0, 0.9 + rnd() * 0.2);
  }
  for (let z = -D + 2; z <= D - 2; z += 4) {
    if (rnd() < 0.7) add(Role.RuinWall, -W, z, Math.PI / 2, 0.9 + rnd() * 0.2);
    if (rnd() < 0.6) add(Role.RuinWall, W, z, -Math.PI / 2, 0.9 + rnd() * 0.2);
  }
  for (const [x, z] of [[-W, -D], [W, -D], [-W, D], [W, D], [-3, 0], [3.5, -1.5]]) if (rnd() < 0.85) add(Role.RuinColumn, x + (rnd() - 0.5), z + (rnd() - 0.5), rnd() * 6, 0.85 + rnd() * 0.3);
  add(Role.RuinArch, 0, D + 0.4, 0, 1);
  for (let k = 0; k < 7; k++) add(Role.RuinBlock, (rnd() * 2 - 1) * (W + 3), (rnd() * 2 - 1) * (D + 3), rnd() * 6, 0.6 + rnd() * 0.7);
  for (let k = 0; k < 2; k++) add(Role.RuinFallen, (rnd() * 2 - 1) * (W - 1), (rnd() * 2 - 1) * (D - 1), rnd() * 6, 0.8 + rnd() * 0.3);
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

// posizione di un elemento nel riferimento del sito (y = quota del suolo dell'elemento + `up` metri)
export function villageItemSitePos(seed: number, v: VillageSite, it: VillageItem, site: { quat: THREE.Quaternion; hN: number }, up: number, out: THREE.Vector3): THREE.Vector3 {
  const fr = villageFrame(v, seed);
  villageItemPos(it, fr, out);
  out.addScaledVector(_d.copy(out).normalize(), up).applyQuaternion(site.quat);
  out.y -= R + site.hN;
  return out;
}

// --- l'abitato nel riferimento del sito corrente (abitanti, anziani, bussola) ----------------------------------------------
// Il sito e' la sfera ruotata (y = verticale del punto di partenza): un punto locale (u, w) dell'abitato va portato con la
// trasformazione esatta, perche' a mezzo chilometro dal centro la curvatura vale decine di metri.
export interface SiteFrame { v: VillageSite; quat: THREE.Quaternion; hN: number; cx: number; cz: number; ax: number; az: number; bx: number; bz: number; baseY: number; inv: number }
const _sv = new THREE.Vector3(), _sa = new THREE.Vector3(), _sb = new THREE.Vector3(), _sp = new THREE.Vector3();
export function siteFrameOf(v: VillageSite, planetSeed: number): SiteFrame {
  const site = getCurrentSite();
  const fr = villageFrame(v, planetSeed);
  _sv.copy(fr.c).multiplyScalar(R + v.h).applyQuaternion(site.quat);
  _sa.copy(fr.A).applyQuaternion(site.quat);
  _sb.copy(fr.B).applyQuaternion(site.quat);
  const det = _sa.x * _sb.z - _sa.z * _sb.x;
  return { v, quat: site.quat, hN: site.hN, cx: _sv.x, cz: _sv.z, ax: _sa.x, az: _sa.z, bx: _sb.x, bz: _sb.z, baseY: _sv.y - (R + site.hN), inv: 1 / (det || 1) };
}
// (u, w) -> punto del sito sul piano della zolla (x, z esatte; y = quota del piano)
export const toSiteXZ = (f: SiteFrame, u: number, w: number, out: THREE.Vector3): THREE.Vector3 => {
  _sp.copy(_sa.set(f.v.x, f.v.y, f.v.z)).multiplyScalar(R).add(_sb.set(f.v.ax, f.v.ay, f.v.az).multiplyScalar(u)).add(_sa.set(f.v.bx, f.v.by, f.v.bz).multiplyScalar(w));
  _sp.normalize().multiplyScalar(R + planeHeight(f.v, u, w)).applyQuaternion(f.quat);
  return out.set(_sp.x, _sp.y - (R + f.hN), _sp.z);
};
export const fromSiteXZ = (f: SiteFrame, x: number, z: number): [number, number] => {
  let dx = x - f.cx, dz = z - f.cz;
  let u = (dx * f.bz - dz * f.bx) * f.inv, w = (f.ax * dz - f.az * dx) * f.inv;
  // correzione sulla trasformazione esatta (2 passi)
  for (let i = 0; i < 2; i++) {
    toSiteXZ(f, u, w, _sv);
    dx = x - _sv.x; dz = z - _sv.z;
    u += (dx * f.bz - dz * f.bx) * f.inv; w += (f.ax * dz - f.az * dx) * f.inv;
  }
  return [u, w];
};
