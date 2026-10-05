import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getTerrainHeight } from './Terrain';
import { getRoadOffset } from './Road';
import { useStore } from '../../store';
import { useMannequinActor } from '../city/useMannequinActor';

// Passante: cammina avanti e indietro sul suo tratto di marciapiede, si
// ferma un attimo alle estremita' (telefono, braccia conserte...). E' il
// manichino del giocatore (useMannequinActor): si puo' colpire, cade in
// ragdoll, lo si puo' investire. Se lo colpisci o gli vai addosso diventa
// un nemico (CityDetails.tsx monta Enemy.tsx al suo posto); se muore resta
// a terra un po' e poi torna al suo percorso.

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

// colori "civili" (tinta emissiva sul manichino)
const CIVILIAN_COLORS = ['#8d6e63', '#607d8b', '#9e9d24', '#6d4c41', '#78909c', '#a1887f', '#5d4037', '#827717', '#455a64'];
const WALK_CLIPS = ['Walk', 'Walk_Formal', 'Walk_Female'];
const IDLE_CLIPS = ['Idle_A', 'Idle_TalkingPhone', 'Idle_FoldArms', 'Idle_Talking', 'Idle_Subtle'];
// la velocita' "a terra" delle camminate (m/s, per non far scivolare i piedi)
const WALK_BASE_SPEED: Record<string, number> = { Walk: 0.73, Walk_Formal: 0.8, Walk_Female: 0.75 };
// tempo a terra da morto prima di tornare a camminare
const CORPSE_S = 30;
// vicinanza che lo fa arrabbiare (a piedi; in auto conta l'investimento)
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
  // passo naturale: le camminate del rig sono lente, non accelerarle troppo
  const walkSpeed = Math.min(1.35, speed * 0.85);

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
  });
  const { data } = actor;

  const groupRef = useRef<THREE.Group>(null);
  const t = useRef(phase);
  const dir = useRef(1);
  const pauseTimer = useRef(0);
  const becameEnemy = useRef(false);
  const scratch = useRef(new THREE.Vector3());

  useFrame((_state, delta) => {
    const g = groupRef.current;
    if (!g || segmentLength < 0.01) return;
    const res = actor.beginFrame(delta, data.position);

    if (res === 'dead') {
      if (actor.deadFor() > CORPSE_S) {
        // torna al suo percorso, dall'inizio
        actor.revive();
        t.current = 0;
        dir.current = 1;
      } else return;
    }

    if (res === 'down') {
      // KO: a terra e poi si rialza (poi 'hurt': si arrabbia)
      actor.holdRoot(g);
      return;
    }

    if (res === 'hurt' && !becameEnemy.current) {
      becameEnemy.current = true;
      onBecomeEnemy(id, [data.position.x, g.position.y, data.position.z], (data.hp / actor.maxHp()) * 100);
      return;
    }

    if (pauseTimer.current > 0) {
      pauseTimer.current -= delta;
      actor.play(idleClip, 0.3);
    } else {
      t.current += (dir.current * walkSpeed * delta) / segmentLength;
      if (t.current >= 1) {
        t.current = 1;
        dir.current = -1;
        pauseTimer.current = 1.5 + Math.random() * 2.5;
      } else if (t.current <= 0) {
        t.current = 0;
        dir.current = 1;
        pauseTimer.current = 1.5 + Math.random() * 2.5;
      }
      actor.play(walkClip, 0.3, true, walkSpeed / (WALK_BASE_SPEED[walkClip] ?? 0.75));
    }

    const pos = scratch.current.lerpVectors(start, end, t.current);
    const y = getTerrainHeight(pos.x, pos.z) + getRoadOffset(pos.x, pos.z);
    const facing = dir.current >= 0 ? end : start;
    const dx = facing.x - pos.x;
    const dz = facing.z - pos.z;
    if (Math.hypot(dx, dz) > 0.01) {
      const want = Math.atan2(dx, dz);
      let a = want - g.rotation.y;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      g.rotation.y += a * Math.min(1, delta * 8);
    }
    g.position.set(pos.x, y, pos.z);
    data.position.set(pos.x, 0, pos.z);
    // convenzione dei combattenti: avanti = (-sin, -cos)
    data.rotation = g.rotation.y + Math.PI;

    // chi gli va addosso a piedi lo fa arrabbiare
    const st = useStore.getState();
    if (st.currentControllable === 'player' && !becameEnemy.current) {
      const pp = st.playerPos;
      const hx = pp[0] - pos.x;
      const hz = pp[2] - pos.z;
      if (hx * hx + hz * hz < ANGER_RADIUS * ANGER_RADIUS) {
        becameEnemy.current = true;
        onBecomeEnemy(id, [pos.x, y, pos.z]);
      }
    }
  });

  return (
    <group ref={groupRef} position={[p0.x, getTerrainHeight(p0.x, p0.z) + getRoadOffset(p0.x, p0.z), p0.z]}>
      <primitive object={actor.clone} />
    </group>
  );
};

export default Pedestrian;
