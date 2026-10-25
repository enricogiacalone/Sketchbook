import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Attrezzi per costruire i modelli del villaggio da primitive (scatole, cilindri, tronchi di piramide, cupole, prismi) con un
// colore per vertice (che l'istanza moltiplica per la sua tinta). Origine a terra al centro della pianta, fronte = +z, x = larghezza.
// Le finestre sono una seconda parte (gruppo 1 del geometry) con un materiale che brilla di sera.
const col = (hex: string | number) => new THREE.Color(hex);

export class Builder {
  solid: THREE.BufferGeometry[] = [];
  glow: THREE.BufferGeometry[] = [];
  put(g: THREE.BufferGeometry, color: THREE.Color, x: number, y: number, z: number, ry = 0, glow = false) {
    const geo = g.index ? g.toNonIndexed() : g;
    geo.deleteAttribute('uv');
    if (ry) geo.rotateY(ry);
    geo.translate(x, y, z);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([color.r, color.g, color.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    (glow ? this.glow : this.solid).push(geo);
  }
  // scatola w x h x d con la base a y0
  box(w: number, h: number, d: number, x: number, y0: number, z: number, color: string | number, ry = 0, glow = false) {
    this.put(new THREE.BoxGeometry(w, h, d), col(color), x, y0 + h / 2, z, ry, glow);
  }
  cyl(rt: number, rb: number, h: number, x: number, y0: number, z: number, color: string | number, seg = 10) {
    this.put(new THREE.CylinderGeometry(rt, rb, h, seg), col(color), x, y0 + h / 2, z);
  }
  cylZ(r: number, len: number, x: number, y: number, z: number, color: string | number, seg = 8) {
    this.put(new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2), col(color), x, y, z);
  }
  cylX(r: number, len: number, x: number, y: number, z: number, color: string | number, seg = 8) {
    this.put(new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2), col(color), x, y, z);
  }
  cone(r: number, h: number, x: number, y0: number, z: number, color: string | number, seg = 8) {
    this.put(new THREE.ConeGeometry(r, h, seg), col(color), x, y0 + h / 2, z);
  }
  // cupola: semisfera di raggio r (schiacciabile in y con k) sulla base a y0
  dome(r: number, x: number, y0: number, z: number, color: string | number, k = 1, seg = 14) {
    const g = new THREE.SphereGeometry(r, seg, Math.ceil(seg / 2), 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(1, k, 1);
    this.put(g, col(color), x, y0, z);
  }
  sphere(r: number, x: number, y: number, z: number, color: string | number, sy = 1, seg = 8) {
    this.put(new THREE.SphereGeometry(r, seg, Math.ceil(seg * 0.75)).scale(1, sy, 1), col(color), x, y, z);
  }
  // tronco di piramide rettangolare: base wb x db, cima wt x dt, altezza h (tetti: a due falde dt=0 & wt=wb; a padiglione wt<wb, dt=0; a piramide 0,0)
  frustum(wb: number, db: number, wt: number, dt: number, h: number, x: number, y0: number, z: number, color: string | number, ry = 0) {
    const bx = wb / 2, bz = db / 2, tx = wt / 2, tz = dt / 2;
    const B = [[-bx, 0, -bz], [bx, 0, -bz], [bx, 0, bz], [-bx, 0, bz]];
    const T = [[-tx, h, -tz], [tx, h, -tz], [tx, h, tz], [-tx, h, tz]];
    const pos: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[]) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    quad(B[3], B[2], T[2], T[3]); // fronte (+z)
    quad(B[1], B[0], T[0], T[1]); // retro
    quad(B[2], B[1], T[1], T[2]); // destra
    quad(B[0], B[3], T[3], T[0]); // sinistra
    if (wt > 0 && dt > 0) quad(T[3], T[2], T[1], T[0]); // cima
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.computeVertexNormals();
    this.put(g, col(color), x, y0, z, ry);
  }
  // tetto a due falde con il colmo lungo x (o lungo z con alongZ) e le falde che sporgono di `o`
  gable(w: number, d: number, hh: number, x: number, y0: number, z: number, color: string | number, alongZ = false, o = 0.45) {
    if (alongZ) this.frustum(d + 2 * o, w + 2 * o, d + 2 * o, 0, hh, x, y0, z, color, Math.PI / 2);
    else this.frustum(w + 2 * o, d + 2 * o, w + 2 * o, 0, hh, x, y0, z, color);
  }
  // finestra: vetro che di sera brilla + cornice (frame) con spessore t
  win(x: number, y: number, z: number, w: number, h: number, frame: string | number | null, ry = 0, depth = 0.1) {
    const nx = Math.sin(ry), nz = Math.cos(ry); // normale uscente
    this.box(w, h, 0.08, x, y, z, '#ffffff', ry, true);
    if (frame !== null) {
      const t = 0.12;
      this.box(w + 2 * t, t, depth, x - nx * 0, y + h, z, frame, ry); // architrave (sopra)
      this.box(w + 2 * t, t, depth + 0.06, x, y - t, z, frame, ry); // davanzale
      for (const s of [-1, 1]) this.box(t, h, depth, x + Math.cos(ry) * s * (w / 2 + t / 2), y, z - Math.sin(ry) * s * (w / 2 + t / 2), frame, ry);
    }
  }
  build(): THREE.BufferGeometry {
    const a = mergeGeometries(this.solid)!;
    if (!this.glow.length) return a;
    return mergeGeometries([a, mergeGeometries(this.glow)!], true)!;
  }
}
