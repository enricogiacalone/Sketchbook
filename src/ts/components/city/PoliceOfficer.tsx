import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import * as THREE from 'three';
import { useStore } from '../../store';
import SpeechBubble from '../UI/SpeechBubble';
import EnemyHealthBar from '../Environment/EnemyHealthBar';
import { getTerrainHeight } from '../Environment/Terrain';
import { getRoadOffset } from '../Environment/Road';
import { usePistolModel } from '../Environment/weapons/usePistolModel';
import { RUN_CLIP, timeScaleFor } from '../Environment/locomotion';
import { useMannequinActor } from './useMannequinActor';
import { LOOK_CLIP, WALK_BASE_SPEED } from './crowdSim';
import { allyRegistry, hasLineOfSight, npcFire, PLAYER_ID } from './npcCombat';
import { addArrest, copRegistry, copSeesPlayer, isPlayerSpotted, isViolent, registerCop, unregisterCop, wanted } from '../../lib/wanted';
import { insideStatics, queryStatics, segHitsRect, type StaticCircle, type StaticRect } from './crowdObstacles';

// Poliziotto a piedi, alla GTA 5:
// - di pattuglia (percorso avanti e indietro) non fa nulla finche' non c'e'
//   un ricercato; i colpi al poliziotto o crimini sotto i suoi occhi alzano
//   le stelle (lib/wanted.ts);
// - ricercato e visto: reagisce (mezzo secondo di esitazione), intima
//   l'alt, corre e prende posizione a distanza di tiro attorno al
//   giocatore (ognuno la sua: non si ammassano), spara solo con la linea di
//   tiro libera, con piu' precisione e fuoco a ogni stella;
// - visto da nessuno (stelle che lampeggiano): va all'ultima posizione nota
//   e perlustra la zona guardandosi attorno;
// - fine della ricerca: torna alla pattuglia (i rinforzi si allontanano e
//   spariscono).

export interface PoliceOfficerProps {
  id: string;
  // pattuglia: percorso avanti e indietro
  patrol?: { x1: number; z1: number; x2: number; z2: number; speed: number; phase: number };
  // rinforzo: dove compare
  spawn?: [number, number];
  swat?: boolean;
  onRemove?: (id: string) => void;
}

type Mode = 'patrol' | 'chase' | 'search' | 'return';

const CORPSE_S = 20;
const SIGHT_DIST = 55;
const SIGHT_DIST_ALERT = 80;
const PATROL_FOV_COS = Math.cos((75 * Math.PI) / 180);
const FIRE_RANGE = 30;
const JOG_SPEED = 3.8;
const SEARCH_JOG = 3.2;
const WALK_SPEED = 1.35;
const ENGAGE_R = [0, 11, 10, 9, 8, 7];
const FIRE_INTERVAL = [0, 1.7, 1.4, 1.15, 0.95, 0.75];
const SPREAD = [0, 0.085, 0.07, 0.055, 0.045, 0.035];
const BASE_DAMAGE = [0, 8, 10, 12, 14, 16];
const PLAYER_CHEST = 1.25;
const SEP_DIST = 1.5;

const SHOUT = ['Fermo! Polizia!', 'Alt! Mani in alto!', 'Sei in arresto!', 'Getta l\'arma!', 'Fermati subito!'];
const SEARCHING = ['Dov\'e\' andato?', 'Cercatelo!', 'Non puo\' essere lontano.', 'Controllate la zona!'];
const LOST = ['Abbiamo perso il sospetto.', 'Niente. Rientriamo.'];

// Ogni agente perlustra un suo settore (un quarto) dell'area di ricerca,
// come la ricerca a zone di GTA 4: insieme coprono tutto il cerchio.
function pickSearchPoint(S: { sector: number; searchX: number; searchZ: number }) {
  const R = Math.max(20, wanted.searchR || 30);
  const a = (S.sector + Math.random()) * (Math.PI / 2);
  const r = R * (0.2 + Math.random() * 0.75);
  S.searchX = wanted.searchCx + Math.cos(a) * r;
  S.searchZ = wanted.searchCz + Math.sin(a) * r;
}

const _sr: StaticRect[] = [];
const _sc: StaticCircle[] = [];

// Un riparo vicino, alla GTA: l'angolo di un edificio. Si sta al riparo lungo il
// muro (il palazzo copre dalla linea di tiro) e ci si sporge oltre lo spigolo
// per sparare.
interface CoverSpot {
  x: number;
  z: number;
  px: number;
  pz: number;
}
function findCover(px: number, pz: number, cx: number, cz: number, avoid?: { x: number; z: number } | null): CoverSpot | null {
  _sr.length = 0;
  _sc.length = 0;
  queryStatics(cx - 28, cz - 28, cx + 28, cz + 28, _sr, _sc);
  let best: CoverSpot | null = null;
  let bestScore = Infinity;
  for (const r of _sr) {
    // 4 muri: asse, posizione e verso verso l'esterno; due spigoli ciascuno
    const walls: Array<{ horiz: boolean; c: number; n: number; a0: number; a1: number }> = [
      { horiz: true, c: r.minZ, n: -1, a0: r.minX, a1: r.maxX },
      { horiz: true, c: r.maxZ, n: 1, a0: r.minX, a1: r.maxX },
      { horiz: false, c: r.minX, n: -1, a0: r.minZ, a1: r.maxZ },
      { horiz: false, c: r.maxX, n: 1, a0: r.minZ, a1: r.maxZ },
    ];
    for (const w of walls) {
      if (w.a1 - w.a0 < 3.5) continue;
      for (const end of [0, 1]) {
        const k = end === 0 ? w.a0 : w.a1;
        const e = end === 0 ? 1 : -1; // verso l'interno del muro
        const along = (v: number) => (w.horiz ? { x: v, z: w.c + w.n * 0.6 } : { x: w.c + w.n * 0.6, z: v });
        const H = along(k + e * 1.4);
        const P = along(k - e * 0.6);
        const dh = Math.hypot(H.x - px, H.z - pz);
        const dp = Math.hypot(P.x - px, P.z - pz);
        if (dh < 6 || dh > 30 || dp < 6) continue;
        if (insideStatics(H.x, H.z, 0.35) || insideStatics(P.x, P.z, 0.35)) continue;
        // nascosto da dietro il muro, scoperto allo spigolo
        if (!segHitsRect(px, pz, H.x, H.z, r, 0.1) || segHitsRect(px, pz, P.x, P.z, r, 0.1)) continue;
        // e ci si deve poter arrivare in linea retta, senza passare dentro un edificio
        if (avoid && Math.hypot(H.x - avoid.x, H.z - avoid.z) < 4) continue;
        let blocked = false;
        for (const r2 of _sr) {
          if (segHitsRect(cx, cz, H.x, H.z, r2, 0.4)) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;
        const score = Math.hypot(H.x - cx, H.z - cz) + Math.abs(dh - 14) * 0.4;
        if (score < bestScore) {
          bestScore = score;
          best = { x: H.x, z: H.z, px: P.x, pz: P.z };
        }
      }
    }
  }
  return best;
}

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

const _chest = new THREE.Vector3();
const _aimAt = new THREE.Vector3();

const PoliceOfficer: React.FC<PoliceOfficerProps> = ({ id, patrol, spawn, swat, onRemove }) => {
  const h = useMemo(() => hash(id), [id]);
  const start = useMemo(() => new THREE.Vector3(patrol?.x1 ?? 0, 0, patrol?.z1 ?? 0), [patrol]);
  const end = useMemo(() => new THREE.Vector3(patrol?.x2 ?? 0, 0, patrol?.z2 ?? 0), [patrol]);
  const segLen = useMemo(() => start.distanceTo(end), [start, end]);
  const p0 = useMemo(() => {
    if (patrol) return new THREE.Vector3().lerpVectors(start, end, patrol.phase);
    return new THREE.Vector3(spawn?.[0] ?? 0, 0, spawn?.[1] ?? 0);
  }, [patrol, spawn, start, end]);

  const maxHp = swat ? 130 : 80;
  const actor = useMannequinActor({
    id,
    name: swat ? 'Unita\' speciale' : 'Agente',
    team: 'POLICE',
    color: swat ? '#263238' : '#0d47a1',
    hp: maxHp,
    x: p0.x,
    z: p0.z,
    enableActiveRagdoll: false,
  });
  const { data } = actor;
  const pistol = usePistolModel(actor.modelRootRef);
  const { world, rapier } = useRapier();
  const groupRef = useRef<THREE.Group>(null);
  const [message, setMessage] = useState('');
  const [gone, setGone] = useState(false);

  const s = useRef({
    mode: 'patrol' as Mode,
    t: patrol?.phase ?? 0,
    dir: 1,
    pause: 0,
    reactT: 0,
    fireCd: 1,
    shootAnim: 0,
    sightT: 0,
    sees: false,
    allyTarget: null as string | null,
    steer: 0,
    steerT: 0,
    stuckT: 0,
    searchX: 0,
    searchZ: 0,
    searchWait: 0,
    returnT: 0,
    deadHandled: false,
    shoutedAt: -99,
    spokeAt: -99,
    entityT: 0,
    wasWanted: false,
    // riparo (GTA 5): dietro a un muro, esce a sparare e rientra
    cover: null as null | { x: number; z: number; phase: 'move' | 'hide' | 'peek'; t: number; px: number; pz: number },
    coverT: 0,
    badCover: null as null | { x: number; z: number },
    sector: h % 4,
  });

  if (import.meta.env.DEV) {
    ((window as any).__copS ??= {})[id] = s.current;
    (window as any).__findCover = findCover;
  }

  const say = (lines: string[]) => {
    const now = performance.now() / 1000;
    if (now - s.current.spokeAt < 4) return;
    s.current.spokeAt = now;
    setMessage(lines[Math.floor(Math.random() * lines.length)]);
    setTimeout(() => setMessage(''), 2600);
  };

  useEffect(() => {
    registerCop(id);
    return () => {
      unregisterCop(id);
      useStore.getState().removeEntity(id);
    };
  }, [id]);

  useEffect(() => {
    actor.setInspectExtra(() => [
      ['comportamento', s.current.mode],
      ['vede il giocatore', s.current.sees ? 'si' : 'no'],
      ['stelle', String(wanted.level)],
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_state, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const S = s.current;
    const pos = data.position;
    const res = actor.beginFrame(delta, pos);
    const info = copRegistry.get(id);

    if (res === 'dead') {
      if (!S.deadHandled) {
        S.deadHandled = true;
        pistol.setVisible(false);
        unregisterCop(id);
        useStore.getState().removeEntity(id);
      }
      if (actor.deadFor() > CORPSE_S) {
        if (patrol) {
          // la pattuglia si rimpiazza: stesso percorso, di nuovo in servizio
          actor.revive();
          S.deadHandled = false;
          S.mode = 'patrol';
          S.t = patrol.phase;
          pos.set(p0.x, 0, p0.z);
          registerCop(id);
        } else {
          actor.ragdoll.deactivate();
          setGone(true);
          onRemove?.(id);
        }
      }
      return;
    }
    if (res === 'down') {
      pistol.setVisible(false);
      actor.holdRoot(g);
      return;
    }

    const store = useStore.getState();
    const pp = store.playerPos;
    const dx = pp[0] - pos.x;
    const dz = pp[2] - pos.z;
    const dist = Math.hypot(dx, dz);
    const level = wanted.level;
    const gy = getTerrainHeight(pos.x, pos.z) + getRoadOffset(pos.x, pos.z);
    const onFoot = store.currentControllable === 'player';
    const playerDown = store.health <= 0;

    // ---- vista (a intervalli: raggi fisici) --------------------------------
    S.sightT -= delta;
    if (S.sightT <= 0) {
      S.sightT = 0.18 + Math.random() * 0.08;
      const alert = S.mode === 'chase' || S.mode === 'search';
      const range = alert ? SIGHT_DIST_ALERT : SIGHT_DIST;
      let sees = false;
      if (dist < range && !playerDown) {
        let inView = true;
        if (!alert && dist > 3) {
          // fuori allerta: solo davanti a se' (~150 gradi)
          const fx = Math.sin(g.rotation.y);
          const fz = Math.cos(g.rotation.y);
          inView = (dx * fx + dz * fz) / dist > PATROL_FOV_COS;
        }
        if (inView) {
          _chest.set(pp[0], onFoot ? pp[1] - 0.5 + PLAYER_CHEST : pp[1], pp[2]);
          sees = hasLineOfSight(world, rapier, pos.x, gy + 1.6, pos.z, _chest, id);
        }
      }
      S.sees = sees;
      // alleati che stanno combattendo contro la polizia
      S.allyTarget = null;
      if (!sees && level > 0) {
        const now = performance.now() / 1000;
        for (const a of allyRegistry.values()) {
          if (a.data.isDead || a.hostileUntil < now) continue;
          const ax = a.data.position.x - pos.x;
          const az = a.data.position.z - pos.z;
          if (ax * ax + az * az > 28 * 28) continue;
          _chest.set(a.data.position.x, gy + 1.2, a.data.position.z);
          if (hasLineOfSight(world, rapier, pos.x, gy + 1.6, pos.z, _chest, id)) {
            S.allyTarget = a.id;
            break;
          }
        }
      }
    }
    if (S.sees && level > 0) copSeesPlayer(id, pp[0], pp[2]);

    // ---- cambi di comportamento ---------------------------------------------
    const spotted = isPlayerSpotted();
    if (level > 0) {
      S.wasWanted = true;
      if (S.mode === 'patrol' || S.mode === 'return') {
        // crimine sotto gli occhi (o saputo via radio): all'erta
        S.mode = 'chase';
        S.reactT = 0.45 + Math.random() * 0.7;
        S.fireCd = 0.5 + Math.random() * 0.6;
        S.returnT = 0;
        if (S.sees) say(SHOUT);
      } else if (S.mode === 'chase' && !spotted && wanted.searching) {
        S.mode = 'search';
        S.searchWait = 0;
        pickSearchPoint(S);
        say(SEARCHING);
      } else if (S.mode === 'search' && spotted) {
        S.mode = 'chase';
        S.reactT = 0.3 + Math.random() * 0.4;
        if (S.sees) say(SHOUT);
      }
    } else if (S.mode === 'chase' || S.mode === 'search') {
      S.mode = 'return';
      S.returnT = 0;
      if (S.wasWanted) say(LOST);
      S.wasWanted = false;
    }

    const armed = S.mode === 'chase' || S.mode === 'search';
    pistol.setVisible(armed);
    pistol.update(delta);

    // ---- movimento ----------------------------------------------------------
    let faceYaw: number | null = null; // verso dove guardare (se diverso dalla marcia)
    let moveSpeed = 0;
    let goalX = pos.x;
    let goalZ = pos.z;
    let look = false;
    let arrestMode = false;
    let hiding = false;

    const R = (ENGAGE_R[Math.max(1, level)] ?? 9) + (h % 4) - (swat ? 2 : 0);
    const theta = ((h % 360) * Math.PI) / 180;

    if (S.mode === 'patrol') {
      if (!patrol || segLen < 0.01) {
        moveSpeed = 0;
      } else if (S.pause > 0) {
        S.pause -= delta;
      } else {
        S.t += (S.dir * patrol.speed * 0.8 * delta) / segLen;
        if (S.t >= 1 || S.t <= 0) {
          S.t = Math.min(1, Math.max(0, S.t));
          S.dir *= -1;
          S.pause = 1 + Math.random() * 2.5;
        }
        const rx = start.x + (end.x - start.x) * S.t;
        const rz = start.z + (end.z - start.z) * S.t;
        goalX = rx;
        goalZ = rz;
        moveSpeed = Math.min(1.05, patrol.speed * 0.85);
        // posizione sul percorso (niente fisica: e' la sua strada)
        pos.x = rx;
        pos.z = rz;
        S.steer = 0;
      }
    } else if (S.mode === 'chase') {
      S.reactT -= delta;
      if (S.reactT > 0) {
        // esita: si gira verso il giocatore
        if (dist > 0.1) faceYaw = Math.atan2(dx, dz);
      } else if (S.sees || S.allyTarget) {
        const tx = S.sees ? pp[0] : (allyRegistry.get(S.allyTarget!)?.data.position.x ?? pp[0]);
        const tz = S.sees ? pp[2] : (allyRegistry.get(S.allyTarget!)?.data.position.z ?? pp[2]);
        const tdx = tx - pos.x;
        const tdz = tz - pos.z;
        const td = Math.hypot(tdx, tdz);
        faceYaw = Math.atan2(tdx, tdz);
        const violent = isViolent();
        S.coverT -= delta;
        if (S.sees && onFoot && level <= 2 && !violent && !swat) {
          // 1-2 stelle e il giocatore non sta sparando: cercano di fermarlo e ammanettarlo
          arrestMode = true;
          S.cover = null;
          goalX = tx;
          goalZ = tz;
          if (td > 1.5) moveSpeed = JOG_SPEED;
          if (td < 2.1 && !playerDown) addArrest(delta);
        } else {
          // GTA 5: da 2 stelle, sotto il fuoco si cerca un riparo
          if (level >= 2 && (violent || level >= 3) && td > 6) {
            if (!S.cover && S.coverT <= 0) {
              S.coverT = 2.5;
              const c = findCover(tx, tz, pos.x, pos.z, S.badCover);
              if (c) S.cover = { x: c.x, z: c.z, phase: 'move', t: 0, px: c.px, pz: c.pz };
            }
          } else S.cover = null;
          const cv = S.cover;
          if (cv) {
            cv.t += delta;
            if (cv.phase === 'move') {
              goalX = cv.x;
              goalZ = cv.z;
              moveSpeed = JOG_SPEED;
              faceYaw = null;
              if (Math.hypot(cv.x - pos.x, cv.z - pos.z) < 0.9) {
                cv.phase = 'hide';
                cv.t = 0;
              } else if (cv.t > 6) {
                // non ci arriva: non lo riprova e per un po' combatte allo scoperto
                S.badCover = { x: cv.x, z: cv.z };
                S.cover = null;
                S.coverT = 6;
              }
            } else if (cv.phase === 'hide') {
              // al riparo, accucciato; poi si sporge di lato
              hiding = true;
              goalX = cv.x;
              goalZ = cv.z;
              if (Math.hypot(cv.x - pos.x, cv.z - pos.z) > 0.3) moveSpeed = WALK_SPEED * 1.3;
              if (cv.t > 1.4 + (h % 5) * 0.3) {
                cv.phase = 'peek';
                cv.t = 0;
              }
            } else {
              // sporge e spara, poi rientra
              goalX = cv.px;
              goalZ = cv.pz;
              if (Math.hypot(cv.px - pos.x, cv.pz - pos.z) > 0.2) moveSpeed = WALK_SPEED * 1.3;
              if (cv.t > 2.4 + (h % 3) * 0.4) {
                cv.phase = 'hide';
                cv.t = 0;
              }
            }
          } else {
            goalX = tx + Math.cos(theta) * R;
            goalZ = tz + Math.sin(theta) * R;
            if (td > R + 3) {
              moveSpeed = JOG_SPEED;
              // corre verso il suo posto attorno al bersaglio
            } else if (td < R - 4) {
              // troppo vicino: indietreggia
              goalX = pos.x - tdx;
              goalZ = pos.z - tdz;
              moveSpeed = WALK_SPEED;
              faceYaw = Math.atan2(tdx, tdz);
            }
          }
        }
      } else {
        // non lo vede ma lo cercano: verso l'ultima posizione nota
        goalX = wanted.lastX;
        goalZ = wanted.lastZ;
        moveSpeed = JOG_SPEED;
        if (Math.hypot(goalX - pos.x, goalZ - pos.z) < 3) moveSpeed = 0;
      }
    } else if (S.mode === 'search') {
      const gd = Math.hypot(S.searchX - pos.x, S.searchZ - pos.z);
      if (gd > 2.5) {
        goalX = S.searchX;
        goalZ = S.searchZ;
        moveSpeed = gd > 12 ? JOG_SPEED : SEARCH_JOG;
        if (gd < 6) moveSpeed = WALK_SPEED * 1.4;
      } else {
        // arrivato: si guarda attorno, poi un altro punto della zona
        look = true;
        S.searchWait += delta;
        if (S.searchWait > 3.5 + Math.random()) {
          S.searchWait = 0;
          pickSearchPoint(S);
        }
      }
    } else {
      // return
      S.returnT += delta;
      if (patrol && segLen > 0.01) {
        const rx = start.x + (end.x - start.x) * S.t;
        const rz = start.z + (end.z - start.z) * S.t;
        const rd = Math.hypot(rx - pos.x, rz - pos.z);
        if (rd < 1.2) {
          S.mode = 'patrol';
          S.pause = 0;
        } else {
          goalX = rx;
          goalZ = rz;
          moveSpeed = rd > 14 ? SEARCH_JOG : WALK_SPEED * 1.3;
        }
      } else {
        // rinforzo: se ne va via e sparisce una volta lontano
        const ax = pos.x - pp[0];
        const az = pos.z - pp[2];
        const al = Math.hypot(ax, az) || 1;
        goalX = pos.x + (ax / al) * 20;
        goalZ = pos.z + (az / al) * 20;
        moveSpeed = WALK_SPEED * 1.4;
        if (dist > 60 || S.returnT > 45) {
          actor.ragdoll.deactivate();
          setGone(true);
          onRemove?.(id);
          return;
        }
      }
    }

    // ---- passo con fisica (non in pattuglia: li' e' sul percorso) ------------
    let marchYaw: number | null = null;
    if (moveSpeed > 0 && S.mode !== 'patrol') {
      let gdx = goalX - pos.x;
      let gdz = goalZ - pos.z;
      const gd = Math.hypot(gdx, gdz);
      if (gd > 0.05) {
        // distanza dagli altri agenti
        let sx = 0;
        let sz = 0;
        for (const c of copRegistry.values()) {
          if (c.id === id || c.car) continue;
          const ex = pos.x - c.x;
          const ez = pos.z - c.z;
          const ed = Math.hypot(ex, ez);
          if (ed > 0.01 && ed < SEP_DIST) {
            sx += (ex / ed) * (SEP_DIST - ed);
            sz += (ez / ed) * (SEP_DIST - ed);
          }
        }
        gdx = gdx / gd + sx * 0.8;
        gdz = gdz / gd + sz * 0.8;
        let ang = Math.atan2(gdx, gdz);
        if (S.steerT > 0) {
          S.steerT -= delta;
          ang += S.steer;
          if (S.steerT <= 0) S.steer = 0;
        }
        const step = Math.min(moveSpeed * delta, gd);
        const c = actor.ragdoll.resolveBodyMovement(Math.sin(ang) * step, Math.cos(ang) * step, null);
        pos.x += c.x;
        pos.z += c.z;
        // incastrato contro un muro: gira attorno
        if (Math.hypot(c.x, c.z) < step * 0.25) {
          S.stuckT += delta;
          if (S.stuckT > 0.5) {
            S.stuckT = 0;
            S.steer = (Math.random() < 0.5 ? -1 : 1) * (0.9 + Math.random() * 0.6);
            S.steerT = 1 + Math.random() * 0.8;
          }
        } else S.stuckT = Math.max(0, S.stuckT - delta);
        marchYaw = ang;
      }
    } else if (S.mode === 'patrol' && moveSpeed > 0) {
      const fx = S.dir >= 0 ? end : start;
      marchYaw = Math.atan2(fx.x - pos.x, fx.z - pos.z);
    }

    // ---- rotazione ----------------------------------------------------------
    const wantYaw = faceYaw ?? marchYaw;
    if (wantYaw !== null) {
      g.rotation.y += wrap(wantYaw - g.rotation.y) * Math.min(1, delta * (faceYaw !== null ? 10 : 7));
    }

    // ---- fuoco --------------------------------------------------------------
    const lvl = Math.max(1, Math.min(5, level));
    // (a 1-2 stelle, finche' non spari, non sparano: provano ad arrestarti)
    const mayShoot = level >= 3 || isViolent() || !!S.allyTarget;
    const engaged = S.mode === 'chase' && S.reactT <= 0 && (S.sees || !!S.allyTarget) && !arrestMode && !hiding && mayShoot;
    if (S.shootAnim > 0) S.shootAnim -= delta;
    if (engaged && !playerDown) {
      S.fireCd -= delta;
      const tAlly = !S.sees && S.allyTarget ? allyRegistry.get(S.allyTarget)?.data ?? null : null;
      const tx = tAlly ? tAlly.position.x : pp[0];
      const tz = tAlly ? tAlly.position.z : pp[2];
      const td = Math.hypot(tx - pos.x, tz - pos.z);
      const err = Math.abs(wrap(Math.atan2(tx - pos.x, tz - pos.z) - g.rotation.y));
      if (S.fireCd <= 0 && err < 0.4 && td <= FIRE_RANGE) {
        S.fireCd = FIRE_INTERVAL[lvl] * (swat ? 0.75 : 1) + Math.random() * 0.4;
        if (tAlly) _aimAt.set(tx, gy + 1.2, tz);
        else _aimAt.set(pp[0], onFoot ? pp[1] - 0.5 + PLAYER_CHEST : pp[1], pp[2]);
        const targetId = tAlly ? tAlly.id : PLAYER_ID;
        npcFire({
          world,
          rapier,
          pistol,
          shooterId: id,
          target: _aimAt,
          spread: SPREAD[lvl] * (swat ? 0.8 : 1),
          damage: BASE_DAMAGE[lvl] * (swat ? 1.3 : 1),
          canHurt: (owner) => owner === targetId,
        });
        if (actor.hasClip('Pistol_Shoot')) {
          actor.play('Pistol_Shoot', 0.05, false);
          S.shootAnim = Math.min(0.45, actor.clipDuration('Pistol_Shoot'));
        }
      }
    }

    // ---- animazione ---------------------------------------------------------
    const moving = S.mode === 'patrol' ? moveSpeed > 0 : marchYaw !== null;
    if (S.shootAnim <= 0) {
      if (moving) {
        if (moveSpeed > 2.2) actor.play(RUN_CLIP, 0.2, true, timeScaleFor(RUN_CLIP, moveSpeed));
        else {
          const wc = actor.hasClip('Walk') ? 'Walk' : 'Idle_A';
          actor.play(wc, 0.25, true, moveSpeed / (WALK_BASE_SPEED[wc] ?? 0.73));
        }
      } else if (hiding && actor.hasClip('Crouch_Idle')) {
        actor.play('Crouch_Idle', 0.2);
      } else if (look && actor.hasClip(LOOK_CLIP)) {
        actor.play(LOOK_CLIP, 0.3);
      } else if (armed) {
        actor.play(actor.hasClip('Pistol_Aim_Neutral') ? 'Pistol_Aim_Neutral' : actor.hasClip('Pistol_Idle') ? 'Pistol_Idle' : 'Idle_A', 0.2);
      } else {
        actor.play('Idle_A', 0.3);
      }
    }

    g.position.set(pos.x, gy, pos.z);
    data.rotation = g.rotation.y + Math.PI;
    if (info) {
      info.x = pos.x;
      info.z = pos.z;
    }

    S.entityT -= delta;
    if (S.entityT <= 0) {
      S.entityT = 0.25;
      store.updateEntity(id, { type: 'police', position: [pos.x, gy + 1, pos.z], rotation: g.rotation.y });
    }
  });

  if (gone) return null;
  return (
    <>
      <group ref={groupRef} position={[p0.x, getTerrainHeight(p0.x, p0.z) + getRoadOffset(p0.x, p0.z), p0.z]}>
        <primitive object={actor.clone} />
        <SpeechBubble message={message} position={[0, 2.4, 0]} />
      </group>
      <EnemyHealthBar data={data} maxHp={maxHp} />
    </>
  );
};

export default PoliceOfficer;
