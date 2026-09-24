import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { Physics, RigidBody, CuboidCollider } from '@react-three/rapier';
import LabFly, { type LabFlyStatus } from './LabFly';
import { LabTrainer, type GenStats, type LabConfig } from './labTrainer';
import { parseFlyGraph, makeLayout, initialParams, decodeParams, type FlyGraph, type FlyWeightsFile } from '../flyBrain/connectomePolicy';
import { flyDims } from '../flyBrain/flyBody';
import { N_CMD, type FlyTask } from '../flyBrain/flyController';

// "fai una sezione simulazione cervello mosca pulito da tutto e con
// l'ambiente minimal richiesto" -- terza voce del menu iniziale. Solo:
// pavimento, luci, la mosca-umano (cervello attuale), a richiesta la stessa
// senza cervello e il fantasma dell'animazione di riferimento; a lato il
// pannello per addestrare (worker nel browser, stesso codice del trainer
// Node) con il grafico dei punteggi. I pesi si salvano da soli in
// public/fly-brain/weights-<compito>.json.

const TASKS: { id: FlyTask; label: string; hint: string }[] = [
  { id: 'stand', label: 'Stare in piedi', hint: 'imitare Idle_A senza cadere' },
  { id: 'getup', label: 'Alzarsi da terra', hint: 'da sdraiato, imitare LayToIdle (al rallentatore) e restare su' },
  { id: 'walk', label: 'Camminare', hint: 'imitare Walk avanzando a 0.73 m/s' },
];

type Weights = FlyWeightsFile & { history?: GenStats[] };

async function loadGraph(): Promise<FlyGraph> {
  const [j, b] = await Promise.all([
    fetch('/fly-brain/fly-brain.json').then((r) => r.json()),
    fetch('/fly-brain/fly-brain-edges.bin').then((r) => r.arrayBuffer()),
  ]);
  return parseFlyGraph(j, b);
}
async function loadWeights(task: FlyTask): Promise<Weights | null> {
  try {
    const r = await fetch(`/fly-brain/weights-${task}.json?t=${Date.now()}`);
    if (!r.ok) return null;
    return (await r.json()) as Weights;
  } catch {
    return null;
  }
}
async function saveWeights(task: FlyTask, w: Weights, best: boolean) {
  const r = await fetch(`/__flybrain/save?task=${task}${best ? '&best=1' : ''}`, { method: 'POST', body: JSON.stringify(w) });
  if (!r.ok) throw new Error(await r.text());
}

const Chart: React.FC<{ history: GenStats[] }> = ({ history }) => {
  const W = 320, H = 150, P = 26;
  const pts = history.filter((h) => h.centre !== null);
  if (history.length < 2) return <div style={{ height: H, display: 'grid', placeItems: 'center', opacity: 0.5, fontSize: 12 }}>il grafico appare dopo qualche generazione</div>;
  const g0 = history[0].gen, g1 = history[history.length - 1].gen;
  const maxY = Math.max(0.3, ...history.map((h) => Math.max(h.mean, h.centre ?? 0))) * 1.05;
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
      <line x1={P} x2={W - 6} y1={Y(0.14)} y2={Y(0.14)} stroke="#f87171" strokeDasharray="3 3" opacity={0.6} />
      <text x={W - 8} y={Y(0.14) - 3} fill="#f87171" fontSize={9} textAnchor="end" opacity={0.8}>senza cervello</text>
      <path d={line(history.map((h) => ({ g: h.gen, v: h.mean })))} stroke="rgba(167,139,250,0.45)" fill="none" strokeWidth={1} />
      <path d={line(pts.map((h) => ({ g: h.gen, v: h.centre as number })))} stroke="#a855f7" fill="none" strokeWidth={2} />
      <text x={P} y={H - 4} fill="rgba(255,255,255,0.5)" fontSize={9}>gen {g0}</text>
      <text x={W - 6} y={H - 4} fill="rgba(255,255,255,0.5)" fontSize={9} textAnchor="end">gen {g1}</text>
    </svg>
  );
};

const FlyLab: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const [graph, setGraph] = useState<FlyGraph | null>(null);
  const [task, setTask] = useState<FlyTask>('stand');
  const [params, setParams] = useState<Float32Array | null>(null);
  const [paramsVersion, setParamsVersion] = useState(0);
  const [gen, setGen] = useState(0);
  const [history, setHistory] = useState<GenStats[]>([]);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState('carico il connettoma...');
  const [last, setLast] = useState<GenStats | null>(null);
  const [compare, setCompare] = useState(true);
  const [ghost, setGhost] = useState(true);
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  followRef.current = follow;
  const [restartNonce, setRestartNonce] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);
  const maxWorkers = Math.max(1, (navigator.hardwareConcurrency || 4) - 2);
  const [cfg, setCfg] = useState<LabConfig>({ task: 'stand', pop: 48, sigma: 0.01, lr: 0.003, seconds: 6, workers: maxWorkers });
  const trainerRef = useRef<LabTrainer | null>(null);
  const bestRef = useRef(-Infinity);
  const trainedStatus = useRef<LabFlyStatus>({ upFor: 0, episodes: 0, bestUp: 0 });
  const baseStatus = useRef<LabFlyStatus>({ upFor: 0, episodes: 0, bestUp: 0 });
  const [, force] = useState(0);

  // stato dal vivo delle due mosche nel pannello
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    loadGraph().then(setGraph).catch((e) => setMsg('errore connettoma: ' + e.message));
    return () => trainerRef.current?.dispose();
  }, []);

  const layoutParams = useMemo(() => {
    if (!graph) return null;
    const { nObs, nAct } = flyDims();
    return makeLayout(graph, nObs + N_CMD + nAct, nAct);
  }, [graph]);

  // (ri)carica i pesi del compito scelto
  const loadTask = useCallback(
    async (t: FlyTask) => {
      if (!layoutParams) return;
      trainerRef.current?.stop();
      setRunning(false);
      const w = await loadWeights(t);
      let p: Float32Array;
      let g = 0;
      let h: GenStats[] = [];
      if (w) {
        const d = decodeParams(w.params);
        if (d.length === layoutParams.nParams) {
          p = d;
          g = w.generation;
          h = w.history ?? [];
          setMsg(`${t}: ripreso dalla generazione ${g} (punteggio ${w.score.toFixed(3)})`);
        } else {
          p = initialParams(layoutParams);
          setMsg(`${t}: pesi salvati incompatibili, si parte da zero`);
        }
      } else {
        p = initialParams(layoutParams);
        setMsg(`${t}: nessun addestramento salvato, si parte da zero`);
      }
      bestRef.current = w?.score ?? -Infinity;
      setParams(p.slice());
      setParamsVersion((v) => v + 1);
      setGen(g);
      setHistory(h);
      setLast(null);
      trainedStatus.current = { upFor: 0, episodes: 0, bestUp: 0 };
      baseStatus.current = { upFor: 0, episodes: 0, bestUp: 0 };
      if (trainerRef.current) trainerRef.current.setParams(p, g, h.slice());
    },
    [layoutParams]
  );
  useEffect(() => {
    loadTask(task);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, layoutParams]);

  const start = async () => {
    if (!params || !layoutParams) return;
    let tr = trainerRef.current;
    if (!tr || tr.workers.length !== cfg.workers) {
      tr?.dispose();
      setMsg(`avvio ${cfg.workers} worker (carico modello, animazioni e connettoma in ognuno)...`);
      tr = new LabTrainer({ ...cfg, task });
      try {
        await tr.start(cfg.workers);
      } catch (e: any) {
        setMsg('errore worker: ' + e.message);
        return;
      }
      trainerRef.current = tr;
      tr.setParams(params.slice(), gen, history.slice());
    }
    tr.cfg = { ...cfg, task };
    tr.onError = (m) => {
      setRunning(false);
      setMsg('errore: ' + m);
    };
    tr.onGen = (st) => {
      setGen(st.gen);
      setLast(st);
      setHistory(tr!.history.slice());
      if (st.centre !== null) {
        const theta = tr!.opt!.theta.slice();
        if (followRef.current) {
          setParams(theta);
          setParamsVersion((v) => v + 1);
        }
        const file = tr!.weightsFile(st.centre);
        saveWeights(task, file, false)
          .then(() => setMsg(`salvato: generazione ${st.gen}, punteggio ${st.centre!.toFixed(3)}`))
          .catch((e) => setMsg('salvataggio non riuscito (serve npm run dev riavviato): ' + e.message));
        if (st.centre > bestRef.current) {
          bestRef.current = st.centre;
          saveWeights(task, file, true).catch(() => {});
        }
      }
    };
    setRunning(true);
    setMsg(`addestramento in corso: ${task}, ${cfg.workers} worker`);
    tr.loop();
  };
  const pause = () => {
    trainerRef.current?.stop();
    setRunning(false);
    setMsg('in pausa (i pesi sono salvati ogni 5 generazioni)');
  };
  const resetFromZero = () => {
    if (!layoutParams) return;
    trainerRef.current?.stop();
    setRunning(false);
    const p = initialParams(layoutParams);
    bestRef.current = -Infinity;
    setParams(p.slice());
    setParamsVersion((v) => v + 1);
    setGen(0);
    setHistory([]);
    trainerRef.current?.setParams(p, 0, []);
    setConfirmReset(false);
    setMsg('ripartito da zero (il file salvato verra\' sovrascritto alla prossima generazione)');
  };

  const info = trainerRef.current?.brainInfo;
  const T = TASKS.find((t) => t.id === task)!;
  const panel: React.CSSProperties = { position: 'absolute', top: 12, left: 12, width: 344, maxHeight: 'calc(100vh - 24px)', overflowY: 'auto', background: 'rgba(12,12,20,0.88)', color: '#eee', borderRadius: 12, padding: 14, fontFamily: 'system-ui, sans-serif', fontSize: 13, boxShadow: '0 8px 30px rgba(0,0,0,0.4)' };
  const btn = (bg: string): React.CSSProperties => ({ background: bg, color: '#fff', border: 0, borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 13 });
  const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, margin: '4px 0' };
  const num = (k: keyof LabConfig, step: number, min: number, max: number) => (
    <input type="number" value={cfg[k] as number} step={step} min={min} max={max} disabled={running && k === 'workers'}
      onChange={(e) => setCfg({ ...cfg, [k]: Math.min(max, Math.max(min, +e.target.value)) })}
      style={{ width: 80, background: '#1f1f2e', color: '#fff', border: '1px solid #333', borderRadius: 6, padding: '3px 6px' }} />
  );

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0b0b12', position: 'relative' }}>
      <Canvas shadows camera={{ position: [-1.2, 1.7, 5.2], fov: 45 }}>
        <color attach="background" args={['#101018']} />
        <hemisphereLight args={['#dfe7ff', '#2a2230', 0.9]} />
        <directionalLight position={[4, 8, 5]} intensity={2.2} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
        <Grid args={[40, 40]} cellSize={0.5} sectionSize={2} cellColor="#2b2b3a" sectionColor="#4a4a66" fadeDistance={30} infiniteGrid position={[0, 0.001, 0]} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[80, 80]} />
          <meshStandardMaterial color="#17171f" />
        </mesh>
        {/* bersaglio spostato a sinistra: le mosche compaiono a destra del pannello */}
        <OrbitControls target={[-1.6, 0.8, 0]} maxPolarAngle={Math.PI / 2 - 0.05} />
        <Suspense fallback={null}>
          {graph && (
            <Physics timeStep={1 / 120} gravity={[0, -9.81, 0]}>
              <RigidBody type="fixed" colliders={false}>
                <CuboidCollider args={[40, 0.5, 40]} position={[0, -0.5, 0]} friction={1} />
              </RigidBody>
              <LabFly graph={graph} params={params} paramsVersion={paramsVersion} task={task} x={compare ? -0.9 : 0} color="#a855f7"
                ghost={ghost} episodeSeconds={task === 'getup' ? 8 : 12} restartNonce={restartNonce} status={trainedStatus} paused={false} />
              {compare && (
                <LabFly graph={graph} params={null} paramsVersion={0} task={task} x={0.9} color="#6b7280"
                  ghost={false} episodeSeconds={task === 'getup' ? 8 : 12} restartNonce={restartNonce} status={baseStatus} paused={false} />
              )}
            </Physics>
          )}
        </Suspense>
      </Canvas>

      <div style={panel}>
        <div style={{ ...row, marginBottom: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>🪰 Laboratorio cervello mosca</div>
          <button style={btn('#374151')} onClick={() => { trainerRef.current?.dispose(); onExit(); }}>Menu</button>
        </div>
        <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 8 }}>
          Connettoma di Drosophila (FlyWire): {graph ? `${graph.N} neuroni — ${graph.nAff} ascendenti (sensi), ${graph.nInt} centrali, ${graph.nEff} discendenti (muscoli)` : '...'}
          {layoutParams ? `, ${layoutParams.nParams} parametri addestrabili` : ''}
        </div>

        <div style={{ ...row }}>
          <span>Compito</span>
          <select value={task} disabled={running} onChange={(e) => setTask(e.target.value as FlyTask)}
            style={{ background: '#1f1f2e', color: '#fff', border: '1px solid #333', borderRadius: 6, padding: '4px 6px' }}>
            {TASKS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div style={{ opacity: 0.6, fontSize: 11, marginBottom: 8 }}>{T.hint}</div>

        <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
          {!running ? <button style={btn('#7c3aed')} onClick={start} disabled={!params}>▶ Addestra</button> : <button style={btn('#b45309')} onClick={pause}>⏸ Pausa</button>}
          <button style={btn('#1f2937')} onClick={() => setRestartNonce((n) => n + 1)}>↺ Riparti episodio</button>
          {!confirmReset ? (
            <button style={btn('#1f2937')} onClick={() => setConfirmReset(true)} disabled={running}>Da zero</button>
          ) : (
            <button style={btn('#b91c1c')} onClick={resetFromZero}>Sicuro?</button>
          )}
        </div>

        <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 8, margin: '8px 0' }}>
          <div style={row}><span>Generazione</span><b>{gen}</b></div>
          <div style={row}><span>Punteggio cervello (0-1)</span><b style={{ color: '#c084fc' }}>{(history.filter((h) => h.centre !== null).slice(-1)[0]?.centre ?? 0).toFixed(3)}</b></div>
          <div style={row}><span>Media popolazione / migliore</span><span>{last ? `${last.mean.toFixed(3)} / ${last.best.toFixed(3)}` : '-'}</span></div>
          <div style={row}><span>Velocita'</span><span>{last ? `${last.sec.toFixed(1)} s/gen, ${Math.round(last.stepsPerSec).toLocaleString()} passi fisici/s` : '-'}</span></div>
          <Chart history={history} />
          <div style={{ fontSize: 11, opacity: 0.6 }}>viola = cervello attuale, lilla = media della popolazione, rosso = corpo senza cervello</div>
        </div>

        <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 8, margin: '8px 0' }}>
          <div style={row}><span style={{ color: '#c084fc' }}>● mosca col cervello</span><span>in piedi {trainedStatus.current.upFor.toFixed(1)} s (record {trainedStatus.current.bestUp.toFixed(1)} s)</span></div>
          {compare && <div style={row}><span style={{ color: '#9ca3af' }}>● senza cervello</span><span>in piedi {baseStatus.current.upFor.toFixed(1)} s (record {baseStatus.current.bestUp.toFixed(1)} s)</span></div>}
          <label style={{ ...row, justifyContent: 'flex-start' }}><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> confronto senza cervello</label>
          <label style={{ ...row, justifyContent: 'flex-start' }}><input type="checkbox" checked={ghost} onChange={(e) => setGhost(e.target.checked)} /> fantasma dell'animazione di riferimento</label>
          <label style={{ ...row, justifyContent: 'flex-start' }}><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> mostra il cervello aggiornato mentre si addestra</label>
        </div>

        <details style={{ margin: '8px 0' }}>
          <summary style={{ cursor: 'pointer', opacity: 0.8 }}>Parametri dell'addestramento</summary>
          <div style={row}><span>Popolazione</span>{num('pop', 8, 8, 512)}</div>
          <div style={row}><span>Sigma (mutazione)</span>{num('sigma', 0.002, 0.001, 0.2)}</div>
          <div style={row}><span>Passo di apprendimento</span>{num('lr', 0.001, 0.0001, 0.05)}</div>
          <div style={row}><span>Secondi per episodio</span>{num('seconds', 1, 2, 20)}</div>
          <div style={row}><span>Worker (core)</span>{num('workers', 1, 1, 32)}</div>
          <div style={{ fontSize: 11, opacity: 0.6 }}>Evolution Strategies: ogni generazione prova {cfg.pop} varianti del cervello per 2 episodi e sposta i parametri verso le migliori. Worker e compito si cambiano da fermo.</div>
        </details>

        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6 }}>{msg}</div>
        <div style={{ fontSize: 11, opacity: 0.5, marginTop: 6 }}>Trascina per ruotare la vista, rotella per lo zoom. Dati FlyWire CC BY-NC 4.0.</div>
      </div>
    </div>
  );
};

export default FlyLab;
