import React, { useMemo } from 'react';
import Soldier from './Environment/Soldier';
import CombatArena from './Environment/CombatArena';
import { CITY_LAYOUT } from './Environment/City';

// Places the NPCs ported from simulation-citta:
// - `Soldier` (from "AgentSoldier"): most patrol the streets like the
//   ambient crowd in Pedestrian.tsx, but a few instead climb an actual
//   building's stairwell to the roof and back down, on a loop -- the
//   closer match to AgentSoldier's original floor-to-floor waypoint
//   routes, now walking this city's own procedurally-generated buildings
//   (City.tsx) instead of the original's one hardcoded demo building. See
//   Soldier.tsx / BuildingClimb.ts.
// - `CombatArena` (from "RiggedCitizen" / CombatArenaSimulation), a
//   self-contained little battle royale off to one side of the city --
//   red vs blue fighters duel, chase medkits and capture towers on their
//   own. See CombatArena.tsx/CombatSoldier.tsx for what that ported.
const PATROL_COUNT = 4;
const CLIMBER_COUNT = 3;
const SPAWN_RADIUS = 70;
const MIN_SEGMENT_LENGTH = 6;
const MAX_SEGMENT_LENGTH = 16;

function randomSegment() {
  const x1 = (Math.random() - 0.5) * 2 * SPAWN_RADIUS;
  const z1 = (Math.random() - 0.5) * 2 * SPAWN_RADIUS;
  const angle = Math.random() * Math.PI * 2;
  const length = MIN_SEGMENT_LENGTH + Math.random() * (MAX_SEGMENT_LENGTH - MIN_SEGMENT_LENGTH);
  const x2 = x1 + Math.cos(angle) * length;
  const z2 = z1 + Math.sin(angle) * length;
  return { x1, z1, x2, z2 };
}

const SoldierSpawner: React.FC = () => {
  const patrolSoldiers = useMemo(
    () => Array.from({ length: PATROL_COUNT }, (_, i) => ({ id: `soldier-${i}`, phase: Math.random(), speed: 1.2 + Math.random() * 0.6, ...randomSegment() })),
    []
  );

  // Buildings tall enough to actually see climb (numFloors > 2), a handful
  // picked at random -- if the city ever generates fewer than that, this
  // just climbs whatever multi-floor buildings exist.
  const climbers = useMemo(() => {
    const candidates = CITY_LAYOUT.buildings.filter((b) => b.numFloors > 2);
    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, CLIMBER_COUNT).map((building, i) => ({ id: `soldier-climber-${i}`, building }));
  }, []);

  return (
    <group>
      {patrolSoldiers.map((s) => (
        <Soldier key={s.id} id={s.id} x1={s.x1} z1={s.z1} x2={s.x2} z2={s.z2} speed={s.speed} phase={s.phase} />
      ))}
      {climbers.map((c) => (
        <Soldier key={c.id} id={c.id} building={c.building} speed={1.3} />
      ))}
      <CombatArena />
    </group>
  );
};

export default SoldierSpawner;
