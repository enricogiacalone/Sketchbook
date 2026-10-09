import { loadAssets, FlyEnv } from './env';
import { initialParams, ConnectomeBrain } from '../../src/ts/flyBrain/connectomePolicy';
const A = await loadAssets();
const env = new FlyEnv(A);
const p = initialParams(A.layout);
// monkeypatch: registra le attivita' del cervello durante l'episodio
const orig = ConnectomeBrain.prototype.step;
const stats: number[][] = [];
ConnectomeBrain.prototype.step = function (inp: Float32Array, out: Float32Array) {
  orig.call(this, inp, out);
  const roles = this.g.roles; const acc = [[0,0,0],[0,0,0],[0,0,0]];
  for (let i = 0; i < this.h.length; i++) { const a = Math.abs(this.h[i]); acc[roles[i]][0] += a; acc[roles[i]][1] += a > 0.95 ? 1 : 0; acc[roles[i]][2]++; }
  stats.push(acc.map(([s, sat, n]) => [s / n, sat / n]).flat());
  let inAbs = 0; for (let i = 0; i < inp.length; i++) inAbs += Math.abs(inp[i]); (this as any)._in = inAbs / inp.length;
};
const r = env.runEpisode(p, 'stand', 3);
const avg = stats[0].map((_, j) => stats.reduce((s, x) => s + x[j], 0) / stats.length);
console.log('episode', r.steps, 'passi');
console.log('media |h| e saturazione: afferenti', avg[0].toFixed(3), avg[1].toFixed(3), ' intermedi', avg[2].toFixed(3), avg[3].toFixed(3), ' discendenti', avg[4].toFixed(3), avg[5].toFixed(3));
