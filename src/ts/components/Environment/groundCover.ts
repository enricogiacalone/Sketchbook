import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { COVER_BUSH, COVER_FERN, COVER_FLOWER, COVER_GRASS, COVER_TALL } from '../../lib/nearTile';

// La copertura del suolo del pianeta (PlanetNearField.tsx): erba, fiori, felci e cespugli, ognuno un solo pezzo grafico
// instanziato per tessera. Le lame sono ricurve e affusolate, scure alla base e chiare in punta (colore per vertice); il
// colore di ogni ciuffo viene dall'istanza. Erba, fiori e felci ondeggiano col vento (positionNode, pesato dall'altezza).
const { positionGeometry, positionLocal, vec3, sin, cos, time } = TSL as any;

const rnd = (() => {
  let s = 987654321;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
})();

class Builder {
  pos: number[] = [];
  col: number[] = [];
  nor: number[] = [];
  tri(a: number[], b: number[], c: number[], ca: number[], cb: number[], cc: number[], n: number[] = [0, 1, 0]) {
    this.pos.push(...a, ...b, ...c);
    this.col.push(...ca, ...cb, ...cc);
    this.nor.push(...n, ...n, ...n);
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    return g;
  }
}

// una lama ricurva (due segmenti piu' la punta): base larga, si piega verso (dx, dz)
function blade(b: Builder, bx: number, bz: number, dx: number, dz: number, h: number, w: number, lean: number, baseCol: number[], midCol: number[], tipCol: number[]) {
  const px = -dz, pz = dx; // perpendicolare
  const p0l = [bx - px * w, 0, bz - pz * w], p0r = [bx + px * w, 0, bz + pz * w];
  const m = [bx + dx * lean * 0.35, h * 0.55, bz + dz * lean * 0.35];
  const p1l = [m[0] - px * w * 0.7, m[1], m[2] - pz * w * 0.7], p1r = [m[0] + px * w * 0.7, m[1], m[2] + pz * w * 0.7];
  const tip = [bx + dx * lean, h, bz + dz * lean];
  b.tri(p0l, p0r, p1l, baseCol, baseCol, midCol);
  b.tri(p0r, p1r, p1l, baseCol, midCol, midCol);
  b.tri(p1l, p1r, tip, midCol, midCol, tipCol);
}

export const grassGeometry = (() => {
  const b = new Builder();
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.8;
    const r = 0.03 + rnd() * 0.12;
    const h = 0.5 + rnd() * 0.45;
    blade(b, Math.cos(a) * r, Math.sin(a) * r, Math.cos(a), Math.sin(a), h, 0.035 + rnd() * 0.02, 0.18 + rnd() * 0.22, [0.3, 0.42, 0.22], [0.72, 0.82, 0.5], [1, 1, 0.82]);
  }
  return b.geo();
})();

// erba alta da prateria: lame lunghe e sottili che si piegano, con le spighe (un triangolino chiaro) in cima
export const tallGrassGeometry = (() => {
  const b = new Builder();
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.9;
    const r = 0.02 + rnd() * 0.1;
    const h = 1.0 + rnd() * 0.7;
    const dx = Math.cos(a), dz = Math.sin(a);
    const lean = 0.3 + rnd() * 0.35;
    blade(b, dx * r, dz * r, dx, dz, h, 0.022 + rnd() * 0.012, lean, [0.3, 0.38, 0.18], [0.78, 0.74, 0.42], [0.95, 0.9, 0.62]);
    if (i % 2 === 0) {
      // la spiga: due triangolini in cima alla lama
      const tx = dx * (r + lean), tz = dz * (r + lean);
      const px = -dz * 0.025, pz = dx * 0.025;
      b.tri([tx - px, h * 0.93, tz - pz], [tx + px, h * 0.93, tz + pz], [tx + dx * 0.05, h + 0.2, tz + dz * 0.05], [0.9, 0.82, 0.5], [0.9, 0.82, 0.5], [1, 0.95, 0.7]);
    }
  }
  return b.geo();
})();

export const fernGeometry = (() => {
  const b = new Builder();
  const fronds = 9;
  const shade = (t: number) => [0.3 + t * 0.5, 0.45 + t * 0.4, 0.22 + t * 0.2];
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + rnd() * 0.4;
    const cx = Math.cos(a), cz = Math.sin(a);
    const px = -cz, pz = cx;
    const len = 0.7 + rnd() * 0.35;
    const rise = 0.35 + rnd() * 0.25;
    const segs = 4;
    const baseL = [cx * 0.05 - px * 0.07, 0, cz * 0.05 - pz * 0.07];
    const baseR = [cx * 0.05 + px * 0.07, 0, cz * 0.05 + pz * 0.07];
    let prevL = baseL, prevR = baseR, prevC = [0.25, 0.38, 0.18];
    for (let s = 1; s <= segs; s++) {
      const t = s / segs;
      const r = 0.05 + len * t;
      const y = rise * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.62) - t * t * 0.1;
      const w = 0.07 * (1 - t * 0.8);
      const c = shade(t);
      const cL = [cx * r - px * w, y, cz * r - pz * w], cR = [cx * r + px * w, y, cz * r + pz * w];
      if (s < segs) {
        b.tri(prevL, prevR, cL, prevC, prevC, c);
        b.tri(prevR, cR, cL, prevC, c, c);
      } else {
        b.tri(prevL, prevR, [cx * r, y, cz * r], prevC, prevC, c);
      }
      prevL = cL;
      prevR = cR;
      prevC = c;
    }
  }
  return b.geo();
})();

export const flowerGeometry = (() => {
  const b = new Builder();
  const stems = 4;
  for (let i = 0; i < stems; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 0.05 + rnd() * 0.22;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const h = 0.32 + rnd() * 0.3;
    const lean = 0.05 + rnd() * 0.08;
    const tx = bx + Math.cos(a) * lean, tz = bz + Math.sin(a) * lean;
    const px = -Math.sin(a), pz = Math.cos(a);
    const sw = 0.012;
    const g0 = [0.55, 0.78, 0.42], g1 = [0.85, 1, 0.7];
    b.tri([bx - px * sw, 0, bz - pz * sw], [bx + px * sw, 0, bz + pz * sw], [tx - px * sw * 0.6, h, tz - pz * sw * 0.6], g0, g0, g1);
    b.tri([bx + px * sw, 0, bz + pz * sw], [tx + px * sw * 0.6, h, tz + pz * sw * 0.6], [tx - px * sw * 0.6, h, tz - pz * sw * 0.6], g0, g1, g1);
    // una foglia
    blade(b, bx, bz, Math.cos(a + 1.2), Math.sin(a + 1.2), h * 0.45, 0.03, 0.12, g0, g1, g1);
    // il fiore: una coroncina di petali (ventaglio) in cima, bianca (il colore viene dall'istanza)
    const petals = 5, pr = 0.12 + rnd() * 0.05; // grandi: i contorni scuri mangiano i fiori piccoli
    const centre = [tx, h + 0.02, tz];
    for (let k = 0; k < petals; k++) {
      const a0 = (k / petals) * Math.PI * 2, a1 = ((k + 1) / petals) * Math.PI * 2;
      b.tri(centre, [tx + Math.cos(a0) * pr, h, tz + Math.sin(a0) * pr], [tx + Math.cos(a1) * pr, h, tz + Math.sin(a1) * pr], [1, 1, 0.9], [1, 1, 1], [1, 1, 1]);
    }
  }
  return b.geo();
})();

export const bushGeometry = (() => {
  // quattro blocchi sfaccettati sovrapposti, scuri sotto e chiari sopra, con i vertici un po' spostati
  const spots: Array<[number, number, number, number]> = [
    [0, 0.45, 0, 0.5],
    [0.34, 0.36, 0.12, 0.38],
    [-0.3, 0.34, -0.18, 0.4],
    [0.05, 0.62, -0.24, 0.32],
  ];
  const b = new Builder();
  for (const [x, y, z, r] of spots) {
    const ico = new THREE.IcosahedronGeometry(r, 0).toNonIndexed();
    const p = ico.getAttribute('position');
    const jit: Record<string, number[]> = {};
    for (let i = 0; i < p.count; i++) {
      const key = `${p.getX(i).toFixed(3)}${p.getY(i).toFixed(3)}${p.getZ(i).toFixed(3)}`;
      jit[key] ??= [(rnd() - 0.5) * r * 0.45, (rnd() - 0.5) * r * 0.35, (rnd() - 0.5) * r * 0.45];
      const j = jit[key];
      p.setXYZ(i, p.getX(i) + j[0], Math.max(-r * 0.4, p.getY(i) + j[1]), p.getZ(i) + j[2]);
    }
    ico.computeVertexNormals();
    const n = ico.getAttribute('normal');
    for (let i = 0; i < p.count; i += 3) {
      const tri: number[][] = [];
      const cols: number[][] = [];
      const nn = [n.getX(i), n.getY(i), n.getZ(i)];
      for (let k = 0; k < 3; k++) {
        const vy = (y + p.getY(i + k)) / 0.95;
        const t = Math.min(1, Math.max(0, vy));
        tri.push([x + p.getX(i + k), y + p.getY(i + k), z + p.getZ(i + k)]);
        cols.push([0.42 + t * 0.55, 0.55 + t * 0.45, 0.32 + t * 0.4]);
      }
      b.tri(tri[0], tri[1], tri[2], cols[0], cols[1], cols[2], nn);
    }
    ico.dispose();
  }
  return b.geo();
})();

// materiali: vertex color x colore d'istanza; erba, fiori e felci ondeggiano (piu' in alto, piu' forte; fase per ciuffo)
function makeMat(sway: number): THREE.Material {
  const m: any = new MeshStandardNodeMaterial();
  m.vertexColors = true;
  m.side = THREE.DoubleSide;
  m.roughness = 1;
  m.metalness = 0;
  if (sway > 0) {
    // (positionNode vale DOPO l'istanziazione: positionLocal e' gia' la posizione sul pianeta, positionGeometry e' la
    // lama in sé: l'altezza pesa l'ondeggiamento, la posizione sul pianeta da' la fase, cosi' il vento fa onde che passano)
    const ph = positionLocal.x.add(positionLocal.z).mul(0.045);
    const hgt = positionGeometry.y.mul(positionGeometry.y);
    const gust = sin(time.mul(0.9).add(ph.mul(0.5))).mul(0.5).add(1);
    m.positionNode = positionLocal.add(
      vec3(sin(time.mul(1.7).add(ph)).mul(hgt).mul(sway).mul(gust), 0, cos(time.mul(1.3).add(ph.mul(1.3))).mul(hgt).mul(sway * 0.8).mul(gust))
    );
  }
  return m;
}

export interface CoverKind {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  cap: number; // istanze per tessera
  shadow: boolean;
}
export const COVER: Record<number, CoverKind> = {
  [COVER_GRASS]: { geo: grassGeometry, mat: makeMat(0.22), cap: 14000, shadow: false },
  [COVER_FLOWER]: { geo: flowerGeometry, mat: makeMat(0.14), cap: 2600, shadow: false },
  [COVER_FERN]: { geo: fernGeometry, mat: makeMat(0.1), cap: 2600, shadow: false },
  [COVER_BUSH]: { geo: bushGeometry, mat: makeMat(0), cap: 1400, shadow: true },
  [COVER_TALL]: { geo: tallGrassGeometry, mat: makeMat(0.11), cap: 6000, shadow: false },
};
export const COVER_KINDS = [COVER_GRASS, COVER_TALL, COVER_FLOWER, COVER_FERN, COVER_BUSH];
