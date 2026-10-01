// Funzioni PURE (solo three) per le pose di riferimento del ragdoll
// attivo -- separate da activeRagdollFrames.ts perche' il corpo del
// cervello-mosca le usa anche in un Web Worker, dove three-stdlib non va
// importato. activeRagdollFrames.ts le riesporta.
import * as THREE from "three";

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

