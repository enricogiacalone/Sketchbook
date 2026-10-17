// Calibrazione dei tre scheletri: il manichino (rig + animazioni di base), SOMA
// (Kimodo, 30 giunti) e la ragdoll (scripts/ragdoll-fit.mjs, a parte).
//
//   node scripts/skeleton-audit.mjs [--json out.json]
//
// 1) PROPORZIONI: lunghezza di ogni osso del manichino contro quello di SOMA
//    scalato (K = altezza anche manichino / altezza anche SOMA), e misure
//    d'insieme (gamba, braccio, busto, larghezza spalle e fianchi).
// 2) RIPOSO: l'angolo tra la direzione di ogni osso a riposo e quella del
//    giunto SOMA corrispondente (quanto sono "storte" le pose a T).
// 3) FEDELTA' DEL RETARGET: per ogni clip Kimodo si calcola la posa SOMA (FK
//    dai dati grezzi in assets-src/kimodo/) e la posa del manichino con la clip
//    adattata (public/kimodo-animations.glb); si confrontano le distanze tra
//    tutte le coppie di giunti (non dipendono da dove sta il corpo): per ogni
//    giunto l'errore medio, in cm, e per le mani e i piedi.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import fs from 'node:fs';
import path from 'node:path';
import { SOMA_NAMES, SOMA_PARENTS, SOMA_OFFSETS, MAP } from './lib/skeletons.mjs';

globalThis.self = globalThis;
const load = (p) =>
  new Promise((res, rej) => {
    const b = fs.readFileSync(p);
    new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej);
  });
const S = Object.fromEntries(SOMA_NAMES.map((n, i) => [n, i]));
const model = await load('public/soldier-citizen.glb');
const root = model.scene;
const bone = (n) => root.getObjectByName(n);
root.updateMatrixWorld(true);
const wp = (n) => bone(n).getWorldPosition(new THREE.Vector3());

// SOMA a riposo
const somaRest = [];
for (let j = 0; j < 30; j++) {
  const off = new THREE.Vector3().fromArray(SOMA_OFFSETS[j]);
  somaRest.push(SOMA_PARENTS[j] < 0 ? off : somaRest[SOMA_PARENTS[j]].clone().add(off));
}
const ourHipMid = wp('thigh_l').add(wp('thigh_r')).multiplyScalar(0.5);
const somaHipMid = somaRest[S.LeftLeg].clone().add(somaRest[S.RightLeg]).multiplyScalar(0.5);
const K = ourHipMid.y / somaHipMid.y;
console.log(`K (manichino / SOMA) = ${K.toFixed(4)}  (anche: ${ourHipMid.y.toFixed(3)} m contro ${somaHipMid.y.toFixed(3)} m)`);

// ---------------------------------------------------------------- 1) proporzioni
const rows = [];
for (const [name, [soma, tChild, sChild]] of Object.entries(MAP)) {
  if (!tChild || !sChild) continue;
  const a = wp(name).distanceTo(wp(tChild));
  const b = somaRest[S[sChild]].distanceTo(somaRest[S[soma]]) * K;
  rows.push({ osso: name, soma: `${soma}->${sChild}`, nostro_cm: +(a * 100).toFixed(1), soma_cm: +(b * 100).toFixed(1), rapporto: +(a / b).toFixed(2) });
}
console.log('\n1) LUNGHEZZE DELLE OSSA (rapporto = manichino / SOMA scalato; 1.00 = uguale)');
console.table(rows);
const dist = (a, b) => wp(a).distanceTo(wp(b));
const sd = (a, b) => somaRest[S[a]].distanceTo(somaRest[S[b]]) * K;
const whole = [
  ['gamba (anca -> caviglia)', dist('thigh_l', 'foot_l'), sd('LeftLeg', 'LeftFoot')],
  ['braccio (spalla -> polso)', dist('upperarm_l', 'hand_l'), sd('LeftArm', 'LeftHand')],
  ['busto (bacino -> collo)', dist('pelvis', 'neck_01'), sd('Hips', 'Neck1')],
  ['larghezza spalle', dist('upperarm_l', 'upperarm_r'), sd('LeftArm', 'RightArm')],
  ['larghezza fianchi', dist('thigh_l', 'thigh_r'), sd('LeftLeg', 'RightLeg')],
  ['collo -> testa', dist('neck_01', 'head'), sd('Neck1', 'Head')],
].map(([m, a, b]) => ({ misura: m, nostro_cm: +(a * 100).toFixed(1), soma_cm: +(b * 100).toFixed(1), rapporto: +(a / b).toFixed(2) }));
console.table(whole);

// ---------------------------------------------------------------- 2) riposo
const rest = [];
for (const [name, [soma, tChild, sChild]] of Object.entries(MAP)) {
  if (!tChild || !sChild) continue;
  const dt = wp(tChild).sub(wp(name)).normalize();
  const ds = somaRest[S[sChild]].clone().sub(somaRest[S[soma]]).normalize();
  rest.push({ osso: name, angolo_gradi: +((Math.acos(Math.max(-1, Math.min(1, dt.dot(ds)))) * 180) / Math.PI).toFixed(1) });
}
console.log('\n2) POSA DI RIPOSO: angolo tra la direzione di ogni osso e quella di SOMA');
console.table(rest.sort((a, b) => b.angolo_gradi - a.angolo_gradi));

// ---------------------------------------------------------------- 3) fedelta' del retarget
const JOINTS = [
  ['pelvis', 'Hips'],
  ['spine_01', 'Spine1'],
  ['spine_02', 'Spine2'],
  ['spine_03', 'Chest'],
  ['neck_01', 'Neck1'],
  ['neck_02', 'Neck2'],
  ['head', 'Head'],
  ['upperarm_l', 'LeftArm'],
  ['lowerarm_l', 'LeftForeArm'],
  ['hand_l', 'LeftHand'],
  ['upperarm_r', 'RightArm'],
  ['lowerarm_r', 'RightForeArm'],
  ['hand_r', 'RightHand'],
  ['thigh_l', 'LeftLeg'],
  ['calf_l', 'LeftShin'],
  ['foot_l', 'LeftFoot'],
  ['ball_l', 'LeftToeBase'],
  ['thigh_r', 'RightLeg'],
  ['calf_r', 'RightShin'],
  ['foot_r', 'RightFoot'],
  ['ball_r', 'RightToeBase'],
];
const GLB = process.env.AUDIT_GLB ?? 'public/kimodo-animations.glb';
const META_FILE = process.env.AUDIT_META ?? 'src/ts/generated/kimodoClips.json';
const kimodo = await load(GLB);
// pavimento dell'errore: la sola differenza di proporzioni, a riposo (nessuna posa)
const floorErr = JOINTS.map(([o, sj], i) => {
  const A = JOINTS.map(([x]) => wp(x));
  const B = JOINTS.map(([, y]) => somaRest[S[y]].clone().multiplyScalar(K));
  let e = 0;
  for (let k = 0; k < JOINTS.length; k++) if (k !== i) e += Math.abs(A[i].distanceTo(A[k]) - B[i].distanceTo(B[k]));
  return e / (JOINTS.length - 1);
});
const SRC = 'assets-src/kimodo';
const f32 = (f) => {
  const b = fs.readFileSync(f);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const kimodoMeta = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
const mixer = new THREE.AnimationMixer(root);
const nJ = JOINTS.length;
const sumErr = new Float64Array(nJ);
const maxErr = new Float64Array(nJ);
let count = 0;
const perClip = [];
for (const dir of fs.readdirSync(SRC).sort()) {
  const rf = path.join(SRC, dir, 'local_rotations_xyzw.f32');
  if (!fs.existsSync(rf)) continue;
  const clip = kimodo.animations.find((a) => a.name === `Kimodo_${dir}`);
  if (!clip) continue;
  // le clip in loop sono ritagliate dai dati grezzi (non si sa da dove): fuori
  if (clip.extras?.loop || kimodoMeta[`Kimodo_${dir}`]?.loop) continue;
  const rot = f32(rf);
  const rp = f32(path.join(SRC, dir, 'root_positions.f32'));
  const T = rp.length / 3;
  mixer.stopAllAction();
  mixer.clipAction(clip).play();
  let clipSum = 0;
  let clipN = 0;
  for (let t = 0; t < T; t += 3) {
    // FK di SOMA
    const G = [];
    const P = [];
    const q = new THREE.Quaternion();
    for (let j = 0; j < 30; j++) {
      q.fromArray(rot, (t * 30 + j) * 4).normalize();
      if (SOMA_PARENTS[j] < 0) {
        G.push(q.clone());
        P.push(new THREE.Vector3().fromArray(rp, t * 3));
      } else {
        G.push(G[SOMA_PARENTS[j]].clone().multiply(q));
        P.push(P[SOMA_PARENTS[j]].clone().add(new THREE.Vector3().fromArray(SOMA_OFFSETS[j]).applyQuaternion(G[SOMA_PARENTS[j]])));
      }
    }
    mixer.setTime(Math.min(clip.duration, t / 30));
    root.updateMatrixWorld(true);
    const A = JOINTS.map(([o]) => wp(o));
    const B = JOINTS.map(([, s]) => P[S[s]].clone().multiplyScalar(K));
    for (let i = 0; i < nJ; i++) {
      let e = 0;
      for (let k = 0; k < nJ; k++) {
        if (k === i) continue;
        e += Math.abs(A[i].distanceTo(A[k]) - B[i].distanceTo(B[k]));
      }
      e /= nJ - 1;
      sumErr[i] += e;
      maxErr[i] = Math.max(maxErr[i], e);
      clipSum += e;
    }
    clipN += nJ;
    count++;
  }
  perClip.push({ clip: dir, errore_medio_cm: +((clipSum / clipN) * 100).toFixed(2) });
}
console.log('\n3) FEDELTA\' DEL RETARGET (errore medio sulle distanze tra giunti, in cm)');
console.table(JOINTS.map(([o, s], i) => ({ giunto: `${o} / ${s}`, solo_proporzioni_cm: +(floorErr[i] * 100).toFixed(2), medio_cm: +((sumErr[i] / count) * 100).toFixed(2), picco_cm: +(maxErr[i] * 100).toFixed(2) })));
console.log('per clip:');
console.table(perClip.sort((a, b) => b.errore_medio_cm - a.errore_medio_cm));

// ---------------------------------------------------------------- 4) piedi e mani: dove arrivano, quanto scivolano
// (a) l'estremo di ogni arto, rispetto alla sua anca/spalla, contro quello di SOMA
//     scalato sulla lunghezza dell'arto: e' quello che la IK deve raggiungere
// (b) i piedi sul terreno: nelle clip con root motion si porta il piede nel
//     mondo (traccia di movimento + posizione nel corpo) e si misura quanto si
//     muove mentre e' a terra (cm/s): zero = niente pattinamento
const LIMB_ENDS = [
  ['gamba sx', 'thigh_l', 'foot_l', 'LeftLeg', 'LeftFoot', true],
  ['gamba dx', 'thigh_r', 'foot_r', 'RightLeg', 'RightFoot', true],
  ['braccio sx', 'upperarm_l', 'hand_l', 'LeftArm', 'LeftHand', false],
  ['braccio dx', 'upperarm_r', 'hand_r', 'RightArm', 'RightHand', false],
];
const limbKs = LIMB_ENDS.map(([, up, , su, se]) => {
  const chain = { thigh_l: 'calf_l', thigh_r: 'calf_r', upperarm_l: 'lowerarm_l', upperarm_r: 'lowerarm_r' }[up];
  const endB = { thigh_l: 'foot_l', thigh_r: 'foot_r', upperarm_l: 'hand_l', upperarm_r: 'hand_r' }[up];
  const sMid = { LeftLeg: 'LeftShin', RightLeg: 'RightShin', LeftArm: 'LeftForeArm', RightArm: 'RightForeArm' }[su];
  const ours = wp(up).distanceTo(wp(chain)) + wp(chain).distanceTo(wp(endB));
  const soma = somaRest[S[su]].distanceTo(somaRest[S[sMid]]) + somaRest[S[sMid]].distanceTo(somaRest[S[se]]);
  return ours / soma;
});
// altezza della punta sul suo minimo sotto cui il piede e' "a terra" (m)
const CONTACT_H = Number(process.env.AUDIT_CONTACT_H ?? 0.035);
const endErr = LIMB_ENDS.map(() => ({ sum: 0, max: 0, n: 0 }));
const slipAll = [];
for (const dir of fs.readdirSync(SRC).sort()) {
  const rf = path.join(SRC, dir, 'local_rotations_xyzw.f32');
  if (!fs.existsSync(rf)) continue;
  const clip = kimodo.animations.find((a) => a.name === `Kimodo_${dir}`);
  const meta = kimodoMeta[`Kimodo_${dir}`];
  if (!clip || meta?.loop) continue;
  const rot = f32(rf);
  const rp = f32(path.join(SRC, dir, 'root_positions.f32'));
  const T = rp.length / 3;
  mixer.stopAllAction();
  mixer.clipAction(clip).play();
  const feet = [[], []];
  for (let t = 0; t < T; t++) {
    const G = [];
    const P = [];
    const q = new THREE.Quaternion();
    for (let j = 0; j < 30; j++) {
      q.fromArray(rot, (t * 30 + j) * 4).normalize();
      if (SOMA_PARENTS[j] < 0) {
        G.push(q.clone());
        P.push(new THREE.Vector3());
      } else {
        G.push(G[SOMA_PARENTS[j]].clone().multiply(q));
        P.push(P[SOMA_PARENTS[j]].clone().add(new THREE.Vector3().fromArray(SOMA_OFFSETS[j]).applyQuaternion(G[SOMA_PARENTS[j]])));
      }
    }
    mixer.setTime(Math.min(clip.duration, t / 30));
    root.updateMatrixWorld(true);
    // (a) rispetto all'anca/spalla: nei sistemi di SOMA e nostro la direzione dell'arto non e'
    // confrontabile (due mondi), quindi lunghezza e angolo con l'asse verticale
    if (t % 3 === 0) {
      LIMB_ENDS.forEach(([, up, end, su, se], i) => {
        const o = wp(end).sub(wp(up));
        const sm = P[S[se]].clone().sub(P[S[su]]).multiplyScalar(limbKs[i]);
        // errore sulla lunghezza dell'estensione e sull'inclinazione rispetto alla verticale
        const e = Math.abs(o.length() - sm.length());
        const ang = Math.abs(Math.acos(o.y / o.length()) - Math.acos(sm.y / sm.length())) * o.length();
        endErr[i].sum += Math.hypot(e, ang);
        endErr[i].max = Math.max(endErr[i].max, Math.hypot(e, ang));
        endErr[i].n++;
      });
    }
    // (b) piedi nel mondo (solo clip con traccia di movimento)
    if (meta?.motion) {
      const m = meta.motion;
      const yaw = m.yaw[t] ?? 0;
      const c = Math.cos(yaw);
      const sn = Math.sin(yaw);
      for (let f = 0; f < 2; f++) {
        const fp = wp(f === 0 ? 'ball_l' : 'ball_r');
        // nel mondo: avanza di (x, z) della traccia ed e' girato di yaw (+ = a sinistra)
        const wx = m.x[t] + fp.x * c + fp.z * sn;
        const wz = m.z[t] + -fp.x * sn + fp.z * c;
        feet[f].push([wx, fp.y, wz]);
      }
    }
  }
  if (meta?.motion) {
    for (let f = 0; f < 2; f++) {
      const ys = feet[f].map((p) => p[1]);
      const lo = Math.min(...ys);
      let slip = 0;
      let n = 0;
      for (let t = 1; t < feet[f].length; t++) {
        if (feet[f][t][1] < lo + CONTACT_H && feet[f][t - 1][1] < lo + CONTACT_H) {
          slip += Math.hypot(feet[f][t][0] - feet[f][t - 1][0], feet[f][t][2] - feet[f][t - 1][2]) * 30;
          n++;
        }
      }
      if (n > 4) slipAll.push({ clip: dir, piede: f === 0 ? 'sx' : 'dx', appoggio_frame: n, scivola_cm_s: +((slip / n) * 100).toFixed(1) });
    }
  }
}
console.log('\n4a) ESTREMO DEGLI ARTI rispetto all\'anca/spalla (errore su lunghezza e inclinazione, cm)');
console.table(LIMB_ENDS.map(([nome], i) => ({ arto: nome, medio_cm: +((endErr[i].sum / endErr[i].n) * 100).toFixed(2), picco_cm: +(endErr[i].max * 100).toFixed(2) })));
console.log('4b) PIEDI A TERRA: scivolamento (cm/s) nelle clip con root motion');
console.table(slipAll);
console.log(`scivolamento medio: ${(slipAll.reduce((a, b) => a + b.scivola_cm_s, 0) / Math.max(1, slipAll.length)).toFixed(1)} cm/s`);
const jsonOut = process.argv.indexOf('--json');
if (jsonOut > 0) {
  fs.writeFileSync(process.argv[jsonOut + 1], JSON.stringify({ K, lengths: rows, whole, rest, retarget: JOINTS.map(([o, s], i) => ({ o, s, mean_cm: (sumErr[i] / count) * 100, max_cm: maxErr[i] * 100 })), perClip }, null, 1));
}
