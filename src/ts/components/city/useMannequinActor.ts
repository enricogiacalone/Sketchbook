import { useEffect, useMemo, useRef } from 'react';
import { KIMODO_ANIMS_URL } from '../../lib/kimodo';
import { useGLTF } from '../../lib/gltf';
import { useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { vehicleBodyHandles } from '../Vehicles/vehicleRegistry';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { useRagdoll } from '../Environment/ragdoll/useRagdoll';
import { useKnockdown } from '../Environment/ragdoll/useKnockdown';
import { GETUP_CLIP } from '../Environment/ragdoll/knockdown';
import { getTerrainHeight } from '../Environment/Terrain';
import { getRoadOffset } from '../Environment/Road';
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

// "personaggi lontani che non calcolano ne' fisica ne' animazioni":
// oltre FAR_DIST (dal giocatore e dalla telecamera) il corpo esce dal mondo
// fisico (capsule solide e hurtbox parcheggiate, niente contatti) e
// l'animazione va a scatti; oltre HIDE_DIST non si anima e non si disegna.
const FAR_DIST = 45;
const FAR_ANIM_STEP_S = 1 / 5;
const HIDE_DIST = 160;
const _pelvisPos = new THREE.Vector3();
// le collisioni con le auto si controllano solo con un'auto entro questa distanza
const VEHICLE_CHECK_DIST = 9;
// investito: sopra questa velocita' dell'auto nel punto d'urto e' morte,
// sopra quest'altra va KO (a terra e poi si rialza, come nell'arena)
const RUN_OVER_KILL_SPEED = 4;
const RUN_OVER_KO_SPEED = 1.5;
// "allinea la ragdoll dei passanti con quella dei nemici nell'arena":
// ragdoll attiva (muscoli, riflessi, KO alla GTA IV) come il nemico del
// duello, ma solo da vicino (costa ~15 corpi fisici a personaggio); con
// un margine tra accensione e spegnimento per non accenderla e spegnerla
// di continuo sul confine. Segue la casella "ragdoll attivo" del pannello.
const ACTIVE_ON_DIST = 18;
const ACTIVE_OFF_DIST = 24;
// zero dei giunti del ragdoll attivo: la stessa guardia del giocatore e del
// nemico del duello (vedi captureClipPose in activeRagdollFrames.ts)
const NEUTRAL_CLIP = 'Fighting Idle';

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
  const { animations: kimodoAnims } = useGLTF(KIMODO_ANIMS_URL);
  const { camera } = useThree();
  const { world } = useRapier();
  const vehicleNear = (x: number, z: number) => {
    for (const h of vehicleBodyHandles) {
      const b = world.getRigidBody(h);
      if (!b) continue;
      const t = b.translation();
      const dx = t.x - x,
        dz = t.z - z;
      if (dx * dx + dz * dz > VEHICLE_CHECK_DIST * VEHICLE_CHECK_DIST) continue;
      const v = b.linvel();
      if (v.x * v.x + v.z * v.z > 0.5) return true;
    }
    return false;
  };

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
    for (const clip of [...baseAnims, ...addonAnims, ...kimodoAnims]) map[clip.name] = clip;
    return { clone: c, mixer: m, clips: map };
  }, [scene, baseAnims, addonAnims, kimodoAnims, color]);

  const modelRootRef = useRef<THREE.Object3D | null>(null);
  const ragdoll = useRagdoll(modelRootRef, id);
  useEffect(() => {
    modelRootRef.current = clone;
    ragdoll.setNeutralClip(clips[NEUTRAL_CLIP] ?? clips['Idle_A'] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clone]);
  // KO fisico e rialzo: lo stesso pezzo del giocatore e del nemico del
  // duello (Environment/ragdoll/useKnockdown.ts)
  const kd = useKnockdown(ragdoll, scene, clips[GETUP_CLIP]);
  const activeRef = useRef(false);
  // la ragdoll attiva e' stata chiesta all'ultimo update (esiste il rig)
  const rigOnRef = useRef(false);
  const getUpLeftRef = useRef(0);
  // colpito mentre andava KO: lo si dice al chiamante quando e' di nuovo in piedi
  const pendingHurtRef = useRef(false);
  const groundAt = (x: number, z: number) => getTerrainHeight(x, z) + getRoadOffset(x, z);
  // via ragdoll attiva e KO (lontano, parcheggiato, rimesso in vita)
  const dropActive = () => {
    kd.cancel();
    getUpLeftRef.current = 0;
    pendingHurtRef.current = false;
    activeRef.current = false;
    // via il rig attivo (solo se c'e': update crea anche capsule e hurtbox,
    // da non fare per un personaggio che non e' mai stato sveglio)
    if (rigOnRef.current) {
      rigOnRef.current = false;
      ragdoll.update(0, false);
    }
  };
  // a terra o mentre si rialza ('down'): la radice sta dove dice il KO
  // (il modello non e' girato di PI nel gruppo, a differenza del giocatore)
  const holdRoot = (g: THREE.Object3D) => {
    g.position.set(data.position.x, groundAt(data.position.x, data.position.z) + kd.lift(), data.position.z);
    g.rotation.y = data.rotation + Math.PI;
  };
  // KO: false se non c'e' la ragdoll attiva (lontano o spenta)
  const startKO = (dirX: number, dirZ: number, speed: number, up = 0.3) => {
    if (deadRef.current || kd.isDown() || !kd.start(dirX, dirZ, speed, up)) return false;
    getUpLeftRef.current = 0;
    pendingHurtRef.current = true;
    data.triggerHit = null;
    return true;
  };

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
  const farParkedRef = useRef(false);
  const dormantRef = useRef(false);

  // Da chiamare a ogni frame PRIMA di muovere il personaggio. Ritorna:
  // 'dead' (e' a terra, il chiamante non fa altro), 'down' (KO o si sta
  // rialzando: il chiamante chiama holdRoot e non fa altro), 'hurt'
  // (colpito in questo frame, o appena rialzato da un KO), null.
  const beginFrame = (delta: number, pos: { x: number; z: number }): 'dead' | 'down' | 'hurt' | null => {
    const pp = useStore.getState().playerPos;
    const dist = Math.min(Math.hypot(camera.position.x - pos.x, camera.position.z - pos.z), Math.hypot(pp[0] - pos.x, pp[2] - pos.z));
    const far = dist > FAR_DIST;
    if (far && !deadRef.current) {
      if (!farParkedRef.current) {
        farParkedRef.current = true;
        dropActive();
        ragdoll.park();
      }
      const hidden = dist > HIDE_DIST;
      clone.visible = !hidden;
      farAccRef.current += delta;
      if (!hidden && farAccRef.current >= FAR_ANIM_STEP_S) {
        mixer.update(farAccRef.current);
        farAccRef.current = 0;
      }
    } else {
      if (farParkedRef.current) {
        // di nuovo vicino: il prossimo update rimette le capsule sulle ossa
        farParkedRef.current = false;
        clone.visible = true;
      }
      ragdoll.beginFrame();
      mixer.update(delta + farAccRef.current);
      farAccRef.current = 0;
      if (!solidInitRef.current && !deadRef.current) {
        solidInitRef.current = true;
        ragdoll.resolveBodyMovement(0, 0, null);
      }
      const st = useStore.getState();
      if (activeRef.current ? dist > ACTIVE_OFF_DIST : dist < ACTIVE_ON_DIST) activeRef.current = !activeRef.current;
      rigOnRef.current = activeRef.current && st.euphoriaRagdollEnabled && !dormantRef.current;
      ragdoll.update(delta, rigOnRef.current, false, st.ragdollPassive);
    }
    data.hurtboxHandle = ragdoll.getHurtboxHandle();

    if (!deadRef.current && !far && vehicleNear(pos.x, pos.z)) {
      // investimenti (auto): spinta o morte, come il giocatore. Le query di
      // contatto (15 capsule) solo se c'e' un'auto in movimento vicina.
      const ob = ragdoll.resolveObstacleContacts(null, delta);
      if (ob.hitSpeed >= RUN_OVER_KILL_SPEED) {
        data.hp = 0;
        data.isDead = true;
        _dir.set(ob.hitVX, 0.35 * ob.hitSpeed, ob.hitVZ);
        lastHitRef.current = { seg: ob.segment ?? 'Hips', dir: _dir.clone().normalize(), speed: _dir.length() };
      } else if (ob.hitSpeed >= RUN_OVER_KO_SPEED) {
        startKO(ob.hitVX, ob.hitVZ, Math.min(ob.hitSpeed * 1.2, 8), 0.35);
      }
    }

    if (data.isDead) {
      if (!deadRef.current) {
        deadRef.current = true;
        deadForRef.current = 0;
        data.hp = 0;
        kd.cancel();
        getUpLeftRef.current = 0;
        ragdoll.activateDeath();
        // con la ragdoll attiva il morto e' lei che va KO (launchDeath vale
        // solo per il rig di morte senza muscoli)
        const launch = (vel: THREE.Vector3, seg: string, share?: number) => {
          if (!ragdoll.knockDown(vel.clone().normalize(), vel.length())) ragdoll.launchDeath(vel, seg, share);
        };
        const h = lastHitRef.current;
        if (h) {
          _dir.copy(h.dir).multiplyScalar(Math.min(h.speed, 12));
          _dir.y = Math.max(_dir.y, 0.4);
          launch(_dir, h.seg);
        } else {
          // colpo mortale corpo a corpo: indietro, lontano da chi colpisce
          const pp = useStore.getState().playerPos;
          _dir.set(pos.x - pp[0], 0, pos.z - pp[2]);
          if (_dir.lengthSq() < 1e-4) _dir.set(0, 0, 1);
          _dir.normalize().multiplyScalar(2.5);
          _dir.y = 0.8;
          launch(_dir, 'Torso', 0.6);
        }
        removeCityOpponent(data);
      }
      deadForRef.current += delta;
      return 'dead';
    }

    // KO (colpo forte, auto lenta): a terra finche' si ferma, poi si rialza
    if (data.knockdown) {
      const k = data.knockdown;
      data.knockdown = null;
      if (!startKO(k.dirX, k.dirZ, k.speed)) {
        // senza ragdoll attiva: solo una spinta forte, come prima
        _dir.set(k.dirX, 0.4, k.dirZ).normalize();
        ragdoll.pulseHit(_dir, 0.8, 'Torso');
        lastHitRef.current = null;
        return 'hurt';
      }
    }
    if (kd.isDown()) {
      data.triggerHit = null;
      const res = kd.step(delta, groundAt(pos.x, pos.z));
      if (ragdoll.getBoneWorldPosition('pelvis', _pelvisPos)) {
        pos.x = _pelvisPos.x;
        pos.z = _pelvisPos.z;
        data.position.x = _pelvisPos.x;
        data.position.z = _pelvisPos.z;
      }
      if (res.done) {
        if (res.place) {
          data.position.x = res.place.x;
          data.position.z = res.place.z;
          data.rotation = res.place.rotation;
          // senza dissolvenza: la clip parte gia' sdraiata sul corpo a terra
          play(GETUP_CLIP, 0, false);
          getUpLeftRef.current = clipDuration(GETUP_CLIP);
        }
      }
      return 'down';
    }
    if (getUpLeftRef.current > 0) {
      getUpLeftRef.current -= delta;
      kd.tick(delta);
      data.triggerHit = null;
      if (getUpLeftRef.current > 0) return 'down';
      kd.stopLift();
    }
    if (pendingHurtRef.current) {
      pendingHurtRef.current = false;
      lastHitRef.current = null;
      return 'hurt';
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
    if (hurt) lastHitRef.current = null;
    return hurt ? 'hurt' : null;
  };

  // Pool di personaggi (folla): "addormentato" = fuori dal mondo, non
  // disegnato, non colpibile, nessun costo; "sveglio" in (x, z).
  const sleep = () => {
    if (dormantRef.current) return;
    dormantRef.current = true;
    dropActive();
    ragdoll.park();
    clone.visible = false;
    removeCityOpponent(data);
  };
  const wake = (x: number, z: number) => {
    dormantRef.current = false;
    farParkedRef.current = false;
    clone.visible = true;
    data.position.set(x, 0, z);
    curRef.current = null;
    if (opts.targetable !== false && !data.isDead) addCityOpponent(data);
  };
  const setTint = (c: THREE.ColorRepresentation) => {
    clone.traverse((child: any) => {
      if (child.isSkinnedMesh) child.material.emissive.set(c);
    });
  };

  // rimette in vita (passante che torna al suo percorso)
  const revive = () => {
    if (!deadRef.current) return;
    ragdoll.deactivate();
    dropActive();
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
    holdRoot,
    isDown: () => kd.isDown() || getUpLeftRef.current > 0,
    revive,
    sleep,
    wake,
    setTint,
    isDormant: () => dormantRef.current,
    isDead: () => deadRef.current,
    deadFor: () => deadForRef.current,
    maxHp: () => maxHp.current,
  };
}

export type MannequinActor = ReturnType<typeof useMannequinActor>;

useGLTF.preload(MANNEQUIN_URL);
useGLTF.preload(MANNEQUIN_BASE_ANIMS_URL);
useGLTF.preload(MANNEQUIN_ADDON_ANIMS_URL);
useGLTF.preload(KIMODO_ANIMS_URL);
