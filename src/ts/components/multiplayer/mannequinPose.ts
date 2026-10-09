import * as THREE from 'three';

// "multiplayer: come il manichino, con animazioni sincronizzate e anche la
// ragdoll" -- invece di mandare il NOME della clip (che non basterebbe:
// strato alto delle armi, busto che mira, IK delle mani appese, clip
// deformate del parkour, ragdoll attivo/passivo...) si manda la POSA
// finale dello scheletro: la rotazione locale delle ossa principali, 20
// volte al secondo. Chi riceve la applica allo stesso modello e la
// interpola: vede esattamente cio' che vede il giocatore, ragdoll compreso.
//
// Formato (Int16Array, ~370 byte):
//   [0..2]  posizione locale di `root`   (mm)
//   [3..5]  posizione locale di `pelvis` (mm)
//   poi per ogni osso di POSE_BONES il quaternione locale (x,y,z,w * 32767)
export const POSE_BONES = [
  'root',
  'pelvis',
  'spine_01',
  'spine_02',
  'spine_03',
  'neck_01',
  'head',
  'clavicle_l',
  'upperarm_l',
  'lowerarm_l',
  'hand_l',
  'clavicle_r',
  'upperarm_r',
  'lowerarm_r',
  'hand_r',
  'thigh_l',
  'calf_l',
  'foot_l',
  'ball_l',
  'thigh_r',
  'calf_r',
  'foot_r',
  'ball_r',
  // dita (pugno chiuso / mano aperta / impugnatura)
  'thumb_01_l',
  'thumb_02_l',
  'index_01_l',
  'index_02_l',
  'middle_01_l',
  'middle_02_l',
  'ring_01_l',
  'ring_02_l',
  'pinky_01_l',
  'pinky_02_l',
  'thumb_01_r',
  'thumb_02_r',
  'index_01_r',
  'index_02_r',
  'middle_01_r',
  'middle_02_r',
  'ring_01_r',
  'ring_02_r',
  'pinky_01_r',
  'pinky_02_r',
] as const;

// le falangi finali seguono la seconda (stessa piega): niente banda in piu'
export const FINGER_FOLLOW: Record<string, string> = {
  thumb_03_l: 'thumb_02_l',
  index_03_l: 'index_02_l',
  middle_03_l: 'middle_02_l',
  ring_03_l: 'ring_02_l',
  pinky_03_l: 'pinky_02_l',
  thumb_03_r: 'thumb_02_r',
  index_03_r: 'index_02_r',
  middle_03_r: 'middle_02_r',
  ring_03_r: 'ring_02_r',
  pinky_03_r: 'pinky_02_r',
};

export const POSE_LEN = 6 + POSE_BONES.length * 4;
const QS = 32767;

export function findBones(root: THREE.Object3D): Map<string, THREE.Object3D> {
  const map = new Map<string, THREE.Object3D>();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) map.set(o.name, o);
  });
  return map;
}

export function poseBoneList(root: THREE.Object3D): (THREE.Object3D | null)[] {
  const map = findBones(root);
  return POSE_BONES.map((n) => map.get(n) ?? null);
}

const mm = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v * 1000)));

export function capturePose(bones: (THREE.Object3D | null)[], out: Int16Array): Int16Array {
  const root = bones[0];
  const pelvis = bones[1];
  out[0] = root ? mm(root.position.x) : 0;
  out[1] = root ? mm(root.position.y) : 0;
  out[2] = root ? mm(root.position.z) : 0;
  out[3] = pelvis ? mm(pelvis.position.x) : 0;
  out[4] = pelvis ? mm(pelvis.position.y) : 0;
  out[5] = pelvis ? mm(pelvis.position.z) : 0;
  for (let i = 0; i < bones.length; i++) {
    const b = bones[i];
    const o = 6 + i * 4;
    if (!b) {
      out[o] = out[o + 1] = out[o + 2] = 0;
      out[o + 3] = QS;
      continue;
    }
    const q = b.quaternion;
    // emisfero fisso (w >= 0): due pose vicine hanno numeri vicini
    const s = q.w < 0 ? -1 : 1;
    out[o] = Math.round(q.x * s * QS);
    out[o + 1] = Math.round(q.y * s * QS);
    out[o + 2] = Math.round(q.z * s * QS);
    out[o + 3] = Math.round(q.w * s * QS);
  }
  return out;
}

export interface DecodedPose {
  root: THREE.Vector3;
  pelvis: THREE.Vector3;
  quats: THREE.Quaternion[];
}

export const newDecodedPose = (): DecodedPose => ({
  root: new THREE.Vector3(),
  pelvis: new THREE.Vector3(),
  quats: POSE_BONES.map(() => new THREE.Quaternion()),
});

export function decodePose(buf: Int16Array, out: DecodedPose): boolean {
  if (buf.length < POSE_LEN) return false;
  out.root.set(buf[0] / 1000, buf[1] / 1000, buf[2] / 1000);
  out.pelvis.set(buf[3] / 1000, buf[4] / 1000, buf[5] / 1000);
  for (let i = 0; i < POSE_BONES.length; i++) {
    const o = 6 + i * 4;
    out.quats[i].set(buf[o] / QS, buf[o + 1] / QS, buf[o + 2] / QS, buf[o + 3] / QS).normalize();
  }
  return true;
}

// Quello che arriva dal server (ArrayBuffer, Buffer/Uint8Array o
// Int16Array) -> Int16Array allineato
export function toInt16(data: unknown): Int16Array | null {
  if (!data) return null;
  let u8: Uint8Array;
  if (data instanceof ArrayBuffer) u8 = new Uint8Array(data);
  else if (ArrayBuffer.isView(data)) u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  else return null;
  const copy = u8.slice(0, u8.byteLength - (u8.byteLength % 2));
  return new Int16Array(copy.buffer);
}
