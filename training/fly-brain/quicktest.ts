import { loadAssets, FlyEnv } from './env';
import { initialParams } from '../../src/ts/flyBrain/connectomePolicy';
const A = await loadAssets();
console.log('neuroni', A.graph.N, 'parametri', A.layout.nParams, 'ingressi', A.layout.nIn, 'azioni', A.nAct);
const env = new FlyEnv(A);
const p = initialParams(A.layout);
for (const task of ['stand', 'walk', 'getup'] as const) {
  const t0 = performance.now();
  const r = env.runEpisode(p, task, 1);
  const ms = performance.now() - t0;
  console.log(task, JSON.stringify(r, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v)), `${ms.toFixed(0)} ms (${(ms / r.steps).toFixed(2)} ms/passo)`);
}
