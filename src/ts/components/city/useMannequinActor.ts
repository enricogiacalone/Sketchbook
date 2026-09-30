import { useEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { useRagdoll } from '../Environment/ragdoll/useRagdoll';
import { makeFighter } from '../Environment/DuelArena';
import type { FighterData } from '../Environment/SquadArenaTypes';
import { registerFighterHitHandler } from '../Environment/weapons/shootableRegistry';
import { addCityOpponent, removeCityOpponent } from './cityActors';
import { useStore } from '../../store';

// "sostituisci i nemici della citta' con il nostro manichino.. basta
// boxman": il corpo comune di passanti, nemici e poliziotti -- lo stesso
// modello e le stesse animazioni del giocatore, con il suo ragdoll:
// - capsule solide per segmento (bloccano il giocatore, fermano i
//   proiettili e dicono dove hanno colpito: testa, busto, gambe...);
// - hurtbox per pugni e coltello;
// - reazione fisica ai colpi e ragdoll vero alla morte (anche lanciato:
//   colpo mortale, investimento).
// Il comportamento (camminare, inseguire, sparare) e' di chi lo usa.

export const MANNEQUIN_URL = 'soldier-citizen.glb';
export const MANNEQUIN_BASE_ANIMS_URL = 'soldier-citizen-base-animations.glb';
export const MANNEQUIN_ADDON_ANIMS_URL = 'soldier-citizen-addon-animations.glb';

// oltre questa distanza dal giocatore: animazione a scatti e niente fisica
// del corpo (non lo vede nessuno da vicino, costa)
const FAR_DIST = 70;
const FAR_ANIM_STEP_S = 1 / 10;
// investito: sopra questa velocita' dell'auto nel punto d'urto e' morte
const RUN_OVER_KILL_SPEED = 4;

export interface ActorHit {
  seg: string;
  dir: THREE.Vector3;
  speed: number;
}

export interface MannequinActorOptions {
  id: string;
  name: string;
  team: string;
  color: string;
  hp: number;
  x: number;
  z: number;
  rotation?: number;
  // colpibile dal giocatore (entra nella lista degli avversari)
  targetable?: boolean;
}

const _dir = new THREE.Vector3();

export function useMannequinActor(opts: MannequinActorOptions) {
  const { id, color } = opts;
  const { scene } = useGLTF(MANNEQUIN_URL);
  const { animations: baseAnims } = useGLTF(MANNEQUIN_BASE_ANIMS_URL);
  const { animations: addonAnims } = useGLTF(MANNEQUIN_ADDON_ANIMS_URL);
  const { camera } = useThree();

  const data: FighterData = useMemo(() => {
    const d = makeFighter(id, opts.name, opts.team, opts.x, opts.z, opts.rotation ?? 0);
    d.hp = opts.hp;
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const maxHp = useRef(opts.hp);

  const { clone, mixer, clips } = useMemo(() => {
    const c = SkeletonUtils.clone(scene);
    c.traverse((child: any) => {
      if (child.isSkinnedMesh) {
        child.material = child.material.clone();
        child.material.emissive = new THREE.Color(color);
        child.material.emissiveIntensity = 0.35;
        // ragdoll: le ossa possono allontanarsi dal box di culling a riposo
        child.frustumCulled = false;
      }
    });
    const m = new THREE.AnimationMixer(c);
    const map: Record<string, THREE.AnimationClip> = {};
    for (const clip of [...baseAnims, ...addonAnims]) map[clip.name] = clip;
    return { clone: c, mixer: m, clips: map };
  }, [scene, baseAnims, addonAnims, color]);

  const modelRootRef = useRef<THREE.Object3D | null>(null);
  const ragdoll = useRagdoll(modelRootRef, id);
  useEffect(() => {
    modelRootRef.current = clone;
  }, [clone]);

  // --- animazioni: azioni create quando servono -------------------------
  const actionsRef = useRef<Record<string, THREE.AnimationAction>>({});
  const curRef = useRef<string | null>(null);
  const play = (name: string, fade = 0.2, loop = true, timeScale = 1) => {
    const clip = clips[name];
    if (!clip) return;
    const acts = actionsRef.current;
    const a = (acts[name] ??= mixer.clipAction(clip));
    a.setEffectiveTimeScale(timeScale);
    if (curRef.current === name && (loop || a.isRunning())) return;
    const prev = curRef.current ? acts[curRef.current] : null;
    if (prev && prev !== a) prev.fadeOut(fade);
    a.reset();
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    a.clampWhenFinished = !loop;
    a.setEffectiveWeight(1);
    a.fadeIn(fade).play();
    curRef.current = name;
    data.currentAnim = name;
  };
  const hasClip = (name: string) => !!clips[name];
  const clipDuration = (name: string) => clips[name]?.duration ?? 1;

  // --- colpi ---------------------------------------------------------------
  // l'ultimo colpo con direzione (sparo, investimento): se e' mortale il
  // corpo morto parte in quella direzione
  const lastHitRef = useRef<ActorHit | null>(null);
  useEffect(() => {
    // sostituisce la reazione di useRagdoll (registrata prima, stesso id):
    // la stessa spinta finche' e' vivo, e si ricorda il colpo
    return registerFighterHitHandler(id, (seg, dir, speed) => {
      // la velocita' di reazione degli spari (pensata per un segmento del
      // rig attivo) e' troppa per lanciare un corpo intero: un terzo
      lastHitRef.current = { seg, dir: dir.clone(), speed: speed * 0.35 };
      if (!data.isDead) ragdoll.pulseHit(dir, speed / 40, seg);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // colpibile dal giocatore finche' e' vivo
  useEffect(() => {
    if (opts.targetable === false) return;
    addCityOpponent(data);
    return () => removeCityOpponent(data);
  }, [data, opts.targetable]);

  // le capsule solide nascono alla prima resolveBodyMovement (useRagdoll):
  // chi non si muove con quella (passanti su binario) le crea qui
  const solidInitRef = useRef(false);
  const deadRef = useRef(false);
  const deadForRef = useRef(0);
  const farAccRef = useRef(0);

  // Da chiamare a ogni frame PRIMA di muovere il personaggio. Ritorna:
  // 'dead' (e' a terra, il chiamante non fa altro), 'hurt' (colpito in
  // questo frame), null.
  const beginFrame = (delta: number, pos: { x: number; z: number }): 'dead' | 'hurt' | null => {
    const far = camera.position.distanceTo(_dir.set(pos.x, camera.position.y, pos.z)) > FAR_DIST;
    ragdoll.beginFrame();
    if (far && !deadRef.current) {
      farAccRef.current += delta;
      if (farAccRef.current >= FAR_ANIM_STEP_S) {
        mixer.update(farAccRef.current);
        farAccRef.current = 0;
      }
    } else {
      mixer.update(delta + farAccRef.current);
      farAccRef.current = 0;
      if (!solidInitRef.current && !deadRef.current) {
        solidInitRef.current = true;
        ragdoll.resolveBodyMovement(0, 0, null);
      }
      ragdoll.update(delta, false, false, false);
    }
    data.hurtboxHandle = ragdoll.getHurtboxHandle();

    if (!deadRef.current && !far) {
      // investimenti (auto): spinta o morte, come il giocatore
      const ob = ragdoll.resolveObstacleContacts(null, delta);
      if (ob.hitSpeed >= RUN_OVER_KILL_SPEED) {
        data.hp = 0;
        data.isDead = true;
        _dir.set(ob.hitVX, 0.35 * ob.hitSpeed, ob.hitVZ);
        lastHitRef.current = { seg: ob.segment ?? 'Hips', dir: _dir.clone().normalize(), speed: _dir.length() };
      }
    }

    if (data.isDead) {
      if (!deadRef.current) {
        deadRef.current = true;
        deadForRef.current = 0;
        data.hp = 0;
        ragdoll.activateDeath();
        const h = lastHitRef.current;
        if (h) {
          _dir.copy(h.dir).multiplyScalar(Math.min(h.speed, 12));
          _dir.y = Math.max(_dir.y, 0.4);
          ragdoll.launchDeath(_dir, h.seg);
        } else {
          // colpo mortale corpo a corpo: indietro, lontano da chi colpisce
          const pp = useStore.getState().playerPos;
          _dir.set(pos.x - pp[0], 0, pos.z - pp[2]);
          if (_dir.lengthSq() < 1e-4) _dir.set(0, 0, 1);
          _dir.normalize().multiplyScalar(2.5);
          _dir.y = 0.8;
          ragdoll.launchDeath(_dir, 'Torso', 0.6);
        }
        removeCityOpponent(data);
      }
      deadForRef.current += delta;
      return 'dead';
    }

    let hurt = false;
    if (data.triggerHit) {
      if (!data.hitReactionHandled) {
        _dir.set(pos.x - data.hitFromX, 0.35, pos.z - data.hitFromZ);
        if (_dir.lengthSq() < 1e-4) _dir.set(0, 0.35, 1);
        _dir.normalize();
        ragdoll.pulseHit(_dir, 0.3, data.triggerHit === 'Hit_Head' ? 'Head' : 'Torso', data.hitFromX, data.hitFromZ);
      }
      data.triggerHit = null;
      data.hitReactionHandled = false;
      hurt = true;
    }
    if (data.knockdown) {
      // colpo forte (affondo di coltello): spinta piu' grande
      _dir.set(data.knockdown.dirX, 0.4, data.knockdown.dirZ).normalize();
      ragdoll.pulseHit(_dir, 0.8, 'Torso');
      data.knockdown = null;
      hurt = true;
    }
    if (hurt) lastHitRef.current = null;
    return hurt ? 'hurt' : null;
  };

  // rimette in vita (passante che torna al suo percorso)
  const revive = () => {
    if (!deadRef.current) return;
    ragdoll.deactivate();
    deadRef.current = false;
    data.isDead = false;
    data.hp = maxHp.current;
    lastHitRef.current = null;
    curRef.current = null;
    if (opts.targetable !== false) addCityOpponent(data);
  };

  if (import.meta.env.DEV) {
    const reg = ((window as any).__npcs ??= {});
    reg[id] = { data, ragdoll, deadFor: () => deadForRef.current, isDead: () => deadRef.current };
  }

  return {
    data,
    clone,
    modelRootRef,
    ragdoll,
    play,
    hasClip,
    clipDuration,
    beginFrame,
    revive,
    isDead: () => deadRef.current,
    deadFor: () => deadForRef.current,
    maxHp: () => maxHp.current,
  };
}

export type MannequinActor = ReturnType<typeof useMannequinActor>;

useGLTF.preload(MANNEQUIN_URL);
useGLTF.preload(MANNEQUIN_BASE_ANIMS_URL);
useGLTF.preload(MANNEQUIN_ADDON_ANIMS_URL);
