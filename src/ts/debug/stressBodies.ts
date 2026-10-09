import { useStore } from '../store';
import { crowdAgents, crowdSlotCount, crowdSlots, type CrowdAgent } from '../components/city/crowdSim';
import { explodeAt } from '../lib/explosions';

// "fai uno stress test per vedere quanti corpi veri con ragdoll attiva
// possiamo mettere contemporaneamente in citta'" (solo in sviluppo).
//
// window.__stress.run([0, 4, 8, 16, 24, 32, 40]) per ogni numero N:
//  1. raduna N passanti sul marciapiede piu' vicino al giocatore, fermi
//     (a meno di ~16 m da lui: tutti con la ragdoll attiva accesa, vedi
//     ACTIVE_ON_DIST in useMannequinActor.ts) e chiede N corpi veri
//  2. aspetta che i corpi siano montati e assegnati, poi misura per qualche
//     secondo: tempo tra un frame e l'altro (media e 95esimo percentile),
//     tempo di CPU del frame (tutto il giro di R3F: logica, animazioni,
//     fisica, invio al rendering), tempo della sola fisica (world.step) e
//     corpi rigidi nel mondo
//  3. se kill: un'esplosione in mezzo a loro (morti in ragdoll tutti
//     insieme, il caso peggiore) e un'altra misura
// Alla fine rimette i corpi veri e la ragdoll attiva come erano.

type RapierWorld = {
  step: (...args: unknown[]) => unknown;
  bodies: { len: () => number };
};

let world: RapierWorld | null = null;
let recording = false;
let cpuMs: number[] = [];
let physMs = 0;
let physSteps = 0;

export function setStressWorld(w: unknown) {
  world = w as RapierWorld;
  const wa = world as RapierWorld & { __stressWrapped?: boolean };
  if (!wa || wa.__stressWrapped) return;
  wa.__stressWrapped = true;
  const step = wa.step.bind(wa);
  wa.step = (...args: unknown[]) => {
    const t = performance.now();
    const r = step(...args);
    if (recording) {
      physMs += performance.now() - t;
      physSteps++;
    }
    return r;
  };
}

// tempo di CPU per frame del giro di R3F: un useFrame per primo e uno per
// ultimo (tutti gli altri in mezzo: logica, animazioni, fisica) piu' la
// chiamata di rendering (gl.render), letti da window.__r3fState
const rawRaf = window.requestAnimationFrame.bind(window);
let frameT0 = 0;
let subsMs = 0;
let renderAcc = 0;
let hookedGl: unknown = null;
// spezzati: logica (useFrame) e rendering, per frame
let logicMs: number[] = [];
let drawMs: number[] = [];
type Sub = { ref: { current: () => void }; priority: number; store: { getState: () => unknown } };
const firstSub: Sub = {
  ref: {
    current: () => {
      // chiude il frame precedente
      if (recording && frameT0 > 0) {
        cpuMs.push(subsMs + renderAcc);
        logicMs.push(subsMs);
        drawMs.push(renderAcc);
      }
      renderAcc = 0;
      frameT0 = performance.now();
    },
  },
  priority: -1e9,
  store: { getState: () => null },
};
const lastSub: Sub = { ref: { current: () => (subsMs = performance.now() - frameT0) }, priority: 0, store: { getState: () => null } };
function hookFrame() {
  const ref = (window as any).__r3fState;
  // lo stato vivo (quello salvato all'avvio non e' piu' quello usato dal giro)
  const st = ref?.get ? ref.get() : ref;
  if (!st) return;
  const internal = st.internal as { subscribers: Sub[] };
  // il primo in testa, l'ultimo dopo tutti quelli a priorita' <= 0 (rimessi
  // ogni volta: chi si iscrive dopo finirebbe dopo di lui)
  const others = internal.subscribers.filter((x) => x !== firstSub && x !== lastSub);
  const cut = others.findIndex((x) => x.priority > 0);
  const at = cut < 0 ? others.length : cut;
  internal.subscribers = [firstSub, ...others.slice(0, at), lastSub, ...others.slice(at)];
  if (hookedGl !== st.gl) {
    hookedGl = st.gl;
    const gl = st.gl as { render: (...a: unknown[]) => unknown };
    const render = gl.render.bind(gl);
    // (le ombre chiamano render dentro il render: conta solo il piu' esterno)
    let depth = 0;
    gl.render = (...a: unknown[]) => {
      const t = performance.now();
      depth++;
      try {
        return render(...a);
      } finally {
        depth--;
        if (depth === 0) renderAcc += performance.now() - t;
      }
    };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (a: number[], p: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const r1 = (v: number) => Math.round(v * 10) / 10;

async function measure(seconds: number) {
  cpuMs = [];
  logicMs = [];
  drawMs = [];
  physMs = 0;
  physSteps = 0;
  const frames: number[] = [];
  let last = performance.now();
  let on = true;
  const tick = () => {
    const now = performance.now();
    frames.push(now - last);
    last = now;
    if (on) rawRaf(tick);
  };
  hookFrame();
  recording = true;
  rawRaf(tick);
  await sleep(seconds * 1000);
  on = false;
  recording = false;
  frames.shift();
  const n = Math.max(1, frames.length);
  return {
    fps: r1(1000 / avg(frames)),
    frameMs: r1(avg(frames)),
    frameP95: r1(pct(frames, 0.95)),
    cpuMs: r1(avg(cpuMs)),
    cpuP95: r1(pct(cpuMs, 0.95)),
    logicMs: r1(avg(logicMs)),
    renderMs: r1(avg(drawMs)),
    physMs: r1(physMs / n),
    physSteps: r1(physSteps / n),
    bodies: world?.bodies.len() ?? -1,
  };
}

// N passanti sul marciapiede piu' vicino, fermi intorno al giocatore
function huddle(n: number, spreadM: number): { x: number; z: number } | null {
  const pp = useStore.getState().playerPos;
  const live = crowdAgents.filter((a) => !a.gone && a.fear <= 0);
  if (!live.length) return null;
  const byDist = (a: CrowdAgent) => (a.x - pp[0]) ** 2 + (a.z - pp[2]) ** 2;
  live.sort((a, b) => byDist(a) - byDist(b));
  const ref = live[0];
  const mid = { x: (ref.x1 + ref.x2) / 2, z: (ref.z1 + ref.z2) / 2 };
  const picked = live.slice(0, n);
  picked.forEach((a, i) => {
    a.x1 = ref.x1;
    a.z1 = ref.z1;
    a.x2 = ref.x2;
    a.z2 = ref.z2;
    a.len = ref.len;
    a.turnAxis = null;
    // sparsi lungo +-spreadM intorno al centro del tratto
    const off = n > 1 ? (i / (n - 1) - 0.5) * 2 * spreadM : 0;
    a.t = Math.min(0.98, Math.max(0.02, 0.5 + off / Math.max(1, ref.len)));
    a.activity = 'linger';
    a.pause = 600;
    a.idleClip = 'Idle_A';
    a.curSpeed = 0;
  });
  return mid;
}

const assigned = (n: number) => {
  let c = 0;
  for (let s = 0; s < crowdSlotCount(); s++) if (crowdSlots[s] && !crowdSlots[s]!.gone) c++;
  return Math.min(c, n);
};

export async function runStress(
  counts: number[] = [0, 4, 8, 16, 24, 32, 40],
  opts: { seconds?: number; kill?: boolean; active?: boolean } = {}
) {
  hookFrame();
  const st = useStore.getState();
  const before = { bodies: st.crowdBodies, active: st.crowdActiveRagdoll, euph: st.euphoriaRagdollEnabled };
  // active: false = corpi veri senza ragdoll attiva (per confronto)
  st.setCrowdActiveRagdoll(opts.active ?? true);
  st.setEuphoriaRagdollEnabled(true);
  const seconds = opts.seconds ?? 4;
  const rows: Record<string, unknown>[] = [];
  for (const n of counts) {
    useStore.getState().setCrowdBodies(0);
    await sleep(800);
    const mid = huddle(n, Math.min(15, 0.8 * n));
    if (!mid) break;
    // il giocatore in mezzo a loro
    (window as any).__pcsDebug?.teleport(mid.x, mid.z);
    useStore.getState().setCrowdBodies(n);
    const t0 = performance.now();
    while (assigned(n) < n && performance.now() - t0 < 20000) await sleep(250);
    await sleep(2000);
    const alive = await measure(seconds);
    const row: Record<string, unknown> = { corpi: n, assegnati: assigned(n), ...alive };
    if (opts.kill && n > 0) {
      explodeAt([mid.x, 0.5, mid.z], { radius: 20, power: 1.2, damage: 500, source: 'stress test', ignore: 'player' });
      await sleep(300);
      const dead = await measure(seconds);
      row.morti_fps = dead.fps;
      row.morti_frameP95 = dead.frameP95;
      row.morti_physMs = dead.physMs;
    }
    rows.push(row);
    console.log('[stress]', row);
  }
  const s2 = useStore.getState();
  s2.setCrowdBodies(before.bodies);
  s2.setCrowdActiveRagdoll(before.active);
  s2.setEuphoriaRagdollEnabled(before.euph);
  console.table(rows);
  return rows;
}

if (import.meta.env.DEV) (window as any).__stress = { run: runStress, measure };
