// Indici semplificati della mesh del manichino per le sagome lontane della
// folla (city/CrowdInstances.tsx): stessi vertici, molti meno triangoli.
// Il gioco usa questi indici sulle pose precalcolate (posizioni diverse,
// stessi vertici), quindi niente da semplificare a runtime.
//
//   node scripts/crowd-lod.mjs        -> src/ts/generated/crowdLod.json
import { NodeIO } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer';
import fs from 'node:fs';

const RATIO = Number(process.argv[2] ?? 0.14); // triangoli tenuti
const doc = await new NodeIO().read('public/soldier-citizen.glb');
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const pos = new Float32Array(prim.getAttribute('POSITION').getArray());
const idx = new Uint32Array(prim.getIndices().getArray());
await MeshoptSimplifier.ready;
const target = Math.floor((idx.length * RATIO) / 3) * 3;
const [out, err] = MeshoptSimplifier.simplify(idx, pos, 3, target, 0.02, ['LockBorder']);
fs.mkdirSync('src/ts/generated', { recursive: true });
fs.writeFileSync(
  'src/ts/generated/crowdLod.json',
  JSON.stringify({ tris: out.length / 3, of: idx.length / 3, error: +err.toFixed(4), index: Array.from(out) })
);
console.log(`triangoli ${idx.length / 3} -> ${out.length / 3} (errore ${err.toFixed(4)})`);
