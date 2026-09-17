import React, { useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, Html } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { getTerrainHeight } from './Terrain';
import { getRoadOffset } from './Road';
import { useRagdoll } from './ragdoll/useRagdoll';
import { FighterData, TowerData, HealingItemData, CombatPropData, GameMode, AnimCatalog } from './SquadArenaTypes';

const MODEL_URL = 'soldier-citizen.glb';
const BASE_ANIMS_URL = 'soldier-citizen-base-animations.glb';
const ADDON_ANIMS_URL = 'soldier-citizen-addon-animations.glb';
// "quell'animazione non serve piu'" -- see the identical constant/comment
// in PlayerCombatSoldier.tsx: the Hit_Chest/Hit_Head clips' own baked-in
// motion was the real source of "il personaggio si trasla in aria" (it
// was already happening before the ragdoll rig existed), and useRagdoll's
// pulseHit now sells the hit physically on its own. This just keeps the
// old brief "can't act right after being hit" window.
const HIT_STAGGER_DURATION = 0.35;

const TEAM_COLOR: Record<string, string> = { RED: '#ef4444', BLUE: '#38bdf8' };
// Scratch vector for the hit-reaction ragdoll impulse direction (see the
// triggerHit branch below) -- avoids a per-hit allocation.
const _hitImpulseDir = new THREE.Vector3();
// "il colpo deve essere sferrato dove effettivamente le mesh collidono,
// non in un range" -- checked via a real Rapier shape-intersection query
// (useRagdoll.ts's pointIntersectsHurtbox), not distance math -- see the
// identical setup in PlayerCombatSoldier.tsx.
const _handPos = new THREE.Vector3();
const ATTACK_HAND_BONES = ['hand_l', 'hand_r'] as const;

interface CombatSoldierProps {
  data: FighterData;
  allFightersData: FighterData[];
  healingItems: HealingItemData[];
  towers: TowerData[];
  sceneProps: CombatPropData[];
  gameMode: GameMode;
  medkitPoolRef: React.MutableRefObject<number>;
  setMedkitPoolCount: (n: number) => void;
  globalSpeed: number;
  // "riusciamo a Ricreare la fisica ragdoll attiva in stile Euphoria?" --
  // opt-in (default false): a physics ragdoll per fighter is real Rapier
  // bodies+joints, fine for a 1v1 duel (PlayerCombatSoldier.tsx/
  // DuelArena.tsx pass true) but NOT something to turn on for the
  // city-wide CombatArena, which can have up to 120 fighters at once (see
  // its "Combattenti" slider) -- CombatArena.tsx deliberately leaves this
  // unset/false to avoid spawning up to ~1200 extra ragdoll bodies.
  enableRagdoll?: boolean;
}

// Ported from simulation-citta's "RiggedCitizen" -- the full duel AI this
// time (attack/dodge/block, HP, death, medkit-seeking, tower capture),
// unlike the simpler patrol-only version this replaces. Structurally
// unchanged from the original: `data` is mutated in place every frame
// (position/hp/state/etc.), read directly by CombatTower (occupancy) and
// by other CombatSoldier instances (as a potential `target`) -- there is
// no player interaction here, it's a spectacle to walk up and watch, same
// as the original was.
const CombatSoldier: React.FC<CombatSoldierProps> = ({
  data,
  allFightersData,
  healingItems,
  towers,
  sceneProps,
  gameMode,
  medkitPoolRef,
  setMedkitPoolCount,
  globalSpeed,
  enableRagdoll = false,
}) => {
  const groupRef = React.useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  // Points at the SkeletonUtils clone (set below, once it exists) so
  // useRagdoll can walk its bone hierarchy -- kept as its own ref rather
  // than reading `clone` directly since useRagdoll is a hook and must be
  // called unconditionally every render regardless of `enableRagdoll`.
  const modelRootRef = React.useRef<THREE.Object3D | null>(null);
  const ragdoll = useRagdoll(modelRootRef);
  // "il colpo deve essere sferrato dove effettivamente le mesh collidono"
  // -- which FighterData this fighter's CURRENT swing is aimed at (the
  // AI's own target-finding logic only re-runs once attackLock drops back
  // to 0, so this snapshot is what the attackLock>0 branch below checks
  // contact against on every later frame of the same swing), and whether
  // that swing has already landed once (so it can't land twice).
  const attackTargetRef = React.useRef<FighterData | null>(null);
  const attackHasLandedRef = React.useRef(false);

  const { scene } = useGLTF(MODEL_URL);
  const { animations: baseAnims } = useGLTF(BASE_ANIMS_URL);
  const { animations: addonAnims } = useGLTF(ADDON_ANIMS_URL);
  const animations = useMemo(() => [...baseAnims, ...addonAnims], [baseAnims, addonAnims]);

  const { clone, mixer, actions, clipsMap, animCatalog } = useMemo(() => {
    const clonedScene = SkeletonUtils.clone(scene);

    clonedScene.traverse((child: any) => {
      if (child.isSkinnedMesh) {
        child.material = child.material.clone();
        const color = TEAM_COLOR[data.team] ?? '#f59e0b';
        child.material.emissive = new THREE.Color(color);
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
      // Three player-choosable strikes -- see AnimCatalog's own comment.
      // The AI never triggers these itself (still only ever reads
      // `attacks` above at its own attack-resolution branch); populated
      // here too only because AnimCatalog is one shared shape.
      attackJab: pickAnim(['Punch_Jab', 'Fighting Left Jab']),
      attackCross: pickAnim(['Punch_Cross', 'Fighting Right Jab']),
      attackHook: pickAnim(['Melee_Hook', 'Punch_Jab']),
    };

    if (actMap[catalog.idle]) {
      actMap[catalog.idle].play();
      data.currentAnim = catalog.idle;
    }
    // The original never wrote this back onto `data`, which silently
    // disabled the "was my target blocking" parry check below (it always
    // read undefined). Fighters can now actually block each other's hits.
    data.animCatalog = catalog;

    return { clone: clonedScene, mixer: animMixer, actions: actMap, clipsMap: cMap, animCatalog: catalog };
  }, [scene, animations, data]);

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
  // -- see the identical function/comment in PlayerCombatSoldier.tsx.
  // `theTarget` is attackTargetRef's snapshot, passed in rather than read
  // from the ref directly so a null-check only has to happen once at the
  // call site.
  const checkAttackContact = (theTarget: FighterData): boolean => {
    if (theTarget.hurtboxHandle === null) return false; // target's hurtbox not created yet (its very first frame)
    for (const boneName of ATTACK_HAND_BONES) {
      if (!ragdoll.getBoneWorldPosition(boneName, _handPos)) continue;
      if (!ragdoll.pointIntersectsHurtbox(_handPos, theTarget.hurtboxHandle)) continue;

      if (theTarget.currentAnim === theTarget.animCatalog?.block) {
        theTarget.hp -= 5;
        theTarget.state = 'Danno parato!';
      } else {
        theTarget.hp -= 25;
        if (theTarget.hp <= 0) {
          theTarget.hp = 0;
          theTarget.isDead = true;
          theTarget.attackLock = 0;
        } else {
          theTarget.triggerHit = Math.random() > 0.5 ? 'Hit_Chest' : 'Hit_Head';
          // "il colpo deve avvenire precisamente dove le mesh si sono
          // toccate" -- now the real hand contact point, not this
          // fighter's root position.
          theTarget.hitFromX = _handPos.x;
          theTarget.hitFromZ = _handPos.z;
        }
      }
      return true;
    }
    return false;
  };

  useFrame((_state, delta) => {
    if (mixer) mixer.update(delta * globalSpeed);
    // Runs every frame regardless of which branch below fires -- a hit-
    // reaction pulse (see the triggerHit branch) needs to keep simulating
    // and blending back out even once attackLock has expired and the rest
    // of the state machine has moved on. No longer gated on enableRagdoll:
    // the reactive pulse/death bodies still only ever get built when
    // enableRagdoll is true (pulseHit/activateDeath are only ever CALLED
    // under that same gate, below), but update() now also drives this
    // fighter's permanent hurtbox (see useRagdoll.ts's HURTBOX_* /
    // syncHurtbox) -- "il colpo deve avvenire dove le mesh collidono"
    // needs that hurtbox to exist for EVERY fighter, including the
    // city-wide arena's up-to-120, not just the 1v1 duel.
    ragdoll.update(delta);
    // Keeps `data.hurtboxHandle` current for whoever's attacking THIS
    // fighter (their own checkAttackContact reads it off `theTarget`).
    data.hurtboxHandle = ragdoll.getHurtboxHandle();
    if (!groupRef.current) return;

    // "voglio estendere il loro ground a tutta la citta" -- fighters now
    // roam/duel across the whole city (see CombatArena.tsx), not one small
    // patch of near-flat ground, so their vertical offset can no longer be
    // a single constant sampled once at an arena center: it has to track
    // this fighter's OWN current (x,z) every frame, exactly like every
    // other ambient NPC here (Pedestrian.tsx/Soldier.tsx).
    // `data.position.y` itself still stays the original's flat-plane local
    // value (0, or whatever a hit/dodge nudge left it at) -- all the
    // distance/duel math above assumes that; this only changes what it's
    // rendered ON TOP OF.
    const applyTransform = () => {
      const groundY = getTerrainHeight(data.position.x, data.position.z) + getRoadOffset(data.position.x, data.position.z);
      groupRef.current!.position.set(data.position.x, groundY + data.position.y, data.position.z);
      groupRef.current!.rotation.y = data.rotation;
    };

    if (data.isDead) {
      if (data.currentAnim !== animCatalog.death) {
        transitionToAnimation(animCatalog.death, 0.2, false);
        data.state = 'K.O.';
      }
      // "punto 1: ragdoll passivo alla morte" -- idempotent (checks its
      // own state), safe to call every frame while dead. From here on
      // ragdoll.update() above overwrites the skeleton's bone transforms
      // from real Rapier physics every frame; the death clip started just
      // above still plays underneath but only affects bones the ragdoll
      // rig doesn't cover (fingers etc.), see ragdollConfig.ts.
      if (enableRagdoll) ragdoll.activateDeath();
      applyTransform();
      return;
    }

    if (data.triggerHit) {
      // No longer switches to the Hit_Chest/Hit_Head animation clip -- see
      // HIT_STAGGER_DURATION's comment above/in PlayerCombatSoldier.tsx.
      // The fighter keeps whatever animation was already playing; only the
      // brief action-lock and the ragdoll's own physical pulse represent
      // "being hit" now.
      data.attackLock = HIT_STAGGER_DURATION;
      data.state = 'Colpito!';
      data.triggerHit = null;
      // "punto 2: che gli attacchi sembrino veri" -- a real physical
      // impulse at the moment of impact (knocked backward-and-up relative
      // to which way this fighter is currently facing -- `triggerHit` is
      // set by the ATTACKER elsewhere in this file, which doesn't thread
      // its own position through, so this is a reasonable stand-in for
      // "away from whoever just hit you"), not just an animation. The
      // torso/head alternate so consecutive hits don't all look identical.
      if (enableRagdoll) {
        _hitImpulseDir.set(Math.sin(data.rotation), 0.35, Math.cos(data.rotation));
        ragdoll.pulseHit(_hitImpulseDir, 0.3, Math.random() > 0.5 ? 'Head' : 'Torso', data.hitFromX, data.hitFromZ);
      }
    }

    if (data.attackLock > 0) {
      data.attackLock -= delta * globalSpeed;
      // "il colpo deve essere sferrato dove effettivamente le mesh
      // collidono" -- attackTargetRef is only set while a real attack
      // swing (not some other attackLock use, like the hit-stagger above)
      // is in progress -- see the attack-decision branch below.
      if (attackTargetRef.current && !attackHasLandedRef.current && !attackTargetRef.current.isDead) {
        if (checkAttackContact(attackTargetRef.current)) attackHasLandedRef.current = true;
      }
      if (data.attackLock <= 0) {
        transitionToAnimation(animCatalog.idle, 0.2, true);
        data.state = 'In guardia';
        attackTargetRef.current = null;
      }
      applyTransform();
      return;
    }

    // "metti un opzione in cui l'avversario si ferma e non combatte che
    // posso attivare a piacimento" -- a training-dummy toggle (DuelHUD's
    // own button, see store.ts's duelDummyMode / DuelArena.tsx's mirror
    // onto this fighter's own data.isPassive). Placed AFTER the
    // attackLock branch above so a swing already in flight still finishes
    // instead of freezing mid-punch, but before every chase/attack/block
    // decision below -- isDead (already handled above) and the ragdoll
    // hit-reaction/hurtbox sync (already run unconditionally earlier this
    // frame) are untouched, so a dummy still takes damage and still
    // physically reacts to a hit, it just never initiates anything itself.
    if (data.isPassive) {
      if (data.currentAnim !== animCatalog.idle) {
        transitionToAnimation(animCatalog.idle, 0.2, true);
      }
      data.state = 'Manichino';
      data.isAttacking = false;
      applyTransform();
      return;
    }

    let nearestMedkit: HealingItemData | null = null;
    let minMedkitDist = Infinity;

    if (data.hp < 35) {
      healingItems.forEach((item) => {
        if (!item.active) return;
        const d = data.position.distanceTo(item.position);
        if (d < minMedkitDist) {
          minMedkitDist = d;
          nearestMedkit = item;
        }
      });
    }

    if (nearestMedkit) {
      const item = nearestMedkit as HealingItemData;
      const toMedkit = new THREE.Vector3().subVectors(item.position, data.position);
      const distToMedkit = toMedkit.length();
      toMedkit.normalize();

      const targetRotation = Math.atan2(toMedkit.x, toMedkit.z) + Math.PI;
      let angleDiff = targetRotation - data.rotation;
      angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
      data.rotation += angleDiff * 0.3;

      if (distToMedkit < 0.6) {
        item.active = false;
        data.hp = Math.min(100, data.hp + item.healAmount);
        data.state = 'Curato!';

        if (medkitPoolRef.current !== Infinity) {
          medkitPoolRef.current -= 1;
          setMedkitPoolCount(medkitPoolRef.current);
          if (medkitPoolRef.current > 0) item.respawnTimer = 8.0;
        } else {
          item.respawnTimer = 8.0;
        }
      } else {
        data.state = 'Corro al medkit!';
        transitionToAnimation(animCatalog.run, 0.1, true, 1.8);
        data.position.addScaledVector(toMedkit, 0.075 * globalSpeed);
      }

      applyTransform();
      return;
    }

    // NOTE: ported as-is -- every living fighter's frame ticks every
    // item's respawnTimer, so with N fighters alive a timer effectively
    // counts down ~N times as fast as globalSpeed alone would suggest.
    // Quirky, but that's how the original arena behaved too.
    healingItems.forEach((item) => {
      if (!item.active && item.respawnTimer > 0 && (medkitPoolRef.current > 0 || medkitPoolRef.current === Infinity)) {
        item.respawnTimer -= delta * globalSpeed;
        if (item.respawnTimer <= 0) item.active = true;
      }
    });

    let target: FighterData | null = null;
    let minDistance = Infinity;

    let targetTower: TowerData | null = null;
    if (gameMode === 'TERRITORY_CONTROL' && towers.length > 0) {
      towers.forEach((t) => {
        if (t.owner !== data.team) {
          const d = data.position.distanceTo(t.position);
          if (d < 8.0 && d < minDistance) targetTower = t;
        }
      });
    }

    allFightersData.forEach((other) => {
      if (other.id === data.id || other.isDead) return;
      if (other.team === data.team) return;
      const dist = data.position.distanceTo(other.position);
      if (dist < minDistance) {
        minDistance = dist;
        target = other;
      }
    });

    sceneProps.forEach((prop) => {
      const distProp = data.position.distanceTo(prop.position);
      if (distProp < prop.radius + 0.4) {
        const push = new THREE.Vector3().subVectors(data.position, prop.position).normalize().multiplyScalar(0.04);
        data.position.add(push);
      }
    });

    if (targetTower && minDistance > 3.0) {
      const tower = targetTower as TowerData;
      const toTower = new THREE.Vector3().subVectors(tower.position, data.position);
      const distTower = toTower.length();
      toTower.normalize();

      if (distTower > tower.radius - 0.5) {
        data.state = 'Conquista torre';
        transitionToAnimation(animCatalog.walk, 0.15, true, 1.2);
        data.position.addScaledVector(toTower, 0.04 * globalSpeed);
      } else {
        data.state = 'Provocazione!';
        transitionToAnimation(animCatalog.taunt, 0.2, true);
      }

      const targetRotation = Math.atan2(toTower.x, toTower.z) + Math.PI;
      data.rotation += Math.atan2(Math.sin(targetRotation - data.rotation), Math.cos(targetRotation - data.rotation)) * 0.15;
      applyTransform();
      return;
    }

    if (!target) {
      if (data.currentAnim !== animCatalog.victory) {
        transitionToAnimation(animCatalog.victory, 0.3, true);
        data.state = 'Sopravvissuto';
      }
      applyTransform();
      return;
    }

    const theTarget = target as FighterData;
    const toTarget = new THREE.Vector3().subVectors(theTarget.position, data.position);
    const distance = toTarget.length();
    toTarget.normalize();

    allFightersData.forEach((other) => {
      if (other.id === data.id || other.isDead) return;
      if (data.position.distanceTo(other.position) < 1.0) {
        const push = new THREE.Vector3().subVectors(data.position, other.position).normalize().multiplyScalar(0.02);
        data.position.add(push);
      }
    });

    const targetRotation = Math.atan2(toTarget.x, toTarget.z) + Math.PI;
    let angleDiff = targetRotation - data.rotation;
    angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
    data.rotation += angleDiff * 0.15;

    data.duelTimer = (data.duelTimer || 0) + delta * globalSpeed;
    if (data.duelTimer > 2.5) {
      data.duelTimer = 0;
      data.isAttacking = Math.random() > 0.35;
    }

    if (data.isAttacking) {
      if (distance > 1.4) {
        data.state = 'Carica';
        transitionToAnimation(animCatalog.run, 0.15, true, 1.3);
        data.position.addScaledVector(toTarget, 0.05 * globalSpeed);
      } else {
        const chosenAttack = animCatalog.attacks[Math.floor(Math.random() * animCatalog.attacks.length)];
        data.state = `Attacco (${chosenAttack})`;
        data.attackLock = transitionToAnimation(chosenAttack, 0.1, false);
        // "il colpo deve essere sferrato dove effettivamente le mesh
        // collidono" -- no longer resolved instantly here (that used to
        // gate purely on the AI's own 1.4 melee-range check, taken once
        // the instant the swing starts). checkAttackContact, run every
        // frame from the attackLock branch above against this snapshot,
        // now decides if and when it actually connects.
        attackTargetRef.current = theTarget;
        attackHasLandedRef.current = false;
      }
    } else {
      if (distance < 2.0) {
        if (Math.random() > 0.5) {
          data.state = 'Capriola';
          transitionToAnimation(animCatalog.dodge, 0.1, false);
          data.position.addScaledVector(toTarget, -0.04 * globalSpeed);
        } else {
          data.state = 'Parata';
          transitionToAnimation(animCatalog.block, 0.15, true);
        }
      } else {
        data.state = 'In guardia';
        transitionToAnimation(animCatalog.idle, 0.15, true);
      }
    }

    applyTransform();
  });

  return (
    <group
      ref={groupRef}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      <primitive object={clone} scale={1} rotation={[0, Math.PI, 0]} />
      {!data.isDead && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.35, 0.45, 24]} />
          <meshBasicMaterial color={TEAM_COLOR[data.team] ?? '#f59e0b'} />
        </mesh>
      )}
      {hovered && (
        <Html position={[0, 2.3, 0]} center distanceFactor={10}>
          <div
            style={{
              background: 'rgba(9, 9, 11, 0.95)',
              color: 'white',
              padding: '4px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              whiteSpace: 'nowrap',
              border: '1px solid rgba(255,255,255,0.2)',
            }}
          >
            {data.name} ({Math.max(0, Math.floor(data.hp))} HP) — {data.state}
          </div>
        </Html>
      )}
    </group>
  );
};

export default CombatSoldier;

useGLTF.preload(MODEL_URL);
useGLTF.preload(BASE_ANIMS_URL);
useGLTF.preload(ADDON_ANIMS_URL);
