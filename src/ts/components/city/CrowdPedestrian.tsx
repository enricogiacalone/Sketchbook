import React, { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../../store';
import { useMannequinActor } from './useMannequinActor';
import {
  crowdSlots,
  reviveCrowdAgent,
  isCowering,
  describeCrowdAgent,
  WALK_BASE_SPEED,
  PANIC_SPEED,
  IDLE_POSE_AT,
  CROWD_RELEASE_DIST,
  type CrowdAgent,
} from './crowdSim';
import { applyFighterHit } from '../Environment/weapons/shootableRegistry';
import { K, KIMODO_CLIPS } from '../../lib/kimodo';
import { CLIP_GROUND_SPEED } from '../Environment/locomotion';

// Un corpo vero del pool della folla: il manichino completo (fisica,
// animazioni, ragdoll, colpibile, investibile) prestato di volta in volta
// all'agente della folla piu' vicino al giocatore (crowd.ts). Senza agente
// "dorme": fuori dal mondo fisico, non disegnato, nessun costo.
// Se lo colpisci o gli vai addosso diventa un nemico (Crowd.tsx monta
// Enemy.tsx al suo posto); se muore resta a terra e poi torna a camminare.

const CORPSE_S = 30;
const CORPSE_FAR_S = 8;
const ANGER_RADIUS = 1.1;
const _hitDir = new THREE.Vector3();
const _hitPt = new THREE.Vector3();

interface Props {
  slot: number;
  onBecomeEnemy: (agent: CrowdAgent, position: [number, number, number], hp?: number) => void;
}

const CrowdPedestrian: React.FC<Props> = ({ slot, onBecomeEnemy }) => {
  const actor = useMannequinActor({
    id: `crowd-slot-${slot}`,
    name: 'Passante',
    team: `CIVILIAN_crowd_${slot}`,
    color: '#607d8b',
    hp: 60,
    x: 0,
    z: -1000,
    enableActiveRagdoll: false,
  });
  const { data } = actor;
  const groupRef = useRef<THREE.Group>(null);
  const agentRef = useRef<CrowdAgent | null>(null);
  const handled = useRef(false); // gia' passato a nemico/morto
  const deadAgent = useRef<CrowdAgent | null>(null);
  // sta camminando (null = appena preso il corpo) e primo frame col corpo
  const walkingRef = useRef<boolean | null>(null);
  const takeoverRef = useRef(false);
  const lastPlayer = useRef<[number, number] | null>(null);

  // nasce addormentato
  useEffect(() => {
    actor.sleep();
    actor.setInspectExtra(() => {
      const a = agentRef.current ?? deadAgent.current;
      return a ? describeCrowdAgent(a) : [['agente', 'nessuno (corpo libero)']];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const release = () => {
    const a = agentRef.current;
    if (a) a.slot = -1;
    if (crowdSlots[slot] === a) crowdSlots[slot] = null;
    agentRef.current = null;
    actor.sleep();
  };

  useFrame((_state, delta) => {
    const g = groupRef.current;
    if (!g) return;

    // morto: il corpo resta a terra il suo tempo, poi l'agente torna a
    // camminare e il corpo torna libero
    if (deadAgent.current) {
      const res = actor.beginFrame(delta, data.position);
      // morto lontano (colpito da lontano): il corpo torna libero prima
      const corpseS = deadAgent.current.dist > CROWD_RELEASE_DIST ? CORPSE_FAR_S : CORPSE_S;
      if (res === 'dead' && actor.deadFor() < corpseS) return;
      actor.revive();
      reviveCrowdAgent(deadAgent.current);
      deadAgent.current = null;
      release();
      return;
    }

    const want = crowdSlots[slot];
    if (want !== agentRef.current) {
      if (agentRef.current && agentRef.current.slot === slot) agentRef.current.slot = -1;
      agentRef.current = want;
      handled.current = false;
      if (!want) {
        actor.sleep();
        return;
      }
      // prende il posto della sagoma: stessa posizione, stesso colore,
      // stessa posa (stesso punto del passo, senza dissolvenza)
      actor.setTint(want.color);
      actor.wake(want.x, want.z);
      g.position.set(want.x, want.y, want.z);
      g.rotation.y = want.yaw;
      walkingRef.current = null;
      takeoverRef.current = true;
      // colpito da lontano quando era una sagoma (crowdSim.promoteCrowdAgent):
      // il colpo arriva al corpo vero adesso
      const h = want.pendingHit;
      if (h) {
        want.pendingHit = null;
        data.hp -= h.damage;
        if (data.hp <= 0) {
          data.hp = 0;
          data.isDead = true;
        } else {
          data.triggerHit = h.seg === 'Head' ? 'Hit_Head' : 'Hit_Chest';
          data.hitReactionHandled = true;
          data.hitFromX = h.point[0] - h.dir[0];
          data.hitFromZ = h.point[2] - h.dir[2];
        }
        _hitDir.set(h.dir[0], h.dir[1], h.dir[2]);
        _hitPt.set(h.point[0], h.point[1], h.point[2]);
        applyFighterHit(data.id, h.seg, _hitDir, h.speed, _hitPt);
      }
    }
    const a = agentRef.current;
    if (!a) return;

    const res = actor.beginFrame(delta, data.position);
    if (res === 'dead') {
      // investito o ucciso sul colpo: l'agente aspetta col suo corpo
      a.gone = true;
      deadAgent.current = a;
      return;
    }
    if (res === 'down') {
      // KO: il corpo resta a terra e si rialza dove e' caduto (poi 'hurt':
      // si arrabbia e diventa un nemico li'); l'agente intanto non conta
      a.pause = Math.max(a.pause, 1);
      actor.holdRoot(g);
      return;
    }
    if (res === 'hurt' && !handled.current) {
      handled.current = true;
      a.gone = true;
      onBecomeEnemy(a, [data.position.x, g.position.y, data.position.z], (data.hp / actor.maxHp()) * 100);
      release();
      return;
    }

    if (a.fear > 0) {
      // panico: accucciato (una volta, poi resta giu') o in fuga
      if (isCowering(a)) {
        if (actor.hasClip(K.cower)) actor.play(K.cower, 0.25, false);
        else actor.play('Idle_A', 0.3);
      } else {
        const run = actor.hasClip(K.panicRun) ? K.panicRun : 'Run_Female';
        const base = KIMODO_CLIPS[run]?.speed || CLIP_GROUND_SPEED[run] || 3.8;
        actor.play(run, 0.2, true, PANIC_SPEED / base);
      }
    } else {
      // fermo (pausa, o in attesa dietro a qualcuno / davanti a un'auto),
      // con un margine per non alternare passo e attesa a ogni frame
      const walking = a.pause <= 0 && (walkingRef.current === false ? a.curSpeed > 0.3 : a.curSpeed > 0.1);
      walkingRef.current = walking;
      const fade = takeoverRef.current ? 0 : 0.3;
      if (!walking) {
        const idle = actor.hasClip(a.idleClip) && a.pause > 0 ? a.idleClip : 'Idle_A';
        // al cambio sagoma -> corpo, dallo stesso punto della posa della sagoma
        actor.play(idle, fade, true, 1, takeoverRef.current ? IDLE_POSE_AT * actor.clipDuration(idle) : undefined);
      } else {
        const clip = actor.hasClip(a.walkClip) ? a.walkClip : 'Walk';
        // stesso punto del ciclo della sagoma (a.gait) quando prende il corpo
        actor.play(
          clip,
          fade,
          true,
          a.curSpeed / (WALK_BASE_SPEED[clip] ?? 0.73),
          takeoverRef.current ? a.gait * actor.clipDuration(clip) : undefined
        );
      }
    }
    takeoverRef.current = false;
    let d = a.yaw - g.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    g.rotation.y += d * Math.min(1, delta * 8);
    g.position.set(a.x, a.y, a.z);
    data.position.set(a.x, 0, a.z);
    // convenzione dei combattenti: avanti = (-sin, -cos)
    data.rotation = g.rotation.y + Math.PI;

    // chi gli va addosso a piedi lo fa arrabbiare -- solo se e' il
    // giocatore a venirgli contro (prima bastava che il passante, camminando,
    // gli passasse vicino: diventava nemico da solo)
    const st = useStore.getState();
    const pp = st.playerPos;
    const lp = lastPlayer.current;
    lastPlayer.current = [pp[0], pp[2]];
    if (st.currentControllable === 'player' && !handled.current && lp) {
      const hx = pp[0] - a.x;
      const hz = pp[2] - a.z;
      // spostamento del giocatore in questo frame verso il passante
      const towards = -((pp[0] - lp[0]) * hx + (pp[2] - lp[1]) * hz) / Math.max(1e-3, Math.hypot(hx, hz));
      if (hx * hx + hz * hz < ANGER_RADIUS * ANGER_RADIUS && towards > 0.5 * delta) {
        handled.current = true;
        a.gone = true;
        onBecomeEnemy(a, [a.x, a.y, a.z]);
        release();
      }
    }
  });

  return (
    <group ref={groupRef} position={[0, -1000, 0]}>
      <primitive object={actor.clone} />
    </group>
  );
};

export default CrowdPedestrian;
