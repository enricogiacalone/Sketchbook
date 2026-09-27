import * as THREE from 'three';
import { interactionGroups } from '@react-three/rapier';
import type { World } from '@dimforge/rapier3d-compat';
import { CollisionGroups } from '../../../enums/CollisionGroups';

// ===========================================================================
// "fai una cosa simile" all'Adventure Game Locomotion System (Jakub W, UE5):
// salto, scavalcare, aggrapparsi ai bordi, spostarsi appesi, salire, scale.
//
// Qui c'e' solo la parte "mondo": su cosa ci si puo' arrampicare e le sonde
// (raggi Rapier) che leggono l'ambiente davanti al personaggio. La macchina
// a stati che le usa e' in traversal.ts.
// ===========================================================================

const ALL = Array.from({ length: 16 }, (_, i) => i);

// Geometria arrampicabile: blocca i combattenti (Characters), la colpiscono
// proiettili e ragdoll a terra (Default); il ragdoll VIVO no (niente
// RagdollWorld: la sua cima fa da pavimento e i piedi animati ci stanno
// qualche cm dentro, vedi aliveRagdollGroups). Climbable = trovata dalle sonde.
export const CLIMBABLE_GROUPS = interactionGroups(
  [CollisionGroups.Default, CollisionGroups.Characters, CollisionGroups.Climbable],
  ALL
);
// gruppi della QUERY: trova solo i collider Climbable
const QUERY_GROUPS = interactionGroups([CollisionGroups.Characters], [CollisionGroups.Climbable]);

// --- scale a pioli ----------------------------------------------------------
export interface Ladder {
  id: string;
  // punto al centro del piano dei pioli (x, z) e normale verso chi sale
  x: number;
  z: number;
  nx: number;
  nz: number;
  bottomY: number;
  // quota della piattaforma in cima (dove si scende dalla scala)
  topY: number;
  halfWidth: number;
}
const ladders = new Map<string, Ladder>();
export const registerLadder = (l: Ladder) => ladders.set(l.id, l);
export const unregisterLadder = (id: string) => ladders.delete(id);

// Scala davanti al personaggio: entro `reach` m dal piano dei pioli, dentro
// la sua larghezza, e il personaggio la guarda (o ci va contro).
export function findLadder(x: number, z: number, feetY: number, fwdX: number, fwdZ: number, reach = 0.9): Ladder | null {
  for (const l of ladders.values()) {
    const dx = x - l.x;
    const dz = z - l.z;
    const along = dx * l.nx + dz * l.nz; // distanza davanti al piano
    const lateral = Math.abs(dx * -l.nz + dz * l.nx);
    if (along < -0.1 || along > reach || lateral > l.halfWidth + 0.25) continue;
    if (feetY < l.bottomY - 0.3 || feetY > l.topY - 0.5) continue;
    if (fwdX * -l.nx + fwdZ * -l.nz < 0.3) continue;
    return l;
  }
  return null;
}

// --- sonde ------------------------------------------------------------------
type RapierModule = import('@react-three/rapier').RapierContext['rapier'];

const _o = { x: 0, y: 0, z: 0 };
const _d = { x: 0, y: 0, z: 0 };

function ray(world: World, rapier: RapierModule, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number, normal = false) {
  _o.x = ox; _o.y = oy; _o.z = oz;
  _d.x = dx; _d.y = dy; _d.z = dz;
  const r = new rapier.Ray(_o, _d);
  // solid=false: un raggio che parte DENTRO un blocco ne trova l'uscita,
  // non un finto contatto a distanza 0 (che darebbe un "pavimento" a
  // mezz'aria accanto a un muro)
  const flags = rapier.QueryFilterFlags.EXCLUDE_SENSORS;
  if (normal) {
    const h = world.castRayAndGetNormal(r, len, false, flags, QUERY_GROUPS);
    return h ? { toi: h.timeOfImpact, nx: h.normal.x, ny: h.normal.y, nz: h.normal.z } : null;
  }
  const h = world.castRay(r, len, false, flags, QUERY_GROUPS);
  return h ? { toi: h.timeOfImpact, nx: 0, ny: 1, nz: 0 } : null;
}

// Quota dell'appoggio sotto i piedi: la cima piu' alta di un blocco
// arrampicabile sotto (x, z) -- 5 raggi (centro + 4 a 15 cm, cosi' si resta
// in piedi sul bordo finche' mezzo piede appoggia), mai sotto `baseY` (il
// pavimento/terreno). `fromY`: da dove partono i raggi (sopra i piedi).
export function supportHeight(world: World, rapier: RapierModule, x: number, z: number, fromY: number, baseY: number): number {
  let best = baseY;
  const len = Math.max(0.05, fromY - baseY + 0.05);
  const R = 0.15;
  const pts = [[0, 0], [R, 0], [-R, 0], [0, R], [0, -R]];
  for (const [ox, oz] of pts) {
    const h = ray(world, rapier, x + ox, fromY, z + oz, 0, -1, 0, len, true);
    if (h && h.ny > 0.7) best = Math.max(best, fromY - h.toi);
  }
  return best;
}

export interface LedgeInfo {
  // punto sulla faccia del muro, alla quota della cima
  face: THREE.Vector3;
  // normale orizzontale del muro (verso chi arriva)
  n: THREE.Vector3;
  topY: number;
  height: number; // topY - piedi
  dist: number; // distanza orizzontale dalla faccia
  deep: boolean; // la cima continua per almeno 0.7 m (ci si puo' stare sopra)
  room: boolean; // spazio libero sopra la cima (ci si puo' salire)
}

// Bordo davanti: 1) raggi in avanti a varie altezze trovano la faccia del
// muro (normale ~orizzontale); 2) un raggio dall'alto appena oltre la faccia
// trova la cima; 3) altri due raggi dicono se la cima e' profonda e se
// sopra c'e' spazio. null se davanti non c'e' niente di arrampicabile.
export function probeLedge(
  world: World,
  rapier: RapierModule,
  x: number,
  z: number,
  feetY: number,
  fwdX: number,
  fwdZ: number,
  maxDist = 1.0,
  maxHeight = 2.6
): LedgeInfo | null {
  let best: { toi: number; nx: number; nz: number } | null = null;
  for (const h of [0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1]) {
    if (h > maxHeight) break;
    const hit = ray(world, rapier, x, feetY + h, z, fwdX, 0, fwdZ, maxDist, true);
    if (!hit || Math.abs(hit.ny) > 0.4) continue;
    if (!best || hit.toi < best.toi) best = { toi: hit.toi, nx: hit.nx, nz: hit.nz };
  }
  if (!best) return null;
  const nl = Math.hypot(best.nx, best.nz) || 1;
  const n = new THREE.Vector3(best.nx / nl, 0, best.nz / nl);
  const fx = x + fwdX * best.toi;
  const fz = z + fwdZ * best.toi;
  // cima: raggio verso il basso 12 cm oltre la faccia
  const topFrom = feetY + maxHeight + 0.1;
  const top = ray(world, rapier, fx - n.x * 0.12, topFrom, fz - n.z * 0.12, 0, -1, 0, maxHeight + 0.1, true);
  if (!top || top.ny < 0.7) return null;
  const topY = topFrom - top.toi;
  if (topY < feetY + 0.2) return null;
  // faccia esatta appena sotto la cima (se il muro e' irregolare conta il bordo)
  let dist = best.toi;
  const fine = ray(world, rapier, x, topY - 0.06, z, -n.x, 0, -n.z, maxDist + 0.3, true);
  if (fine && Math.abs(fine.ny) < 0.4) dist = fine.toi;
  const face = new THREE.Vector3(x - n.x * dist, topY, z - n.z * dist);
  const deepHit = ray(world, rapier, face.x - n.x * 0.7, topY + 0.3, face.z - n.z * 0.7, 0, -1, 0, 0.4);
  const deep = !!deepHit && Math.abs(topY + 0.3 - deepHit.toi - topY) < 0.1;
  const up = ray(world, rapier, face.x - n.x * 0.35, topY + 0.05, face.z - n.z * 0.35, 0, 1, 0, 1.7);
  return { face, n, topY, height: topY - feetY, dist, deep, room: !up };
}
