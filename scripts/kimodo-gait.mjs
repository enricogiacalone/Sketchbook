// Per le clip Kimodo di partenza/fermata (rootMotion): quando il piede
// sinistro appoggia, in secondi. Serve al gioco (lib/motionTrack.ts) per
// agganciare il passo della clip a quello del passo normale (ls.phase: 0 =
// appoggio sinistro). Scrive src/ts/generated/kimodoGait.json.
//   node scripts/kimodo-gait.mjs
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import fs from 'node:fs';
globalThis.self = globalThis;
const load = (p) =>
  new Promise((res, rej) => {
    const b = fs.readFileSync(p);
    new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej);
  });
const P = 'public/';
const model = await load(P + 'soldier-citizen.glb');
const kimodo = await load(P + 'kimodo-animations.glb');
const NAMES = ['walk_start', 'walk_stop', 'run_start', 'run_stop'];
const root = model.scene;
const mixer = new THREE.AnimationMixer(root);
const foot = root.getObjectByName('foot_l');
const out = {};
const v = new THREE.Vector3();
for (const n of NAMES) {
  const clip = kimodo.animations.find((a) => a.name === 'Kimodo_' + n);
  if (!clip) continue;
  mixer.stopAllAction();
  mixer.clipAction(clip).play();
  const FPS = 30;
  const N = Math.round(clip.duration * FPS);
  const ys = [];
  for (let i = 0; i <= N; i++) {
    mixer.setTime(Math.min(clip.duration, i / FPS));
    root.updateMatrixWorld(true);
    foot.getWorldPosition(v);
    ys.push(v.y);
  }
  const ymin = Math.min(...ys);
  const thr = ymin + 0.035;
  // inizio di ogni tratto con il piede a terra (a una pausa lunga conta una volta sola)
  const contacts = [];
  let down = false;
  for (let i = 0; i <= N; i++) {
    const on = ys[i] < thr;
    if (on && !down) contacts.push(+(i / FPS).toFixed(3));
    down = on;
  }
  out['Kimodo_' + n] = { fps: FPS, leftContacts: contacts };
  console.log(n, 'ymin', ymin.toFixed(3), contacts);
}
fs.writeFileSync('src/ts/generated/kimodoGait.json', JSON.stringify(out, null, 1));
