import * as THREE from 'three';

// Materiale del manichino con la tinta (emissivo) di una squadra: uno per
// colore, condiviso da tutti i personaggi di quel colore. Prima ognuno ne
// clonava uno suo (~85 materiali per una decina di colori): ognuno e' un
// oggetto da preparare per la scheda video (e da compilare la prima volta
// che compare, con scatti quando arrivano rinforzi).
const cache = new Map<string, THREE.Material>();

export function tintedMaterial(base: THREE.Material, color: THREE.ColorRepresentation, intensity = 0.35): THREE.Material {
  const key = `${base.uuid}|${new THREE.Color(color).getHexString()}|${intensity}`;
  let m = cache.get(key);
  if (!m) {
    m = base.clone();
    (m as THREE.MeshStandardMaterial).emissive = new THREE.Color(color);
    (m as THREE.MeshStandardMaterial).emissiveIntensity = intensity;
    cache.set(key, m);
  }
  return m;
}
