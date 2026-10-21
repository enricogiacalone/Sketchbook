import React, { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../../store';
import EnemyHealthBar from '../Environment/EnemyHealthBar';
import { getTerrainHeight } from '../Environment/Terrain';
import { getRoadOffset } from '../Environment/Road';
import { floorLift } from '../../lib/floors';
import { damageFighter } from '../Environment/weapons/shootableRegistry';
import { RUN_CLIP, timeScaleFor } from '../Environment/locomotion';
import { useMannequinActor } from './useMannequinActor';
import { newStepState, stepToward, PLAYER_ID } from './npcCombat';

// Uno zombi della modalita' zombi notturna (ZombieNight.tsx): il manichino
// con le clip Zombie_* che esce da terra, barcolla verso il giocatore e lo
// graffia da vicino. E' un nemico vero (colpi, ragdoll, vita), non fa
// ricercare dalla polizia. Tre tipi: lento (barcolla), svelto, corridore.

export type ZombieKind = 'slow' | 'brisk' | 'runner';
const KINDS: Record<ZombieKind, { speed: number; hp: number; clip: string; ts: number; color: string }> = {
  slow: { speed: 0.95, hp: 70, clip: 'Zombie_Walk', ts: 1, color: '#5b7a4a' },
  brisk: { speed: 1.7, hp: 50, clip: 'Zombie_Walk_2', ts: 1.5, color: '#6b8a3f' },
  runner: { speed: 3.6, hp: 35, clip: RUN_CLIP, ts: 0, color: '#8a9a30' },
};
const ATTACK_RANGE = 1.35;
const ATTACK_COOLDOWN_S = 1.5;
const ATTACK_DAMAGE = 6;
const CORPSE_S = 12;
const LOST_DIST = 120; // oltre questa distanza dal giocatore se ne va un altro al suo posto
const CLAW_CLIPS = ['Melee_Hook', 'Punch_Jab'];

export interface ZombieProps {
  id: string;
  kind: ZombieKind;
  x: number;
  z: number;
  onGone: (id: string) => void;
}

const _aim = new THREE.Vector3();
const _pt = new THREE.Vector3();
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

const Zombie: React.FC<ZombieProps> = ({ id, kind, x, z, onGone }) => {
  const K = KINDS[kind];
  const actor = useMannequinActor({ id, name: 'Zombi', team: 'CITY_ENEMY', color: K.color, hp: K.hp, x, z });
  const { data } = actor;
  const groupRef = useRef<THREE.Group>(null);
  const S = useRef({
    step: newStepState(),
    rise: 0,
    riseT: 0,
    attackCd: 0.6,
    clawAnim: 0,
    deadT: 0,
    deadHandled: false,
    entityT: 0,
    warm: 0,
    gone: false,
  });

  useEffect(() => {
    return () => useStore.getState().removeEntity(id);
  }, [id]);

  useEffect(() => {
    const s = S.current;
    // esce da terra
    s.riseT = actor.hasClip('Zombie_Rise') ? Math.min(2.6, actor.clipDuration('Zombie_Rise')) : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_state, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const s = S.current;
    if (s.gone) return;
    const res = actor.beginFrame(delta, data.position);
    const store = useStore.getState();

    if (res === 'dead') {
      if (!s.deadHandled) {
        s.deadHandled = true;
        store.removeEntity(id);
      }
      s.deadT += delta;
      if (s.deadT > CORPSE_S) {
        s.gone = true;
        actor.ragdoll.deactivate();
        onGone(id);
      }
      return;
    }
    if (res === 'down') {
      actor.holdRoot(g);
      return;
    }

    const pp = store.playerPos;
    const pos = data.position;
    const dx = pp[0] - pos.x;
    const dz = pp[2] - pos.z;
    const dist = Math.hypot(dx, dz);
    const gy = getTerrainHeight(pos.x, pos.z) + getRoadOffset(pos.x, pos.z) + floorLift(pos.x, pos.z);

    // troppo lontano: se ne va (la regia ne manda un altro vicino al giocatore)
    if (dist > LOST_DIST) {
      s.gone = true;
      actor.ragdoll.deactivate();
      onGone(id);
      return;
    }

    if (s.riseT > 0) {
      // si rialza dal terreno (Zombie_Rise): fermo
      if (s.rise === 0) {
        actor.play('Zombie_Rise', 0.05, false);
        s.rise = 1;
      }
      s.riseT -= delta;
    } else {
      const playerDown = store.health <= 0;
      if (s.clawAnim > 0) s.clawAnim -= delta;
      s.attackCd -= delta;
      if (dist > ATTACK_RANGE * 0.8 && s.clawAnim <= 0) {
        const marchYaw = stepToward(actor, pos, s.step, pp[0], pp[2], K.speed, delta);
        if (marchYaw !== null) g.rotation.y += wrap(marchYaw - g.rotation.y) * Math.min(1, delta * 6);
        const clip = actor.hasClip(K.clip) ? K.clip : 'Walk';
        if (!s.step.vault) actor.play(clip, 0.25, true, K.ts > 0 ? K.ts : timeScaleFor(K.clip, K.speed));
      } else {
        // a portata: si gira verso di te e graffia
        if (dist > 0.01) g.rotation.y += wrap(Math.atan2(dx, dz) - g.rotation.y) * Math.min(1, delta * 10);
        if (s.clawAnim <= 0) actor.play(actor.hasClip('Zombie_Idle') ? 'Zombie_Idle' : 'Idle_A', 0.2);
        if (s.attackCd <= 0 && dist <= ATTACK_RANGE && !playerDown) {
          s.attackCd = ATTACK_COOLDOWN_S + Math.random() * 0.5;
          const clip = CLAW_CLIPS[Math.floor(Math.random() * CLAW_CLIPS.length)];
          if (actor.hasClip(clip)) {
            actor.play(clip, 0.08, false, 0.75);
            s.clawAnim = Math.min(0.7, actor.clipDuration(clip) / 0.75);
          }
          _aim.set(dx, 0, dz).normalize();
          _pt.set(pp[0], pp[1], pp[2]);
          damageFighter(PLAYER_ID, { segment: 'Torso', damage: ATTACK_DAMAGE, dirWorld: _aim, speed: 1.4, pointWorld: _pt });
        }
      }
    }

    g.position.set(pos.x, gy + s.step.lift, pos.z);
    data.rotation = g.rotation.y + Math.PI;
    if (s.warm < 3 && ++s.warm >= 3) g.visible = true;

    s.entityT -= delta;
    if (s.entityT <= 0) {
      s.entityT = 0.25;
      store.updateEntity(id, { type: 'enemy', position: [pos.x, gy + 1, pos.z], rotation: g.rotation.y });
    }
  });

  return (
    <>
      <group ref={groupRef} visible={false} position={[x, getTerrainHeight(x, z) + getRoadOffset(x, z), z]}>
        <primitive object={actor.clone} />
      </group>
      <EnemyHealthBar data={data} maxHp={K.hp} />
    </>
  );
};

export default Zombie;
