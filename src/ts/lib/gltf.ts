import { useGLTF as dreiUseGLTF } from '@react-three/drei';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

// useGLTF di drei + texture KTX2 ("io lo imposterei"): i modelli in public/
// escono da scripts/optimize-models.mjs (`npm run models`) con le texture
// in KTX2/Basis, che restano compresse anche nella memoria della scheda
// video. drei di suo non sa leggerle: qui gli si aggiunge il KTX2Loader di
// three, con il convertitore in public/basis/ (copiato da three dallo
// stesso script: deve essere della stessa versione di three).
//
// Si usa come quello di drei (stessa firma), ma va importato da qui in
// TUTTO il gioco: drei tiene i modelli in cache per indirizzo, e un
// modello caricato prima senza KTX2 resterebbe senza texture.

let ktx2Loader: KTX2Loader | null = null;

function getKtx2Loader(): KTX2Loader {
  if (ktx2Loader) return ktx2Loader;
  ktx2Loader = new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`);
  // detectSupport vuole il renderer solo per sapere quali formati compressi
  // regge la scheda video; i modelli pero' si precaricano prima che il
  // Canvas esista: basta un contesto WebGL2 usa e getta (stessa scheda)
  const gl = document.createElement('canvas').getContext('webgl2');
  ktx2Loader.detectSupport({
    extensions: {
      has: (name: string) => !!gl?.getExtension(name),
      get: (name: string) => gl?.getExtension(name),
    },
  } as never);
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return ktx2Loader;
}

const extendLoader = (loader: { setKTX2Loader: (l: KTX2Loader) => unknown }) => {
  loader.setKTX2Loader(getKtx2Loader());
};

type DreiUseGLTF = typeof dreiUseGLTF;
type Path = Parameters<DreiUseGLTF>[0];

export const useGLTF = (<T extends Path>(path: T) => dreiUseGLTF(path, true, true, extendLoader as never)) as unknown as DreiUseGLTF;
useGLTF.preload = (path: Path) => dreiUseGLTF.preload(path, true, true, extendLoader as never);
useGLTF.clear = dreiUseGLTF.clear;
useGLTF.setDecoderPath = dreiUseGLTF.setDecoderPath;
