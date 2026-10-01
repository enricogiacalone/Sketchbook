import React, { useMemo } from 'react';
import { getTerrainHeight } from './Terrain';
import { getRoadOffset } from './Road';
import { CombatPropData } from './SquadArenaTypes';

// Ported verbatim from simulation-citta's PropItem -- decorative
// crates/barrels scattered in the arena that fighters shove past (see the
// obstacle-avoidance push in CombatSoldier.tsx).
const CombatProp: React.FC<{ prop: CombatPropData }> = ({ prop }) => {
  // Static decoration -- same one-time-per-position groundY as CombatTower.
  const groundY = useMemo(
    () => getTerrainHeight(prop.position.x, prop.position.z) + getRoadOffset(prop.position.x, prop.position.z),
    [prop]
  );
  const pos: [number, number, number] = [prop.position.x, groundY + prop.position.y, prop.position.z];
  if (prop.kind === 'CRATE') {
    return (
      <mesh position={pos} castShadow receiveShadow>
        <boxGeometry args={[0.9, 0.9, 0.9]} />
        <meshStandardMaterial color="#854d0e" roughness={0.8} metalness={0.1} />
      </mesh>
    );
  }
  return (
    <group position={pos}>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[0.4, 0.4, 1.0, 16]} />
        <meshStandardMaterial color="#475569" metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.41, 0.41, 0.1, 16]} />
        <meshBasicMaterial color="#eab308" />
      </mesh>
    </group>
  );
};

export default CombatProp;
