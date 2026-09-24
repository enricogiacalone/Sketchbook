import * as THREE from 'three';
import type { World, Collider } from '@dimforge/rapier3d-compat';
import { getShootableCollider } from './shootableRegistry';

// Hitscan alla enari-engine (Player.shoot: rayTest "closest hit" dal
// punto di partenza lungo la direzione, il primo oggetto colpito e'
// quello che conta), sul mondo Rapier del gioco. Esclude i sensori
// (hurtbox) e tutti i collider del tiratore stesso.
export interface ShotHit {
  hit: boolean;
  point: THREE.Vector3;
  normal: THREE.Vector3 | null;
  collider: Collider | null;
  distance: number;
}

const EXCLUDE_SENSORS = 8; // QueryFilterFlags.EXCLUDE_SENSORS

export function castShot(
  world: World,
  rapier: any,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDistance: number,
  shooterId: string
): ShotHit {
  const ray = new rapier.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
  const res = world.castRayAndGetNormal(
    ray,
    maxDistance,
    true,
    EXCLUDE_SENSORS,
    undefined,
    undefined,
    undefined,
    (c: Collider) => getShootableCollider(c.handle)?.ownerId !== shooterId
  );
  if (!res) {
    return { hit: false, point: origin.clone().addScaledVector(dir, maxDistance), normal: null, collider: null, distance: maxDistance };
  }
  const toi = (res as any).timeOfImpact ?? (res as any).toi ?? 0;
  return {
    hit: true,
    point: origin.clone().addScaledVector(dir, toi),
    normal: new THREE.Vector3(res.normal.x, res.normal.y, res.normal.z),
    collider: res.collider,
    distance: toi,
  };
}

// Direzione con dispersione casuale dentro un cono (gradi).
export function spreadDirection(dir: THREE.Vector3, coneDeg: number, out: THREE.Vector3): THREE.Vector3 {
  out.copy(dir).normalize();
  if (coneDeg <= 0) return out;
  const maxAngle = THREE.MathUtils.degToRad(coneDeg);
  // distribuzione uniforme sull'area del cono
  const a = Math.acos(1 - Math.random() * (1 - Math.cos(maxAngle)));
  const b = Math.random() * Math.PI * 2;
  const tmp = Math.abs(out.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(out, tmp).normalize();
  const v = new THREE.Vector3().crossVectors(out, u);
  out.multiplyScalar(Math.cos(a)).addScaledVector(u, Math.sin(a) * Math.cos(b)).addScaledVector(v, Math.sin(a) * Math.sin(b));
  return out.normalize();
}
