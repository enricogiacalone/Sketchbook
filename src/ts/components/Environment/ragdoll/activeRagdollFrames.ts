import * as THREE from "three";
import { SkeletonUtils } from "three-stdlib";
import type { RagdollSegment } from "./ragdollConfig";

// ---------------------------------------------------------------------------
// Frame di riferimento del ragdoll attivo.
//
// "metti il personaggio a T e sistema queste ossa della ragdoll attiva" --
// causa radice (misurata dal vivo sullo scheletro soldier-citizen.glb): ogni
// corpo Rapier veniva creato con la STESSA rotazione mondo del suo osso, e i
// giunti (generic/revolute) usavano lo stesso asse locale per genitore e
// figlio. Lo "zero" di un giunto Rapier e' il momento in cui i due frame
// coincidono -- cioe' quando l'osso figlio ha la STESSA orientazione
// dell'osso genitore, che nello scheletro stile UE non e' mai la posa
// reale: coscia vs bacino ~150 gradi, avambraccio vs braccio ~110 gradi,
// braccio vs clavicola ~120 gradi. I limiti nativi (+-110 ecc.) e le
// cerniere di gomito/ginocchio tiravano quindi OGNI frame i corpi verso
// una posa assurda, mentre i motori PD li tiravano verso l'animazione --
// il "grumo" che non corrisponde al personaggio e non si ferma mai.
//
// Soluzione (quella classica dei ragdoll attivi): tutti i corpi vengono
// costruiti in modo che nella posa di BIND (la T-pose del modello) abbiano
// TUTTI la stessa orientazione -- il frame del personaggio (X = sinistra,
// Y = su, Z = avanti). Ogni corpo ricorda un offset costante
// bodyToBone (osso = corpo * bodyToBone). Cosi':
// - lo zero di ogni giunto e' esattamente la T-pose;
// - gli assi dei giunti hanno un significato anatomico fisso e uguale per
//   tutti (X = flessione avanti/indietro, Y = torsione/rotazione
//   orizzontale, Z = inclinazione laterale / alzare-abbassare le braccia);
// - i limiti per asse in ragdollConfig.ts si leggono come gradi rispetto
//   alla T-pose, e si possono MISURARE direttamente sulle animazioni
//   (measureClipJointRanges qui sotto).
// ---------------------------------------------------------------------------

export interface BindPoseSnapshot {
  // Orientazione mondo del frame del personaggio nella posa di bind
  // (X = sinistra, Y = su, Z = avanti).
  refQuat: THREE.Quaternion;
  pos: Record<string, THREE.Vector3>;
  quat: Record<string, THREE.Quaternion>;
}

export function findSkeleton(root: THREE.Object3D): THREE.Skeleton | null {
  let skeleton: THREE.Skeleton | null = null;
  root.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh;
    if (!skeleton && mesh.isSkinnedMesh && mesh.skeleton) skeleton = mesh.skeleton;
  });
  return skeleton;
}

// Posa di bind letta SENZA disturbare l'animazione: salva le trasformazioni
// locali correnti, applica skeleton.pose() (la stessa T-pose del checkbox
// "T-pose"), legge le trasformazioni mondo, e ripristina tutto.
export function captureBindPose(root: THREE.Object3D, boneNames: string[]): BindPoseSnapshot | null {
  const skeleton = findSkeleton(root);
  if (!skeleton) return null;
  const saved = skeleton.bones.map((b) => ({
    p: b.position.clone(),
    q: b.quaternion.clone(),
    s: b.scale.clone(),
  }));
  skeleton.pose();
  root.updateMatrixWorld(true);

  const byName: Record<string, THREE.Bone> = {};
  for (const b of skeleton.bones) byName[b.name] = b;
  const pos: Record<string, THREE.Vector3> = {};
  const quat: Record<string, THREE.Quaternion> = {};
  for (const name of boneNames) {
    const b = byName[name];
    if (!b) continue;
    pos[name] = b.getWorldPosition(new THREE.Vector3());
    quat[name] = b.getWorldQuaternion(new THREE.Quaternion());
  }

  skeleton.bones.forEach((b, i) => {
    b.position.copy(saved[i].p);
    b.quaternion.copy(saved[i].q);
    b.scale.copy(saved[i].s);
  });
  root.updateMatrixWorld(true);

  if (!pos.thigh_l || !pos.thigh_r) return null;
  const left = pos.thigh_l.clone().sub(pos.thigh_r);
  left.y = 0;
  if (left.lengthSq() < 1e-8) left.set(1, 0, 0);
  left.normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const fwd = new THREE.Vector3().crossVectors(left, up).normalize();
  const basis = new THREE.Matrix4().makeBasis(left, up, fwd);
  const refQuat = new THREE.Quaternion().setFromRotationMatrix(basis);
  return { refQuat, pos, quat };
}

// "Posa neutra" dei giunti presa da una clip (tipicamente l'idle di
// combattimento) invece che dalla T-pose. Motivo, misurato dal vivo: con
// lo zero dei giunti in T-pose, un gancio (Melee_Hook) chiede alla
// spalla una rotazione di quasi 180 gradi rispetto allo zero -- proprio
// dove la misura per componenti del quaternione (quella di Rapier) ha la
// sua singolarita': il braccio "esplodeva" (errore 177 gradi, 110 cm).
// Centrando lo zero sulla guardia, tutte le mosse di combattimento restano
// ben lontane da 180. Il frame del personaggio viene "portato" dal bacino:
// ref_neutra = bacino_neutro * bacino_bind^-1 * ref_bind.
export function captureClipPose(
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
  time: number,
  boneNames: string[],
  bind: BindPoseSnapshot
): BindPoseSnapshot | null {
  const skeleton = findSkeleton(root);
  if (!skeleton) return null;
  const saved = skeleton.bones.map((b) => ({ p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() }));
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();
  mixer.setTime(Math.max(0, Math.min(time, clip.duration * 0.999)));
  root.updateMatrixWorld(true);
  const byName: Record<string, THREE.Bone> = {};
  for (const b of skeleton.bones) byName[b.name] = b;
  const pos: Record<string, THREE.Vector3> = {};
  const quat: Record<string, THREE.Quaternion> = {};
  for (const name of boneNames) {
    const b = byName[name];
    if (!b) continue;
    pos[name] = b.getWorldPosition(new THREE.Vector3());
    quat[name] = b.getWorldQuaternion(new THREE.Quaternion());
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  skeleton.bones.forEach((b, i) => {
    b.position.copy(saved[i].p);
    b.quaternion.copy(saved[i].q);
    b.scale.copy(saved[i].s);
  });
  root.updateMatrixWorld(true);
  if (!quat.pelvis || !bind.quat.pelvis) return null;
  const refQuat = quat.pelvis.clone().multiply(bind.quat.pelvis.clone().invert()).multiply(bind.refQuat);
  return { refQuat, pos, quat };
}

// Angoli per asse (radianti) di una rotazione relativa genitore->figlio,
// nella STESSA convenzione usata dal solver di Rapier per limiti e motori
// angolari di un giunto generico: per l'asse k, sin(angolo/2) = componente
// k della parte vettoriale del quaternione (emisfero w >= 0).
export function jointAxisAngles(q: THREE.Quaternion, out: THREE.Vector3): THREE.Vector3 {
  const s = q.w < 0 ? -1 : 1;
  const c = (v: number) => Math.max(-1, Math.min(1, v * s));
  out.set(2 * Math.asin(c(q.x)), 2 * Math.asin(c(q.y)), 2 * Math.asin(c(q.z)));
  return out;
}

export type AxisRange = [number, number];
export interface JointRange {
  x: AxisRange;
  y: AxisRange;
  z: AxisRange;
}

// "i test come si deve" -- misura, per ogni giunto del ragdoll attivo, il
// range di angoli (gradi, per asse, rispetto alla T-pose) che le clip di
// animazione chiedono davvero. I limiti del giunto DEVONO contenere questi
// range (piu' un margine), altrimenti motore e limite si combattono per
// sempre. Lavora su un CLONE del modello con un mixer suo, cosi' non tocca
// il personaggio in scena.
export function measureClipJointRanges(
  modelRoot: THREE.Object3D,
  clips: THREE.AnimationClip[],
  segments: RagdollSegment[],
  bind: BindPoseSnapshot
): { all: Record<string, JointRange>; perClip: Record<string, Record<string, JointRange>> } {
  const clone = SkeletonUtils.clone(modelRoot) as THREE.Object3D;
  const bones: Record<string, THREE.Bone> = {};
  clone.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone;
  });
  const mixer = new THREE.AnimationMixer(clone);
  const bodyFromBone: Record<string, THREE.Quaternion> = {};
  for (const seg of segments) {
    const bq = bind.quat[seg.drivingBone];
    if (!bq) continue;
    // T = A * bind^-1 * ref  (orientazione del corpo dato l'osso animato A)
    bodyFromBone[seg.name] = bq.clone().invert().multiply(bind.refQuat);
  }
  const deg = THREE.MathUtils.radToDeg;
  const all: Record<string, JointRange> = {};
  const perClip: Record<string, Record<string, JointRange>> = {};
  const tp = new THREE.Quaternion();
  const tc = new THREE.Quaternion();
  const a = new THREE.Vector3();
  const grow = (table: Record<string, JointRange>, name: string, v: THREE.Vector3) => {
    const r = table[name] ?? (table[name] = { x: [Infinity, -Infinity], y: [Infinity, -Infinity], z: [Infinity, -Infinity] });
    const vals = [deg(v.x), deg(v.y), deg(v.z)];
    (["x", "y", "z"] as const).forEach((k, i) => {
      r[k][0] = Math.min(r[k][0], vals[i]);
      r[k][1] = Math.max(r[k][1], vals[i]);
    });
  };

  for (const clip of clips) {
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
    const table: Record<string, JointRange> = {};
    const samples = Math.max(8, Math.ceil(clip.duration * 30));
    for (let i = 0; i <= samples; i++) {
      mixer.setTime((clip.duration * i) / samples * 0.999);
      clone.updateMatrixWorld(true);
      for (const seg of segments) {
        if (!seg.parent) continue;
        const parentSeg = segments.find((s) => s.name === seg.parent);
        if (!parentSeg) continue;
        const bp = bones[parentSeg.drivingBone];
        const bc = bones[seg.drivingBone];
        if (!bp || !bc || !bodyFromBone[seg.name] || !bodyFromBone[parentSeg.name]) continue;
        bp.getWorldQuaternion(tp).multiply(bodyFromBone[parentSeg.name]);
        bc.getWorldQuaternion(tc).multiply(bodyFromBone[seg.name]);
        const rel = tp.invert().multiply(tc);
        jointAxisAngles(rel, a);
        grow(table, seg.name, a);
        grow(all, seg.name, a);
      }
    }
    perClip[clip.name] = table;
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(clone);
  return { all, perClip };
}
