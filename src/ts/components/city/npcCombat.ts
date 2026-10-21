import * as THREE from 'three';
import type { World } from '@dimforge/rapier3d-compat';
import type { FighterData } from '../Environment/SquadArenaTypes';
import { castShot } from '../Environment/weapons/hitscan';
import { emitShotFx, type ShotSurface } from '../Environment/weapons/weaponFx';
import { applyFighterHit, damageFighter, getShootableCollider } from '../Environment/weapons/shootableRegistry';
import type { PistolModelApi } from '../Environment/weapons/usePistolModel';
import { cityOpponents } from './cityActors';
import { crowdPanic } from './crowdSim';
import type { MannequinActor } from './useMannequinActor';
import { getNav } from '../../lib/nav';
import { newPathState, steerTo, vaultDone, type PathState } from './brains/pathFollow';
import { newVaultRun, stepVaultRun, type VaultRun } from './brains/vaultMove';

// Spari degli NPC armati (poliziotti, alleati): colpo istantaneo come quello
// del giocatore, con gli stessi effetti. Il danno va solo a chi `canHurt`
// ammette (il bersaglio voluto): chi e' solo di passaggio sulla linea di tiro
// ferma il proiettile ma non si fa male, cosi' una sparatoria non trasforma
// mezza folla in nemici.

export const PLAYER_ID = 'player';

// alleati vivi (AllyNpc.tsx): i loro dati non sono tra gli avversari del
// giocatore (niente aggancio della mira, niente fuoco amico)
export interface AllyInfo {
  id: string;
  data: FighterData;
  // fino a quando (s) sta combattendo contro la polizia: i poliziotti lo considerano una minaccia
  hostileUntil: number;
}
export const allyRegistry = new Map<string, AllyInfo>();

export function findFighter(id: string): FighterData | null {
  const a = allyRegistry.get(id);
  if (a) return a.data;
  return cityOpponents.find((o) => o.id === id) ?? null;
}

const SHOT_RANGE = 60;
const SHOT_HIT_SPEED = 2.5;
const SHOT_WORLD_IMPULSE = 0.6;
const HEAD_MULT = 2.2;

const _aim = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _muzzle = new THREE.Vector3();

export interface NpcShotOpts {
  world: World;
  rapier: any;
  pistol: PistolModelApi;
  shooterId: string;
  // dove mira (petto del bersaglio)
  target: THREE.Vector3;
  spread: number;
  // danno al busto; la testa fa di piu'
  damage: number;
  canHurt: (ownerId: string) => boolean;
  // chi ha fatto il colpo ha ucciso/ferito qualcuno: per i crimini
  onHurt?: (target: FighterData, killed: boolean) => void;
}

export function npcFire(o: NpcShotOpts) {
  o.pistol.getMuzzleWorld(_muzzle);
  // gli spari mettono in fuga la folla
  crowdPanic(_muzzle.x, _muzzle.z);
  _aim.copy(o.target).sub(_muzzle).normalize();
  _perp.set(-_aim.z, 0, _aim.x).normalize();
  _aim.addScaledVector(_perp, (Math.random() * 2 - 1) * o.spread);
  _aim.y += (Math.random() * 2 - 1) * o.spread;
  _aim.normalize();
  const hit = castShot(o.world, o.rapier, _muzzle, _aim, SHOT_RANGE, o.shooterId);
  let surface: ShotSurface = 'none';
  let decal = false;
  if (hit.hit && hit.collider) {
    const info = getShootableCollider(hit.collider.handle);
    if (info) {
      surface = 'body';
      if (o.canHurt(info.ownerId)) {
        const dmg = info.segment === 'Head' ? o.damage * HEAD_MULT : info.segment === 'Torso' || info.segment === 'Hips' ? o.damage : o.damage * 0.55;
        if (info.ownerId === PLAYER_ID) {
          damageFighter(PLAYER_ID, { segment: info.segment, damage: dmg, dirWorld: _aim, speed: SHOT_HIT_SPEED, pointWorld: hit.point });
        } else {
          const t = findFighter(info.ownerId);
          if (t && !t.isDead) {
            t.hp -= dmg;
            let killed = false;
            if (t.hp <= 0) {
              t.hp = 0;
              t.isDead = true;
              t.attackLock = 0;
              killed = true;
            } else {
              t.triggerHit = info.segment === 'Head' ? 'Hit_Head' : 'Hit_Chest';
              t.hitReactionHandled = true;
              t.hitFromX = _muzzle.x;
              t.hitFromZ = _muzzle.z;
            }
            applyFighterHit(info.ownerId, info.segment, _aim, SHOT_HIT_SPEED, hit.point);
            o.onHurt?.(t, killed);
          }
        }
      }
    } else {
      surface = 'world';
      const body = hit.collider.parent();
      if (body && body.isDynamic()) {
        body.applyImpulseAtPoint(
          { x: _aim.x * SHOT_WORLD_IMPULSE, y: _aim.y * SHOT_WORLD_IMPULSE, z: _aim.z * SHOT_WORLD_IMPULSE },
          { x: hit.point.x, y: hit.point.y, z: hit.point.z },
          true
        );
      } else decal = true;
    }
  }
  // remote=true: solo effetti (tracciante, lampo, scintille), non uno sparo
  // del giocatore da mandare agli altri in rete
  emitShotFx({ from: _muzzle, to: hit.point, normal: hit.normal, surface, decal }, true);
  o.pistol.kick();
  o.pistol.playShot();
}

// c'e' una linea libera tra l'occhio di `from` e il punto `to`? (muri, auto, ...)
const _eye = new THREE.Vector3();
const _look = new THREE.Vector3();
export function hasLineOfSight(world: World, rapier: any, fromX: number, fromY: number, fromZ: number, to: THREE.Vector3, shooterId: string, slack = 2.5) {
  _eye.set(fromX, fromY, fromZ);
  _look.copy(to).sub(_eye);
  const d = _look.length();
  if (d < 0.5) return true;
  _look.divideScalar(d);
  const hit = castShot(world, rapier, _eye, _look, d, shooterId);
  if (!hit.hit) return true;
  if (hit.collider && getShootableCollider(hit.collider.handle)?.ownerId === PLAYER_ID) return true;
  return hit.distance > d - slack;
}

// Un passo verso (gx, gz) con la fisica del corpo; se resta incastrato
// contro un muro gira un po' di lato per aggirarlo. Ritorna la direzione di
// marcia (yaw) o null se e' arrivato.
//
// Dove c'e' una griglia di navigazione (lib/nav.ts: il laboratorio) segue il percorso A* e scavalca i muri come i
// cacciatori (brains/vaultMove.ts); `lift` e' di quanto e' sollevato sopra il piano (lo scavalco): il chiamante lo somma
// alla quota (terreno + strada + lib/floors.ts).
export interface StepState {
  steer: number;
  steerT: number;
  stuckT: number;
  path: PathState;
  vault: VaultRun | null;
  lift: number;
}
export const newStepState = (): StepState => ({ steer: 0, steerT: 0, stuckT: 0, path: newPathState(), vault: null, lift: 0 });

export function stepToward(
  actor: MannequinActor,
  pos: THREE.Vector3,
  st: StepState,
  gx: number,
  gz: number,
  speed: number,
  delta: number,
  sepX = 0,
  sepZ = 0
): number | null {
  st.lift = 0;
  if (st.vault) {
    const v = stepVaultRun(st.vault, actor, pos, delta);
    st.lift = v.lift;
    if (v.done) {
      st.vault = null;
      vaultDone(st.path);
      st.path.replanT = 0;
    }
    return v.yaw;
  }
  let dx = gx - pos.x;
  let dz = gz - pos.z;
  let d = Math.hypot(dx, dz);
  if (d < 0.05) return null;
  const nav = getNav();
  if (nav) {
    const sg = steerTo(st.path, nav, pos.x, pos.z, gx, gz, delta);
    if (sg.vault) {
      st.vault = newVaultRun(sg.vault, pos.x, pos.z);
      return Math.atan2(sg.vault.bx - sg.vault.ax, sg.vault.bz - sg.vault.az);
    }
    if (!sg.dx && !sg.dz) return null;
    // la strada: stessa distanza, direzione del percorso
    dx = sg.dx * d;
    dz = sg.dz * d;
    d = Math.max(d, 0.05);
  }
  dx = dx / d + sepX;
  dz = dz / d + sepZ;
  let ang = Math.atan2(dx, dz);
  if (st.steerT > 0) {
    st.steerT -= delta;
    ang += st.steer;
    if (st.steerT <= 0) st.steer = 0;
  }
  const step = Math.min(speed * delta, d);
  const c = actor.ragdoll.resolveBodyMovement(Math.sin(ang) * step, Math.cos(ang) * step, null);
  pos.x += c.x;
  pos.z += c.z;
  if (Math.hypot(c.x, c.z) < step * 0.25) {
    st.stuckT += delta;
    if (st.stuckT > 0.5) {
      st.stuckT = 0;
      st.steer = (Math.random() < 0.5 ? -1 : 1) * (0.9 + Math.random() * 0.6);
      st.steerT = 1 + Math.random() * 0.8;
    }
  } else st.stuckT = Math.max(0, st.stuckT - delta);
  return ang;
}
