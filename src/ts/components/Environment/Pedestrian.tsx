import React, { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getTerrainHeight } from './Terrain';
import { getRoadOffset } from './Road';
import { useStore } from '../../store';
import { useMannequinActor } from '../city/useMannequinActor';
import SpeechBubble from '../UI/SpeechBubble';

interface PedestrianProps {
  id: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  speed?: number;
  phase?: number;
  color?: string;
  onBecomeEnemy: (id: string, position: [number, number, number], hp?: number) => void;
}

const CIVILIAN_COLORS = ['#8d6e63', '#607d8b', '#9e9d24', '#6d4c41', '#78909c', '#a1887f', '#5d4037', '#827717', '#455a64'];
const WALK_CLIPS = ['Walk'];
const IDLE_CLIPS = ['Idle_A', 'Idle_TalkingPhone', 'Idle_FoldArms', 'Idle_Talking', 'Idle_Subtle'];
const WALK_BASE_SPEED: Record<string, number> = { Walk: 0.73 };
const CORPSE_S = 30;
const ANGER_RADIUS = 1.1;

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const Pedestrian: React.FC<PedestrianProps> = ({ id, x1, z1, x2, z2, speed = 1.2, phase = 0, color: customColor, onBecomeEnemy }) => {
  const h = hash(id);
  const color = customColor ?? CIVILIAN_COLORS[h % CIVILIAN_COLORS.length];
  const walkClip = WALK_CLIPS[h % WALK_CLIPS.length];
  const idleClip = IDLE_CLIPS[(h >> 3) % IDLE_CLIPS.length];
  const walkSpeed = Math.min(1.05, speed * 0.85);

  const start = useMemo(() => new THREE.Vector3(x1, 0, z1), [x1, z1]);
  const end = useMemo(() => new THREE.Vector3(x2, 0, z2), [x2, z2]);
  const segmentLength = useMemo(() => start.distanceTo(end), [start, end]);
  const p0 = useMemo(() => new THREE.Vector3().lerpVectors(start, end, phase), [start, end, phase]);

  const actor = useMannequinActor({
    id,
    name: 'Passante',
    team: `CIVILIAN_${id}`,
    color,
    hp: 60,
    x: p0.x,
    z: p0.z,
    enableActiveRagdoll: false,
  });
  const { data } = actor;

  const groupRef = useRef<THREE.Group>(null);
  const t = useRef(phase);
  const dir = useRef(1);
  const pauseTimer = useRef(0);
  const becameEnemy = useRef(false);
  const scratch = useRef(new THREE.Vector3());

  const [speechMsg, setSpeechMsg] = useState<string>('');
  const lastSpokenTime = useRef(-99);
  const lastProcessedPlayerMsg = useRef('');

  useFrame((state, delta) => {
    const g = groupRef.current;
    if (!g || segmentLength < 0.01) return;
    const res = actor.beginFrame(delta, data.position);

    if (res === 'dead') {
      if (actor.deadFor() > CORPSE_S) {
        actor.revive();
        t.current = 0;
        dir.current = 1;
      } else return;
    }

    if (res === 'down') {
      actor.holdRoot(g);
      return;
    }

    if (res === 'hurt' && !becameEnemy.current) {
      becameEnemy.current = true;
      onBecomeEnemy(id, [data.position.x, g.position.y, data.position.z], (data.hp / actor.maxHp()) * 100);
      return;
    }

    const st = useStore.getState();
    const pp = st.playerPos;
    const pos = scratch.current.lerpVectors(start, end, t.current);
    const y = getTerrainHeight(pos.x, pos.z) + getRoadOffset(pos.x, pos.z);

    // If speaking, stop, play talking animation, and look at player
    if (speechMsg) {
      pauseTimer.current = Math.max(pauseTimer.current, 1.0);
      const talkClip = actor.hasClip('Idle_Talking') ? 'Idle_Talking' : idleClip;
      actor.play(talkClip, 0.3);

      // Look at player
      const dx = pp[0] - pos.x;
      const dz = pp[2] - pos.z;
      if (Math.hypot(dx, dz) > 0.01) {
        const want = Math.atan2(dx, dz);
        let a = want - g.rotation.y;
        a = Math.atan2(Math.sin(a), Math.cos(a));
        g.rotation.y += a * Math.min(1, delta * 10);
      }
    } else if (pauseTimer.current > 0) {
      pauseTimer.current -= delta;
      actor.play(idleClip, 0.3);
    } else {
      t.current += (dir.current * walkSpeed * delta) / segmentLength;
      if (t.current >= 1) {
        t.current = 1;
        dir.current = -1;
        pauseTimer.current = 0.2 + Math.random() * 0.5;
      } else if (t.current <= 0) {
        t.current = 0;
        dir.current = 1;
        pauseTimer.current = 0.2 + Math.random() * 0.5;
      }
      const clip = actor.hasClip(walkClip) ? walkClip : 'Walk';
      actor.play(clip, 0.3, true, walkSpeed / (WALK_BASE_SPEED[clip] ?? 0.73));
    }

    if (!speechMsg) {
      const facing = dir.current >= 0 ? end : start;
      const dx = facing.x - pos.x;
      const dz = facing.z - pos.z;
      if (Math.hypot(dx, dz) > 0.01) {
        const want = Math.atan2(dx, dz);
        let a = want - g.rotation.y;
        a = Math.atan2(Math.sin(a), Math.cos(a));
        g.rotation.y += a * Math.min(1, delta * 8);
      }
    }

    g.position.set(pos.x, y, pos.z);
    data.position.set(pos.x, 0, pos.z);
    data.rotation = g.rotation.y + Math.PI;

    const hx = pp[0] - pos.x;
    const hz = pp[2] - pos.z;
    const distSq = hx * hx + hz * hz;

    // Proximity greeting (within 6m, random chance / cooldown)
    if (distSq < 36 && state.clock.elapsedTime - lastSpokenTime.current > 10 && !speechMsg && Math.random() < 0.05) {
      lastSpokenTime.current = state.clock.elapsedTime;
      pauseTimer.current = 8;
      console.log('[Ollama NPC] Pedestrian near player, requesting greeting...', id);
      fetch('/api/ollama', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: "Sei un passante NPC nella città 3D di Sketchbook. Dì una frase casuale o un commento spontaneo al giocatore che ti passa vicino in italiano (massimo 10 parole)." })
      })
      .then(res => res.json())
      .then(data => {
        console.log('[Ollama NPC] Greeting response:', data);
        if (data.response) {
          setSpeechMsg(data.response.trim());
          setTimeout(() => setSpeechMsg(''), 7000);
        }
      })
      .catch((err) => console.error('[Ollama NPC] Greeting error:', err));
    }

    // Check if player typed in chat (within 8m)
    if (distSq < 64 && st.playerMessage && st.playerMessage !== lastProcessedPlayerMsg.current) {
      lastProcessedPlayerMsg.current = st.playerMessage;
      lastSpokenTime.current = state.clock.elapsedTime;
      pauseTimer.current = 9;
      console.log('[Ollama NPC] Pedestrian heard chat:', st.playerMessage, 'from pedestrian', id);
      fetch('/api/ollama', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: `Sei un passante NPC nella città 3D di Sketchbook. Il giocatore ti ha appena scritto in chat: '${st.playerMessage}'. Rispondi in italiano in modo breve e in-character (massimo 15 parole).` })
      })
      .then(res => res.json())
      .then(data => {
        console.log('[Ollama NPC] Chat response:', data);
        if (data.response) {
          setSpeechMsg(data.response.trim());
          setTimeout(() => setSpeechMsg(''), 8000);
        }
      })
      .catch((err) => console.error('[Ollama NPC] Chat error:', err));
    }

    // chi gli va addosso a piedi lo fa arrabbiare
    if (st.currentControllable === 'player' && !becameEnemy.current) {
      if (distSq < ANGER_RADIUS * ANGER_RADIUS) {
        becameEnemy.current = true;
        onBecomeEnemy(id, [pos.x, y, pos.z]);
      }
    }
  });

  return (
    <group ref={groupRef} position={[p0.x, getTerrainHeight(p0.x, p0.z) + getRoadOffset(p0.x, p0.z), p0.z]}>
      <primitive object={actor.clone} />
      {speechMsg && <SpeechBubble message={speechMsg} position={[0, 2.3, 0]} />}
    </group>
  );
};

export default Pedestrian;
