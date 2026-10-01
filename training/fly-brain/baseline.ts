// M1: il corpo dinamico che insegue SOLO l'animazione (nessuna rete):
// quanto resta in piedi? Base di confronto per il cervello.
import path from 'node:path';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { loadSkinnedModel, loadClips } from './glb';
import { createFlyBody, jointAnglesFromBones, driveJoints, setBodyFromBones, snapshotBonesAsBodies, observe } from '../../src/ts/flyBrain/flyBody';

await RAPIER.init();
const pub = path.resolve(import.meta.dirname, '../../public');
const m = loadSkinnedModel(pub + '/soldier-citizen.glb');
const clips = [...loadClips(pub + '/soldier-citizen-base-animations.glb'), ...loadClips(pub + '/soldier-citizen-addon-animations.glb')];
const clip = (n: string) => clips.find((c) => c.name === n)!;
const mixer = new THREE.AnimationMixer(m.root);

for (const name of (process.argv[2] ?? 'Idle_A,Walk,LayToIdle').split(',')) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 120;
  world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0).setFriction(1.0));
  mixer.stopAllAction();
  const act = mixer.clipAction(clip(name));
  act.reset().play();
  mixer.setTime(0);
  m.root.updateMatrixWorld(true);
  const fb = createFlyBody(RAPIER, world, m.root, m.bones, clip('Fighting Idle'));
  // riposiziona le ossa sulla clip (createFlyBody ha usato captureBindPose)
  mixer.setTime(0); m.root.updateMatrixWorld(true);
  const prev = snapshotBonesAsBodies(fb);
  mixer.setTime(1 / 30); m.root.updateMatrixWorld(true);
  setBodyFromBones(fb, prev, 1 / 30);
  const tgt = new Float32Array(fb.nAct);
  let t = 1 / 30;
  const log: string[] = [];
  let fellAt = -1;
  for (let step = 0; step < 30 * 6; step++) {
    t += 1 / 30;
    mixer.setTime(t % clip(name).duration); m.root.updateMatrixWorld(true);
    jointAnglesFromBones(fb, tgt);
    driveJoints(fb, tgt, null, 1);
    for (let i = 0; i < 4; i++) world.step();
    const h = fb.bySeg.Hips.body.translation();
    const head = fb.bySeg.Head.body.translation();
    if (fellAt < 0 && head.y < 0.6) fellAt = t;
    if (step % 15 === 0) log.push(`t${t.toFixed(1)} hips(${h.x.toFixed(2)},${h.y.toFixed(2)},${h.z.toFixed(2)}) head.y ${head.y.toFixed(2)}`);
  }
  const refPelvis = new THREE.Vector3(); mixer.setTime(0); m.root.updateMatrixWorld(true); m.bones.pelvis.getWorldPosition(refPelvis);
  const refEnd = new THREE.Vector3(); mixer.setTime(clip(name).duration * 0.999); m.root.updateMatrixWorld(true); m.bones.pelvis.getWorldPosition(refEnd);
  console.log(`== ${name} (${clip(name).duration.toFixed(2)}s) nAct ${fb.nAct} nObs ${fb.nObs}; anim pelvis y start ${refPelvis.y.toFixed(2)} end ${refEnd.y.toFixed(2)}; cade (testa<0.6m) a t=${fellAt < 0 ? 'mai' : fellAt.toFixed(2)}`);
  console.log('   ' + log.join('\n   '));
  world.free();
}
