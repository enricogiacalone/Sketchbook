import type * as THREE from 'three';
import type { NavLink } from '../../../lib/nav';
import { RUN_CLIP } from '../../Environment/locomotion';
import type { MannequinActor } from '../useMannequinActor';

// scavalcare un muro: non e' fisico (il corpo e' tenuto da un solo punto), e' una traiettoria da A a B in tre tempi
// come il giocatore (traversal.ts): ci si tira su con le mani (Climb Wall), si scavalca la cima (ClimbUp_1m in-place)
// e si cade dall'altra parte (Jump_air, Jump_Land). Condivisa da cacciatori/folla (hostile.ts) e da poliziotti,
// alleati e zombi (npcCombat.ts: stepToward).
export const VAULT_S = 1.7;
const VAULT_PULL = 0.4; // fine del tirarsi su (frazione)
const VAULT_TOP = 0.7; // fine dello scavalcare (frazione)
const smoothstep = (u: number) => u * u * (3 - 2 * u);
const clamp01 = (u: number) => Math.min(1, Math.max(0, u));

export interface VaultRun {
  t: number;
  link: NavLink;
  fx: number;
  fz: number;
  phase: number;
}
export const newVaultRun = (link: NavLink, fx: number, fz: number): VaultRun => ({ t: 0, link, fx, fz, phase: -1 });

// Avanza lo scavalco: sposta `pos` (x, z), avvia le animazioni; ritorna quanto e' sollevato dal piano, la direzione
// del salto (yaw) e se ha finito.
export function stepVaultRun(v: VaultRun, actor: MannequinActor, pos: THREE.Vector3, delta: number): { lift: number; yaw: number; done: boolean } {
  v.t += delta;
  const u = Math.min(1, v.t / VAULT_S);
  const L = v.link;
  const len = Math.hypot(L.bx - L.ax, L.bz - L.az) || 1;
  const ux = (L.bx - L.ax) / len;
  const uz = (L.bz - L.az) / len;
  const mx = (L.ax + L.bx) / 2;
  const mz = (L.az + L.bz) / 2;
  // faccia del muro da cui si parte (0.2 m: meta' dello spessore) e punto sopra il muro
  const fx = mx - ux * 0.55;
  const fz = mz - uz * 0.55;
  let x: number, z: number, lift: number;
  if (u < VAULT_PULL) {
    // si avvicina alla faccia e si tira su: le mani sul bordo (1 m sotto la cima)
    const k = smoothstep(u / VAULT_PULL);
    x = v.fx + (fx - v.fx) * k;
    z = v.fz + (fz - v.fz) * k;
    lift = (L.h - 0.94) * k;
  } else if (u < VAULT_TOP) {
    // sale sul bordo e va sopra il muro
    const k = smoothstep((u - VAULT_PULL) / (VAULT_TOP - VAULT_PULL));
    x = fx + (mx - fx) * k;
    z = fz + (mz - fz) * k;
    lift = L.h - 0.94 + 0.94 * k;
  } else {
    // scende dall'altra parte
    const k = clamp01((u - VAULT_TOP) / (1 - VAULT_TOP));
    const e = k * k * (3 - 2 * k);
    x = mx + (L.bx - mx) * e;
    z = mz + (L.bz - mz) * e;
    lift = L.h * (1 - k * k);
  }
  pos.x = x;
  pos.z = z;
  const phase = u < VAULT_PULL ? 0 : u < VAULT_TOP ? 1 : u < 0.92 ? 2 : 3;
  if (phase !== v.phase) {
    v.phase = phase;
    const pull = actor.hasClip('Climb Wall') ? 'Climb Wall' : 'ClimbUp_1m__ip';
    if (phase === 0) actor.play(pull, 0.1, false, 1.3);
    else if (phase === 1) actor.play(actor.hasClip('ClimbUp_1m__ip') ? 'ClimbUp_1m__ip' : RUN_CLIP, 0.1, false, 0.625 / ((VAULT_TOP - VAULT_PULL) * VAULT_S));
    else if (phase === 2) actor.play(actor.hasClip('Jump_air') ? 'Jump_air' : RUN_CLIP, 0.15, true);
    else actor.play(actor.hasClip('Jump_Land') ? 'Jump_Land' : RUN_CLIP, 0.08, false, 1.4, 0.5);
  }
  return { lift, yaw: Math.atan2(ux, uz), done: u >= 1 };
}
