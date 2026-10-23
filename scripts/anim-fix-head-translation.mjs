// Dopo l'aggiunta di neck_02 (scripts/rig-add-neck02.mjs) `head` e' figlio di neck_02 e la sua traslazione a riposo
// e' la META' di prima (0.066 invece di 0.132). Le animazioni di base hanno ancora il canale `head.translation` di
// prima (0.1029, in tutte le clip): applicato al nuovo rig sposta la testa piu' su e il collo sembra piu' lungo
// (~+4 cm). Le clip muovono la testa solo con la rotazione: qui si tolgono i canali di traslazione di `head`
// (e di neck_02, se ci fossero) dalle animazioni.
//
//   node scripts/anim-fix-head-translation.mjs
//
// idempotente: se non c'e' niente da togliere non fa niente.
import { NodeIO } from '@gltf-transform/core';

const FILES = [
  ['assets-src/models/soldier-citizen-base-animations.glb', 'public/soldier-citizen-base-animations.glb'],
  ['assets-src/models/soldier-citizen-addon-animations.glb', 'public/soldier-citizen-addon-animations.glb'],
];
const io = new NodeIO();
for (const [src, dst] of FILES) {
  const doc = await io.read(src);
  let removed = 0;
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode();
      if (ch.getTargetPath() === 'translation' && node && (node.getName() === 'head' || node.getName() === 'neck_02')) {
        const sampler = ch.getSampler();
        anim.removeChannel(ch);
        ch.dispose();
        if (sampler && !anim.listChannels().some((c) => c.getSampler() === sampler)) {
          anim.removeSampler(sampler);
          sampler.dispose();
        }
        removed++;
      }
    }
  }
  console.log(src, 'canali tolti:', removed);
  if (removed) {
    await io.write(src, doc);
    await io.write(dst, doc);
  }
}
