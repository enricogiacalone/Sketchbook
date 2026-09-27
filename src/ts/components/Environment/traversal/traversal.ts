import * as THREE from 'three';
import type { World } from '@dimforge/rapier3d-compat';
import { probeLedge, supportHeight, findLadder, type LedgeInfo, type Ladder } from './traversalWorld';

// ===========================================================================
// Macchina a stati del movimento "da avventura" del giocatore del duello:
// salto, caduta, scavalcare/salire su un blocco, aggrapparsi a un bordo,
// spostarsi appesi, tirarsi su, scale a pioli.
//
// Tutte le misure vengono dalle clip del rig (lette dai GLB, vedi i numeri
// qui sotto) e le animazioni con spostamento proprio (ClimbUp_1m_RM) sono
// "deformate" (motion warping): la clip in-place da' la posa, la posizione
// del personaggio la decide questa macchina, dall'inizio al bordo VERO
// trovato dalle sonde -- qualunque altezza abbia.
// ===========================================================================

type RapierModule = import('@react-three/rapier').RapierContext['rapier'];

// --- misure prese dalle clip -------------------------------------------------
// Ledge Hang: mani a 2.08 m sopra la radice, 12 cm davanti
const HANG_HANDS_Y = 2.08;
// radice a 16 cm dalla faccia del muro (petto non dentro il muro); le mani
// vanno sul bordo con l'IK
const HANG_OFF = 0.16;
// ClimbUp_1m_RM: la radice sale di 0.94 m e avanza di 1.57 m in 0.625 s
const MANTLE_RISE = 0.94;
const MANTLE_CLIP_S = 0.625;
// Climb Ladder: un piolo (0.36 m) ogni mezzo ciclo (0.6 s) = 0.6 m/s a timeScale 1
const LADDER_CLIP_SPEED = 0.6;
const LADDER_SPEED = 0.85;
// radice a 14 cm dal piano dei pioli (mani/piedi a +0.1 nella clip)
const LADDER_OFF = 0.14;

// --- fisica del salto ----------------------------------------------------------
const GRAVITY = 20; // m/s^2 (piu' della realta': in terza persona 9.8 sembra la Luna)
const JUMP_HEIGHT = 0.75; // m
const JUMP_V = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);
const AIR_CONTROL = 3; // 1/s: quanto in fretta la velocita' in aria segue lo stick
const COYOTE_S = 0.12; // si puo' ancora saltare appena usciti da un bordo
const HARD_LANDING_V = 9; // m/s di caduta oltre cui l'atterraggio piega le gambe
// "l'animazione a mezz'aria quando cado da altezze piu' alte del normale e
// anche l'atterraggio diverso": sotto i piedi piu' di FALL_POSE_MIN m di
// vuoto -> posa di caduta; atterrando da piu' di BIG_FALL m -> atterraggio
// "a tre punti" (mano a terra) da fermi, capriola se si arriva correndo.
const FALL_POSE_MIN = 1.8;
const HARD_FALL = 1.3;
const BIG_FALL = 2.4;
const ROLL_MIN_SPEED = 2.5;
const SHIMMY_SPEED = 0.6;
const MAX_STEP_DOWN = 0.12; // m per frame seguiti senza "cadere" (pendii, gradini)

// --- nomi delle clip (vedi PlayerCombatSoldier: ClimbUp_1m__ip e' la copia
// in-place di ClimbUp_1m_RM, senza la traccia root.position) -------------------
export const TRAV_CLIPS = {
  jumpStart: 'Jump_Start',
  air: 'Jump_air',
  land: 'Jump_Land',
  // posa di caduta: primi 0.29 s di Land_Three_Point (la caduta da cui
  // parte quell'atterraggio) resi in-place, vedi PlayerCombatSoldier
  fall: 'Fall_Air__ip',
  bigLand: 'Land_Three_Point',
  bigLandUp: 'NinjaJump_Land',
  roll: 'Roll',
  hang: 'Ledge Hang',
  pullUp: 'Climb Wall',
  mantle: 'ClimbUp_1m__ip',
  ladder: 'Climb Ladder',
};

export type TravMode = 'ground' | 'air' | 'land' | 'bigLand' | 'roll' | 'mantle' | 'grab' | 'hang' | 'pullUp' | 'ladder';

export interface TravInput {
  forward: boolean;
  backward: boolean;
  jumpPressed: boolean;
  // direzione voluta rispetto alla camera (orizzontale, lunghezza 0 o 1)
  move: THREE.Vector3;
  moveSpeed: number; // velocita' a terra corrente (camminata/corsa)
}

export interface TravCtx {
  world: World;
  rapier: RapierModule;
  dt: number;
  pos: THREE.Vector3; // data.position (x, z usati; y gestita qui)
  rotation: number;
  setRotation: (r: number) => void;
  baseY: (x: number, z: number) => number;
  play: (clip: string, fade: number, loop: boolean, timeScale?: number, startAt?: number) => void;
  resolveMove: (dx: number, dz: number) => void;
  input: TravInput;
  // a terra si puo' iniziare un'azione (niente colpo in corso, non KO...)
  canAct: boolean;
}

export interface TravState {
  mode: TravMode;
  t: number;
  feetY: number;
  vy: number;
  vel: THREE.Vector3; // orizzontale
  lastX: number;
  lastZ: number;
  coyote: number;
  grabCooldown: number;
  // mosse "deformate" (scavalcare, tirarsi su, salto al bordo)
  from: THREE.Vector3;
  to: THREE.Vector3;
  dur: number;
  next: TravMode;
  // bordo corrente (appeso / mentre si sale)
  ledge: LedgeInfo | null;
  ladder: Ladder | null;
  lockLeft: number;
  started: boolean;
  // quota piu' alta raggiunta in aria (altezza della caduta all'atterraggio)
  apexY: number;
  fallPose: boolean;
  upPlayed: boolean;
}

export function newTravState(feetY: number, x: number, z: number): TravState {
  return {
    mode: 'ground', t: 0, feetY, vy: 0, vel: new THREE.Vector3(), lastX: x, lastZ: z,
    coyote: 0, grabCooldown: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), dur: 0,
    next: 'ground', ledge: null, ladder: null, lockLeft: 0, started: false,
    apexY: feetY, fallPose: false, upPlayed: false,
  };
}

// rotazione del personaggio che guarda nella direzione (fx, fz): la sua
// "avanti" nel mondo e' (-sin r, -cos r) (vedi PlayerCombatSoldier)
const facing = (fx: number, fz: number) => Math.atan2(-fx, -fz);
const fwdOf = (r: number) => ({ x: -Math.sin(r), z: -Math.cos(r) });

function enter(s: TravState, mode: TravMode) {
  s.mode = mode;
  s.t = 0;
  s.started = false;
  if (mode === 'air') {
    s.apexY = s.feetY;
    s.fallPose = false;
  }
}

// posizione della radice appesa al bordo
function hangRoot(l: LedgeInfo, out: THREE.Vector3) {
  return out.set(l.face.x + l.n.x * HANG_OFF, l.topY - HANG_HANDS_Y, l.face.z + l.n.z * HANG_OFF);
}

function startMove(s: TravState, ctx: TravCtx, to: THREE.Vector3, dur: number, mode: TravMode, next: TravMode) {
  s.from.set(ctx.pos.x, s.feetY, ctx.pos.z);
  s.to.copy(to);
  s.dur = Math.max(0.05, dur);
  s.next = next;
  s.vy = 0;
  s.vel.set(0, 0, 0);
  enter(s, mode);
}

function startMantle(s: TravState, ctx: TravCtx, l: LedgeInfo) {
  // sopra la cima: 40 cm oltre il bordo (o a meta' se il blocco e' sottile)
  const inset = l.deep ? 0.4 : 0.25;
  const to = new THREE.Vector3(l.face.x - l.n.x * inset, l.topY, l.face.z - l.n.z * inset);
  const dur = MANTLE_CLIP_S * THREE.MathUtils.clamp((l.topY - s.feetY) / MANTLE_RISE, 0.65, 1.3);
  ctx.setRotation(facing(-l.n.x, -l.n.z));
  s.ledge = l;
  startMove(s, ctx, to, dur, 'mantle', 'ground');
  ctx.play(TRAV_CLIPS.mantle, 0.1, false, MANTLE_CLIP_S / dur);
}

function startHangFrom(s: TravState, ctx: TravCtx, l: LedgeInfo, dur: number) {
  ctx.setRotation(facing(-l.n.x, -l.n.z));
  s.ledge = l;
  startMove(s, ctx, hangRoot(l, new THREE.Vector3()), dur, 'grab', 'hang');
}

function startJump(s: TravState, ctx: TravCtx) {
  s.vy = JUMP_V;
  // la velocita' a terra diventa quella del salto
  const m = ctx.input.move;
  if (m.lengthSq() > 0.0001) s.vel.set(m.x * ctx.input.moveSpeed, 0, m.z * ctx.input.moveSpeed);
  s.coyote = 0;
  enter(s, 'air');
  ctx.play(TRAV_CLIPS.jumpStart, 0.08, false, 1.6, 0.22);
}

function tryLadder(s: TravState, ctx: TravCtx, fx: number, fz: number): boolean {
  const l = findLadder(ctx.pos.x, ctx.pos.z, s.feetY, fx, fz);
  if (!l) return false;
  s.ladder = l;
  ctx.setRotation(facing(-l.nx, -l.nz));
  const to = new THREE.Vector3(l.x + l.nx * LADDER_OFF, Math.max(s.feetY, l.bottomY), l.z + l.nz * LADDER_OFF);
  startMove(s, ctx, to, 0.2, 'grab', 'ladder');
  ctx.play(TRAV_CLIPS.ladder, 0.15, true, 0);
  return true;
}

// Salto / azione di contesto (Spazio). true se ha preso il controllo.
function groundAction(s: TravState, ctx: TravCtx): boolean {
  const m = ctx.input.move;
  const f = m.lengthSq() > 0.0001 ? { x: m.x, z: m.z } : fwdOf(ctx.rotation);
  if (tryLadder(s, ctx, f.x, f.z)) return true;
  const l = probeLedge(ctx.world, ctx.rapier, ctx.pos.x, ctx.pos.z, s.feetY, f.x, f.z, 0.9, HANG_HANDS_Y + JUMP_HEIGHT + 0.2);
  if (l && l.room && l.height >= 0.3 && l.height <= 1.35) {
    startMantle(s, ctx, l);
    return true;
  }
  if (l && l.height > 1.35 && l.height <= HANG_HANDS_Y + 0.25) {
    // bordo alla portata delle mani da fermi (1.35-2.3 m): appesi i piedi
    // toccherebbero terra, quindi ci si tira su direttamente
    if (l.room) {
      ctx.setRotation(facing(-l.n.x, -l.n.z));
      s.ledge = l;
      const to = new THREE.Vector3(l.face.x + l.n.x * 0.22, l.topY - MANTLE_RISE, l.face.z + l.n.z * 0.22);
      startMove(s, ctx, to, 0.3 + 0.35 * ((l.height - 1.35) / (HANG_HANDS_Y - 1.35 + 0.25)), 'pullUp', 'mantle');
      ctx.play(TRAV_CLIPS.pullUp, 0.12, false, 1.3);
      return true;
    }
  }
  if (l && l.height > HANG_HANDS_Y + 0.25 && l.height <= HANG_HANDS_Y + JUMP_HEIGHT + 0.1) {
    // salto verso il bordo e presa
    startHangFrom(s, ctx, l, 0.3 + 0.25 * ((l.height - HANG_HANDS_Y) / JUMP_HEIGHT));
    ctx.play(TRAV_CLIPS.jumpStart, 0.08, false, 1.6, 0.22);
    return true;
  }
  startJump(s, ctx);
  return true;
}

// In aria: presa al volo di un bordo all'altezza delle mani, oppure
// scavalcamento se si arriva col bacino all'altezza della cima.
function airGrab(s: TravState, ctx: TravCtx): boolean {
  if (s.grabCooldown > 0 || s.vy > 2) return false;
  const v = s.vel;
  const f = v.lengthSq() > 0.25 ? { x: v.x / v.length(), z: v.z / v.length() } : fwdOf(ctx.rotation);
  if (tryLadder(s, ctx, f.x, f.z)) return true;
  const l = probeLedge(ctx.world, ctx.rapier, ctx.pos.x, ctx.pos.z, s.feetY, f.x, f.z, 0.7, 2.5);
  if (!l) return false;
  if (l.room && l.height >= 0.25 && l.height <= 1.3 && l.dist < 0.55 && s.vy < 0.5) {
    startMantle(s, ctx, l);
    return true;
  }
  if (Math.abs(l.topY - (s.feetY + HANG_HANDS_Y)) < 0.3 && l.dist < 0.6) {
    startHangFrom(s, ctx, l, 0.12);
    return true;
  }
  return false;
}

// Passo della macchina a stati. true = ha il controllo questo frame (il
// resto del personaggio -- colpi, camminata -- non gira).
export function stepTraversal(s: TravState, ctx: TravCtx): boolean {
  const dt = ctx.dt;
  const inp = ctx.input;
  s.t += dt;
  if (s.grabCooldown > 0) s.grabCooldown -= dt;

  switch (s.mode) {
    case 'ground': {
      // velocita' a terra (per il salto in corsa e per la caduta da un bordo)
      if (dt > 1e-4) s.vel.set((ctx.pos.x - s.lastX) / dt, 0, (ctx.pos.z - s.lastZ) / dt);
      s.lastX = ctx.pos.x;
      s.lastZ = ctx.pos.z;
      if (inp.jumpPressed && ctx.canAct) return groundAction(s, ctx);
      return false;
    }

    case 'bigLand': {
      s.lockLeft -= dt;
      // accovacciati con la mano a terra ~0.5 s, poi ci si rialza
      if (!s.upPlayed && s.t > 0.6) {
        s.upPlayed = true;
        ctx.play(TRAV_CLIPS.bigLandUp, 0.25, false, 1.0, 0.3);
      }
      if (s.lockLeft <= 0) {
        enter(s, 'ground');
        return false;
      }
      return true;
    }

    case 'roll': {
      s.lockLeft -= dt;
      ctx.resolveMove(s.vel.x * dt, s.vel.z * dt);
      const k = Math.exp(-1.6 * dt);
      s.vel.x *= k;
      s.vel.z *= k;
      if (s.lockLeft <= 0) {
        enter(s, 'ground');
        return false;
      }
      return true;
    }

    case 'land': {
      s.lockLeft -= dt;
      // un atterraggio morbido si interrompe camminando
      if (s.lockLeft <= 0 || (s.next === 'ground' && inp.move.lengthSq() > 0.0001)) {
        enter(s, 'ground');
        return false;
      }
      return true;
    }

    case 'air': {
      if (s.coyote > 0) {
        s.coyote -= dt;
        if (inp.jumpPressed) {
          startJump(s, ctx);
          return true;
        }
      }
      if (s.t > 0.28 && !s.started) {
        s.started = true;
        if (!s.fallPose) ctx.play(TRAV_CLIPS.air, 0.2, true);
      }
      // controllo in aria
      const m = inp.move;
      if (m.lengthSq() > 0.0001) {
        const sp = Math.max(Math.hypot(s.vel.x, s.vel.z), 1.5);
        const k = Math.min(1, AIR_CONTROL * dt);
        s.vel.x += (m.x * sp - s.vel.x) * k;
        s.vel.z += (m.z * sp - s.vel.z) * k;
      }
      if (s.vel.lengthSq() > 0.25) {
        let d = facing(s.vel.x, s.vel.z) - ctx.rotation;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        ctx.setRotation(ctx.rotation + d * Math.min(1, 8 * dt));
      }
      // "credo gli manchi la spinta in alto": misurato, il salto partiva ma
      // un frame lungo (300 ms, vedi AudioArena) veniva integrato in UN
      // passo -- vy azzerata dalla gravita' in un colpo, 2 cm di salto.
      // Passi da al massimo 1/60 s: la parabola e' la stessa a qualunque
      // frame rate e anche dopo un intoppo.
      const steps = Math.min(12, Math.max(1, Math.ceil(dt * 60)));
      const sdt = dt / steps;
      let landed = false;
      for (let k = 0; k < steps && !landed; k++) {
        const prevFeet = s.feetY;
        s.vy -= GRAVITY * sdt;
        s.feetY += s.vy * sdt;
        if (s.feetY > s.apexY) s.apexY = s.feetY;
        ctx.resolveMove(s.vel.x * sdt, s.vel.z * sdt);
        // atterraggio: appoggio sotto, cercato da dove erano i piedi prima
        if (s.vy <= 0) {
          const base = ctx.baseY(ctx.pos.x, ctx.pos.z);
          const sup = supportHeight(ctx.world, ctx.rapier, ctx.pos.x, ctx.pos.z, Math.max(prevFeet, s.feetY) + 0.3, base);
          if (s.feetY <= sup) {
            s.feetY = sup;
            landed = true;
          }
        }
      }
      if (!landed && airGrab(s, ctx)) return true;
      // caduta lunga: quanto vuoto c'e' sotto? oltre FALL_POSE_MIN, posa di caduta
      if (!landed && !s.fallPose && s.vy < -1) {
        const below = supportHeight(ctx.world, ctx.rapier, ctx.pos.x, ctx.pos.z, s.feetY + 0.1, ctx.baseY(ctx.pos.x, ctx.pos.z));
        if (s.feetY - below > FALL_POSE_MIN) {
          s.fallPose = true;
          s.started = true;
          ctx.play(TRAV_CLIPS.fall, 0.3, true, 0.45);
        }
      }
      if (landed) {
        const impact = -s.vy;
        const fallH = s.apexY - s.feetY;
        const hSpeed = Math.hypot(s.vel.x, s.vel.z);
        s.vy = 0;
        s.lastX = ctx.pos.x;
        s.lastZ = ctx.pos.z;
        if (fallH >= BIG_FALL) {
          if (hSpeed > ROLL_MIN_SPEED) {
            // arrivando di corsa: capriola in avanti che scarica la caduta
            enter(s, 'roll');
            s.lockLeft = 1.0;
            ctx.setRotation(facing(s.vel.x, s.vel.z));
            ctx.play(TRAV_CLIPS.roll, 0.08, false, 1.5, 0.05);
          } else {
            // da fermi: atterraggio a tre punti (mano a terra), poi su
            enter(s, 'bigLand');
            s.lockLeft = 1.15;
            s.upPlayed = false;
            s.vel.set(0, 0, 0);
            ctx.play(TRAV_CLIPS.bigLand, 0.06, false, 1.0, 0.46);
          }
          return true;
        }
        if (impact > HARD_LANDING_V || fallH >= HARD_FALL) {
          enter(s, 'land');
          s.next = 'land';
          s.lockLeft = 0.45;
          ctx.play(TRAV_CLIPS.land, 0.08, false, 1.2, 0.08);
          return true;
        }
        if (inp.move.lengthSq() > 0.0001) {
          enter(s, 'ground');
          return false;
        }
        enter(s, 'land');
        s.next = 'ground';
        s.lockLeft = 0.3;
        ctx.play(TRAV_CLIPS.land, 0.08, false, 1.4, 0.5);
        return true;
      }
      return true;
    }

    case 'mantle':
    case 'grab':
    case 'pullUp': {
      const u = Math.min(1, s.t / s.dur);
      // salita un po' anticipata rispetto all'avanzamento: prima su, poi sopra
      const uy = s.mode === 'grab' ? Math.sin((u * Math.PI) / 2) : u;
      const ux = s.mode === 'mantle' ? u * u * (3 - 2 * u) : u;
      ctx.pos.x = s.from.x + (s.to.x - s.from.x) * ux;
      ctx.pos.z = s.from.z + (s.to.z - s.from.z) * ux;
      s.feetY = s.from.y + (s.to.y - s.from.y) * uy;
      if (u >= 1) {
        const next = s.next;
        if (next === 'hang') {
          enter(s, 'hang');
          ctx.play(TRAV_CLIPS.hang, 0.15, true);
        } else if (next === 'ladder') {
          enter(s, 'ladder');
        } else if (next === 'mantle' && s.ledge) {
          // tirato su fino all'altezza "1 m sotto la cima": ora scavalca
          startMantle(s, ctx, s.ledge);
        } else {
          enter(s, 'ground');
          s.lastX = ctx.pos.x;
          s.lastZ = ctx.pos.z;
          s.ledge = null;
          return false;
        }
      }
      return true;
    }

    case 'hang': {
      const l = s.ledge!;
      if (!s.started) {
        s.started = true;
        ctx.play(TRAV_CLIPS.hang, 0.15, true);
      }
      // su: tirarsi su (se sopra c'e' spazio)
      if ((inp.forward || inp.jumpPressed) && l.room) {
        ctx.setRotation(facing(-l.n.x, -l.n.z));
        const to = new THREE.Vector3(l.face.x + l.n.x * 0.22, l.topY - MANTLE_RISE, l.face.z + l.n.z * 0.22);
        startMove(s, ctx, to, 0.55, 'pullUp', 'mantle');
        s.ledge = l;
        ctx.play(TRAV_CLIPS.pullUp, 0.15, false, 1.3);
        return true;
      }
      // giu': si lascia
      if (inp.backward) {
        ctx.pos.x += l.n.x * 0.15;
        ctx.pos.z += l.n.z * 0.15;
        s.vy = 0;
        s.vel.set(0, 0, 0);
        s.grabCooldown = 0.4;
        s.coyote = 0;
        enter(s, 'air');
        s.started = true;
        ctx.play(TRAV_CLIPS.air, 0.2, true);
        return true;
      }
      // di lato lungo il bordo (rispetto alla camera)
      const tx = l.n.z, tz = -l.n.x; // destra del personaggio
      const side = inp.move.x * tx + inp.move.z * tz;
      if (Math.abs(side) > 0.3) {
        const dir = Math.sign(side);
        const step = SHIMMY_SPEED * dt * dir;
        const cx = ctx.pos.x + tx * step, cz = ctx.pos.z + tz * step;
        // il bordo deve continuare sotto la mano che va avanti (25 cm oltre)
        const ahead = probeLedge(ctx.world, ctx.rapier, cx + tx * dir * 0.25, cz + tz * dir * 0.25, s.feetY, -l.n.x, -l.n.z, 0.6, 2.5);
        const here = probeLedge(ctx.world, ctx.rapier, cx, cz, s.feetY, -l.n.x, -l.n.z, 0.6, 2.5);
        if (ahead && here && Math.abs(here.topY - l.topY) < 0.15 && Math.abs(ahead.topY - l.topY) < 0.15) {
          s.ledge = here;
          const r = hangRoot(here, new THREE.Vector3());
          ctx.pos.x = r.x;
          ctx.pos.z = r.z;
          s.feetY = r.y;
          ctx.setRotation(facing(-here.n.x, -here.n.z));
        }
      }
      return true;
    }

    case 'ladder': {
      const l = s.ladder!;
      const v = inp.forward ? LADDER_SPEED : inp.backward ? -LADDER_SPEED : 0;
      ctx.play(TRAV_CLIPS.ladder, 0.15, true, v / LADDER_CLIP_SPEED);
      s.feetY += v * dt;
      ctx.pos.x = l.x + l.nx * LADDER_OFF;
      ctx.pos.z = l.z + l.nz * LADDER_OFF;
      // in cima: scavalca sulla piattaforma
      if (v > 0 && s.feetY >= l.topY - MANTLE_RISE) {
        s.feetY = l.topY - MANTLE_RISE;
        const face = new THREE.Vector3(l.x - l.nx * 0.12, l.topY, l.z - l.nz * 0.12);
        startMantle(s, ctx, { face, n: new THREE.Vector3(l.nx, 0, l.nz), topY: l.topY, height: MANTLE_RISE, dist: 0, deep: true, room: true });
        s.ladder = null;
        return true;
      }
      // in fondo: si scende
      if (s.feetY <= l.bottomY) {
        s.feetY = l.bottomY;
        if (v < 0) {
          enter(s, 'ground');
          s.ladder = null;
          s.lastX = ctx.pos.x;
          s.lastZ = ctx.pos.z;
          return false;
        }
      }
      // salto all'indietro dalla scala
      if (inp.jumpPressed) {
        s.vy = 3.5;
        s.vel.set(l.nx * 2.5, 0, l.nz * 2.5);
        s.grabCooldown = 0.5;
        s.ladder = null;
        enter(s, 'air');
        ctx.play(TRAV_CLIPS.jumpStart, 0.1, false, 1.6, 0.22);
        return true;
      }
      return true;
    }
  }
  return false;
}

// A terra: segue l'appoggio (sale sui blocchi su cui si e' finiti, scende
// pendii/gradini piccoli) e fa cadere quando sotto i piedi non c'e' piu'
// niente. Da chiamare ogni frame dopo il movimento orizzontale.
export function followGround(s: TravState, ctx: { world: World; rapier: RapierModule; pos: THREE.Vector3; baseY: (x: number, z: number) => number }) {
  if (s.mode !== 'ground' && s.mode !== 'land' && s.mode !== 'roll') return;
  const base = ctx.baseY(ctx.pos.x, ctx.pos.z);
  const sup = supportHeight(ctx.world, ctx.rapier, ctx.pos.x, ctx.pos.z, s.feetY + 0.45, base);
  if (sup >= s.feetY - MAX_STEP_DOWN) {
    s.feetY = sup;
    return;
  }
  // niente sotto: si cade (con la velocita' che si aveva camminando)
  s.vy = 0;
  s.coyote = COYOTE_S;
  enter(s, 'air');
  s.started = true;
}

export function isTraversing(s: TravState) {
  return s.mode !== 'ground';
}

// Punti per l'IK delle mani quando si e' appesi (sul bordo, a 19 cm dal
// centro, 4 cm oltre la faccia del muro). null se non appesi.
export function hangHandTargets(s: TravState, left: THREE.Vector3, right: THREE.Vector3): boolean {
  if (s.mode !== 'hang' || !s.ledge) return false;
  const l = s.ledge;
  // centro delle mani sulla linea del bordo, davanti alla radice
  const cx = l.face.x - l.n.x * 0.04;
  const cz = l.face.z - l.n.z * 0.04;
  const tx = l.n.z, tz = -l.n.x;
  const y = l.topY + 0.03;
  left.set(cx - tx * 0.19, y, cz - tz * 0.19);
  right.set(cx + tx * 0.19, y, cz + tz * 0.19);
  return true;
}
