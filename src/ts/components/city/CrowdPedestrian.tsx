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
import { getTerrainHeight } from '../Environment/Terrain';
import { getRoadOffset } from '../Environment/Road';

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
  const lastPlayer = useRef<[number, number] | null>(null);

  const [speechMsg, setSpeechMsg] = useState<string>('');
  const lastSpokenTime = useRef(-99);
  const lastCheckTime = useRef(0);
  const lastProcessedPlayerMsg = useRef('');
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const customActionRef = useRef<'none' | 'follow' | 'attack'>('none');

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

    // Custom Agent Actions (Smooth Companion Follow Path & Animation)
    if (customActionRef.current === 'follow') {
      a.gone = true;
      const targetX = pp[0] - Math.sin(st.playerYaw || 0) * 1.5;
      const targetZ = pp[2] - Math.cos(st.playerYaw || 0) * 1.5;
      const fdx = targetX - a.x;
      const fdz = targetZ - a.z;
      const fdist = Math.hypot(fdx, fdz);

      if (fdist > 0.8) {
        const speed = 3.2;
        const vx = fdx / fdist;
        const vz = fdz / fdist;
        a.x += vx * speed * delta;
        a.z += vz * speed * delta;
        a.y = getTerrainHeight(a.x, a.z) + getRoadOffset(a.x, a.z);

        const targetYaw = Math.atan2(vx, vz);
        let d = targetYaw - g.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        g.rotation.y += d * Math.min(1, delta * 12);

        a.pause = 0;
        const clip = actor.hasClip('Walk') ? 'Walk' : 'Idle_A';
        actor.play(clip, 0.3, true, speed / (WALK_BASE_SPEED[clip] ?? 0.73));
      } else {
        const idle = actor.hasClip('Idle_A') ? 'Idle_A' : 'Walk';
        actor.play(idle, 0.3);
        const dx = pp[0] - a.x;
        const dz = pp[2] - a.z;
        if (Math.hypot(dx, dz) > 0.01) {
          const targetYaw = Math.atan2(dx, dz);
          let d = targetYaw - g.rotation.y;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          g.rotation.y += d * Math.min(1, delta * 10);
        }
      }
    }

    // Throttled proximity check (every 3 seconds)
    if (canTalk && distSq < 36 && state.clock.elapsedTime - lastCheckTime.current > 3 && !speechMsg) {
      lastCheckTime.current = state.clock.elapsedTime;
      if (state.clock.elapsedTime - lastSpokenTime.current > 20 && Math.random() < 0.3) {
        lastSpokenTime.current = state.clock.elapsedTime;
        st.setActiveNpcId(npcId);
        resetConversationTimeout(a);
        
        fetch('/api/ollama', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: "Sei un passante NPC nella città 3D di Sketchbook. Dì una frase casuale o un saluto spontaneo al giocatore che ti passa vicino in italiano (massimo 10 parole)." })
        })
        .then(res => res.json())
        .then(data => {
          if (data.response) {
            setSpeechMsg(data.response.trim());
            resetConversationTimeout(a);
          } else {
            clearConversation();
          }
        })
        .catch(() => clearConversation());
      }
    }

    // Check if player typed in chat (Ollama Agent Command Processing)
    if (canTalk && distSq < 64 && st.playerMessage && st.playerMessage !== lastProcessedPlayerMsg.current) {
      lastProcessedPlayerMsg.current = st.playerMessage;
      lastSpokenTime.current = state.clock.elapsedTime;
      st.setActiveNpcId(npcId);
      resetConversationTimeout(a);

      fetch('/api/ollama', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          prompt: `Sei un passante NPC intelligente in Sketchbook con percezione del mondo (posizione x=${a.x.toFixed(1)}, z=${a.z.toFixed(1)}). Il giocatore ti ha ordinato: '${st.playerMessage}'. 
          Analizza il comando. Se ti chiede di seguirmi, muoverti o attaccare/uccidere, decidi l'azione.
          Rispondi ESATTAMENTE in formato JSON valido:
          {
            "dialogue": "Tua risposta in-character in italiano (max 12 parole)",
            "action": "none" | "follow" | "attack"
          }` 
        })
      })
      .then(res => res.json())
      .then(data => {
        try {
          let text = data.response || "{}";
          text = text.replace(/```json/g, '').replace(/```/g, '').trim();
          const parsed = JSON.parse(text);
          if (parsed.dialogue) {
            setSpeechMsg(parsed.dialogue.trim());
            resetConversationTimeout(a);
          }
          if (parsed.action === 'follow') {
            customActionRef.current = 'follow';
            a.gone = true;
            console.log('[Ollama Agent] NPC now following player with correct animation and rotation!');
          } else if (parsed.action === 'attack') {
            customActionRef.current = 'attack';
            handled.current = true;
            a.gone = true;
            onBecomeEnemy(a, [a.x, a.y, a.z]);
            release();
          }
        } catch (e) {
          if (data.response) {
            setSpeechMsg(data.response.trim());
            resetConversationTimeout(a);
          }
        }
      })
      .catch(() => clearConversation());
    }

    // If speaking and not following, stop and look at player
    if (speechMsg && customActionRef.current !== 'follow') {
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
    } else if (customActionRef.current !== 'follow') {
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
    if (!speechMsg && customActionRef.current !== 'follow') {
      let d = a.yaw - g.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      g.rotation.y += d * Math.min(1, delta * 8);
    }

    g.position.set(a.x, a.y, a.z);
    data.position.set(a.x, 0, a.z);
    data.rotation = g.rotation.y + Math.PI;

    const lp = lastPlayer.current;
    lastPlayer.current = [pp[0], pp[2]];
    if (st.currentControllable === 'player' && !handled.current && lp && customActionRef.current !== 'follow') {
      const hx = pp[0] - a.x;
      const hz = pp[2] - a.z;
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
      {speechMsg && <SpeechBubble message={speechMsg} position={[0, 2.3, 0]} />}
    </group>
  );
};

export default CrowdPedestrian;
