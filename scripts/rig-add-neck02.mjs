// Aggiunge al manichino (assets-src/models/soldier-citizen.glb -> public/) il
// secondo osso del collo, neck_02, come in SOMA (Neck1, Neck2, Head): le clip
// Kimodo muovono tutti e due, il rig ne aveva uno solo.
//
//   node scripts/rig-add-neck02.mjs
//
// - neck_02 sta a meta' tra neck_01 e head, con rotazione nulla: a riposo e per
//   tutte le animazioni esistenti (che non lo muovono) la posa non cambia di un
//   millimetro, la testa resta dov'e';
// - la pelle: i vertici del collo pesati su neck_01 e head (la zona di
//   passaggio) passano a tre pesi (neck_01, neck_02, head) con una curva di
//   Bernstein; gli altri non cambiano;
// - idempotente: se neck_02 c'e' gia' non fa niente.
import { NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';
import fs from 'node:fs';

const FILE = 'assets-src/models/soldier-citizen.glb';
const PUBLIC = 'public/soldier-citizen.glb';
const io = new NodeIO();
const doc = await io.read(FILE);
const root = doc.getRoot();
const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));
if (byName.has('neck_02')) {
  console.log('neck_02 c\'e\' gia\': niente da fare');
  process.exit(0);
}
const neck = byName.get('neck_01');
const head = byName.get('head');
const skin = root.listSkins()[0];
if (!neck || !head || !skin) throw new Error('neck_01, head o la skin non trovati');

const ht = head.getTranslation();
const half = [ht[0] / 2, ht[1] / 2, ht[2] / 2];
const n2 = doc.createNode('neck_02').setTranslation(half).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
neck.removeChild(head);
neck.addChild(n2);
n2.addChild(head);
head.setTranslation(half);

// giunto nuovo in fondo alla lista (indice = numero di giunti prima)
const joints = skin.listJoints();
const newIndex = joints.length;
skin.addJoint(n2);
const ibmAcc = skin.getInverseBindMatrices();
const old = ibmAcc.getArray();
const world = new THREE.Matrix4().fromArray(n2.getWorldMatrix());
const inv = world.clone().invert();
const merged = new Float32Array(old.length + 16);
merged.set(old);
inv.toArray(merged, old.length);
ibmAcc.setArray(merged);

const idxNeck = joints.findIndex((j) => j.getName() === 'neck_01');
const idxHead = joints.findIndex((j) => j.getName() === 'head');
let changed = 0;
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const J = prim.getAttribute('JOINTS_0');
    const W = prim.getAttribute('WEIGHTS_0');
    if (!J || !W) continue;
    const j = [0, 0, 0, 0];
    const w = [0, 0, 0, 0];
    for (let i = 0; i < J.getCount(); i++) {
      J.getElement(i, j);
      W.getElement(i, w);
      let wn = 0;
      let wh = 0;
      for (let k = 0; k < 4; k++) {
        if (w[k] <= 0) continue;
        if (j[k] === idxNeck) wn += w[k];
        if (j[k] === idxHead) wh += w[k];
      }
      if (wn <= 1e-4 || wh <= 1e-4) continue; // solo la zona di passaggio collo-testa
      const share = wn + wh;
      const t = wh / share;
      const w1 = (1 - t) * (1 - t) * share;
      const w2 = 2 * t * (1 - t) * share;
      const w3 = t * t * share;
      // altri giunti: restano; i tre del collo sostituiscono neck_01/head
      const infl = [];
      for (let k = 0; k < 4; k++) if (w[k] > 0 && j[k] !== idxNeck && j[k] !== idxHead) infl.push([j[k], w[k]]);
      infl.push([idxNeck, w1], [newIndex, w2], [idxHead, w3]);
      infl.sort((a, b) => b[1] - a[1]);
      const top = infl.slice(0, 4);
      const sum = top.reduce((a, b) => a + b[1], 0);
      const nj = [0, 0, 0, 0];
      const nw = [0, 0, 0, 0];
      top.forEach(([jj, ww], k) => {
        nj[k] = jj;
        nw[k] = ww / sum;
      });
      J.setElement(i, nj);
      W.setElement(i, nw);
      changed++;
    }
  }
}
console.log(`neck_02 aggiunto, giunto ${newIndex}, ${changed} vertici ripesati`);
fs.writeFileSync(FILE, await io.writeBinary(doc));
fs.copyFileSync(FILE, PUBLIC);
console.log(`scritto ${FILE} e ${PUBLIC}`);
