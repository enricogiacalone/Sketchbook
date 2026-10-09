// Versione Node dell'ambiente condiviso (src/ts/flyBrain/flyEnv.ts): carica i
// file dal disco.
import path from 'node:path';
import fs from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildAssets, type Assets } from '../../src/ts/flyBrain/flyEnv';
import type { BrainVariant } from '../../src/ts/flyBrain/connectomePolicy';
export * from '../../src/ts/flyBrain/flyEnv';

const ab = (p: string) => {
  const b = fs.readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
let rapierReady = false;
export async function loadAssets(variant: BrainVariant = 'real'): Promise<Assets> {
  if (!rapierReady) {
    await RAPIER.init();
    rapierReady = true;
  }
  const pub = path.resolve(import.meta.dirname, '../../public');
  return buildAssets(RAPIER, {
    model: ab(pub + '/soldier-citizen.glb'),
    anims: [ab(pub + '/soldier-citizen-base-animations.glb'), ab(pub + '/soldier-citizen-addon-animations.glb')],
    graphJson: JSON.parse(fs.readFileSync(pub + '/fly-brain/fly-brain.json', 'utf8')),
    edges: ab(pub + '/fly-brain/fly-brain-edges.bin'),
  }, variant);
}
