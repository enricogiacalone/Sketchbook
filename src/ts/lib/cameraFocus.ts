import * as THREE from 'three';

// "la telecamera deve essere sempre agganciata, anche quando sbalza via":
// mentre il personaggio e' a terra (KO o morto) il suo gruppo/radice resta
// dov'era e il corpo vola via in ragdoll -- la telecamera segue invece il
// bacino del ragdoll, pubblicato qui da chi lo comanda.
export const cameraFocus = {
  id: null as string | null, // nome dell'entita' (quello che la telecamera segue)
  pos: new THREE.Vector3(),
};

export function setCameraFocus(id: string, p: THREE.Vector3) {
  cameraFocus.id = id;
  cameraFocus.pos.copy(p);
}

export function clearCameraFocus(id: string) {
  if (cameraFocus.id === id) cameraFocus.id = null;
}
