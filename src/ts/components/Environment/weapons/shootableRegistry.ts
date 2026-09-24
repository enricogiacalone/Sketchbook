import * as THREE from 'three';

// Chi e' cosa, per i proiettili: ogni collider di un combattente (corpi
// del ragdoll attivo e del layer solid-body) si registra qui col proprio
// proprietario e segmento, cosi' un raggio che colpisce un collider sa
// SUBITO chi ha colpito e dove (testa/busto/braccio...) -- e il raggio di
// chi spara puo' ignorare i propri stessi collider.
export interface ShootableInfo {
  ownerId: string;
  segment: string;
}

const colliders = new Map<number, ShootableInfo>();

export function registerShootableCollider(handle: number, info: ShootableInfo) {
  colliders.set(handle, info);
}

export function unregisterShootableCollider(handle: number) {
  colliders.delete(handle);
}

export function getShootableCollider(handle: number): ShootableInfo | undefined {
  return colliders.get(handle);
}

// Reazione fisica di un combattente colpito (vedi useRagdoll.ts: impulso
// sul corpo del ragdoll attivo nel punto esatto).
export type FighterHitHandler = (segment: string, dirWorld: THREE.Vector3, speed: number, pointWorld: THREE.Vector3) => void;
const hitHandlers = new Map<string, FighterHitHandler>();

export function registerFighterHitHandler(ownerId: string, fn: FighterHitHandler): () => void {
  hitHandlers.set(ownerId, fn);
  return () => {
    if (hitHandlers.get(ownerId) === fn) hitHandlers.delete(ownerId);
  };
}

export function applyFighterHit(ownerId: string, segment: string, dirWorld: THREE.Vector3, speed: number, pointWorld: THREE.Vector3) {
  hitHandlers.get(ownerId)?.(segment, dirWorld, speed, pointWorld);
}
