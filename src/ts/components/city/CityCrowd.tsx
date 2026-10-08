import React, { useCallback, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { vehicleBodyHandles } from '../Vehicles/vehicleRegistry';
import { useStore } from '../../store';
import Enemy from '../Enemy';
import CrowdPedestrian from './CrowdPedestrian';
import CrowdInstances from './CrowdInstances';
import NpcInspector from '../UI/NpcInspector';
import {
  assignCrowdSlots,
  crowdAgents,
  CROWD_FULL_SLOTS,
  reviveCrowdAgent,
  stepCrowd,
  type CrowdAgent,
  type CrowdObstacle,
} from './crowdSim';

// La folla della citta': simulazione leggera di tutti gli agenti, pool di
// corpi veri per i vicini, sagome instanziate per gli altri, e i passanti
// diventati nemici (Enemy.tsx al posto del passante finche' non rinuncia o
// muore, poi l'agente torna a camminare).

const ASSIGN_EVERY_S = 0.2;

const Crowd: React.FC = () => {
  const [enemies, setEnemies] = useState<Array<{ id: string; agentId: number; position: [number, number, number]; hp?: number }>>([]);
  const acc = useRef(ASSIGN_EVERY_S);
  const { world } = useRapier();
  const obstacles = useRef<CrowdObstacle[]>([]);

  useFrame((state, dt) => {
    const st = useStore.getState();
    // vicino a chi? al giocatore (anche in auto/drone: playerPos segue il
    // veicolo guidato) e alla telecamera, il piu' vicino dei due
    const pp = st.playerPos;
    const cam = state.camera.position;
    const camFar = Math.hypot(cam.x - pp[0], cam.z - pp[2]) > 40;
    // da evitare: il giocatore a piedi e le auto (quelle in movimento fanno aspettare)
    const obs = obstacles.current;
    obs.length = 0;
    if (st.currentControllable === 'player') obs.push({ x: pp[0], z: pp[2], r: 0.45, moving: false });
    for (const h of vehicleBodyHandles) {
      const b = world.getRigidBody(h);
      if (!b) continue;
      const t = b.translation();
      const v = b.linvel();
      obs.push({ x: t.x, z: t.z, r: 2.2, moving: v.x * v.x + v.z * v.z > 1 });
    }
    stepCrowd(Math.min(dt, 0.1), camFar ? cam.x : pp[0], camFar ? cam.z : pp[2], obs);
    acc.current += dt;
    if (acc.current >= ASSIGN_EVERY_S) {
      acc.current = 0;
      assignCrowdSlots();
    }
  });

  const handleBecomeEnemy = useCallback((agent: CrowdAgent, position: [number, number, number], hp?: number) => {
    setEnemies((prev) =>
      prev.some((e) => e.agentId === agent.id) ? prev : [...prev, { id: `crowd-enemy-${agent.id}`, agentId: agent.id, position, hp }]
    );
  }, []);
  const handleEnemyGiveUp = useCallback((id: string) => {
    setEnemies((prev) => {
      const e = prev.find((x) => x.id === id);
      if (e) {
        const a = crowdAgents.find((x) => x.id === e.agentId);
        if (a) reviveCrowdAgent(a);
      }
      return prev.filter((x) => x.id !== id);
    });
  }, []);

  if (import.meta.env.DEV) (window as any).__crowd = { agents: crowdAgents, enemies };

  return (
    <>
      <CrowdInstances />
      <NpcInspector />
      {Array.from({ length: CROWD_FULL_SLOTS }, (_, s) => (
        <CrowdPedestrian key={s} slot={s} onBecomeEnemy={handleBecomeEnemy} />
      ))}
      {enemies.map((e) => (
        <Enemy key={e.id} id={e.id} initialPosition={e.position} initialHp={e.hp} onGiveUp={handleEnemyGiveUp} />
      ))}
    </>
  );
};

export default Crowd;
