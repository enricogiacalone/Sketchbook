import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import CombatSoldier from './CombatSoldier';
import PlayerCombatSoldier, { ATTACK_RANGE } from './PlayerCombatSoldier';
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
// "il mirino e' ai piedi del giocatore.. deve stare piu' in alto" --
// roughly chest/eye height (meters) above a foot-controller's own
// ground-level root, used to project the crosshair's screen position
// (see the useFrame below) instead of leaving it pinned to literal
// screen-center, which is where the camera's own lookAt target sits for
// on-foot controllers (useThirdPersonCamera.ts) -- i.e. the character's
// feet.
const AIM_HEIGHT_OFFSET = 1.5;
// "il personaggio e' piu' a sinistra rispetto al centro quando spara" --
// the reference over-the-shoulder aim framing: the character sits off to
// one side of the frame while the reticle floats in the open space beside
// them, never on top of their own silhouette. Rather than re-aiming the
// shared third-person camera itself (useThirdPersonCamera.ts -- touching
// its lookAt target would also shift the view for ordinary on-foot
// exploration, not just this duel), this offsets ONLY the world point the
// reticle is projected from, sideways along the CAMERA's own current
// right vector -- so it stays stable in screen-space (always the same
// side) no matter which way the camera is currently orbited around the
// fight, matching how the reference screenshot's own crosshair sits
// beside the character rather than on top of them.
const _aimWorldPos = new THREE.Vector3();
const _camForward = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
// Half a step to the side -- enough to clear the character's own
// silhouette without wandering off into empty space unrelated to them.
const SHOULDER_OFFSET = 0.45;

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
    hurtboxHandle: null,
    isPassive: false,
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
  const { camera, scene } = useThree();

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
    // "metti un opzione in cui l'avversario si ferma e non combatte che
    // posso attivare a piacimento" -- mirrors the store's duelDummyMode
    // (flipped by DuelHUD's own toggle button, outside the R3F tree) onto
    // the one FighterData CombatSoldier.tsx actually reads every frame;
    // see FighterData.isPassive's own comment for why this indirection
    // exists at all rather than CombatSoldier reading the store directly.
    enemyData.isPassive = useStore.getState().duelDummyMode;

    const result: 'none' | 'win' | 'lose' = enemyData.isDead ? 'win' : playerData.isDead ? 'lose' : 'none';
    // "metti un mirino cosi' so dove sto per colpire" -- same range check
    // PlayerCombatSoldier.tsx's own attack branch uses, just read here too
    // so the crosshair can tell the player whether a swing would actually
    // land BEFORE they throw it, rather than only after (see ATTACK_RANGE's
    // export there).
    const inRange = playerData.position.distanceTo(enemyData.position) <= ATTACK_RANGE;

    // "il mirino e' ai piedi del giocatore.. controlla come si fa un
    // mirino per sparare" -- the correct technique (how a real 3rd-person
    // aim reticle is built): project an actual 3D point through the live
    // camera into screen space every frame, rather than hardcoding 50/50.
    // Reads the player's OWN group -- by name, the same lookup
    // useThirdPersonCamera.ts itself uses -- so this already includes
    // whatever ground/road height it was placed at this frame; adding
    // AIM_HEIGHT_OFFSET moves the projected point up from the ground-level
    // root (which is what literal screen-center already tracks, being the
    // camera's own lookAt target) to roughly chest/eye height. Falls back
    // to keeping the previous reticle position for the rare frame where
    // the group isn't found yet (mount order), rather than snapping to a
    // wrong default.
    let reticleX = useStore.getState().duelReticleX;
    let reticleY = useStore.getState().duelReticleY;
    const playerObj = scene.getObjectByName(DUEL_PLAYER_ID);
    if (playerObj) {
      playerObj.getWorldPosition(_aimWorldPos);
      _aimWorldPos.y += AIM_HEIGHT_OFFSET;

      // "il personaggio e' piu' a sinistra rispetto al centro quando
      // spara" -- shift the projected point sideways off the character's
      // own silhouette, using the CAMERA's live right vector (same
      // forward x worldUp convention PlayerCombatSoldier.tsx's own
      // camera-relative movement uses) so the offset direction is always
      // "screen right" no matter how the duel camera is currently
      // orbited.
      camera.getWorldDirection(_camForward);
      _camForward.y = 0;
      if (_camForward.lengthSq() > 0.0001) {
        _camForward.normalize();
        _camRight.crossVectors(_camForward, _worldUp).normalize();
        _aimWorldPos.addScaledVector(_camRight, SHOULDER_OFFSET);
      }

      _aimWorldPos.project(camera);
      // NDC (-1..1, +Y up) -> percentage of screen (0..100, +Y down, CSS convention)
      reticleX = (_aimWorldPos.x * 0.5 + 0.5) * 100;
      reticleY = (1 - (_aimWorldPos.y * 0.5 + 0.5)) * 100;
    }

    // Normalized to 0-100 here (not raw hp) so DuelHUD.tsx's bars stay a
    // simple width:`${hp}%` regardless of DUEL_MAX_HP.
    setDuelStatus(
      (Math.max(0, playerData.hp) / DUEL_MAX_HP) * 100,
      (Math.max(0, enemyData.hp) / DUEL_MAX_HP) * 100,
      result,
      inRange,
      reticleX,
      reticleY
    );
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
