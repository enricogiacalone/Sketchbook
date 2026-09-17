import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getTerrainHeight } from './Terrain';
import { getRoadOffset } from './Road';
import { HealingItemData } from './SquadArenaTypes';

interface CombatMedkitProps {
  item: HealingItemData;
  globalSpeed: number;
}

// Ported verbatim from simulation-citta's HealingItem: a spinning, bobbing
// green pickup that CombatSoldier's low-hp fighters run toward. Disappears
// while item.active is false (consumed, waiting on item.respawnTimer --
// see CombatSoldier.tsx).
const CombatMedkit: React.FC<CombatMedkitProps> = ({ item, globalSpeed }) => {
  const groupRef = useRef<THREE.Group>(null);
  // Static pickup spot -- same one-time-per-position groundY as CombatTower.
  const groundY = useMemo(
    () => getTerrainHeight(item.position.x, item.position.z) + getRoadOffset(item.position.x, item.position.z),
    [item]
  );

  useFrame((state, delta) => {
    if (!item.active) return;
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 2.0 * globalSpeed;
      groupRef.current.position.y = groundY + item.position.y + Math.sin(state.clock.elapsedTime * 4) * 0.08;
    }
  });

  if (!item.active) return null;

  return (
    <group ref={groupRef} position={[item.position.x, groundY + item.position.y, item.position.z]}>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[0.35, 0.35, 0.35]} />
        <meshStandardMaterial color="#10b981" roughness={0.2} emissive="#059669" emissiveIntensity={0.6} />
      </mesh>
      <pointLight color="#10b981" intensity={2} distance={2} />
    </group>
  );
};

export default CombatMedkit;
