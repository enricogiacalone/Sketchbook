import { WebGPURenderer } from 'three/webgpu';

// Renderer WebGPU del gioco: la stessa configurazione per la scena principale
// (App.tsx) e per il laboratorio personaggi (charLab).
export function createGameRenderer(props: any) {
    const canvasElement =
      props.canvas instanceof HTMLCanvasElement
        ? props.canvas
        : props instanceof HTMLCanvasElement
          ? props
          : props.canvas || props.domElement || (props.getState && props.getState().gl?.domElement);

    const renderer = new WebGPURenderer({ canvas: canvasElement, antialias: true }) as any;
    renderer.init().catch((err: any) => {
      console.warn('WebGPU renderer initialization skipped (headless/unsupported environment):', err);
    });
    // drei (useTexture) chiama initTexture subito, anche prima che il backend
    // WebGPU sia pronto: lancia e riempie la console. Prima dell'init non c'e'
    // niente da pre-caricare (la texture parte col primo disegno).
    const origInitTexture = renderer.initTexture?.bind(renderer);
    if (origInitTexture) {
      renderer.initTexture = (t: any) => {
        if (renderer._initialized) origInitTexture(t);
      };
    }
    const origRender = renderer.render.bind(renderer);
    renderer.render = function (scene: any, camera: any) {
      if (this._initialized) {
        origRender(scene, camera);
      }
    };
    return renderer;
}
