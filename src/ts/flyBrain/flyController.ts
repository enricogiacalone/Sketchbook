// Il "sistema nervoso" completo: riferimento dall'animazione + cervello-
// connettoma + corpo. Condiviso da addestramento (training/fly-brain/env.ts)
// e gioco (FlyBrainFighter.tsx), cosi' la rete vede esattamente gli stessi
// ingressi in entrambi.
import * as THREE from 'three';
import {
  jointAnglesFromBones, driveJoints, setBodyFromBones, snapshotBonesAsBodies, observe, footPressure, lowestPoint, liftBody, type FlyBody,
} from './flyBody';
import { ConnectomeBrain, RESIDUAL_SCALE_RAD } from './connectomePolicy';

export const CONTROL_HZ = 30;
export type FlyTask = 'stand' | 'walk' | 'getup';
export const N_CMD = 8;
// velocita' della clip Walk (misurata, vedi locomotion.ts)
export const WALK_CLIP_SPEED = 0.73;

export interface FlyClips {
  idle: THREE.AnimationClip; // Idle_A
  walk: THREE.AnimationClip; // Walk
  lay: THREE.AnimationClip; // LayToIdle
}

const _rp = new THREE.Vector3();
const _v0 = new THREE.Vector3();
// alzarsi: la registrazione (l'animazione di riferimento) aspetta il corpo.
// Avanza al rallentatore (x0.5) finche' il bacino vero sta al passo con
// quello dell'animazione; se resta indietro di piu' di GETUP_WAIT_M rallenta
// fino a fermarsi, cosi' il riferimento non "scappa" in piedi mentre il corpo
// e' ancora a terra (e non gli chiede di stare dritto e rigido sdraiato).
export const GETUP_SPEED = 0.5;
const GETUP_WAIT_M = 0.1;
const GETUP_STOP_M = 0.25;
// ...ma non si ferma mai del tutto (niente stallo con la fase congelata)
const GETUP_MIN_SPEED = 0.1;

// Altezze di bacino e petto (sopra i piedi del modello) lungo l'alzata e da
// fermi in piedi: servono alla "mano che aiuta", che segue il tempo
// NOMINALE dell'alzata (non quello che aspetta il corpo), altrimenti se il
// riferimento aspetta, la mano smette di tirare e resta tutto fermo.
export interface GetupHeights { dt: number; hip: Float32Array; chest: Float32Array; standHip: number; standChest: number }
const heightCache = new WeakMap<THREE.AnimationClip, GetupHeights>();

export class FlyController {
  fb: FlyBody;
  brain: ConnectomeBrain;
  clips: FlyClips;
  refRoot: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  task: FlyTask;
  refClip: THREE.AnimationClip;
  t = 0;
  getupDone = false;
  // alzarsi: tempo nominale (x0.5, non aspetta) e bersagli della mano
  tNominal = 0;
  heights: GetupHeights | null = null;
  assistHipY = 0;
  assistChestY = 0;
  // alzata nominale finita: la mano centra anche il corpo sopra i piedi
  assistCentre = false;
  cmdSpeed = 0;
  // quota del pavimento su cui poggia (0 in addestramento, la sala nel gioco)
  groundY = 0;
  obs: Float32Array;
  input: Float32Array;
  out: Float32Array;
  ref: Float32Array;
  tgt: Float32Array;

  constructor(fb: FlyBody, brain: ConnectomeBrain, clips: FlyClips, refRoot: THREE.Object3D, task: FlyTask) {
    this.fb = fb;
    this.brain = brain;
    this.clips = clips;
    this.refRoot = refRoot;
    this.mixer = new THREE.AnimationMixer(refRoot);
    this.task = task;
    this.refClip = task === 'walk' ? clips.walk : task === 'getup' ? clips.lay : clips.idle;
    this.cmdSpeed = task === 'walk' ? WALK_CLIP_SPEED : 0;
    this.obs = new Float32Array(fb.nObs);
    this.input = new Float32Array(brain.L.nIn + brain.L.nExtra);
    this.out = new Float32Array(fb.nAct);
    this.ref = new Float32Array(fb.nAct);
    this.tgt = new Float32Array(fb.nAct);
  }

  // mette le ossa di riferimento alla posa della clip al tempo t
  poseRef(clip: THREE.AnimationClip, t: number) {
    const a = this.mixer.clipAction(clip);
    if (!a.isRunning()) {
      this.mixer.stopAllAction();
      a.reset().play();
    }
    this.mixer.setTime(t % clip.duration);
    this.refRoot.updateMatrixWorld(true);
  }

  // tempo di riferimento "effettivo" (l'alzarsi non va in loop)
  private refTime() {
    return this.task === 'getup' && !this.getupDone ? Math.min(this.t, this.clips.lay.duration * 0.999) : this.t;
  }
  poseCurrentRef() {
    this.poseRef(this.refClip, this.refTime());
  }

  // Stato iniziale: il corpo nella posa del riferimento alla fase phase0
  // (in corsa, con le velocita' dell'animazione); per l'alzarsi, a terra.
  start(phase0: number) {
    this.t = phase0;
    this.getupDone = false;
    this.refClip = this.task === 'walk' ? this.clips.walk : this.task === 'getup' ? this.clips.lay : this.clips.idle;
    this.poseRef(this.refClip, phase0);
    const prev = snapshotBonesAsBodies(this.fb);
    this.t = phase0 + 1 / CONTROL_HZ;
    this.poseRef(this.refClip, this.t);
    setBodyFromBones(this.fb, this.task === 'getup' ? null : prev, 1 / CONTROL_HZ);
    // appoggiato al pavimento (groundY), senza compenetrazioni; l'alzarsi
    // parte qualche cm sopra e si adagia
    liftBody(this.fb, this.groundY - lowestPoint(this.fb) + (this.task === 'getup' ? 0.05 : 0.002));
    if (this.task === 'getup') {
      this.heights = this.getupHeights();
      this.tNominal = phase0;
      this.updateAssistTargets();
    }
    this.brain.reset();
  }

  private chestSeg() {
    return this.fb.bySeg['SpineHigh'] ?? this.fb.bySeg['Head'];
  }
  private getupHeights(): GetupHeights {
    const lay = this.clips.lay;
    let h = heightCache.get(lay);
    if (h) return h;
    const n = Math.ceil(lay.duration / (1 / 60)) + 1;
    const dt = lay.duration / (n - 1);
    const hip = new Float32Array(n), chest = new Float32Array(n);
    this.refRoot.getWorldPosition(_v0);
    for (let i = 0; i < n; i++) {
      this.poseRef(lay, Math.min(i * dt, lay.duration * 0.999));
      hip[i] = this.fb.segs[0].bone.getWorldPosition(_rp).y - _v0.y;
      chest[i] = this.chestSeg().bone.getWorldPosition(_rp).y - _v0.y;
    }
    this.poseRef(this.clips.idle, 0);
    const standHip = this.fb.segs[0].bone.getWorldPosition(_rp).y - _v0.y;
    const standChest = this.chestSeg().bone.getWorldPosition(_rp).y - _v0.y;
    h = { dt, hip, chest, standHip, standChest };
    heightCache.set(lay, h);
    // rimette il riferimento dov'era
    this.poseCurrentRef();
    return h;
  }
  private updateAssistTargets() {
    const h = this.heights;
    if (!h) return;
    const f = this.tNominal / h.dt;
    this.assistCentre = f >= h.hip.length - 1;
    if (this.assistCentre) {
      this.assistHipY = this.groundY + h.standHip;
      this.assistChestY = this.groundY + h.standChest;
      return;
    }
    const i = Math.floor(f), a = f - i;
    this.assistHipY = this.groundY + h.hip[i] * (1 - a) + h.hip[i + 1] * a;
    this.assistChestY = this.groundY + h.chest[i] * (1 - a) + h.chest[i + 1] * a;
  }

  // Un passo di controllo (1/CONTROL_HZ): legge il corpo, pensa, comanda
  // i motori, avanza il tempo del riferimento.
  control() {
    const { task, clips } = this;
    if (task === 'getup' && !this.getupDone && this.t >= clips.lay.duration * 0.999) {
      this.getupDone = true;
      this.refClip = clips.idle;
      this.t = 0;
    }
    const tRef = this.refTime();
    this.poseRef(this.refClip, tRef);
    jointAnglesFromBones(this.fb, this.ref);
    observe(this.fb, this.obs);
    const input = this.input;
    let k = 0;
    for (let i = 0; i < this.obs.length; i++) input[k++] = this.obs[i];
    const ph = (tRef / this.refClip.duration) * Math.PI * 2;
    input[k++] = this.cmdSpeed; input[k++] = 0; input[k++] = 0;
    input[k++] = Math.sin(ph); input[k++] = Math.cos(ph);
    input[k++] = task === 'stand' ? 1 : 0; input[k++] = task === 'walk' ? 1 : 0; input[k++] = task === 'getup' ? 1 : 0;
    for (let i = 0; i < this.ref.length; i++) input[k++] = this.ref[i];
    // sensi aggiunti in coda: pressione tallone/punta
    if (this.brain.L.nExtra >= 4) footPressure(this.fb, input, this.brain.L.nIn);
    this.brain.step(input, this.out);
    for (let i = 0; i < this.tgt.length; i++) this.tgt[i] = this.ref[i] + RESIDUAL_SCALE_RAD * this.out[i];
    driveJoints(this.fb, this.tgt, null, 1);
    // alzarsi al rallentatore (x0.5: 3 s invece di 1.5), aspettando il corpo
    let speed = 1;
    if (task === 'getup' && !this.getupDone) {
      this.fb.segs[0].bone.getWorldPosition(_rp);
      this.refRoot.getWorldPosition(_v0);
      const behind = (_rp.y - _v0.y) - (this.fb.segs[0].body.translation().y - this.groundY);
      speed = GETUP_SPEED * Math.min(1, Math.max(GETUP_MIN_SPEED, (GETUP_STOP_M - behind) / (GETUP_STOP_M - GETUP_WAIT_M)));
    }
    if (task === 'getup') {
      this.tNominal += (1 / CONTROL_HZ) * GETUP_SPEED;
      this.updateAssistTargets();
    }
    this.t += (1 / CONTROL_HZ) * speed;
  }
}
