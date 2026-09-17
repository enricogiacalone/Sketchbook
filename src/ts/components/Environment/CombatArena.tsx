import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import CombatSoldier from './CombatSoldier';
import CombatTower from './CombatTower';
import CombatMedkit from './CombatMedkit';
import CombatProp from './CombatProp';
import { useStore } from '../../store';
import { FighterData, TowerData, HealingItemData, CombatPropData, GameMode } from './SquadArenaTypes';

// Ported from simulation-citta's CombatArenaSimulation -- the part that
// creates the fighters/towers/medkits/props and renders them. Its own
// settings panel (game mode dropdown + fighter-count slider) is now
// CombatArenaGUI.tsx's lil-gui panel, writing into the store, since a
// lil-gui panel lives outside the R3F tree and can't reach this
// component's props directly.
//
// "voglio estendere il loro ground a tutta la citta" -- this used to be ONE
// battle royale huddled off to one side of the city (a single ARENA_CENTER,
// on a flat literal-y=0 plane). Now it's several independent little
// duel "clusters" scattered around.
//
// "perche li hai relegati alle aree verdi? la citta e per loro" -- the
// first version of that citywide spread anchored each cluster on a city
// BLOCK's center (CITY_LAYOUT.courtyards/plazas), which is exactly the
// open patch of park/grass every block leaves empty in the middle (real
// buildings only sit 18-25 units OUT from that center -- see City.tsx's
// layout loop) -- so every cluster silently ended up parked on a lawn
// instead of out among the streets and buildings. Fixed by dropping that
// block-grid anchoring entirely: cluster centers are now plain random
// points across the whole city footprint, the exact same citywide-roam
// technique Soldier.tsx/Pedestrian.tsx already use for their own ambient
// patrols (randomSegment()'s ARENA_SPAWN_RADIUS below matches their own
// SPAWN_RADIUS=70) -- so a duel is just as likely to break out in the
// middle of a street or next to a building as in a park.
//
// Every position below is still kept in the same near-flat LOCAL frame the
// original arena used (y=0/0.4/1.5/...) -- there's no shared `groundY`
// added at render time: each cluster/tower/etc. sits somewhere different
// on this city's (non-flat) terrain, so CombatSoldier/CombatTower/
// CombatMedkit/CombatProp each sample their OWN real terrain height at
// their OWN position instead (see those files).
const ENABLE_TOWERS = true;
const MEDKIT_LIMIT = 5; // -1 would mean unlimited, matching the original's dropdown
const GLOBAL_SPEED = 1.0;
// Same citywide radius Soldier.tsx/Pedestrian.tsx patrol within.
const ARENA_SPAWN_RADIUS = 70;
// However many duel clusters get scattered across that radius -- kept
// modest so this doesn't quietly double the city's NPC budget on top of
// the pedestrians/cars/patrol soldiers already there.
const MAX_CLUSTERS = 5;

function randomCityPoint(): [number, number] {
  return [(Math.random() - 0.5) * 2 * ARENA_SPAWN_RADIUS, (Math.random() - 0.5) * 2 * ARENA_SPAWN_RADIUS];
}

// Splits `total` fighters across `buckets` clusters as evenly as possible
// (the first `total % buckets` clusters get one extra) -- e.g. 20 across 5
// clusters is [4,4,4,4,4], 0 across 5 is [0,0,0,0,0].
function distributeCounts(total: number, buckets: number): number[] {
  if (buckets <= 0) return [];
  const base = Math.floor(total / buckets);
  const remainder = total % buckets;
  return Array.from({ length: buckets }, (_, i) => base + (i < remainder ? 1 : 0));
}

function createSceneProps(center: [number, number], clusterIdx: number): CombatPropData[] {
  const [cx, cz] = center;
  const p = (id: string) => `c${clusterIdx}-${id}`;
  return [
    { id: p('c1'), kind: 'CRATE', position: new THREE.Vector3(cx - 2, 0.4, cz + 2), radius: 0.8 },
    { id: p('c2'), kind: 'CRATE', position: new THREE.Vector3(cx + 2, 0.4, cz - 2), radius: 0.8 },
    { id: p('b1'), kind: 'BARREL', position: new THREE.Vector3(cx + 3, 0.5, cz + 1.5), radius: 0.6 },
    { id: p('b2'), kind: 'BARREL', position: new THREE.Vector3(cx - 3, 0.5, cz - 1.5), radius: 0.6 },
    { id: p('b3'), kind: 'BARREL', position: new THREE.Vector3(cx, 0.5, cz - 5), radius: 0.6 },
  ];
}

// "solo 2 torrette una rossa e una blu in zone diverse della citta" -- two
// fixed bases instead of two neutral towers born wherever the first two
// duel clusters happened to land: one pre-owned by RED, one by BLUE
// (progress 100 -- fully theirs from the start, not mid-capture), placed
// on opposite sides of the city (a random angle, then its mirror) so
// they read as two distinct, distant strongholds rather than a matched
// pair sitting together. The opposing team can still push a tower's
// progress down and flip it (see CombatTower.tsx) -- these are starting
// ownership, not permanent.
function createTowers(enabled: boolean): TowerData[] {
  if (!enabled) return [];
  const angle = Math.random() * Math.PI * 2;
  const dist = ARENA_SPAWN_RADIUS * 0.6;
  const redPos: [number, number] = [Math.cos(angle) * dist, Math.sin(angle) * dist];
  const bluePos: [number, number] = [-redPos[0], -redPos[1]];
  return [
    { id: 0, position: new THREE.Vector3(redPos[0], 0, redPos[1]), radius: 2.8, owner: 'RED', progress: 100 },
    { id: 1, position: new THREE.Vector3(bluePos[0], 0, bluePos[1]), radius: 2.8, owner: 'BLUE', progress: 100 },
  ];
}

function createHealingItems(center: [number, number], count: number, arenaSize: number, clusterIdx: number): HealingItemData[] {
  const [cx, cz] = center;
  const items: HealingItemData[] = [];
  const base = clusterIdx * 100;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.PI / 4;
    const dist = arenaSize * 0.4;
    items.push({
      id: base + i,
      position: new THREE.Vector3(cx + Math.cos(angle) * dist, 0.4, cz + Math.sin(angle) * dist),
      active: true,
      respawnTimer: 0,
      healAmount: 50,
    });
  }
  return items;
}

function createFighters(count: number, mode: GameMode, center: [number, number], clusterIdx: number): FighterData[] {
  const [cx, cz] = center;
  const fighters: FighterData[] = [];
  const radius = Math.max(3, count * 0.6);

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const x = cx + Math.cos(angle) * radius;
    const z = cz + Math.sin(angle) * radius;

    // FFA still gives every fighter its own unique pseudo-team (so nobody
    // shares one and everybody's "not my team" to everybody else) -- now
    // namespaced by clusterIdx too, purely so two different clusters never
    // hand out the identical team string (irrelevant to targeting, which is
    // distance-based, but keeps ids/teams unambiguous if ever inspected).
    const team = mode === 'TEAMS' || mode === 'TERRITORY_CONTROL' ? (i % 2 === 0 ? 'RED' : 'BLUE') : `FFA_${clusterIdx}_${i}`;
    const name = mode === 'FFA' ? `Manichino #${clusterIdx}.${i + 1}` : team === 'RED' ? `Rossa #${clusterIdx}.${Math.floor(i / 2) + 1}` : `Blu #${clusterIdx}.${Math.floor(i / 2) + 1}`;

    fighters.push({
      id: `arena-${clusterIdx}-fighter-${i}`,
      name,
      team,
      hp: 100,
      isDead: false,
      position: new THREE.Vector3(x, 0, z),
      rotation: angle + Math.PI,
      isAttacking: Math.random() > 0.3,
      duelTimer: Math.random() * 2,
      attackLock: 0,
      currentAnim: '',
      animCatalog: null,
      state: 'In guardia',
      triggerHit: null,
    });
  }
  return fighters;
}

const CombatArena: React.FC = () => {
  // "fammi scegliere ... le modalita di scontro" / "da un minimo di 0 a
  // 120 combattenti" -- CombatArenaGUI.tsx's lil-gui panel writes both;
  // changing either regenerates every cluster's fighters fresh, the same
  // "restart the match" behavior simulation-citta's own controls had.
  const gameMode = useStore((state) => state.arenaGameMode);
  const fighterCount = useStore((state) => state.arenaFighterCount);

  // Where each duel cluster lands -- plain random points across the whole
  // city (see the file comment above for why this replaced the old
  // block-center anchoring), picked once so adjusting a setting restarts
  // the fights in place rather than relocating them.
  const clusterCenters = useMemo<[number, number][]>(
    () => Array.from({ length: MAX_CLUSTERS }, () => randomCityPoint()),
    []
  );

  // arenaFighterCount is a CITY-WIDE total (matching simulation-citta's own
  // single "Combattenti" slider) -- split as evenly as possible across
  // however many clusters there are.
  const perClusterCounts = useMemo(
    () => distributeCounts(fighterCount, clusterCenters.length),
    [fighterCount, clusterCenters]
  );

  // useMemo (not useState) -- nothing here needs to trigger a React
  // re-render on its own; every field gets mutated in place by the child
  // components each frame (see CombatSoldier.tsx), same as the original's
  // `data` objects. Recomputed (a fresh "restart") whenever gameMode or
  // fighterCount changes, same trigger the original's restartMatch() had.
  const fighters = useMemo(
    () => clusterCenters.flatMap((center, ci) => createFighters(perClusterCounts[ci] ?? 0, gameMode, center, ci)),
    [clusterCenters, gameMode, perClusterCounts]
  );
  // Exactly two towers, one RED-owned one BLUE-owned, on opposite sides of
  // the city -- independent of both cluster layout and fighter count (see
  // createTowers' comment above).
  const towers = useMemo(() => createTowers(ENABLE_TOWERS), []);
  const sceneProps = useMemo(
    () => clusterCenters.flatMap((center, ci) => createSceneProps(center, ci)),
    [clusterCenters]
  );
  const healingItems = useMemo(
    () => clusterCenters.flatMap((center, ci) => createHealingItems(center, 3, 12, ci)),
    [clusterCenters]
  );

  const medkitPoolRef = useRef(MEDKIT_LIMIT === -1 ? Infinity : MEDKIT_LIMIT);
  const [, setMedkitPoolCount] = useState(medkitPoolRef.current);

  // Same medkit-pool reset the original's restartMatch() did, now tied to
  // the same settings changes that reset the fighters above.
  useEffect(() => {
    medkitPoolRef.current = MEDKIT_LIMIT === -1 ? Infinity : MEDKIT_LIMIT;
    setMedkitPoolCount(medkitPoolRef.current);
  }, [gameMode, fighterCount]);

  return (
    <group>
      {sceneProps.map((prop) => (
        <CombatProp key={prop.id} prop={prop} />
      ))}
      {towers.map((tower) => (
        <CombatTower key={`tower-${tower.id}`} tower={tower} fighters={fighters} globalSpeed={GLOBAL_SPEED} />
      ))}
      {healingItems.map((item) => (
        <CombatMedkit key={`medkit-${item.id}`} item={item} globalSpeed={GLOBAL_SPEED} />
      ))}
      {fighters.map((fighter) => (
        <CombatSoldier
          key={fighter.id}
          data={fighter}
          allFightersData={fighters}
          healingItems={healingItems}
          towers={towers}
          sceneProps={sceneProps}
          gameMode={gameMode}
          medkitPoolRef={medkitPoolRef}
          setMedkitPoolCount={setMedkitPoolCount}
          globalSpeed={GLOBAL_SPEED}
        />
      ))}
    </group>
  );
};

export default CombatArena;
