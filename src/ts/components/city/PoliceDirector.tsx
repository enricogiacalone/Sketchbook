import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from '../../store';
import { pickRoadSpawn, stepWanted, wanted } from '../../lib/wanted';
import PoliceOfficer from './PoliceOfficer';

// Dirige la polizia a piedi: le pattuglie sempre in servizio, il livello di
// ricercato (lib/wanted.ts) e i rinforzi che arrivano da lontano, fuori
// vista, in numero crescente con le stelle (a 4-5 stelle anche unita'
// speciali).

const PATROL_ROUTES = [
  { id: 'cop-walk-1', x1: -60, z1: -90, x2: -60, z2: 90 },
  { id: 'cop-walk-2', x1: 60, z1: -90, x2: 60, z2: 90 },
  { id: 'cop-walk-3', x1: -90, z1: -60, x2: 90, z2: -60 },
  { id: 'cop-walk-4', x1: -90, z1: 60, x2: 90, z2: 60 },
  { id: 'cop-walk-5', x1: -120, z1: -120, x2: -120, z2: 120 },
  { id: 'cop-walk-6', x1: 120, z1: -120, x2: 120, z2: 120 },
];

// quanti rinforzi a piedi per stella (oltre alle pattuglie)
const REINFORCEMENTS = [0, 2, 3, 5, 6, 8];
const SPAWN_EVERY_S = 1.6;
const SPAWN_DIST: [number, number] = [62, 90];

interface Reinforcement {
  id: string;
  spawn: [number, number];
  swat: boolean;
}

const PoliceDirector: React.FC = () => {
  const [reinf, setReinf] = useState<Reinforcement[]>([]);
  const seq = useRef(0);
  const acc = useRef(0);
  const reinfRef = useRef(reinf);
  reinfRef.current = reinf;

  const cops = useMemo(
    () => PATROL_ROUTES.map((r, i) => ({ ...r, speed: 1.3 + (i % 3) * 0.1, phase: (i * 0.25) % 1 })),
    []
  );

  const remove = useCallback((id: string) => setReinf((prev) => prev.filter((r) => r.id !== id)), []);

  useFrame((_s, dt) => {
    stepWanted(Math.min(dt, 0.1));
    acc.current += dt;
    if (acc.current < SPAWN_EVERY_S) return;
    acc.current = 0;
    // si chiamano rinforzi solo finche' la polizia ti vede o ti ha appena perso
    if (wanted.level <= 0 || wanted.searching) return;
    const want = REINFORCEMENTS[wanted.level] ?? 0;
    if (reinfRef.current.length >= want) return;
    const pp = useStore.getState().playerPos;
    const d = SPAWN_DIST[0] + Math.random() * (SPAWN_DIST[1] - SPAWN_DIST[0]);
    const p = pickRoadSpawn(pp[0], pp[2], d);
    const n = seq.current++;
    const swat = wanted.level >= 4 && n % 2 === 0;
    setReinf((prev) => [...prev, { id: `cop-reinf-${n}`, spawn: [p.x, p.z], swat }]);
  });

  return (
    <group>
      {cops.map((c) => (
        <PoliceOfficer key={c.id} id={c.id} patrol={c} />
      ))}
      {reinf.map((r) => (
        <PoliceOfficer key={r.id} id={r.id} spawn={r.spawn} swat={r.swat} onRemove={remove} />
      ))}
    </group>
  );
};

export default PoliceDirector;
