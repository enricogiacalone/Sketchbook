// "Il cervello della mosca comanda il personaggio" -- il CORPO.
//
// Stesso ragdoll attivo del gioco (segmenti, masse, limiti articolari,
// motori nativi Rapier "force based" con rigidita' dall'inerzia del
// sotto-albero -- vedi useRagdollActive.ts e ragdollData.ts), ma
// COMPLETAMENTE DINAMICO: nessun servo che trascina il bacino dove vuole
// l'animazione, nessuna guida "mondo" dei segmenti. Il corpo sta in piedi e
// si sposta solo se i motori delle articolazioni, comandati dalla rete,
// spingono bene contro il pavimento -- cosi' passi e spostamento
// coincidono per costruzione.
//
// Codice PURO (niente React/store): lo usano sia il gioco sia
// l'addestramento in Node (training/fly-brain). Niente enum TypeScript e
// import di soli tipi con `import type` (vedi training/fly-brain/register.mjs).
import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { World, RigidBody, ImpulseJoint } from '@dimforge/rapier3d-compat';
import {
  ACTIVE_RAGDOLL_SEGMENTS,
  ACTIVE_RAGDOLL_MASS_WEIGHT,
  ACTIVE_RAGDOLL_MASS_WEIGHT_FALLBACK,
  ACTIVE_RAGDOLL_TOTAL_MASS_KG,
  ACTIVE_RAGDOLL_JOINT_LIMITS_DEG,
  ACTIVE_RAGDOLL_JOINT_LIMIT_FALLBACK_DEG,
  ACTIVE_RAGDOLL_JOINT_FREQ,
  ACTIVE_RAGDOLL_JOINT_FREQ_DEFAULT,
  ACTIVE_RAGDOLL_PASSIVE_JOINT_FRICTION,
  type RagdollSegment,
} from '../components/Environment/ragdoll/ragdollData';
import { captureBindPose, captureClipPose, jointAxisAngles, type BindPoseSnapshot } from '../components/Environment/ragdoll/poseFrames';

type Rapier = typeof RAPIER_NS;

const RAW_AXIS_ANG = [3, 4, 5] as const;
const LOCKED_LINEAR_AXES_MASK = 1 | 2 | 4;
const MOTOR_MODEL_FORCE_BASED = 1;
const LIMIT_MARGIN = THREE.MathUtils.degToRad(1);
// gruppo Ragdoll (5), collide con tutto tranne Ragdoll e Characters (1):
// pavimento/muri si', i propri pezzi e le capsule "solide" dei
// combattenti no. = interactionGroups([5], tutti tranne [1, 5])
// Versione del corpo: cambia quando cambiano osservazioni o fisica, cosi'
// i pesi addestrati su un corpo diverso vengono ignorati invece di usarli
// su un corpo che non conoscono. 2 = piedi a scatola, muscoli PD, sensori
// di contatto dei piedi.
export const FLY_BODY_VERSION = 2;

export const FLY_COLLISION_GROUPS = ((1 << 5) << 16) | (0xffff & ~((1 << 1) | (1 << 5)));
const LIN_DAMPING = 0.05;
const ANG_DAMPING = 0.3;
const FRICTION = 0.6;
// "la ragdoll e' fatta bene per questo test?" -- misurato (bodycheck.ts):
// il piede del ragdoll del gioco e' una capsula che parte DAVANTI alla
// caviglia (niente tallone: appoggio solo da 6 cm avanti alla caviglia
// fino alla punta), tonda (rotola di lato) e nella posa in piedi scende 6
// cm sotto il pavimento. Andava bene per il burattino del gioco, che non
// deve mai reggersi da solo; per stare in piedi davvero serve un piede
// vero: qui e' una scatola piatta dal tallone alla punta, con la suola
// parallela al pavimento nella posa di bind.
const FOOT_FRICTION = 1.0;
// "Muscoli" (guadagni PD, N*m/rad; smorzamento = 10%). Il ragdoll del gioco
// calcola la rigidita' dall'inerzia di cio' che il giunto MUOVE (va bene
// per un arto in aria), ma in piedi la caviglia deve reggere TUTTO il
// corpo: con quella formula la caviglia aveva ~16 N*m/rad, cioe' per
// reggere 75 kg a 5 cm dal piede avrebbe dovuto piegarsi di 2 radianti --
// il corpo si afflosciava in ~1.3 s qualunque cosa facesse il cervello.
// Qui valori da umanoide simulato (ordine di grandezza di DeepMimic).
export const FLY_KP: Record<string, number> = {
  Torso: 1000, SpineMid: 1000, SpineHigh: 1000, Head: 100,
  ClavicleL: 400, ClavicleR: 400, UpperArm_L: 400, UpperArm_R: 400, ForeArm_L: 300, ForeArm_R: 300,
  Thigh_L: 500, Thigh_R: 500, Shin_L: 500, Shin_R: 500, Foot_L: 400, Foot_R: 400,
};
const FLY_KD_RATIO = 0.1;
const FOOT_HEEL_BEHIND_ANKLE = 0.07; // m
const FOOT_TOE_BEYOND_BALL = 0.05; // m
const FOOT_WIDTH = 0.1; // m
const DAMPING_RATIO = 1.0;

export interface FlySegment {
  seg: RagdollSegment;
  index: number;
  parent: number; // -1 per il bacino
  bone: THREE.Bone;
  parentBone: THREE.Bone | null;
  body: RigidBody;
  joint: ImpulseJoint | null;
  bodyToBone: THREE.Quaternion; // osso(mondo) = corpo(mondo) * bodyToBone
  bodyFromBone: THREE.Quaternion;
  mass: number;
  inertia: number; // del sotto-albero attorno al perno
  freq: number;
  rapierLimits: [number, number][]; // per asse del frame del giunto Rapier
}

export interface FlyBody {
  R: Rapier;
  world: World;
  segs: FlySegment[];
  bySeg: Record<string, FlySegment>;
  F: THREE.Quaternion;
  Finv: THREE.Quaternion;
  bind: BindPoseSnapshot;
  ref: BindPoseSnapshot;
  // numero di angoli articolari comandabili (3 per ogni segmento con genitore)
  nAct: number;
  // numero di osservazioni prodotte da observe()
  nObs: number;
}

const segMass = (name: string) => {
  let sum = 0;
  for (const s of ACTIVE_RAGDOLL_SEGMENTS) sum += ACTIVE_RAGDOLL_MASS_WEIGHT[s.name] ?? ACTIVE_RAGDOLL_MASS_WEIGHT_FALLBACK;
  return ((ACTIVE_RAGDOLL_MASS_WEIGHT[name] ?? ACTIVE_RAGDOLL_MASS_WEIGHT_FALLBACK) / sum) * ACTIVE_RAGDOLL_TOTAL_MASS_KG;
};

const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _a = new THREE.Vector3();

// Crea il corpo nella posa ATTUALE delle ossa (root gia' posizionata nel
// mondo). neutralClip = zero dei giunti (la guardia, come nel gioco).
export function createFlyBody(
  R: Rapier,
  world: World,
  root: THREE.Object3D,
  bones: Record<string, THREE.Bone>,
  neutralClip: THREE.AnimationClip | null
): FlyBody {
  const names = new Set<string>(['thigh_l', 'thigh_r', 'pelvis']);
  for (const s of ACTIVE_RAGDOLL_SEGMENTS) {
    names.add(s.drivingBone);
    names.add(s.toBone);
  }
  const bind = captureBindPose(root, [...names]);
  if (!bind) throw new Error('flyBody: posa di bind non trovata');
  const ref = (neutralClip && captureClipPose(root, neutralClip, 0, [...names], bind)) || bind;
  const refInv = ref.refQuat.clone().invert();
  const yAxis = new THREE.Vector3(0, 1, 0);
  root.updateMatrixWorld(true);

  const segs: FlySegment[] = [];
  const bySeg: Record<string, FlySegment> = {};
  for (const seg of ACTIVE_RAGDOLL_SEGMENTS) {
    const bone = bones[seg.drivingBone];
    const bFrom = bind.pos[seg.drivingBone];
    const bTo = bind.pos[seg.toBone];
    const bq = bind.quat[seg.drivingBone];
    const nq = ref.quat[seg.drivingBone];
    if (!bone || !bFrom || !bTo || !bq || !nq) throw new Error('flyBody: osso mancante ' + seg.drivingBone);
    const bodyToBone = refInv.clone().multiply(nq);
    const bodyFromBone = bodyToBone.clone().invert();
    bone.getWorldPosition(_v1);
    bone.getWorldQuaternion(_q1);
    const bodyQuat = _q1.clone().multiply(bodyFromBone);
    const parent = seg.parent ? bySeg[seg.parent] : undefined;
    if (parent) {
      const pr = parent.body.rotation();
      if (pr.x * bodyQuat.x + pr.y * bodyQuat.y + pr.z * bodyQuat.z + pr.w * bodyQuat.w < 0) {
        bodyQuat.set(-bodyQuat.x, -bodyQuat.y, -bodyQuat.z, -bodyQuat.w);
      }
    }
    const dirWorld = bTo.clone().sub(bFrom);
    const rawLen = dirWorld.length() || 0.05;
    const dirBody = dirWorld.normalize().applyQuaternion(bq.clone().invert()).applyQuaternion(bodyToBone);
    const length = Math.max(0.05, rawLen * (seg.lengthScale ?? 0.92));
    const halfHeight = Math.max(0.01, length / 2 - seg.radius);
    const capsuleRot = new THREE.Quaternion().setFromUnitVectors(yAxis, dirBody);
    const capsuleOffset = dirBody.clone().multiplyScalar(length / 2);
    const mass = segMass(seg.name);
    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(_v1.x, _v1.y, _v1.z)
        .setRotation({ x: bodyQuat.x, y: bodyQuat.y, z: bodyQuat.z, w: bodyQuat.w })
        .setLinearDamping(LIN_DAMPING)
        .setAngularDamping(ANG_DAMPING)
    );
    const isFoot = seg.drivingBone.startsWith('foot_');
    if (isFoot) {
      // scatola in posa di bind (mondo): dal tallone alla punta, suola a terra
      const side = seg.drivingBone.slice(-1);
      const ankle = bind.pos[seg.drivingBone];
      const ball = bind.pos['ball_' + side] ?? bTo;
      const fwd = ball.clone().sub(ankle);
      fwd.y = 0;
      const fwdLen = fwd.length() || 0.12;
      fwd.normalize();
      const soleY = Math.min(0, ball.y - 0.02);
      const heightM = Math.max(0.04, ankle.y - soleY);
      const lenM = FOOT_HEEL_BEHIND_ANKLE + fwdLen + FOOT_TOE_BEYOND_BALL;
      const centerW = ankle.clone().addScaledVector(fwd, -FOOT_HEEL_BEHIND_ANKLE + lenM / 2);
      centerW.y = soleY + heightM / 2;
      const boxQuatW = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(yAxis, fwd).normalize(), yAxis, fwd)
      );
      // mondo(bind) -> frame dell'osso -> frame del corpo
      const bqInv = bq.clone().invert();
      const cBody = centerW.sub(ankle).applyQuaternion(bqInv).applyQuaternion(bodyToBone);
      const qBody = bodyToBone.clone().multiply(bqInv).multiply(boxQuatW);
      world.createCollider(
        R.ColliderDesc.cuboid(FOOT_WIDTH / 2, heightM / 2, lenM / 2)
          .setTranslation(cBody.x, cBody.y, cBody.z)
          .setRotation({ x: qBody.x, y: qBody.y, z: qBody.z, w: qBody.w })
          .setCollisionGroups(FLY_COLLISION_GROUPS)
          .setFriction(FOOT_FRICTION)
          .setMass(mass),
        body
      );
    } else {
      world.createCollider(
        R.ColliderDesc.capsule(halfHeight, seg.radius)
          .setTranslation(capsuleOffset.x, capsuleOffset.y, capsuleOffset.z)
          .setRotation({ x: capsuleRot.x, y: capsuleRot.y, z: capsuleRot.z, w: capsuleRot.w })
          .setCollisionGroups(FLY_COLLISION_GROUPS)
          .setFriction(FRICTION)
          .setMass(mass),
        body
      );
    }
    const fs: FlySegment = {
      seg,
      index: segs.length,
      parent: parent ? parent.index : -1,
      bone,
      parentBone: parent ? parent.bone : null,
      body,
      joint: null,
      bodyToBone,
      bodyFromBone,
      mass,
      inertia: 0,
      freq: ACTIVE_RAGDOLL_JOINT_FREQ[seg.name] ?? ACTIVE_RAGDOLL_JOINT_FREQ_DEFAULT,
      rapierLimits: [],
    };
    segs.push(fs);
    bySeg[seg.name] = fs;
  }

  // inerzia del sotto-albero (come useRagdollActive)
  const centers = segs.map((s) => {
    const from = ref.pos[s.seg.drivingBone];
    const to = ref.pos[s.seg.toBone];
    const len = from.distanceTo(to) * (s.seg.lengthScale ?? 0.92);
    return { c: to.clone().sub(from).normalize().multiplyScalar(len / 2).add(from), own: s.mass * ((len * len) / 12 + s.seg.radius * s.seg.radius * 0.5) };
  });
  const isDesc = (i: number, anc: number) => {
    for (let c = i; c >= 0; c = segs[c].parent) if (c === anc) return true;
    return false;
  };
  for (const s of segs) {
    const pivot = ref.pos[s.seg.drivingBone];
    let I = 0;
    for (const o of segs) if (isDesc(o.index, s.index)) I += o.mass * centers[o.index].c.distanceToSquared(pivot) + centers[o.index].own;
    s.inertia = Math.max(1e-3, I);
  }

  // giunti generici: 3 rotazioni libere con limiti + motori
  let F = new THREE.Quaternion();
  let firstJoint: ImpulseJoint | null = null;
  for (const s of segs) {
    if (s.parent < 0) continue;
    const p = segs[s.parent];
    const anchor1 = ref.pos[s.seg.drivingBone].clone().sub(ref.pos[p.seg.drivingBone]).applyQuaternion(refInv);
    const data = R.JointData.generic({ x: anchor1.x, y: anchor1.y, z: anchor1.z }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, LOCKED_LINEAR_AXES_MASK as any);
    s.joint = world.createImpulseJoint(data, p.body, s.body, true);
    if (!firstJoint) firstJoint = s.joint;
  }
  if (firstJoint) {
    const raw = (firstJoint as any).rawSet;
    const rr = raw.jointFrameX1(firstJoint.handle);
    F = new THREE.Quaternion(rr.x, rr.y, rr.z, rr.w).normalize();
    rr.free?.();
  }
  const el = new THREE.Matrix4().makeRotationFromQuaternion(F).elements;
  const axes = [0, 1, 2].map((k) => {
    const col = [el[4 * k], el[4 * k + 1], el[4 * k + 2]];
    let j = 0;
    for (let i = 1; i < 3; i++) if (Math.abs(col[i]) > Math.abs(col[j])) j = i;
    return { j, sign: col[j] >= 0 ? 1 : -1 };
  });
  const r = THREE.MathUtils.degToRad;
  const fb = ACTIVE_RAGDOLL_JOINT_LIMIT_FALLBACK_DEG;
  for (const s of segs) {
    if (!s.joint) continue;
    const d = ACTIVE_RAGDOLL_JOINT_LIMITS_DEG[s.seg.name];
    const ax = (a?: [number, number]): [number, number] => (a ? [r(a[0]), r(a[1])] : [r(-fb), r(fb)]);
    const my = [ax(d?.x), ax(d?.y), ax(d?.z)];
    s.rapierLimits = axes.map(({ j, sign }) => (sign > 0 ? [my[j][0], my[j][1]] : [-my[j][1], -my[j][0]]) as [number, number]);
    const raw = (s.joint as any).rawSet;
    for (let k = 0; k < 3; k++) {
      raw.jointSetLimits(s.joint.handle, RAW_AXIS_ANG[k], s.rapierLimits[k][0], s.rapierLimits[k][1]);
      raw.jointConfigureMotorModel(s.joint.handle, RAW_AXIS_ANG[k], MOTOR_MODEL_FORCE_BASED);
    }
    raw.jointSetContactsEnabled(s.joint.handle, false);
  }
  const nAct = segs.filter((s) => s.parent >= 0).length * 3;
  const body: FlyBody = { R, world, segs, bySeg, F, Finv: F.clone().invert(), bind, ref, nAct, nObs: 0 };
  body.nObs = observe(body, null).length;
  return body;
}

// Dimensioni di osservazioni/azioni senza costruire un corpo (per preparare
// la rete nel thread principale del laboratorio)
export function flyDims(): { nObs: number; nAct: number } {
  const n = ACTIVE_RAGDOLL_SEGMENTS.length;
  const withParent = ACTIVE_RAGDOLL_SEGMENTS.filter((s) => s.parent).length;
  return { nObs: n * 15 + 1 + FOOT_SENSORS, nAct: withParent * 3 };
}

// Angoli articolari (frame dei giunti Rapier, rad) della posa ATTUALE delle
// ossa -- cioe' dell'animazione di riferimento, se le ossa la stanno
// suonando. Stessa matematica di driveActiveRagdoll nel gioco.
export function jointAnglesFromBones(fb: FlyBody, out: Float32Array): Float32Array {
  let k = 0;
  for (const s of fb.segs) {
    if (s.parent < 0) continue;
    const p = fb.segs[s.parent];
    p.bone.getWorldQuaternion(_q1).multiply(p.bodyFromBone);
    s.bone.getWorldQuaternion(_q2).multiply(s.bodyFromBone);
    _q1.invert().multiply(_q2);
    _q1.premultiply(fb.Finv).multiply(fb.F);
    jointAxisAngles(_q1, _a);
    out[k++] = _a.x;
    out[k++] = _a.y;
    out[k++] = _a.z;
  }
  return out;
}

// Angoli articolari ATTUALI del corpo fisico (stesso frame)
export function jointAnglesFromBodies(fb: FlyBody, out: Float32Array): Float32Array {
  let k = 0;
  for (const s of fb.segs) {
    if (s.parent < 0) continue;
    const pr = fb.segs[s.parent].body.rotation();
    const cr = s.body.rotation();
    _q1.set(pr.x, pr.y, pr.z, pr.w).invert().multiply(_q2.set(cr.x, cr.y, cr.z, cr.w));
    _q1.premultiply(fb.Finv).multiply(fb.F);
    jointAxisAngles(_q1, _a);
    out[k++] = _a.x;
    out[k++] = _a.y;
    out[k++] = _a.z;
  }
  return out;
}

// Manda gli angoli bersaglio ai motori (clamp ai limiti). stiffness = 1
// come il gioco; vel = velocita' articolare bersaglio (feed-forward) o null.
export function driveJoints(fb: FlyBody, target: Float32Array, vel: Float32Array | null, stiffness = 1): void {
  let k = 0;
  for (const s of fb.segs) {
    if (s.parent < 0 || !s.joint) continue;
    const raw = (s.joint as any).rawSet;
    const kp = (FLY_KP[s.seg.name] ?? 300) * Math.max(0.01, stiffness);
    // Rapier misura l'errore come sin(angolo/2): fattore 2 sulla rigidita'
    const kk = 2 * kp;
    const c = FLY_KD_RATIO * kp;
    for (let a = 0; a < 3; a++, k++) {
      const l = s.rapierLimits[a];
      const t = Math.min(l[1] - LIMIT_MARGIN, Math.max(l[0] + LIMIT_MARGIN, target[k]));
      raw.jointConfigureMotor(s.joint.handle, RAW_AXIS_ANG[a], t, vel ? vel[k] : 0, kk, c);
    }
  }
}

// Mette il corpo nella posa ATTUALE delle ossa, con le velocita' date da
// una seconda posa a dt secondi di distanza (per partire "in corsa").
export function setBodyFromBones(fb: FlyBody, prevWorld: { p: THREE.Vector3; q: THREE.Quaternion }[] | null, dt: number): void {
  for (const s of fb.segs) {
    s.bone.getWorldPosition(_v1);
    s.bone.getWorldQuaternion(_q1).multiply(s.bodyFromBone);
    if (s.parent >= 0) {
      const pr = fb.segs[s.parent].body.rotation();
      if (pr.x * _q1.x + pr.y * _q1.y + pr.z * _q1.z + pr.w * _q1.w < 0) _q1.set(-_q1.x, -_q1.y, -_q1.z, -_q1.w);
    }
    s.body.setTranslation({ x: _v1.x, y: _v1.y, z: _v1.z }, true);
    s.body.setRotation({ x: _q1.x, y: _q1.y, z: _q1.z, w: _q1.w }, true);
    if (prevWorld && dt > 0) {
      const pv = prevWorld[s.index];
      _v2.copy(_v1).sub(pv.p).divideScalar(dt);
      s.body.setLinvel({ x: _v2.x, y: _v2.y, z: _v2.z }, true);
      _q2.copy(_q1).multiply(pv.q.clone().invert());
      if (_q2.w < 0) _q2.set(-_q2.x, -_q2.y, -_q2.z, -_q2.w);
      const sh = Math.sqrt(_q2.x * _q2.x + _q2.y * _q2.y + _q2.z * _q2.z);
      const ang = 2 * Math.atan2(sh, _q2.w);
      if (sh > 1e-8) s.body.setAngvel({ x: (_q2.x / sh) * ang / dt, y: (_q2.y / sh) * ang / dt, z: (_q2.z / sh) * ang / dt }, true);
      else s.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    } else {
      s.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      s.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }
}

// Punto piu' basso del corpo (y mondo): angoli delle scatole dei piedi e
// fondo delle capsule. Serve a poggiare il corpo sul pavimento al via
// senza compenetrazioni (che lo farebbero schizzare in su).
export function lowestPoint(fb: FlyBody): number {
  // i collider seguono i corpi solo al passo successivo: aggiornali ora
  fb.world.propagateModifiedBodyPositionsToColliders();
  let minY = Infinity;
  for (const s of fb.segs) {
    const c = s.body.collider(0);
    const t = c.translation();
    const r = c.rotation();
    _q1.set(r.x, r.y, r.z, r.w);
    if (c.shape.type === fb.R.ShapeType.Cuboid) {
      const he = (c.shape as any).halfExtents;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        _v1.set(sx * he.x, sy * he.y, sz * he.z).applyQuaternion(_q1);
        minY = Math.min(minY, t.y + _v1.y);
      }
    } else {
      const hh = c.halfHeight();
      _v1.set(0, hh, 0).applyQuaternion(_q1);
      minY = Math.min(minY, t.y - Math.abs(_v1.y) - c.radius());
    }
  }
  return minY;
}

// Sposta tutto il corpo in verticale di dy
export function liftBody(fb: FlyBody, dy: number): void {
  for (const s of fb.segs) {
    const t = s.body.translation();
    s.body.setTranslation({ x: t.x, y: t.y + dy, z: t.z }, true);
  }
}

// Posa mondo dei corpi come l'avrebbero le ossa (per setBodyFromBones)
export function snapshotBonesAsBodies(fb: FlyBody): { p: THREE.Vector3; q: THREE.Quaternion }[] {
  return fb.segs.map((s) => ({
    p: s.bone.getWorldPosition(new THREE.Vector3()),
    q: s.bone.getWorldQuaternion(new THREE.Quaternion()).multiply(s.bodyFromBone),
  }));
}

// Direzione "avanti" del bacino (orizzontale) -- frame in cui si esprimono
// le osservazioni, cosi' la rete non dipende da dove guarda nel mondo.
const _heading = new THREE.Quaternion();
const _headingInv = new THREE.Quaternion();
export function headingOf(fb: FlyBody, out: THREE.Quaternion): THREE.Quaternion {
  const r = fb.segs[0].body.rotation();
  _q1.set(r.x, r.y, r.z, r.w);
  // asse Z del frame del personaggio = avanti (vedi captureBindPose)
  _v1.set(0, 0, 1).applyQuaternion(_q1);
  _v1.y = 0;
  if (_v1.lengthSq() < 1e-8) _v1.set(0, 0, 1);
  _v1.normalize();
  return out.setFromAxisAngle(_v2.set(0, 1, 0), Math.atan2(_v1.x, _v1.z));
}

// Sensori dei piedi: per ogni piede (sinistro, destro) 1 se tocca qualcosa
// che non e' il proprio corpo, e la forza d'appoggio in "pesi corporei"
// (1 = regge tutto il corpo). Nella mosca vera molti neuroni ascendenti
// portano proprio carico e contatto delle zampe.
const FOOT_SENSORS = 4;
const _others: any[] = [];
function footSensors(fb: FlyBody, o: Float32Array, k: number): number {
  const weightN = ACTIVE_RAGDOLL_TOTAL_MASS_KG * 9.81;
  const dt = (fb.world as any).timestep || 1 / 120;
  for (const name of ['Foot_L', 'Foot_R']) {
    const s = fb.bySeg[name];
    const col = s.body.collider(0);
    _others.length = 0;
    // prima si raccolgono i contatti, poi si leggono (niente chiamate al
    // mondo annidate dentro una callback del mondo: Rapier va in errore)
    fb.world.contactPairsWith(col, (other: any) => {
      if (other.parent()?.handle !== s.body.handle) _others.push(other);
    });
    let impulse = 0;
    let touching = 0;
    for (const other of _others) {
      fb.world.contactPair(col, other, (m: any) => {
        const n = m.numContacts();
        if (n > 0) touching = 1;
        for (let i = 0; i < n; i++) impulse += m.contactImpulse(i);
      });
    }
    o[k++] = touching;
    o[k++] = Math.min(3, impulse / dt / weightN);
  }
  return k;
}

// Pressione sotto la pianta divisa tra TALLONE (meta' posteriore della
// suola) e PUNTA (meta' anteriore), in pesi corporei, per piede: [tallone
// sx, punta sx, tallone dx, punta dx]. E' il senso con cui noi sentiamo di
// essere "sui talloni" e riportiamo il peso in avanti (e nella mosca vera
// molti neuroni ascendenti portano il carico delle zampe).
export function footPressure(fb: FlyBody, o: Float32Array, k: number): number {
  const weightN = ACTIVE_RAGDOLL_TOTAL_MASS_KG * 9.81;
  const dt = (fb.world as any).timestep || 1 / 120;
  for (const name of ['Foot_L', 'Foot_R']) {
    const s = fb.bySeg[name];
    const col = s.body.collider(0);
    _others.length = 0;
    fb.world.contactPairsWith(col, (other: any) => {
      if (other.parent()?.handle !== s.body.handle) _others.push(other);
    });
    let heel = 0, toe = 0;
    for (const other of _others) {
      fb.world.contactPair(col, other, (m: any, flipped: boolean) => {
        const n = m.numContacts();
        for (let i = 0; i < n; i++) {
          // punto nel frame della scatola del piede: +z = verso la punta
          const lp = flipped ? m.localContactPoint2(i) : m.localContactPoint1(i);
          if (!lp) continue;
          if (lp.z < 0) heel += m.contactImpulse(i);
          else toe += m.contactImpulse(i);
        }
      });
    }
    o[k++] = Math.min(3, heel / dt / weightN);
    o[k++] = Math.min(3, toe / dt / weightN);
  }
  return k;
}

// Osservazioni ("propriocezione" che arriva ai neuroni ascendenti): per
// ogni corpo, posizione relativa al bacino, orientamento (2 assi = 6
// numeri), velocita' lineare e angolare, tutto nel frame di direzione del
// bacino; piu' l'altezza del bacino. out=null -> alloca (per contare).
export function observe(fb: FlyBody, out: Float32Array | null): Float32Array {
  const n = fb.segs.length * 15 + 1 + FOOT_SENSORS;
  const o = out ?? new Float32Array(n);
  headingOf(fb, _heading);
  _headingInv.copy(_heading).invert();
  const h = fb.segs[0].body.translation();
  let k = 0;
  o[k++] = h.y;
  for (const s of fb.segs) {
    const t = s.body.translation();
    _v1.set(t.x - h.x, t.y - h.y, t.z - h.z).applyQuaternion(_headingInv);
    o[k++] = _v1.x; o[k++] = _v1.y; o[k++] = _v1.z;
    const r = s.body.rotation();
    _q1.set(r.x, r.y, r.z, r.w).premultiply(_headingInv);
    _v1.set(1, 0, 0).applyQuaternion(_q1);
    o[k++] = _v1.x; o[k++] = _v1.y; o[k++] = _v1.z;
    _v1.set(0, 1, 0).applyQuaternion(_q1);
    o[k++] = _v1.x; o[k++] = _v1.y; o[k++] = _v1.z;
    const lv = s.body.linvel();
    _v1.set(lv.x, lv.y, lv.z).applyQuaternion(_headingInv);
    o[k++] = _v1.x * 0.3; o[k++] = _v1.y * 0.3; o[k++] = _v1.z * 0.3;
    const av = s.body.angvel();
    _v1.set(av.x, av.y, av.z).applyQuaternion(_headingInv);
    o[k++] = _v1.x * 0.1; o[k++] = _v1.y * 0.1; o[k++] = _v1.z * 0.1;
  }
  footSensors(fb, o, k);
  return o;
}

// Riporta la posa fisica sulle ossa (per disegnare il personaggio)
// targetBones: scheletro da scrivere (per nome), se diverso da quello di
// riferimento su cui e' stato costruito il corpo (nel gioco: il clone visibile)
export function writeBodiesToBones(fb: FlyBody, targetBones?: Record<string, THREE.Bone>): void {
  for (const s of fb.segs) {
    const bone = targetBones?.[s.seg.drivingBone] ?? s.bone;
    const parent = bone.parent;
    if (!parent) continue;
    parent.updateWorldMatrix(true, false);
    const r = s.body.rotation();
    _q1.set(r.x, r.y, r.z, r.w).multiply(s.bodyToBone);
    parent.getWorldQuaternion(_q2);
    bone.quaternion.copy(_q2.invert().multiply(_q1));
    if (s.parent < 0) {
      const t = s.body.translation();
      _v1.set(t.x, t.y, t.z);
      parent.worldToLocal(_v1);
      bone.position.copy(_v1);
    }
    bone.updateWorldMatrix(false, false);
  }
}

export function destroyFlyBody(fb: FlyBody): void {
  for (const s of fb.segs) if (s.joint) fb.world.removeImpulseJoint(s.joint, true);
  for (const s of fb.segs) fb.world.removeRigidBody(s.body);
}
