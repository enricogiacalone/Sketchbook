// Stoffa semplice su CPU: porting in JavaScript dell'algoritmo di
// three-simplecloth (https://github.com/bandinopla/three-simplecloth, che a
// sua volta nasce dall'esempio webgpu_compute_cloth di three.js).
// L'originale gira in compute shader WebGPU (TSL); il nostro renderer e'
// WebGL, quindi la stessa fisica qui gira in JS: molle sui lati dei
// triangoli, "forza" smorzata ad ogni passo, gravita', vento con rumore
// triNoise3D, forza massima per passo, 360 passi al secondo fissi.
//
// ---------------------------------------------------------------------------
// Copyright 2026 bandinopla
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
// FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
// IN THE SOFTWARE.
// ---------------------------------------------------------------------------

export interface SimpleClothConfig {
  stiffness: number; // 0..1 (originale: 0.2)
  dampening: number; // 0..1 (originale: 0.96)
  wind: [number, number, number]; // DIREZIONE del vento (m/s circa), con rumore
  gravity: [number, number, number];
  stepsPerSecond: number; // originale: 360
  maxForce: number; // spostamento massimo per passo (originale: 0.01)
}

const DEFAULTS: SimpleClothConfig = {
  stiffness: 0.2,
  dampening: 0.96,
  wind: [0, 0, 0],
  gravity: [0, -9.8, 0],
  stepsPerSecond: 360,
  maxForce: 0.01,
};

// triNoise3D di three.js (TSL) riscritto in JS
const fract = (x: number) => x - Math.floor(x);
const tri = (x: number) => Math.abs(fract(x) - 0.5);
function triNoise3D(px: number, py: number, pz: number, speed: number, time: number): number {
  let z = 1.4, rz = 0;
  let bx = px, by = py, bz = pz;
  for (let i = 0; i <= 3; i++) {
    const dgx = tri(bz * 2 + tri(by * 2)), dgy = tri(bz * 2 + tri(bx * 2)), dgz = tri(by * 2 + tri(bx * 2));
    const tt = time * 0.1 * speed;
    px += dgx + tt; py += dgy + tt; pz += dgz + tt;
    bx *= 1.8; by *= 1.8; bz *= 1.8;
    z *= 1.5;
    px *= 1.2; py *= 1.2; pz *= 1.2;
    const t = tri(pz + tri(px + tri(py)));
    rz += t / z;
    bx += 0.14; by += 0.14; bz += 0.14;
  }
  return rz;
}

export class SimpleClothCPU {
  cfg: SimpleClothConfig;
  n: number;
  pos: Float32Array; // posizioni (mondo)
  force: Float32Array; // "forza" = spostamento per passo, smorzato
  mask: Float32Array; // 1 = stoffa libera, 0 = fissata (all'asta)
  springs: Uint32Array; // coppie di vertici
  rest: Float32Array; // lunghezze a riposo
  springForce: Float32Array;
  private acc = 0;
  private time = 0;

  // positions: vertici (xyz) gia' in coordinate mondo; index: triangoli;
  // pinned(i) = true per i vertici fissati
  constructor(positions: ArrayLike<number>, index: ArrayLike<number>, pinned: (i: number) => boolean, cfg: Partial<SimpleClothConfig> = {}) {
    this.cfg = { ...DEFAULTS, ...cfg };
    this.n = positions.length / 3;
    this.pos = Float32Array.from(positions);
    this.force = new Float32Array(this.pos.length);
    this.mask = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) this.mask[i] = pinned(i) ? 0 : 1;
    // una molla per ogni lato di triangolo, senza doppioni
    const seen = new Set<number>();
    const list: number[] = [];
    const add = (a: number, b: number) => {
      const key = a < b ? a * this.n + b : b * this.n + a;
      if (seen.has(key)) return;
      seen.add(key);
      list.push(a, b);
    };
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t], b = index[t + 1], c = index[t + 2];
      add(a, b); add(c, b); add(a, c);
    }
    this.springs = Uint32Array.from(list);
    const ns = list.length / 2;
    this.rest = new Float32Array(ns);
    for (let s = 0; s < ns; s++) {
      const a = list[2 * s] * 3, b = list[2 * s + 1] * 3;
      this.rest[s] = Math.hypot(this.pos[b] - this.pos[a], this.pos[b + 1] - this.pos[a + 1], this.pos[b + 2] - this.pos[a + 2]);
    }
    this.springForce = new Float32Array(ns * 3);
  }

  private step(dt: number) {
    const { pos, force, mask, springs, rest, springForce, cfg } = this;
    const ns = rest.length;
    // 1) forza di ogni molla
    for (let s = 0; s < ns; s++) {
      const a = springs[2 * s] * 3, b = springs[2 * s + 1] * 3;
      const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
      const dist = Math.max(1e-6, Math.hypot(dx, dy, dz));
      const k = ((dist - rest[s]) * cfg.stiffness * 0.5) / dist;
      springForce[3 * s] = dx * k; springForce[3 * s + 1] = dy * k; springForce[3 * s + 2] = dz * k;
    }
    // 2) ogni vertice: smorzamento, molle, gravita', vento, limite, sposta
    for (let s = 0; s < ns; s++) {
      const a = springs[2 * s], b = springs[2 * s + 1];
      const fx = springForce[3 * s], fy = springForce[3 * s + 1], fz = springForce[3 * s + 2];
      // (lo smorzamento si applica sotto, una volta per vertice)
      force[3 * a] += fx; force[3 * a + 1] += fy; force[3 * a + 2] += fz;
      force[3 * b] -= fx; force[3 * b + 1] -= fy; force[3 * b + 2] -= fz;
    }
    const g = cfg.gravity, w = cfg.wind, gdt = dt * dt;
    for (let i = 0; i < this.n; i++) {
      const j = 3 * i;
      if (mask[i] === 0) { force[j] = force[j + 1] = force[j + 2] = 0; continue; }
      const noise = (triNoise3D(pos[j], pos[j + 1], pos[j + 2], 1, this.time) - 0.2) * 0.1;
      let fx = force[j] + g[0] * gdt + noise * w[0] * dt;
      let fy = force[j + 1] + g[1] * gdt + noise * w[1] * dt;
      let fz = force[j + 2] + g[2] * gdt + noise * w[2] * dt;
      const len = Math.hypot(fx, fy, fz);
      if (len > cfg.maxForce) { const k = cfg.maxForce / len; fx *= k; fy *= k; fz *= k; }
      pos[j] += fx; pos[j + 1] += fy; pos[j + 2] += fz;
      // smorzamento per il passo successivo (nell'originale: force *= dampening all'inizio)
      force[j] = fx * cfg.dampening; force[j + 1] = fy * cfg.dampening; force[j + 2] = fz * cfg.dampening;
    }
  }

  // delta = secondi dall'ultimo fotogramma; passi fissi come l'originale
  update(delta: number) {
    const dt = 1 / this.cfg.stepsPerSecond;
    this.acc += Math.min(delta, 1 / 60);
    while (this.acc >= dt) {
      this.acc -= dt;
      this.time += dt;
      this.step(dt);
    }
  }
}
