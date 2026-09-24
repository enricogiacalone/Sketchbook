// Il corpo e' adatto a stare in piedi? Centro di massa e appoggio dei piedi
// nella posa di partenza, e quanto regge SENZA cervello.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { loadAssets, FlyEnv } from './env';
import { createFlyBody, setBodyFromBones, lowestPoint } from '../../src/ts/flyBrain/flyBody';
import { initialParams } from '../../src/ts/flyBrain/connectomePolicy';
const A = await loadAssets();
const mixer = new THREE.AnimationMixer(A.model.root);
mixer.clipAction(A.clips['Idle_A']).play(); mixer.setTime(0); A.model.root.updateMatrixWorld(true);
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const fb = createFlyBody(RAPIER, world, A.model.root, A.model.bones, A.clips['Fighting Idle']);
mixer.setTime(0); A.model.root.updateMatrixWorld(true);
setBodyFromBones(fb, null, 0);
console.log('punto piu basso (y):', lowestPoint(fb).toFixed(3));
for (const side of ['L', 'R']) {
  const c = fb.bySeg['Foot_' + side].body.collider(0);
  const he = (c.shape as any).halfExtents;
  console.log(`piede ${side}: scatola ${(he.x * 2).toFixed(3)} x ${(he.y * 2).toFixed(3)} x ${(he.z * 2).toFixed(3)} m, centro`, Object.values(c.translation()).map((v: any) => v.toFixed(3)).join(','));
}
world.free();
const env = new FlyEnv(A);
const p = initialParams(A.layout);
const up = Array.from({ length: 8 }, (_, i) => env.runEpisode(p, 'stand', 5000 + i, 10).steps / 30);
console.log('senza cervello, in piedi per (s):', up.map((u) => u.toFixed(1)).join(' '));
