// Quanto bene le capsule della ragdoll attiva (ACTIVE_RAGDOLL_SEGMENTS)
// coprono la mesh del manichino, nella posa di riposo (a T). Per ogni pezzo:
// - quanta parte della mesh "sua" (vertici il cui osso dominante appartiene
//   al pezzo) sta dentro la sua capsula e dentro una capsula qualunque;
// - di quanto resta scoperta (distanza dalla capsula piu' vicina);
// - quanta parte della superficie della capsula sta fuori dalla mesh, e di
//   quanto (dentro/fuori col numero di avvolgimento: la mesh e' fatta di
//   pezzi separati, non e' chiusa).
// Zone senza pezzo proprio: collo (dentro la testa) e mani.
//
//   node --experimental-strip-types --no-warnings scripts/ragdoll-fit.mjs [--json out.json] [--regions]
//
// Prove senza toccare i dati (stessi campi di RagdollSegment):
//   RAGDOLL_FIT_OVERRIDES='{"Head":{"radius":0.1,"toOffset":[0,0,-0.03]}}' node ...
import { NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';
import fs from 'node:fs';
import { ACTIVE_RAGDOLL_SEGMENTS } from '../src/ts/components/Environment/ragdoll/ragdollData.ts';

const MODEL = process.env.RAGDOLL_FIT_MODEL ?? 'assets-src/models/soldier-citizen.glb';
const DEFAULT_LENGTH_SCALE = 0.92; // come useRagdollActive (seg.lengthScale ?? 0.92)

// ---------------------------------------------------------------- modello
const doc = await new NodeIO().read(MODEL);
const root = doc.getRoot();
const nodeObj = new Map();
const scene = new THREE.Object3D();
for (const n of root.listNodes()) {
  const o = new THREE.Object3D();
  o.name = n.getName();
  o.position.fromArray(n.getTranslation());
  o.quaternion.fromArray(n.getRotation());
  o.scale.fromArray(n.getScale());
  nodeObj.set(n, o);
}
for (const [n, o] of nodeObj) {
  const p = n.listParents().find((x) => x.propertyType === 'Node');
  (p ? nodeObj.get(p) : scene).add(o);
}
scene.updateMatrixWorld(true);
const bone = (name) => {
  for (const o of nodeObj.values()) if (o.name === name) return o;
  return null;
};
const wpos = (name) => bone(name).getWorldPosition(new THREE.Vector3());

// vertici nella posa di riposo (skinning con le matrici di bind) + osso dominante
const meshNode = root.listNodes().find((n) => n.getMesh() && n.getSkin());
const skin = meshNode.getSkin();
const joints = skin.listJoints().map((j) => nodeObj.get(j));
const ibm = skin.getInverseBindMatrices().getArray();
const boneMats = joints.map((j, i) => new THREE.Matrix4().multiplyMatrices(j.matrixWorld, new THREE.Matrix4().fromArray(ibm, i * 16)));
const prim = meshNode.getMesh().listPrimitives()[0];
const P = prim.getAttribute('POSITION');
const J = prim.getAttribute('JOINTS_0');
const W = prim.getAttribute('WEIGHTS_0');
const idx = prim.getIndices().getArray();
const N = P.getCount();
const verts = new Float32Array(N * 3);
const domBone = new Array(N);
{
  const v = new THREE.Vector3();
  const acc = new THREE.Vector3();
  const t = new THREE.Vector3();
  const j = [0, 0, 0, 0];
  const w = [0, 0, 0, 0];
  for (let i = 0; i < N; i++) {
    v.fromArray(P.getElement(i, [0, 0, 0]));
    J.getElement(i, j);
    W.getElement(i, w);
    acc.set(0, 0, 0);
    let best = 0;
    for (let k = 0; k < 4; k++) {
      if (w[k] <= 0) continue;
      acc.addScaledVector(t.copy(v).applyMatrix4(boneMats[j[k]]), w[k]);
      if (w[k] > w[best]) best = k;
    }
    acc.toArray(verts, i * 3);
    domBone[i] = joints[j[best]].name;
  }
}

// ---------------------------------------------------------------- capsule
// come useRagdollActive: parte dall'osso, lungo la direzione verso toBone,
// lunghezza = distanza * lengthScale, halfHeight = lunghezza/2 - raggio
// prove: RAGDOLL_FIT_OVERRIDES='{"Head":{"radius":0.11,"lengthScale":1.9}}'
const OVR = JSON.parse(process.env.RAGDOLL_FIT_OVERRIDES ?? '{}');
const SEGS = ACTIVE_RAGDOLL_SEGMENTS.map((s) => ({ ...s, ...(OVR[s.name] ?? {}) }));
const caps = SEGS.map((seg) => {
  const from = wpos(seg.drivingBone);
  if (seg.fromOffset) from.add(new THREE.Vector3(...seg.fromOffset));
  const to = wpos(seg.toBone);
  if (seg.toOffset) to.add(new THREE.Vector3(...seg.toOffset));
  const dir = to.clone().sub(from);
  const raw = dir.length() || 0.05;
  dir.normalize();
  const length = Math.max(0.05, raw * (seg.lengthScale ?? DEFAULT_LENGTH_SCALE));
  const half = Math.max(0.01, length / 2 - seg.radius);
  const center = from.clone().addScaledVector(dir, length / 2);
  return {
    seg,
    a: center.clone().addScaledVector(dir, -half),
    b: center.clone().addScaledVector(dir, half),
    r: seg.radius,
    center,
    dir,
    half,
    length,
    raw,
  };
});
const segOfDriving = new Map(SEGS.map((s) => [s.drivingBone, s.name]));
// osso -> pezzo: il primo antenato che e' l'osso guida di un pezzo
const segForBone = (name) => {
  for (let o = bone(name); o; o = o.parent) if (segOfDriving.has(o.name)) return segOfDriving.get(o.name);
  return null;
};
// zone che non hanno un pezzo loro (si misura solo se una capsula qualunque
// le copre): le mani (dentro l'avambraccio) e il collo (dentro la testa)
const zoneForBone = (name) => {
  if (name === 'neck_01') return 'collo (osso guida di Head)';
  for (let o = bone(name); o; o = o.parent) {
    if (o.name === 'hand_l') return 'mano_l (nessun pezzo)';
    if (o.name === 'hand_r') return 'mano_r (nessun pezzo)';
    if (segOfDriving.has(o.name)) return null;
  }
  return null;
};

const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();
const distToCapsule = (c, p) => {
  _ab.subVectors(c.b, c.a);
  _ap.subVectors(p, c.a);
  const t = THREE.MathUtils.clamp(_ap.dot(_ab) / Math.max(1e-9, _ab.lengthSq()), 0, 1);
  return _ap.addScaledVector(_ab, -t).length() - c.r; // <0 dentro
};

// ---------------------------------------------------------------- mesh "solida" per dentro/fuori
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
geo.setIndex(Array.from(idx));
// La mesh del manichino e' fatta di pezzi separati (807 spigoli aperti):
// niente test dentro/fuori a raggi. Si usa il numero di avvolgimento
// generalizzato (Jacobson 2013): somma degli angoli solidi dei triangoli
// visti dal punto / 4pi, che regge i buchi. (La normale del vertice piu'
// vicino nelle zone concave -- ascelle, spalle -- dava "fuori" punti
// dentro al corpo.)
const T = idx.length / 3;
const winding = (p) => {
  let w = 0;
  for (let t = 0; t < T; t++) {
    const i0 = idx[t * 3] * 3,
      i1 = idx[t * 3 + 1] * 3,
      i2 = idx[t * 3 + 2] * 3;
    const ax = verts[i0] - p.x,
      ay = verts[i0 + 1] - p.y,
      az = verts[i0 + 2] - p.z;
    const bx = verts[i1] - p.x,
      by = verts[i1 + 1] - p.y,
      bz = verts[i1 + 2] - p.z;
    const cx = verts[i2] - p.x,
      cy = verts[i2 + 1] - p.y,
      cz = verts[i2 + 2] - p.z;
    const la = Math.hypot(ax, ay, az),
      lb = Math.hypot(bx, by, bz),
      lc = Math.hypot(cx, cy, cz);
    const det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    const div = la * lb * lc + (ax * bx + ay * by + az * bz) * lc + (bx * cx + by * cy + bz * cz) * la + (cx * ax + cy * ay + cz * az) * lb;
    w += 2 * Math.atan2(det, div);
  }
  return w / (4 * Math.PI);
};
const _tri = new THREE.Triangle();
const _cp = new THREE.Vector3();
const outsideGap = (p) => {
  if (Math.abs(winding(p)) > 0.5) return 0; // dentro
  let best = Infinity;
  for (let t = 0; t < T; t++) {
    _tri.a.fromArray(verts, idx[t * 3] * 3);
    _tri.b.fromArray(verts, idx[t * 3 + 1] * 3);
    _tri.c.fromArray(verts, idx[t * 3 + 2] * 3);
    _tri.closestPointToPoint(p, _cp);
    best = Math.min(best, _cp.distanceToSquared(p));
  }
  return Math.sqrt(best);
};

// ---------------------------------------------------------------- misure
const pct = (a, b) => (b ? (100 * a) / b : 0);
const quant = (arr, q) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const report = [];
const p = new THREE.Vector3();
for (const c of caps) {
  const name = c.seg.name;
  // vertici suoi
  let n = 0;
  let inOwn = 0;
  let inAny = 0;
  const out = [];
  const outAny = [];
  for (let i = 0; i < N; i++) {
    if (segForBone(domBone[i]) !== name) continue;
    n++;
    p.fromArray(verts, i * 3);
    const d = distToCapsule(c, p);
    if (d <= 0.005) inOwn++;
    else out.push(d);
    const dAny = Math.min(...caps.map((o) => distToCapsule(o, p)));
    if (dAny <= 0.005) inAny++;
    else outAny.push(dAny);
  }
  // superficie della capsula: punti campione fuori dalla mesh
  const samples = [];
  const up = Math.abs(c.dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(c.dir, up).normalize();
  const v = new THREE.Vector3().crossVectors(c.dir, u).normalize();
  for (let k = 0; k <= 6; k++) {
    for (let m = 0; m < 12; m++) {
      const ang = (m / 12) * Math.PI * 2;
      const radial = u.clone().multiplyScalar(Math.cos(ang)).addScaledVector(v, Math.sin(ang));
      if (k === 0 || k === 6) {
        // calotte: mezzo emisfero a 45 gradi
        const s = k === 0 ? -1 : 1;
        const base = k === 0 ? c.a : c.b;
        samples.push(
          base
            .clone()
            .addScaledVector(radial, c.r * Math.SQRT1_2)
            .addScaledVector(c.dir, s * c.r * Math.SQRT1_2)
        );
      } else {
        samples.push(
          c.a
            .clone()
            .lerp(c.b, (k - 0.5) / 5.5)
            .addScaledVector(radial, c.r)
        );
      }
    }
    samples.push(c.a.clone().addScaledVector(c.dir, -c.r), c.b.clone().addScaledVector(c.dir, c.r));
  }
  let outside = 0;
  const gaps = [];
  for (const s of samples) {
    const g = outsideGap(s);
    if (g > 0.01) {
      outside++;
      gaps.push(g);
    }
  }
  report.push({
    name,
    bones: `${c.seg.drivingBone}->${c.seg.toBone}`,
    radius: c.r,
    length: +c.length.toFixed(3),
    boneLen: +c.raw.toFixed(3),
    verts: n,
    meshInOwnPct: +pct(inOwn, n).toFixed(1),
    meshInAnyPct: +pct(inAny, n).toFixed(1),
    meshOutP95: +quant(out, 0.95).toFixed(3),
    meshOutMax: +(out.length ? Math.max(...out) : 0).toFixed(3),
    anyOutP95: +quant(outAny, 0.95).toFixed(3),
    anyOutMax: +(outAny.length ? Math.max(...outAny) : 0).toFixed(3),
    capsOutsideMeshPct: +pct(outside, samples.length).toFixed(1),
    capsGapMax: +(gaps.length ? Math.max(...gaps) : 0).toFixed(3),
    center: c.center.toArray().map((x) => +x.toFixed(3)),
  });
}
// vertici di nessun pezzo (ossa senza pezzo, es. mani se non coperte)
let orphan = 0;
for (let i = 0; i < N; i++) if (!segForBone(domBone[i])) orphan++;
const zones = {};
for (let i = 0; i < N; i++) {
  const z = zoneForBone(domBone[i]);
  if (!z) continue;
  const e = (zones[z] ??= { verts: 0, inAny: 0, out: [] });
  e.verts++;
  p.fromArray(verts, i * 3);
  const d = Math.min(...caps.map((c) => distToCapsule(c, p)));
  if (d <= 0.005) e.inAny++;
  else e.out.push(d);
}

console.table(
  report.map((r) => ({
    pezzo: r.name,
    raggio: r.radius,
    'lungh.': r.length,
    'vert.': r.verts,
    'mesh dentro %': r.meshInOwnPct,
    'dentro qualunque %': r.meshInAnyPct,
    'scoperta p95 m': r.anyOutP95,
    'scoperta max m': r.anyOutMax,
    'capsula fuori %': r.capsOutsideMeshPct,
    'capsula fuori max m': r.capsGapMax,
  }))
);
console.table(
  Object.entries(zones).map(([z, e]) => ({
    zona: z,
    'vert.': e.verts,
    'dentro qualunque %': +pct(e.inAny, e.verts).toFixed(1),
    'sporge p95 m': +quant(e.out, 0.95).toFixed(3),
    'sporge max m': +(e.out.length ? Math.max(...e.out) : 0).toFixed(3),
  }))
);
const box = new THREE.Box3().setFromBufferAttribute(geo.getAttribute('position'));
console.log('vertici senza pezzo:', orphan, '/', N, ' mesh y:', box.min.y.toFixed(3), '..', box.max.y.toFixed(3));
const jsonArg = process.argv.indexOf('--json');
if (jsonArg > 0)
  fs.writeFileSync(
    process.argv[jsonArg + 1],
    JSON.stringify({
      report,
      orphan,
      N,
      meshBox: [box.min.toArray(), box.max.toArray()],
      capsules: caps.map((c) => ({ name: c.seg.name, a: c.a.toArray(), b: c.b.toArray(), r: c.r })),
      boxes: JSON.parse(process.env.RAGDOLL_FIT_BOXES ?? '[]'),
      verts: Array.from(verts),
      index: Array.from(idx),
      domSeg: Array.from({ length: N }, (_, i) => segForBone(domBone[i])),
    })
  );

if (process.argv.includes('--regions')) {
  const groups = {};
  for (let i = 0; i < N; i++) {
    const g = (groups[domBone[i]] ??= new THREE.Box3());
    g.expandByPoint(p.fromArray(verts, i * 3));
  }
  const rows = Object.entries(groups)
    .filter(([n]) => !/index|middle|ring|pinky|thumb/.test(n))
    .map(([n, b]) => ({
      osso: n,
      x: `${b.min.x.toFixed(3)}..${b.max.x.toFixed(3)}`,
      y: `${b.min.y.toFixed(3)}..${b.max.y.toFixed(3)}`,
      z: `${b.min.z.toFixed(3)}..${b.max.z.toFixed(3)}`,
      pos: wpos(n)
        .toArray()
        .map((x) => +x.toFixed(3))
        .join(','),
    }));
  console.table(rows);
}
