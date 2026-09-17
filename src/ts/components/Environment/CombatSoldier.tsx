import React, { useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations, Html } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { getTerrainHeight } from './Terrain';
import { getRoadOffset } from './Road';
import { FighterData, TowerData, HealingItemData, CombatPropData, GameMode, AnimCatalog } from './SquadArenaTypes';

const MODEL_URL = 'soldier-citizen.glb';
const BASE_ANIMS_URL = 'soldier-citizen-base-animations.glb';
const ADDON_ANIMS_URL = 'soldier-citizen-addon-animations.glb';

const TEAM_COLOR: Record<string, string> = { RED: '#ef4444', BLUE: '#38bdf8' };

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
}) => {
  const groupRef = React.useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

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
    // The original never wrote this back onto `data`, which silently
    // disabled the "was my target blocking" parry check below (it always
    // read undefined). Fighters can now actually block each other's hits.
    data.animCatalog = catalog;

    return { clone: clonedScene, mixer: animMixer, actions: actMap, clipsMap: cMap, animCatalog: catalog };
  }, [scene, animations, data]);

  useAnimations(animations, clone);

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
      applyTransform();
      return;
    }

    if (data.triggerHit) {
      const hitAnim = actions[data.triggerHit] ? data.triggerHit : animCatalog.idle;
      data.attackLock = transitionToAnimation(hitAnim, 0.1, false);
      data.state = 'Colpito!';
      data.triggerHit = null;
    }

    if (data.attackLock > 0) {
      data.attackLock -= delta * globalSpeed;
      if (data.attackLock <= 0) {
        transitionToAnimation(animCatalog.idle, 0.2, true);
        data.state = 'In guardia';
      }
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
          }
        }
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
