import React, { useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import { Html } from '@react-three/drei';
import { getTerrainHeight } from './Terrain';
import { getRoadOffset } from './Road';
import { TowerData, FighterData } from './SquadArenaTypes';

interface CombatTowerProps {
  tower: TowerData;
  fighters: FighterData[];
  globalSpeed: number;
}

const COLOR_MAP: Record<string, string> = { NEUTRAL: '#94a3b8', BLUE: '#38bdf8', RED: '#ef4444' };

// Ported near-verbatim from simulation-citta's TowerStructure
// (Combat Arena, TERRITORY_CONTROL mode): whichever team has fighters
// standing inside the ring and the other team doesn't slowly captures it;
// contested (both teams present) or empty just holds. tower.owner/progress
// are mutated in place on the shared TowerData object (see
// CombatArena.tsx) -- the local progress/owner state here exists only to
// re-render the label text and ring/beacon color.
const CombatTower: React.FC<CombatTowerProps> = ({ tower, fighters, globalSpeed }) => {
  // "voglio estendere il loro ground a tutta la citta" -- towers are now
  // scattered across every arena cluster (see CombatArena.tsx) instead of
  // sharing one arena-center groundY constant; a tower never moves, so
  // its own terrain height only needs computing once, from its own spot.
  const groundY = useMemo(
    () => getTerrainHeight(tower.position.x, tower.position.z) + getRoadOffset(tower.position.x, tower.position.z),
    [tower]
  );
  const [progress, setProgress] = useState(0);
  const [owner, setOwner] = useState<string>('NEUTRAL');

  useFrame((_state, delta) => {
    let blueCount = 0;
    let redCount = 0;

    fighters.forEach((f) => {
      if (f.isDead) return;
      if (f.position.distanceTo(tower.position) <= tower.radius) {
        if (f.team === 'BLUE') blueCount++;
        if (f.team === 'RED') redCount++;
      }
    });

    if (blueCount > 0 && redCount === 0) {
      if (tower.owner === 'BLUE') {
        tower.progress = Math.min(100, tower.progress + delta * 20 * globalSpeed);
      } else {
        tower.progress -= delta * 30 * globalSpeed;
        if (tower.progress <= 0) {
          tower.owner = 'BLUE';
          tower.progress = 10;
        }
      }
    } else if (redCount > 0 && blueCount === 0) {
      if (tower.owner === 'RED') {
        tower.progress = Math.min(100, tower.progress + delta * 20 * globalSpeed);
      } else {
        tower.progress -= delta * 30 * globalSpeed;
        if (tower.progress <= 0) {
          tower.owner = 'RED';
          tower.progress = 10;
        }
      }
    }

    setProgress(Math.floor(tower.progress));
    setOwner(tower.owner);
  });

  const color = COLOR_MAP[owner] ?? COLOR_MAP.NEUTRAL;

  return (
    <group position={[tower.position.x, groundY + tower.position.y, tower.position.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[tower.radius - 0.2, tower.radius, 32]} />
        <meshBasicMaterial color={color} opacity={0.6} transparent />
      </mesh>
      <mesh position={[0, 1.5, 0]}>
        <cylinderGeometry args={[1.2, 1.5, 3, 16]} />
        <meshStandardMaterial color="#1e293b" roughness={0.5} />
      </mesh>
      <mesh position={[0, 3.5, 0]}>
        <octahedronGeometry args={[0.6]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} />
      </mesh>
      <pointLight position={[0, 3.5, 0]} color={color} intensity={2} distance={5} />
      <Html position={[0, 4.3, 0]} center distanceFactor={10}>
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.9)',
            padding: '4px 8px',
            borderRadius: '6px',
            color: 'white',
            fontSize: '10px',
            textAlign: 'center',
            border: `1px solid ${color}`,
            whiteSpace: 'nowrap',
          }}
        >
          <b>TORRE {owner}</b> ({progress}%)
        </div>
      </Html>
    </group>
  );
};

export default CombatTower;
