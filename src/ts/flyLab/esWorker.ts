// Worker del laboratorio: valuta individui (parametri perturbati) giocando
// episodi con la fisica Rapier, senza grafica. Stesso codice del trainer Node.
/// <reference lib="webworker" />
import RAPIER from '@dimforge/rapier3d-compat';
import { buildAssets, FlyEnv, type Task } from '../flyBrain/flyEnv';
import { perturbed } from '../flyBrain/es';

let env: FlyEnv | null = null;
let eps: Float32Array | null = null;
let theta: Float32Array | null = null;

const fetchBuf = (u: string) => fetch(u).then((r) => {
  if (!r.ok) throw new Error(u + ' ' + r.status);
  return r.arrayBuffer();
});

async function init() {
  await RAPIER.init();
  const [model, a1, a2, graphJson, edges] = await Promise.all([
    fetchBuf('/soldier-citizen.glb'),
    fetchBuf('/soldier-citizen-base-animations.glb'),
    fetchBuf('/soldier-citizen-addon-animations.glb'),
    fetch('/fly-brain/fly-brain.json').then((r) => r.json()),
    fetchBuf('/fly-brain/fly-brain-edges.bin'),
  ]);
  const A = buildAssets(RAPIER, { model, anims: [a1, a2], graphJson, edges });
  env = new FlyEnv(A);
  eps = new Float32Array(A.layout.nParams);
  theta = new Float32Array(A.layout.nParams);
  return { nParams: A.layout.nParams, neurons: A.graph.N, nAff: A.graph.nAff, nInt: A.graph.nInt, nEff: A.graph.nEff };
}

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      const info = await init();
      (self as any).postMessage({ type: 'ready', info });
      return;
    }
    if (msg.type === 'eval' && env && eps && theta) {
      const base = new Float32Array(msg.theta);
      const scores: number[] = [];
      let steps = 0;
      for (const job of msg.jobs as { seed: number; sign: number }[]) {
        perturbed(base, job.seed, job.sign, msg.sigma, eps, theta);
        let s = 0;
        for (const ep of msg.episodes as number[]) {
          const r = env.runEpisode(theta, msg.task as Task, ep, msg.seconds);
          s += r.score;
          steps += r.steps;
        }
        scores.push(s / msg.episodes.length);
      }
      (self as any).postMessage({ type: 'scores', id: msg.id, scores, steps });
    }
  } catch (e: any) {
    (self as any).postMessage({ type: 'error', message: String(e?.message ?? e) });
  }
};
