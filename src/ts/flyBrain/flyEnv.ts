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

// "Mano che aiuta" per imparare ad alzarsi (curriculum, come negli umanoidi
// simulati): due molle verticali, sul bacino e sul petto, tirano verso
// l'altezza che quei punti hanno nell'alzata al tempo NOMINALE (hipY/chestY
// dal controllore: non aspettano il corpo). Solo verso l'alto; `level`
// 0..1 scende da solo man mano che il cervello impara (vedi nextAssist).
const massCache = new WeakMap<FlyBody, number>();
// centre = alzata (nominale) finita: la mano allora tiene anche bacino e
// petto sopra il punto medio dei piedi, cosi' con tanto aiuto la mosca sta
// in equilibrio VERO (e il cervello vede com'e'), non appesa storta
export function assistUp(fb: FlyBody, level: number, dt: number, hipY: number, chestY: number, centre = false) {
  if (level <= 0) return;
  let M = massCache.get(fb);
  if (M === undefined) {
    M = fb.segs.reduce((a, s) => a + s.body.mass(), 0);
    massCache.set(fb, M);
  }
  const m = M / 2;
  const pts: [FlyBody['segs'][number], number][] = [[fb.segs[0], hipY], [fb.bySeg['SpineHigh'] ?? fb.bySeg['Head'], chestY]];
  for (const [s, ty] of pts) {
    const b = s.body;
    const F = m * (ASSIST_GRAVITY * 9.81 + ASSIST_K * (ty - b.translation().y) - ASSIST_D * b.linvel().y);
    let fx = 0, fz = 0;
    if (centre) {
      const a = fb.bySeg.Foot_L.body.translation(), c = fb.bySeg.Foot_R.body.translation();
      const p = b.translation(), v = b.linvel();
      fx = m * (ASSIST_KH * ((a.x + c.x) / 2 - p.x) - ASSIST_DH * v.x);
      fz = m * (ASSIST_KH * ((a.z + c.z) / 2 - p.z) - ASSIST_DH * v.z);
      const cap = m * 9.81 * 0.5, h = Math.hypot(fx, fz);
      if (h > cap) { fx *= cap / h; fz *= cap / h; }
    }
    b.applyImpulse({ x: fx * level * dt, y: Math.min(Math.max(F, 0), m * 9.81 * ASSIST_MAX_G) * level * dt, z: fz * level * dt }, true);
  }
}
// niente sollevamento fisso (ASSIST_GRAVITY = 0): la mano e' una rete di
// sicurezza che spinge solo quando il corpo e' piu' basso dell'alzata, non
// un filo da burattino che lo tiene appeso anche quando e' gia' su
export let ASSIST_GRAVITY = 0, ASSIST_K = 60, ASSIST_D = 12, ASSIST_MAX_G = 1.6;
const ASSIST_KH = 40, ASSIST_DH = 10;
export function tuneAssist(g: number, k: number, d: number, maxG: number) {
  ASSIST_GRAVITY = g; ASSIST_K = k; ASSIST_D = d; ASSIST_MAX_G = maxG;
}
// "In piedi" per davvero: testa sopra 1.2 m E corpo dritto (la linea
// bacino->testa inclinata meno di 25 gradi dalla verticale). Solo l'altezza
// non basta: un corpo storto appeso alla "mano che aiuta" arriva a 1.2 m.
export const GETUP_UP_HEAD = 1.2;
export const UPRIGHT_MAX_TILT_DEG = 25;
const _up1 = new THREE.Vector3();
export function bodyTiltDeg(fb: FlyBody): number {
  const h = fb.bySeg.Head.body.translation();
  const p = fb.segs[0].body.translation();
  _up1.set(h.x - p.x, h.y - p.y, h.z - p.z);
  const len = _up1.length();
  return len < 1e-6 ? 90 : (Math.acos(Math.min(1, Math.max(-1, _up1.y / len))) * 180) / Math.PI;
}
// Piedi: la suola deve essere in piano (non solo il tallone o la punta) e
// appoggiata; il baricentro deve cadere dentro l'appoggio dei due piedi
// (con 3 cm di tolleranza). E' la definizione di equilibrio statico: chi sta
// sui talloni col corpo all'indietro, retto dalla "mano", non la supera.
const FOOT_FLAT_COS = Math.cos((20 * Math.PI) / 180);
const FOOT_ON_GROUND_M = 0.03;
const SUPPORT_MARGIN_M = 0.03;
const _fq = new THREE.Quaternion();
const _fv = new THREE.Vector3();
const _pts: number[] = [];
function footOnGround(fb: FlyBody, name: string, groundY: number): boolean {
  const c = fb.bySeg[name].body.collider(0);
  const t = c.translation(), r = c.rotation(), he = c.halfExtents();
  _fq.set(r.x, r.y, r.z, r.w);
  if (_fv.set(0, 1, 0).applyQuaternion(_fq).y < FOOT_FLAT_COS) return false;
  let low = 0;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    _fv.set(sx * he.x, -he.y, sz * he.z).applyQuaternion(_fq);
    const x = t.x + _fv.x, y = t.y + _fv.y, z = t.z + _fv.z;
    if (y - groundY < FOOT_ON_GROUND_M) low++;
    _pts.push(x, z);
  }
  return low >= 3;
}
function convexContains(pts: number[], px: number, pz: number, margin: number): boolean {
  const P: [number, number][] = [];
  for (let i = 0; i < pts.length; i += 2) P.push([pts[i], pts[i + 1]]);
  P.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], hi: [number, number][] = [];
  for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  const H = lo.slice(0, -1).concat(hi.slice(0, -1));
  if (H.length < 3) return false;
  for (let i = 0; i < H.length; i++) {
    const a = H[i], b = H[(i + 1) % H.length];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const len = Math.hypot(ex, ez) || 1;
    // distanza con segno dal lato (positiva = dentro, giro antiorario)
    if ((ex * (pz - a[1]) - ez * (px - a[0])) / len < -margin) return false;
  }
  return true;
}
// distanza orizzontale (m) tra baricentro e punto medio dei due piedi
export function comToFeet(fb: FlyBody): number {
  let mx = 0, mz = 0, m = 0;
  for (const s of fb.segs) {
    const bm = s.body.mass(), p = s.body.translation();
    mx += p.x * bm; mz += p.z * bm; m += bm;
  }
  const a = fb.bySeg.Foot_L.body.collider(0).translation(), b = fb.bySeg.Foot_R.body.collider(0).translation();
  return Math.hypot(mx / m - (a.x + b.x) / 2, mz / m - (a.z + b.z) / 2);
}
export interface StandCheck { head: boolean; straight: boolean; feet: boolean; balance: boolean }
export function standCheck(fb: FlyBody, groundY = 0): StandCheck {
  const head = fb.bySeg.Head.body.translation().y - groundY > GETUP_UP_HEAD;
  const straight = bodyTiltDeg(fb) < UPRIGHT_MAX_TILT_DEG;
  _pts.length = 0;
  const fl = footOnGround(fb, 'Foot_L', groundY);
  const fr = footOnGround(fb, 'Foot_R', groundY);
  let mx = 0, mz = 0, m = 0;
  for (const s of fb.segs) {
    const bm = s.body.mass(), p = s.body.translation();
    mx += p.x * bm; mz += p.z * bm; m += bm;
  }
  const balance = convexContains(_pts, mx / m, mz / m, SUPPORT_MARGIN_M);
  return { head, straight, feet: fl && fr, balance };
}
export function isStanding(fb: FlyBody, groundY = 0): boolean {
  const c = standCheck(fb, groundY);
  return c.head && c.straight && c.feet && c.balance;
}
// inclinazione del corpo rispetto a quella che ha il riferimento nello
// stesso istante (radianti, senza contare la direzione in cui guarda): a
// meta' alzata piegarsi in avanti e' giusto, alla fine no
const _qr = new THREE.Quaternion();
const _l = new THREE.Vector3();
function tiltErrorVsRef(fb: FlyBody, s = fb.segs[0]): number {
  s.bone.getWorldQuaternion(_qr).multiply(s.bodyFromBone);
  _l.set(0, 1, 0).applyQuaternion(_qr.invert()); // "su" nel corpo di riferimento
  const r = s.body.rotation();
  _l.applyQuaternion(_qr.set(r.x, r.y, r.z, r.w)); // lo stesso asse nel corpo vero
  return Math.acos(Math.min(1, Math.max(-1, _l.y)));
}
// regola del curriculum, uguale per tutti i cervelli: dopo ogni misura del
// "centro" (partenza da sdraiato, aiuto attuale) se si e' alzato in almeno
// 2 prove su 3 l'aiuto scende del 5%; se non si e' mai alzato risale del 5%
export function nextAssist(level: number, upFrac: number): number {
  if (upFrac >= 0.66) return Math.max(0, Math.round((level - 0.05) * 100) / 100);
  if (upFrac <= 0) return Math.min(1, Math.round((level + 0.05) * 100) / 100);
  return level;
}

// versione del metodo "alzarsi" (aiuto, ricompensa, criterio di "in piedi"):
// pesi salvati con una versione diversa ripartono da "in piedi"
export const GETUP_METHOD = 2;

export interface EpisodeOpts {
  push?: number; // spinte casuali (N*s)
  assist?: number; // aiuto per alzarsi 0..1
  rsi?: boolean; // alzarsi: parte da un punto a caso dell'animazione
}
export interface EpisodeResult { score: number; steps: number; fell: boolean; meanPose: number; headEnd: number; dist: number; up: boolean }

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
  // opts: numero = solo spinte (compatibilita'), oppure EpisodeOpts
  runEpisode(params: Float32Array, task: Task, epSeed: number, seconds = 6, record?: (fb: FlyBody, t: number) => void, opts: number | EpisodeOpts = 0): EpisodeResult {
    const A = this.A;
    const o: EpisodeOpts = typeof opts === 'number' ? { push: opts } : opts;
    const push = o.push ?? 0;
    const assist = task === 'getup' ? o.assist ?? 0 : 0;
    const R = rng(epSeed);
    const world = new A.R.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / (CONTROL_HZ * SUBSTEPS);
    world.createCollider(A.R.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0).setFriction(1.0));
    const clips = { idle: A.clips['Idle_A'], walk: A.clips['Walk'], lay: A.clips['LayToIdle'] };
    const first = task === 'walk' ? clips.walk : task === 'getup' ? clips.lay : clips.idle;
    // partenze a meta' (reference state initialization, DeepMimic): per
    // l'alzarsi il 30% delle prove parte sdraiato, il resto da un punto a
    // caso dell'animazione (seduto, in ginocchio, quasi in piedi...)
    const phase0 = task === 'getup' ? (o.rsi && R() >= 0.3 ? R() * first.duration * 0.95 : 0) : R() * first.duration;
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
      for (let s = 0; s < SUBSTEPS; s++) {
        if (assist > 0) assistUp(fb, assist, world.timestep, ctl.assistHipY, ctl.assistChestY, ctl.assistCentre);
        world.step();
      }
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
      // alzarsi: posa, estremita', altezza della testa e inclinazione del
      // busto uguale a quella del riferimento (niente "in piedi storto")
      // piedi orientati come nell'animazione (in piano quando si e' in piedi,
      // non sui talloni) e, a alzata finita, baricentro sopra i piedi
      if (task === 'getup') {
        const rTilt = Math.exp(-4 * tiltErrorVsRef(fb) ** 2);
        const rFeet = 0.5 * (Math.exp(-6 * tiltErrorVsRef(fb, fb.bySeg.Foot_L) ** 2) + Math.exp(-6 * tiltErrorVsRef(fb, fb.bySeg.Foot_R) ** 2));
        const rBal = ctl.getupDone ? Math.exp(-40 * comToFeet(fb) ** 2) : 0.5;
        r = 0.3 * rPose + 0.1 * rEE + 0.2 * Math.min(1, Math.max(0, head.y) / 1.45) + 0.15 * rTilt + 0.15 * rFeet + 0.1 * rBal;
      }
      total += r; poseSum += rPose; n++;
      record?.(fb, step / CONTROL_HZ);
      if (task !== 'getup' && (head.y < 0.9 || hip.y < 0.45)) { fell = true; break; }
      if (!Number.isFinite(hip.y)) { fell = true; break; }
    }
    const end = fb.segs[0].body.translation();
    const headEnd = fb.bySeg.Head.body.translation().y;
    const up = !fell && isStanding(fb);
    const dist = Math.hypot(end.x - sx, end.z - sz);
    destroyFlyBody(fb);
    world.free();
    return { score: total / steps, steps: n, fell, meanPose: poseSum / Math.max(1, n), headEnd, dist, up };
  }
}
