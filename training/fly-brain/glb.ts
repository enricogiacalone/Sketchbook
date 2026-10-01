// Versione Node del parser GLB condiviso (src/ts/flyBrain/glbParse.ts)
import fs from 'node:fs';
import { parseSkinnedModel, parseClips } from '../../src/ts/flyBrain/glbParse';

const ab = (path: string) => {
  const b = fs.readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
export const loadSkinnedModel = (path: string) => parseSkinnedModel(ab(path));
export const loadClips = (path: string) => parseClips(ab(path));
