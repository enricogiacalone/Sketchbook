// "alzarsi" senza cervello (solo inseguimento dell'animazione) con diversi
// livelli di aiuto: serve a tarare la "mano che aiuta".
// uso: node ... getupbase.ts 0,0.5,1 [g,k,d,maxG]
import { loadAssets, FlyEnv, tuneAssist } from './env';
import { initialParams } from '../../src/ts/flyBrain/connectomePolicy';
const A = await loadAssets('real');
const env = new FlyEnv(A);
const p = initialParams(A.layout);
const levels = (process.argv[2] ?? '0,0.5,1').split(',').map(Number);
if (process.argv[3]) { const [g, k, d, m] = process.argv[3].split(',').map(Number); tuneAssist(g, k, d, m); }
for (const a of levels) {
  const hs: number[] = [];
  const r = env.runEpisode(p, 'getup', 7000, 10, (fb, t) => { if (Math.round(t * 30) % 15 === 0) hs.push(fb.bySeg.Head.body.translation().y); }, { assist: a });
  console.log(`aiuto ${a}: testa max ${Math.max(...hs).toFixed(2)} fine ${r.headEnd.toFixed(2)} ${r.up ? 'ALZATO' : ''} punteggio ${r.score.toFixed(3)}  [${hs.map((h) => h.toFixed(2)).join(' ')}]`);
}
