import React, { useMemo, useCallback } from 'react';
import * as THREE from 'three';
import Pedestrian from './Pedestrian';
import { cityOpponents } from '../city/cityActors';

const POLICE_WALKER_ROUTES = [
  { id: 'cop-walk-1', x1: -60, z1: -90, x2: -60, z2: 90 },
  { id: 'cop-walk-2', x1: 60, z1: -90, x2: 60, z2: 90 },
  { id: 'cop-walk-3', x1: -90, z1: -60, x2: 90, z2: -60 },
  { id: 'cop-walk-4', x1: -90, z1: 60, x2: 90, z2: 60 },
  { id: 'cop-walk-5', x1: -120, z1: -120, x2: -120, z2: 120 },
  { id: 'cop-walk-6', x1: 120, z1: -120, x2: 120, z2: 120 },
];

const PoliceWalkers: React.FC = () => {
  const handleBecomeEnemy = useCallback((id: string, pos: [number, number, number], hp = 60) => {
    if (!cityOpponents.some((o) => o.id === id)) {
      cityOpponents.push({
        id,
        team: 'POLICE_ENEMY',
        name: 'Agente',
        position: new THREE.Vector3(pos[0], pos[1], pos[2]),
        rotation: 0,
        isAttacking: false,
        duelTimer: 0,
        attackLock: 0,
        currentAnim: '',
        hp,
        isDead: false,
        animCatalog: null,
        state: 'idle',
        triggerHit: null,
        hitFromX: 0,
        hitFromZ: 0,
        hurtboxHandle: null,
        isPassive: false,
      } as any);
    }
  }, []);

  const cops = useMemo(
    () =>
      POLICE_WALKER_ROUTES.map((r, i) => ({
        ...r,
        speed: 1.3 + (i % 3) * 0.1,
        phase: (i * 0.25) % 1,
      })),
    []
  );

  return (
    <group>
      {cops.map((c) => (
        <Pedestrian
          key={c.id}
          id={c.id}
          x1={c.x1}
          z1={c.z1}
          x2={c.x2}
          z2={c.z2}
          speed={c.speed}
          phase={c.phase}
          color="#0d47a1"
          onBecomeEnemy={handleBecomeEnemy}
        />
      ))}
    </group>
  );
};

export default PoliceWalkers;
