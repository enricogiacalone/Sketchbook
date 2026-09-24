// La statua: posa fissa (Idle_A t=0), motori che la tengono, niente cervello.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { loadAssets } from './env';
import { createFlyBody, setBodyFromBones, lowestPoint, liftBody, jointAnglesFromBones, jointAnglesFromBodies, driveJoints } from '../../src/ts/flyBrain/flyBody';
const A = await loadAssets();
const clipName = process.argv[2] ?? 'Idle_A';
const mixer = new THREE.AnimationMixer(A.model.root);
mixer.clipAction(A.clips[clipName]).play(); mixer.setTime(0); A.model.root.updateMatrixWorld(true);
const world = new RAPIER.World({ x: 0, y: process.env.NOGRAV ? 0 : -9.81, z: 0 });
world.timestep = 1 / 120;
if (process.env.ITER) (world as any).numSolverIterations = +process.env.ITER;
const STIFF = +(process.env.STIFF ?? 1);
world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0).setFriction(1));
const fb = createFlyBody(RAPIER, world, A.model.root, A.model.bones, A.clips['Fighting Idle']);
mixer.setTime(0); A.model.root.updateMatrixWorld(true);
setBodyFromBones(fb, null, 0);
world.propagateModifiedBodyPositionsToColliders();
liftBody(fb, 0.002 - lowestPoint(fb));
if (process.env.PIN) fb.segs[0].body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
const tgt = new Float32Array(fb.nAct), cur = new Float32Array(fb.nAct);
jointAnglesFromBones(fb, tgt);
for (let i = 0; i <= 360; i++) {
  driveJoints(fb, tgt, null, STIFF);
  world.step();
  if (i % 30 === 0) {
    let M = 0; const com = new THREE.Vector3();
    for (const s of fb.segs) { const t = s.body.translation(); com.add(new THREE.Vector3(t.x, t.y, t.z).multiplyScalar(s.mass)); M += s.mass; }
    com.divideScalar(M);
    jointAnglesFromBodies(fb, cur);
    let err = 0; for (let k = 0; k < cur.length; k++) err = Math.max(err, Math.abs(cur[k] - tgt[k]));
    const h = fb.segs[0].body.translation(), hd = fb.bySeg.Head.body.translation();
    const fl = fb.bySeg.Foot_L.body.translation(), fr = fb.bySeg.Foot_R.body.translation();
    if (process.env.DETAIL && (i === 30 || i === 60)) { const segs = fb.segs.filter((q) => q.parent >= 0); const worst = segs.map((q, j) => [q.seg.name, [0,1,2].map((a) => ((cur[3*j+a] - tgt[3*j+a]) * 57.3).toFixed(0)).join('/'), [0,1,2].map((a) => (tgt[3*j+a] * 57.3).toFixed(0)).join('/')]); console.log(worst.map((w) => w.join(' ')).join(' | ')); }
    console.log(`t ${(i / 120).toFixed(2)} hips y ${h.y.toFixed(3)} head y ${hd.y.toFixed(3)} CdM (${com.x.toFixed(3)},${com.z.toFixed(3)}) piedi L(${fl.x.toFixed(2)},${fl.z.toFixed(2)}) R(${fr.x.toFixed(2)},${fr.z.toFixed(2)}) errore max giunto ${(err * 57.3).toFixed(1)} gradi`);
  }
}
