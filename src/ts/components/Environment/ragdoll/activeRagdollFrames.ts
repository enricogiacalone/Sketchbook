import * as THREE from "three";
import { SkeletonUtils } from "three-stdlib";
import type { RagdollSegment } from "./ragdollConfig";
import { jointAxisAngles, type BindPoseSnapshot } from "./poseFrames";
export * from "./poseFrames";

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
