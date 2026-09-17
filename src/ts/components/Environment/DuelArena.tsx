import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import CombatSoldier from './CombatSoldier';
import PlayerCombatSoldier from './PlayerCombatSoldier';
import { useStore } from '../../store';
import { FighterData } from './SquadArenaTypes';

// "crea una sezione dedicata nel menu di avvio del gioco che mi fa entrare
// in un'arena, siamo io che controllo un combat soldier contro un altro
// combat soldier" -- the 1v1 duel scene. Mounted by Scene.tsx only while
// testScene === 'duel' (see there), the same "clean test scenario" pattern
// the airplane/car/race scenarios already use, so the duel gets its own
// quiet patch of terrain with none of the city/traffic/pedestrians/
// CombatArena battle-royale sharing the scene.
//
// Deliberately NOT built on CombatArena.tsx's own createFighters() (that's
// tuned for many-FFA-fighter clusters scattered across the whole city) --
// this is exactly two fighters, face to face, in one fixed spot.
export const DUEL_PLAYER_ID = 'duel-player';
// Far from both Airport.tsx's pads (RUNWAY/HELIPORT_CENTER sit at z=-260)
// and CombatArena's own citywide spread -- nothing else should ever be
// standing here.
const DUEL_CENTER: [number, number] = [0, 0];
const DUEL_SEPARATION = 4; // starting distance between the two fighters
const GLOBAL_SPEED = 1.0;
// "fai durare le vite di piu" -- CombatSoldier.tsx/PlayerCombatSoldier.tsx's
// own damage formulas are shared, byte-for-byte, with the 120-fighter
// city arena (see PlayerCombatSoldier.tsx's attack branch), so this is
// deliberately NOT a damage-per-hit change -- that would also rebalance
// every CombatArena fight. Instead the duel's own two fighters simply
// start with more hp (2.5x -- a clean hit still does the same 25/5, it
// just takes ~10 clean hits instead of ~4 to finish someone off). The
// store's duelPlayerHp/duelEnemyHp (DuelHUD.tsx's bars) stay 0-100
// PERCENTAGES regardless -- see the useFrame below.
const DUEL_MAX_HP = 250;

// Same atan2(...)+PI facing convention CombatSoldier.tsx/PlayerCombatSoldier.tsx
// use everywhere else -- just so the two fighters start already roughly
// squared up instead of visibly snapping into place over their first few
// frames (PlayerCombatSoldier's own per-frame facing-lock takes over
// immediately after, this only matters for the very first rendered frame).
function facingToward(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(toX - fromX, toZ - fromZ) + Math.PI;
}

function makeFighter(id: string, name: string, team: string, x: number, z: number, rotation: number): FighterData {
  return {
    id,
    name,
    team,
    hp: DUEL_MAX_HP,
    isDead: false,
    position: new THREE.Vector3(x, 0, z),
    rotation,
    isAttacking: false,
    duelTimer: 0,
    attackLock: 0,
    currentAnim: '',
    animCatalog: null,
    state: 'In guardia',
    triggerHit: null,
    hitFromX: 0,
    hitFromZ: 0,
  };
}

const DuelArena: React.FC = () => {
  const playerX = DUEL_CENTER[0] - DUEL_SEPARATION / 2;
  const enemyX = DUEL_CENTER[0] + DUEL_SEPARATION / 2;
  const dz = DUEL_CENTER[1];

  // Built once per mount (a fresh useMemo(..., []) -- re-entering the duel
  // via Scene.tsx unmount/remount is what "restarts the match", same as
  // CombatArena.tsx's own fighters restarting on a settings change).
  const playerData = useMemo(
    () => makeFighter(DUEL_PLAYER_ID, 'Tu', 'PLAYER', playerX, dz, facingToward(playerX, dz, enemyX, dz)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const enemyData = useMemo(
    () => makeFighter('duel-ai', 'Avversario', 'AI_ENEMY', enemyX, dz, facingToward(enemyX, dz, playerX, dz)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const allFighters = useMemo(() => [playerData, enemyData], [playerData, enemyData]);

  // No medkits in a 1v1 duel -- keep it a fair, straightforward fight. A
  // pool of 0 makes CombatSoldier.tsx's own medkit-seeking branch a no-op
  // (it only runs when hp < 35 AND a nearby *active* item exists; there
  // never are any here).
  const emptyMedkitPool = useRef(0);
  const noopSetMedkitPoolCount = () => {};

  const setDuelStatus = useStore((state) => state.setDuelStatus);

  // Hands control of the duel-player fighter over to the player the
  // moment this arena mounts -- a safety net alongside App.tsx's own
  // handleJoin (which already does this when "Duello 1v1" is chosen), so
  // the camera/input correctly follow this fighter regardless of exactly
  // how the duel was entered. useThirdPersonCamera.ts resolves its target
  // via scene.getObjectByName(controlledEntityId) -- see
  // PlayerCombatSoldier's own `name={DUEL_PLAYER_ID}` below.
  useEffect(() => {
    useStore.getState().setCurrentControllable('combatSoldier', DUEL_PLAYER_ID);
  }, []);

  // Mirrors the two FighterData objects' hp/death into the store every
  // frame so DuelHUD.tsx (plain DOM, outside the R3F tree) can draw two HP
  // bars + a win/lose banner without reaching into refs owned by the R3F
  // component tree.
  useFrame(() => {
    const result: 'none' | 'win' | 'lose' = enemyData.isDead ? 'win' : playerData.isDead ? 'lose' : 'none';
    // Normalized to 0-100 here (not raw hp) so DuelHUD.tsx's bars stay a
    // simple width:`${hp}%` regardless of DUEL_MAX_HP.
    setDuelStatus((Math.max(0, playerData.hp) / DUEL_MAX_HP) * 100, (Math.max(0, enemyData.hp) / DUEL_MAX_HP) * 100, result);
  });

  return (
    <group>
      <PlayerCombatSoldier data={playerData} opponent={enemyData} entityName={DUEL_PLAYER_ID} globalSpeed={GLOBAL_SPEED} />
      {/* The AI opponent -- CombatSoldier.tsx itself is completely
          unmodified: passing the player's own FighterData inside
          allFightersData is all it takes for its existing, unmodified
          targeting/attack/block-detection logic to fight the player
          exactly as it would fight any other fighter in the city-wide
          arena. enableRagdoll=true unlike CombatArena.tsx's own instances
          -- see CombatSoldier.tsx's comment on that prop -- a 1v1 duel can
          easily afford the one extra physics rig. */}
      <CombatSoldier
        data={enemyData}
        allFightersData={allFighters}
        healingItems={[]}
        towers={[]}
        sceneProps={[]}
        gameMode="FFA"
        medkitPoolRef={emptyMedkitPool}
        setMedkitPoolCount={noopSetMedkitPoolCount}
        globalSpeed={GLOBAL_SPEED}
        enableRagdoll
      />
    </group>
  );
};

export default DuelArena;
