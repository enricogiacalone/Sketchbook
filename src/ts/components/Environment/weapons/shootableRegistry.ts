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

// Danno "dall'esterno" a un combattente: proiettili fisici dei nemici della
// citta' (Bullet.tsx), colpi di un altro giocatore in rete (CityPlayer.tsx).
// Chi possiede il combattente decide cosa farne (vita, reazione, ragdoll).
export type FighterDamageHandler = (hit: {
  segment: string;
  damage: number;
  dirWorld: THREE.Vector3;
  speed: number;
  pointWorld: THREE.Vector3;
}) => void;
const damageHandlers = new Map<string, FighterDamageHandler>();

export function registerFighterDamageHandler(ownerId: string, fn: FighterDamageHandler): () => void {
  damageHandlers.set(ownerId, fn);
  return () => {
    if (damageHandlers.get(ownerId) === fn) damageHandlers.delete(ownerId);
  };
}

export function damageFighter(ownerId: string, hit: Parameters<FighterDamageHandler>[0]): boolean {
  const fn = damageHandlers.get(ownerId);
  if (!fn) return false;
  fn(hit);
  return true;
}

// Collider che i proiettili attraversano (es. il corpo solido "d'ingombro"
// di un giocatore remoto: gli spari devono prendere i suoi segmenti dentro)
const shotTransparent = new Set<number>();
export function setShotTransparent(handle: number, on: boolean) {
  if (on) shotTransparent.add(handle);
  else shotTransparent.delete(handle);
}
export function isShotTransparent(handle: number): boolean {
  return shotTransparent.has(handle);
}
