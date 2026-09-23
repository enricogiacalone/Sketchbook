import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import CombatSoldier from './CombatSoldier';
import PlayerCombatSoldier, { ATTACK_RANGE } from './PlayerCombatSoldier';
import PunchingBag, { PunchingBagHandle } from './PunchingBag';
import DebugOrthoCamera from './DebugOrthoCamera';
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
// "crea un sacco su cui allenarmi nell'arena" -- fixed off to the side of
// the face-off line (fighters run along X at z=0, see playerX/enemyX
// below), close enough to the player's own spawn to walk to in a couple
// of steps, far enough out that it's never in the way of the actual duel.
const BAG_OFFSET: [number, number] = [-1, 3.5];
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

  // "nn voglio che usi distanze per fermarlo.. ogni parte del corpo deve
  // essere un collider" -- the old single-capsule useDuelBodyCollider.tsx
  // is gone: each fighter now resolves its OWN movement against real
  // per-limb colliders (11 of them, see useRagdoll.ts's resolveBodyMovement)
  // from INSIDE its own component (PlayerCombatSoldier.tsx/CombatSoldier.tsx),
  // not as a DuelArena post-pass on a synthetic whole-body shape -- so
  // there's nothing left to create or render here for that.

  // "crea un sacco su cui allenarmi" -- fixed near the player's own spawn
  // (see BAG_OFFSET above), a completely separate target from `enemyData`.
  // The collider handle isn't known until PunchingBag.tsx's own Rapier
  // collider actually exists (a frame or two after mount), hence the
  // state rather than a plain useMemo -- PlayerCombatSoldier.tsx's
  // checkAttackContact just skips the bag check entirely while this is
  // still null (same "not created yet" handling the opponent's own
  // hurtboxHandle already needs).
  const bagPositionXZ = useMemo<[number, number]>(
    () => [playerX + BAG_OFFSET[0], dz + BAG_OFFSET[1]],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const bagRef = useRef<PunchingBagHandle>(null);
  const [bagHurtboxHandle, setBagHurtboxHandle] = useState<number | null>(null);
  // "se sbatto col sacco dovrei muoverlo" -- the bag's OTHER collider
  // (the solid, non-sensor one a fighter's real body parts actually
  // collide against -- see PunchingBag.tsx). Forwarded into both
  // fighters below so their own resolveBodyMovement can recognize "the
  // thing that just blocked me IS the bag" and push it for real.
  const [bagSolidHandle, setBagSolidHandle] = useState<number | null>(null);

  // No medkits in a 1v1 duel -- keep it a fair, straightforward fight. A
  // pool of 0 makes CombatSoldier.tsx's own medkit-seeking branch a no-op
  // (it only runs when hp < 35 AND a nearby *active* item exists; there
  // never are any here).
  const emptyMedkitPool = useRef(0);
  const noopSetMedkitPoolCount = () => {};

  const setDuelStatus = useStore((state) => state.setDuelStatus);
  // "crea un tasto aggiungi nemico invece di aggiungerlo subito" --
  // vedi store.ts's duelEnemySpawned e CombatArenaGUI.tsx's pulsante
  // "Aggiungi nemico".
  const duelEnemySpawned = useStore((state) => state.duelEnemySpawned);
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
    // "ogni parte del corpo deve essere un collider.. se collide collide"
    // -- each fighter now resolves its OWN real per-limb movement inside
    // its OWN component's useFrame (PlayerCombatSoldier.tsx/
    // CombatSoldier.tsx, via useRagdoll.ts's resolveBodyMovement) before
    // this callback ever runs, so playerData.position/enemyData.position
    // are already this frame's real, physics-corrected positions by the
    // time the inRange/reticle logic below reads them -- nothing left to
    // resolve here.

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

    // "coglione testa su chrome" -- live-browser debug readout, so a
    // javascript_tool script driving the REAL game (not the headless
    // Rapier harness) can read exact fighter/bag gaps every frame without
    // needing scene.getObjectByName lookups (the AI opponent's own visual
    // group has no `name` set, unlike DUEL_PLAYER_ID's). Cheap plain-object
    // writes, no allocation of note, safe to leave in as a standing debug
    // hook (same spirit as window.__gameStore/__r3fState).
    const bagLivePos =
      bagRef.current && typeof bagRef.current.getWorldPosition === 'function'
        ? bagRef.current.getWorldPosition()
        : null;
    (window as any).__duelDebug = {
      playerX: playerData.position.x,
      playerZ: playerData.position.z,
      enemyX: enemyData.position.x,
      enemyZ: enemyData.position.z,
      bagX: bagPositionXZ[0],
      bagZ: bagPositionXZ[1],
      // TEMP debug (see PunchingBag.tsx's getWorldPosition comment) --
      // the bag's REAL live swinging position, unlike bagX/bagZ above
      // (a fixed spawn constant) -- bagSwingXZ is how far it's currently
      // displaced horizontally from its own rest/spawn point, i.e. "is it
      // actually swinging right now".
      bagLiveX: bagLivePos ? bagLivePos.x : null,
      bagLiveY: bagLivePos ? bagLivePos.y : null,
      bagLiveZ: bagLivePos ? bagLivePos.z : null,
      bagSwingXZ: bagLivePos ? Math.hypot(bagLivePos.x - bagPositionXZ[0], bagLivePos.z - bagPositionXZ[1]) : null,
      playerEnemyGap: playerData.position.distanceTo(enemyData.position),
      playerBagGap: Math.hypot(playerData.position.x - bagPositionXZ[0], playerData.position.z - bagPositionXZ[1]),
      enemyBagGap: Math.hypot(enemyData.position.x - bagPositionXZ[0], enemyData.position.z - bagPositionXZ[1]),
    };

    // TEMP debug -- "fanne uno che cade vicino a noi in modalita' del
    // tutto passiva": per capire se le braccia che non arrivano al
    // target (vedi window.__activeRagdollDebug) sono colpa del layer
    // ATTIVO che litiga con l'animazione ancora in corso, o sono un
    // limite del rig/giunti stesso, serve un caso di confronto senza
    // NESSUna delle due cose addosso -- morte reale (isDead=true) blocca
    // subito sia l'animazione (CombatSoldier.tsx smette di leggere
    // l'input/muoversi) sia il layer PD attivo (update()'s "if
    // (!s.active)" branch viene saltato del tutto una volta che
    // activateDeath() imposta s.active=true, isDeath=true -- resta solo
    // clampJointCones + la fisica pura dei giunti, un crollo passivo
    // vero). Teletrasporta il nemico proprio davanti al giocatore prima
    // di ucciderlo, cosi' il crollo si vede da vicino senza dover
    // rincorrerlo per l'arena.
    (window as any).__killEnemyNearby = (distance: number = 1.2) => {
      const dir = playerData.rotation ?? 0;
      enemyData.position.set(
        playerData.position.x + Math.sin(dir) * distance,
        playerData.position.y,
        playerData.position.z + Math.cos(dir) * distance
      );
      enemyData.hp = 0;
      enemyData.isDead = true;
    };

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
      {/* "aggiungi la possibilita' di attivare la vista ortogonale" --
          non disegna nulla di suo, prende il controllo della camera
          SOLO quando store.ts's debugOrthoCamera e' true (vedi il file
          stesso). */}
      <DebugOrthoCamera />
      <PlayerCombatSoldier
        data={playerData}
        opponent={enemyData}
        entityName={DUEL_PLAYER_ID}
        globalSpeed={GLOBAL_SPEED}
        bagHurtboxHandle={bagHurtboxHandle}
        bagSolidHandle={bagSolidHandle}
        bagRef={bagRef}
      />
      {/* "crea un sacco su cui allenarmi nell'arena.. mi serve per capire
          la precisione delle collisioni" -- see PunchingBag.tsx. Static,
          always there, completely independent of the fight above. */}
      <PunchingBag
        ref={bagRef}
        positionXZ={bagPositionXZ}
        onReady={setBagHurtboxHandle}
        onSolidReady={setBagSolidHandle}
      />
      {/* The AI opponent -- CombatSoldier.tsx itself is completely
          unmodified: passing the player's own FighterData inside
          allFightersData is all it takes for its existing, unmodified
          targeting/attack/block-detection logic to fight the player
          exactly as it would fight any other fighter in the city-wide
          arena. enableRagdoll=true unlike CombatArena.tsx's own instances
          -- see CombatSoldier.tsx's comment on that prop -- a 1v1 duel can
          easily afford the one extra physics rig, and now (see
          resolveBodyMovement/"ogni parte del corpo deve essere un
          collider") also gets real per-limb solid-body collision, same
          as the player, via that same flag.
          "crea un tasto aggiungi nemico invece di aggiungerlo subito" --
          NON piu' montato automaticamente all'ingresso nel duello, solo
          quando duelEnemySpawned diventa true (CombatArenaGUI.tsx's
          "Aggiungi nemico") -- cosi' un'ispezione a schermo del solo
          giocatore (T-pose, collider di debug) non ha un secondo intero
          set di collider a complicare la vista fin da subito. */}
      {duelEnemySpawned && (
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
          bagSolidHandle={bagSolidHandle}
          bagRef={bagRef}
        />
      )}
    </group>
  );
};

export default DuelArena;
