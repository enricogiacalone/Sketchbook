// Banco di prova del tunneling (solo in sviluppo, montato da DuelArena).
// A OGNI passo di fisica misura quanto i collider del ragdoll del
// giocatore entrano negli altri collider (pale del rotore, pavimento,
// muri, ostacoli) e se un pezzo ATTRAVERSA una pala da parte a parte
// (cambia lato del piano della pala restando nella sua sagoma: una pala
// solida dovrebbe spingerlo, mai lasciarlo passare).
//
// Dalla console:
//   await __tunnelBench.scenario('piedi')   // in piedi sulla traiettoria delle pale
//   await __tunnelBench.scenario('punta')   // dove la pala va piu' veloce (~14 m/s)
//   await __tunnelBench.scenario('terra')   // a terra sotto le pale
//   __tunnelBench.start('nome'); ...; __tunnelBench.stop()  // registrazione libera
import { useEffect, useRef } from 'react';
import { useAfterPhysicsStep } from '@react-three/rapier';
import type { Collider, World } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { sweeperColliders } from './ragdoll/sweepers';

type Kind = 'pala' | 'pala ignorata' | 'fisso' | 'cinematico' | 'dinamico';
interface Crossing {
  t: number;
  seg: string;
  ko: boolean;
  speed: number; // velocita' del pezzo (m/s)
  bladeSpeed: number; // velocita' della pala in quel punto (m/s)
}
interface Rec {
  label: string;
  t0: number;
  steps: number;
  maxDepth: Record<string, { depth: number; seg: string; t: number; ko: boolean }>;
  deep: Record<Kind, number>; // passi con un pezzo dentro piu' di 2 cm
  crossings: Crossing[];
  // passi con un pezzo oltre SPIKE m/s (solutore che esplode): con cosa era a contatto
  spikes: { t: number; seg: string; v: number; ko: boolean; contatti: string[] }[];
  side: Map<string, number>;
  maxSpeed: { v: number; seg: string; t: number; ko: boolean };
}

const DEEP = 0.02;
const SPIKE = 25;
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _l = new THREE.Vector3();

interface RagdollReg {
  world: World;
  entries: () => Record<
    string,
    {
      body: {
        collider: (i: number) => Collider;
        linvel: () => { x: number; y: number; z: number };
        translation: () => { x: number; y: number; z: number };
      };
    }
  >;
  passive: () => boolean;
}

function kindOf(c: Collider): Kind {
  if (sweeperColliders.has(c.handle)) return 'pala';
  const b = c.parent();
  if (!b || b.isFixed()) return 'fisso';
  return b.isKinematic() ? 'cinematico' : 'dinamico';
}

export default function TunnelBench() {
  const rec = useRef<Rec | null>(null);

  useAfterPhysicsStep((world) => {
    const r = rec.current;
    if (!r) return;
    const reg = (window as any).__activeRagdolls?.player as RagdollReg | undefined;
    if (!reg) return;
    const entries = reg.entries();
    const ko = reg.passive();
    const t = (performance.now() - r.t0) / 1000;
    r.steps++;
    const own = new Set<number>();
    for (const e of Object.values(entries)) own.add(e.body.collider(0).handle);
    const deepThisStep = new Set<Kind>();
    for (const [seg, e] of Object.entries(entries)) {
      const col = e.body.collider(0);
      const v = e.body.linvel();
      const sp = Math.hypot(v.x, v.y, v.z);
      if (sp > r.maxSpeed.v) r.maxSpeed = { v: +sp.toFixed(2), seg, t: +t.toFixed(2), ko };
      // penetrazione contro cio' che il solutore sta davvero spingendo
      // (contatti scartati dal filtro -- es. pavimento sotto il corpo vivo,
      // pale dopo l'attimo di grazia del KO -- contati a parte: "ignorata")
      const touching: string[] = [];
      world.contactPairsWith(col, (other) => {
        if (own.has(other.handle)) return;
        let solved = false;
        world.contactPair(col, other, (m) => {
          if (m.numSolverContacts() > 0) solved = true;
        });
        const c = col.contactCollider(other, 0);
        if (!c || c.distance >= 0) return;
        const base = kindOf(other);
        if (!solved && base !== 'pala') return; // contatti voluti assenti (es. piedi del corpo vivo)
        const k = (solved ? base : 'pala ignorata') as Kind;
        const d = -c.distance;
        touching.push(`${k} ${(d * 100).toFixed(0)}cm`);
        const m = r.maxDepth[k];
        if (!m || d > m.depth) r.maxDepth[k] = { depth: +d.toFixed(3), seg, t: +t.toFixed(2), ko };
        if (d > DEEP) deepThisStep.add(k);
      });
      if (sp > SPIKE && r.spikes.length < 30) r.spikes.push({ t: +t.toFixed(2), seg, v: +sp.toFixed(1), ko, contatti: touching });
      // attraversamento delle pale (box del rotore)
      const p = e.body.translation();
      for (const h of sweeperColliders) {
        const s = world.getCollider(h);
        if (!s || !s.halfExtents) continue;
        const he = s.halfExtents();
        if (!he) continue; // il mozzo (cilindro) non ha un piano
        const round = s.roundRadius?.() ?? 0;
        const st = s.translation();
        const sr = s.rotation();
        _q.set(sr.x, sr.y, sr.z, sr.w).invert();
        _l.set(p.x - st.x, p.y - st.y, p.z - st.z).applyQuaternion(_q);
        const key = `${seg}:${h}`;
        // centro del pezzo dentro lo spessore della pala (sopra o sotto ci passa)
        const inBand = Math.abs(_l.x) < he.x + round && Math.abs(_l.y) < he.y + round;
        if (!inBand) {
          r.side.delete(key);
          continue;
        }
        const sign = Math.sign(_l.z) || 1;
        const prev = r.side.get(key);
        if (prev !== undefined && prev !== sign) {
          // velocita' della pala nel punto: omega x r (perno = corpo del rotore)
          const body = s.parent();
          let bladeSpeed = 0;
          if (body) {
            const w = body.angvel();
            const o = body.translation();
            _p.set(p.x - o.x, 0, p.z - o.z);
            bladeSpeed = Math.abs(w.y) * _p.length();
          }
          r.crossings.push({ t: +t.toFixed(2), seg, ko, speed: +sp.toFixed(2), bladeSpeed: +bladeSpeed.toFixed(1) });
        }
        r.side.set(key, sign);
      }
    }
    for (const k of deepThisStep) r.deep[k]++;
  });

  useEffect(() => {
    const start = (label = 'libera') => {
      rec.current = {
        label,
        t0: performance.now(),
        steps: 0,
        maxDepth: {},
        deep: { pala: 0, 'pala ignorata': 0, fisso: 0, cinematico: 0, dinamico: 0 },
        crossings: [],
        spikes: [],
        side: new Map(),
        maxSpeed: { v: 0, seg: '', t: 0, ko: false },
      };
    };
    const report = () => {
      const r = rec.current;
      if (!r) return null;
      return {
        label: r.label,
        secondi: +((performance.now() - r.t0) / 1000).toFixed(1),
        passi: r.steps,
        penetrazioneMax: r.maxDepth,
        passiOltre2cm: r.deep,
        attraversamenti: r.crossings,
        picchi: r.spikes,
        velocitaMax: r.maxSpeed,
      };
    };
    const stop = () => {
      const out = report();
      rec.current = null;
      return out;
    };
    const wait = (s: number) => new Promise((res) => setTimeout(res, s * 1000));
    const pcs = () => (window as any).__pcsDebug;
    // posizioni rispetto al rotore (ArenaObstacles: perno in 0,5, pale lungo x, raggio 4.75)
    const SCENARIOS: Record<string, { seconds: number; run: () => Promise<void> | void }> = {
      // fermo dov'e' (regressione: il corpo vivo che tocca avversari e muri)
      fermo: { seconds: 8, run: () => undefined },
      piedi: { seconds: 6, run: () => pcs()?.teleport(3.2, 5, Math.PI / 2) },
      punta: { seconds: 6, run: () => pcs()?.teleport(4.4, 5, Math.PI / 2) },
      mozzo: { seconds: 6, run: () => pcs()?.teleport(1.3, 5, Math.PI / 2) },
      terra: {
        seconds: 8,
        run: async () => {
          pcs()?.teleport(8, 5, Math.PI / 2);
          await wait(0.3);
          pcs()?.knockDown(-1, 0, 5, 0.1);
        },
      },
    };
    const scenario = async (name: string) => {
      const sc = SCENARIOS[name];
      if (!sc) return `scenari: ${Object.keys(SCENARIOS).join(', ')}`;
      await sc.run();
      // il teletrasporto rimette il corpo sulle ossa di colpo (anche dentro
      // una pala): quel primo istante non conta
      await wait(0.25);
      start(name);
      await wait(sc.seconds);
      return stop();
    };
    const api = { start, stop, report, scenario };
    (window as any).__tunnelBench = api;
    return () => {
      if ((window as any).__tunnelBench === api) delete (window as any).__tunnelBench;
    };
  }, []);

  return null;
}
