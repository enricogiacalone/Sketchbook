// Addestramento del cervello-connettoma con Evolution Strategies (OpenAI
// ES, Salimans et al. 2017): popolazioni di piccole mutazioni dei
// parametri, ognuna prova un episodio, si sposta la media verso le
// mutazioni che hanno fatto meglio. Solo passaggi in avanti della rete =
// JavaScript puro, parallelo su tutti i core (worker_threads).
//
// Uso (dalla cartella del progetto):
//   node --import ./training/fly-brain/register.mjs training/fly-brain/train.ts --task stand
//   opzioni: --task stand|walk|getup  --gens 300  --pop 96  --sigma 0.01  --lr 0.003
//            --from <file pesi di partenza>  --workers N
// Salva public/fly-brain/weights-<task>.json (il gioco lo carica) e
// training/fly-brain/log-<task>.csv. Riparte da dove era se il file c'e'.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAssets, FlyEnv, nextAssist, GETUP_METHOD, type Task } from './env';
import { EsOptimizer, generationSeeds, perturbed } from '../../src/ts/flyBrain/es';
import { initialParams, encodeParams, decodeParams, fitParams, weightsMatchDynamics, NEURON_LEAK, isBrainVariant, brainFileSuffix, type FlyWeightsFile, type BrainVariant } from '../../src/ts/flyBrain/connectomePolicy';
import { FLY_BODY_VERSION } from '../../src/ts/flyBrain/flyBody';

if (!isMainThread) {
  const A = await loadAssets((workerData?.brain ?? 'real') as BrainVariant);
  const env = new FlyEnv(A);
  const eps = new Float32Array(A.layout.nParams);
  const theta = new Float32Array(A.layout.nParams);
  parentPort!.on('message', (msg: any) => {
    const base = new Float32Array(msg.theta);
    const scores: number[] = [], ups: number[] = [];
    for (const job of msg.jobs as { seed: number; sign: number }[]) {
      perturbed(base, job.seed, job.sign, msg.sigma, eps, theta);
      let s = 0, u = 0;
      for (const ep of msg.episodes as number[]) {
        const r = env.runEpisode(theta, msg.task as Task, ep, msg.seconds, undefined, { push: msg.push ?? 0, assist: msg.assist ?? 0, rsi: !!msg.rsi });
        s += r.score;
        u += r.up ? 1 : 0;
      }
      scores.push(s / msg.episodes.length);
      ups.push(u / msg.episodes.length);
    }
    parentPort!.postMessage({ scores, ups });
  });
  parentPort!.postMessage('ready');
} else {
  const args = process.argv.slice(2);
  const opt = (k: string, d: string) => {
    const i = args.indexOf('--' + k);
    return i >= 0 ? args[i + 1] : d;
  };
  const task = opt('task', 'stand') as Task;
  // --brain shuffled = gruppo di controllo col connettoma rimescolato
  const brainArg = opt('brain', 'real');
  const brain: BrainVariant = isBrainVariant(brainArg) ? brainArg : 'real';
  const suffix = brainFileSuffix(brain);
  const gens = +opt('gens', '300');
  const pop = Math.max(4, Math.floor(+opt('pop', '96') / 2) * 2);
  const sigma = +opt('sigma', '0.01');
  const lr = +opt('lr', '0.003');
  const seconds = +opt('seconds', '10');
  // --push 30 = spinte casuali da ~30 N*s durante gli episodi
  const push = +opt('push', '0');
  const nWorkers = +opt('workers', String(Math.max(1, (os.availableParallelism?.() ?? os.cpus().length) - 1)));
  const root = path.resolve(import.meta.dirname, '../..');
  const outFile = path.join(root, 'public/fly-brain', `weights-${task}${suffix}.json`);
  const logFile = path.join(import.meta.dirname, `log-${task}${suffix}.csv`);
  const A = await loadAssets(brain);
  const P = A.layout.nParams;
  let theta = initialParams(A.layout);
  let gen0 = 0;
  // senza pesi propri, alzarsi/camminare partono dal cervello che sa gia' stare in piedi
  const standFile = path.join(root, 'public/fly-brain', `weights-stand${suffix}.json`);
  // alzarsi: "mano che aiuta" (0..1); riparte dal valore salvato nei pesi
  let assist = task === 'getup' ? +opt('assist', '1') : 0;
  const from = opt('from', fs.existsSync(outFile) ? outFile : task !== 'stand' && fs.existsSync(standFile) ? standFile : '');
  if (from) {
    const w = JSON.parse(fs.readFileSync(from, 'utf8')) as FlyWeightsFile;
    const p = fitParams(A.layout, decodeParams(w.params));
    if (p && w.bodyVersion === FLY_BODY_VERSION && weightsMatchDynamics(w) && (w.brain ?? 'real') === brain) {
      theta = p;
      gen0 = w.task === task ? w.generation : 0;
      const wa = (w as any).assist;
      if (task === 'getup' && w.task === 'getup' && (w as any).getupMethod !== GETUP_METHOD && !args.includes('--from')) {
        // addestrato col metodo vecchio (senza aiuto): si riparte da "in piedi"
        const st = path.join(root, 'public/fly-brain', `weights-stand${suffix}.json`);
        const ws = fs.existsSync(st) ? JSON.parse(fs.readFileSync(st, 'utf8')) : null;
        theta = (ws && weightsMatchDynamics(ws) && fitParams(A.layout, decodeParams(ws.params))) || initialParams(A.layout);
        gen0 = 0;
        console.log('pesi di "alzarsi" del metodo vecchio: riparto da "in piedi"');
      } else if (task === 'getup' && typeof wa === 'number' && !args.includes('--assist')) assist = wa;
      console.log(`riparto da ${path.basename(from)} (gen ${w.generation}, punteggio ${w.score.toFixed(3)})`);
    } else console.log('pesi di partenza per un altro corpo/cervello, ignorati: si parte da zero');
  }
  console.log(`cervello: ${A.graph.N} neuroni (${A.graph.nAff} ascendenti, ${A.graph.nInt} intermedi, ${A.graph.nEff} discendenti), ${P} parametri`);
  console.log(`cervello: ${brain === 'real' ? 'connettoma vero' : `connettoma RIMESCOLATO (controllo ${brain})`}`);
  console.log(`compito ${task}, popolazione ${pop}, sigma ${sigma}, lr ${lr}, worker ${nWorkers}`);

  const here = fileURLToPath(import.meta.url);
  const workers = await Promise.all(
    Array.from({ length: nWorkers }, () =>
      new Promise<Worker>((res) => {
        const w = new Worker(here, { workerData: { brain }, execArgv: ['--import', path.join(import.meta.dirname, 'register.mjs')] });
        w.once('message', () => res(w));
      })
    )
  );
  const evalJobs = async (th: Float32Array, jobs: { seed: number; sign: number }[], episodes: number[], rsi: boolean) => {
    const chunks: { seed: number; sign: number }[][] = workers.map(() => []);
    jobs.forEach((j, i) => chunks[i % workers.length].push(j));
    const res = await Promise.all(
      workers.map(
        (w, wi) =>
          new Promise<{ scores: number[]; ups: number[] }>((resolve) => {
            if (!chunks[wi].length) return resolve({ scores: [], ups: [] });
            w.once('message', resolve);
            w.postMessage({ theta: th.buffer.slice(0), jobs: chunks[wi], sigma, task, episodes, seconds, push, assist, rsi });
          })
      )
    );
    const out = new Array<number>(jobs.length), ups = new Array<number>(jobs.length);
    res.forEach((r, wi) => r.scores.forEach((v, k) => {
      out[wi + k * workers.length] = v;
      ups[wi + k * workers.length] = r.ups[k];
    }));
    return { scores: out, ups };
  };

  const es = new EsOptimizer(theta, sigma, lr);
  if (!fs.existsSync(logFile)) fs.writeFileSync(logFile, 'gen,media_pop,migliore,centro,cadute_pct,sec\n');
  let best = -Infinity;
  for (let g = gen0 + 1; g <= gen0 + gens; g++) {
    const t0 = Date.now();
    const seeds = generationSeeds(g, pop / 2);
    const jobs = seeds.flatMap((s) => [{ seed: s, sign: 1 }, { seed: s, sign: -1 }]);
    // stessi episodi (fase di partenza) per tutti: confronto equo
    const episodes = [g * 31 + 1, g * 31 + 2];
    const { scores } = await evalJobs(theta, jobs, episodes, task === 'getup');
    es.step(seeds, scores);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const top = Math.max(...scores);
    let centre = mean;
    const aUsed = assist;
    let upTxt = '';
    if (g % 5 === 0 || g === gen0 + 1) {
      const c = await evalJobs(theta, [{ seed: 0, sign: 1 }], [1000 + g, 2000 + g, 3000 + g], false);
      centre = c.scores[0];
      if (task === 'getup' && g % 5 === 0) {
        assist = nextAssist(assist, c.ups[0]);
        upTxt = `  alzato ${Math.round(c.ups[0] * 100)}%`;
      }
    }
    const sec = (Date.now() - t0) / 1000;
    fs.appendFileSync(logFile, `${g},${mean.toFixed(4)},${top.toFixed(4)},${centre.toFixed(4)},,${sec.toFixed(1)}\n`);
    console.log(`gen ${g}  media ${mean.toFixed(3)}  migliore ${top.toFixed(3)}  centro ${centre.toFixed(3)}${task === 'getup' ? `  aiuto ${Math.round(aUsed * 100)}%${upTxt}` : ''}  ${sec.toFixed(1)}s`);
    if (g % 5 === 0 || g === gen0 + gens) {
      const file: FlyWeightsFile = { task, brain, bodyVersion: FLY_BODY_VERSION, neuronLeak: NEURON_LEAK.value, nIn: A.layout.nIn, nOut: A.layout.nOut, fanIn: A.layout.fanIn, passes: A.layout.passes, generation: g, score: centre, params: encodeParams(theta), ...(task === 'getup' ? { assist, getupMethod: GETUP_METHOD } : {}) } as FlyWeightsFile;
      fs.writeFileSync(outFile, JSON.stringify(file));
      if (centre > best) {
        best = centre;
        fs.writeFileSync(outFile.replace('.json', '-best.json'), JSON.stringify(file));
      }
    }
  }
  await Promise.all(workers.map((w) => w.terminate()));
}
