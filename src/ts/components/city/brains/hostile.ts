import * as THREE from 'three';
import { useStore } from '../../../store';
import { getTerrainHeight } from '../../Environment/Terrain';
import { getRoadOffset } from '../../Environment/Road';
import { castShot } from '../../Environment/weapons/hitscan';
import { emitShotFx, type ShotSurface } from '../../Environment/weapons/weaponFx';
import { damageFighter, getShootableCollider } from '../../Environment/weapons/shootableRegistry';
import type { PistolModelApi } from '../../Environment/weapons/usePistolModel';
import { RUN_CLIP, timeScaleFor } from '../../Environment/locomotion';
import type { MannequinActor } from '../useMannequinActor';
import { getNav } from '../../../lib/nav';
import { floorLift } from '../../../lib/floors';
import { newPathState, steerTo, vaultDone, type PathState } from './pathFollow';
import { WALK_BASE_SPEED } from '../crowdSim';
import { newVaultRun, stepVaultRun, type VaultRun } from './vaultMove';
import { armedShooters, findCover, type Cover } from './cover';

// Comportamento "ostile" di un personaggio della citta': ti insegue di corsa,
// a tiro si ferma, mira e spara al petto (o, a mani nude, ti picchia); di
// guardia (missioni) sta fermo finche' non ti vede. E' una funzione pura sul
// corpo comune (useMannequinActor): la stessa logica gira sia nel componente
// Enemy (guardie delle missioni, nemici "veri") sia su un passante della
// folla che si arrabbia (CrowdPedestrian), senza smontare e rimontare il corpo.

export const ENEMY_COLOR = '#c62828';
export const ENEMY_MAX_HP = 100;
const RUN_SPEED = 3.8; // m/s
const FIRE_RANGE = 12; // oltre torna a inseguire
const STOP_RANGE = 8; // entro si ferma a sparare
const FIRE_COOLDOWN_S = 1.1;
const SPREAD_RAD = 0.06;
// colpo istantaneo lungo un raggio (hitscan.ts, come il giocatore) con gli
// stessi effetti (WeaponEffects.tsx: tracciante, lampo, scintille, fori);
// danno al giocatore per segmento (la testa fa piu' male)
const SHOT_RANGE = 60;
const SHOT_DAMAGE: Record<string, number> = { Head: 35, Torso: 15, Hips: 12 };
const SHOT_DAMAGE_LIMB = 8;
const SHOT_HIT_SPEED = 2.5;
const SHOT_WORLD_IMPULSE = 0.6;
const GIVE_UP_TIME = 15;
// a mani nude: corre addosso e picchia
const BRAWL_RANGE = 1.15; // m tra i centri: il pugno ci arriva davvero (braccio ~0.7 m)
const BRAWL_STOP = 0.8; // si ferma qui, addosso al bersaglio
const BRAWL_COOLDOWN_S = 0.95;
const BRAWL_DAMAGE = 7;
const BRAWL_CLIPS = ['Punch_Jab', 'Punch_Cross', 'Melee_Hook'];
const GUARD_ALERT_DIST = 18; // m: una guardia ti vede da qui
// percezione (solo dove c'e' una griglia di navigazione, vedi lib/nav.ts): vede in linea d'aria
// libera entro SIGHT_DIST, sente (anche attraverso i muri) entro HEAR_DIST; senza piu' tracce
// va dove l'ha visto l'ultima volta e poi lo cerca in giro
const SIGHT_DIST = 22;
const HEAR_DIST = 7;
const SEARCH_SPEED = 1.5; // m/s
// altezza del petto del giocatore (manichino) sopra i piedi: dove si mira.
// playerPos e' 0.5 m sopra i piedi (PlayerCombatSoldier.tsx).
const PLAYER_CHEST_HEIGHT = 1.25;
export const PHRASES = ['Fermo!', 'Non scappi!', 'Ti ho visto!', 'Eccolo!', 'Preso!'];

const _muzzle = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _perp = new THREE.Vector3();

export interface HostileGuard {
  alert: { on: boolean };
  facing?: number;
}

export interface HostileState {
  mode: 'guard' | 'chase' | 'shoot' | 'search';
  fireCd: number;
  punchCd: number;
  shootAnim: number;
  giveUp: number;
  gaveUp: boolean;
  entityT: number;
  // cercare: dove l'ha visto/sentito l'ultima volta, da quanto non ha tracce, dove sta andando a guardare
  lastSeen: { x: number; z: number } | null;
  lostT: number;
  searchGoal: { x: number; z: number } | null;
  path: PathState;
  stuckT: number;
  // sta scavalcando un muro (percorso con passaggi a salto, vedi lib/nav.ts)
  vault: VaultRun | null;
  // dietro un muro: si nasconde, si sporge a sparare un paio di colpi e rientra (vedi brains/cover.ts)
  cover: { c: Cover; phase: 'hide' | 'peek'; t: number; shots: number; tx: number; tz: number } | null;
  coverRetryT: number;
}

export const newHostileState = (guarded = false): HostileState => ({
  mode: guarded ? 'guard' : 'chase',
  fireCd: 0.6 + Math.random() * 0.6,
  punchCd: 0.5,
  shootAnim: 0,
  giveUp: 0,
  gaveUp: false,
  entityT: 0,
  lastSeen: null,
  lostT: 0,
  searchGoal: null,
  path: newPathState(),
  stuckT: 0,
  vault: null,
  cover: null,
  coverRetryT: 0,
});

export interface HostileOpts {
  armed: boolean;
  guard?: HostileGuard;
  // non rinuncia mai (cacciatore): senza tracce continua a cercare
  persistent?: boolean;
}

export interface HostileCtx {
  id: string;
  actor: MannequinActor;
  // gruppo che porta il corpo: posizione e orientamento
  g: THREE.Object3D;
  pistol: PistolModelApi;
  world: any;
  rapier: any;
  delta: number;
  // risultato di actor.beginFrame di questo frame
  res: 'hurt' | null;
  say?: (msg: string) => void;
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const groundAt = (x: number, z: number) => getTerrainHeight(x, z) + getRoadOffset(x, z) + floorLift(x, z);


// La copertura di un armato: ritorna se si sta muovendo e se in questo istante puo' sparare.
// Nascosto aspetta un po', poi si sporge (da dove vede il giocatore), spara 1-2 colpi e rientra; ferito rientra subito.
function stepCover(S: HostileState, nav: NonNullable<ReturnType<typeof getNav>>, actor: MannequinActor, pos: THREE.Vector3, pp: number[], sees: boolean, hurt: boolean, delta: number): { moving: boolean; canShoot: boolean } {
  let cv = S.cover;
  S.coverRetryT -= delta;
  if (!cv) {
    if (!sees || S.coverRetryT > 0) return { moving: false, canShoot: true };
    const c = findCover(nav, pos.x, pos.z, pp[0], pp[2]);
    if (!c) {
      S.coverRetryT = 1.5;
      return { moving: false, canShoot: true };
    }
    cv = S.cover = { c, phase: 'hide', t: 0.2, shots: 0, tx: pp[0], tz: pp[2] };
  }
  if (hurt && cv.phase === 'peek') {
    cv.phase = 'hide';
    cv.t = 1 + Math.random();
  }
  const tgt = cv.phase === 'hide' ? { x: cv.c.hx, z: cv.c.hz } : { x: cv.c.px, z: cv.c.pz };
  const d = Math.hypot(tgt.x - pos.x, tgt.z - pos.z);
  let moving = false;
  if (d > 0.25) {
    const step = Math.min(RUN_SPEED * delta, d);
    const m = actor.ragdoll.resolveBodyMovement(((tgt.x - pos.x) / d) * step, ((tgt.z - pos.z) / d) * step, null);
    pos.x += m.x;
    pos.z += m.z;
    moving = true;
    // incastrato: lascia la copertura
    if (Math.hypot(m.x, m.z) < step * 0.2 && (S.stuckT += delta) > 0.8) {
      S.cover = null;
      S.coverRetryT = 1.5;
      S.stuckT = 0;
      return { moving: false, canShoot: true };
    }
    return { moving, canShoot: false };
  }
  if (cv.phase === 'hide') {
    cv.t -= delta;
    if (cv.t <= 0) {
      // il giocatore si e' spostato: la copertura potrebbe non coprire piu'
      if (Math.hypot(pp[0] - cv.tx, pp[2] - cv.tz) > 3 || nav.lineOfSight(cv.c.hx, cv.c.hz, pp[0], pp[2])) {
        const c = findCover(nav, pos.x, pos.z, pp[0], pp[2]);
        if (!c) {
          S.cover = null;
          S.coverRetryT = 1.5;
          return { moving: false, canShoot: true };
        }
        cv.c = c;
        cv.tx = pp[0];
        cv.tz = pp[2];
        return { moving: false, canShoot: false };
      }
      cv.phase = 'peek';
      cv.shots = 0;
      cv.t = 2.5;
    }
    return { moving: false, canShoot: false };
  }
  // sporto: spara finche' ha sparato 1-2 colpi (cv.shots li conta chi spara), poi rientra
  cv.t -= delta;
  if (cv.shots >= 2 || cv.t <= 0 || (cv.shots >= 1 && Math.random() < delta * 0.8)) {
    cv.phase = 'hide';
    cv.t = 0.9 + Math.random() * 1.4;
  }
  return { moving: false, canShoot: sees };
}

// Un passo del comportamento. Va chiamato dopo actor.beginFrame (e solo se il
// personaggio e' in piedi: morto / a terra li gestisce il chiamante).
// Ritorna 'gaveUp' una volta quando smette di inseguire.
//
// Con una griglia di navigazione registrata (lib/nav.ts) il personaggio e'
// "intelligente": vede solo se la linea d'aria e' libera, sente da vicino,
// segue la strada (A*) invece di andare dritto contro un muro, va dove ti ha
// visto l'ultima volta e, se ti perde, ti cerca in giro (e non rinuncia se
// `persistent`). Senza griglia si comporta esattamente come prima.
export function stepHostile(S: HostileState, o: HostileOpts, c: HostileCtx): 'gaveUp' | null {
  const { actor, g, pistol, delta, res } = c;
  const { data } = actor;
  const armed = o.armed;
  pistol.setVisible(armed);
  pistol.update(delta);

  const store = useStore.getState();
  const pp = store.playerPos;
  const pos = data.position;
  if (armed) armedShooters.set(c.id, { x: pos.x, z: pos.z, t: performance.now() });
  if (import.meta.env.DEV) ((window as any).__hostileDebug ??= {})[c.id] = S;
  const dx = pp[0] - pos.x;
  const dz = pp[2] - pos.z;
  const dist = Math.hypot(dx, dz);

  // percezione
  const nav = getNav();
  let sees = true;
  if (nav) {
    sees = dist < SIGHT_DIST && nav.lineOfSight(pos.x, pos.z, pp[0], pp[2]);
    if (sees || dist < HEAR_DIST || res === 'hurt') {
      S.lastSeen = { x: pp[0], z: pp[2] };
      S.lostT = 0;
      S.searchGoal = null;
    } else S.lostT += delta;
  }
  // distanza che conta per decidere se sparare/picchiare: solo se lo vede
  const effDist = sees ? dist : Infinity;

  // di guardia: fermo finche' non scatta l'allarme
  if (S.mode === 'guard') {
    if (o.guard?.alert.on || (sees && dist < GUARD_ALERT_DIST) || res === 'hurt') {
      S.mode = effDist < FIRE_RANGE ? 'shoot' : 'chase';
      if (o.guard) o.guard.alert.on = true;
    } else {
      actor.play('Pistol_Idle', 0.3);
      if (o.guard?.facing !== undefined) g.rotation.y = o.guard.facing;
      g.position.set(pos.x, groundAt(pos.x, pos.z), pos.z);
      data.rotation = g.rotation.y + Math.PI;
      return null;
    }
  }

  if (S.vault) {
    const v = stepVaultRun(S.vault, actor, pos, delta);
    g.rotation.y += wrapAngle(v.yaw - g.rotation.y) * Math.min(1, delta * 12);
    if (v.done) {
      S.vault = null;
      vaultDone(S.path);
      S.path.replanT = 0;
    }
    g.position.set(pos.x, groundAt(pos.x, pos.z) + v.lift, pos.z);
    data.rotation = g.rotation.y + Math.PI;
    return null;
  }

  const stopR = armed ? STOP_RANGE : BRAWL_STOP;
  const fireR = armed ? FIRE_RANGE : 12; // (a mani nude: oltre non lo si insegue piu' di tanto)
  if (S.mode === 'search' && sees) S.mode = 'chase';
  if (S.mode === 'chase' && effDist < stopR) S.mode = 'shoot';
  else if (S.mode === 'shoot' && effDist > (armed ? FIRE_RANGE : BRAWL_RANGE * 1.1)) S.mode = 'chase';
  if (armed && res === 'hurt' && S.mode === 'chase' && effDist < FIRE_RANGE) S.mode = 'shoot';
  // dietro la copertura non lo vede: resta li' invece di tornare a inseguirlo
  if (armed && S.cover && dist < FIRE_RANGE * 1.5) S.mode = 'shoot';
  else if (S.cover) S.cover = null;

  // dove guarda: verso il giocatore se lo vede, altrimenti verso dove va
  let wantYaw: number | null = sees && dist > 0.01 ? Math.atan2(dx, dz) : null;

  if (S.mode === 'chase' || S.mode === 'search') {
    let gx = pp[0];
    let gz = pp[2];
    let speed = RUN_SPEED;
    let clip = RUN_CLIP;
    let ux = 0;
    let uz = 0;
    let walking = false;
    if (nav && !sees) {
      const ls = S.lastSeen;
      if (ls && Math.hypot(ls.x - pos.x, ls.z - pos.z) > 1.6 && S.mode === 'chase') {
        gx = ls.x;
        gz = ls.z;
      } else {
        // niente piu' tracce: lo cerca in giro (il raggio cresce col tempo)
        S.mode = 'search';
        if (!S.searchGoal || Math.hypot(S.searchGoal.x - pos.x, S.searchGoal.z - pos.z) < 1.2) {
          S.searchGoal = nav.randomFreeNear(pos.x, pos.z, 8 + Math.min(40, S.lostT * 1.5));
        }
        if (S.searchGoal) {
          gx = S.searchGoal.x;
          gz = S.searchGoal.z;
        } else {
          gx = pos.x;
          gz = pos.z;
        }
        speed = SEARCH_SPEED;
        clip = 'Walk';
        walking = true;
      }
    }
    if (nav) {
      const st = steerTo(S.path, nav, pos.x, pos.z, gx, gz, delta);
      ux = st.dx;
      uz = st.dz;
      if (st.vault) {
        S.vault = newVaultRun(st.vault, pos.x, pos.z);
        ux = 0;
        uz = 0;
      }
    } else if (dist > 0.01) {
      ux = dx / dist;
      uz = dz / dist;
    }
    if (ux || uz) {
      const step = speed * delta;
      const m = actor.ragdoll.resolveBodyMovement(ux * step, uz * step, null);
      pos.x += m.x;
      pos.z += m.z;
      // incastrato (un altro corpo, un angolo): rifa' il percorso
      if (Math.hypot(m.x, m.z) < step * 0.3) {
        S.stuckT += delta;
        if (S.stuckT > 0.8) {
          S.stuckT = 0;
          S.path.pts = [];
          S.path.replanT = 0;
          // se stava cercando, prova da un'altra parte
          if (S.mode === 'search') S.searchGoal = null;
        }
      } else S.stuckT = 0;
      if (wantYaw === null) wantYaw = Math.atan2(ux, uz);
      if (walking) actor.play(clip, 0.25, true, speed / (WALK_BASE_SPEED[clip] ?? 0.73));
      else actor.play(clip, 0.2, true, timeScaleFor(clip, speed));
    } else actor.play('Idle_A', 0.3);
  } else if (!armed) {
    // a pugni: davanti al giocatore, un colpo ogni tanto
    S.punchCd -= delta;
    if (S.shootAnim > 0) S.shootAnim -= delta;
    else actor.play('Idle_A', 0.2);
    if (S.punchCd <= 0 && dist <= BRAWL_RANGE && store.health > 0) {
      S.punchCd = BRAWL_COOLDOWN_S + Math.random() * 0.4;
      const clip = BRAWL_CLIPS[Math.floor(Math.random() * BRAWL_CLIPS.length)];
      if (actor.hasClip(clip)) {
        actor.play(clip, 0.05, false);
        S.shootAnim = Math.min(0.6, actor.clipDuration(clip));
      }
      _aim.set(dx, 0, dz).normalize();
      _muzzle.set(pp[0], pp[1], pp[2]);
      damageFighter('player', { segment: 'Torso', damage: BRAWL_DAMAGE, dirWorld: _aim, speed: 1.2, pointWorld: _muzzle });
    }
  } else {
    S.fireCd -= delta;
    const cv = nav ? stepCover(S, nav, actor, pos, pp, sees, res === 'hurt', delta) : { moving: false, canShoot: true };
    if (cv.moving) {
      actor.play(RUN_CLIP, 0.15, true, timeScaleFor(RUN_CLIP, RUN_SPEED));
      S.shootAnim = 0;
    } else if (S.shootAnim > 0) S.shootAnim -= delta;
    else actor.play(S.cover && !cv.canShoot ? 'Pistol_Idle' : actor.hasClip('Pistol_Aim_Neutral') ? 'Pistol_Aim_Neutral' : 'Pistol_Idle', 0.2);
    // guarda il giocatore anche da nascosto
    if (S.cover && dist > 0.01) wantYaw = Math.atan2(dx, dz);
    // spara quando ha girato il busto verso il bersaglio
    const facingErr = Math.abs(wrapAngle(Math.atan2(dx, dz) - g.rotation.y));
    // non si spara a un giocatore gia' a terra
    const playerDown = store.health <= 0;
    if (S.fireCd <= 0 && cv.canShoot && !cv.moving && facingErr < 0.35 && dist <= FIRE_RANGE && !playerDown) {
      S.fireCd = FIRE_COOLDOWN_S + Math.random() * 0.5;
      if (S.cover) S.cover.shots++;
      pistol.getMuzzleWorld(_muzzle);
      const onFoot = store.currentControllable === 'player';
      const targetY = onFoot ? pp[1] - 0.5 + PLAYER_CHEST_HEIGHT : pp[1];
      _aim.set(pp[0], targetY, pp[2]).sub(_muzzle).normalize();
      // un po' di dispersione
      _perp.set(-_aim.z, 0, _aim.x).normalize();
      _aim.addScaledVector(_perp, (Math.random() * 2 - 1) * SPREAD_RAD);
      _aim.y += (Math.random() * 2 - 1) * SPREAD_RAD;
      _aim.normalize();
      // (i propri collider non contano: castShot esclude chi spara)
      const hit = castShot(c.world, c.rapier, _muzzle, _aim, SHOT_RANGE, c.id);
      let surface: ShotSurface = 'none';
      let decal = false;
      if (hit.hit && hit.collider) {
        const info = getShootableCollider(hit.collider.handle);
        if (info) {
          surface = 'body';
          damageFighter(info.ownerId, {
            segment: info.segment,
            damage: SHOT_DAMAGE[info.segment] ?? SHOT_DAMAGE_LIMB,
            dirWorld: _aim,
            speed: SHOT_HIT_SPEED,
            pointWorld: hit.point,
          });
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
      // remote=true: e' un effetto da disegnare e basta, non uno sparo del
      // giocatore da mandare agli altri in rete
      emitShotFx({ from: _muzzle, to: hit.point, normal: hit.normal, surface, decal }, true);
      pistol.kick();
      pistol.playShot();
      if (actor.hasClip('Pistol_Shoot')) {
        actor.play('Pistol_Shoot', 0.05, false);
        S.shootAnim = Math.min(0.45, actor.clipDuration('Pistol_Shoot'));
      }
    }
  }

  // si gira (verso il giocatore se lo vede, altrimenti verso dove cammina)
  if (wantYaw !== null) {
    const a = wrapAngle(wantYaw - g.rotation.y);
    g.rotation.y += a * Math.min(1, delta * (S.mode === 'shoot' ? 10 : 6));
  }

  // rinuncia se non riesce a starti a tiro (un cacciatore no)
  if (!o.persistent) {
    if (dist <= fireR) S.giveUp = 0;
    else {
      S.giveUp += delta;
      if (S.giveUp >= GIVE_UP_TIME && !S.gaveUp) {
        S.gaveUp = true;
        return 'gaveUp';
      }
    }
  }

  if (Math.random() < 0.002) c.say?.(PHRASES[Math.floor(Math.random() * PHRASES.length)]);

  const gy = groundAt(pos.x, pos.z);
  g.position.set(pos.x, gy, pos.z);
  // convenzione dei combattenti: avanti = (-sin, -cos)
  data.rotation = g.rotation.y + Math.PI;

  S.entityT -= delta;
  if (S.entityT <= 0) {
    S.entityT = 0.2;
    store.updateEntity(c.id, { type: 'enemy', position: [pos.x, gy + 1, pos.z], rotation: g.rotation.y });
  }
  return null;
}
