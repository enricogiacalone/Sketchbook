import React, { useEffect, useRef, useState } from 'react';
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
import SpeechBubble from '../UI/SpeechBubble';
import { allyRegistry } from './npcCombat';
import { askOllama, ollamaEnabled } from '../../lib/ollamaNpc';
import { parseOrder, type Order } from './allyOrders';

const CORPSE_S = 30;
const CORPSE_FAR_S = 8;
const _hitDir = new THREE.Vector3();
const _hitPt = new THREE.Vector3();

interface Props {
  slot: number;
  onBecomeEnemy: (agent: CrowdAgent, position: [number, number, number], hp?: number) => void;
  // reclutato in chat ("seguimi", "uccidi..."): diventa un alleato
  onBecomeAlly: (agent: CrowdAgent, position: [number, number, number], hp: number, order: Order) => void;
}

const CrowdPedestrian: React.FC<Props> = ({ slot, onBecomeEnemy, onBecomeAlly }) => {
  const npcId = `crowd-${slot}`;
  const actor = useMannequinActor({
    id: npcId,
    name: 'Passante',
    team: `CIVILIAN_crowd_${slot}`,
    color: '#607d8b',
    hp: 60,
    x: 0,
    z: -1000,
    enableActiveRagdoll: useStore((s) => s.crowdActiveRagdoll),
  });
  const { data } = actor;
  const groupRef = useRef<THREE.Group>(null);
  const agentRef = useRef<CrowdAgent | null>(null);
  const handled = useRef(false);
  const deadAgent = useRef<CrowdAgent | null>(null);
  const walkingRef = useRef<boolean | null>(null);
  const takeoverRef = useRef(false);

  const [speechMsg, setSpeechMsg] = useState<string>('');
  const lastSpokenTime = useRef(-99);
  const lastCheckTime = useRef(0);
  const lastProcessedPlayerMsg = useRef('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeNow = () => {
    const id = useStore.getState().activeNpcId;
    return !!id && id !== npcId;
  };

  const clearConversation = () => {
    setSpeechMsg('');
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    const st = useStore.getState();
    if (st.activeNpcId === npcId) {
      st.setActiveNpcId(null);
    }
  };

  const resetConversationTimeout = (agent: CrowdAgent) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    agent.pause = 30;
    timeoutRef.current = setTimeout(() => {
      agent.pause = 0;
      clearConversation();
    }, 30000);
  };

  useEffect(() => {
    actor.sleep();
    actor.setInspectExtra(() => {
      const a = agentRef.current ?? deadAgent.current;
      return a ? describeCrowdAgent(a) : [['agente', 'nessuno (corpo libero)']];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      const dead = deadAgent.current;
      if (dead) {
        reviveCrowdAgent(dead);
        dead.slot = -1;
        if (crowdSlots[slot] === dead) crowdSlots[slot] = null;
      }
      const a = agentRef.current;
      if (a && a.slot === slot) {
        a.slot = -1;
        a.gone = false;
      }
      if (crowdSlots[slot] === a) crowdSlots[slot] = null;
      clearConversation();
    },
    [slot, npcId]
  );

  const release = () => {
    const a = agentRef.current;
    if (a) {
      a.slot = -1;
      a.gone = false;
    }
    if (crowdSlots[slot] === a) crowdSlots[slot] = null;
    agentRef.current = null;
    actor.sleep();
    clearConversation();
  };

  useFrame((state, delta) => {
    const g = groupRef.current;
    if (!g) return;

    if (deadAgent.current) {
      const res = actor.beginFrame(delta, data.position);
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
      if (agentRef.current && agentRef.current.slot === slot) {
        agentRef.current.slot = -1;
        agentRef.current.gone = false;
      }
      agentRef.current = want;
      handled.current = false;
      if (!want) {
        actor.sleep();
        return;
      }
      actor.setTint(want.color);
      actor.wake(want.x, want.z);
      g.position.set(want.x, want.y, want.z);
      g.rotation.y = want.yaw;
      walkingRef.current = null;
      takeoverRef.current = true;
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
      a.gone = true;
      deadAgent.current = a;
      clearConversation();
      return;
    }
    if (res === 'down') {
      a.pause = Math.max(a.pause, 1);
      actor.holdRoot(g);
      return;
    }
    if (res === 'hurt' && !handled.current) {
      handled.current = true;
      a.gone = true;
      if (crowdSlots[slot] === a) crowdSlots[slot] = null;
      onBecomeEnemy(a, [data.position.x, g.position.y, data.position.z], (data.hp / actor.maxHp()) * 100);
      release();
      return;
    }

    const st = useStore.getState();
    const pp = st.playerPos;
    const hx = pp[0] - a.x;
    const hz = pp[2] - a.z;
    const distSq = hx * hx + hz * hz;

    const activeNpcId = st.activeNpcId;
    const canTalk = !activeNpcId || activeNpcId === npcId;

    // Saluto spontaneo (solo con la chat Ollama accesa, e solo se il modello e' libero)
    if (ollamaEnabled() && canTalk && distSq < 36 && state.clock.elapsedTime - lastCheckTime.current > 3 && !speechMsg) {
      lastCheckTime.current = state.clock.elapsedTime;
      if (state.clock.elapsedTime - lastSpokenTime.current > 20 && Math.random() < 0.3) {
        lastSpokenTime.current = state.clock.elapsedTime;
        void askOllama('Sei un passante in una citta\' 3D. Saluta il giocatore con una frase breve in italiano (max 8 parole).', 'greet').then((r) => {
          if (r && agentRef.current === a && !activeNow()) {
            useStore.getState().setActiveNpcId(npcId);
            setSpeechMsg(r);
            resetConversationTimeout(a);
          }
        });
      }
    }

    // Comando dalla chat (entro 8 m): risponde solo il passante piu' vicino al giocatore
    if (canTalk && distSq < 64 && st.playerMessage && st.playerMessage !== lastProcessedPlayerMsg.current) {
      lastProcessedPlayerMsg.current = st.playerMessage;
      let nearest = true;
      for (const o of crowdSlots) if (o && o !== a && !o.gone && o.dist < a.dist) nearest = false;
      if (nearest) {
        const msg = st.playerMessage;
        const order = parseOrder(msg);
        const recruit = (o: Order) => {
          handled.current = true;
          a.gone = true;
          if (crowdSlots[slot] === a) crowdSlots[slot] = null;
          onBecomeAlly(a, [data.position.x, g.position.y, data.position.z], (data.hp / actor.maxHp()) * 100, o);
          release();
        };
        if (order) {
          // gli ordini li eseguono gli alleati che ho gia'; un nuovo passante si arruola
          // solo se non ce ne sono, o se gli si dice di seguirmi
          if (order.kind === 'follow' || (allyRegistry.size === 0 && (order.kind === 'attack' || order.kind === 'defend'))) {
            recruit(order);
            return;
          }
        } else {
          if (ollamaEnabled()) {
            lastSpokenTime.current = state.clock.elapsedTime;
            st.setActiveNpcId(npcId);
            resetConversationTimeout(a);
            void askOllama(
              `Passante in un gioco 3D. Il giocatore dice: '${msg}'. Rispondi breve in italiano. Se ti chiede di seguirlo action="follow"; se ti chiede di attaccare qualcuno action="attack" e target "police"|"civilian"|"enemy"|"any". Solo JSON: {"dialogue":"max 12 parole","action":"none"|"follow"|"attack","target":"any"}`,
              'chat',
              64
            ).then((resp) => {
              if (!resp) {
                clearConversation();
                return;
              }
              let parsed: any = null;
              try {
                parsed = JSON.parse(resp.replace(/```json/g, '').replace(/```/g, '').trim());
              } catch {
                setSpeechMsg(resp);
                resetConversationTimeout(a);
                return;
              }
              if (parsed.action === 'follow' || parsed.action === 'attack') {
                // (potrebbe essere gia' stato scambiato per un altro corpo nel frattempo)
                if (agentRef.current === a && !handled.current) {
                  const target = ['police', 'civilian', 'enemy', 'any'].includes(parsed.target) ? parsed.target : 'any';
                  recruit({ kind: parsed.action, target, all: false });
                }
              } else if (parsed.dialogue) {
                setSpeechMsg(String(parsed.dialogue).trim());
                resetConversationTimeout(a);
              }
            });
          }
        }
      }
    }

    // If speaking, stop and look at player
    if (speechMsg) {
      a.pause = Math.max(a.pause, 1.5);
      const talkClip = actor.hasClip('Idle_Talking') ? 'Idle_Talking' : 'Idle_A';
      actor.play(talkClip, 0.3);

      const dx = pp[0] - a.x;
      const dz = pp[2] - a.z;
      if (Math.hypot(dx, dz) > 0.01) {
        const wantYaw = Math.atan2(dx, dz);
        let d = wantYaw - g.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        g.rotation.y += d * Math.min(1, delta * 10);
      }
    } else {
      if (a.fear > 0) {
        if (isCowering(a)) {
          if (actor.hasClip(K.cower)) actor.play(K.cower, 0.25, false);
          else actor.play('Idle_A', 0.3);
        } else {
          const runClip = actor.hasClip('Run_Female') ? 'Run_Female' : (actor.hasClip('Walk') ? 'Walk' : 'Idle_A');
          const panicUpper = actor.hasClip(K.panicRun) ? K.panicRun : runClip;
          const base = KIMODO_CLIPS[runClip]?.speed || CLIP_GROUND_SPEED[runClip] || 3.8;
          actor.playSplit(runClip, panicUpper, 0.2, PANIC_SPEED / base);
        }
      } else {
        const walking = a.pause <= 0 && (walkingRef.current === false ? a.curSpeed > 0.3 : a.curSpeed > 0.1);
        walkingRef.current = walking;
        const fade = takeoverRef.current ? 0 : 0.3;
        if (!walking) {
          const idle = actor.hasClip(a.idleClip) && a.pause > 0 ? a.idleClip : 'Idle_A';
          actor.play(idle, fade, true, 1, takeoverRef.current ? IDLE_POSE_AT * actor.clipDuration(idle) : undefined);
        } else {
          const clip = actor.hasClip(a.walkClip) ? a.walkClip : 'Walk';
          actor.play(
            clip,
            fade,
            true,
            a.curSpeed / (WALK_BASE_SPEED[clip] ?? 0.73),
            takeoverRef.current ? a.gait * actor.clipDuration(clip) : undefined
          );
        }
      }
    }

    takeoverRef.current = false;
    if (!speechMsg) {
      let d = a.yaw - g.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      g.rotation.y += d * Math.min(1, delta * 8);
    }

    g.position.set(a.x, a.y, a.z);
    data.position.set(a.x, 0, a.z);
    data.rotation = g.rotation.y + Math.PI;
  });

  return (
    <group ref={groupRef} position={[0, -1000, 0]}>
      <primitive object={actor.clone} />
      {speechMsg && <SpeechBubble message={speechMsg} position={[0, 2.3, 0]} />}
    </group>
  );
};

export default CrowdPedestrian;
