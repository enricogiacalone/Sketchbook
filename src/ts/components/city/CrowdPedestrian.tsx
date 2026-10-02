import React, { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../../store';
import { useMannequinActor } from './useMannequinActor';
import { crowdSlots, reviveCrowdAgent, isCowering, WALK_BASE_SPEED, PANIC_SPEED, type CrowdAgent } from './crowdSim';
import { K, KIMODO_CLIPS } from '../../lib/kimodo';
import { CLIP_GROUND_SPEED } from '../Environment/locomotion';

// Un corpo vero del pool della folla: il manichino completo (fisica,
// animazioni, ragdoll, colpibile, investibile) prestato di volta in volta
// all'agente della folla piu' vicino al giocatore (crowd.ts). Senza agente
// "dorme": fuori dal mondo fisico, non disegnato, nessun costo.
// Se lo colpisci o gli vai addosso diventa un nemico (Crowd.tsx monta
// Enemy.tsx al suo posto); se muore resta a terra e poi torna a camminare.

const CORPSE_S = 30;
const ANGER_RADIUS = 1.1;

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
  });
  const { data } = actor;
  const groupRef = useRef<THREE.Group>(null);
  const agentRef = useRef<CrowdAgent | null>(null);
  const handled = useRef(false); // gia' passato a nemico/morto
  const deadAgent = useRef<CrowdAgent | null>(null);

  // nasce addormentato
  useEffect(() => {
    actor.sleep();
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
      if (res === 'dead' && actor.deadFor() < CORPSE_S) return;
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
      // prende il posto della sagoma: stessa posizione, stesso colore
      actor.setTint(want.color);
      actor.wake(want.x, want.z);
      g.position.set(want.x, want.y, want.z);
      g.rotation.y = want.yaw;
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
    } else if (a.pause > 0) {
      actor.play(actor.hasClip(a.idleClip) ? a.idleClip : 'Idle_A', 0.3);
    } else {
      actor.play(a.walkClip, 0.3, true, a.speed / (WALK_BASE_SPEED[a.walkClip] ?? 0.75));
    }
    let d = a.yaw - g.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    g.rotation.y += d * Math.min(1, delta * 8);
    g.position.set(a.x, a.y, a.z);
    data.position.set(a.x, 0, a.z);
    // convenzione dei combattenti: avanti = (-sin, -cos)
    data.rotation = g.rotation.y + Math.PI;

    // chi gli va addosso a piedi lo fa arrabbiare
    const st = useStore.getState();
    if (st.currentControllable === 'player' && !handled.current) {
      const pp = st.playerPos;
      const hx = pp[0] - a.x;
      const hz = pp[2] - a.z;
      if (hx * hx + hz * hz < ANGER_RADIUS * ANGER_RADIUS) {
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
