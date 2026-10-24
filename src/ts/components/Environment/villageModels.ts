import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VK, VILLAGE_KINDS, ROOF_STEP, kindOf } from '../../lib/village';
import { BRIDGE_BASE, BRIDGE_WIDTH } from '../../lib/nearTile';

// I modelli del villaggio, fatti di scatole, cilindri e prismi con colori per vertice (che l'istanza moltiplica per la sua
// tinta: pareti chiare, tetti, porte e legno scuri restano riconoscibili). Origine a terra al centro della pianta, fronte
// = +z. Le finestre sono una seconda parte (gruppo 1) con un materiale che brilla di sera.
const c = (hex: string | number) => new THREE.Color(hex);

class Builder {
  solid: THREE.BufferGeometry[] = [];
  glow: THREE.BufferGeometry[] = [];
  private put(g: THREE.BufferGeometry, color: THREE.Color, x: number, y: number, z: number, ry = 0, glow = false) {
    const geo = g.index ? g.toNonIndexed() : g;
    geo.deleteAttribute('uv');
    if (ry) geo.rotateY(ry);
    geo.translate(x, y, z);
    const n = geo.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([color.r, color.g, color.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    (glow ? this.glow : this.solid).push(geo);
  }
  // scatola w x h x d con la base a y0
  box(w: number, h: number, d: number, x: number, y0: number, z: number, color: string | number, ry = 0, glow = false) {
    this.put(new THREE.BoxGeometry(w, h, d), c(color), x, y0 + h / 2, z, ry, glow);
  }
  cyl(rt: number, rb: number, h: number, x: number, y0: number, z: number, color: string | number, seg = 10) {
    this.put(new THREE.CylinderGeometry(rt, rb, h, seg), c(color), x, y0 + h / 2, z);
  }
  // tetto a due falde: colmo lungo x, larghezza (z) d, altezza hh, sporgenza o
  gable(w: number, d: number, hh: number, x: number, y0: number, z: number, color: string | number) {
    const o = 0.45, hd = d / 2 + o;
    const sh = new THREE.Shape();
    sh.moveTo(-hd, 0); sh.lineTo(hd, 0); sh.lineTo(0, hh); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: w + 2 * o, bevelEnabled: false });
    g.translate(0, 0, -(w + 2 * o) / 2);
    g.rotateY(Math.PI / 2); // colmo lungo x
    this.put(g, c(color), x, y0, z);
  }
  cylZ(r: number, len: number, x: number, y: number, z: number, color: string | number, seg = 8) {
    this.put(new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2), c(color), x, y, z);
  }
  cone(r: number, h: number, x: number, y0: number, z: number, color: string | number, seg = 8) {
    this.put(new THREE.ConeGeometry(r, h, seg), c(color), x, y0 + h / 2, z);
  }
  win(x: number, y: number, z: number, ry = 0, w = 0.9, h = 1.0) {
    this.box(w, h, 0.12, x, y, z, '#ffffff', ry, true);
    // cornice scura
    this.box(w + 0.25, h + 0.25, 0.08, x, y - 0.12, z - 0.02 * Math.cos(ry), '#5a4636', ry);
  }
  door(x: number, z: number, h = 2.1, w = 1.0) {
    this.box(w, h, 0.14, x, 0, z, '#5b3a22');
  }
  build(): THREE.BufferGeometry {
    const a = mergeGeometries(this.solid)!;
    const parts = [a];
    if (this.glow.length) parts.push(mergeGeometries(this.glow)!);
    return parts.length === 1 ? a : mergeGeometries(parts, true)!;
  }
}

const WALL = '#ffffff';
const WOOD = '#6b4a2e';
const STONE = '#8e8a84';

const ROOFS = ['#a94a3a', '#7a5238', '#56606c', '#6f7d4b'];

function cottage(b: Builder, ROOF: string) {
  const w = 6, d = 5, h = 3.1;
  b.box(w + 0.3, 0.5, d + 0.3, 0, 0, 0, STONE); // zoccolo
  b.box(w, h, d, 0, 0.5 - 0.0, 0, WALL);
  b.gable(w, d, 1.9, 0, h + 0.5, 0, ROOF);
  b.box(0.7, 2.0, 0.7, 1.7, h + 0.8, -0.6, STONE); // camino
  b.door(-1.2, d / 2 + 0.05);
  b.box(1.3, 0.12, 0.5, -1.2, 2.55, d / 2 + 0.25, WOOD); // tettoia sulla porta
  b.win(1.4, 1.35, d / 2 + 0.07); b.win(-w / 2 - 0.0, 1.5, 0, Math.PI / 2); b.win(w / 2, 1.5, 0, Math.PI / 2);
}
function farm(b: Builder, ROOF: string) {
  const w = 8.5, d = 6.5, h = 5.1;
  b.box(w + 0.3, 0.6, d + 0.3, 0, 0, 0, STONE);
  b.box(w, h, d, 0, 0.6, 0, WALL);
  b.box(w + 0.2, 0.18, d + 0.2, 0, 3.3, 0, WOOD); // marcapiano
  b.gable(w, d, 2.4, 0, h + 0.6, 0, ROOF);
  b.box(0.9, 2.4, 0.9, -2.4, h + 1.0, -0.8, STONE);
  b.door(0, d / 2 + 0.05, 2.3, 1.2);
  for (const x of [-2.8, 2.8]) { b.win(x, 1.5, d / 2 + 0.07); b.win(x, 4.1, d / 2 + 0.07); }
  b.win(0, 4.1, d / 2 + 0.07);
  for (const z of [-1.6, 1.6]) { b.win(-w / 2, 4.1, z, Math.PI / 2); b.win(w / 2, 4.1, z, Math.PI / 2); b.win(w / 2, 1.6, z, Math.PI / 2); }
}
function barn(b: Builder) {
  const w = 11, d = 8.5, h = 4.6;
  b.box(w, h, d, 0, 0, 0, WALL);
  b.gable(w, d, 3.0, 0, h, 0, '#5d4a42');
  b.box(4.2, 3.6, 0.14, 0, 0, d / 2 + 0.05, '#7a3b2c'); // portone
  b.box(0.2, 3.6, 0.2, 0, 0, d / 2 + 0.1, '#e8d9c0');
  b.box(0.9, 0.9, 0.12, 0, h + 1.2, d / 2 + 0.07, '#2c211b'); // finestrella del fienile
  for (const x of [-4, 4]) b.box(0.25, h, 0.25, x, 0, d / 2 + 0.1, '#e8d9c0');
}
function chapel(b: Builder) {
  const w = 6, d = 10, h = 4.8;
  b.box(w + 0.3, 0.5, d + 0.3, 0, 0, 0, STONE);
  b.box(w, h, d, 0, 0.5, 0, WALL);
  b.gable(w, d - 1, 2.6, 0, h + 0.5, 0, '#5a6470');
  // campanile sul fronte
  b.box(3, 7.4, 3, 0, 0.5, d / 2 - 1.1, WALL);
  b.box(3.3, 0.3, 3.3, 0, 7.9, d / 2 - 1.1, STONE);
  b.cone(2.0, 3.2, 0, 8.2, d / 2 - 1.1, '#5a6470', 4);
  b.box(1.2, 1.6, 0.12, 0, 5.8, d / 2 + 0.45, '#2c211b'); // arco delle campane
  b.door(0, d / 2 + 0.5, 2.6, 1.4);
  b.win(-w / 2, 2.7, -1.5, Math.PI / 2, 0.9, 1.7); b.win(w / 2, 2.7, -1.5, Math.PI / 2, 0.9, 1.7);
  b.win(-w / 2, 2.7, 1.8, Math.PI / 2, 0.9, 1.7); b.win(w / 2, 2.7, 1.8, Math.PI / 2, 0.9, 1.7);
  b.box(0.12, 1.0, 0.12, 0, 11.2 - 0.3, d / 2 - 1.1, '#d4af37'); b.box(0.6, 0.12, 0.12, 0, 11.3, d / 2 - 1.1, '#d4af37');
}
function well(b: Builder) {
  b.cyl(1.0, 1.1, 0.9, 0, 0, 0, STONE, 12);
  b.cyl(0.8, 0.8, 0.05, 0, 0.88, 0, '#1b3a4a', 12);
  b.box(0.18, 2.2, 0.18, -0.95, 0.9, 0, WOOD); b.box(0.18, 2.2, 0.18, 0.95, 0.9, 0, WOOD);
  b.box(0.18, 0.18, 2.2, 0, 2.95, 0, WOOD, 0);
  b.gable(2.6, 1.8, 0.9, 0, 3.05, 0, '#a94a3a');
}
function haystack(b: Builder) {
  b.cyl(1.3, 1.5, 2.2, 0, 0, 0, '#e5c35a', 12);
  b.cone(1.35, 1.4, 0, 2.2, 0, '#d9b24a', 12);
}
function stall(b: Builder) {
  b.box(2.6, 0.9, 1.2, 0, 0, 0, WOOD);
  for (const x of [-1.3, 1.3]) b.box(0.12, 2.6, 0.12, x, 0, -0.5, WOOD);
  for (let i = 0; i < 6; i++) b.box(0.45, 0.1, 1.9, -1.15 + i * 0.46, 2.45 - 0.0, 0.1, i % 2 ? '#f2eee6' : '#c8372d');
  b.box(2.3, 0.35, 0.6, 0, 0.9, 0.0, '#d9a441'); // merce
}
function lamp(b: Builder) {
  b.cyl(0.07, 0.1, 4.0, 0, 0, 0, '#2a2a2e', 6);
  b.box(0.4, 0.5, 0.4, 0, 3.7, 0, '#ffffff', 0, true);
  b.box(0.55, 0.1, 0.55, 0, 4.2, 0, '#2a2a2e');
}
function fence(b: Builder) {
  for (const x of [-2, 0, 2]) b.box(0.14, 1.1, 0.14, x, 0, 0, WOOD);
  b.box(4.0, 0.12, 0.08, 0, 0.8, 0, WOOD); b.box(4.0, 0.12, 0.08, 0, 0.4, 0, WOOD);
}
function longHouse(b: Builder, ROOF: string) {
  const w = 12, d = 4.8, h = 2.9;
  b.box(w + 0.3, 0.45, d + 0.3, 0, 0, 0, STONE);
  b.box(w, h, d, 0, 0.45, 0, WALL);
  b.gable(w, d, 1.7, 0, h + 0.45, 0, ROOF);
  b.box(0.7, 1.9, 0.7, -3.6, h + 0.7, -0.5, STONE); b.box(0.7, 1.9, 0.7, 3.6, h + 0.7, -0.5, STONE);
  b.door(-2.6, d / 2 + 0.05); b.door(2.6, d / 2 + 0.05);
  for (const x of [-4.8, 0, 4.8]) b.win(x, 1.3, d / 2 + 0.07);
  b.win(-w / 2, 1.4, 0, Math.PI / 2); b.win(w / 2, 1.4, 0, Math.PI / 2);
}
function shed(b: Builder, ROOF: string) {
  b.box(3.2, 2.3, 3, 0, 0, 0, WALL);
  b.gable(3.2, 3, 1.1, 0, 2.3, 0, ROOF);
  b.box(1.2, 1.9, 0.12, 0, 0, 1.55, WOOD);
}
function cart(b: Builder) {
  b.box(1.4, 0.15, 2.6, 0, 0.55, 0, WOOD);
  for (const x of [-0.8, 0.8]) { b.box(0.12, 0.5, 2.6, x, 0.6, 0, '#5b3f26'); b.cyl(0.55, 0.55, 0.12, x, 0, -0.6, '#4a3624', 10); b.cyl(0.55, 0.55, 0.12, x, 0, 0.6, '#4a3624', 10); }
  b.box(0.12, 0.12, 1.6, 0, 0.55, 2.2, WOOD);
  b.box(1.1, 0.5, 1.4, 0, 0.7, -0.2, '#d9b24a');
}
function barrels(b: Builder) {
  b.cyl(0.42, 0.42, 0.95, -0.5, 0, 0, '#7a5232', 10); b.cyl(0.42, 0.42, 0.95, 0.45, 0, 0.1, '#6b4a2e', 10); b.cyl(0.38, 0.38, 0.9, 0, 0, -0.5, '#7a5232', 10);
}
function woodpile(b: Builder) {
  for (let r = 0; r < 4; r++) for (let k = 0; k < 6 - r; k++) b.cyl(0.2, 0.2, 1.1, -1.2 + k * 0.45 + r * 0.22, 0.2 + r * 0.38, 0, r % 2 ? '#8a6238' : '#74502e', 6);
}
function garden(b: Builder) {
  b.box(5, 0.12, 3.5, 0, 0, 0, '#5a4630');
  for (let r = 0; r < 5; r++) { b.box(4.6, 0.3, 0.35, 0, 0.1, -1.4 + r * 0.7, r % 2 ? '#4f8a3a' : '#6aa04a'); }
}
function laundry(b: Builder) {
  for (const x of [-2, 2]) b.box(0.1, 2.2, 0.1, x, 0, 0, WOOD);
  b.box(4, 0.04, 0.04, 0, 2.1, 0, '#444');
  const cols = ['#ffffff', '#c8372d', '#3d7ab8', '#e8d9c0', '#f2c230'];
  cols.forEach((cl, i) => b.box(0.55, 0.9 - (i % 2) * 0.2, 0.04, -1.5 + i * 0.75, 1.1 + (i % 2) * 0.2, 0, cl));
}
const RSTONE = '#b9b4a6', RDARK = '#8f8a7c';
function ruinWall(b: Builder) {
  b.box(4, 1.4, 0.7, 0, 0, 0, RSTONE);
  b.box(1.5, 0.9, 0.7, -1.2, 1.4, 0, RDARK); b.box(1.0, 0.5, 0.7, 0.4, 1.4, 0, RSTONE); b.box(0.9, 1.2, 0.7, 1.5, 1.4, 0, RDARK);
  b.box(4.2, 0.2, 0.9, 0, -0.1, 0, RDARK);
}
function ruinColumn(b: Builder) {
  b.box(1.1, 0.35, 1.1, 0, 0, 0, RDARK);
  b.cyl(0.42, 0.48, 2.3, 0, 0.35, 0, RSTONE, 8);
  b.cyl(0.4, 0.42, 0.5, 0, 2.65, 0, RDARK, 8);
  b.box(0.7, 0.18, 0.5, 0.1, 3.1, 0, RSTONE, 0.4);
}
function ruinBlock(b: Builder) {
  b.box(1.4, 0.9, 1.4, 0, 0, 0, RSTONE, 0.2);
  b.box(0.7, 0.4, 0.8, 0.5, 0.9, 0.1, RDARK, 0.7);
}
function ruinArch(b: Builder) {
  for (const x of [-2.1, 2.1]) {
    b.box(1.1, 0.35, 1.1, x, 0, 0, RDARK);
    b.cyl(0.42, 0.46, 3.6, x, 0.35, 0, RSTONE, 8);
  }
  b.box(5.4, 0.7, 1.0, 0, 3.95, 0, RSTONE);
  b.box(1.0, 0.9, 1.0, 0, 4.65, 0, RDARK);
}
function ruinFallen(b: Builder) {
  b.cylZ(0.42, 4, 0, 0.42, 0, RSTONE);
  b.cylZ(0.4, 1.3, 0.1, 0.4, 2.8, RDARK);
}
const BUILDERS: Record<number, (b: Builder, roof: string) => void> = {
  [VK.RuinWall]: ruinWall, [VK.RuinColumn]: ruinColumn, [VK.RuinBlock]: ruinBlock, [VK.RuinArch]: ruinArch, [VK.RuinFallen]: ruinFallen,
  [VK.Long]: longHouse, [VK.Shed]: shed, [VK.Cart]: cart, [VK.Barrels]: barrels, [VK.Woodpile]: woodpile, [VK.Garden]: garden, [VK.Laundry]: laundry,
  [VK.Cottage]: cottage, [VK.Farm]: farm, [VK.Barn]: barn, [VK.Chapel]: chapel, [VK.Well]: well,
  [VK.Haystack]: haystack, [VK.Stall]: stall, [VK.Lamp]: lamp, [VK.Fence]: fence,
};

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
    const b = new Builder();
    if (kind >= BRIDGE_BASE) bridge(b, (kind - BRIDGE_BASE) * 4);
    else BUILDERS[kindOf(kind)](b, ROOFS[Math.floor(kind / ROOF_STEP) % ROOFS.length]);
    g = b.build();
    g.computeBoundingSphere();
    geoCache.set(kind, g);
  }
  return g;
}
// materiali condivisi: pareti e tetti (colori per vertice) e finestre (brillano)
export const VILLAGE_MATERIALS: THREE.Material[] = [
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }),
  new THREE.MeshStandardMaterial({ color: '#ffe2a8', emissive: '#ffb347', emissiveIntensity: 0.5, roughness: 0.4 }),
];
export const villageHasGlow = (kind: number) => villageGeometry(kind).groups.length > 1;
export { VILLAGE_KINDS };
