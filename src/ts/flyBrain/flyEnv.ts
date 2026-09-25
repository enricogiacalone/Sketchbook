// Ambiente di addestramento del cervello-mosca, condiviso da trainer Node
// (training/fly-brain) e laboratorio nel browser (src/ts/flyLab): un
// episodio = il corpo dinamico (flyBody) comandato dal cervello-connettoma
// (connectomePolicy), con l'animazione come RIFERIMENTO (stile DeepMimic).
import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { parseSkinnedModel, parseClips, type LoadedModel } from './glbParse';
import {
  createFlyBody, jointAnglesFromBones, jointAnglesFromBodies, headingOf, destroyFlyBody, type FlyBody,
} from './flyBody';
import { parseFlyGraph, makeLayout, ConnectomeBrain, graphForVariant, type FlyGraph, type PolicyLayout, type BrainVariant } from './connectomePolicy';
import { FlyController, CONTROL_HZ, N_CMD, type FlyTask } from './flyController';

export const SUBSTEPS = 4; // fisica a 120 Hz come nel gioco
export type Task = FlyTask;
const EE = ['Head', 'Foot_L', 'Foot_R', 'ForeArm_L', 'ForeArm_R'];
export { CONTROL_HZ, N_CMD };
type Rapier = typeof RAPIER_NS;

export interface Assets {
  R: Rapier;
  model: LoadedModel;
  clips: Record<string, THREE.AnimationClip>;
  graph: FlyGraph;
  layout: PolicyLayout;
  nObs: number;
  nAct: number;
}

export interface AssetBuffers {
  model: ArrayBuffer; // soldier-citizen.glb
  anims: ArrayBuffer[]; // GLB con le clip
  graphJson: { neurons: { role: number; type: string }[] };
  edges: ArrayBuffer;
}

// R deve essere gia' inizializzato (await RAPIER.init())
export function buildAssets(R: Rapier, b: AssetBuffers, variant: BrainVariant = 'real'): Assets {
  const model = parseSkinnedModel(b.model);
  const clips: Record<string, THREE.AnimationClip> = {};
  for (const buf of b.anims) for (const c of parseClips(buf)) clips[c.name] = c;
  const graph = graphForVariant(parseFlyGraph(b.graphJson, b.edges), variant);
  // dimensioni: si costruisce un corpo di prova una volta
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  const fb = createFlyBody(R, world, model.root, model.bones, clips['Fighting Idle']);
  const nObs = fb.nObs, nAct = fb.nAct;
  world.free();
  const layout = makeLayout(graph, nObs + N_CMD + nAct, nAct);
  return { R, model, clips, graph, layout, nObs, nAct };
}

// mulberry32
export function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _h = new THREE.Vector3();

// posizioni dei punti "estremi" relative al bacino, nel frame di direzione
function eeFromBodies(fb: FlyBody, out: Float32Array) {
  headingOf(fb, _q); _qi.copy(_q).invert();
  const h = fb.segs[0].body.translation();
  let k = 0;
  for (const n of EE) {
    const t = fb.bySeg[n].body.translation();
    _v.set(t.x - h.x, t.y - h.y, t.z - h.z).applyQuaternion(_qi);
    out[k++] = _v.x; out[k++] = _v.y; out[k++] = _v.z;
  }
}
function eeFromBones(fb: FlyBody, out: Float32Array) {
  const hip = fb.segs[0];
  hip.bone.getWorldQuaternion(_q).multiply(hip.bodyFromBone);
  _v.set(0, 0, 1).applyQuaternion(_q); _v.y = 0; _v.normalize();
  _qi.setFromAxisAngle(_h.set(0, 1, 0), Math.atan2(_v.x, _v.z)).invert();
  hip.bone.getWorldPosition(_h);
  let k = 0;
  for (const n of EE) {
    fb.bySeg[n].bone.getWorldPosition(_v).sub(_h).applyQuaternion(_qi);
    out[k++] = _v.x; out[k++] = _v.y; out[k++] = _v.z;
  }
}

// Spinta orizzontale (impulso in N*s) sul busto, direzione `angle` (rad)
export function applyPush(fb: FlyBody, impulse: number, angle: number) {
  const b = (fb.bySeg['SpineMid'] ?? fb.segs[0]).body;
  b.applyImpulse({ x: Math.sin(angle) * impulse, y: 0, z: Math.cos(angle) * impulse }, true);
}

export interface EpisodeResult { score: number; steps: number; fell: boolean; meanPose: number; headEnd: number; dist: number }

export class FlyEnv {
  A: Assets;
  mixer: THREE.AnimationMixer;
  constructor(A: Assets) {
    this.A = A;
    this.mixer = new THREE.AnimationMixer(A.model.root);
  }
  private pose(clip: THREE.AnimationClip, t: number) {
    const a = this.mixer.clipAction(clip);
    if (!a.isRunning()) {
      this.mixer.stopAllAction();
      a.reset().play();
    }
    this.mixer.setTime(t % clip.duration);
    this.A.model.root.updateMatrixWorld(true);
  }

  // push = forza delle spinte casuali (N*s, 0 = niente): ogni 1.2-3 s un
  // impulso orizzontale in direzione casuale sul busto, uguale per tutti gli
  // individui dello stesso episodio (stesso seme) -> confronto equo
  runEpisode(params: Float32Array, task: Task, epSeed: number, seconds = 6, record?: (fb: FlyBody, t: number) => void, push = 0): EpisodeResult {
    const A = this.A;
    const R = rng(epSeed);
    const world = new A.R.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / (CONTROL_HZ * SUBSTEPS);
    world.createCollider(A.R.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0).setFriction(1.0));
    const clips = { idle: A.clips['Idle_A'], walk: A.clips['Walk'], lay: A.clips['LayToIdle'] };
    const first = task === 'walk' ? clips.walk : task === 'getup' ? clips.lay : clips.idle;
    const phase0 = task === 'getup' ? 0 : R() * first.duration;
    this.pose(first, phase0);
    const fb = createFlyBody(A.R, world, A.model.root, A.model.bones, A.clips['Fighting Idle']);
    const brain = new ConnectomeBrain(A.graph, A.layout, params);
    const ctl = new FlyController(fb, brain, clips, A.model.root, task);
    ctl.mixer = this.mixer; // un solo mixer sul modello
    ctl.start(phase0);
    const cur = new Float32Array(A.nAct);
    const ref = ctl.ref;
    const eeB = new Float32Array(EE.length * 3), eeR = new Float32Array(EE.length * 3);
    const steps = Math.round(seconds * CONTROL_HZ);
    let total = 0, poseSum = 0, fell = false, n = 0;
    const start = fb.segs[0].body.translation();
    const sx = start.x, sz = start.z;
    const PR = rng(epSeed * 7 + 13);
    let nextPush = Math.round((1 + PR() * 1.5) * CONTROL_HZ);
    for (let step = 0; step < steps; step++) {
      if (push > 0 && task !== 'getup' && step === nextPush) {
        applyPush(fb, push * (0.6 + 0.4 * PR()), PR() * Math.PI * 2);
        nextPush += Math.round((1.2 + PR() * 1.8) * CONTROL_HZ);
      }
      ctl.control();
      for (let s = 0; s < SUBSTEPS; s++) world.step();
      // ricompensa: corpo dopo il passo contro il riferimento del passo dopo
      ctl.poseCurrentRef();
      jointAnglesFromBones(fb, ref);
      jointAnglesFromBodies(fb, cur);
      let pe = 0;
      for (let i = 0; i < ref.length; i++) { const d = cur[i] - ref[i]; pe += d * d; }
      eeFromBodies(fb, eeB); eeFromBones(fb, eeR);
      let ee = 0;
      for (let i = 0; i < eeB.length; i++) { const d = eeB[i] - eeR[i]; ee += d * d; }
      const head = fb.bySeg.Head.body.translation();
      const hip = fb.segs[0].body.translation();
      fb.segs[0].bone.getWorldPosition(_h);
      const refHipY = _h.y;
      const rPose = Math.exp(-0.5 * pe);
      const rEE = Math.exp(-10 * ee);
      const rH = Math.exp(-20 * (hip.y - refHipY) ** 2);
      let rV = 1;
      if (task === 'walk') {
        headingOf(fb, _q);
        _v.set(0, 0, 1).applyQuaternion(_q);
        const lv = fb.segs[0].body.linvel();
        const vf = lv.x * _v.x + lv.z * _v.z;
        const vs = lv.x * _v.z - lv.z * _v.x;
        rV = Math.exp(-3 * ((vf - ctl.cmdSpeed) ** 2 + vs * vs));
      }
      let r = 0.45 * rPose + 0.2 * rEE + 0.2 * rH + 0.15 * rV;
      if (task === 'getup') r = 0.4 * rPose + 0.2 * rEE + 0.4 * Math.min(1, Math.max(0, head.y) / 1.45);
      total += r; poseSum += rPose; n++;
      record?.(fb, step / CONTROL_HZ);
      if (task !== 'getup' && (head.y < 0.9 || hip.y < 0.45)) { fell = true; break; }
      if (!Number.isFinite(hip.y)) { fell = true; break; }
    }
    const end = fb.segs[0].body.translation();
    const headEnd = fb.bySeg.Head.body.translation().y;
    const dist = Math.hypot(end.x - sx, end.z - sz);
    destroyFlyBody(fb);
    world.free();
    return { score: total / steps, steps: n, fell, meanPose: poseSum / Math.max(1, n), headEnd, dist };
  }
}
