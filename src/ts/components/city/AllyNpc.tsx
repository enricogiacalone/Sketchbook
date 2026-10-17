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
import { cityOpponents } from './cityActors';
import { LOOK_CLIP, WALK_BASE_SPEED } from './crowdSim';
import { allyRegistry, hasLineOfSight, newStepState, npcFire, stepToward } from './npcCombat';
import { LINES, parseOrder, pick, type Order } from './allyOrders';
import { reportHit } from '../../lib/wanted';
import type { FighterData } from '../Environment/SquadArenaTypes';

// Un alleato: un passante che il giocatore ha reclutato in chat ("seguimi",
// "uccidi quel poliziotto"...). Resta con lui (cammina, trotta o corre per
// non restare indietro, si mette dietro di lui e non si ammassa con gli
// altri), esegue gli ordini -- seguire, attaccare un tipo di bersaglio
// (poliziotti, passanti, nemici, chiunque), difendere, restare fermo,
// congedarsi -- e se e' lontano o bloccato si riporta vicino.

export interface AllyNpcProps {
  id: string;
  index: number;
  initialPosition: [number, number, number];
  initialHp?: number;
  order: Order;
  onGone: (id: string) => void;
}

type Mode = 'follow' | 'attack' | 'stay' | 'leave';

const MAX_HP = 100;
const CORPSE_S = 20;
const HEAR_DIST = 45;
const WALK = 1.3;
const JOG = 3.2;
const RUN = 5.3;
const FIRE_RANGE = 16;
const FIRE_INTERVAL = 0.9;
const SPREAD = 0.05;
const DAMAGE = 16;
const FOLLOW_R = 2.6;
const WARP_DIST = 75;
const TARGET_SEARCH_DIST = 50;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const _aimAt = new THREE.Vector3();

// In auto: il guidatore e' seat_1, i passeggeri occupano seat_2..seat_4 (in
// tutto 4 posti): chi segue il giocatore sale al primo posto libero, gli
// altri restano a piedi finche' non scende qualcuno.
const PASSENGER_SEATS = ['seat_2', 'seat_3', 'seat_4'];
const seatTaken = new Map<string, Map<string, string>>(); // auto -> posto -> alleato
const SEAT_FWD = 0.31; // radice del personaggio rispetto al nodo del sedile (come per il guidatore)
const SEAT_DOWN = 0.44;
const BOARD_DIST = 3.0; // m dall'auto per salire
const CAR_CHASE_MAX = 40; // oltre questa distanza dal giocatore si segue e basta
const _sq = new THREE.Quaternion();
const _sp = new THREE.Vector3();
const _sf = new THREE.Vector3();
const _su = new THREE.Vector3();
const _se = new THREE.Euler();
const takenOf = (carId: string) => {
  let m = seatTaken.get(carId);
  if (!m) seatTaken.set(carId, (m = new Map()));
  return m;
};

function matches(o: FighterData, order: Order, pp: number[]): boolean {
  const t = o.team ?? '';
  if (t === 'ALLY' || t === 'PLAYER' || t.startsWith('REMOTE_')) return false;
  const police = t.startsWith('POLICE');
  const civ = t.startsWith('CIVILIAN');
  const enemy = t === 'CITY_ENEMY';
  if (order.kind === 'defend') {
    // chi minaccia il giocatore (nemici e polizia vicini a lui)
    return (police || enemy) && Math.hypot(o.position.x - pp[0], o.position.z - pp[2]) < 35;
  }
  switch (order.target) {
    case 'police':
      return police;
    case 'civilian':
      return civ;
    case 'enemy':
      return enemy;
    default:
      return police || civ || enemy;
  }
}

const AllyNpc: React.FC<AllyNpcProps> = ({ id, index, initialPosition, initialHp, order: firstOrder, onGone }) => {
  const actor = useMannequinActor({
    id,
    name: 'Alleato',
    team: 'ALLY',
    color: '#2e7d32',
    hp: MAX_HP,
    x: initialPosition[0],
    z: initialPosition[2],
    enableActiveRagdoll: false,
    targetable: false,
  });
  const { data } = actor;
  useEffect(() => {
    if (initialHp !== undefined) data.hp = Math.max(10, Math.min(MAX_HP, initialHp));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pistol = usePistolModel(actor.modelRootRef);
  const { world, rapier } = useRapier();
  const groupRef = useRef<THREE.Group>(null);
  const [message, setMessage] = useState('');
  const [gone, setGone] = useState(false);

  const S = useRef({
    mode: 'follow' as Mode,
    order: firstOrder,
    killsLeft: 1,
    target: null as FighterData | null,
    searchT: 0,
    fireCd: 0.5,
    shootAnim: 0,
    shots: 0,
    reloadT: 0,
    moving: false,
    step: newStepState(),
    prevPX: initialPosition[0],
    prevPZ: initialPosition[2],
    pSpeed: 0,
    rearX: 0,
    rearZ: 1,
    leaveT: 0,
    lastMsg: useStore.getState().playerMessage,
    deadHandled: false,
    sinceNear: 0,
    warm: 0,
    spokeAt: 0,
    // posto in auto prenotato (si va verso la portiera) e posto occupato
    reserved: null as { carId: string; name: string } | null,
    seat: null as { carId: string; name: string } | null,
  });

  if (import.meta.env.DEV) ((window as any).__allyS ??= {})[id] = S.current;

  const say = (text: string) => {
    setMessage(text);
    S.current.spokeAt = performance.now();
    window.setTimeout(() => {
      if (performance.now() - S.current.spokeAt >= 2400) setMessage('');
    }, 2600);
  };

  const applyOrder = (o: Order, silent = false) => {
    const s = S.current;
    s.target = null;
    s.order = o;
    switch (o.kind) {
      case 'follow':
        s.mode = 'follow';
        if (!silent) say(pick(LINES.follow));
        break;
      case 'attack':
        s.mode = 'attack';
        s.killsLeft = o.all ? 99 : 1;
        s.searchT = 0;
        if (!silent) say(pick(LINES.attack));
        break;
      case 'defend':
        s.mode = 'attack';
        s.killsLeft = 99;
        s.searchT = 0;
        if (!silent) say(pick(LINES.defend));
        break;
      case 'stay':
        s.mode = 'stay';
        if (!silent) say(pick(LINES.stay));
        break;
      case 'dismiss':
        s.mode = 'leave';
        s.leaveT = 0;
        if (!silent) say(pick(LINES.dismiss));
        break;
    }
  };

  useEffect(() => {
    allyRegistry.set(id, { id, data, hostileUntil: 0 });
    applyOrder(firstOrder);
    return () => {
      allyRegistry.delete(id);
      const st = S.current;
      const hold = st.seat ?? st.reserved;
      if (hold) seatTaken.get(hold.carId)?.delete(hold.name);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    actor.setInspectExtra(() => [
      ['alleato', S.current.mode],
      ['bersaglio', S.current.target?.id ?? '-'],
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groundOf = (x: number, z: number) => getTerrainHeight(x, z) + getRoadOffset(x, z);
  const idleOffset = useMemo(() => (index % 3) - 1, [index]);

  useFrame((_state, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const s = S.current;
    const pos = data.position;
    const res = actor.beginFrame(delta, pos);

    if (res === 'dead') {
      if (!s.deadHandled) {
        s.deadHandled = true;
        pistol.setVisible(false);
        allyRegistry.delete(id);
        say(pick(LINES.die));
      }
      if (actor.deadFor() > CORPSE_S) {
        actor.ragdoll.deactivate();
        setGone(true);
        onGone(id);
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
    const now = performance.now() / 1000;
    const dxP = pp[0] - pos.x;
    const dzP = pp[2] - pos.z;
    const distP = Math.hypot(dxP, dzP);

    // velocita' e direzione del giocatore: dove mettersi "dietro di lui"
    if (delta > 0) {
      const vx = (pp[0] - s.prevPX) / delta;
      const vz = (pp[2] - s.prevPZ) / delta;
      const sp = Math.hypot(vx, vz);
      s.pSpeed += (Math.min(sp, 15) - s.pSpeed) * Math.min(1, delta * 6);
      if (sp > 0.8 && sp < 25) {
        s.rearX += (-vx / sp - s.rearX) * Math.min(1, delta * 3);
        s.rearZ += (-vz / sp - s.rearZ) * Math.min(1, delta * 3);
      }
      s.prevPX = pp[0];
      s.prevPZ = pp[2];
    }

    // ---- in auto ------------------------------------------------------------------
    const carId = store.currentControllable === 'car' ? store.controlledEntityId : null;
    const carRoot = carId ? _state.scene.getObjectByName(carId) : null;
    const releaseSeat = () => {
      const h = s.seat ?? s.reserved;
      if (h) seatTaken.get(h.carId)?.delete(h.name);
      s.seat = null;
      s.reserved = null;
    };
    if (s.seat) {
      const root = _state.scene.getObjectByName(s.seat.carId);
      const node = root?.getObjectByName(s.seat.name);
      if (!root || !node || carId !== s.seat.carId || s.mode !== 'follow') {
        // il giocatore e' sceso (o altro ordine): si scende dalla portiera del suo posto
        if (root) {
          const n = s.seat.name.slice(-1);
          const ent = root.getObjectByName(`entrance_${n}`);
          if (ent) {
            ent.getWorldPosition(_sp);
            pos.x = _sp.x;
            pos.z = _sp.z;
          }
        }
        releaseSeat();
        s.step = newStepState();
        g.quaternion.identity();
      } else {
        // seduto: segue il sedile dell'auto, fermo, senza fisica
        root.getWorldQuaternion(_sq);
        node.getWorldPosition(_sp);
        _sf.set(0, 0, 1).applyQuaternion(_sq);
        _su.set(0, 1, 0).applyQuaternion(_sq);
        _sp.addScaledVector(_sf, SEAT_FWD).addScaledVector(_su, -SEAT_DOWN);
        g.position.copy(_sp);
        g.quaternion.copy(_sq);
        pos.x = _sp.x;
        pos.z = _sp.z;
        data.rotation = _se.setFromQuaternion(_sq, 'YXZ').y + Math.PI;
        pistol.setVisible(false);
        pistol.update(delta);
        actor.play(actor.hasClip('Sitting_Idle') ? 'Sitting_Idle' : 'Idle_A', 0.2);
        if (s.warm < 3 && ++s.warm >= 3) g.visible = true;
        return;
      }
    }
    // prenotazione del posto: il piu' vicino libero tra i tre dei passeggeri
    let carGoal: THREE.Vector3 | null = null;
    if (carRoot && carId && s.mode === 'follow' && distP < CAR_CHASE_MAX) {
      const taken = takenOf(carId);
      if (s.reserved && (s.reserved.carId !== carId || (taken.get(s.reserved.name) ?? id) !== id)) {
        releaseSeat();
      }
      if (!s.reserved) {
        let bestName: string | null = null;
        let bestD = 1e9;
        for (const name of PASSENGER_SEATS) {
          if (taken.has(name) || !carRoot.getObjectByName(name)) continue;
          const ent = carRoot.getObjectByName(`entrance_${name.slice(-1)}`) ?? carRoot.getObjectByName(name)!;
          ent.getWorldPosition(_sp);
          const d = Math.hypot(_sp.x - pos.x, _sp.z - pos.z);
          if (d < bestD) {
            bestD = d;
            bestName = name;
          }
        }
        if (bestName) {
          taken.set(bestName, id);
          s.reserved = { carId, name: bestName };
        }
      }
      if (s.reserved) {
        const ent = carRoot.getObjectByName(`entrance_${s.reserved.name.slice(-1)}`) ?? carRoot.getObjectByName(s.reserved.name)!;
        carGoal = ent.getWorldPosition(new THREE.Vector3());
        carRoot.getWorldPosition(_sp);
        if (Math.hypot(_sp.x - pos.x, _sp.z - pos.z) < BOARD_DIST || Math.hypot(carGoal.x - pos.x, carGoal.z - pos.z) < 1.2) {
          // sale
          s.seat = s.reserved;
          s.reserved = null;
          s.moving = false;
          return;
        }
      }
    } else if (s.reserved) {
      releaseSeat();
    }

    // ---- nuovi ordini dalla chat ----------------------------------------
    if (store.playerMessage && store.playerMessage !== s.lastMsg) {
      s.lastMsg = store.playerMessage;
      if (distP < HEAR_DIST) {
        const o = parseOrder(store.playerMessage);
        if (o && !(o.kind === 'follow' && s.mode === 'follow')) applyOrder(o);
      }
    }

    // ---- bersaglio ------------------------------------------------------------
    const gy = groundOf(pos.x, pos.z);
    if (s.mode === 'attack') {
      if (s.target && (s.target.isDead || s.target.hp <= 0)) {
        s.target = null;
        s.killsLeft--;
        if (s.killsLeft <= 0) {
          say(pick(LINES.done));
          applyOrder({ kind: 'follow', target: 'any', all: false }, true);
        }
      }
      // il bersaglio e' diventato un altro corpo (un passante colpito si trasforma
      // in nemico) o e' sparito: se ne cerca uno nuovo, senza contarlo come morto
      if (s.target && !cityOpponents.includes(s.target)) s.target = null;
      if (s.mode === 'attack' && !s.target) {
        s.searchT -= delta;
        if (s.searchT <= 0) {
          s.searchT = s.order.kind === 'defend' ? 0.7 : 0.4;
          let best: FighterData | null = null;
          let bd = TARGET_SEARCH_DIST * TARGET_SEARCH_DIST;
          for (const o of cityOpponents) {
            if (o.isDead || o.id === id || !matches(o, s.order, pp)) continue;
            const d2 = (o.position.x - pos.x) ** 2 + (o.position.z - pos.z) ** 2;
            if (d2 < bd) {
              bd = d2;
              best = o;
            }
          }
          s.target = best;
          if (!best && s.order.kind !== 'defend') {
            say(pick(LINES.none));
            applyOrder({ kind: 'follow', target: 'any', all: false }, true);
          }
        }
      }
    }

    // ---- dove andare -----------------------------------------------------------
    let goalX = pos.x;
    let goalZ = pos.z;
    let speed = 0;
    let faceYaw: number | null = null;
    let look = false;
    const attacking = s.mode === 'attack' && !!s.target;

    if (s.mode === 'leave') {
      s.leaveT += delta;
      goalX = pos.x - dxP;
      goalZ = pos.z - dzP;
      speed = WALK;
      if (s.leaveT > 4.5) {
        actor.ragdoll.deactivate();
        setGone(true);
        onGone(id);
        return;
      }
    } else if (attacking) {
      const t = s.target!;
      const tdx = t.position.x - pos.x;
      const tdz = t.position.z - pos.z;
      const td = Math.hypot(tdx, tdz);
      faceYaw = Math.atan2(tdx, tdz);
      s.fireCd -= delta;
      _aimAt.set(t.position.x, groundOf(t.position.x, t.position.z) + 1.2, t.position.z);
      const clear = td < FIRE_RANGE && hasLineOfSight(world, rapier, pos.x, gy + 1.6, pos.z, _aimAt, id);
      if (!clear) {
        goalX = t.position.x;
        goalZ = t.position.z;
        speed = td > 8 ? RUN : JOG;
        faceYaw = null;
      } else {
        // a tiro: si ferma, mira e spara
        if (s.shootAnim > 0) s.shootAnim -= delta;
        if (s.reloadT > 0) s.reloadT -= delta;
        const err = Math.abs(wrap(faceYaw - g.rotation.y));
        if (s.fireCd <= 0 && s.reloadT <= 0 && err < 0.35) {
          s.fireCd = FIRE_INTERVAL + Math.random() * 0.4;
          const targetId = t.id;
          npcFire({
            world,
            rapier,
            pistol,
            shooterId: id,
            target: _aimAt,
            spread: SPREAD,
            damage: DAMAGE,
            canHurt: (owner) => owner === targetId,
            onHurt: (victim, killed) => reportHit(victim, killed),
          });
          if (t.team.startsWith('POLICE')) {
            const reg = allyRegistry.get(id);
            if (reg) reg.hostileUntil = now + 8;
          }
          if (actor.hasClip('Pistol_Shoot')) {
            actor.play('Pistol_Shoot', 0.05, false);
            s.shootAnim = Math.min(0.45, actor.clipDuration('Pistol_Shoot'));
          }
          // caricatore vuoto: ricarica
          if (++s.shots >= 10 && actor.hasClip('Pistol_Reload')) {
            s.shots = 0;
            s.reloadT = Math.min(2.2, actor.clipDuration('Pistol_Reload'));
          }
        }
      }
    } else if (s.mode === 'stay') {
      if (distP < 8) faceYaw = Math.atan2(dxP, dzP);
      look = distP > 8;
    } else {
      // seguire: un posto dietro al giocatore, ognuno il suo (o, se il giocatore e'
      // in auto e c'e' posto, la portiera del proprio sedile)
      const spread = (idleOffset * 0.75 + (index === 0 ? 0.35 : 0)) * 1;
      const ca = Math.cos(spread);
      const sa = Math.sin(spread);
      const rx = s.rearX * ca - s.rearZ * sa;
      const rz = s.rearX * sa + s.rearZ * ca;
      goalX = carGoal ? carGoal.x : pp[0] + rx * FOLLOW_R;
      goalZ = carGoal ? carGoal.z : pp[2] + rz * FOLLOW_R;
      const gd = Math.hypot(goalX - pos.x, goalZ - pos.z);

      // troppo lontano (o il giocatore e' in auto e ha tirato dritto): si riporta vicino
      if (distP > WARP_DIST) {
        s.sinceNear += delta;
        if (s.sinceNear > 1.5) {
          pos.x = goalX;
          pos.z = goalZ;
          s.sinceNear = 0;
        }
      } else s.sinceNear = 0;

      if (s.moving ? gd > 0.9 : gd > 1.9) {
        s.moving = true;
        const need = s.pSpeed + (gd - 1.5);
        speed = gd > 16 || need > 6 ? RUN : need > 2.6 ? JOG : WALK;
      } else {
        s.moving = false;
        if (distP < 12 && distP > 0.5) faceYaw = Math.atan2(dxP, dzP);
      }
    }

    // ---- passo con fisica ----------------------------------------------------
    let marchYaw: number | null = null;
    if (speed > 0) marchYaw = stepToward(actor, pos, s.step, goalX, goalZ, speed, delta);
    const wantYaw = faceYaw ?? marchYaw;
    if (wantYaw !== null) g.rotation.y += wrap(wantYaw - g.rotation.y) * Math.min(1, delta * (faceYaw !== null ? 10 : 8));

    // ---- animazione ------------------------------------------------------------
    pistol.setVisible(attacking);
    pistol.update(delta);
    if (s.shootAnim <= 0) {
      if (s.reloadT > 0 && marchYaw === null) {
        actor.play('Pistol_Reload', 0.1, false);
      } else if (marchYaw !== null) {
        if (speed > 2) actor.play(RUN_CLIP, 0.2, true, timeScaleFor(RUN_CLIP, speed));
        else {
          const wc = actor.hasClip('Walk') ? 'Walk' : 'Idle_A';
          actor.play(wc, 0.25, true, speed / (WALK_BASE_SPEED[wc] ?? 0.73));
        }
      } else if (attacking) {
        actor.play(actor.hasClip('Pistol_Aim_Neutral') ? 'Pistol_Aim_Neutral' : actor.hasClip('Pistol_Idle') ? 'Pistol_Idle' : 'Idle_A', 0.2);
      } else if (look && actor.hasClip(LOOK_CLIP)) {
        actor.play(LOOK_CLIP, 0.3);
      } else {
        // fermo accanto al giocatore: ogni tanto un gesto (annuisce, ascolta, braccia conserte)
        const v = Math.floor(performance.now() / 8000 + id.length * 3) % 5;
        const clip = v === 0 ? 'Head Nod' : v === 1 ? 'Idle Listening' : v === 2 ? 'Idle_FoldArms' : 'Idle_A';
        actor.play(actor.hasClip(clip) ? clip : 'Idle_A', 0.3);
      }
    }

    g.position.set(pos.x, groundOf(pos.x, pos.z), pos.z);
    data.rotation = g.rotation.y + Math.PI;
    // visibile solo dopo un paio di frame animati: mai un frame a T alla comparsa
    if (s.warm < 3 && ++s.warm >= 3) g.visible = true;
  });

  if (gone) return null;
  return (
    <>
      <group ref={groupRef} visible={false} position={[initialPosition[0], groundOf(initialPosition[0], initialPosition[2]), initialPosition[2]]}>
        <primitive object={actor.clone} />
        <SpeechBubble message={message} position={[0, 2.4, 0]} />
      </group>
      <EnemyHealthBar data={data} maxHp={MAX_HP} />
    </>
  );
};

export default AllyNpc;
