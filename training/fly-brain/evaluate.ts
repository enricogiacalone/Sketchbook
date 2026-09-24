// Confronto: corpo senza cervello (solo animazione) contro cervello addestrato.
// uso: npm run mosca:eval -- --task stand
import fs from 'node:fs';
import path from 'node:path';
import { loadAssets, FlyEnv, type Task } from './env';
import { initialParams, decodeParams } from '../../src/ts/flyBrain/connectomePolicy';
const args = process.argv.slice(2);
const task = (args[args.indexOf('--task') + 1] ?? 'stand') as Task;
const A = await loadAssets();
const env = new FlyEnv(A);
const file = path.resolve(import.meta.dirname, '../../public/fly-brain', `weights-${task}.json`);
const trained = fs.existsSync(file) ? decodeParams(JSON.parse(fs.readFileSync(file, 'utf8')).params) : null;
for (const [name, p] of [['senza cervello', initialParams(A.layout)], ['cervello addestrato', trained]] as const) {
  if (!p) continue;
  const rs = Array.from({ length: 12 }, (_, i) => env.runEpisode(p, task, 5000 + i, 10));
  const up = rs.map((r) => r.steps / 30);
  console.log(`${name.padEnd(20)} punteggio medio ${(rs.reduce((s, r) => s + r.score, 0) / rs.length).toFixed(3)}  in piedi per (s): ${up.map((u) => u.toFixed(1)).join(' ')}  media ${(up.reduce((a, b) => a + b, 0) / up.length).toFixed(1)} s`);
}
