import meta from '../generated/kimodoClips.json';
import { CLIP_GROUND_SPEED } from '../components/Environment/locomotion';

// Animazioni generate con Kimodo (tools/kimodo/, `npm run kimodo -- batch`)
// e adattate al manichino da scripts/kimodo-retarget.mjs, che scrive anche
// i dati qui sotto (src/ts/generated/kimodoClips.json). Ogni clip si chiama
// Kimodo_<nome di tools/kimodo/animations.json>. Il codice le usa SOLO se
// ci sono (prima della generazione il gioco resta com'era).

export const KIMODO_ANIMS_URL = 'kimodo-animations.glb';

export interface KimodoClipInfo {
  duration: number;
  loop: boolean;
  inPlace: boolean;
  speed: number; // m/s sul terreno (gia' tolto se inPlace)
  // cartella di tools/kimodo/animations.json (folla, stati, ragdoll, locomozione, idle...): serve al pannello
  group?: string;
  prompt: string;
}

export const KIMODO_CLIPS = meta as Record<string, KimodoClipInfo>;

export const K = {
  // stati del personaggio
  injuredWalk: 'Kimodo_injured_walk',
  outOfBreath: 'Kimodo_out_of_breath',
  victory: ['Kimodo_victory', 'Kimodo_victory_dance'],
  // riposo (idle) generato da Kimodo con inizio e fine sulla stessa posa delle partenze e degli arresti:
  // il respiro di base e, ogni tanto, una variazione (peso, sguardo, spalle)
  idleBase: 'Kimodo_idle_breathe',
  idleVariations: ['Kimodo_idle_shift_weight', 'Kimodo_idle_shift_weight', 'Kimodo_idle_fidget'],
  // passo laterale (era "idle_look": non e' un riposo): per spostarsi lungo un muro in copertura
  sideStep: 'Kimodo_side_step',
  // folla
  crowdIdles: ['Kimodo_look_around', 'Kimodo_wait_impatient', 'Kimodo_stretch', 'Kimodo_phone_talk'],
  panicRun: 'Kimodo_panic_run',
  cower: 'Kimodo_cower',
} as const;

// Configurazione del riposo del giocatore (modificabile dal pannello Banco ragdoll > Animazioni Kimodo > Idle): il respiro di
// base, e se/quanto spesso parte una variazione per un giro della clip. PlayerCombatSoldier la legge ogni frame.
export const idleConfig = {
  base: K.idleBase as string,
  variations: true,
  minS: 6,
  maxS: 12,
  // variazioni ammesse (una per riga: piu' righe = piu' frequente)
  pool: [...K.idleVariations] as string[],
};
// le clip dell'idle in ordine di preferenza (il riposo di base va scelto tra queste)
export const IDLE_CLIPS = Object.keys(meta).filter((n) => (meta as Record<string, KimodoClipInfo>)[n].group === 'idle');

// le camminate/corse in loop entrano nella tabella delle velocita' delle
// clip (locomotion.ts): timeScaleFor() le fa avanzare senza far scivolare i
// piedi, come quelle del rig
for (const [name, info] of Object.entries(KIMODO_CLIPS)) {
  if (info.loop && info.speed > 0.3) CLIP_GROUND_SPEED[name] = info.speed;
}
