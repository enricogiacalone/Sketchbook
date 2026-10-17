import { KIMODO_CLIPS } from './kimodo';
import gait from '../generated/kimodoGait.json';

// Clip Kimodo con "root motion" (partenze, fermate, svolte: tools/kimodo/
// animations.json, rootMotion: true). Nel file della clip il corpo sta fermo
// e guarda sempre avanti; quanto avanza e gira, fotogramma per fotogramma, e'
// in kimodoClips.json ("motion": x di lato (+ = a sinistra), z avanti, yaw
// (+ = a sinistra), a 30 fps, in metri e radianti, rispetto all'inizio).
// Qui: lettura di quella traccia e scelta del punto di ingresso di una clip,
// in modo che velocita' e piede in appoggio coincidano con quelli del passo
// normale (gtaLocomotion.ts: ls.speed, ls.phase con 0 = appoggio sinistro).

interface Track {
  fps: number;
  x: number[];
  z: number[];
  yaw: number[];
}

export const motionTrack = (clip: string): Track | null => {
  const m = (KIMODO_CLIPS[clip] as any)?.motion as Track | undefined;
  return m && m.z?.length > 1 ? m : null;
};

export const hasMotion = (clip: string) => motionTrack(clip) !== null;
export const clipSeconds = (clip: string) => KIMODO_CLIPS[clip]?.duration ?? 0;

export interface MotionSample {
  x: number;
  z: number;
  yaw: number;
}

// posizione e rotazione (rispetto all'inizio della clip) al tempo t (s di clip)
export function sampleMotion(clip: string, t: number, out: MotionSample): MotionSample {
  const m = motionTrack(clip);
  if (!m) {
    out.x = out.z = out.yaw = 0;
    return out;
  }
  const f = Math.max(0, Math.min(m.z.length - 1, t * m.fps));
  const i = Math.floor(f);
  const j = Math.min(m.z.length - 1, i + 1);
  const k = f - i;
  out.x = m.x[i] + (m.x[j] - m.x[i]) * k;
  out.z = m.z[i] + (m.z[j] - m.z[i]) * k;
  out.yaw = m.yaw[i] + (m.yaw[j] - m.yaw[i]) * k;
  return out;
}

const _a: MotionSample = { x: 0, z: 0, yaw: 0 };
const _b: MotionSample = { x: 0, z: 0, yaw: 0 };

// velocita' della traccia (m/s di clip) attorno a t, su una finestra di 0.2 s
export function trackSpeed(clip: string, t: number): number {
  const w = 0.1;
  sampleMotion(clip, t - w, _a);
  sampleMotion(clip, t + w, _b);
  const dt = Math.min(t + w, clipSeconds(clip)) - Math.max(0, t - w);
  return dt > 1e-4 ? Math.hypot(_b.x - _a.x, _b.z - _a.z) / dt : 0;
}

// fase del passo (0..1, 0 = appoggio sinistro) della clip al tempo t; null se
// la clip non ha almeno due appoggi
export function leftPhaseAt(clip: string, t: number): number | null {
  const c = (gait as Record<string, { leftContacts: number[] }>)[clip]?.leftContacts;
  if (!c || c.length < 2) return null;
  // i primi appoggi a clip appena iniziata sono "da fermo": si parte dal primo vero passo
  let i = 0;
  while (i < c.length - 2 && c[i + 1] <= t) i++;
  const len = c[Math.min(c.length - 1, i + 1)] - c[i];
  if (len < 0.2) return null;
  const p = (t - c[i]) / len;
  return ((p % 1) + 1) % 1;
}

const phaseDist = (a: number, b: number) => {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
};

// Dove entrare in una clip di fermata: il tempo (primi `tMax` secondi) in cui la
// velocita' della traccia e' piu' vicina a `v0` e il piede e' nella stessa
// fase di `phase`. cost piccolo = buon aggancio.
export function findEntry(clip: string, v0: number, phase: number, tMax: number): { t: number; cost: number } | null {
  const m = motionTrack(clip);
  if (!m) return null;
  let best: { t: number; cost: number } | null = null;
  for (let t = 0; t <= tMax; t += 1 / m.fps) {
    const sp = trackSpeed(clip, t);
    const ph = leftPhaseAt(clip, t);
    const cost = Math.abs(sp - v0) / (v0 + 0.4) + (ph === null ? 0.3 : 1.6 * phaseDist(ph, phase));
    if (!best || cost < best.cost) best = { t, cost };
  }
  return best;
}

// primo istante, dopo `from`, in cui il piede sinistro appoggia (per passare dalla
// clip di partenza al passo normale senza saltare di fase)
export function nextLeftContact(clip: string, from: number): number | null {
  const c = (gait as Record<string, { leftContacts: number[] }>)[clip]?.leftContacts;
  if (!c) return null;
  for (const t of c) if (t >= from) return t;
  return null;
}

// primo istante in cui la rotazione ha fatto `frac` (0..1) del totale
export function yawDoneAt(clip: string, frac: number): number {
  const m = motionTrack(clip);
  if (!m) return 0;
  const tot = m.yaw[m.yaw.length - 1];
  for (let i = 0; i < m.yaw.length; i++) if (Math.abs(m.yaw[i]) >= Math.abs(tot) * frac) return i / m.fps;
  return m.yaw.length / m.fps;
}

export const totalYaw = (clip: string): number => {
  const m = motionTrack(clip);
  return m ? m.yaw[m.yaw.length - 1] : 0;
};
