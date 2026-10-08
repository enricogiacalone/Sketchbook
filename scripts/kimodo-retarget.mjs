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
const OUT = 'public/kimodo-animations.glb';
// dati delle clip per il codice del gioco (velocita' delle clip in loop ecc.)
const META = 'src/ts/generated/kimodoClips.json';
const FPS = 30;

// scheletro soma30 (kimodo.cpp src/skeleton.hpp)
const SOMA_NAMES = [
  'Hips',
  'Spine1',
  'Spine2',
  'Chest',
  'Neck1',
  'Neck2',
  'Head',
  'Jaw',
  'LeftEye',
  'RightEye',
  'LeftShoulder',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'LeftHandThumbEnd',
  'LeftHandMiddleEnd',
  'RightShoulder',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'RightHandThumbEnd',
  'RightHandMiddleEnd',
  'LeftLeg',
  'LeftShin',
  'LeftFoot',
  'LeftToeBase',
  'RightLeg',
  'RightShin',
  'RightFoot',
  'RightToeBase',
];
const SOMA_PARENTS = [-1, 0, 1, 2, 3, 4, 5, 6, 6, 6, 3, 10, 11, 12, 13, 13, 3, 16, 17, 18, 19, 19, 0, 22, 23, 24, 0, 26, 27, 28];
const SOMA_OFFSETS = [
  [0.0, 0.988, 0.0],
  [-0.00013727, 0.0500376256, -0.00053726669],
  [-1.86574103e-9, 0.0712530139, -0.000298248546],
  [-5.75188398e-9, 0.0755006305, -0.00815970992],
  [-0.00181676517, 0.263112953, -0.00553348292],
  [-2.85102231e-8, 0.0770939664, 0.0230258546],
  [-4.5975437e-8, 0.0612891595, 0.0195370861],
  [2.63687901e-5, 0.0047559225, 0.0309494062],
  [0.0320638079, 0.0538020513, 0.0758688308],
  [-0.0322244017, 0.05361869, 0.0755823359],
  [0.0162165175, 0.232371641, 0.0511341324],
  [0.149198457, 2.19397873e-8, -0.0550232576],
  [0.287393078, 2.50268389e-9, -2.58787737e-5],
  [0.270939812, -7.06625108e-9, 2.60897248e-5],
  [0.122686267, -0.0322017573, 0.0483306876],
  [0.190119595, -0.00312878387, -0.000339570373],
  [-0.0138011824, 0.231803086, 0.0521415786],
  [-0.150371962, 1.17387901e-7, -0.0554560437],
  [-0.287366393, 1.87628082e-8, -2.59709359e-5],
  [-0.271336198, -1.16767401e-9, 2.61269368e-5],
  [-0.122642483, -0.0321145448, 0.0480403904],
  [-0.190005945, -0.00306615542, -0.0003157343],
  [0.10043214, -0.0843452671, 0.0259565473],
  [-1e-8, -0.432217537, -0.00802912805],
  [1e-8, -0.421550959, -0.0348152298],
  [0.0, -0.0505947206, 0.132315294],
  [-0.10047278, -0.0829525995, 0.0262031695],
  [1e-8, -0.433622059, -0.00805555828],
  [2e-8, -0.421173943, -0.0347839785],
  [-3.42907669e-9, -0.0507960932, 0.132841956],
];
const S = Object.fromEntries(SOMA_NAMES.map((n, i) => [n, i]));

// osso nostro -> [giunto SOMA, figlio nostro per la direzione, figlio SOMA per
// la direzione] (senza figli: nessun allineamento della posa di riposo)
const MAP = {
  pelvis: ['Hips', 'spine_01', 'Spine1'],
  spine_01: ['Spine1', 'spine_02', 'Spine2'],
  spine_02: ['Spine2', 'spine_03', 'Chest'],
  spine_03: ['Chest', 'neck_01', 'Neck1'],
  neck_01: ['Neck1', 'head', 'Head'],
  head: ['Head'],
};
for (const [s, side] of [
  ['l', 'Left'],
  ['r', 'Right'],
]) {
  Object.assign(MAP, {
    [`clavicle_${s}`]: [`${side}Shoulder`, `upperarm_${s}`, `${side}Arm`],
    [`upperarm_${s}`]: [`${side}Arm`, `lowerarm_${s}`, `${side}ForeArm`],
    [`lowerarm_${s}`]: [`${side}ForeArm`, `hand_${s}`, `${side}Hand`],
    [`hand_${s}`]: [`${side}Hand`, `middle_01_${s}`, `${side}HandMiddleEnd`],
    [`thigh_${s}`]: [`${side}Leg`, `calf_${s}`, `${side}Shin`],
    [`calf_${s}`]: [`${side}Shin`, `foot_${s}`, `${side}Foot`],
    [`foot_${s}`]: [`${side}Foot`, `ball_${s}`, `${side}ToeBase`],
    [`ball_${s}`]: [`${side}ToeBase`],
  });
}

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
const NO_ALIGN = new Set(['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head']);
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
  groundFeet(T, tracks, pelvisPos);
  // velocita' media sul terreno (m/s, gia' scalata sul nostro manichino)
  let dist = 0;
  for (let t = 1; t < T; t++) dist += Math.hypot(traj[t * 2] - traj[t * 2 - 2], traj[t * 2 + 1] - traj[t * 2 - 1]);
  const speed = (K * dist) / Math.max(1e-6, (T - 1) / FPS);
  if (opts.loop) return { ...makeLoop(T, tracks, pelvisPos, opts.loop), speed };
  let motion;
  if (yawS) {
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
      motion.x.push(r3(K * (dx * c0 + dz * s0)));
      motion.z.push(r3(K * (-dx * s0 + dz * c0)));
      motion.yaw.push(r3(yawS[t] - yawS[0]));
    }
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
