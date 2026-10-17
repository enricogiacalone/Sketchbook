// Quanto una clip Kimodo generata con vincoli di posa (--start/--end di kmd-generate)
// rispetta le pose date. Confronta le rotazioni locali SOMA (angolo medio e peggiore).
//   node scripts/kimodo-posecheck.mjs DIR_CLIP DIR_POSA:FRAME [primo|ultimo]...
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { SOMA_NAMES } from './lib/skeletons.mjs';

const readF32 = (f) => { const b = fs.readFileSync(f); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const load = (dir) => {
  const rot = readF32(path.join(dir, 'local_rotations_xyzw.f32'));
  const root = readF32(path.join(dir, 'root_positions.f32'));
  return { rot, T: root.length / 3, J: rot.length / (root.length / 3) / 4, root };
};
const quatAt = (c, t, j) => new THREE.Quaternion().fromArray(c.rot, (t * c.J + j) * 4);
const [clipDir, ...targets] = process.argv.slice(2);
const clip = load(clipDir);
const report = (label, t, ref, rt) => {
  const rows = [];
  let sum = 0;
  for (let j = 1; j < clip.J; j++) {
    const a = THREE.MathUtils.radToDeg(quatAt(clip, t, j).angleTo(quatAt(ref, rt, j)));
    rows.push([SOMA_NAMES[j], a]);
    sum += a;
  }
  rows.sort((x, y) => y[1] - x[1]);
  console.log(`${label.padEnd(12)} medio ${(sum / (clip.J - 1)).toFixed(1)}°  peggiori: ${rows.slice(0, 4).map(([n, a]) => `${n} ${a.toFixed(0)}`).join(', ')}`);
};
for (const spec of targets) {
  const m = spec.match(/^(.*?):(\d+)(?::(primo|ultimo))?$/);
  const ref = load(m[1]);
  for (const [lab, t] of [['primo', 0], ['ultimo', clip.T - 1]]) {
    if (m[3] && m[3] !== lab) continue;
    report(lab, t, ref, +m[2]);
  }
}
// movimento nel mezzo: quanto cambia la posa tra il primo fotogramma e gli altri
let maxMove = 0;
for (let t = 0; t < clip.T; t++) {
  let s = 0;
  for (let j = 1; j < clip.J; j++) s += THREE.MathUtils.radToDeg(quatAt(clip, t, j).angleTo(quatAt(clip, 0, j)));
  maxMove = Math.max(maxMove, s / (clip.J - 1));
}
console.log(`escursione massima rispetto al primo fotogramma: ${maxMove.toFixed(1)}° medi (${clip.T} fotogrammi)`);
