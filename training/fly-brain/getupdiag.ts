// Diagnosi "alzarsi": quanto sale la testa nel tempo, per ogni cervello.
// uso: node ... getupdiag.ts [secondi]
import fs from 'node:fs';
import path from 'node:path';
import { loadAssets, FlyEnv } from './env';
import { decodeParams, brainFileSuffix, ALL_BRAINS } from '../../src/ts/flyBrain/connectomePolicy';
const secs = +(process.argv[2] ?? 20);
for (const b of ALL_BRAINS) {
  const f = path.resolve(import.meta.dirname, '../../public/fly-brain', `weights-getup${brainFileSuffix(b)}.json`);
  if (!fs.existsSync(f)) continue;
  const A = await loadAssets(b);
  if (b === 'real') console.log(`LayToIdle dura ${A.clips['LayToIdle'].duration.toFixed(2)} s (al rallentatore x0.5 = ${(A.clips['LayToIdle'].duration * 2).toFixed(1)} s)`);
  const env = new FlyEnv(A);
  const p = decodeParams(JSON.parse(fs.readFileSync(f, 'utf8')).params);
  const rows: string[] = [];
  for (let ep = 0; ep < 4; ep++) {
    const hs: number[] = [];
    env.runEpisode(p, 'getup', 7000 + ep, secs, (fb, t) => { if (Math.abs(t * 2 - Math.round(t * 2)) < 1e-3 || hs.length === 0) hs.push(fb.bySeg.Head.body.translation().y); });
    const t12 = hs.findIndex((h) => h > 1.2);
    rows.push(`max ${Math.max(...hs).toFixed(2)} m, 1.2 m ${t12 >= 0 ? 'a ' + (t12 / 2).toFixed(1) + ' s' : 'mai'}  [${hs.filter((_, i) => i % 4 === 0).map((h) => h.toFixed(2)).join(' ')}]`);
  }
  console.log(b.padEnd(10), '\n  ' + rows.join('\n  '));
}
