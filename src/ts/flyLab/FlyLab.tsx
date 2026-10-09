import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { Physics, RigidBody, CuboidCollider } from '@react-three/rapier';
import LabFly, { type LabFlyStatus } from './LabFly';
import PeaceFlag from './PeaceFlag';
import { LabTrainer, type GenStats, type LabConfig } from './labTrainer';
import {
  parseFlyGraph, graphForVariant, makeLayout, initialParams, decodeParams, fitParams, weightsMatchDynamics, brainFileSuffix,
  type FlyGraph, type FlyWeightsFile, type BrainVariant, type PolicyLayout,
} from '../flyBrain/connectomePolicy';
import { flyDims, FLY_BODY_VERSION } from '../flyBrain/flyBody';
import { N_CMD, type FlyTask } from '../flyBrain/flyController';
import { GETUP_METHOD } from '../flyBrain/flyEnv';

// Laboratorio cervello mosca (terza voce del menu). Esperimento:
// "connettoma VERO contro connettoma RIMESCOLATO" -- due cervelli con gli
// stessi neuroni, gli stessi pesi e lo stesso numero di sinapsi per
// neurone; nel rimescolato pero' chi e' collegato a chi e' casuale (vedi
// shuffleGraph). Si addestrano IN CONTEMPORANEA, con gli stessi episodi e gli
// stessi parametri, ciascuno su meta' dei core; in scena tre ragdoll: vero
// (viola), rimescolato (arancio), senza cervello (grigio). Se la curva viola
// sta sopra quella arancio, il cablaggio evoluto della mosca aiuta anche un
// corpo umano.

const TASKS: { id: FlyTask; label: string; hint: string }[] = [
  { id: 'stand', label: 'Stare in piedi', hint: 'imitare Idle_A senza cadere' },
  { id: 'getup', label: 'Alzarsi da terra', hint: 'da sdraiato, imitare LayToIdle (al rallentatore) e restare su. Una "mano che aiuta" lo tira su e cala da sola quando ce la fa: il cervello vince quando l\'aiuto arriva a 0%' },
  { id: 'walk', label: 'Camminare', hint: 'imitare Walk avanzando a 0.73 m/s' },
];
const BRAINS: { id: BrainVariant; label: string; short: string; color: string }[] = [
  { id: 'real', label: 'connettoma vero', short: 'vero', color: '#a855f7' },
  { id: 'shuffled', label: 'rimescolato #1', short: '#1', color: '#f59e0b' },
  { id: 'shuffled2', label: 'rimescolato #2', short: '#2', color: '#22c55e' },
  { id: 'shuffled3', label: 'rimescolato #3', short: '#3', color: '#38bdf8' },
  { id: 'shuffled4', label: 'rimescolato #4', short: '#4', color: '#f472b6' },
  { id: 'shuffled5', label: 'rimescolato #5', short: '#5', color: '#facc15' },
];
const PUSHES = [
  { v: 0, label: 'nessuna' },
  { v: 15, label: 'leggere (15 N·s)' },
  { v: 30, label: 'medie (30 N·s)' },
  { v: 50, label: 'forti (50 N·s)' },
];

type Weights = FlyWeightsFile & { history?: GenStats[]; assist?: number; getupMethod?: number };

async function loadGraph(): Promise<FlyGraph> {
  const [j, b] = await Promise.all([
    fetch('/fly-brain/fly-brain.json').then((r) => r.json()),
    fetch('/fly-brain/fly-brain-edges.bin').then((r) => r.arrayBuffer()),
  ]);
  return parseFlyGraph(j, b);
}
async function loadWeights(task: FlyTask, b: BrainVariant): Promise<Weights | null> {
  try {
    // dal server di sviluppo (legge il disco); nella build, il file statico
    let r = await fetch(`/__flybrain/load?task=${task}${b !== 'real' ? '&brain=' + b : ''}`);
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) r = await fetch(`/fly-brain/weights-${task}${brainFileSuffix(b)}.json?t=${Date.now()}`);
    return r.ok ? ((await r.json()) as Weights) : null;
  } catch {
    return null;
  }
}
async function saveWeights(task: FlyTask, b: BrainVariant, w: Weights, best: boolean) {
  const r = await fetch(`/__flybrain/save?task=${task}${b !== 'real' ? '&brain=' + b : ''}${best ? '&best=1' : ''}`, { method: 'POST', body: JSON.stringify(w) });
  if (!r.ok) throw new Error(await r.text());
}

// ---------------------------------------------------------------- grafico
const Chart: React.FC<{ series: { color: string; history: GenStats[] }[]; baseline: number | null }> = ({ series, baseline }) => {
  const W = 330, H = 170, P = 28;
  const all = series.flatMap((s) => s.history);
  if (all.length < 2) return <div style={{ height: H, display: 'grid', placeItems: 'center', opacity: 0.5, fontSize: 12 }}>il grafico appare dopo qualche generazione</div>;
  const g0 = Math.min(...all.map((h) => h.gen)), g1 = Math.max(...all.map((h) => h.gen));
  const maxY = Math.max(0.3, baseline ?? 0, ...all.map((h) => Math.max(h.mean, h.centre ?? 0))) * 1.08;
  const X = (g: number) => P + ((g - g0) / Math.max(1, g1 - g0)) * (W - P - 6);
  const Y = (v: number) => H - 18 - (v / maxY) * (H - 28);
  const line = (arr: { g: number; v: number }[]) => arr.map((p, i) => `${i ? 'L' : 'M'}${X(p.g).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      {[0, 0.25, 0.5, 0.75, 1].filter((v) => v <= maxY).map((v) => (
        <g key={v}>
          <line x1={P} x2={W - 6} y1={Y(v)} y2={Y(v)} stroke="rgba(255,255,255,0.08)" />
          <text x={P - 4} y={Y(v) + 3} fill="rgba(255,255,255,0.5)" fontSize={9} textAnchor="end">{v}</text>
        </g>
      ))}
      {baseline !== null && (
        <>
          <line x1={P} x2={W - 6} y1={Y(baseline)} y2={Y(baseline)} stroke="#f87171" strokeDasharray="3 3" opacity={0.7} />
          <text x={W - 8} y={Y(baseline) - 3} fill="#f87171" fontSize={9} textAnchor="end" opacity={0.85}>senza cervello</text>
        </>
      )}
      {series.map((s, i) => (
        <g key={i}>
          <path d={line(s.history.map((h) => ({ g: h.gen, v: h.mean })))} stroke={s.color} opacity={0.3} fill="none" strokeWidth={1} />
          <path d={line(s.history.filter((h) => h.centre !== null).map((h) => ({ g: h.gen, v: h.centre as number })))} stroke={s.color} fill="none" strokeWidth={2} />
        </g>
      ))}
      <text x={P} y={H - 4} fill="rgba(255,255,255,0.5)" fontSize={9}>gen {g0}</text>
      <text x={W - 6} y={H - 4} fill="rgba(255,255,255,0.5)" fontSize={9} textAnchor="end">gen {g1}</text>
    </svg>
  );
};

// ------------------------------------------------- un cervello in addestramento
interface BrainRun {
  variant: BrainVariant;
  params: Float32Array | null;
  paramsVersion: number;
  gen: number;
  history: GenStats[];
  last: GenStats | null;
  trainer: React.MutableRefObject<LabTrainer | null>;
  status: React.MutableRefObject<LabFlyStatus>;
  best: React.MutableRefObject<number>;
  // alzarsi: livello attuale della "mano che aiuta" (0..1)
  assist: React.MutableRefObject<number>;
  setParams: (p: Float32Array | null) => void;
  bumpVersion: () => void;
  setGen: (g: number) => void;
  setHistory: (h: GenStats[]) => void;
  setLast: (s: GenStats | null) => void;
}
function useBrainRun(variant: BrainVariant): BrainRun {
  const [params, setParams] = useState<Float32Array | null>(null);
  const [paramsVersion, setPV] = useState(0);
  const [gen, setGen] = useState(0);
  const [history, setHistory] = useState<GenStats[]>([]);
  const [last, setLast] = useState<GenStats | null>(null);
  const trainer = useRef<LabTrainer | null>(null);
  const status = useRef<LabFlyStatus>({ upFor: 0, episodes: 0, bestUp: 0 });
  const best = useRef(-Infinity);
  const assist = useRef(1);
  return { variant, params, paramsVersion, gen, history, last, trainer, status, best, assist, setParams, bumpVersion: () => setPV((v) => v + 1), setGen, setHistory, setLast };
}

// media delle ultime n misure del cervello (smussa il rumore degli episodi)
const recentMean = (h: GenStats[], n = 5): number | null => {
  const c = h.filter((x) => x.centre !== null).slice(-n).map((x) => x.centre as number);
  return c.length ? c.reduce((a, b) => a + b, 0) / c.length : null;
};

const FlyLab: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const [graph, setGraph] = useState<FlyGraph | null>(null);
  const [task, setTask] = useState<FlyTask>('stand');
  // un "run" per ogni cervello possibile (numero fisso di hook)
  const r0 = useBrainRun('real');
  const r1 = useBrainRun('shuffled');
  const r2 = useBrainRun('shuffled2');
  const r3 = useBrainRun('shuffled3');
  const r4 = useBrainRun('shuffled4');
  const r5 = useBrainRun('shuffled5');
  const allRuns = [r0, r1, r2, r3, r4, r5];
  const runOf = (b: BrainVariant) => allRuns.find((r) => r.variant === b)!;
  const [controls, setControls] = useState<BrainVariant[]>(['shuffled']);
  const active: BrainVariant[] = ['real', ...controls];
  const graphs = useMemo(() => {
    const m: Partial<Record<BrainVariant, FlyGraph>> = {};
    if (graph) for (const b of BRAINS) m[b.id] = graphForVariant(graph, b.id);
    return m;
  }, [graph]);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState('carico il connettoma...');
  const [withBaseline, setWithBaseline] = useState(true);
  const [ghost, setGhost] = useState(false);
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  followRef.current = follow;
  const [restartNonce, setRestartNonce] = useState(0);
  const [pushNonce, setPushNonce] = useState(0);
  const [scenePush, setScenePush] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [baselineScore, setBaselineScore] = useState<number | null>(null);
  const baseStatus = useRef<LabFlyStatus>({ upFor: 0, episodes: 0, bestUp: 0 });
  const totalCores = Math.max(2, (navigator.hardwareConcurrency || 4) - 2);
  const [cfg, setCfg] = useState({ pop: 48, sigma: 0.01, lr: 0.003, seconds: 10, workers: totalCores, push: 0 });
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    loadGraph().then(setGraph).catch((e) => setMsg('errore connettoma: ' + e.message));
    return () => allRuns.forEach((r) => r.trainer.current?.dispose());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const layout: PolicyLayout | null = useMemo(() => {
    if (!graph) return null;
    const { nObs, nAct } = flyDims();
    return makeLayout(graph, nObs + N_CMD + nAct, nAct);
  }, [graph]);

  // pesi validi per questo corpo, altrimenti null
  const usable = (w: Weights | null) => {
    if (!w || w.bodyVersion !== FLY_BODY_VERSION || !weightsMatchDynamics(w) || !layout) return null;
    const d = decodeParams(w.params);
    return fitParams(layout, d);
  };
  // punto di partenza "da zero": per alzarsi/camminare si parte dal cervello
  // che sa gia' stare in piedi (lo stesso cervello: vero dal vero, #1 dal #1...)
  const freshStart = useCallback(async (b: BrainVariant, t: FlyTask): Promise<{ p: Float32Array; note: string }> => {
    if (t !== 'stand') {
      const ws = await loadWeights('stand', b);
      const d = usable(ws);
      if (d) return { p: d, note: `da "in piedi" gen ${ws!.generation}` };
    }
    return { p: initialParams(layout!), note: 'da zero' };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  const loadRun = useCallback(async (run: BrainRun, t: FlyTask): Promise<string> => {
    if (!layout) return '';
    const w = await loadWeights(t, run.variant);
    // alzarsi: i pesi addestrati senza "mano che aiuta" (metodo vecchio, non
    // si alzavano mai) si scartano e si riparte da "in piedi"
    const oldGetup = t === 'getup' && !!w && w.getupMethod !== GETUP_METHOD;
    const d = oldGetup ? null : usable(w);
    let p: Float32Array;
    let g = 0;
    let h: GenStats[] = [];
    let note: string;
    if (d) {
      p = d;
      g = w!.generation;
      h = w!.history ?? [];
      note = `gen ${g}`;
    } else {
      const f = await freshStart(run.variant, t);
      p = f.p;
      note = (oldGetup ? 'metodo vecchio, ' : w ? 'pesi vecchi, ' : '') + f.note;
    }
    run.assist.current = t !== 'getup' ? 0 : d ? w!.assist ?? 1 : 1;
    run.best.current = d ? w!.score : -Infinity;
    run.setParams(p.slice());
    run.bumpVersion();
    run.setGen(g);
    run.setHistory(h);
    run.setLast(null);
    run.status.current = { upFor: 0, episodes: 0, bestUp: 0 };
    run.trainer.current?.setParams(p, g, h.slice());
    return note;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, freshStart]);

  useEffect(() => {
    if (!layout) return;
    allRuns.forEach((r) => r.trainer.current?.stop());
    setRunning(false);
    setBaselineScore(null);
    Promise.all(allRuns.map((r) => loadRun(r, task).then((n) => `${BRAINS.find((b) => b.id === r.variant)!.short}: ${n}`))).then((notes) =>
      setMsg(`${task} -- ${notes.join(', ')}`)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, layout]);

  const startRun = async (run: BrainRun, workers: number) => {
    if (!run.params || !layout) return;
    let tr = run.trainer.current;
    const conf: LabConfig = { ...cfg, workers, task, brain: run.variant, assist: run.assist.current };
    if (!tr || tr.workers.length !== workers || tr.cfg.brain !== run.variant) {
      tr?.dispose();
      tr = new LabTrainer(conf);
      await tr.start(workers);
      run.trainer.current = tr;
      tr.setParams(run.params.slice(), run.gen, run.history.slice());
    }
    tr.cfg = conf;
    if (run.variant === 'real') tr.baseline(initialParams(layout)).then(setBaselineScore).catch(() => {});
    tr.onError = (m) => {
      setRunning(false);
      setMsg(`errore (${run.variant}): ${m}`);
    };
    tr.onGen = (st) => {
      run.assist.current = tr!.cfg.assist;
      run.setGen(st.gen);
      run.setLast(st);
      run.setHistory(tr!.history.slice());
      if (st.centre !== null) {
        if (followRef.current) {
          run.setParams(tr!.opt!.theta.slice());
          run.bumpVersion();
        }
        const file = tr!.weightsFile(st.centre);
        saveWeights(task, run.variant, file, false).catch((e) => setMsg('salvataggio non riuscito (riavvia npm run dev): ' + e.message));
        if (st.centre > run.best.current) {
          run.best.current = st.centre;
          saveWeights(task, run.variant, file, true).catch(() => {});
        }
      }
    };
    tr.loop();
  };

  const start = async () => {
    // i worker si dividono tra i cervelli attivi; quelli non attivi si liberano
    for (const r of allRuns) if (!active.includes(r.variant)) { r.trainer.current?.dispose(); r.trainer.current = null; }
    const per = Math.max(1, Math.floor(cfg.workers / active.length));
    setMsg(`avvio ${per * active.length} worker (${per} per cervello): carico modello, animazioni e connettoma...`);
    setRunning(true);
    try {
      await Promise.all(active.map((b) => startRun(runOf(b), per)));
      setMsg(`addestramento in corso: ${active.length} cervelli, ${per} worker ciascuno${cfg.push ? `, spinte ${cfg.push} N·s` : ''}`);
    } catch (e: any) {
      setRunning(false);
      setMsg('errore worker: ' + e.message);
    }
  };
  const pause = () => {
    allRuns.forEach((r) => r.trainer.current?.stop());
    setRunning(false);
    setMsg('in pausa (i pesi si salvano ogni 5 generazioni)');
  };
  const resetFromZero = async () => {
    if (!layout) return;
    pause();
    const notes: string[] = [];
    for (const b of active) {
      const r = runOf(b);
      const { p, note } = await freshStart(b, task);
      notes.push(note);
      r.best.current = -Infinity;
      r.assist.current = task === 'getup' ? 1 : 0;
      r.setParams(p.slice());
      r.bumpVersion();
      r.setGen(0);
      r.setHistory([]);
      r.setLast(null);
      r.trainer.current?.setParams(p, 0, []);
    }
    setConfirmReset(false);
    setMsg(`i cervelli selezionati ripartono (${notes[0]})`);
  };

  const centre = (r: BrainRun) => r.history.filter((h) => h.centre !== null).slice(-1)[0]?.centre ?? null;
  const T = TASKS.find((t) => t.id === task)!;
  const realMean = recentMean(r0.history);
  const ctrlMeans = controls.map((b) => recentMean(runOf(b).history)).filter((v): v is number => v !== null);
  const ctrlMean = ctrlMeans.length ? ctrlMeans.reduce((a, b) => a + b, 0) / ctrlMeans.length : null;

  const panel: React.CSSProperties = { position: 'absolute', top: 12, left: 12, width: 370, maxHeight: 'calc(100vh - 24px)', overflowY: 'auto', background: 'rgba(12,12,20,0.9)', color: '#eee', borderRadius: 12, padding: 14, fontFamily: 'system-ui, sans-serif', fontSize: 13, boxShadow: '0 8px 30px rgba(0,0,0,0.4)' };
  const btn = (bg: string): React.CSSProperties => ({ background: bg, color: '#fff', border: 0, borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 13 });
  const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, margin: '4px 0' };
  const box: React.CSSProperties = { background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 8, margin: '8px 0' };
  const sel: React.CSSProperties = { background: '#1f1f2e', color: '#fff', border: '1px solid #333', borderRadius: 6, padding: '4px 6px' };
  const num = (k: 'pop' | 'sigma' | 'lr' | 'seconds' | 'workers', step: number, min: number, max: number) => (
    <input type="number" value={cfg[k]} step={step} min={min} max={max} disabled={running}
      onChange={(e) => setCfg({ ...cfg, [k]: Math.min(max, Math.max(min, +e.target.value)) })}
      style={{ width: 80, ...sel, padding: '3px 6px' }} />
  );
  // fila in scena: vero, controlli, senza cervello
  const lineup: { key: string; x: number }[] = active.map((b) => ({ key: b, x: 0 }));
  if (withBaseline) lineup.push({ key: 'none', x: 0 });
  lineup.forEach((l, i) => (l.x = 0.6 + (i - (lineup.length - 1) / 2) * 1.2));
  const xOf = (k: string) => lineup.find((l) => l.key === k)?.x ?? 0;
  // si riparte solo quando cade (o con "Riparti episodio"); in "alzarsi" anche
  // se dopo 10 s e' ancora a terra
  const epSec = task === 'getup' ? 10 : Infinity;
  const scenePushV = scenePush ? cfg.push || 30 : 0;

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0b0b12', position: 'relative' }}>
      <Canvas shadows camera={{ position: [-0.4, 2.6, 10.5], fov: 45 }}>
        <color attach="background" args={['#101018']} />
        <hemisphereLight args={['#dfe7ff', '#2a2230', 0.9]} />
        <directionalLight position={[4, 8, 5]} intensity={2.2} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
        <Grid args={[40, 40]} cellSize={0.5} sectionSize={2} cellColor="#2b2b3a" sectionColor="#4a4a66" fadeDistance={34} infiniteGrid position={[0, 0.001, 0]} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[80, 80]} />
          <meshStandardMaterial color="#17171f" />
        </mesh>
        {/* bersaglio spostato a sinistra: le mosche compaiono a destra del pannello */}
        {/* bandiera della pace dietro le mosche */}
        <PeaceFlag position={[-1.2, 0, -5]} />
        <OrbitControls target={[collapsed ? 0.6 : -1.6, 0.8, 0]} maxPolarAngle={Math.PI / 2 - 0.05} />
        <Suspense fallback={null}>
          {graph && (
            <Physics timeStep={1 / 120} gravity={[0, -9.81, 0]}>
              <RigidBody type="fixed" colliders={false}>
                <CuboidCollider args={[40, 0.5, 40]} position={[0, -0.5, 0]} friction={1} />
              </RigidBody>
              {active.map((b) => {
                const r = runOf(b);
                const meta = BRAINS.find((x) => x.id === b)!;
                return (
                  <LabFly key={b} graph={graphs[b]!} params={r.params} paramsVersion={r.paramsVersion} task={task} x={xOf(b)} color={meta.color}
                    ghost={ghost} episodeSeconds={epSec} restartNonce={restartNonce} status={r.status} paused={false} pushNonce={pushNonce} autoPush={scenePushV} assist={r.assist.current} />
                );
              })}
              {withBaseline && (
                <LabFly graph={graph} params={null} paramsVersion={0} task={task} x={xOf('none')} color="#6b7280"
                  ghost={false} episodeSeconds={epSec} restartNonce={restartNonce} status={baseStatus} paused={false} pushNonce={pushNonce} autoPush={scenePushV} assist={0} />
              )}
            </Physics>
          )}
        </Suspense>
      </Canvas>

      {collapsed && (
        <button style={{ ...btn('#7c3aed'), position: 'absolute', top: 12, left: 12 }} onClick={() => setCollapsed(false)}>
          🪰 {running ? `vero ${realMean?.toFixed(3) ?? '-'} / controlli ${ctrlMean?.toFixed(3) ?? '-'}` : 'Laboratorio'} ▸
        </button>
      )}
      <button style={{ ...btn('#b91c1c'), position: 'absolute', bottom: 16, right: 16 }} onClick={() => setPushNonce((n) => n + 1)}>💥 Spingi le mosche</button>

      <div style={{ ...panel, display: collapsed ? 'none' : 'block' }}>
        <div style={{ ...row, marginBottom: 6 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>🪰 Laboratorio cervello mosca</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={btn('#374151')} title="nascondi il pannello" onClick={() => setCollapsed(true)}>◂</button>
            <button style={btn('#374151')} onClick={() => { allRuns.forEach((r) => r.trainer.current?.dispose()); onExit(); }}>Menu</button>
          </div>
        </div>
        <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 8 }}>
          Esperimento: il cablaggio della Drosophila (FlyWire, {graph ? `${graph.N} neuroni, ${graph.pre.length.toLocaleString()} sinapsi` : '...'}) aiuta un corpo umano a imparare, rispetto allo stesso cervello con le sinapsi rimescolate a caso?
        </div>

        <div style={row}>
          <span>Compito</span>
          <select value={task} disabled={running} onChange={(e) => setTask(e.target.value as FlyTask)} style={sel}>
            {TASKS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div style={{ opacity: 0.6, fontSize: 11, marginBottom: 4 }}>{T.hint}</div>
        <div style={row}>
          <span>Controlli rimescolati</span>
          <span style={{ display: 'flex', gap: 6 }}>
            {BRAINS.filter((b) => b.id !== 'real').map((b) => (
              <label key={b.id} style={{ color: b.color, fontWeight: 600, opacity: running ? 0.6 : 1 }}>
                <input type="checkbox" disabled={running} checked={controls.includes(b.id)}
                  onChange={(e) => setControls((c) => (e.target.checked ? [...c, b.id] : c.filter((x) => x !== b.id)))} /> {b.short}
              </label>
            ))}
          </span>
        </div>
        <div style={row}>
          <span>Spinte durante l'addestramento</span>
          <select value={cfg.push} disabled={running} onChange={(e) => setCfg({ ...cfg, push: +e.target.value })} style={sel}>
            {PUSHES.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 8, margin: '8px 0', flexWrap: 'wrap' }}>
          {!running ? <button style={btn('#7c3aed')} onClick={start} disabled={!r0.params}>▶ Addestra</button> : <button style={btn('#b45309')} onClick={pause}>⏸ Pausa</button>}
          <button style={btn('#1f2937')} onClick={() => setRestartNonce((n) => n + 1)}>↺ Riparti episodio</button>
          {!confirmReset ? (
            <button style={btn('#1f2937')} onClick={() => setConfirmReset(true)} disabled={running}>Da zero</button>
          ) : (
            <button style={btn('#b91c1c')} onClick={resetFromZero}>Sicuro? (selezionati)</button>
          )}
        </div>

        <div style={box}>
          <div style={{ ...row, fontWeight: 700 }}>
            <span>Vero {realMean !== null ? realMean.toFixed(3) : '-'} · controlli {ctrlMean !== null ? ctrlMean.toFixed(3) : '-'}</span>
            <span style={{ color: realMean !== null && ctrlMean !== null ? (realMean > ctrlMean ? '#a855f7' : '#f59e0b') : '#aaa' }}>
              {realMean !== null && ctrlMean !== null ? `${realMean >= ctrlMean ? '+' : ''}${(realMean - ctrlMean).toFixed(3)}` : ''}
            </span>
          </div>
          <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 6 }}>media delle ultime 5 misure di ogni cervello; i controlli sono mediati tra loro</div>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead><tr style={{ opacity: 0.6 }}><td>cervello</td><td>gen</td><td>punteggio</td><td>in piedi (record)</td><td>{task === 'getup' ? 'aiuto' : 's/gen'}</td></tr></thead>
            <tbody>
              {active.map((b) => {
                const r = runOf(b);
                const meta = BRAINS.find((x) => x.id === b)!;
                const c = centre(r);
                return (
                  <tr key={b}>
                    <td style={{ color: meta.color, fontWeight: 600 }}>● {meta.label}</td>
                    <td>{r.gen}</td>
                    <td style={{ color: meta.color }}>{c !== null ? c.toFixed(3) : '-'}</td>
                    <td>{r.status.current.upFor.toFixed(1)} ({r.status.current.bestUp.toFixed(1)})</td>
                    <td>{task === 'getup' ? <b style={{ color: r.assist.current <= 0 ? '#22c55e' : '#eee' }}>{Math.round(r.assist.current * 100)}%</b> : r.last ? r.last.sec.toFixed(1) : '-'}</td>
                  </tr>
                );
              })}
              {withBaseline && (
                <tr><td style={{ color: '#9ca3af', fontWeight: 600 }}>● senza cervello</td><td /><td style={{ color: '#9ca3af' }}>{baselineScore !== null ? baselineScore.toFixed(3) : '-'}</td><td>{baseStatus.current.upFor.toFixed(1)} ({baseStatus.current.bestUp.toFixed(1)})</td><td /></tr>
              )}
            </tbody>
          </table>
          <Chart baseline={baselineScore} series={active.map((b) => ({ color: BRAINS.find((x) => x.id === b)!.color, history: runOf(b).history }))} />
          <div style={{ fontSize: 11, opacity: 0.6 }}>linea spessa = cervello attuale, sottile = media della popolazione. Stessi episodi, spinte e parametri per tutti.</div>
        </div>

        <div style={box}>
          <label style={{ ...row, justifyContent: 'flex-start' }}><input type="checkbox" checked={withBaseline} onChange={(e) => setWithBaseline(e.target.checked)} /> mostra la mosca senza cervello</label>
          <label style={{ ...row, justifyContent: 'flex-start' }}><input type="checkbox" checked={scenePush} onChange={(e) => setScenePush(e.target.checked)} /> spinte casuali anche in scena</label>
          <label style={{ ...row, justifyContent: 'flex-start' }}><input type="checkbox" checked={ghost} onChange={(e) => setGhost(e.target.checked)} /> fantasma dell'animazione di riferimento</label>
          <label style={{ ...row, justifyContent: 'flex-start' }}><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> in scena il cervello aggiornato mentre si addestra</label>
        </div>

        <details style={{ margin: '8px 0' }}>
          <summary style={{ cursor: 'pointer', opacity: 0.8 }}>Parametri dell'addestramento</summary>
          <div style={row}><span>Popolazione</span>{num('pop', 8, 8, 512)}</div>
          <div style={row}><span>Sigma (mutazione)</span>{num('sigma', 0.002, 0.001, 0.2)}</div>
          <div style={row}><span>Passo di apprendimento</span>{num('lr', 0.001, 0.0001, 0.05)}</div>
          <div style={row}><span>Secondi per episodio</span>{num('seconds', 1, 2, 20)}</div>
          <div style={row}><span>Worker totali (core)</span>{num('workers', 1, 1, 64)}</div>
          <div style={{ fontSize: 11, opacity: 0.6 }}>Evolution Strategies: ogni generazione prova {cfg.pop} varianti di ciascun cervello per 2 episodi. I core si dividono tra i cervelli attivi ({Math.max(1, Math.floor(cfg.workers / active.length))} ciascuno). Si cambiano da fermo.</div>
        </details>

        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6 }}>{msg}</div>
        <div style={{ fontSize: 11, opacity: 0.5, marginTop: 6 }}>Trascina per ruotare, rotella per lo zoom. Dati FlyWire CC BY-NC 4.0.</div>
      </div>
    </div>
  );
};

export default FlyLab;
