import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import type { LyingState } from './useRagdoll';

// "vorrei si comportasse piu' da ragdoll se il colpo e' forte" -- colpo
// forte = KO fisico: il corpo attivo spegne i motori e cade davvero (vedi
// useRagdoll.knockDown), resta a terra finche' non si ferma, se e' a pancia
// in giu' si gira sulla schiena, poi si rialza con la clip LayToIdle (che
// parte sdraiata sulla schiena), messa esattamente dove e' caduto: il
// personaggio (radice) viene spostato sotto il bacino del corpo a terra e
// ruotato come lui, cosi' la posa di partenza della clip coincide con il
// corpo e i motori lo tirano su senza scatti.
export const GETUP_CLIP = 'LayToIdle';
export const KNOCKDOWN_MIN_S = 1.0; // a terra almeno
export const KNOCKDOWN_MAX_S = 4.0; // comunque si rialza entro
const ROLL_WAIT_S = 0.7;

export interface LyingPose {
  pelvis: THREE.Vector3; // bacino nella clip, nel frame del gruppo del personaggio
  headAngle: number; // direzione bacino->testa nel frame del gruppo (atan2 x,z)
}

// Posa sdraiata del primo fotogramma della clip, misurata su una copia del
// modello girata come nel gioco (<primitive rotation-y = PI>).
export function measureLyingPose(scene: THREE.Object3D, clip: THREE.AnimationClip | undefined): LyingPose | null {
  if (!clip) return null;
  const c = SkeletonUtils.clone(scene) as THREE.Object3D;
  const holder = new THREE.Group();
  c.rotation.y = Math.PI;
  holder.add(c);
  const mixer = new THREE.AnimationMixer(c);
  mixer.clipAction(clip).play();
  mixer.setTime(0);
  holder.updateMatrixWorld(true);
  const p = c.getObjectByName('pelvis'), h = c.getObjectByName('head');
  if (!p || !h) return null;
  const pp = p.getWorldPosition(new THREE.Vector3()), hp = h.getWorldPosition(new THREE.Vector3());
  mixer.stopAllAction();
  return { pelvis: new THREE.Vector3(pp.x, 0, pp.z), headAngle: Math.atan2(hp.x - pp.x, hp.z - pp.z) };
}

// Dove mettere la radice (x, z) e con che rotazione, perche' la clip parta
// esattamente sul corpo a terra.
export function getUpPlacement(ly: LyingState, pose: LyingPose): { x: number; z: number; rotation: number } {
  const rotation = Math.atan2(ly.headDir.x, ly.headDir.z) - pose.headAngle;
  const c = Math.cos(rotation), s = Math.sin(rotation);
  // stessa convenzione di Object3D.rotation.y
  const ox = pose.pelvis.x * c + pose.pelvis.z * s;
  const oz = -pose.pelvis.x * s + pose.pelvis.z * c;
  return { x: ly.pelvis.x - ox, z: ly.pelvis.z - oz, rotation };
}

export interface KnockdownRuntime {
  active: boolean;
  t: number;
  rolls: number;
  lastRoll: number;
}
export const newKnockdown = (): KnockdownRuntime => ({ active: false, t: 0, rolls: 0, lastRoll: -10 });

// Un passo della fase a terra. Ritorna la posizione/rotazione per rialzarsi
// quando e' il momento (e rimette i motori), altrimenti null.
export function stepKnockdown(
  kd: KnockdownRuntime,
  dt: number,
  ragdoll: { getLyingState: () => LyingState | null; rollOver: () => void; standUp: () => void },
  pose: LyingPose | null
): { x: number; z: number; rotation: number } | null {
  kd.t += dt;
  const ly = ragdoll.getLyingState();
  if (!ly) {
    kd.active = false;
    ragdoll.standUp();
    return null;
  }
  const down = ly.pelvis.y < 0.6 + 0.15 + 0.5; // bacino basso (margine per il pavimento rialzato)
  if (kd.t >= KNOCKDOWN_MIN_S && ly.settled && !ly.faceUp && kd.rolls < 2 && kd.t - kd.lastRoll > ROLL_WAIT_S) {
    ragdoll.rollOver();
    kd.rolls++;
    kd.lastRoll = kd.t;
    return null;
  }
  const ready = kd.t >= KNOCKDOWN_MIN_S && ly.settled && (ly.faceUp || kd.rolls >= 2) && kd.t - kd.lastRoll > ROLL_WAIT_S;
  if (!ready && kd.t < KNOCKDOWN_MAX_S) return null;
  kd.active = false;
  ragdoll.standUp();
  if (!pose || !down) return null; // non e' davvero a terra: riprende e basta
  return getUpPlacement(ly, pose);
}
