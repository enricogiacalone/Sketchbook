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
export const ATTACK_RANGE = 1.8; // exported so DuelArena.tsx can drive the crosshair's in-range state off the same number
// "quell'animazione non serve piu'" -- the Hit_Chest/Hit_Head clips used to
// be what SOLD a hit (a full-body stagger animation), but useRagdoll.ts's
// pulseHit now does that physically on the struck bone itself, and the
// clips' own baked-in motion (however small on paper) was the real source
// of "il personaggio si trasla in aria" -- it was already happening before
// the ragdoll rig existed at all. So a hit no longer switches the whole
// body's animation: it keeps playing whatever the fighter was already
// doing (idle/walk/attack) and lets the ragdoll pulse alone read as the
// reaction, while this constant keeps the old brief "can't act right after
// being hit" stagger window (matches HIT_BLEND_OUT_DURATION in
// useRagdoll.ts so the lock roughly tracks how long the ragdoll's own
// recoil is still visibly playing out).
const HIT_STAGGER_DURATION = 0.35;
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
const _handPos = new THREE.Vector3(); // scratch for checkAttackContact's hand-bone reads

// "il colpo deve essere sferrato dove effettivamente le mesh collidono" --
// the opponent's body, treated as a vertical cylinder around its root
// position (XZ only, no Y check -- a punch's hand height during a real
// swing is already roughly chest/head height, and the rig has no single
// bone worth measuring against for "torso height" cheaply here). This is
// deliberately tighter than ATTACK_RANGE (1.8, root-to-root, used only
// for the crosshair/UI "in range" hint): it approximates actual body
// thickness/shoulder width plus a little for the fist itself, not the
// two fighters' whole reach envelope.
const HIT_CONTACT_RADIUS = 0.45;
const ATTACK_HAND_BONES = ['hand_l', 'hand_r'] as const;

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
  // Track the CURRENT swing's own state -- isAttacking distinguishes an
  // attack's attackLock window from a dodge's or a hit-stagger's (all
  // three reuse the same data.attackLock timer), and hasLanded makes sure
  // a single swing can only land once even though the contact check now
  // runs every frame it's active (see checkAttackContact below).
  const isAttackingRef = useRef(false);
  const attackHasLandedRef = useRef(false);

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
      // "il colpo va lo stesso a segno" -- 'Kick_Right'/'Spin_Kick'/
      // 'Kick_Left'/'Uppercut' don't exist anywhere in this rig's base or
      // addon animation packs (verified against both GLBs' own clip
      // lists), so pickAnim silently fell back to 'Fighting Idle' for 2 of
      // these 4 slots: half of all random attack picks played no visible
      // swing at all while the damage/hit-reaction logic below fired
      // unconditionally regardless of which clip (if any) actually
      // played. Replaced with three more real punch/hook variants this
      // rig actually has, so all four slots always animate.
      attacks: [
        pickAnim(['Punch_Jab', 'Fighting Left Jab']),
        pickAnim(['Punch_Cross', 'Fighting Right Jab']),
        pickAnim(['Melee_Hook', 'Punch_Jab']),
        pickAnim(['Fighting Right Jab', 'Fighting Left Jab']),
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

  // "il colpo deve essere sferrato dove effettivamente le mesh collidono"
  // -- called every frame a swing is active (see the attackLock branch in
  // useFrame below), checks THIS fighter's own hand bones (both -- no
  // per-clip left/right mapping is tracked, and checking both is cheap
  // and robust) against `opponent`'s body cylinder. Resolves damage and
  // returns true the first frame a hand is actually within reach; the
  // caller uses that to latch attackHasLandedRef so a single swing can
  // only ever land once. Returns false (a pure "whiff") if the whole
  // swing never got close enough -- copied verbatim from the old
  // instant-on-click branch, just no longer gated on distance at t=0.
  const checkAttackContact = (): boolean => {
    for (const boneName of ATTACK_HAND_BONES) {
      if (!ragdoll.getBoneWorldPosition(boneName, _handPos)) continue;
      const dx = _handPos.x - opponent.position.x;
      const dz = _handPos.z - opponent.position.z;
      if (dx * dx + dz * dz > HIT_CONTACT_RADIUS * HIT_CONTACT_RADIUS) continue;

      // Damage/blocking/death formulas copied VERBATIM from
      // CombatSoldier.tsx's own attack-resolution branch, on purpose -- a
      // punch does the same thing whichever fighter threw it.
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
          // toccate" -- now using the actual hand contact point (rather
          // than this fighter's root position) for an even more precise
          // hit-marker placement -- see CombatSoldier.tsx's identical
          // comment.
          opponent.hitFromX = _handPos.x;
          opponent.hitFromZ = _handPos.z;
        }
      }
      return true;
    }
    return false;
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
      // No longer switches to the Hit_Chest/Hit_Head animation clip -- see
      // HIT_STAGGER_DURATION's comment above. The fighter keeps whatever
      // animation was already playing; only the brief action-lock and the
      // ragdoll's own physical pulse represent "being hit" now.
      data.attackLock = HIT_STAGGER_DURATION;
      data.state = 'Colpito!';
      data.triggerHit = null;
      // "fai che gli attacchi sembrino veri" -- a real physical impulse at
      // the moment of impact, not just a hit-reaction animation. Same
      // hit-pulse technique as CombatSoldier.tsx -- see useRagdoll.ts.
      _hitImpulseDir.set(Math.sin(data.rotation), 0.35, Math.cos(data.rotation));
      ragdoll.pulseHit(_hitImpulseDir, 0.3, Math.random() > 0.5 ? 'Head' : 'Torso', data.hitFromX, data.hitFromZ);
    }

    if (data.attackLock > 0) {
      data.attackLock -= delta * globalSpeed;
      // Only a dodge roll actually covers ground while locked -- an
      // attack swing or a hit-stun both stay planted in place, same as
      // CombatSoldier.tsx.
      if (isDodgingRef.current) {
        data.position.addScaledVector(dodgeDirRef.current, DODGE_SPEED * delta * globalSpeed);
      }
      // "il colpo deve essere sferrato dove effettivamente le mesh
      // collidono" -- while THIS swing is still live and hasn't already
      // connected, check every frame instead of once at the moment the
      // button was pressed (see checkAttackContact above).
      if (isAttackingRef.current && !attackHasLandedRef.current && checkAttackContact()) {
        attackHasLandedRef.current = true;
      }
      if (data.attackLock <= 0) {
        transitionToAnimation(animCatalog.idle, 0.2, true);
        data.state = 'In guardia';
        isDodgingRef.current = false;
        isAttackingRef.current = false;
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

    // Camera-relative movement axes, computed here (rather than down by
    // the movement block below) so the dodge can also use them -- "quando
    // clicco schiva con shift fa un salto indietro anche se sto andando
    // avanti" -- the dodge used to always hop away from the opponent no
    // matter which movement key was held; now it goes wherever you're
    // currently pressing (WASD), same as normal movement, and only falls
    // back to "away from the opponent" if you're not holding any
    // direction (a neutral-input dodge still needs to go SOMEWHERE).
    camera.getWorldDirection(_forward);
    _forward.y = 0;
    _forward.normalize();
    _right.crossVectors(_forward, _worldUp).normalize();

    _moveDir.set(0, 0, 0);
    if (input.forward) _moveDir.add(_forward);
    if (input.backward) _moveDir.addScaledVector(_forward, -1);
    if (input.left) _moveDir.addScaledVector(_right, -1);
    if (input.right) _moveDir.add(_right);

    // --- Block (held) ---
    if (input.secondary) {
      data.state = 'Parata';
      transitionToAnimation(animCatalog.block, 0.15, true);
      applyTransform();
      return;
    }

    // --- Dodge (tap Space) -- moved off Shift, which is also "hold to
    // sprint": sharing the key meant every sprint tap also fired a dodge.
    if (input.consumeJustPressed('jump') && dodgeLockRef.current <= 0) {
      data.state = 'Capriola';
      if (_moveDir.lengthSq() > 0.0001) {
        dodgeDirRef.current.copy(_moveDir).normalize();
      } else {
        // No direction held -- fall back to the old "away from the
        // opponent" hop. _toOpponent is still valid from the facing
        // update just above.
        dodgeDirRef.current.copy(_toOpponent).multiplyScalar(-1);
      }
      isDodgingRef.current = true;
      data.attackLock = transitionToAnimation(animCatalog.dodge, 0.1, false);
      dodgeLockRef.current = data.attackLock + DODGE_EXTRA_LOCK;
      applyTransform();
      return;
    }

    // --- Attack (tap primary / left click) ---
    if (input.consumeJustPressed('primary')) {
      const chosenAttack = animCatalog.attacks[Math.floor(Math.random() * animCatalog.attacks.length)];
      data.state = `Attacco (${chosenAttack})`;
      data.attackLock = transitionToAnimation(chosenAttack, 0.1, false);
      // No longer resolved here -- ATTACK_RANGE (root-to-root, generous)
      // used to gate damage the instant the button was pressed. Now the
      // swing just starts playing, and checkAttackContact (run every
      // frame from the attackLock branch above, on THIS SAME NEW attack
      // since attackHasLandedRef resets to false here) decides whether
      // and when it actually connects. Still whiffs harmlessly if the
      // hand never gets close enough before the swing ends.
      isAttackingRef.current = true;
      attackHasLandedRef.current = false;
      applyTransform();
      return;
    }

    // --- Movement: camera-relative, same technique Player.tsx uses --
    // _forward/_right/_moveDir were already computed above (the dodge
    // block needs them too).
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
