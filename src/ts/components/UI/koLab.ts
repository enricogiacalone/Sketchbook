// "facciamo dei test e ti do dei feedback" -- scenari di KO numerati e
// ripetibili per il giocatore del duello (pannello "Laboratorio KO" in
// RagdollBenchGUI.tsx, o Alt+1..7). Ogni scenario parte sempre uguale
// rispetto a dove guarda il personaggio, cosi' "scenario 3: ..." vuol dire
// la stessa cosa per tutti e due.
import { useStore } from '../../store';
import { KO_BENCH_KEYS } from '../Environment/ragdoll/ragdollBench';

interface PcsDebug {
  down: boolean;
  isDead: boolean;
  posX: number;
  posZ: number;
  trav: { rot: number; feetY: number };
  teleport: (x: number, z: number, rotation?: number, feetY?: number) => void;
  knockDown: (dirX: number, dirZ: number, speed: number, up?: number) => void;
}

const pcs = (): PcsDebug | undefined => (window as any).__pcsDebug;

// avanti del personaggio (vedi PlayerCombatSoldier: _bodyFwd)
const fwd = (r: number) => ({ x: -Math.sin(r), z: -Math.cos(r) });

export interface KoScenario {
  label: string;
  run: (d: PcsDebug) => void;
}

export const KO_SCENARIOS: KoScenario[] = [
  {
    label: '1 Colpo frontale',
    run: (d) => {
      const f = fwd(d.trav.rot);
      d.knockDown(-f.x, -f.z, 7, 0.3);
    },
  },
  {
    label: '2 Colpo laterale',
    run: (d) => {
      const f = fwd(d.trav.rot);
      d.knockDown(f.z, -f.x, 7, 0.3);
    },
  },
  {
    label: '3 Colpo da dietro',
    run: (d) => {
      const f = fwd(d.trav.rot);
      d.knockDown(f.x, f.z, 7, 0.3);
    },
  },
  {
    label: '4 Spinta debole',
    run: (d) => {
      const f = fwd(d.trav.rot);
      d.knockDown(-f.x, -f.z, 4, 0.1);
    },
  },
  {
    label: '5 Esplosione',
    run: (d) => {
      const f = fwd(d.trav.rot);
      d.knockDown(-f.x, -f.z, 13, 0.9);
    },
  },
  {
    label: "6 Caduta dall'alto",
    run: (d) => {
      d.teleport(d.posX, d.posZ, undefined, d.trav.feetY + 4);
      // un attimo per far raggiungere al ragdoll la nuova quota
      window.setTimeout(() => {
        const f = fwd(d.trav.rot);
        pcs()?.knockDown(f.x, f.z, 1.5, 0);
      }, 150);
    },
  },
  {
    label: '7 Pala rotante',
    run: (d) => {
      // pale dell'arena (ArenaObstacles: perno in 0,5, raggio 4.75)
      if (!useStore.getState().arenaScene.obstacles) console.warn("[koLab] ostacoli spenti: accendi gli ostacoli dell'arena");
      d.teleport(3.2, 5, Math.PI / 2);
    },
  },
];

export function runKoScenario(i: number): boolean {
  const d = pcs();
  const sc = KO_SCENARIOS[i];
  if (!d || !sc) return false;
  if (d.down || d.isDead) {
    console.warn("[koLab] il personaggio e' ancora a terra: aspetta che si rialzi");
    return false;
  }
  sc.run(d);
  return true;
}

export function copyKoValues(): string {
  const b = useStore.getState().ragdollBench as unknown as Record<string, number>;
  const vals: Record<string, number> = {};
  for (const k of KO_BENCH_KEYS) vals[k] = b[k];
  const txt = JSON.stringify(vals);
  console.log('[koLab] valori:', txt);
  navigator.clipboard?.writeText(txt).catch(() => undefined);
  return txt;
}
