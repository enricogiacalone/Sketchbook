import * as THREE from 'three';

// Materiali standard condivisi per parametri: ogni edificio vicino ne creava
// una quindicina identici (4 pareti, 5 fasce di base, tetto...), decine di
// oggetti da preparare per la scheda video per niente.
const cache = new Map<string, THREE.MeshStandardMaterial>();

export function stdMat(p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  const key = JSON.stringify(p);
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial(p);
    cache.set(key, m);
  }
  return m;
}
