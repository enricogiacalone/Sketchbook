import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import AudioArena from './audioArena/AudioArena';
import FlyBrainFighter from './FlyBrainFighter';
import WeaponEffects from './weapons/WeaponEffects';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import CombatSoldier from './CombatSoldier';
import EnemyHealthBar from './EnemyHealthBar';
import { ATTACK_RANGE } from './PlayerCombatSoldier';
import PunchingBag, { PunchingBagHandle } from './PunchingBag';
import ParkourCourse from './ParkourCourse';
import Car from '../Vehicles/Car';
import DebugOrthoCamera from './DebugOrthoCamera';
import ArenaObstacles from './ArenaObstacles';
import TunnelBench from './TunnelBench';
import { useStore } from '../../store';
import { FighterData } from './SquadArenaTypes';
import { CITY_PLAYER_ID } from '../CityPlayer';

export const DUEL_PLAYER_ID = CITY_PLAYER_ID;

export const DUEL_CAR_ID = 'duel-car';
const DUEL_CAR_SCALE = 1.5;
const DUEL_CAR_SPAWN: [number, number, number] = [10, 1.6, 10];
const DUEL_CENTER: [number, number] = [0, 0];
const DUEL_SEPARATION = 4;
const BAG_OFFSET: [number, number] = [-1.5, -1.5];
const GLOBAL_SPEED = 1.0;
const DUEL_MAX_HP = 250;
const AIM_HEIGHT_OFFSET = 1.5;

const _aimWorldPos = new THREE.Vector3();
const _camForward = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const SHOULDER_OFFSET = 0.45;

function facingToward(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(toX - fromX, toZ - fromZ) + Math.PI;
}

export function makeFighter(id: string, name: string, team: string, x: number, z: number, rotation: number): FighterData {
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

const ENEMY_SPAWN_RADIUS = 4;
const ENEMY_SPAWN_ANGLE_STEP = 0.6;
const ENEMIES_PER_RING = 7;
function enemySpawnPoint(index: number, player: FighterData): [number, number] {
  const forward = player.rotation - Math.PI;
  const ring = Math.floor(index / ENEMIES_PER_RING);
  const slot = index % ENEMIES_PER_RING;
  const side = slot % 2 === 1 ? 1 : -1;
  const angle = forward + side * Math.ceil(slot / 2) * ENEMY_SPAWN_ANGLE_STEP;
  const radius = ENEMY_SPAWN_RADIUS + ring * 1.5;
  return [player.position.x + Math.sin(angle) * radius, player.position.z + Math.cos(angle) * radius];
}

function nearestLivingEnemy(player: FighterData, enemies: FighterData[]): FighterData | null {
  let best: FighterData | null = null;
  let bestD = Infinity;
  for (const e of enemies) {
    if (e.isDead) continue;
    const d = player.position.distanceTo(e.position);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

const DuelArena: React.FC = () => {
  const playerX = DUEL_CENTER[0] - DUEL_SEPARATION / 2;
  const enemyX = DUEL_CENTER[0] + DUEL_SEPARATION / 2;
  const dz = DUEL_CENTER[1];

  const storePlayer = useStore((s) => s.duelArenaPlayer);
  const fallbackPlayer = useMemo(
    () => makeFighter(CITY_PLAYER_ID, 'Tu', 'PLAYER', playerX, dz, facingToward(playerX, dz, enemyX, dz)),
    [playerX, dz, enemyX]
  );
  const playerData = storePlayer ?? fallbackPlayer;

  const duelEnemyCount = useStore((state) => state.duelEnemyCount);
  const showObstacles = useStore((state) => state.arenaScene.obstacles);
  const showCourse = useStore((state) => state.arenaScene.course);
  const showCar = useStore((state) => state.arenaScene.car);
  const [enemies, setEnemies] = useState<FighterData[]>([]);
  const enemySerialRef = useRef(0);

  useEffect(() => {
    setEnemies((prev) => {
      if (duelEnemyCount <= 0) return prev.length ? [] : prev;
      if (duelEnemyCount <= prev.length) return prev;
      const next = [...prev];
      for (let i = prev.length; i < duelEnemyCount; i++) {
        const [x, z] = enemySpawnPoint(i, playerData);
        enemySerialRef.current += 1;
        next.push(
          makeFighter(
            `duel-ai-${enemySerialRef.current}`,
            `Avversario ${enemySerialRef.current}`,
            'AI_ENEMY',
            x,
            z,
            facingToward(x, z, playerData.position.x, playerData.position.z)
          )
        );
      }
      return next;
    });
  }, [duelEnemyCount, playerData]);

  const allFighters = useMemo(() => [playerData, ...enemies], [playerData, enemies]);

  const bagPositionXZ = useMemo<[number, number]>(() => [playerX + BAG_OFFSET[0], dz + BAG_OFFSET[1]], [playerX, dz]);
  const bagRef = useRef<PunchingBagHandle>(null);
  const [bagHurtboxHandle, setBagHurtboxHandle] = useState<number | null>(null);
  const [bagSolidHandle, setBagSolidHandle] = useState<number | null>(null);

  const emptyMedkitPool = useRef(0);
  const noopSetMedkitPoolCount = () => {};

  const setDuelStatus = useStore((state) => state.setDuelStatus);
  const { camera, scene } = useThree();

  useEffect(() => {
    useStore.getState().setCurrentControllable('player', CITY_PLAYER_ID);
    (window as any).__damageDuelPlayer = (amount: number) => {
      if (playerData) playerData.hp = Math.max(0, playerData.hp - amount);
    };
    return () => {
      delete (window as any).__damageDuelPlayer;
      const st = useStore.getState();
      st.setDuelArenaEnemies([]);
      st.setDuelBagHandles(null, null);
    };
  }, [playerData]);

  useFrame(() => {
    const st = useStore.getState();
    st.setDuelArenaEnemies(enemies);
    st.setDuelBagHandles(bagHurtboxHandle, bagSolidHandle);

    const dummy = st.duelDummyMode;
    for (const e of enemies) e.isPassive = dummy;
    const target = nearestLivingEnemy(playerData, enemies);

    const result: 'none' | 'win' | 'lose' = 'none';
    const inRange = target !== null && playerData.position.distanceTo(target.position) <= ATTACK_RANGE;

    let reticleX = st.duelReticleX;
    let reticleY = st.duelReticleY;
    const playerObj = scene.getObjectByName(CITY_PLAYER_ID);
    if (playerObj) {
      playerObj.getWorldPosition(_aimWorldPos);
      _aimWorldPos.y += AIM_HEIGHT_OFFSET;

      camera.getWorldDirection(_camForward);
      _camForward.y = 0;
      if (_camForward.lengthSq() > 0.0001) {
        _camForward.normalize();
        _camRight.crossVectors(_camForward, _worldUp).normalize();
        _aimWorldPos.addScaledVector(_camRight, SHOULDER_OFFSET);
      }

      _aimWorldPos.project(camera);
      reticleX = (_aimWorldPos.x * 0.5 + 0.5) * 100;
      reticleY = (1 - (_aimWorldPos.y * 0.5 + 0.5)) * 100;
    }

    const bagLivePos = bagRef.current && typeof bagRef.current.getWorldPosition === 'function' ? bagRef.current.getWorldPosition() : null;
    (window as any).__duelDebug = {
      playerX: playerData.position.x,
      playerZ: playerData.position.z,
      bagX: bagPositionXZ[0],
      bagZ: bagPositionXZ[1],
      bagLiveX: bagLivePos ? bagLivePos.x : null,
      bagLiveY: bagLivePos ? bagLivePos.y : null,
      bagLiveZ: bagLivePos ? bagLivePos.z : null,
      bagSwingXZ: bagLivePos ? Math.hypot(bagLivePos.x - bagPositionXZ[0], bagLivePos.z - bagPositionXZ[1]) : null,
      playerEnemyGap: target ? playerData.position.distanceTo(target.position) : null,
      playerBagGap: Math.hypot(playerData.position.x - bagPositionXZ[0], playerData.position.z - bagPositionXZ[1]),
      enemyBagGap: target ? Math.hypot(target.position.x - bagPositionXZ[0], target.position.z - bagPositionXZ[1]) : null,
    };

    (window as any).__killEnemyNearby = (distance: number = 1.2) => {
      const enemyData = nearestLivingEnemy(playerData, enemies);
      if (!enemyData) return;
      const dir = playerData.rotation ?? 0;
      enemyData.position.set(
        playerData.position.x + Math.sin(dir) * distance,
        playerData.position.y,
        playerData.position.z + Math.cos(dir) * distance
      );
      enemyData.hp = 0;
      enemyData.isDead = true;
    };

    const enemyHpPct = target ? (Math.max(0, target.hp) / DUEL_MAX_HP) * 100 : enemies.length > 0 ? 0 : 100;
    setDuelStatus((Math.max(0, playerData.hp) / DUEL_MAX_HP) * 100, enemyHpPct, result, inRange, reticleX, reticleY);
  });

  return (
    <group>
      <DebugOrthoCamera />
      <WeaponEffects />
      <Suspense fallback={null}>
        <AudioArena />
      </Suspense>
      <Suspense fallback={null}>
        <FlyBrainFighter />
      </Suspense>
      <PunchingBag ref={bagRef} positionXZ={bagPositionXZ} onReady={setBagHurtboxHandle} onSolidReady={setBagSolidHandle} />
      {showObstacles && <ArenaObstacles />}
      {import.meta.env.DEV && <TunnelBench />}
      {showCourse && <ParkourCourse />}
      {showCar && <Car id={DUEL_CAR_ID} position={DUEL_CAR_SPAWN} rotation={[0, -Math.PI / 2, 0]} scale={DUEL_CAR_SCALE} massKg={1100} />}
      {enemies.map((enemy) => (
        <EnemyHealthBar key={`hp-${enemy.id}`} data={enemy} maxHp={DUEL_MAX_HP} />
      ))}
      {enemies.map((enemy) => (
        <CombatSoldier
          key={enemy.id}
          data={enemy}
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
      ))}
    </group>
  );
};

export default DuelArena;
