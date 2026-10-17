// Animazioni generate da Kimodo (NVIDIA, testo -> movimento) adattate allo
// scheletro del nostro manichino (soldier-citizen.glb).
//
//   node scripts/kimodo-retarget.mjs
//
// Legge assets-src/kimodo/<nome>/ (quello che scrive tools/kimodo/kimodo.sh:
// root_positions.f32, local_rotations_xyzw.f32, prompt.txt, opzionale
// clip.json) e scrive public/kimodo-animations.glb: solo clip, una per
// cartella, chiamata Kimodo_<cartella>. Il gioco le carica insieme alle
// altre animazioni del manichino (anche il file senza clip, se non ce ne
// sono ancora).
//
// Kimodo SOMA da' 30 giunti (scheletro "soma30", 30 fps): rotazioni locali
// rispetto a una posa di riposo a T con tutte le rotazioni nulle, piu' la
// posizione dei fianchi. Il nostro manichino e' anche lui a T, y in alto,
// muso verso +z, sinistra verso +x: come SOMA. L'adattamento copia la
// rotazione nel MONDO di ogni osso (non quella locale: le ossa dei due
// scheletri hanno orientamenti locali diversi), dopo aver allineato la
// direzione di riposo di ogni osso a quella di SOMA; il bacino segue
// l'altezza delle anche, scalata sulla lunghezza delle gambe.
//
// clip.json (facoltativo): { "inPlace": true } (predefinito) toglie lo
// spostamento orizzontale (la clip resta sul posto, la posizione la decide il
// gioco); false lo tiene (root motion).
// { "rootMotion": true } (partenze, fermate, svolte sul posto): oltre allo
// spostamento toglie anche la direzione del corpo (la clip guarda sempre
// avanti) e scrive in kimodoClips.json "motion": per ogni fotogramma quanto
// il corpo e' avanzato (x di lato, z avanti, metri del nostro manichino) e
// girato (yaw, radianti, + = a sinistra) rispetto all'inizio. Il gioco muove
// e gira il personaggio con quei numeri: i piedi restano dove li mette la
// clip.
import { NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';

const RIG = 'assets-src/models/soldier-citizen.glb';
const SRC = 'assets-src/kimodo';
const OUT = process.env.KIMODO_OUT ?? 'public/kimodo-animations.glb';
// dati delle clip per il codice del gioco (velocita' delle clip in loop ecc.)
const META = process.env.KIMODO_META ?? 'src/ts/generated/kimodoClips.json';
const FPS = 30;

// scheletro SOMA e corrispondenza con le nostre ossa: scripts/lib/skeletons.mjs
import { SOMA_NAMES, SOMA_PARENTS, SOMA_OFFSETS, MAP } from './lib/skeletons.mjs';
const S = Object.fromEntries(SOMA_NAMES.map((n, i) => [n, i]));


// ---------------------------------------------------------------- scheletro nostro
const io = new NodeIO();
const rigDoc = await io.read(RIG);
const rigNodes = rigDoc.getRoot().listNodes();
const bones = new Map(); // nome -> Object3D (posa di riposo)
const sceneRoot = new THREE.Object3D();
{
  const objs = new Map();
  for (const n of rigNodes) {
    const o = new THREE.Object3D();
    o.name = n.getName();
    o.position.fromArray(n.getTranslation());
    o.quaternion.fromArray(n.getRotation());
    o.scale.fromArray(n.getScale());
    objs.set(n, o);
    bones.set(o.name, o);
  }
  for (const [n, o] of objs) {
    const p = n.listParents().find((x) => x.propertyType === 'Node');
    (p ? objs.get(p) : sceneRoot).add(o);
  }
  sceneRoot.updateMatrixWorld(true);
}
// Posa di riferimento dalle animazioni del manichino (Idle_A, primo fotogramma):
// - dita: le clip Kimodo non muovono nessun dito (SOMA ne predice solo il
//   polso), che altrimenti tornano alla posa di riposo (T, dritte e rigide) e
//   con le mani sembra un manichino; si copia la mano rilassata di Idle_A;
// - collo e testa: SOMA ha due ossa del collo, il nostro rig una; la posa
//   dritta di Kimodo teneva il collo piegato in avanti di 40-60 gradi e la
//   testa all'indietro per compensare (Idle_A: 29 e -24 gradi). Qui la
//   rotazione della testa rispetto al petto si divide fra collo e testa
//   (meta' ciascuno) intorno alla posa di riposo di Idle_A.
const REF_ANIMS = 'assets-src/models/soldier-citizen-base-animations.glb';
const refQ = new Map(); // nome osso -> THREE.Quaternion (primo fotogramma di Idle_A)
{
  const doc = await new NodeIO().read(REF_ANIMS);
  const idle = doc.getRoot().listAnimations().find((a) => a.getName() === 'Idle_A');
  if (!idle) throw new Error(`Idle_A non trovata in ${REF_ANIMS}`);
  for (const ch of idle.listChannels()) {
    if (ch.getTargetPath() !== 'rotation') continue;
    const name = ch.getTargetNode()?.getName();
    if (!name) continue;
    refQ.set(name, new THREE.Quaternion().fromArray(ch.getSampler().getOutput().getElement(0, [0, 0, 0, 0])));
  }
}
const FINGER_BONES = [...refQ.keys()].filter((n) => /^(thumb|index|middle|ring|pinky)_/.test(n));
const NECK_CHAIN = ['neck_01', 'neck_02', 'head'];
// Kimodo tiene la testa un po' piu' alta (verso l'alto) di Idle_A/Walk: misurato,
// a riposo -5..0 gradi rispetto al petto contro 4 (Idle_A) e 10-13 (Walk).
const HEAD_PITCH_BIAS = (7 * Math.PI) / 180;
// Rigidita' del collo: nelle clip del manichino la testa sta ferma rispetto al
// petto (Idle_A 3-5 gradi, Walk 10-13: escursione 2-3 gradi); quelle Kimodo la
// muovono molto (walk_start -17..10, look_around 0..27, wait_impatient 5..50)
// e il collo sembrava una molla. Lo scarto di ogni osso dal riposo si riduce
// (somma sui tre ~ 0.4 in avanti/indietro, ~0.8 nel giro destra/sinistra, che
// serve a guardarsi attorno).
const NECK_STIFF = {
  neck_01: { pitch: 0.4, yaw: 0.8, roll: 0.3 },
  neck_02: { pitch: 0.4, yaw: 0.8, roll: 0.3 },
  head: { pitch: 0.45, yaw: 0.85, roll: 0.35 },
};

// ordine dall'alto in basso (genitori prima dei figli)
const order = [];
sceneRoot.traverse((o) => o !== sceneRoot && order.push(o));
const restWorldQ = new Map(order.map((o) => [o, o.getWorldQuaternion(new THREE.Quaternion())]));
const restWorldP = new Map(order.map((o) => [o, o.getWorldPosition(new THREE.Vector3())]));

// ---------------------------------------------------------------- SOMA a riposo
const somaRestP = [];
for (let j = 0; j < 30; j++) {
  const off = new THREE.Vector3().fromArray(SOMA_OFFSETS[j]);
  somaRestP.push(SOMA_PARENTS[j] < 0 ? off : somaRestP[SOMA_PARENTS[j]].clone().add(off));
}

// allineamento della posa di riposo: ruota la direzione di ogni nostro osso
// su quella del corrispondente in SOMA.
// Tranne schiena, collo, testa e clavicole: li' le direzioni a riposo sono
// diverse per anatomia, non per posa (la nostra schiena a riposo ha la sua
// curva, la clavicola sale di 6 gradi e va piu' indietro di 20; in SOMA sono
// dritte). Allinearle raddrizzava la nostra schiena come quella di SOMA e
// abbassava le spalle: misurato in gioco, con le clip Kimodo il petto 2-3 cm
// e le spalle 2-5 cm piu' in basso che con le clip del manichino ("le
// animazioni di kimodo hanno le spalle piu' basse del mio personaggio").
// Per schiena, collo e testa si copia la rotazione di SOMA rispetto al suo
// riposo (che e' in piedi a T come il nostro): SOMA dritto = il nostro
// dritto. Le clavicole si allineano solo in orizzontale (avanti/indietro) e
// tengono la loro inclinazione: copiate del tutto le spalle salivano di 2-6
// cm sopra quelle del manichino, allineate del tutto scendevano di 2-5;
// cosi' (misurato) stanno come nelle clip del manichino.
const NO_ALIGN = new Set(['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'neck_02', 'head']);
const YAW_ALIGN = new Set(['clavicle_l', 'clavicle_r']);
const align = new Map();
for (const [name, [, tChild, sChild]] of Object.entries(MAP)) {
  const b = bones.get(name);
  if (!b) throw new Error(`osso ${name} non trovato in ${RIG}`);
  const q = new THREE.Quaternion();
  if (tChild && sChild && !NO_ALIGN.has(name)) {
    const dt = restWorldP.get(bones.get(tChild)).clone().sub(restWorldP.get(b)).normalize();
    const ds = somaRestP[S[sChild]].clone().sub(somaRestP[S[MAP[name][0]]]).normalize();
    if (YAW_ALIGN.has(name)) {
      // la direzione orizzontale di SOMA con la pendenza nostra
      const h = Math.hypot(dt.x, dt.z);
      const hs = Math.hypot(ds.x, ds.z) || 1;
      ds.set((ds.x / hs) * h, dt.y, (ds.z / hs) * h).normalize();
    }
    q.setFromUnitVectors(dt, ds);
  }
  align.set(b, q);
}

// bacino: segue il punto medio delle anche (scalato sulla loro altezza)
const pelvis = bones.get('pelvis');
const tHipMid = restWorldP
  .get(bones.get('thigh_l'))
  .clone()
  .add(restWorldP.get(bones.get('thigh_r')))
  .multiplyScalar(0.5);
const sHipMid = somaRestP[S.LeftLeg].clone().add(somaRestP[S.RightLeg]).multiplyScalar(0.5);
const K = tHipMid.y / sHipMid.y;
const pelvisToHipMid = tHipMid.clone().sub(restWorldP.get(pelvis)); // nel mondo, a riposo
const sHipsToHipMid = sHipMid.clone().sub(somaRestP[0]);

// ---------------------------------------------------------------- una clip
// Piedi a terra: le caviglie di SOMA sono piu' basse delle nostre (5 cm
// contro 10) e il bacino scalato lasciava il manichino sospeso di ~1.5 cm.
// Si misura (cinematica diretta del nostro scheletro) quanto il piede piu'
// basso sta sopra la sua altezza di riposo nel momento piu' basso della
// clip, e si abbassa il bacino di tanto: nel punto piu' basso tocca terra
// come a riposo (i salti restano salti).
const CONTACT = ['ball_l', 'ball_r', 'foot_l', 'foot_r'].map((n) => bones.get(n));
function groundFeet(T, tracks, pelvisPos) {
  const saved = order.map((o) => [o, o.quaternion.clone(), o.position.clone()]);
  const w = new THREE.Vector3();
  let lowest = Infinity;
  for (let t = 0; t < T; t++) {
    for (const [b, arr] of tracks) b.quaternion.fromArray(arr, t * 4);
    pelvis.position.fromArray(pelvisPos, t * 3);
    sceneRoot.updateMatrixWorld(true);
    for (const c of CONTACT) lowest = Math.min(lowest, c.getWorldPosition(w).y - restWorldP.get(c).y);
  }
  for (const [o, q, pos] of saved) {
    o.quaternion.copy(q);
    o.position.copy(pos);
  }
  sceneRoot.updateMatrixWorld(true);
  // spostamento verticale nel mondo -> nel sistema del genitore del bacino
  const down = new THREE.Vector3(0, -lowest, 0)
    .transformDirection(pelvis.parent.matrixWorld.clone().invert())
    .multiplyScalar(Math.abs(lowest));
  for (let t = 0; t < T; t++) {
    pelvisPos[t * 3] += down.x;
    pelvisPos[t * 3 + 1] += down.y;
    pelvisPos[t * 3 + 2] += down.z;
  }
  return lowest;
}

// ---------------------------------------------------------------- IK sulle proporzioni
// Il manichino ha le gambe piu' corte (anca-caviglia 84 contro 85.5 cm di SOMA
// non scalato: tenendo conto di K il rapporto e' 0.95), il busto piu' lungo e
// i fianchi piu' stretti: copiare solo le rotazioni lascia i piedi e le mani a
// 2-6 cm da dove SOMA li metterebbe (docs/skeleton-calibration.md). Dopo aver
// copiato le rotazioni, ogni arto si riassesta con una IK a due ossa: il
// piede (la mano) va dov'e' in SOMA rispetto alla sua anca (spalla), scalato
// sulla lunghezza dell'arto del manichino; il piano di piegatura (ginocchio,
// gomito) resta quello copiato. La traiettoria del bacino (e quindi la
// velocita' delle clip) si scala come le gambe, cosi' i piedi non scivolano.
const LIMBS = [
  { up: 'thigh_l', mid: 'calf_l', end: 'foot_l', s: ['LeftLeg', 'LeftShin', 'LeftFoot'], leg: true },
  { up: 'thigh_r', mid: 'calf_r', end: 'foot_r', s: ['RightLeg', 'RightShin', 'RightFoot'], leg: true },
  { up: 'upperarm_l', mid: 'lowerarm_l', end: 'hand_l', s: ['LeftArm', 'LeftForeArm', 'LeftHand'], leg: false },
  { up: 'upperarm_r', mid: 'lowerarm_r', end: 'hand_r', s: ['RightArm', 'RightForeArm', 'RightHand'], leg: false },
];
const IK_ENABLED = process.env.KIMODO_NO_IK !== '1';
for (const L of LIMBS) {
  L.bUp = bones.get(L.up);
  L.bMid = bones.get(L.mid);
  L.bEnd = bones.get(L.end);
  L.l1 = restWorldP.get(L.bMid).distanceTo(restWorldP.get(L.bUp));
  L.l2 = restWorldP.get(L.bEnd).distanceTo(restWorldP.get(L.bMid));
  const sl1 = somaRestP[S[L.s[1]]].distanceTo(somaRestP[S[L.s[0]]]);
  const sl2 = somaRestP[S[L.s[2]]].distanceTo(somaRestP[S[L.s[1]]]);
  L.ks = (L.l1 + L.l2) / (sl1 + sl2); // metri nostri per metro SOMA, su quest'arto
  L.pole = null; // piano di piegatura dell'ultimo fotogramma valido
}
// scala del movimento a terra: come le gambe (media delle due)
const K_MOVE = IK_ENABLED ? (LIMBS[0].ks + LIMBS[1].ks) / 2 : K;
console.log(`IK: gambe ${LIMBS[0].ks.toFixed(3)}/${LIMBS[1].ks.toFixed(3)}, braccia ${LIMBS[2].ks.toFixed(3)}/${LIMBS[3].ks.toFixed(3)}, K ${K.toFixed(3)}, movimento ${K_MOVE.toFixed(3)}`);

const _q1 = new THREE.Quaternion();
// ruota la rotazione W in modo che la direzione `from` diventi `to` (rotazione minima)
function aimBone(Wb, from, to) {
  _q1.setFromUnitVectors(from, to);
  Wb.premultiply(_q1);
}

// ---------------------------------------------------------------- piedi a terra fermi
// Anche i dati grezzi di Kimodo fanno scivolare i piedi (14 cm/s in media
// nelle clip con root motion, docs/skeleton-calibration.md): il modello non
// conosce il contatto col terreno. Qui: (1) si cercano gli appoggi, cioe' i
// tratti in cui la punta del piede sta bassa (con isteresi e durata minima);
// (2) per ogni appoggio il piede si "pianta" in un punto del mondo (media
// della sua posizione nell'appoggio, con la traccia di movimento del corpo);
// (3) il bacino si sposta il minimo per far arrivare le gambe ai punti
// piantati, con lo spostamento levigato; (4) IK a due ossa sulle gambe: il
// piede va al punto piantato (con dissolvenza in entrata e in uscita), la sua
// orientazione resta quella della clip.
const CLEAN = process.env.KIMODO_NO_LOCK !== '1';
const LOCK = {
  enter: 0.03,
  exit: 0.055,
  minFrames: 4,
  gapFrames: 3,
  ramp: 2,
  reach: 0.985,
  smooth: 5,
  maxSpeed: 0.6,
  devFull: 0.07,
  devNone: 0.14,
  ...(process.env.KIMODO_LOCK ? JSON.parse(process.env.KIMODO_LOCK) : {}),
};
const FOOT_SIDES = [
  { thigh: 'thigh_l', calf: 'calf_l', foot: 'foot_l', ball: 'ball_l' },
  { thigh: 'thigh_r', calf: 'calf_r', foot: 'foot_r', ball: 'ball_r' },
];
function cleanFeet(T, tracks, pelvisPos, motion, speed, name) {
  if (!CLEAN) return;
  // clip sul posto che avanzano (camminate a tapis roulant): niente da piantare
  if (!motion && speed > 0.3) return;
  const get = (b) => bones.get(b);
  const setPose = (t, pelvisOffset) => {
    for (const [b, arr] of tracks) b.quaternion.fromArray(arr, t * 4);
    pelvis.position.fromArray(pelvisPos, t * 3);
    if (pelvisOffset) pelvis.position.add(pelvisOffset);
    sceneRoot.updateMatrixWorld(true);
  };
  const m = motion;
  const toWorld = (t, p, out) => {
    if (!m) return out.copy(p);
    const c = Math.cos(m.yaw[t]);
    const s = Math.sin(m.yaw[t]);
    return out.set(m.x[t] + p.x * c + p.z * s, p.y, m.z[t] - p.x * s + p.z * c);
  };
  const toLocal = (t, w, out) => {
    if (!m) return out.copy(w);
    const c = Math.cos(m.yaw[t]);
    const s = Math.sin(m.yaw[t]);
    const dx = w.x - m.x[t];
    const dz = w.z - m.z[t];
    return out.set(dx * c - dz * s, w.y, dx * s + dz * c);
  };
  const tmp = new THREE.Vector3();
  const sides = FOOT_SIDES.map((f) => {
    const o = { ...f, bThigh: get(f.thigh), bCalf: get(f.calf), bFoot: get(f.foot), bBall: get(f.ball) };
    o.l1 = restWorldP.get(o.bCalf).distanceTo(restWorldP.get(o.bThigh));
    o.l2 = restWorldP.get(o.bFoot).distanceTo(restWorldP.get(o.bCalf));
    return o;
  });
  // (1) posizioni dei piedi in ogni fotogramma (mondo), dalla posa copiata
  const ballW = sides.map(() => []);
  const footW = sides.map(() => []);
  for (let t = 0; t < T; t++) {
    setPose(t);
    sides.forEach((sd, i) => {
      ballW[i].push(toWorld(t, sd.bBall.getWorldPosition(new THREE.Vector3()), new THREE.Vector3()));
      footW[i].push(toWorld(t, sd.bFoot.getWorldPosition(new THREE.Vector3()), new THREE.Vector3()));
    });
  }
  // (2) appoggi: punta bassa rispetto al suo minimo nella clip
  const segs = sides.map((sd, i) => {
    const ys = ballW[i].map((p) => p.y);
    const lo = Math.min(...ys);
    const on = new Array(T).fill(false);
    let state = false;
    for (let t = 0; t < T; t++) {
      const h = ys[t] - lo;
      // velocita' orizzontale della punta nel mondo (m/s) su +-2 fotogrammi: un piede che
      // si muove davvero (un passo, un giro sul posto) non e' un appoggio da piantare
      const a = Math.max(0, t - 2);
      const b = Math.min(T - 1, t + 2);
      const v = (Math.hypot(ballW[i][b].x - ballW[i][a].x, ballW[i][b].z - ballW[i][a].z) * FPS) / Math.max(1, b - a);
      state = state ? h < LOCK.exit && v < LOCK.maxSpeed * 1.3 : h < LOCK.enter && v < LOCK.maxSpeed;
      on[t] = state;
    }
    // chiude i buchi brevi e toglie gli appoggi troppo corti
    for (let t = 1; t < T - 1; t++) {
      if (!on[t]) {
        let e = t;
        while (e < T && !on[e]) e++;
        if (e < T && on[t - 1] && e - t <= LOCK.gapFrames) for (let k = t; k < e; k++) on[k] = true;
        t = e;
      }
    }
    const out = [];
    for (let t = 0; t < T; ) {
      if (!on[t]) {
        t++;
        continue;
      }
      let e = t;
      while (e < T && on[e]) e++;
      if (e - t >= LOCK.minFrames) out.push([t, e - 1]);
      t = e;
    }
    return out;
  });
  // (3) punti piantati (mondo) e peso per fotogramma
  const pin = sides.map(() => new Array(T).fill(null));
  const wgt = sides.map(() => new Float32Array(T));
  segs.forEach((list, i) => {
    for (const [a, b] of list) {
      const p = new THREE.Vector3();
      let n = 0;
      for (let t = a; t <= b; t++) {
        p.add(ballW[i][t]);
        n++;
      }
      p.divideScalar(n);
      for (let t = a; t <= b; t++) {
        pin[i][t] = p;
        const rin = Math.min(1, (t - a + 1) / (LOCK.ramp + 1));
        const rout = Math.min(1, (b - t + 1) / (LOCK.ramp + 1));
        const r = Math.min(rin, rout);
        // se il piede, in questo fotogramma, e' lontano dal punto piantato (la clip lo muove davvero) si molla
        const dev = Math.hypot(ballW[i][t].x - p.x, ballW[i][t].z - p.z);
        const fade = Math.min(1, Math.max(0, (LOCK.devNone - dev) / (LOCK.devNone - LOCK.devFull)));
        wgt[i][t] = r * r * (3 - 2 * r) * fade;
      }
    }
  });
  if (segs.every((l) => l.length === 0)) return;
  // (4) bacino: lo spostamento minimo (x, z; l'altezza non cambia) perche' le gambe arrivino ai punti piantati
  const off = Array.from({ length: T }, () => new THREE.Vector3());
  const local = new THREE.Vector3();
  for (let pass = 0; pass < 2; pass++) {
    for (let t = 0; t < T; t++) {
      setPose(t, off[t]);
      sides.forEach((sd, i) => {
        if (!pin[i][t] || wgt[i][t] <= 0) return;
        const A = sd.bThigh.getWorldPosition(tmp);
        const reachMax = (sd.l1 + sd.l2) * LOCK.reach;
        // punto piantato e' quello della punta: la caviglia ci arriva meno lo scarto punta-caviglia di questo fotogramma
        toLocal(t, pin[i][t], local);
        const bw = sd.bBall.getWorldPosition(new THREE.Vector3());
        const aw = sd.bFoot.getWorldPosition(new THREE.Vector3());
        local.x -= bw.x - aw.x;
        local.z -= bw.z - aw.z;
        local.y = aw.y;
        const dx = local.x - A.x;
        const dy = local.y - A.y;
        const dz = local.z - A.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > reachMax) {
          const excess = (dist - reachMax) * wgt[i][t];
          // si sposta il bacino verso il piede, in orizzontale (la quota la tiene la clip)
          const h = Math.hypot(dx, dz);
          if (h > 1e-5) {
            off[t].x += (dx / h) * Math.min(excess, h);
            off[t].z += (dz / h) * Math.min(excess, h);
          }
        }
      });
    }
  }
  // levigatura dello spostamento: due passate di media mobile
  for (let k = 0; k < 2; k++) {
    const src = off.map((o) => o.clone());
    for (let t = 0; t < T; t++) {
      const acc = new THREE.Vector3();
      let n = 0;
      for (let d = -LOCK.smooth; d <= LOCK.smooth; d++) {
        const u = Math.min(T - 1, Math.max(0, t + d));
        acc.add(src[u]);
        n++;
      }
      off[t].copy(acc.divideScalar(n));
    }
  }
  for (let t = 0; t < T; t++) {
    pelvisPos[t * 3] += off[t].x;
    pelvisPos[t * 3 + 2] += off[t].z;
  }
  // (5) IK delle gambe sui punti piantati
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const qc = new THREE.Quaternion();
  const ptA = new THREE.Vector3();
  const ptB = new THREE.Vector3();
  const ptC = new THREE.Vector3();
  const lastPole = sides.map(() => null);
  let moved = 0;
  for (let t = 0; t < T; t++) {
    setPose(t);
    sides.forEach((sd, i) => {
      const w = wgt[i][t];
      const A = sd.bThigh.getWorldPosition(ptA).clone();
      const B = sd.bCalf.getWorldPosition(ptB).clone();
      const Cc = sd.bFoot.getWorldPosition(ptC).clone();
      const ac = Cc.clone().sub(A);
      const uAC = ac.clone().normalize();
      const bend = B.clone().sub(A);
      bend.addScaledVector(uAC, -bend.dot(uAC));
      if (bend.length() > 0.004) lastPole[i] = bend.normalize();
      if (!pin[i][t] || w <= 0 || !lastPole[i]) return;
      const pl = toLocal(t, pin[i][t], new THREE.Vector3());
      // la punta va al punto piantato: la caviglia di tanto meno lo scarto punta-caviglia
      const bw = sd.bBall.getWorldPosition(new THREE.Vector3());
      pl.x -= bw.x - Cc.x;
      pl.z -= bw.z - Cc.z;
      // dissolvenza: dal punto dov'e' al punto piantato (la quota resta quella della clip)
      const target = new THREE.Vector3(Cc.x + (pl.x - Cc.x) * w, Cc.y, Cc.z + (pl.z - Cc.z) * w);
      const at = target.clone().sub(A);
      const d = Math.min(Math.max(at.length(), Math.abs(sd.l1 - sd.l2) + 1e-3), sd.l1 + sd.l2 - 1e-3);
      const u = at.normalize();
      const p = lastPole[i].clone().addScaledVector(u, -lastPole[i].dot(u));
      if (p.length() < 1e-4) return;
      p.normalize();
      const a = (sd.l1 * sd.l1 - sd.l2 * sd.l2 + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, sd.l1 * sd.l1 - a * a));
      const Bn = A.clone().addScaledVector(u, a).addScaledVector(p, h);
      const Cn = A.clone().addScaledVector(u, d);
      // rotazioni nel mondo prima
      sd.bThigh.getWorldQuaternion(qa);
      sd.bCalf.getWorldQuaternion(qb);
      sd.bFoot.getWorldQuaternion(qc);
      const thighNew = qa.clone().premultiply(new THREE.Quaternion().setFromUnitVectors(B.clone().sub(A).normalize(), Bn.clone().sub(A).normalize()));
      const calfNew = qb.clone().premultiply(new THREE.Quaternion().setFromUnitVectors(Cc.clone().sub(B).normalize(), Cn.clone().sub(Bn).normalize()));
      // locali: coscia sotto il bacino, stinco sotto la coscia nuova, piede sotto lo stinco nuovo (orientazione del piede invariata)
      const pelvisW = pelvis.getWorldQuaternion(new THREE.Quaternion());
      const thighL = pelvisW.clone().invert().multiply(thighNew);
      const calfL = thighNew.clone().invert().multiply(calfNew);
      const footL = calfNew.clone().invert().multiply(qc);
      const write = (bn, q) => {
        const arr = tracks.get(bn);
        if (t > 0) {
          const o = (t - 1) * 4;
          if (q.x * arr[o] + q.y * arr[o + 1] + q.z * arr[o + 2] + q.w * arr[o + 3] < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        }
        q.toArray(arr, t * 4);
      };
      write(sd.bThigh, thighL);
      write(sd.bCalf, calfL);
      write(sd.bFoot, footL);
      moved++;
    });
  }
  // continuita' del segno delle rotazioni su tutta la clip (le correzioni cambiano solo alcuni fotogrammi)
  for (const [, arr] of tracks) {
    for (let t = 1; t < T; t++) {
      const o = (t - 1) * 4;
      const n = t * 4;
      if (arr[n] * arr[o] + arr[n + 1] * arr[o + 1] + arr[n + 2] * arr[o + 2] + arr[n + 3] * arr[o + 3] < 0) {
        for (let c = 0; c < 4; c++) arr[n + c] = -arr[n + c];
      }
    }
  }
  console.log(`  piedi: ${segs.map((l) => l.length).join('+')} appoggi, ${moved} correzioni, bacino spostato al massimo di ${(Math.max(...off.map((o) => o.length())) * 100).toFixed(1)} cm`);
}

// Estremi legati all'idle: le clip che partono o finiscono "in piedi fermo"
// (Kimodo: ~18 gradi di scarto medio da Idle_A, soprattutto clavicole e
// braccia) vengono portate esattamente sulla posa di Idle_A nel fotogramma di
// confine, con una correzione che sfuma in IDLE_BLEND_S secondi: q' = q * slerp(I, q_confine^-1 * idle, w).
// Gambe e bacino restano com'erano (appoggio, orientamento e posizione dei
// piedi sono gia' stati puliti); KIMODO_IDLE_LEGS=1 le include; KIMODO_NO_IDLE=1 spegne.
const IDLE_ENDS = {
  walk_start: ['first'], run_start: ['first'], walk_stop: ['last'], run_stop: ['last'],
  turn_180: ['first', 'last'], turn_left_90: ['first', 'last'], turn_right_90: ['first', 'last'],
  wait_impatient: ['first', 'last'], look_around: ['first', 'last'], stretch: ['first', 'last'],
  saluto: ['first', 'last'], point_shout: ['first', 'last'],
  idle_breathe: ['first', 'last'], idle_shift_weight: ['first', 'last'], idle_look: ['first', 'last'], idle_fidget: ['first', 'last'],
};
const IDLE_BLEND_S = Number(process.env.KIMODO_IDLE_BLEND ?? 0.4);
const IDLE_SKIP = /^(pelvis|root)$|^(thumb|index|middle|ring|pinky)_/;
const IDLE_LEGS = /^(thigh|calf|foot|ball)_/;
function blendToIdle(T, tracks, name) {
  const ends = IDLE_ENDS[name];
  if (!ends || process.env.KIMODO_NO_IDLE) return;
  const win = Math.max(2, Math.round(IDLE_BLEND_S * FPS));
  const cur = new THREE.Quaternion();
  const d = new THREE.Quaternion();
  const part = new THREE.Quaternion();
  const ident = new THREE.Quaternion();
  for (const [b, arr] of tracks) {
    if (IDLE_SKIP.test(b.name) || (!process.env.KIMODO_IDLE_LEGS && IDLE_LEGS.test(b.name))) continue;
    const idle = refQ.get(b.name);
    if (!idle) continue;
    for (const end of ends) {
      const edge = end === 'first' ? 0 : T - 1;
      cur.fromArray(arr, edge * 4);
      d.copy(cur).invert().multiply(idle);
      if (d.w < 0) d.set(-d.x, -d.y, -d.z, -d.w);
      for (let k = 0; k < win; k++) {
        const t = end === 'first' ? k : T - 1 - k;
        const u = 1 - k / win;
        const w = u * u * (3 - 2 * u);
        cur.fromArray(arr, t * 4);
        part.copy(ident).slerp(d, w);
        cur.multiply(part).normalize();
        cur.toArray(arr, t * 4);
      }
    }
  }
}

function retarget(rootPos, rotXYZW, opts) {
  const T = rootPos.length / 3;
  if (rotXYZW.length !== T * 30 * 4) throw new Error(`dati incoerenti: ${T} fotogrammi, ${rotXYZW.length / 4} rotazioni`);
  const tracks = new Map([...align.keys()].map((b) => [b, new Float32Array(T * 4)]));
  const pelvisPos = new Float32Array(T * 3);
  const G = Array.from({ length: 30 }, () => new THREE.Quaternion());
  const L = new THREE.Quaternion();
  const W = new Map();
  const wq = new THREE.Quaternion();
  const inv = new THREE.Quaternion();
  const v = new THREE.Vector3();
  // "sul posto": si toglie la traiettoria orizzontale SMUSSATA (media su
  // ~1 s), non quella del singolo fotogramma: resta l'ondeggiare dei fianchi
  // sui piedi, sparisce l'avanzare (una camminata diventa un tapis roulant e
  // la velocita' finisce in extras.speed per il gioco)
  const traj = smoothTrajectory(rootPos, T, 15);
  const yawS = opts.rootMotion ? headingOf(rotXYZW, T) : null;
  const C = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);
  for (let t = 0; t < T; t++) {
    if (yawS) C.setFromAxisAngle(Y, -yawS[t]);
    for (let j = 0; j < 30; j++) {
      L.fromArray(rotXYZW, (t * 30 + j) * 4).normalize();
      if (SOMA_PARENTS[j] < 0) {
        if (yawS) G[j].multiplyQuaternions(C, L);
        else G[j].copy(L);
      } else G[j].multiplyQuaternions(G[SOMA_PARENTS[j]], L);
    }
    // rotazioni nel mondo delle nostre ossa
    for (const o of order) {
      const a = align.get(o);
      if (a) {
        wq.multiplyQuaternions(G[S[MAP[o.name][0]]], a).multiply(restWorldQ.get(o));
      } else {
        const pw = o.parent && W.get(o.parent);
        wq.copy(pw ?? new THREE.Quaternion()).multiply(o.quaternion);
      }
      W.set(o, wq.clone());
    }
    // collo e testa (neck_01, neck_02, head: come SOMA, Neck1, Neck2, Head):
    // ogni osso tiene la rotazione che dice SOMA rispetto al suo riposo, ma
    // sommata alla posa dritta di Idle_A (collo 29, testa -24 gradi) e con lo
    // scarto ridotto: le clip Kimodo muovono molto la testa e il collo, quello
    // del manichino e' rigido (vedi NECK_STIFF)
    if (refQ.has('neck_01') && refQ.has('head')) {
      const orig = new Map(NECK_CHAIN.map((n) => [n, W.get(bones.get(n)).clone()]));
      let parentW = W.get(bones.get('spine_03')).clone();
      let parentOrig = parentW.clone();
      const e = new THREE.Euler();
      for (const name of NECK_CHAIN) {
        const o = bones.get(name);
        const kk = NECK_STIFF[name];
        const R = parentOrig.clone().invert().multiply(orig.get(name)); // locale voluta da SOMA
        const devRaw = o.quaternion.clone().invert().multiply(R); // scarto dal riposo del rig
        e.setFromQuaternion(devRaw, 'YXZ');
        const dev = new THREE.Quaternion().setFromEuler(new THREE.Euler(e.x * kk.pitch, e.y * kk.yaw, e.z * kk.roll, 'YXZ'));
        const local = (refQ.get(name) ?? new THREE.Quaternion()).clone().multiply(dev);
        if (name === 'head') local.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), HEAD_PITCH_BIAS));
        const newW = parentW.clone().multiply(local);
        W.set(o, newW);
        parentOrig = orig.get(name);
        parentW = newW;
      }
    }
    // IK dei quattro arti sulle proporzioni (vedi LIMBS)
    if (IK_ENABLED) {
      // posizione del bacino nel mondo (come piu' sotto) e posizioni delle ossa
      const hipsW = new THREE.Vector3().fromArray(rootPos, t * 3);
      if (opts.inPlace || yawS) hipsW.set(hipsW.x - traj[t * 2], hipsW.y, hipsW.z - traj[t * 2 + 1]);
      if (yawS) {
        v.set(hipsW.x, 0, hipsW.z).applyQuaternion(C);
        hipsW.set(v.x, hipsW.y, v.z);
      }
      const pelW = sHipsToHipMid
        .clone()
        .applyQuaternion(G[0])
        .add(hipsW)
        .multiplyScalar(K)
        .sub(pelvisToHipMid.clone().applyQuaternion(W.get(pelvis).clone().multiply(restWorldQ.get(pelvis).clone().invert())));
      const pos = new Map();
      for (const o of order) {
        if (o === pelvis) pos.set(o, pelW.clone());
        else {
          const pp = pos.get(o.parent);
          if (pp) pos.set(o, pp.clone().add(o.position.clone().applyQuaternion(W.get(o.parent))));
        }
      }
      // posizioni SOMA rispetto al bacino, nello stesso sistema (G include la direzione tolta)
      const Ps = Array.from({ length: 30 }, () => new THREE.Vector3());
      for (let j = 1; j < 30; j++) Ps[j].copy(Ps[SOMA_PARENTS[j]]).add(new THREE.Vector3().fromArray(SOMA_OFFSETS[j]).applyQuaternion(G[SOMA_PARENTS[j]]));
      for (const L of LIMBS) {
        const A = pos.get(L.bUp);
        const B = pos.get(L.bMid);
        const Cc = pos.get(L.bEnd);
        if (!A || !B || !Cc) continue;
        const target = A.clone().add(Ps[S[L.s[2]]].clone().sub(Ps[S[L.s[0]]]).multiplyScalar(L.ks));
        // piano di piegatura: la componente di (B - A) perpendicolare ad A->C
        const ac = Cc.clone().sub(A);
        const acLen = ac.length();
        const uAC = ac.clone().divideScalar(Math.max(acLen, 1e-6));
        const bend = B.clone().sub(A);
        bend.addScaledVector(uAC, -bend.dot(uAC));
        if (bend.length() > 0.004) L.pole = bend.normalize();
        if (!L.pole) continue;
        const at = target.clone().sub(A);
        const d = Math.min(Math.max(at.length(), Math.abs(L.l1 - L.l2) + 1e-3), L.l1 + L.l2 - 1e-3);
        const u = at.normalize();
        const p = L.pole.clone().addScaledVector(u, -L.pole.dot(u));
        if (p.length() < 1e-4) continue;
        p.normalize();
        const a = (L.l1 * L.l1 - L.l2 * L.l2 + d * d) / (2 * d);
        const h = Math.sqrt(Math.max(0, L.l1 * L.l1 - a * a));
        const Bn = A.clone().addScaledVector(u, a).addScaledVector(p, h);
        const Cn = A.clone().addScaledVector(u, d);
        // osso alto: da A->B a A->Bn
        const Wup = W.get(L.bUp);
        aimBone(Wup, B.clone().sub(A).normalize(), Bn.clone().sub(A).normalize());
        // osso medio: la sua orientazione e' nel mondo (non cambia con quella dell'alto): da B->C a B'->C'
        const midDirOld = Cc.clone().sub(B).normalize();
        aimBone(W.get(L.bMid), midDirOld, Cn.clone().sub(Bn).normalize());
        // il resto della catena (piede, mano, dita) tiene la sua orientazione nel mondo
      }
    }
    // locali
    for (const [b, arr] of tracks) {
      inv.copy(W.get(b.parent) ?? new THREE.Quaternion()).invert();
      L.multiplyQuaternions(inv, W.get(b));
      // continuita' del segno (niente giri di 360 gradi nell'interpolazione)
      if (t > 0) {
        const o = (t - 1) * 4;
        if (L.x * arr[o] + L.y * arr[o + 1] + L.z * arr[o + 2] + L.w * arr[o + 3] < 0) L.set(-L.x, -L.y, -L.z, -L.w);
      }
      L.toArray(arr, t * 4);
    }
    // bacino
    const hips = new THREE.Vector3().fromArray(rootPos, t * 3);
    if (opts.inPlace || yawS) hips.set(hips.x - traj[t * 2], hips.y, hips.z - traj[t * 2 + 1]);
    if (yawS) {
      // l'ondeggiare dei fianchi intorno alla traiettoria, nella direzione del corpo
      v.set(hips.x, 0, hips.z).applyQuaternion(C);
      hips.set(v.x, hips.y, v.z);
    }
    const hipMid = sHipsToHipMid.clone().applyQuaternion(G[0]).add(hips).multiplyScalar(K);
    const pelvisDelta = W.get(pelvis).clone().multiply(restWorldQ.get(pelvis).clone().invert());
    const pw = hipMid.sub(pelvisToHipMid.clone().applyQuaternion(pelvisDelta));
    // nel sistema del genitore (root, che non si anima)
    v.copy(pw).applyMatrix4(pelvis.parent.matrixWorld.clone().invert());
    v.toArray(pelvisPos, t * 3);
  }
  // velocita' media sul terreno (m/s, gia' scalata sul nostro manichino)
  let dist = 0;
  for (let t = 1; t < T; t++) dist += Math.hypot(traj[t * 2] - traj[t * 2 - 2], traj[t * 2 + 1] - traj[t * 2 - 1]);
  const speed = (K_MOVE * dist) / Math.max(1e-6, (T - 1) / FPS);
  let motion;
  if (yawS && !opts.loop) {
    // spostamento e rotazione rispetto al primo fotogramma, nella direzione
    // del corpo all'inizio
    const c0 = Math.cos(-yawS[0]);
    const s0 = Math.sin(-yawS[0]);
    const r3 = (n) => Math.round(n * 1000) / 1000;
    motion = { fps: FPS, x: [], z: [], yaw: [] };
    for (let t = 0; t < T; t++) {
      const dx = traj[t * 2] - traj[0];
      const dz = traj[t * 2 + 1] - traj[1];
      // rotazione intorno a y di -yaw0: x' = x cos + z sin, z' = -x sin + z cos
      motion.x.push(r3(K_MOVE * (dx * c0 + dz * s0)));
      motion.z.push(r3(K_MOVE * (-dx * s0 + dz * c0)));
      motion.yaw.push(r3(yawS[t] - yawS[0]));
    }
  }
  // piedi a terra fermi (si fa prima di appoggiare i piedi al suolo: lavora in relativo)
  if (!opts.loop) cleanFeet(T, tracks, pelvisPos, motion, speed, opts.name);
  groundFeet(T, tracks, pelvisPos);
  if (!opts.loop) blendToIdle(T, tracks, opts.name);
  if (opts.loop) {
    // estremi uguali (il loop si chiude): la stessa correzione sui due lati lascia la cucitura a zero
    const loop = makeLoop(T, tracks, pelvisPos, opts.loop);
    blendToIdle(loop.T, loop.tracks, opts.name);
    return { ...loop, speed };
  }
  return { T, tracks, pelvisPos, speed, motion };
}

// direzione del corpo (yaw del bacino SOMA, + = verso +x cioe' a sinistra)
// per fotogramma, senza salti di 2 pi greco e smussata (resta la torsione
// naturale dei fianchi a ogni passo, si toglie solo il girarsi)
function headingOf(rotXYZW, T) {
  const raw = new Float32Array(T);
  const q = new THREE.Quaternion();
  const f = new THREE.Vector3();
  for (let t = 0; t < T; t++) {
    q.fromArray(rotXYZW, t * 30 * 4).normalize();
    f.set(0, 0, 1).applyQuaternion(q);
    raw[t] = Math.atan2(f.x, f.z);
    if (t > 0) {
      while (raw[t] - raw[t - 1] > Math.PI) raw[t] -= 2 * Math.PI;
      while (raw[t] - raw[t - 1] < -Math.PI) raw[t] += 2 * Math.PI;
    }
  }
  const out = new Float32Array(T);
  const half = 6;
  for (let t = 0; t < T; t++) {
    let a = 0;
    let n = 0;
    for (let k = Math.max(0, t - half); k <= Math.min(T - 1, t + half); k++, n++) a += raw[k];
    out[t] = a / n;
  }
  return out;
}

function smoothTrajectory(rootPos, T, half) {
  const out = new Float32Array(T * 2);
  for (let t = 0; t < T; t++) {
    let x = 0;
    let z = 0;
    let n = 0;
    for (let k = Math.max(0, t - half); k <= Math.min(T - 1, t + half); k++, n++) {
      x += rootPos[k * 3];
      z += rootPos[k * 3 + 2];
    }
    out[t * 2] = x / n;
    out[t * 2 + 1] = z / n;
  }
  return out;
}

// Animazione in loop ("loop": { "minSeconds": 1 }): Kimodo genera clip con
// un inizio e una fine qualsiasi. Si cerca il tratto [i, j] in cui la posa
// alla fine somiglia di piu' a quella all'inizio (anche nei fotogrammi
// vicini, cioe' nella velocita'), lo si ritaglia e negli ultimi BLEND
// fotogrammi si sfuma verso quelli che precedono i: l'ultimo fotogramma
// coincide col primo e il loop non scatta.
const BLEND = 8;
function makeLoop(T, tracks, pelvisPos, loopOpts) {
  const minLen = Math.round((loopOpts.minSeconds ?? 1) * FPS);
  const arrs = [...tracks.values()];
  const pose = (a, b) => {
    let d = 0;
    for (const arr of arrs) {
      const dot =
        arr[a * 4] * arr[b * 4] + arr[a * 4 + 1] * arr[b * 4 + 1] + arr[a * 4 + 2] * arr[b * 4 + 2] + arr[a * 4 + 3] * arr[b * 4 + 3];
      d += 1 - Math.abs(dot);
    }
    for (let c = 0; c < 3; c++) d += 10 * Math.abs(pelvisPos[a * 3 + c] - pelvisPos[b * 3 + c]);
    return d;
  };
  let best = null;
  for (let i = BLEND; i < T - minLen - 1; i++) {
    for (let j = i + minLen; j < T - 1; j++) {
      const d = pose(i - 1, j - 1) + pose(i, j) + pose(i + 1, j + 1);
      if (!best || d < best.d) best = { i, j, d };
    }
  }
  if (!best) throw new Error(`clip troppo corta per un loop di almeno ${minLen / FPS} s`);
  const { i, j } = best;
  const N = j - i + 1;
  const q = new THREE.Quaternion();
  const q2 = new THREE.Quaternion();
  const outTracks = new Map();
  for (const [b, arr] of tracks) {
    const out = new Float32Array(N * 4);
    for (let n = 0; n < N; n++) {
      q.fromArray(arr, (i + n) * 4);
      const k = n - (N - BLEND);
      if (k >= 0) q.slerp(q2.fromArray(arr, (i - BLEND + 1 + k) * 4), (k + 1) / BLEND);
      if (n > 0 && q.dot(q2.fromArray(out, (n - 1) * 4)) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      q.toArray(out, n * 4);
    }
    outTracks.set(b, out);
  }
  const outPos = new Float32Array(N * 3);
  for (let n = 0; n < N; n++) {
    const k = n - (N - BLEND);
    const w = k >= 0 ? (k + 1) / BLEND : 0;
    for (let c = 0; c < 3; c++) {
      const a = pelvisPos[(i + n) * 3 + c];
      const b = k >= 0 ? pelvisPos[(i - BLEND + 1 + k) * 3 + c] : a;
      outPos[n * 3 + c] = a + (b - a) * w;
    }
  }
  console.log(`  loop: fotogrammi ${i}-${j} (${((N - 1) / FPS).toFixed(2)} s), distanza ${best.d.toFixed(3)}`);
  return { T: N, tracks: outTracks, pelvisPos: outPos };
}

// ---------------------------------------------------------------- tutte le clip -> GLB
const dirs = fs.existsSync(SRC) ? fs.readdirSync(SRC).filter((d) => fs.existsSync(path.join(SRC, d, 'local_rotations_xyzw.f32'))) : [];
// elenco delle animazioni (tools/kimodo/animations.json): descrizione e
// opzioni di adattamento (inPlace, loop); clip.json nella cartella vince
const MANIFEST = 'tools/kimodo/animations.json';
const manifest = fs.existsSync(MANIFEST)
  ? Object.fromEntries(JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).animations.map((a) => [a.name, a]))
  : {};
const readF32 = (f) => {
  const b = fs.readFileSync(f);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

const { Document } = await import('@gltf-transform/core');
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('Scene');
const outNodes = new Map();
for (const n of rigNodes) {
  outNodes.set(
    n.getName(),
    doc.createNode(n.getName()).setTranslation(n.getTranslation()).setRotation(n.getRotation()).setScale(n.getScale())
  );
}
for (const n of rigNodes) {
  const p = n.listParents().find((x) => x.propertyType === 'Node');
  if (p) outNodes.get(p.getName()).addChild(outNodes.get(n.getName()));
  else if (n.listParents().some((x) => x.propertyType === 'Scene')) scene.addChild(outNodes.get(n.getName()));
}

const meta = {};
for (const name of dirs.sort()) {
  const dir = path.join(SRC, name);
  const opts = {
    inPlace: true,
    name,
    ...(manifest[name] ?? {}),
    ...(fs.existsSync(path.join(dir, 'clip.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'clip.json'), 'utf8')) : {}),
  };
  const { T, tracks, pelvisPos, speed, motion } = retarget(
    readF32(path.join(dir, 'root_positions.f32')),
    readF32(path.join(dir, 'local_rotations_xyzw.f32')),
    opts
  );
  const times = doc
    .createAccessor()
    .setType('SCALAR')
    .setArray(Float32Array.from({ length: T }, (_, i) => i / FPS))
    .setBuffer(buffer);
  // prefisso: non si scontra con le clip del manichino (nel pannello
  // "Animazione di prova" compaiono tutte insieme)
  const anim = doc.createAnimation(`Kimodo_${name}`);
  const add = (node, pathName, arr, type) => {
    const sampler = doc
      .createAnimationSampler()
      .setInput(times)
      .setOutput(doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer))
      .setInterpolation('LINEAR');
    anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(pathName).setSampler(sampler));
  };
  add(outNodes.get('pelvis'), 'translation', pelvisPos, 'VEC3');
  for (const [b, arr] of tracks) add(outNodes.get(b.name), 'rotation', arr, 'VEC4');
  // dita rilassate (Idle_A), ferme per tutta la clip
  for (const name of FINGER_BONES) {
    const node = outNodes.get(name);
    if (!node) continue;
    const arr = new Float32Array(T * 4);
    const q = refQ.get(name);
    for (let t = 0; t < T; t++) q.toArray(arr, t * 4);
    add(node, 'rotation', arr, 'VEC4');
  }
  const prompt = fs.existsSync(path.join(dir, 'prompt.txt')) ? fs.readFileSync(path.join(dir, 'prompt.txt'), 'utf8').trim() : '';
  const info = { duration: +((T - 1) / FPS).toFixed(3), loop: !!opts.loop, inPlace: !!opts.inPlace, speed: +speed.toFixed(3), prompt };
  anim.setExtras({ ...info, source: 'kimodo soma-rp-v1.1' });
  meta[`Kimodo_${name}`] = motion ? { ...info, motion } : info;
  console.log(
    `${`Kimodo_${name}`.padEnd(32)} ${((T - 1) / FPS).toFixed(1).padStart(5)} s ${opts.loop ? 'loop' : '    '} ${speed.toFixed(2)} m/s  ${prompt}`
  );
}

if (!dirs.length) buffer.dispose(); // niente dati: niente buffer (vuoto non e' valido)
fs.writeFileSync(OUT, await new NodeIO().writeBinary(doc));
fs.mkdirSync(path.dirname(META), { recursive: true });
fs.writeFileSync(META, JSON.stringify(meta, null, 2) + '\n');
console.log(`${dirs.length} clip -> ${OUT}`);
