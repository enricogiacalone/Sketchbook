// Evolution Strategies (OpenAI ES, Salimans et al. 2017) -- la matematica,
// condivisa da trainer Node e laboratorio nel browser. Il rumore di ogni
// individuo si rigenera dal suo seme (i worker non ricevono vettori).
import { rng } from './flyEnv';

export function noise(seed: number, n: number, out: Float32Array) {
  const r = rng(seed * 2654435761);
  for (let i = 0; i < n; i += 2) {
    const u = Math.max(1e-12, r()), v = r();
    const m = Math.sqrt(-2 * Math.log(u));
    out[i] = m * Math.cos(2 * Math.PI * v);
    if (i + 1 < n) out[i + 1] = m * Math.sin(2 * Math.PI * v);
  }
}

// semi delle coppie antitetiche (+eps, -eps) di una generazione
export function generationSeeds(gen: number, pairs: number): number[] {
  return Array.from({ length: pairs }, (_, i) => 1 + ((gen * 100003 + i * 7919) % 2147483646));
}

// parametri perturbati di un individuo
export function perturbed(base: Float32Array, seed: number, sign: number, sigma: number, eps: Float32Array, out: Float32Array) {
  if (seed === 0) {
    out.set(base);
    return out;
  }
  noise(seed, eps.length, eps);
  for (let i = 0; i < out.length; i++) out[i] = base[i] + sign * sigma * eps[i];
  return out;
}

export class EsOptimizer {
  P: number;
  theta: Float32Array;
  sigma: number;
  lr: number;
  weightDecay = 0.005;
  private m: Float32Array;
  private v: Float32Array;
  private t = 0;
  private eps: Float32Array;
  private grad: Float32Array;
  constructor(theta: Float32Array, sigma: number, lr: number) {
    this.P = theta.length;
    this.theta = theta;
    this.sigma = sigma;
    this.lr = lr;
    this.m = new Float32Array(this.P);
    this.v = new Float32Array(this.P);
    this.eps = new Float32Array(this.P);
    this.grad = new Float32Array(this.P);
  }
  // scores[2k] = +eps del seme k, scores[2k+1] = -eps
  step(seeds: number[], scores: number[]) {
    const { P, theta, eps, grad, m, v } = this;
    const idx = scores.map((_, i) => i).sort((a, b) => scores[a] - scores[b]);
    const rank = new Float32Array(scores.length);
    idx.forEach((i, r) => (rank[i] = r / (scores.length - 1) - 0.5));
    grad.fill(0);
    for (let k = 0; k < seeds.length; k++) {
      const w = rank[2 * k] - rank[2 * k + 1];
      if (w === 0) continue;
      noise(seeds[k], P, eps);
      for (let i = 0; i < P; i++) grad[i] += w * eps[i];
    }
    const scale = 1 / (scores.length * this.sigma);
    this.t++;
    const b1 = 0.9, b2 = 0.999;
    for (let i = 0; i < P; i++) {
      const gi = -grad[i] * scale + this.weightDecay * theta[i];
      m[i] = b1 * m[i] + (1 - b1) * gi;
      v[i] = b2 * v[i] + (1 - b2) * gi * gi;
      const mh = m[i] / (1 - b1 ** this.t), vh = v[i] / (1 - b2 ** this.t);
      theta[i] -= (this.lr * mh) / (Math.sqrt(vh) + 1e-8);
    }
  }
}
