import * as THREE from 'three';
import { Culture, PALETTE, Role, cultureOfKind, dimOf, roleOf, variantOf, BRIDGE_BASE, type Dim } from '../../lib/culture';
import { Builder } from './villageBuilder';

// I modelli del villaggio per cultura (docs/stile.md): case, chiese, torri, mura, fontane, bancarelle, alberi... costruiti da
// primitive con le dimensioni di lib/culture.ts (KIT: le stesse dei collider). Le pareti sono bianche (le tinge l'istanza); tetti,
// legno e pietra hanno il colore proprio. `variant` sceglie il colore del tetto e i dettagli (imposte, balconi, cupole).
export const BRIDGE_WIDTH = 4.2;
const WHITE = '#ffffff';
const STONE = '#aaa397', STONE_D = '#8a847a', WOOD = '#6b4a2e', WOOD_D = '#4a3322', IRON = '#2a2a2e';

interface Ctx { b: Builder; cu: number; role: number; variant: number; d: Dim; roof: string; trim: string }
const FLOORS: Record<number, number> = { [Role.HouseS]: 2, [Role.HouseM]: 2, [Role.HouseL]: 2, [Role.RowLow]: 1, [Role.RowMid]: 2, [Role.RowHigh]: 3 };
const SHUTTERS = ['#4d6b4a', '#3e6a8f', '#7a5230', '#b0833a'];

// ---------- mediterranea ----------
function medHouse({ b, role, variant, d, roof }: Ctx) {
  const { w, h, d: dep } = d;
  const f = FLOORS[role] ?? 2;
  const rise = Math.min(2.3, dep * 0.17);
  const wallH = h - rise - 0.1;
  const detached = role <= Role.HouseL;
  b.box(w + 0.12, 0.55, dep + 0.12, 0, 0, 0, '#b9b1a2');
  b.box(w, wallH - 0.55, dep, 0, 0.55, 0, WHITE);
  b.box(w + 0.5, 0.2, dep + 0.5, 0, wallH - 0.2, 0, '#eadfca'); // cornicione
  b.gable(w, dep, rise, 0, wallH, 0, roof, false, 0.3);
  const floorH = (wallH - 0.55 - 0.4) / f;
  const nx = Math.max(1, Math.round(w / 2.7));
  const sh = SHUTTERS[variant % 4];
  for (let i = 0; i < f; i++) {
    const y = 0.55 + i * floorH + floorH * 0.28;
    for (let k = 0; k < nx; k++) {
      const x = ((k + 0.5) / nx - 0.5) * w;
      if (i === 0 && k === 0 && nx > 1) continue; // la porta
      b.win(x, y, dep / 2 + 0.03, 0.85, 1.35, '#e6dccb', 0);
      b.box(0.42, 1.35, 0.08, x - 0.64, y, dep / 2 + 0.05, sh); b.box(0.42, 1.35, 0.08, x + 0.64, y, dep / 2 + 0.05, sh);
      if (i === 1 && variant % 3 === 0) { b.box(1.5, 0.1, 0.7, x, y - 0.1, dep / 2 + 0.4, IRON); b.box(1.5, 0.5, 0.05, x, y, dep / 2 + 0.72, IRON); }
    }
    if (detached) for (const s of [-1, 1]) b.win(s * (w / 2 + 0.03), y, 0, 0.85, 1.3, '#e6dccb', s * Math.PI / 2);
  }
  // portone ad arco
  const dx = nx > 1 ? ((0.5 / nx) - 0.5) * w : 0;
  b.box(1.15, 2.1, 0.16, dx, 0.55, dep / 2 + 0.05, WOOD_D);
  b.cylZ(0.58, 0.16, dx, 2.65, dep / 2 + 0.05, WOOD_D, 12);
  b.box(1.7, 0.2, 0.7, dx, 0, dep / 2 + 0.35, '#c9c1b0');
  const ch = d.chimney;
  if (ch) b.box(0.75, ch[1] - wallH + 0.5, 0.75, ch[0], wallH + 0.2, ch[2], '#c9b8a0');
}
function medTemple({ b, d, roof }: Ctx) {
  const { w, h, d: dep } = d;
  const rise = 3, wallH = h - rise;
  b.box(w + 0.3, 0.7, dep + 0.3, 0, 0, 0, '#c2baa9');
  b.box(w, wallH - 0.7, dep, 0, 0.7, 0, WHITE);
  b.gable(w, dep, rise, 0, wallH, 0, roof, true, 0.5);
  // facciata: portale, rosone, timpano
  b.box(3, 4.6, 0.3, 0, 0.7, dep / 2 + 0.1, '#6b4a2e'); b.cylZ(1.5, 0.3, 0, 5.3, dep / 2 + 0.1, '#6b4a2e', 14);
  b.box(3.6, 0.35, 1.2, 0, 0.7, dep / 2 + 0.6, '#cfc7b6');
  b.cylZ(1.1, 0.12, 0, wallH - 1.6, dep / 2 + 0.06, '#ffffff', 16); // rosone
  b.box(w + 0.5, 0.35, 0.4, 0, wallH - 0.3, dep / 2 + 0.2, '#d8cfbc');
  // finestre alte sui fianchi e contrafforti
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) {
    const z = -dep / 2 + 3 + k * 3.7;
    b.win(s * (w / 2 + 0.03), 4.4, z, 0.9, 2.6, '#cfc7b6', s * Math.PI / 2);
    b.box(0.6, wallH - 0.7, 0.7, s * (w / 2 + 0.15), 0.7, z + 1.8, '#d3cab8');
  }
  // abside
  b.cyl(w * 0.34, w * 0.34, wallH - 0.7, 0, 0.7, -dep / 2 - w * 0.2, WHITE, 10);
  b.cone(w * 0.38, 2.6, 0, wallH, -dep / 2 - w * 0.2, roof, 10);
}
function medTower({ b, d, roof }: Ctx) {
  const { w, h } = d;
  const shaft = h - 6.2;
  b.box(w + 0.5, 1.2, w + 0.5, 0, 0, 0, '#c2baa9');
  b.box(w, shaft, w, 0, 1.2, 0, WHITE);
  for (const s of [-1, 1]) for (const y of [4, 8, 12]) b.win(0, y, s * (w / 2 + 0.03), 0.35, 1.2, null, s > 0 ? 0 : Math.PI);
  b.cylZ(1.0, 0.15, 0, shaft - 1.6, w / 2 + 0.06, '#f4f0e4', 20); // quadrante
  b.box(0.08, 0.7, 0.04, 0, shaft - 1.6, w / 2 + 0.16, '#222');
  b.box(w + 0.6, 0.35, w + 0.6, 0, 1.2 + shaft, 0, '#d8cfbc');
  // cella campanaria con quattro aperture ad arco
  b.box(w - 0.4, 3.2, w - 0.4, 0, 1.55 + shaft, 0, WHITE);
  for (const a of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
    const nx = Math.sin(a), nz = Math.cos(a);
    b.box(1.5, 2.1, 0.12, nx * (w / 2 - 0.15), 1.9 + shaft, nz * (w / 2 - 0.15), '#2b2420', a); b.cylZ(0.75, 0.12, nx * (w / 2 - 0.15), 4.0 + shaft, nz * (w / 2 - 0.15), '#2b2420', 12);
  }
  b.frustum(w + 0.9, w + 0.9, 0, 0, 3.4, 0, 4.75 + shaft, 0, roof);
  b.box(0.12, 1.4, 0.12, 0, 8.1 + shaft, 0, '#c9a227'); b.box(0.6, 0.12, 0.12, 0, 8.7 + shaft, 0, '#c9a227');
}
function medFountain({ b }: Ctx) {
  b.cyl(2.5, 2.7, 0.95, 0, 0, 0, '#cfc6b3', 10);
  b.cyl(2.2, 2.2, 0.06, 0, 0.9, 0, '#6aa9c9', 10);
  b.cyl(0.45, 0.6, 1.6, 0, 0.9, 0, '#d6cdb9', 8);
  b.cyl(1.25, 1.0, 0.35, 0, 2.2, 0, '#d6cdb9', 8);
  b.cyl(0.14, 0.2, 0.9, 0, 2.5, 0, '#d6cdb9', 6);
  b.sphere(0.3, 0, 3.55, 0, '#cfc6b3');
}
// ---------- alpina ----------
function altHouse({ b, role, variant, d, roof }: Ctx) {
  const { w, h, d: dep } = d;
  const rise = Math.min(4.6, w * 0.4);
  const wallH = h - rise;
  const h1 = wallH * 0.5;
  b.box(w + 0.1, h1, dep + 0.1, 0, 0, 0, '#d9d4c9'); // piano terra in pietra (la tinta lo scurisce)
  b.box(w + 0.35, wallH - h1, dep + 0.35, 0, h1, 0, '#8c6a46'); // piano di legno
  for (let y = h1 + 0.5; y < wallH - 0.2; y += 0.7) b.box(w + 0.42, 0.05, dep + 0.42, 0, y, 0, '#5d422a');
  b.gable(w, dep, rise, 0, wallH, 0, roof, true, 1.15);
  // balcone ligneo sul fronte, al piano di legno
  b.box(w + 0.2, 0.14, 1.3, 0, h1 - 0.02, dep / 2 + 0.7, WOOD);
  for (let x = -w / 2 + 0.2; x <= w / 2 - 0.1; x += 0.7) b.box(0.07, 0.95, 0.07, x, h1, dep / 2 + 1.28, '#5d422a');
  b.box(w, 0.07, 0.07, 0, h1 + 0.9, dep / 2 + 1.28, '#5d422a');
  const nx = Math.max(2, Math.round(w / 2.6));
  for (let k = 0; k < nx; k++) {
    const x = ((k + 0.5) / nx - 0.5) * w;
    b.win(x, h1 + 0.5, dep / 2 + 0.2, 0.85, 1.0, '#4a3322', 0);
    b.box(0.95, 0.24, 0.3, x, h1 + 0.1, dep / 2 + 0.38, variant % 2 ? '#b8453a' : '#d86a8a'); // cassetta di fiori
    if (k > 0 || nx < 3) b.win(x, 0.9, dep / 2 + 0.08, 0.8, 0.95, '#4a3322', 0);
  }
  for (const s of [-1, 1]) { b.win(s * (w / 2 + 0.2), h1 + 0.5, 0, 0.8, 1.0, '#4a3322', s * Math.PI / 2); b.win(s * (w / 2 + 0.05), 1.0, 0, 0.8, 0.95, '#4a3322', s * Math.PI / 2); }
  b.box(1.1, 2.1, 0.14, ((0.5 / nx) - 0.5) * w, 0, dep / 2 + 0.07, WOOD_D);
  const ch = d.chimney;
  if (ch) b.box(0.8, 1.6, 0.8, ch[0], wallH + rise * 0.55, ch[2], '#8a8176');
}
function altTemple({ b, d, roof }: Ctx) {
  const { w, h, d: dep } = d;
  const rise = 4.2, wallH = h - rise;
  b.box(w + 0.3, 0.6, dep + 0.3, 0, 0, 0, '#bdb6a8');
  b.box(w, wallH - 0.6, dep, 0, 0.6, 0, WHITE);
  b.gable(w, dep, rise, 0, wallH, 0, roof, true, 0.9);
  b.box(2.4, 3.8, 0.3, 0, 0.6, dep / 2 + 0.1, WOOD_D); b.cylZ(1.2, 0.3, 0, 4.4, dep / 2 + 0.1, WOOD_D, 12);
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) b.win(s * (w / 2 + 0.03), 3.4, -dep / 2 + 3.5 + k * 4.6, 0.8, 2.2, '#5a4a38', s * Math.PI / 2);
  b.win(0, wallH - 1.2, dep / 2 + 0.04, 1.0, 1.4, '#5a4a38', 0);
  b.box(0.5, 1.4, 0.5, 0, wallH + rise * 0.65, -dep * 0.2, '#6b4a2e'); b.cone(0.55, 1.8, 0, wallH + rise * 0.65 + 1.4, -dep * 0.2, '#35504a', 8);
}
function altTower({ b, d }: Ctx) {
  const { w, h } = d;
  const stone = h * 0.5, belfry = 4;
  b.box(w + 0.4, stone, w + 0.4, 0, 0, 0, '#cfc9bc');
  for (const s of [-1, 1]) for (const y of [3.5, 7.5]) b.win(0, y, s * (w / 2 + 0.23), 0.4, 1.3, null, s > 0 ? 0 : Math.PI);
  b.box(w + 0.1, belfry, w + 0.1, 0, stone, 0, '#8c6a46');
  for (const a of [0, Math.PI / 2]) { b.box(1.4, 2.2, 0.1, 0, stone + 0.8, 0, '#2b2420', a); b.box(1.4, 2.2, w + 0.2, 0, stone + 0.8, 0, '#2b2420', a + 0); }
  b.cone(w * 0.62, h - stone - belfry + 1.4, 0, stone + belfry, 0, '#3f5f58', 8);
  b.sphere(0.28, 0, h + 0.6, 0, '#c9a227'); b.box(0.1, 1.2, 0.1, 0, h + 0.6, 0, '#c9a227');
  b.cylZ(0.9, 0.12, 0, stone - 1.5, (w + 0.4) / 2 + 0.06, '#f4f0e4', 18);
}
function altFountain({ b }: Ctx) {
  b.box(2.6, 0.9, 1.3, 0, 0, 0, '#9d968a'); b.box(2.4, 0.05, 1.1, 0, 0.86, 0, '#6aa9c9');
  b.box(0.35, 2.2, 0.35, 0, 0, -0.3, '#7a5a3a'); b.cyl(0.07, 0.07, 0.7, 0, 1.55, 0.08, '#4a3322', 6);
}
// ---------- maghrebina ----------
function magHouse({ b, role, variant, d }: Ctx) {
  const { w, h, d: dep } = d;
  const f = FLOORS[role] ?? 2;
  const court = role === Role.HouseL;
  if (court) {
    // casa a cortile: quattro corpi attorno a un patio con una palma, il portale ad arco sul fronte
    const t = 2.6;
    b.box(w, h, t, 0, 0, dep / 2 - t / 2, WHITE); b.box(w, h - 1, t, 0, 0, -dep / 2 + t / 2, WHITE);
    b.box(t, h - 0.5, dep - 2 * t, -w / 2 + t / 2, 0, 0, WHITE); b.box(t, h - 0.5, dep - 2 * t, w / 2 - t / 2, 0, 0, WHITE);
    b.box(w - 2 * t, 0.15, dep - 2 * t, 0, 0, 0, '#d8c39c');
    for (const s of [-1, 1]) for (let k = -1; k <= 1; k++) b.cyl(0.18, 0.2, 2.6, s * (w / 2 - t - 0.2), 0, k * 2.4, '#efe6d2', 8);
    b.cyl(0.18, 0.25, 4.2, 0, 0, 0, '#7a5a3a', 6);
    for (let a = 0; a < 6; a++) b.box(2.4, 0.05, 0.3, Math.cos(a) * 1.1, 4.1, Math.sin(a) * 1.1, '#3f7a3a', -a);
    b.box(1.5, 2.9, 0.16, 0, 0, dep / 2 + 0.06, '#5b3a22'); b.cylZ(0.75, 0.16, 0, 2.9, dep / 2 + 0.06, '#2f6fa3', 14);
    b.box(w, 0.5, 0.4, 0, h, dep / 2 - 0.2, '#efe6d2');
    for (let x = -w / 2 + 0.6; x < w / 2; x += 1.8) b.box(0.9, 0.55, 0.4, x, h + 0.5, dep / 2 - 0.2, '#efe6d2');
    if (variant % 3 === 0) { b.cyl(1.4, 1.5, 0.9, w / 2 - 3.5, h, -dep / 2 + 3, '#efe6d2', 12); b.dome(1.6, w / 2 - 3.5, h + 0.9, -dep / 2 + 3, '#9fb7a8', 0.9); }
    return;
  }
  b.box(w, h, dep, 0, 0, 0, WHITE);
  b.box(w + 0.2, 0.18, dep + 0.2, 0, h - 0.1, 0, '#efe6d2'); // cornice
  // parapetto con merli bassi
  b.box(w, 0.55, 0.28, 0, h, dep / 2 - 0.14, WHITE); b.box(w, 0.55, 0.28, 0, h, -dep / 2 + 0.14, WHITE);
  b.box(0.28, 0.55, dep, -w / 2 + 0.14, h, 0, WHITE); b.box(0.28, 0.55, dep, w / 2 - 0.14, h, 0, WHITE);
  // portale ad arco e finestre piccole; il piano alto ha un balcone chiuso con grata (mashrabiya)
  const dx = -w * 0.18;
  b.box(1.2, 2.2, 0.18, dx, 0, dep / 2 + 0.04, '#5b3a22'); b.cylZ(0.6, 0.18, dx, 2.2, dep / 2 + 0.04, '#5b3a22', 14);
  b.box(1.55, 0.2, 0.5, dx, 0, dep / 2 + 0.25, '#d8c39c');
  b.box(1.7, 0.18, 0.2, dx, 3.0, dep / 2 + 0.1, '#2f6fa3');
  const floorH = h / f;
  for (let i = 0; i < f; i++) {
    const y = i * floorH + floorH * 0.38;
    if (i === 0) { b.win(w * 0.2, y + 0.2, dep / 2 + 0.04, 0.5, 0.85, '#2f6fa3', 0); continue; }
    if (i === 1) {
      // sporto con grata
      b.box(2.2, floorH * 0.55, 0.9, -w * 0.12, y - 0.1, dep / 2 + 0.45, '#8a6a46');
      for (let k = 0; k < 6; k++) { b.box(0.05, floorH * 0.5, 0.05, -w * 0.12 - 0.9 + k * 0.36, y - 0.05, dep / 2 + 0.92, '#4a3322'); }
      b.win(-w * 0.12, y + 0.05, dep / 2 + 0.88, 1.3, 0.8, null, 0);
      b.win(w * 0.26, y + 0.1, dep / 2 + 0.04, 0.45, 0.8, '#2f6fa3', 0);
    } else b.win(0, y, dep / 2 + 0.04, 0.45, 0.75, '#2f6fa3', 0);
  }
  for (const s of [-1, 1]) b.win(s * (w / 2 + 0.03), floorH * 0.9, 0, 0.45, 0.75, '#2f6fa3', s * Math.PI / 2);
  // dettagli di cultura: torre del vento, cupola o scala sul tetto
  if (variant % 4 === 1 && f >= 2) { b.box(1.5, 2.6, 1.5, w / 4, h + 0.5, -dep / 4, WHITE); for (const s of [-1, 1]) b.box(0.4, 1.2, 0.05, w / 4 + 0, h + 1.7, -dep / 4 + s * 0.78, '#2b2420'); b.box(1.7, 0.2, 1.7, w / 4, h + 3.1, -dep / 4, '#efe6d2'); }
  if (variant % 4 === 2) { b.box(1.6, 1.3, 1.6, -w / 4, h + 0.5, dep / 4, WHITE); b.box(0.9, 0.12, 0.05, -w / 4, h + 1.0, dep / 4 + 0.82, '#2b2420'); }
}
function magTemple({ b, d }: Ctx) {
  const { w, h, d: dep } = d;
  const wallH = 6.2;
  b.box(w + 0.4, 0.5, dep + 0.4, 0, 0, 0, '#d8c39c');
  b.box(w, wallH - 0.5, dep, 0, 0.5, 0, WHITE);
  b.box(w + 0.3, 0.4, dep + 0.3, 0, wallH - 0.3, 0, '#efe6d2');
  for (let x = -w / 2 + 0.6; x < w / 2; x += 1.6) { b.box(0.8, 0.7, 0.4, x, wallH + 0.1, dep / 2 - 0.2, '#efe6d2'); b.box(0.8, 0.7, 0.4, x, wallH + 0.1, -dep / 2 + 0.2, '#efe6d2'); }
  // portale con arco a ferro di cavallo e finestre ad arco
  b.box(2.6, 4.2, 0.2, 0, 0.5, dep / 2 + 0.06, '#2f4f7a'); b.cylZ(1.3, 0.2, 0, 4.7, dep / 2 + 0.06, '#2f4f7a', 16);
  b.box(3.4, 0.25, 1.0, 0, 0.5, dep / 2 + 0.5, '#d8c39c');
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) { b.win(s * (w / 2 + 0.03), 3.0, -dep / 2 + 3 + k * 4.5, 0.8, 2.2, '#2f6fa3', s * Math.PI / 2); }
  for (const s of [-1, 1]) b.win(s * 4.2, 3.0, dep / 2 + 0.04, 0.9, 2.2, '#2f6fa3', 0);
  // cupola centrale sul tamburo e quattro cupolette
  b.cyl(3.2, 3.4, 1.8, 0, wallH, 0, WHITE, 16);
  for (let a = 0; a < 8; a++) b.win(Math.sin(a * 0.785) * 3.25, wallH + 0.5, Math.cos(a * 0.785) * 3.25, 0.5, 0.9, null, a * 0.785);
  b.dome(3.7, 0, wallH + 1.8, 0, '#8fb3a4', 0.95, 18);
  b.sphere(0.25, 0, wallH + 5.6, 0, '#c9a227'); b.box(0.08, 1.2, 0.08, 0, wallH + 5.6, 0, '#c9a227');
  for (const [x, z] of [[-w / 2 + 1.4, -dep / 2 + 1.4], [w / 2 - 1.4, -dep / 2 + 1.4], [-w / 2 + 1.4, dep / 2 - 1.4], [w / 2 - 1.4, dep / 2 - 1.4]]) b.dome(1.5, x, wallH + 0.15, z, '#9fb7a8', 0.9);
}
function magTower({ b, d }: Ctx) {
  const { w, h } = d;
  b.box(w + 0.3, 8.5, w + 0.3, 0, 0, 0, WHITE);
  for (const y of [2.5, 5.5]) for (const s of [-1, 1]) { b.win(0, y, s * (w / 2 + 0.19), 0.4, 1.2, null, s > 0 ? 0 : Math.PI); b.win(s * (w / 2 + 0.19), y, 0, 0.4, 1.2, null, s * Math.PI / 2); }
  b.box(w + 0.8, 0.4, w + 0.8, 0, 8.5, 0, '#2f6fa3');
  b.cyl(1.9, 2.1, 9, 0, 8.9, 0, '#f1e8d3', 8);
  b.cyl(2.6, 2.6, 0.3, 0, 14.5, 0, '#d8c39c', 8); b.cyl(2.3, 2.5, 0.8, 0, 14.8, 0, '#efe6d2', 8);
  b.cyl(1.35, 1.6, 5, 0, 15.6, 0, '#f1e8d3', 8);
  b.cyl(1.9, 1.9, 0.3, 0, 20.4, 0, '#2f6fa3', 8);
  b.cone(1.5, 4, 0, 20.7, 0, '#3f8a7a', 8);
  b.sphere(0.3, 0, 25, 0, '#c9a227'); b.box(0.5, 0.5, 0.08, 0.2, 25.6, 0, '#c9a227');
}
function magFountain({ b }: Ctx) {
  b.cyl(2.2, 2.3, 0.9, 0, 0, 0, '#d8c39c', 6); b.cyl(1.9, 1.9, 0.06, 0, 0.85, 0, '#6aa9c9', 6);
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; b.cyl(0.14, 0.16, 2.2, Math.cos(a) * 1.9, 0.9, Math.sin(a) * 1.9, '#efe6d2', 8); }
  b.cyl(2.1, 2.1, 0.25, 0, 3.1, 0, '#efe6d2', 6); b.dome(2.0, 0, 3.35, 0, '#8fb3a4', 0.7, 12);
  b.cyl(0.2, 0.3, 0.9, 0, 0.9, 0, '#d8c39c', 8);
}
// ---------- asiatica ----------
function irimoya(b: Builder, w: number, d: number, y0: number, roof: string, o = 1.2, h1 = 1.1, h2 = 1.5) {
  const wb = w + o * 2, db = d + o * 2;
  b.frustum(wb, db, w * 0.58 + 0.4, d * 0.5, h1, 0, y0, 0, roof);
  b.frustum(w * 0.58 + 0.4, d * 0.5 + 0.2, w * 0.58, 0, h2, 0, y0 + h1, 0, roof);
  // gronde che si sollevano agli angoli
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.8, 0.25, 0.8, sx * (wb / 2 - 0.3), y0 + 0.25, sz * (db / 2 - 0.3), roof, sx * sz * 0.5);
  b.box(w * 0.58 + 0.9, 0.24, 0.3, 0, y0 + h1 + h2 - 0.05, 0, '#2c3034');
}
function asiaHouse({ b, role, variant, d, roof }: Ctx) {
  const { w, h, d: dep } = d;
  const f = FLOORS[role] ?? 2;
  const wallH = h - 2.7;
  b.box(w + 0.2, 0.6, dep + 0.2, 0, 0, 0, '#b0aaa0'); // basamento in pietra
  b.box(w, wallH - 0.6, dep, 0, 0.6, 0, WHITE);
  // intelaiatura di legno scuro: pilastri, travi ai piani
  const post = '#3b2a1e';
  for (let x = -w / 2; x <= w / 2 + 0.01; x += w / Math.max(2, Math.round(w / 2.2))) { b.box(0.18, wallH - 0.6, 0.16, x, 0.6, dep / 2 + 0.05, post); b.box(0.18, wallH - 0.6, 0.16, x, 0.6, -dep / 2 - 0.05, post); }
  const floorH = (wallH - 0.6) / f;
  for (let i = 0; i <= f; i++) b.box(w + 0.1, 0.16, dep + 0.1, 0, 0.6 + i * floorH - 0.08, 0, post);
  const nx = Math.max(1, Math.round(w / 2.4));
  for (let i = 0; i < f; i++) {
    const y = 0.6 + i * floorH + floorH * 0.22;
    for (let k = 0; k < nx; k++) {
      const x = ((k + 0.5) / nx - 0.5) * w;
      if (i === 0 && k === nx - 1 && role <= Role.HouseL) continue;
      b.win(x, y, dep / 2 + 0.1, 1.1, floorH * 0.6, post, 0); // shoji: pannelli di carta
      for (let g = -1; g <= 1; g += 1) b.box(0.03, floorH * 0.6, 0.04, x + g * 0.27, y, dep / 2 + 0.16, post);
    }
    if (role <= Role.HouseL) for (const s of [-1, 1]) b.win(s * (w / 2 + 0.05), y, 0, 1.1, floorH * 0.55, post, s * Math.PI / 2);
  }
  // porta scorrevole e piccola veranda (engawa) con pilastrini
  b.box(1.5, 2.1, 0.12, (w / 2) * 0.55, 0.6, dep / 2 + 0.1, '#6b4a2e');
  b.box(w, 0.2, 1.3, 0, 0.5, dep / 2 + 0.75, '#8a6a46');
  for (let x = -w / 2 + 0.3; x <= w / 2; x += w / 3) b.box(0.14, 2.5, 0.14, x, 0.6, dep / 2 + 1.35, post);
  irimoya(b, w, dep, wallH, roof, 1.4, 1.1, f === 1 ? 1.1 : 1.5);
}
function asiaTemple({ b, d, roof }: Ctx) {
  const { w, h, d: dep } = d;
  b.box(w + 2, 1.2, dep + 2, 0, 0, 0, '#a8a398'); // piattaforma di pietra
  b.box(w + 1.2, 0.2, 2.4, 0, 0, dep / 2 + 1.7, '#a8a398'); b.box(w * 0.5, 0.3, 1.5, 0, 0.1, dep / 2 + 1.5, '#9b968b');
  const wallH = 4.8;
  b.box(w - 1.4, wallH, dep - 1.4, 0, 1.2, 0, WHITE);
  for (let x = -w / 2 + 0.4; x <= w / 2 - 0.3; x += (w - 0.8) / 4) { b.cyl(0.26, 0.28, wallH + 0.2, x, 1.2, dep / 2 - 0.4, '#b8312f', 10); b.cyl(0.26, 0.28, wallH + 0.2, x, 1.2, -dep / 2 + 0.4, '#b8312f', 10); }
  b.box(w - 2.6, 3.3, 0.14, 0, 1.3, dep / 2 - 0.45, '#6b3f2a');
  b.box(w + 0.4, 0.4, dep + 0.4, 0, 1.2 + wallH - 0.2, 0, '#b8312f');
  irimoya(b, w - 0.6, dep - 0.6, 1.2 + wallH + 0.2, roof, 2.2, 1.4, 1.8);
  for (const x of [-1.2, 1.2]) b.win(x, 2.2, dep / 2 - 0.4, 0.9, 1.6, '#b8312f', 0);
}
function asiaTower({ b, d, roof }: Ctx) {
  const { w, h } = d;
  b.box(w + 1.4, 0.9, w + 1.4, 0, 0, 0, '#a8a398');
  let y = 0.9, ww = w - 1.2;
  for (let tier = 0; tier < 3; tier++) {
    const th = 3.3;
    b.box(ww, th, ww, 0, y, 0, WHITE);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.2, 0.22, th, sx * ww / 2, y, sz * ww / 2, '#b8312f', 8);
    b.win(0, y + 1.3, ww / 2 + 0.04, 0.9, 1.3, '#3b2a1e', 0); b.win(ww / 2 + 0.04, y + 1.3, 0, 0.9, 1.3, '#3b2a1e', Math.PI / 2);
    b.box(ww + 0.3, 0.3, ww + 0.3, 0, y + th, 0, '#b8312f');
    b.frustum(ww + 3.4, ww + 3.4, ww * 0.35, ww * 0.35, 1.4, 0, y + th + 0.3, 0, roof);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.9, 0.3, 0.9, sx * (ww + 2.9) / 2, y + th + 0.4, sz * (ww + 2.9) / 2, roof, sx * sz * 0.6);
    y += th + 1.5;
    ww -= 1.5;
  }
  b.cyl(0.12, 0.14, 4.4, 0, y, 0, '#b8312f', 8);
  for (let k = 0; k < 5; k++) b.cyl(0.55 - k * 0.06, 0.55 - k * 0.06, 0.1, 0, y + 0.5 + k * 0.6, 0, '#c9a227', 10);
  b.sphere(0.3, 0, y + 4.5, 0, '#c9a227');
}
function asiaFountain({ b }: Ctx) {
  b.cyl(1.5, 1.6, 0.8, 0, 0, 0, '#8e8a80', 8); b.cyl(1.2, 1.2, 0.05, 0, 0.78, 0, '#5d94ad', 8);
  b.box(0.25, 1.4, 0.25, 0, 0.8, 0, '#7a5a3a'); b.cylX(0.07, 0.9, 0.35, 1.9, 0, '#6a8a45', 6);
}
function asiaLantern({ b }: Ctx) {
  b.box(0.5, 0.2, 0.5, 0, 0, 0, '#9b968b'); b.cyl(0.1, 0.12, 0.5, 0, 0.2, 0, '#9b968b', 8);
  b.box(0.45, 0.4, 0.45, 0, 0.7, 0, '#ffffff', 0, true); b.box(0.5, 0.06, 0.5, 0, 0.7, 0, '#9b968b'); b.box(0.5, 0.06, 0.5, 0, 1.1, 0, '#9b968b');
  b.frustum(0.85, 0.85, 0.1, 0.1, 0.35, 0, 1.16, 0, '#9b968b'); b.sphere(0.09, 0, 1.55, 0, '#9b968b');
}
// ---------- elementi comuni e per cultura ----------
function stall({ b, cu, variant }: Ctx) {
  b.box(2.6, 0.9, 1.2, 0, 0, 0, WOOD);
  const stripe = [['#c8372d', '#f2eee6'], ['#2f6fa3', '#f2eee6'], ['#d9a441', '#f2eee6'], ['#4d6b4a', '#f2eee6']][variant % 4];
  for (const x of [-1.3, 1.3]) b.box(0.12, cu === Culture.Mag ? 2.8 : 2.6, 0.12, x, 0, -0.5, WOOD);
  if (cu === Culture.Asia) { b.frustum(3.2, 2.4, 2.4, 1.6, 0.6, 0, 2.5, 0, '#50555a'); for (let k = 0; k < 4; k++) b.box(0.5, 0.9, 0.04, -0.9 + k * 0.6, 1.5, 0.95, k % 2 ? '#2f4f7a' : '#f2eee6'); }
  else for (let i = 0; i < 6; i++) b.box(0.45, 0.1, 1.9, -1.15 + i * 0.46, 2.5, 0.12, i % 2 ? stripe[1] : stripe[0]);
  b.box(2.3, 0.4, 0.6, 0, 0.9, 0, ['#d9a441', '#c8372d', '#6aa04a', '#e8d9c0'][variant % 4]); // merce
  b.sphere(0.2, -0.6, 1.4, 0.1, '#c8372d'); b.sphere(0.2, 0.2, 1.4, 0, '#d9a441');
}
function lamp({ b, cu }: Ctx) {
  b.cyl(0.07, 0.11, cu === Culture.Mag ? 3.0 : 3.9, 0, 0, 0, cu === Culture.Alp ? WOOD : IRON, 6);
  const y = cu === Culture.Mag ? 3.0 : 3.9;
  b.box(0.4, 0.5, 0.4, 0, y, 0, '#ffffff', 0, true); b.box(0.55, 0.1, 0.55, 0, y + 0.5, 0, cu === Culture.Alp ? WOOD_D : IRON); b.box(0.5, 0.08, 0.5, 0, y - 0.08, 0, cu === Culture.Alp ? WOOD_D : IRON);
}
function fence({ b, cu }: Ctx) {
  if (cu === Culture.Med || cu === Culture.Mag) { b.box(4, 1.0, 0.45, 0, 0, 0, cu === Culture.Mag ? '#e2cfa8' : '#bbb3a3'); b.box(4.1, 0.14, 0.6, 0, 1.0, 0, cu === Culture.Mag ? '#d8c39c' : '#a8a095'); return; }
  const post = cu === Culture.Asia ? '#8a6a46' : '#5d422a';
  for (const x of [-2, 0, 2]) b.box(0.14, 1.1, 0.14, x, 0, 0, post);
  b.box(4, 0.1, 0.07, 0, 0.85, 0, post); b.box(4, 0.1, 0.07, 0, 0.45, 0, post);
  if (cu === Culture.Asia) for (let x = -1.75; x <= 1.75; x += 0.5) b.box(0.07, 1.0, 0.04, x, 0, 0.04, '#b9a36a');
}
function wall({ b, cu }: Ctx) {
  if (cu === Culture.Med) {
    b.box(6, 4.0, 1.1, 0, 0, 0, WHITE); b.box(6.1, 0.3, 1.3, 0, 4.0, 0, '#d8cfbc');
    for (let x = -2.5; x <= 2.5; x += 1.7) b.box(0.9, 0.7, 1.0, x, 4.3, 0, WHITE);
    b.box(0.3, 0.9, 0.05, -1.8, 2.4, 0.57, '#2b2420'); b.box(0.3, 0.9, 0.05, 1.7, 2.4, 0.57, '#2b2420');
  } else if (cu === Culture.Alp) {
    for (let k = 0; k < 5; k++) b.box(1.2 + (k % 2) * 0.1, 0.5 + (k % 3) * 0.1, 0.8, -2.4 + k * 1.2, 0, 0, k % 2 ? '#a39d92' : '#8f897e');
    for (let k = 0; k < 4; k++) b.box(1.2, 0.35, 0.75, -1.8 + k * 1.2, 0.55, 0, k % 2 ? '#8f897e' : '#a39d92');
  } else if (cu === Culture.Mag) {
    b.box(6, 5.4, 1.3, 0, 0, 0, WHITE); b.box(6.1, 0.3, 1.5, 0, 5.4, 0, '#efe6d2');
    for (let x = -2.4; x <= 2.4; x += 1.2) b.box(0.7, 0.8, 1.2, x, 5.7, 0, WHITE);
    for (let y = 1.2; y < 5; y += 1.3) b.box(6.05, 0.06, 1.35, 0, y, 0, '#d8c39c');
  } else {
    b.box(6, 1.5, 0.7, 0, 0, 0, WHITE); b.frustum(6.4, 1.2, 6.2, 0.6, 0.45, 0, 1.5, 0, '#50555a');
    for (let x = -2.5; x <= 2.5; x += 2.5) b.box(0.16, 1.5, 0.16, x, 0, 0.38, '#3b2a1e');
  }
}
function gate({ b, cu, roof }: Ctx) {
  if (cu === Culture.Asia) {
    // torii: due travi, la superiore con le estremita' rialzate
    b.box(5.8, 0.38, 0.5, 0, 5.3, 0, '#2c3034'); b.box(6.8, 0.3, 0.4, 0, 5.62, 0, '#b8312f'); b.box(0.9, 0.3, 0.4, -3.6, 5.8, 0, '#b8312f', 0); b.box(0.9, 0.3, 0.4, 3.6, 5.8, 0, '#b8312f');
    b.box(5.2, 0.28, 0.3, 0, 4.3, 0, '#b8312f');
  } else if (cu === Culture.Alp) {
    b.frustum(5.6, 2.4, 5.6, 0, 1.1, 0, 3.3, 0, roof, 0); b.box(5, 0.2, 1, 0, 3.1, 0, WOOD);
  } else {
    // arco della porta tra le due torri
    b.box(7.2, 1.7, 2.8, 0, 5.3, 0, WHITE); b.cylZ(2.3, 2.8, 0, 5.3, 0, WHITE, 18);
    b.box(7.4, 0.35, 3.0, 0, 7.0, 0, cu === Culture.Mag ? '#efe6d2' : '#d8cfbc');
    for (let x = -3.2; x <= 3.2; x += 1.6) b.box(0.9, 0.7, 2.7, x, 7.35, 0, WHITE);
    if (cu === Culture.Mag) b.box(7.2, 0.3, 3.0, 0, 4.9, 0, '#2f6fa3');
  }
}
function pillar({ b, cu }: Ctx) {
  if (cu === Culture.Asia) { b.cyl(0.32, 0.38, 6, 0, 0, 0, '#b8312f', 10); b.cyl(0.5, 0.5, 0.35, 0, 0, 0, '#2c3034', 10); return; }
  if (cu === Culture.Alp) { b.box(0.5, 3, 0.5, 0, 0, 0, WOOD); b.box(0.7, 0.18, 0.7, 0, 3, 0, WOOD_D); return; }
  const { w, h } = { w: cu === Culture.Mag ? 2.6 : 2, h: cu === Culture.Mag ? 9 : 7 };
  b.box(w, h, w, 0, 0, 0, WHITE); b.box(w + 0.4, 0.4, w + 0.4, 0, h, 0, '#efe6d2');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.55, 0.7, 0.55, sx * (w / 2 - 0.1), h + 0.4, sz * (w / 2 - 0.1), WHITE);
  for (const y of [h * 0.35, h * 0.65]) for (const s of [-1, 1]) b.box(0.18, 0.9, 0.05, 0, y, s * (w / 2 + 0.03), '#2b2420');
}
function granary({ b, cu, roof }: Ctx) {
  const dd = dimOf(cu, Role.Granary);
  if (cu === Culture.Alp) {
    const { w, d } = dd;
    for (const x of [-w / 2 + 0.6, 0, w / 2 - 0.6]) for (const z of [-d / 2 + 0.6, d / 2 - 0.6]) { b.cyl(0.28, 0.32, 1.7, x, 0, z, '#8a8176', 8); b.cyl(0.5, 0.5, 0.12, x, 1.6, z, '#7a736a', 8); }
    b.box(w, 3.6, d, 0, 1.75, 0, '#8c6a46'); for (let x = -w / 2 + 0.6; x < w / 2; x += 0.9) b.box(0.06, 3.5, d + 0.04, x, 1.78, 0, '#5d422a');
    b.gable(w, d, 3.2, 0, 5.35, 0, roof, true, 1.0);
    b.box(1.6, 2.4, 0.12, 0, 1.75, d / 2 + 0.04, WOOD_D);
    b.box(1.0, 0.1, 3, 0, 0.5, d / 2 + 1.5, WOOD, 0); // rampa
  } else if (cu === Culture.Mag) {
    for (const [x, z, r, h] of [[-2, 0, 2.4, 4], [2.4, 1.2, 1.8, 3.2], [1.2, -2.2, 1.5, 2.6]]) { b.cyl(r, r + 0.1, h, x, 0, z, WHITE, 12); b.dome(r + 0.1, x, h, z, '#cdb48a', 0.7, 12); b.box(0.7, 0.9, 0.1, x, 0.8, z + r + 0.04, '#5b3a22'); }
  } else if (cu === Culture.Asia) {
    const { w, d } = dd;
    b.box(w, 3.4, d, 0, 0.6, 0, WHITE); b.box(w + 0.2, 0.6, d + 0.2, 0, 0, 0, '#a8a398');
    b.frustum(w + 2, d + 2, w * 0.6, 0, 2.2, 0, 4, 0, '#2c3034'); b.box(1.8, 2.5, 0.16, 0, 0.6, d / 2 + 0.05, '#2c3034');
    b.win(w * 0.27, 2.4, d / 2 + 0.04, 0.7, 0.55, '#2c3034', 0); b.win(-w * 0.27, 2.4, d / 2 + 0.04, 0.7, 0.55, '#2c3034', 0);
  } else {
    const { w, d, h } = dd;
    b.box(w, h - 2.3, d, 0, 0, 0, '#d6cdb8'); b.gable(w, d, 2.3, 0, h - 2.3, 0, roof, false, 0.4);
    b.box(2.6, 3.2, 0.16, 0, 0, d / 2 + 0.05, WOOD_D); b.cylZ(1.3, 0.16, 0, 3.2, d / 2 + 0.05, WOOD_D, 14);
  }
}
function stack({ b, variant }: Ctx) {
  const c1 = ['#e5c35a', '#d9b24a', '#cfa844'][variant % 3];
  b.cyl(1.3, 1.5, 2.1, 0, 0, 0, c1, 12); b.cone(1.35, 1.4, 0, 2.1, 0, '#d2a940', 12);
}
function archway({ b, cu }: Ctx) {
  const t = cu === Culture.Mag ? '#efe6d2' : '#d8cfbc';
  const { w, h } = dimOf(cu, Role.Archway);
  b.box(w, h - 4.2, 1.4, 0, 4.2, 0, WHITE); b.box(w + 0.3, 0.3, 1.6, 0, h, 0, t);
  b.cylZ(w / 2, 1.4, 0, 4.2, 0, WHITE, 16);
}
function ruinsMisc(b: Builder, role: number) {
  const RS = '#b9b4a6', RD = '#8f8a7c';
  if (role === Role.RuinWall) { b.box(4, 1.4, 0.7, 0, 0, 0, RS); b.box(1.5, 0.9, 0.7, -1.2, 1.4, 0, RD); b.box(1.0, 0.5, 0.7, 0.4, 1.4, 0, RS); b.box(0.9, 1.2, 0.7, 1.5, 1.4, 0, RD); b.box(4.2, 0.2, 0.9, 0, -0.1, 0, RD); }
  else if (role === Role.RuinColumn) { b.box(1.1, 0.35, 1.1, 0, 0, 0, RD); b.cyl(0.42, 0.48, 2.3, 0, 0.35, 0, RS, 8); b.cyl(0.4, 0.42, 0.5, 0, 2.65, 0, RD, 8); b.box(0.7, 0.18, 0.5, 0.1, 3.1, 0, RS, 0.4); }
  else if (role === Role.RuinBlock) { b.box(1.4, 0.9, 1.4, 0, 0, 0, RS, 0.2); b.box(0.7, 0.4, 0.8, 0.5, 0.9, 0.1, RD, 0.7); }
  else if (role === Role.RuinArch) { for (const x of [-2.1, 2.1]) { b.box(1.1, 0.35, 1.1, x, 0, 0, RD); b.cyl(0.42, 0.46, 3.6, x, 0.35, 0, RS, 8); } b.box(5.4, 0.7, 1.0, 0, 3.95, 0, RS); b.box(1.0, 0.9, 1.0, 0, 4.65, 0, RD); }
  else if (role === Role.RuinFallen) { b.cylZ(0.42, 4, 0, 0.42, 0, RS); b.cylZ(0.4, 1.3, 0.1, 0.4, 2.8, RD); }
}
// alberi stilizzati per cultura: A = l'albero alto e caratteristico, B = quello da frutto / piu' basso
function tree({ b, cu, role, variant }: Ctx) {
  const A = role === Role.TreeA;
  if (cu === Culture.Med) {
    if (A) { b.cyl(0.12, 0.2, 1.4, 0, 0, 0, '#4a3a2a', 6); b.cone(1.0, 9.5, 0, 1.0, 0, '#2f4f33', 8); b.cone(0.75, 3.5, 0, 8, 0, '#3a5f3c', 8); }
    else { b.cyl(0.22, 0.34, 1.6, 0, 0, 0, '#5a4636', 6); b.box(0.1, 1.0, 0.1, 0.25, 1.2, 0, '#5a4636', 0.5); b.sphere(1.7, 0, 2.7, 0, '#7f8f63', 0.7, 8); b.sphere(1.2, 0.9, 2.3, 0.4, '#8ea06f', 0.7, 6); }
  } else if (cu === Culture.Alp) {
    if (A) { b.cyl(0.18, 0.28, 1.5, 0, 0, 0, '#4a3322', 6); for (let k = 0; k < 4; k++) b.cone(2.3 - k * 0.5, 3.2, 0, 1.2 + k * 2.2, 0, k % 2 ? '#2d4a38' : '#365a43', 8); }
    else { b.cyl(0.18, 0.26, 1.5, 0, 0, 0, '#5a4636', 6); b.sphere(1.9, 0, 3.0, 0, variant % 2 ? '#6e9a52' : '#7aa85a', 0.85, 8); for (let k = 0; k < 5; k++) b.sphere(0.12, Math.cos(k * 1.3) * 1.5, 2.6 + (k % 2) * 0.6, Math.sin(k * 1.3) * 1.5, '#c8372d', 1, 4); }
  } else if (cu === Culture.Mag) {
    if (A) { b.cyl(0.2, 0.3, 11.5, 0, 0, 0, '#7a5a3a', 7); for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; b.box(2.6, 0.08, 0.5, Math.cos(a) * 1.2, 11.2 - (k % 2) * 0.5, Math.sin(a) * 1.2, '#3f7a3a', -a); } for (let k = 0; k < 3; k++) b.sphere(0.25, (k - 1) * 0.35, 10.9, 0.2, '#c9a35c', 1, 5); }
    else { b.cyl(0.16, 0.24, 1.2, 0, 0, 0, '#5a4636', 6); b.sphere(1.4, 0, 2.2, 0, '#4a7a3a', 0.8, 8); for (let k = 0; k < 4; k++) b.sphere(0.16, Math.cos(k * 1.6) * 1.1, 2.0 + (k % 2) * 0.5, Math.sin(k * 1.6) * 1.1, '#e0902a', 1, 4); }
  } else {
    if (A) { b.cyl(0.2, 0.32, 5.5, 0.2, 0, 0, '#5a4634', 7); for (let k = 0; k < 4; k++) { b.sphere(1.9 - k * 0.3, (k % 2 ? 0.6 : -0.5) + 0.2, 2.6 + k * 1.1, 0, '#3f6a3d', 0.35, 8); } }
    else { b.cyl(0.14, 0.22, 2.2, 0, 0, 0, '#4a3a2a', 6); b.sphere(1.9, 0, 3.2, 0, variant % 3 === 0 ? '#e7a2b6' : variant % 3 === 1 ? '#c85a3a' : '#79a05a', 0.8, 8); b.sphere(1.2, 1.1, 2.7, 0.4, variant % 3 === 0 ? '#f0b8c8' : '#d8744a', 0.8, 6); }
  }
}
function cart({ b }: Ctx) {
  b.box(1.4, 0.15, 2.6, 0, 0.55, 0, WOOD);
  for (const x of [-0.8, 0.8]) { b.box(0.12, 0.5, 2.6, x, 0.6, 0, WOOD_D); b.cyl(0.55, 0.55, 0.12, x, 0, -0.6, '#4a3624', 10); b.cyl(0.55, 0.55, 0.12, x, 0, 0.6, '#4a3624', 10); }
  b.box(0.12, 0.12, 1.6, 0, 0.55, 2.2, WOOD); b.box(1.1, 0.5, 1.4, 0, 0.7, -0.2, '#d9b24a');
}
function barrels({ b }: Ctx) { b.cyl(0.42, 0.42, 0.95, -0.5, 0, 0, '#7a5232', 10); b.cyl(0.42, 0.42, 0.95, 0.45, 0, 0.1, '#6b4a2e', 10); b.cyl(0.38, 0.38, 0.9, 0, 0, -0.5, '#7a5232', 10); }
function woodpile({ b }: Ctx) { for (let r = 0; r < 4; r++) for (let k = 0; k < 6 - r; k++) b.cylZ(0.2, 1.1, -1.2 + k * 0.45 + r * 0.22, 0.2 + r * 0.38, 0, r % 2 ? '#8a6238' : '#74502e', 6); }
function garden({ b, cu }: Ctx) {
  b.box(5, 0.12, 3.5, 0, 0, 0, '#5a4630');
  const g = cu === Culture.Asia ? ['#2f6a3a', '#4f8a3a'] : ['#4f8a3a', '#6aa04a'];
  for (let r = 0; r < 5; r++) b.box(4.6, 0.3, 0.35, 0, 0.1, -1.4 + r * 0.7, g[r % 2]);
}
function laundry({ b }: Ctx) {
  for (const x of [-2, 2]) b.box(0.1, 2.2, 0.1, x, 0, 0, WOOD);
  b.box(4, 0.04, 0.04, 0, 2.1, 0, '#444');
  ['#ffffff', '#c8372d', '#3d7ab8', '#e8d9c0', '#f2c230'].forEach((cl, i) => b.box(0.55, 0.9 - (i % 2) * 0.2, 0.04, -1.5 + i * 0.75, 1.1 + (i % 2) * 0.2, 0, cl));
}
function shed({ b, roof }: Ctx) { b.box(3.2, 2.3, 3, 0, 0, 0, WHITE); b.gable(3.2, 3, 1.1, 0, 2.3, 0, roof); b.box(1.2, 1.9, 0.12, 0, 0, 1.55, WOOD); }
function trough({ b }: Ctx) { b.box(3, 0.9, 1.1, 0, 0, 0, '#9d968a'); b.box(2.8, 0.05, 0.9, 0, 0.86, 0, '#6aa9c9'); b.box(0.3, 1.8, 0.3, -1.1, 0.4, -0.4, '#7a5a3a'); }


// ---------- citta' moderne (uguali in ogni cultura: cambiano i colori) ----------
// palazzo: base con negozi, piani con fasce di finestre (brillano di sera), balconi o cornicione secondo la variante, tetto con servizi
function block({ b, variant, d }: Ctx) {
  const { w, h, d: dep } = d;
  const floors = Math.max(4, Math.round(h / 3.3)), fh = (h - 3.4) / (floors - 1);
  b.box(w, 3.4, dep, 0, 0, 0, '#a8a499'); // piano terra: negozi
  b.box(w + 0.2, 0.35, dep + 0.2, 0, 3.3, 0, '#d9d2c2');
  b.box(w, h - 3.7, dep, 0, 3.65, 0, WHITE);
  const nx = Math.max(3, Math.round(w / 3.1)), nz = Math.max(2, Math.round(dep / 3.1));
  for (let i = 0; i < floors - 1; i++) {
    const y = 4.3 + i * fh;
    for (let k = 0; k < nx; k++) {
      const x = ((k + 0.5) / nx - 0.5) * (w - 1.4);
      b.box(1.5, 1.45, 0.07, x, y, dep / 2 + 0.03, '#ffffff', 0, true);
      b.box(1.5, 1.45, 0.07, x, y, -dep / 2 - 0.03, '#ffffff', 0, true);
      if (variant % 2 === 0) { b.box(1.9, 0.12, 0.8, x, y - 0.1, dep / 2 + 0.4, '#8f8a80'); b.box(1.9, 0.6, 0.06, x, y - 0.05, dep / 2 + 0.8, '#6e6a62'); }
    }
    for (let k = 0; k < nz; k++) {
      const z = ((k + 0.5) / nz - 0.5) * (dep - 1.4);
      for (const s of [-1, 1]) b.box(0.07, 1.45, 1.4, s * (w / 2 + 0.03), y, z, '#ffffff', 0, true);
    }
  }
  for (let k = 0; k < nx; k++) b.box(1.7, 2.3, 0.06, ((k + 0.5) / nx - 0.5) * (w - 1.4), 0.4, dep / 2 + 0.03, '#2a3138'); // vetrine
  b.box(w + 0.4, 0.4, dep + 0.4, 0, h - 0.1, 0, '#cfc8b8'); // cornicione
  b.box(2.4, 1.6, 2.4, -w * 0.25, h + 0.3, 0, '#9a968c'); b.box(1.6, 1.0, 1.6, w * 0.2, h + 0.3, dep * 0.15, '#a9a59a');
  if (variant % 4 === 1) b.cyl(1.0, 1.0, 1.8, w * 0.3, h + 0.3, -dep * 0.2, '#8a6a4a', 8);
  if (variant >= 2) b.frustum(w - 1, dep - 1, w - 2, dep - 2, 1.6, 0, h + 0.3, 0, '#7e7a72'); // attico
}
// grattacieli: lastra di vetro, a gradoni, con la corona (tre famiglie)
function skyscraper({ b, variant, d }: Ctx) {
  const { w, h, d: dep } = d;
  const fam = variant % 3;
  const GLASS = ['#6f8aa0', '#587083', '#7fa0aa', '#8794a3'][variant % 4];
  const tier = (ww: number, dd: number, y0: number, hh: number, col: string, ox = 0) => {
    b.box(ww, hh, dd, ox, y0, 0, col);
    const floors = Math.max(2, Math.round(hh / 3.6));
    for (let i = 0; i < floors; i++) {
      const y = y0 + 1.0 + (i / floors) * (hh - 1.2);
      const fhh = (hh / floors) * 0.62;
      for (const s of [-1, 1]) {
        b.box(ww - 1.6, fhh, 0.1, ox, y, s * (dd / 2 + 0.04), '#ffffff', 0, true);
        b.box(0.1, fhh, dd - 1.6, ox + s * (ww / 2 + 0.04), y, 0, '#ffffff', 0, true);
      }
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.5, hh, 0.5, ox + sx * (ww / 2 - 0.2), y0, sz * (dd / 2 - 0.2), '#d8d6d0'); // montanti d'angolo
  };
  b.box(w + 3, 4.5, dep + 3, 0, 0, 0, '#bdb9ae'); // basamento
  b.box(w + 3.3, 0.5, dep + 3.3, 0, 4.5, 0, '#8c887f');
  if (fam === 0) {
    tier(w, dep, 5, h - 5, GLASS);
    b.box(w + 0.6, 0.8, dep + 0.6, 0, h, 0, '#8c887f');
    b.box(w * 0.5, 3, dep * 0.4, 0, h + 0.8, 0, '#6f6b63'); b.cyl(0.18, 0.28, 11, 0, h + 3.8, 0, '#aaa', 6);
  } else if (fam === 1) {
    const h1 = (h - 5) * 0.5, h2 = (h - 5) * 0.3, h3 = (h - 5) * 0.2;
    tier(w, dep, 5, h1, GLASS); tier(w * 0.78, dep * 0.78, 5 + h1, h2, GLASS); tier(w * 0.55, dep * 0.55, 5 + h1 + h2, h3, GLASS);
    b.box(w * 0.4, 1.5, dep * 0.4, 0, h, 0, '#6f6b63'); b.cyl(0.15, 0.25, 9, 0, h + 1.5, 0, '#aaa', 6);
  } else {
    tier(w * 0.42, dep, 5, h - 5, GLASS, -w * 0.28); // due torri gemelle unite da un ponte
    tier(w * 0.42, dep, 5, (h - 5) * 0.86, GLASS, w * 0.28);
    b.box(w * 0.5, 2.4, dep * 0.8, 0, h * 0.62, 0, '#a8b0b8');
    b.box(w * 0.3, 4, dep * 0.5, -w * 0.28, h, 0, '#6f6b63');
  }
}
function warehouse({ b, variant, d }: Ctx) {
  const { w, h, d: dep } = d;
  b.box(w, h - 1.4, dep, 0, 0, 0, WHITE);
  b.box(w + 0.4, 0.3, dep + 0.4, 0, h - 1.4, 0, '#9d9a92');
  // tetto a shed dentellato (lucernari) o a falda bassa
  if (variant % 2 === 0) for (let x = -w / 2 + 3; x < w / 2; x += 6) b.frustum(6, dep, 0.2, dep, 1.6, x, h - 1.1, 0, '#8d949a');
  else b.gable(w, dep, 1.4, 0, h - 1.1, 0, '#7f878d', false, 0.3);
  for (let k = 0; k < 4; k++) { const x = -w / 2 + (k + 0.5) * (w / 4); b.box(4.6, 4.8, 0.2, x, 0, dep / 2 + 0.05, k % 2 ? '#c0442f' : '#3f5f78'); }
  for (let x = -w / 2 + 2; x < w / 2 - 1; x += 3) b.box(1.8, 0.7, 0.08, x, h - 3.2, dep / 2 + 0.03, '#ffffff', 0, true);
  b.cyl(0.4, 0.4, 2.6, w * 0.3, h, -dep * 0.2, '#7a7a7a', 8);
}
function chimney({ b, d }: Ctx) {
  const { h } = d;
  b.box(5, 2.2, 5, 0, 0, 0, '#8e5a44');
  b.cyl(1.4, 2.2, h * 0.38, 0, 2.2, 0, '#a35a40', 10); b.cyl(1.0, 1.4, h * 0.3, 0, 2.2 + h * 0.38, 0, '#9a523a', 10);
  b.cyl(0.9, 1.0, h * 0.12, 0, 2.2 + h * 0.68, 0, '#e9e4dc', 10); b.cyl(0.95, 0.9, 1.6, 0, 2.2 + h * 0.8, 0, '#b8372c', 10);
  b.cyl(0.8, 0.95, 1.4, 0, 2.2 + h * 0.8 + 1.6, 0, '#e9e4dc', 10);
}
function pier({ b }: Ctx) { b.box(1.8, 1, 1.4, 0, 0, 0, '#cfcac2'); b.box(2.4, 0.06, 1.9, 0, 0.94, 0, '#aaa59d'); }
function bench({ b }: Ctx) { b.box(1.8, 0.1, 0.5, 0, 0.45, 0, WOOD); b.box(1.8, 0.4, 0.08, 0, 0.55, -0.22, WOOD); for (const x of [-0.8, 0.8]) b.box(0.08, 0.45, 0.45, x, 0, 0, IRON); }

function house(cu: number, ctx: Ctx) {
  if (cu === Culture.Med) medHouse(ctx);
  else if (cu === Culture.Alp) altHouse(ctx);
  else if (cu === Culture.Mag) magHouse(ctx);
  else asiaHouse(ctx);
}
function buildRole(ctx: Ctx) {
  const { b, cu, role } = ctx;
  if (role >= Role.RuinWall) return ruinsMisc(b, role);
  switch (role) {
    case Role.HouseS: case Role.HouseM: case Role.HouseL: case Role.RowLow: case Role.RowMid: case Role.RowHigh: return house(cu, ctx);
    case Role.Temple: return cu === Culture.Med ? medTemple(ctx) : cu === Culture.Alp ? altTemple(ctx) : cu === Culture.Mag ? magTemple(ctx) : asiaTemple(ctx);
    case Role.Tower: return cu === Culture.Med ? medTower(ctx) : cu === Culture.Alp ? altTower(ctx) : cu === Culture.Mag ? magTower(ctx) : asiaTower(ctx);
    case Role.Fountain: case Role.Well: return cu === Culture.Med ? medFountain(ctx) : cu === Culture.Alp ? altFountain(ctx) : cu === Culture.Mag ? magFountain(ctx) : asiaFountain(ctx);
    case Role.Trough: return trough(ctx);
    case Role.Stall: return stall(ctx);
    case Role.Lamp: return lamp(ctx);
    case Role.Fence: return fence(ctx);
    case Role.Wall: return wall(ctx);
    case Role.Gate: return gate(ctx);
    case Role.Pillar: return pillar(ctx);
    case Role.Granary: return granary(ctx);
    case Role.Stack: return stack(ctx);
    case Role.Archway: return archway(ctx);
    case Role.Cart: return cart(ctx);
    case Role.Barrels: return barrels(ctx);
    case Role.Woodpile: return woodpile(ctx);
    case Role.Garden: return garden(ctx);
    case Role.Laundry: return laundry(ctx);
    case Role.Shed: return shed(ctx);
    case Role.Lantern: return asiaLantern(ctx);
    case Role.TreeA: case Role.TreeB: return tree(ctx);
    case Role.Block: return block(ctx);
    case Role.Skyscraper: return skyscraper(ctx);
    case Role.Warehouse: return warehouse(ctx);
    case Role.Chimney: return chimney(ctx);
    case Role.Pier: return pier(ctx);
    case Role.Bench: return bench(ctx);
  }
}

// ponte di legno lungo 4*b m lungo z (origine sulla faccia superiore del piano, al centro): piano, travi, parapetti con
// montanti, pile ogni ~9 m (scendono sotto l'acqua), spalle di pietra alle estremita'
function bridge(b: Builder, len: number) {
  const W = BRIDGE_WIDTH, hz = len / 2;
  b.box(W, 0.3, len, 0, -0.3, 0, '#8a6a44');
  b.box(0.3, 0.5, len, -W / 2 + 0.2, -0.8, 0, '#5b3f26'); b.box(0.3, 0.5, len, W / 2 - 0.2, -0.8, 0, '#5b3f26');
  for (const x of [-W / 2 + 0.1, W / 2 - 0.1]) {
    b.box(0.14, 0.14, len, x, 1.0, 0, '#6b4a2e'); b.box(0.12, 0.12, len, x, 0.5, 0, '#6b4a2e');
    for (let z = -hz + 0.4; z <= hz - 0.3; z += 3) b.box(0.16, 1.15, 0.16, x, 0, z, '#5b3f26');
  }
  const piers = Math.max(0, Math.floor(len / 9) - 1);
  for (let k = 1; k <= piers; k++) {
    const z = -hz + (len * k) / (piers + 1);
    for (const x of [-W / 2 + 0.5, W / 2 - 0.5]) b.box(0.45, 9, 0.45, x, -9.3, z, '#5b3f26');
    b.box(W - 0.2, 0.3, 0.4, 0, -1.4, z, '#5b3f26');
  }
  for (const z of [-hz + 0.8, hz - 0.8]) b.box(W + 0.6, 2.2, 1.6, 0, -2.5, z, '#8e8a84');
}

const geoCache = new Map<number, THREE.BufferGeometry>();
export function villageGeometry(kind: number): THREE.BufferGeometry {
  let g = geoCache.get(kind);
  if (!g) {
    const t0 = performance.now();
    const b = new Builder();
    if (kind >= BRIDGE_BASE) bridge(b, (kind - BRIDGE_BASE) * 4);
    else {
      const cu = cultureOfKind(kind), role = roleOf(kind), variant = variantOf(kind);
      const pal = PALETTE[cu];
      buildRole({ b, cu, role, variant, d: dimOf(cu, role), roof: pal.roofs[variant % pal.roofs.length], trim: pal.trim });
    }
    g = b.build();
    g.computeBoundingSphere();
    geoCache.set(kind, g);
    if (import.meta.env.DEV) (((window as any).__dt ??= []) as any[]).push([`geometry role${kind & 63} v${(kind >> 6) & 7} c${(kind >> 9) & 3}`, Math.round(performance.now() - t0), Math.round(t0)]);
  }
  return g;
}
// materiali condivisi: pareti e tetti (colori per vertice) e finestre (brillano)
export const VILLAGE_MATERIALS: THREE.Material[] = [
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }),
  new THREE.MeshStandardMaterial({ color: '#ffe2a8', emissive: '#ffb347', emissiveIntensity: 0.5, roughness: 0.4 }),
];
export const villageHasGlow = (kind: number) => villageGeometry(kind).groups.length > 1;

// pezzi piccoli: niente ombra (ogni mesh istanziata con ombra costa un disegno in piu' per cascata)
const NO_SHADOW = new Set<number>([Role.Lamp, Role.Fence, Role.Bench, Role.Garden, Role.Laundry, Role.Barrels, Role.Woodpile, Role.Cart, Role.Lantern, Role.Trough, Role.Stall]);
export const villageCastsShadow = (kind: number) => kind >= BRIDGE_BASE || !NO_SHADOW.has(roleOf(kind));
