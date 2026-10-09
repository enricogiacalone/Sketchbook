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
  prompt: string;
}

export const KIMODO_CLIPS = meta as Record<string, KimodoClipInfo>;

export const K = {
  // stati del personaggio
  injuredWalk: 'Kimodo_injured_walk',
  outOfBreath: 'Kimodo_out_of_breath',
  victory: ['Kimodo_victory', 'Kimodo_victory_dance'],
  // folla
  crowdIdles: ['Kimodo_look_around', 'Kimodo_wait_impatient', 'Kimodo_stretch', 'Kimodo_phone_talk'],
  panicRun: 'Kimodo_panic_run',
  cower: 'Kimodo_cower',
} as const;

// le camminate/corse in loop entrano nella tabella delle velocita' delle
// clip (locomotion.ts): timeScaleFor() le fa avanzare senza far scivolare i
// piedi, come quelle del rig
for (const [name, info] of Object.entries(KIMODO_CLIPS)) {
  if (info.loop && info.speed > 0.3) CLIP_GROUND_SPEED[name] = info.speed;
}
