// Prova dell'aiuto ("bretelle") e della velocita' a gradini per camminare: stessi parametri iniziali (uscite a zero = il
// corpo che segue l'animazione senza cervello), episodi uguali, aiuto 0 / 0.5 / 1 e velocita' 0.5 / 1.
//   npm run mosca:walkassist
import { loadAssets, FlyEnv } from './env';
import { initialParams } from '../../src/ts/flyBrain/connectomePolicy';
const A = await loadAssets();
const env = new FlyEnv(A);
const p = initialParams(A.layout);
for (const task of ['walk', 'stand'] as const) {
  for (const walkScale of task === 'walk' ? [0.5, 1] : [1]) {
    for (const assist of [0, 0.5, 1]) {
      const rs = [11, 12, 13].map((s) => env.runEpisode(p, task, s, 10, undefined, { assist, walkScale }));
      const m = (f: (r: (typeof rs)[number]) => number) => (rs.reduce((a, r) => a + f(r), 0) / rs.length).toFixed(3);
      console.log(`${task} vel ${walkScale} aiuto ${assist}: punteggio ${m((r) => r.score)} caduta ${rs.filter((r) => r.fell).length}/3 riuscito ${rs.filter((r) => r.up).length}/3 testa ${m((r) => r.headEnd)} distanza ${m((r) => r.dist)} m`);
    }
  }
}
