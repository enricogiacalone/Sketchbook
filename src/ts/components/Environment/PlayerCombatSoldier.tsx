import React, { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { getTerrainHeight } from './Terrain';
import { getRoadOffset } from './Road';
import { useRagdoll } from './ragdoll/useRagdoll';
import { useInput } from '../../hooks/useInput';
import { FighterData, AnimCatalog } from './SquadArenaTypes';

const MODEL_URL = 'soldier-citizen.glb';
const BASE_ANIMS_URL = 'soldier-citizen-base-animations.glb';
const ADDON_ANIMS_URL = 'soldier-citizen-addon-animations.glb';

// Green -- visually distinct from CombatSoldier.tsx's RED/BLUE/amber-FFA
// team palette, so the fighter YOU control always reads unambiguously at
// a glance even though it's the exact same model/rig as the AI opponent.
const PLAYER_COLOR = '#22c55e';

const WALK_SPEED = 2.2; // units/sec
const RUN_SPEED = 4.2; // units/sec
// A little more forgiving than the AI's own 1.4 melee-range check
// (CombatSoldier.tsx) -- the AI measures distance itself every frame and
// only swings when already in range, but a human mashing the attack
// button doesn't have that luxury, so a swing thrown a hair too far away
// still plays (a "whiff") instead of silently doing nothing.
const ATTACK_RANGE = 1.8;
const DODGE_SPEED = 7.5; // units/sec while the roll's physically covering ground
const DODGE_EXTRA_LOCK = 0.35; // extra cooldown (seconds) tacked on after the roll animation itself finishes, so it can't be chained instantly
// How much of the remaining facing-angle gap closes per frame -- same
// convention/units as CombatSoldier.tsx's own duel-facing turn (there
// 0.15); a touch snappier here since this is player-driven aiming, not an
// ambient AI's idle turn.
const FACE_TURN_RATE = 0.22;

// Module-level scratch objects -- avoids a per-frame allocation burst,
// matching this file's siblings (City.tsx's _windowDummy, CombatSoldier's
// _hitImpulseDir, useRagdoll.ts's _v1/_v2/...).
const _hitImpulseDir = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _moveDir = new THREE.Vector3();
const _toOpponent = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

interface PlayerCombatSoldierProps {
  // Owned by DuelArena.tsx, same FighterData shape CombatSoldier.tsx
  // mutates in place -- the AI opponent's own unmodified attack-resolution
  // code writes hp/triggerHit/isDead directly onto this object, exactly as
  // it would for any other fighter it's targeting.
  data: FighterData;
  // The AI's own FighterData -- read here for facing/range/block checks,
  // and mutated directly when the player lands a hit (see the attack
  // branch below), mirroring CombatSoldier.tsx's own `theTarget` handling.
  opponent: FighterData;
  // Must match the id passed to setCurrentControllable('combatSoldier', id)
  // so useThirdPersonCamera's scene.getObjectByName(...) can find this
  // group -- see useThirdPersonCamera.ts.
  entityName: string;
  globalSpeed: number;
}

// The player-input-driven half of the 1v1 duel -- "siamo io che controllo
// un combat soldier contro un altro combat soldier". Deliberately NOT a
// thin wrapper around CombatSoldier.tsx (that component's whole frame
// loop is an AI state machine reading `data`/`allFightersData` on its
// own timer) -- this duplicates just its animation-catalog setup and
// damage-resolution formulas (kept byte-for-byte identical on purpose, so
// a punch lands the same whichever side threw it) and replaces the AI
// decision tree with real input.
//
// Movement is camera-relative, the same technique Player.tsx's own
// on-foot movement uses (state.camera.getWorldDirection() projected flat).
// Facing is NOT movement-direction based, unlike Player.tsx -- it's
// always locked onto the opponent (a duel-camera choice: in a 1v1 you're
// always squared up to whoever you're fighting, strafing and back-
// pedaling like a real fighting-game character), using the exact same
// atan2(...)+PI convention CombatSoldier.tsx uses so both fighters read
// consistently.
const PlayerCombatSoldier: React.FC<PlayerCombatSoldierProps> = ({ data, opponent, entityName, globalSpeed }) => {
  const groupRef = useRef<THREE.Group>(null);
  // Points at the SkeletonUtils clone (set below) so useRagdoll can walk
  // its bone hierarchy -- see CombatSoldier.tsx for why this is a ref
  // rather than reading `clone` directly (useRagdoll must be called
  // unconditionally, before `clone` exists on the very first render).
  const modelRootRef = useRef<THREE.Object3D | null>(null);
  // Unlike CombatSoldier.tsx (opt-in via `enableRagdoll`, off for the
  // city-wide arena's up-to-120 fighters), the duel always has exactly
  // one player -- no perf reason to ever skip this here.
  const ragdoll = useRagdoll(modelRootRef);
  const input = useInput();
  const { camera } = useThree();

  // Extra dodge-spam cooldown (see DODGE_EXTRA_LOCK) and which way the
  // current roll is heading -- both need to survive across frames without
  // triggering a re-render, hence refs, matching `data`'s own mutate-in-
  // place convention.
  const dodgeLockRef = useRef(0);
  const dodgeDirRef = useRef(new THREE.Vector3());
  const isDodgingRef = useRef(false);

  const { scene } = useGLTF(MODEL_URL);
  const { animations: baseAnims } = useGLTF(BASE_ANIMS_URL);
  const { animations: addonAnims } = useGLTF(ADDON_ANIMS_URL);
  const animations = useMemo(() => [...baseAnims, ...addonAnims], [baseAnims, addonAnims]);

  // Identical to CombatSoldier.tsx's own catalog-building useMemo (see
  // there for why each field is picked the way it is) -- duplicated
  // rather than shared because it's not exported as a hook there, and
  // pulling it out into one would touch a file that's already working and
  // used by up to 120 city-wide fighters.
  const { clone, mixer, actions, clipsMap, animCatalog } = useMemo(() => {
    const clonedScene = SkeletonUtils.clone(scene);

    clonedScene.traverse((child: any) => {
      if (child.isSkinnedMesh) {
        child.material = child.material.clone();
        child.material.emissive = new THREE.Color(PLAYER_COLOR);
        child.material.emissiveIntensity = 0.35;
      }
    });

    const animMixer = new THREE.AnimationMixer(clonedScene);
    const actMap: Record<string, THREE.AnimationAction> = {};
    const cMap: Record<string, THREE.AnimationClip> = {};

    animations.forEach((clip) => {
      const action = animMixer.clipAction(clip);
      actMap[clip.name] = action;
      cMap[clip.name] = clip;
    });

    const pickAnim = (candidates: string[], fallback = 'Fighting Idle') => {
      for (const name of candidates) {
        if (actMap[name]) return name;
      }
      return fallback;
    };

    const catalog: AnimCatalog = {
      idle: pickAnim(['Fighting Idle', 'Idle']),
      run: pickAnim(['Run', 'Sprint', 'Walk']),
      walk: pickAnim(['Walk', 'Run']),
      dodge: pickAnim(['Roll_Forward', 'Roll_Back', 'Dodge_back', 'Dodge_Left']),
      block: pickAnim(['Block', 'Defend', 'Fighting Idle']),
      taunt: pickAnim(['Taunt', 'Cheering', 'Victory']),
      victory: pickAnim(['Victory', 'Taunt']),
      death: pickAnim(['Death_D', 'Death_A', 'Death']),
      attacks: [
        pickAnim(['Punch_Jab', 'Fighting Left Jab']),
        pickAnim(['Punch_Cross', 'Melee_Hook']),
        pickAnim(['Kick_Right', 'Spin_Kick']),
        pickAnim(['Kick_Left', 'Uppercut']),
      ],
    };

    if (actMap[catalog.idle]) {
      actMap[catalog.idle].play();
      data.currentAnim = catalog.idle;
    }
    // The AI's own block-detection check reads `theTarget.animCatalog?.block`
    // (CombatSoldier.tsx) -- without this the AI could never tell the
    // player was blocking.
    data.animCatalog = catalog;

    return { clone: clonedScene, mixer: animMixer, actions: actMap, clipsMap: cMap, animCatalog: catalog };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, animations, data]);

  useAnimations(animations, clone);

  React.useEffect(() => {
    modelRootRef.current = clone;
  }, [clone]);

  const transitionToAnimation = (animName: string, duration = 0.15, shouldLoop = true, timeScale = 1.0) => {
    const target = actions[animName] ? animName : animCatalog.idle;
    if (!target || !actions[target]) return 1.0;

    if (data.currentAnim === target) {
      actions[target].setEffectiveTimeScale(timeScale);
      if (shouldLoop) return clipsMap[target]?.duration || 1.0;
      actions[target].reset();
      actions[target].play();
      return clipsMap[target]?.duration || 1.0;
    }

    const prevAction = actions[data.currentAnim];
    const nextAction = actions[target];

    if (prevAction) prevAction.fadeOut(duration);

    nextAction.reset();
    nextAction.setEffectiveTimeScale(timeScale);
    nextAction.setEffectiveWeight(1);
    nextAction.setLoop(shouldLoop ? THREE.LoopRepeat : THREE.LoopOnce, shouldLoop ? Infinity : 1);
    nextAction.clampWhenFinished = !shouldLoop;
    nextAction.fadeIn(duration);
    nextAction.play();

    data.currentAnim = target;
    return clipsMap[target]?.duration || 1.0;
  };

  useFrame((_state, delta) => {
    if (mixer) mixer.update(delta * globalSpeed);
    // Runs every frame regardless of which branch below fires, same
    // reasoning as CombatSoldier.tsx: a hit-reaction pulse needs to keep
    // simulating/blending out even once the rest of the state machine has
    // moved on.
    ragdoll.update(delta);
    if (!groupRef.current) return;

    const applyTransform = () => {
      const groundY = getTerrainHeight(data.position.x, data.position.z) + getRoadOffset(data.position.x, data.position.z);
      groupRef.current!.position.set(data.position.x, groundY + data.position.y, data.position.z);
      groupRef.current!.rotation.y = data.rotation;
    };

    // "punto 1: ragdoll passivo alla morte" -- identical treatment to
    // CombatSoldier.tsx's own dead branch: once dead, physics drives the
    // skeleton forever and every input below is ignored.
    if (data.isDead) {
      if (data.currentAnim !== animCatalog.death) {
        transitionToAnimation(animCatalog.death, 0.2, false);
        data.state = 'K.O.';
      }
      ragdoll.activateDeath();
      applyTransform();
      return;
    }

    // A small flourish once the AI is down and you're still standing --
    // CombatSoldier.tsx's own AI already does the mirror image of this
    // (its "if (!target)" branch plays victory/'Sopravvissuto' once its
    // only living opponent -- you -- is excluded from targeting).
    if (opponent.isDead) {
      if (data.currentAnim !== animCatalog.victory) {
        transitionToAnimation(animCatalog.victory, 0.3, true);
        data.state = 'Vittoria!';
      }
      applyTransform();
      return;
    }

    if (data.triggerHit) {
      const hitAnim = actions[data.triggerHit] ? data.triggerHit : animCatalog.idle;
      data.attackLock = transitionToAnimation(hitAnim, 0.1, false);
      data.state = 'Colpito!';
      data.triggerHit = null;
      // "fai che gli attacchi sembrino veri" -- a real physical impulse at
      // the moment of impact, not just a hit-reaction animation. Same
      // hit-pulse technique as CombatSoldier.tsx -- see useRagdoll.ts.
      _hitImpulseDir.set(Math.sin(data.rotation), 0.35, Math.cos(data.rotation));
      ragdoll.pulseHit(_hitImpulseDir, 1.6, Math.random() > 0.5 ? 'Head' : 'Torso', data.hitFromX, data.hitFromZ);
    }

    if (data.attackLock > 0) {
      data.attackLock -= delta * globalSpeed;
      // Only a dodge roll actually covers ground while locked -- an
      // attack swing or a hit-stun both stay planted in place, same as
      // CombatSoldier.tsx.
      if (isDodgingRef.current) {
        data.position.addScaledVector(dodgeDirRef.current, DODGE_SPEED * delta * globalSpeed);
      }
      if (data.attackLock <= 0) {
        transitionToAnimation(animCatalog.idle, 0.2, true);
        data.state = 'In guardia';
        isDodgingRef.current = false;
      }
      applyTransform();
      return;
    }

    if (dodgeLockRef.current > 0) dodgeLockRef.current -= delta * globalSpeed;

    // Facing: always locked onto the opponent (see the file-level comment
    // above), using the exact atan2(...)+PI convention CombatSoldier.tsx
    // uses -- both fighters share the same rotated primitive below, so
    // this is what keeps them reading consistently at a glance.
    _toOpponent.subVectors(opponent.position, data.position);
    _toOpponent.y = 0;
    if (_toOpponent.lengthSq() > 0.0001) {
      _toOpponent.normalize();
      const targetRotation = Math.atan2(_toOpponent.x, _toOpponent.z) + Math.PI;
      let angleDiff = targetRotation - data.rotation;
      angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
      data.rotation += angleDiff * FACE_TURN_RATE;
    }

    // --- Block (held) ---
    if (input.secondary) {
      data.state = 'Parata';
      transitionToAnimation(animCatalog.block, 0.15, true);
      applyTransform();
      return;
    }

    // --- Dodge (tap Shift) ---
    if (input.consumeJustPressed('shift') && dodgeLockRef.current <= 0) {
      data.state = 'Capriola';
      // Hop directly away from the opponent -- _toOpponent is still valid
      // from the facing update just above.
      dodgeDirRef.current.copy(_toOpponent).multiplyScalar(-1);
      isDodgingRef.current = true;
      data.attackLock = transitionToAnimation(animCatalog.dodge, 0.1, false);
      dodgeLockRef.current = data.attackLock + DODGE_EXTRA_LOCK;
      applyTransform();
      return;
    }

    // --- Attack (tap primary / left click) ---
    if (input.consumeJustPressed('primary')) {
      const distance = data.position.distanceTo(opponent.position);
      const chosenAttack = animCatalog.attacks[Math.floor(Math.random() * animCatalog.attacks.length)];
      data.state = `Attacco (${chosenAttack})`;
      data.attackLock = transitionToAnimation(chosenAttack, 0.1, false);

      // Out of range: the swing still plays (a "whiff"), just no damage --
      // see ATTACK_RANGE's comment above.
      if (distance <= ATTACK_RANGE) {
        // Damage/blocking/death formulas copied VERBATIM from
        // CombatSoldier.tsx's own attack-resolution branch, on purpose --
        // a punch does the same thing whichever fighter threw it.
        if (opponent.currentAnim === opponent.animCatalog?.block) {
          opponent.hp -= 5;
          opponent.state = 'Danno parato!';
        } else {
          opponent.hp -= 25;
          if (opponent.hp <= 0) {
            opponent.hp = 0;
            opponent.isDead = true;
            opponent.attackLock = 0;
          } else {
            opponent.triggerHit = Math.random() > 0.5 ? 'Hit_Chest' : 'Hit_Head';
            // "il colpo deve avvenire precisamente dove le mesh si sono
            // toccate" -- see CombatSoldier.tsx's identical comment.
            opponent.hitFromX = data.position.x;
            opponent.hitFromZ = data.position.z;
          }
        }
      }
      applyTransform();
      return;
    }

    // --- Movement: camera-relative, same technique Player.tsx uses ---
    camera.getWorldDirection(_forward);
    _forward.y = 0;
    _forward.normalize();
    _right.crossVectors(_forward, _worldUp).normalize();

    _moveDir.set(0, 0, 0);
    if (input.forward) _moveDir.add(_forward);
    if (input.backward) _moveDir.addScaledVector(_forward, -1);
    if (input.left) _moveDir.addScaledVector(_right, -1);
    if (input.right) _moveDir.add(_right);

    if (_moveDir.lengthSq() > 0.0001) {
      _moveDir.normalize();
      const speed = input.shift ? RUN_SPEED : WALK_SPEED;
      data.position.addScaledVector(_moveDir, speed * delta * globalSpeed);
      data.state = input.shift ? 'Corre' : 'Si muove';
      transitionToAnimation(input.shift ? animCatalog.run : animCatalog.walk, 0.15, true, input.shift ? 1.3 : 1.0);
    } else {
      data.state = 'In guardia';
      transitionToAnimation(animCatalog.idle, 0.15, true);
    }

    applyTransform();
  });

  return (
    <group ref={groupRef} name={entityName}>
      <primitive object={clone} scale={1} rotation={[0, Math.PI, 0]} />
      {!data.isDead && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.35, 0.45, 24]} />
          <meshBasicMaterial color={PLAYER_COLOR} />
        </mesh>
      )}
    </group>
  );
};

export default PlayerCombatSoldier;

useGLTF.preload(MODEL_URL);
useGLTF.preload(BASE_ANIMS_URL);
useGLTF.preload(ADDON_ANIMS_URL);
