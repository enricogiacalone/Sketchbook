import * as THREE from 'three';

// Un solo THREE.AudioListener per tutto il gioco (casse dell'arena, pistola,
// ...), agganciato alla camera che si sta usando: con due ascoltatori ognuno
// avrebbe il suo volume master e una posizione propria. Contato per
// riferimento, come acquireDebugGui: resta sulla camera finche' qualcuno lo usa.
let listener: THREE.AudioListener | null = null;
let attachedTo: THREE.Object3D | null = null;
let refs = 0;

export function acquireAudioListener(camera: THREE.Object3D): THREE.AudioListener {
  if (!listener) listener = new THREE.AudioListener();
  if (attachedTo !== camera) {
    attachedTo?.remove(listener);
    camera.add(listener);
    attachedTo = camera;
  }
  refs++;
  return listener;
}

export function releaseAudioListener() {
  refs = Math.max(0, refs - 1);
  if (refs === 0 && listener && attachedTo) {
    attachedTo.remove(listener);
    attachedTo = null;
  }
}
