// Il "sistema nervoso" completo: riferimento dall'animazione + cervello-
// connettoma + corpo. Condiviso da addestramento (training/fly-brain/env.ts)
// e gioco (FlyBrainFighter.tsx), cosi' la rete vede esattamente gli stessi
// ingressi in entrambi.
import * as THREE from 'three';
import {
  jointAnglesFromBones, driveJoints, setBodyFromBones, snapshotBonesAsBodies, observe, lowestPoint, liftBody, type FlyBody,
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
    this.input = new Float32Array(brain.L.nIn);
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
    this.brain.reset();
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
    this.brain.step(input, this.out);
    for (let i = 0; i < this.tgt.length; i++) this.tgt[i] = this.ref[i] + RESIDUAL_SCALE_RAD * this.out[i];
    driveJoints(this.fb, this.tgt, null, 1);
    // alzarsi al rallentatore (x0.5): 3 s invece di 1.5
    this.t += (1 / CONTROL_HZ) * (task === 'getup' && !this.getupDone ? 0.5 : 1);
  }
}
