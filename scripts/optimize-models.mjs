// Ottimizza i modelli: assets-src/models/*.glb (originali, come escono da
// Blender o da dove li prendiamo) -> public/*.glb (quelli che carica il gioco).
//
//   npm run models            tutti i modelli
//   npm run models -- car     solo quelli il cui nome contiene "car"
//
// Cosa fa, per ogni modello (le eccezioni sono in MODELS qui sotto):
// - texture in KTX2 (Basis UASTC + zstd, con mipmap): restano compresse
//   anche nella memoria della scheda video (4 volte meno di PNG/JPEG/WebP,
//   che la scheda riceve decompressi). Le legge src/ts/lib/gltf.ts con il
//   convertitore in public/basis/ (copiato qui da three a ogni giro).
// - animazioni: tolti i fotogrammi ridondanti (resample).
// - NON tocca i nodi (nomi, gerarchia, origini): il codice cerca porte,
//   rotori, sedili ecc. per nome e li ruota attorno alla loro origine.
//   Per questo niente "optimize" completo di gltf-transform, niente
//   quantizzazione (sposta le origini) e niente unione delle mesh.
//
// Per aggiungere un modello: mettilo in assets-src/models, lancia
// `npm run models` e caricalo nel codice con useGLTF('nome.glb') importato
// da src/ts/lib/gltf.ts (non quello di drei: non legge le texture KTX2).
// Le regole per i singoli modelli sono in MODELS.
//
// Serve (una volta): npm i -D ktx2-encoder
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { resample, prune, dedup, textureCompress } from '@gltf-transform/functions';
import { ktx2 } from 'ktx2-encoder/gltf-transform';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'assets-src/models';
const OUT = 'public';

const MODELS = {
  // il laboratorio della mosca (src/ts/flyBrain/glbParse.ts) legge questo
  // file con un suo parser che vuole dati float32 non compressi; e la
  // texture e' una tavolozza di colori: la compressione a blocchi la
  // sporcherebbe (colori vicini mescolati)
  'soldier-citizen.glb': { copy: true },
  // dei file di animazioni il gioco usa solo le clip
  'soldier-citizen-base-animations.glb': { animOnly: true },
  'soldier-citizen-addon-animations.glb': { animOnly: true },
  // 4 texture 2048 per un drone che in gioco e' piccolo
  'drone.glb': { maxTexture: 1024 },
  // due texture 1024 (roccia) su una pistola in mano al personaggio
  'pistol-usp.glb': { maxTexture: 512 },
};
// opzioni: copy (copia e basta), animOnly (solo clip), maxTexture (lato
// massimo delle texture), encoding ('uastc' predefinito, oppure 'etc1s')

// tracce costanti uguali alla posa di riposo del modello: inutili (il mixer
// di three tiene l'osso alla posa di riposo dove una clip non ha la traccia).
// Bacino e radice restano sempre: il codice le legge per nome.
const ANIM_RIG = 'soldier-citizen.glb';
const ANIM_KEEP_BONES = new Set(['root', 'pelvis']);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

const imageDecoder = async (buffer) => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};

// texture che la compressione a blocchi (4x4) non regge bene: troppo
// piccole o con lati non multipli di 4
// texture che la compressione a blocchi (4x4) non regge bene: troppo
// piccole o con lati non multipli di 4. Restano come sono.
const compressible = (t) => {
  const size = t.getSize();
  return !!size && size[0] >= 64 && size[1] >= 64 && size[0] % 4 === 0 && size[1] % 4 === 0;
};

// UASTC: qualita' alta (in memoria video 1 byte a pixel, contro i 4 di
// PNG/JPEG/WebP decompressi), file un po' piu' grandi di un JPEG.
// ETC1S: file piccolissimi e meta' memoria, ma qualita' piu' bassa (si vede
// sui bordi netti tra colori): per texture grandi poco in vista.
const ENCODINGS = {
  uastc: { isUASTC: true, needSupercompression: true, enableRDO: true, rdoQualityLevel: 1 },
  etc1s: { isUASTC: false, qualityLevel: 255, compressionLevel: 2 },
};

async function compressTextures(doc, opts) {
  if (opts.maxTexture) {
    await doc.transform(textureCompress({ encoder: sharp, resize: [opts.maxTexture, opts.maxTexture], quality: 95, nearLossless: true }));
  }
  // il codificatore filtra per nome (o URI): si marcano quelle da convertire
  const tag = '__ktx2__';
  for (const t of doc.getRoot().listTextures()) if (compressible(t)) t.setName(tag + t.getName());
  const common = { ...ENCODINGS[opts.encoding ?? 'uastc'], generateMipmap: true, imageDecoder, pattern: new RegExp(`^${tag}`) };
  const log = console.log;
  console.log = () => {}; // il codificatore (wasm) stampa ogni passo
  try {
    // colori: sRGB
    await doc.transform(
      ktx2({ ...common, slots: /^(baseColor|emissive|diffuse|specularGlossiness)/, isPerceptual: true, isSetKTX2SRGBTransferFunc: true })
    );
    // normal map
    await doc.transform(ktx2({ ...common, slots: /^normal/, isNormalMap: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false }));
    // il resto (metallo/ruvidita', occlusione...): dati, non colori
    await doc.transform(ktx2({ ...common, isPerceptual: false, isSetKTX2SRGBTransferFunc: false }));
  } finally {
    console.log = log;
  }
  for (const t of doc.getRoot().listTextures()) if (t.getName().startsWith(tag)) t.setName(t.getName().slice(tag.length));
}

let rigRest = null;
async function animOnly(doc) {
  if (!rigRest) {
    const rig = await io.read(path.join(SRC, ANIM_RIG));
    rigRest = new Map(
      rig
        .getRoot()
        .listNodes()
        .map((n) => [n.getName(), { translation: n.getTranslation(), scale: n.getScale() }])
    );
  }
  const root = doc.getRoot();
  let removed = 0;
  for (const anim of root.listAnimations()) {
    for (const ch of anim.listChannels()) {
      const p = ch.getTargetPath();
      const node = ch.getTargetNode();
      if ((p !== 'scale' && p !== 'translation') || !node || ANIM_KEEP_BONES.has(node.getName())) continue;
      const rest = rigRest.get(node.getName())?.[p];
      if (!rest) continue;
      const v = ch.getSampler().getOutput().getArray();
      let constant = true;
      for (let i = 0; i < v.length && constant; i++) if (Math.abs(v[i] - rest[i % 3]) > 1e-5) constant = false;
      if (!constant) continue;
      const s = ch.getSampler();
      ch.dispose();
      if (!s.listParents().some((x) => x.propertyType === 'AnimationChannel')) s.dispose();
      removed++;
    }
  }
  for (const n of root.listNodes()) {
    n.setMesh(null);
    n.setSkin(null);
  }
  for (const x of [...root.listMeshes(), ...root.listSkins(), ...root.listMaterials(), ...root.listTextures()]) x.dispose();
  return removed;
}

const filter = process.argv[2];
const files = fs
  .readdirSync(SRC)
  .filter((f) => f.endsWith('.glb'))
  .filter((f) => !filter || f.includes(filter));
if (!files.length) {
  console.log(`nessun modello in ${SRC}${filter ? ` con "${filter}"` : ''}`);
  process.exit(1);
}

let before = 0;
let after = 0;
for (const file of files) {
  const opts = MODELS[file] ?? {};
  const src = path.join(SRC, file);
  const dst = path.join(OUT, file);
  const srcSize = fs.statSync(src).size;
  let note = '';
  if (opts.copy) {
    fs.copyFileSync(src, dst);
    note = "copiato com'e'";
  } else {
    const doc = await io.read(src);
    doc.setLogger({ debug() {}, info() {}, warn: (m) => console.warn(`  ${file}: ${m}`), error: (m) => console.error(`  ${file}: ${m}`) });
    await doc.transform(resample());
    if (opts.animOnly) note = `${await animOnly(doc)} tracce costanti tolte`;
    else await compressTextures(doc, opts);
    // prune che NON toglie i nodi vuoti (segnaposto cercati per nome)
    await doc.transform(
      prune({ keepLeaves: true, keepAttributes: true, keepIndices: true, keepSolidTextures: true, keepExtras: true }),
      dedup()
    );
    fs.writeFileSync(dst, await io.writeBinary(doc));
  }
  const dstSize = fs.statSync(dst).size;
  before += srcSize;
  after += dstSize;
  console.log(`${file.padEnd(40)} ${kb(srcSize).padStart(9)} -> ${kb(dstSize).padStart(9)}  ${note}`);
}
console.log(`${'totale'.padEnd(40)} ${kb(before).padStart(9)} -> ${kb(after).padStart(9)}`);

// convertitore KTX2 per il browser (src/ts/lib/gltf.ts): deve essere quello
// della stessa versione di three, quindi si ricopia a ogni giro
const BASIS_SRC = 'node_modules/three/examples/jsm/libs/basis';
const BASIS_OUT = path.join(OUT, 'basis');
fs.mkdirSync(BASIS_OUT, { recursive: true });
for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) fs.copyFileSync(path.join(BASIS_SRC, f), path.join(BASIS_OUT, f));
