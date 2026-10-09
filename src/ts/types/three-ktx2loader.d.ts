// Il KTX2Loader di three (non quello di three-stdlib: deve andare d'accordo
// con il convertitore di three in public/basis/). @types/three lo descrive,
// ma con questo tsconfig il percorso non si risolve: qui il minimo che usa
// src/ts/lib/gltf.ts.
declare module 'three/examples/jsm/loaders/KTX2Loader.js' {
  import { Loader, WebGLRenderer } from 'three';
  export class KTX2Loader extends Loader {
    setTranscoderPath(path: string): this;
    detectSupport(renderer: WebGLRenderer): this;
    dispose(): void;
  }
}
