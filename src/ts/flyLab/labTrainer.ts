// Regista dell'addestramento nel browser: pool di worker + ottimizzatore ES.
import { EsOptimizer, generationSeeds } from '../flyBrain/es';
import { encodeParams, type FlyWeightsFile } from '../flyBrain/connectomePolicy';
import type { FlyTask } from '../flyBrain/flyController';

export interface GenStats {
  gen: number;
  mean: number;
  best: number;
  centre: number | null;
  sec: number;
  stepsPerSec: number;
}

export interface LabConfig {
  task: FlyTask;
  pop: number;
  sigma: number;
  lr: number;
  seconds: number;
  workers: number;
}

export class LabTrainer {
  cfg: LabConfig;
  workers: Worker[] = [];
  nParams = 0;
  brainInfo: { neurons: number; nAff: number; nInt: number; nEff: number } | null = null;
  opt: EsOptimizer | null = null;
  gen = 0;
  history: GenStats[] = [];
  running = false;
  bestCentre = -Infinity;
  onGen?: (s: GenStats) => void;
  onError?: (m: string) => void;
  private nextId = 1;

  constructor(cfg: LabConfig) {
    this.cfg = cfg;
  }

  async start(nWorkers: number) {
    this.workers = await Promise.all(
      Array.from({ length: nWorkers }, () =>
        new Promise<Worker>((resolve, reject) => {
          const w = new Worker(new URL('./esWorker.ts', import.meta.url), { type: 'module' });
          w.onmessage = (ev) => {
            if (ev.data.type === 'ready') {
              this.nParams = ev.data.info.nParams;
              this.brainInfo = ev.data.info;
              resolve(w);
            } else if (ev.data.type === 'error') reject(new Error(ev.data.message));
          };
          w.onerror = (e) => reject(new Error(e.message));
          w.postMessage({ type: 'init' });
        })
      )
    );
  }

  setParams(theta: Float32Array, gen: number, history: GenStats[]) {
    this.opt = new EsOptimizer(theta, this.cfg.sigma, this.cfg.lr);
    this.gen = gen;
    this.history = history;
  }

  private evalJobs(theta: Float32Array, jobs: { seed: number; sign: number }[], episodes: number[]) {
    const W = this.workers;
    const chunks: { seed: number; sign: number }[][] = W.map(() => []);
    jobs.forEach((j, i) => chunks[i % W.length].push(j));
    let steps = 0;
    return Promise.all(
      W.map(
        (w, wi) =>
          new Promise<number[]>((resolve, reject) => {
            if (!chunks[wi].length) return resolve([]);
            const id = this.nextId++;
            const handler = (ev: MessageEvent) => {
              if (ev.data.type === 'scores' && ev.data.id === id) {
                w.removeEventListener('message', handler);
                steps += ev.data.steps;
                resolve(ev.data.scores);
              } else if (ev.data.type === 'error') {
                w.removeEventListener('message', handler);
                reject(new Error(ev.data.message));
              }
            };
            w.addEventListener('message', handler);
            w.postMessage({ type: 'eval', id, theta: theta.buffer.slice(0), jobs: chunks[wi], sigma: this.cfg.sigma, task: this.cfg.task, episodes, seconds: this.cfg.seconds });
          })
      )
    ).then((res) => {
      const out = new Array<number>(jobs.length);
      res.forEach((r, wi) => r.forEach((v, k) => (out[wi + k * W.length] = v)));
      return { scores: out, steps };
    });
  }

  // una generazione
  async step(): Promise<GenStats> {
    const opt = this.opt!;
    opt.sigma = this.cfg.sigma;
    opt.lr = this.cfg.lr;
    const g = ++this.gen;
    const t0 = performance.now();
    const pairs = Math.max(2, Math.floor(this.cfg.pop / 2));
    const seeds = generationSeeds(g, pairs);
    const jobs = seeds.flatMap((s) => [{ seed: s, sign: 1 }, { seed: s, sign: -1 }]);
    const { scores, steps } = await this.evalJobs(opt.theta, jobs, [g * 31 + 1, g * 31 + 2]);
    opt.step(seeds, scores);
    let centre: number | null = null;
    let extra = 0;
    if (g % 5 === 0) {
      const r = await this.evalJobs(opt.theta, [{ seed: 0, sign: 1 }], [1000 + g, 2000 + g, 3000 + g]);
      centre = r.scores[0];
      extra = r.steps;
    }
    const sec = (performance.now() - t0) / 1000;
    const st: GenStats = {
      gen: g,
      mean: scores.reduce((a, b) => a + b, 0) / scores.length,
      best: Math.max(...scores),
      centre,
      sec,
      stepsPerSec: ((steps + extra) * 4) / sec,
    };
    this.history.push(st);
    if (this.history.length > 5000) this.history.shift();
    return st;
  }

  async loop() {
    this.running = true;
    while (this.running) {
      try {
        const st = await this.step();
        this.onGen?.(st);
      } catch (e: any) {
        this.running = false;
        this.onError?.(String(e?.message ?? e));
      }
    }
  }

  stop() {
    this.running = false;
  }

  dispose() {
    this.running = false;
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }

  weightsFile(score: number): FlyWeightsFile & { history: GenStats[] } {
    return {
      task: this.cfg.task,
      nIn: 0,
      nOut: 0,
      fanIn: 16,
      passes: 3,
      generation: this.gen,
      score,
      params: encodeParams(this.opt!.theta),
      history: this.history,
    };
  }
}
