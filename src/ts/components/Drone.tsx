import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody, BallCollider, RapierRigidBody, useRapier } from '@react-three/rapier';
import { useGLTF } from '../lib/gltf';
import * as THREE from 'three';
import { useInput } from '../hooks/useInput';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { CollisionGroups, groupsExcluding } from '../enums/CollisionGroups';
import { droneMouseDelta, droneOrientation, droneShake, droneCamPose, droneHud, DroneHudTarget, dronePad } from '../lib/droneFlight';
import { acquireAudioListener, releaseAudioListener } from '../lib/sharedAudioListener';
import { cityOpponents } from './city/cityActors';
import type { FighterData } from './Environment/SquadArenaTypes';
import { getShootableCollider, applyFighterHit } from './Environment/weapons/shootableRegistry';
import { emitShotFx } from './Environment/weapons/weaponFx';
import { getTerrainHeight } from './Environment/Terrain';
import { getRoadOffset } from './Environment/Road';
import Explosion from './Environment/Explosion';
import { explodeAt } from '../lib/explosions';

// "voglio che il drone in realta' e' il compagno del player e gli
// fluttua attorno quando premo b ne prendo il controllo" -- entity sua,
// sempre presente: segue il giocatore (companion follow, sotto) finche'
// 'fly' (B) non gliene da' il comando.
//
// "quando vola (ne prendo il comando) deve comportarsi come in droneWorld.
// uguale con la stessa ui di mira" (github.com/blaze33/droneWorld, MIT):
// - chi vola e' il TELAIO DEL PILOTA, cioe' la camera (FlyControls.js):
//   il mouse sposta un puntatore virtuale dentro un cerchio (il
//   "limitatore") e la sua distanza dal centro e' la VELOCITA' di
//   rotazione -- una cloche, non un mouse-look: destra/sinistra =
//   imbardata con rollio automatico, su/giu' = beccheggio. W/S spinta
//   avanti/indietro, R/F su/giu', A/D e frecce imbardata/beccheggio, Q/E
//   rollio. Velocita' nel riferimento del telaio, con lo stesso attrito;
// - il drone e' disegnato 20 unita' davanti e 8 sotto la camera, dritto e
//   inclinato in avanti verso dove guarda (drones/init.js);
// - mitragliatrice (sinistro tenuto): raffica che mira da sola al punto di
//   anticipo del bersaglio nel cerchio focale, si surriscalda in 1.5 s;
//   missile (destro) solo col bersaglio agganciato (2 s nel cerchio
//   focale), a ricerca; urto contro il mondo: botto, rimbalzo e 1 s senza
//   spinta;
// - HUD identico (UI/DroneHUD.tsx), suoni originali (public/drone-sounds).
// Le unita' di droneWorld sono grandi (il suo mondo e' una montagna): qui
// distanze e velocita' sono scalate di DW (1 unita' = 0.2 m).
export const DRONE_ID = 'companion-drone';

const DW = 0.2; // metri per unita' di droneWorld

// -- Companion-follow (not being piloted) --------------------------------
const FOLLOW_OFFSET = new THREE.Vector3(1.8, 1.7, -1.6);
const FOLLOW_GAIN = 3.2;
const FOLLOW_MAX_SPEED = 14;
const FOLLOW_BOB_AMPLITUDE = 0.15;
const FOLLOW_BOB_SPEED = 1.6;
const FOLLOW_LEVEL_SLERP = 0.05;

// -- Volo (FlyControls.js di droneWorld) ------------------------------------
const CAM_AHEAD = 20 * DW; // il drone sta 20 unita' davanti alla camera...
const CAM_BELOW = 8 * DW; // ...e 8 sotto
const ACCELERATION = 100 * DW; // m/s^2
const ROLL_SPEED = 0.001; // rad per ms per unita' di comando
const POINTER_DIVIDER = 1.5; // FlyControls: pageX = puntatore / 1.5
const ZONE_PX = 400; // raggio del limitatore
const FOCAL_PX = 150; // raggio del cerchio focale
const DRONE_RADIUS = 0.6; // collider
const CRASH_ACCEL_OFF_S = 1; // dopo un urto: niente spinta per 1 s

// -- Armi ---------------------------------------------------------------------
const GUN_RANGE = 500 * DW; // m
const BULLET_SPEED = 500 * DW; // m/s
const BULLET_UP = 24 * DW; // senza bersaglio: un filo verso l'alto
const BULLET_SPREAD = 20 * DW; // m/s per asse
const BULLET_RATE = 35; // colpi/s
const BULLET_LIFE = 1; // s
const BULLET_DAMAGE = 5;
const BULLET_PROXIMITY = 0.7; // m dal petto del bersaglio (droneWorld: 10 unita')
const GUN_HEAT_S = 1.5; // secondi di fuoco per surriscaldarsi
const GUN_COOL_PER_S = 0.6;
const LOCK_S = 2; // secondi nel cerchio focale per agganciare
const LOCK_DECAY_PER_S = 1.2;
const MISSILE_SPEED = 600 * DW; // m/s (10 unita' a frame)
const MISSILE_HIT = 10 * DW; // m
const MISSILE_DAMAGE = 25;
// raggio dell'esplosione del missile (m)
const MISSILE_BLAST_RADIUS = 5;
const MISSILE_LIFE = 5; // s
const SHAKE = 1 * DW; // scuotimento camera mentre si spara (±0.5 unita')
const TARGET_CHEST_Y = 1.2;
const MAX_BULLETS = 64;
// campo visivo della camera di droneWorld (PerspectiveCamera(75, ...))
const FLY_FOV = 75;

// drone.glb: ~90 unita' di larghezza; muso su +Z locale, sopra su +Y
const DRONE_MODEL_SCALE = 0.016;
const DRONE_MODEL_ROTATION: [number, number, number] = [-Math.PI / 2, 0, 0];

const SOUND_URLS = {
  gatling: 'drone-sounds/gatling.ogg',
  missile: 'drone-sounds/missile.ogg',
  explosions: ['drone-sounds/explosion1.ogg', 'drone-sounds/explosion2.ogg'],
  impacts: ['drone-sounds/impact1.ogg', 'drone-sounds/impact2.ogg', 'drone-sounds/impact3.ogg', 'drone-sounds/impact4.ogg'],
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _euler = new THREE.Euler();
const _dronePos = new THREE.Vector3();
const _proj = new THREE.Vector3();
const _seg = new THREE.Line3();
const _closest = new THREE.Vector3();
const _tmpObj = new THREE.Object3D();

interface FlyBullet {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
}
interface FlyMissile {
  id: number;
  pos: THREE.Vector3;
  target: FighterData;
  age: number;
}
interface Boom {
  id: number;
  pos: [number, number, number];
  scale: number;
}

// bersagli dell'HUD: nemici della citta' e altri giocatori, vivi
const isHudTarget = (d: FighterData) => !d.isDead && (d.team === 'CITY_ENEMY' || d.team.startsWith('REMOTE_'));
const chestOf = (d: FighterData, out: THREE.Vector3) => {
  const x = d.position.x, z = d.position.z;
  return out.set(x, getTerrainHeight(x, z) + getRoadOffset(x, z) + TARGET_CHEST_Y, z);
};
const toiOf = (hit: unknown): number => {
  const h = hit as { timeOfImpact?: number; time_of_impact?: number; toi?: number };
  return h.timeOfImpact ?? h.time_of_impact ?? h.toi ?? 0;
};

const Drone: React.FC = () => {
  const { scene } = useGLTF('drone.glb');
  const clonedScene = useMemo(() => scene.clone(), [scene]);
  const input = useInput();
  const { camera, scene: rootScene } = useThree();
  const { world, rapier } = useRapier();
  const { currentControllable, controlledEntityId, isPaused, playerPos, playerYaw, setIsDrone } = useStore(
    useShallow((state) => ({
      currentControllable: state.currentControllable,
      controlledEntityId: state.controlledEntityId,
      isPaused: state.isPaused || state.physicsPaused,
      playerPos: state.playerPos,
      playerYaw: state.playerYaw,
      setIsDrone: state.setIsDrone,
    }))
  );

  const bodyRef = useRef<RapierRigidBody>(null);
  const visualRef = useRef<THREE.Group>(null);
  const droneQuaternion = useRef(new THREE.Quaternion());
  const wasActive = useRef(false);

  // telaio del pilota (= la camera di droneWorld)
  const fly = useRef({
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    vel: new THREE.Vector3(), // nel riferimento del telaio
    pointer: new THREE.Vector2(), // px dal centro
    accelOff: 0,
    lastDronePos: new THREE.Vector3(),
    speed: 0,
    altitudeT: 0,
    altitude: NaN,
    gunHeat: 0,
    gunOn: false,
    overheated: false,
    bulletAcc: 0,
    lockLevel: 0,
    impactSoundT: 0,
    savedFov: 0,
    lastTargetPos: new Map<string, THREE.Vector3>(),
    targetVel: new Map<string, THREE.Vector3>(),
  });

  // tasti di FlyControls (anche R/F e frecce, che useInput non ha)
  const keys = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keys.current[e.code] = true;
    };
    const up = (e: KeyboardEvent) => {
      keys.current[e.code] = false;
    };
    const blur = () => {
      keys.current = {};
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // --- suoni di droneWorld (src/sound) ---------------------------------------
  const sounds = useRef<{
    listener: THREE.AudioListener | null;
    buffers: Record<string, AudioBuffer>;
    gatling: THREE.Audio | null;
  }>({ listener: null, buffers: {}, gatling: null });
  useEffect(() => {
    const listener = acquireAudioListener(camera);
    const s = sounds.current;
    s.listener = listener;
    s.gatling = new THREE.Audio(listener);
    s.gatling.setLoop(true);
    s.gatling.setVolume(0.5);
    let alive = true;
    const loader = new THREE.AudioLoader();
    const all = [SOUND_URLS.gatling, SOUND_URLS.missile, ...SOUND_URLS.explosions, ...SOUND_URLS.impacts];
    for (const url of all) {
      loader.load(
        url,
        (buf) => {
          if (!alive) return;
          s.buffers[url] = buf;
          if (url === SOUND_URLS.gatling) s.gatling?.setBuffer(buf);
        },
        undefined,
        () => console.warn('[drone] suono non trovato:', url)
      );
    }
    return () => {
      alive = false;
      if (s.gatling?.isPlaying) s.gatling.stop();
      s.gatling = null;
      s.listener = null;
      releaseAudioListener();
    };
  }, [camera]);
  const playAt = (url: string, pos: THREE.Vector3 | null, refDist = 20, volume = 0.8) => {
    const s = sounds.current;
    const buf = s.buffers[url];
    if (!buf || !s.listener) return;
    if (pos) {
      const a = new THREE.PositionalAudio(s.listener);
      a.setBuffer(buf);
      a.setRefDistance(refDist);
      a.setVolume(volume);
      const holder = new THREE.Object3D();
      holder.position.copy(pos);
      holder.add(a);
      rootScene.add(holder);
      a.onEnded = () => {
        a.disconnect();
        rootScene.remove(holder);
      };
      a.play();
    } else {
      const a = new THREE.Audio(s.listener);
      a.setBuffer(buf);
      a.setVolume(volume);
      a.play();
    }
  };

  // --- proiettili (instanced), missili, esplosioni -------------------------
  const bulletsRef = useRef<FlyBullet[]>([]);
  const bulletMeshRef = useRef<THREE.InstancedMesh>(null);
  const missilesRef = useRef<FlyMissile[]>([]);
  const [missileIds, setMissileIds] = useState<number[]>([]);
  const missileMeshes = useRef(new Map<number, THREE.Object3D>());
  const [booms, setBooms] = useState<Boom[]>([]);
  const serial = useRef(0);
  const addBoom = useCallback((p: THREE.Vector3, scale: number) => {
    const id = serial.current++;
    setBooms((l) => [...l, { id, pos: [p.x, p.y, p.z], scale }]);
  }, []);
  const removeBoom = useCallback((id: number) => setBooms((l) => l.filter((b) => b.id !== id)), []);

  const initialPos = useMemo<[number, number, number]>(() => [
    playerPos[0] + FOLLOW_OFFSET.x,
    playerPos[1] + FOLLOW_OFFSET.y,
    playerPos[2] + FOLLOW_OFFSET.z,
  ], []); // eslint-disable-line react-hooks/exhaustive-deps

  // danno a un combattente (stesso contratto degli spari del giocatore:
  // vita, reazione, spinta fisica nel punto)
  const damage = (d: FighterData, amount: number, seg: string, dir: THREE.Vector3, speed: number, point: THREE.Vector3) => {
    if (d.isDead) return;
    d.hp -= amount;
    if (d.hp <= 0) {
      d.hp = 0;
      d.isDead = true;
      d.attackLock = 0;
    } else {
      d.triggerHit = seg === 'Head' ? 'Hit_Head' : 'Hit_Chest';
      d.hitReactionHandled = true;
      d.hitFromX = point.x - dir.x;
      d.hitFromZ = point.z - dir.z;
    }
    applyFighterHit(d.id, seg, dir, speed, point);
  };

  // proiettili e missili: movimento, colpi, disegno
  const updateProjectiles = (delta: number) => {
    const f = fly.current;
    f.impactSoundT -= delta;
    const body = bodyRef.current ?? undefined;
    const list = bulletsRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      b.age += delta;
      const step = b.vel.length() * delta;
      const dir = _v1.copy(b.vel).normalize();
      let done = b.age > BULLET_LIFE;
      if (!done) {
        const ray = new rapier.Ray({ x: b.pos.x, y: b.pos.y, z: b.pos.z }, { x: dir.x, y: dir.y, z: dir.z });
        const hit = world.castRayAndGetNormal(ray, step, true, rapier.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, body);
        let point: THREE.Vector3 | null = null;
        let target: FighterData | null = null;
        let seg = 'Torso';
        let normal: THREE.Vector3 | null = null;
        let surface: 'world' | 'body' = 'world';
        if (hit) {
          point = b.pos.clone().addScaledVector(dir, toiOf(hit));
          normal = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
          const info = getShootableCollider(hit.collider.handle);
          if (info) {
            target = cityOpponents.find((o) => o.id === info.ownerId) ?? null;
            seg = info.segment;
            surface = 'body';
          }
        } else {
          // spoletta di prossimita' (droneWorld: 10 unita' dal bersaglio)
          _seg.set(b.pos, _v2.copy(b.pos).addScaledVector(dir, step));
          for (const d of cityOpponents) {
            if (!isHudTarget(d)) continue;
            chestOf(d, _v3);
            _seg.closestPointToPoint(_v3, true, _closest);
            if (_closest.distanceTo(_v3) < BULLET_PROXIMITY) {
              point = _closest.clone();
              target = d;
              surface = 'body';
              break;
            }
          }
        }
        if (point) {
          done = true;
          if (target) damage(target, BULLET_DAMAGE, seg, dir.clone(), 6, point);
          // scintille / foro, solo in locale (niente rete a 35 colpi/s)
          emitShotFx({ from: point.clone().addScaledVector(dir, -0.4), to: point, normal, surface, decal: surface === 'world' }, true);
          if (f.impactSoundT <= 0) {
            f.impactSoundT = 0.12;
            playAt(SOUND_URLS.impacts[Math.floor(Math.random() * 4)], point, 12, 0.5);
          }
        } else {
          b.pos.addScaledVector(b.vel, delta);
        }
      }
      if (done) list.splice(i, 1);
    }
    const mesh = bulletMeshRef.current;
    if (mesh) {
      for (let i = 0; i < MAX_BULLETS; i++) {
        const b = list[i];
        if (b) {
          _tmpObj.position.copy(b.pos);
          _tmpObj.scale.setScalar(1);
        } else {
          _tmpObj.position.set(0, -1000, 0);
          _tmpObj.scale.setScalar(0);
        }
        _tmpObj.updateMatrix();
        mesh.setMatrixAt(i, _tmpObj.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    const ms = missilesRef.current;
    let removed = false;
    for (let i = ms.length - 1; i >= 0; i--) {
      const m = ms[i];
      m.age += delta;
      chestOf(m.target, _v3);
      _v2.copy(_v3).sub(m.pos);
      const dist = _v2.length();
      if (dist < MISSILE_HIT || m.target.isDead || m.age > MISSILE_LIFE) {
        if (dist < MISSILE_HIT || m.target.isDead) {
          addBoom(m.pos, 1);
          playAt(SOUND_URLS.explosions[Math.floor(Math.random() * 2)], m.pos, 40, 1);
          // danno, KO o morte e spinta per tutti quelli vicini, non solo
          // il bersaglio (lib/explosions.ts)
          explodeAt(m.pos, { radius: MISSILE_BLAST_RADIUS, power: 1, damage: MISSILE_DAMAGE * 2, source: 'missile del drone' });
        }
        ms.splice(i, 1);
        missileMeshes.current.delete(m.id);
        removed = true;
        continue;
      }
      m.pos.addScaledVector(_v2.normalize(), Math.min(dist, MISSILE_SPEED * delta));
      const obj = missileMeshes.current.get(m.id);
      if (obj) {
        obj.position.copy(m.pos);
        obj.lookAt(_v3);
      }
    }
    if (removed) setMissileIds(ms.map((m) => m.id));
  };

  useFrame((state, dtRaw) => {
    const body = bodyRef.current;
    const visual = visualRef.current;
    if (!body || !visual || isPaused) return;
    const delta = Math.min(dtRaw, 0.1);
    const f = fly.current;

    const flyPressed = input.consumeJustPressed('fly');
    const isActive = currentControllable === 'drone' && controlledEntityId === DRONE_ID;

    if (isActive && !wasActive.current) {
      // Preso il comando: il telaio parte dietro e sopra il drone, livellato,
      // rivolto dove guardava la camera (niente scatti)
      body.setBodyType(rapier.RigidBodyType.KinematicPositionBased, true);
      const t = body.translation();
      _dronePos.set(t.x, t.y, t.z);
      camera.getWorldDirection(_fwd);
      _fwd.y = 0;
      if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
      _fwd.normalize();
      // Matrix4.lookAt: la camera guarda lungo -Z verso il bersaglio
      _m.lookAt(_v1.set(0, 0, 0), _fwd, WORLD_UP);
      f.quat.setFromRotationMatrix(_m);
      // camera = drone - avanti*20 + su*8
      f.pos.copy(_dronePos).addScaledVector(_fwd, -CAM_AHEAD).addScaledVector(WORLD_UP, CAM_BELOW);
      f.vel.set(0, 0, 0);
      f.pointer.set(0, 0);
      f.accelOff = 0;
      f.gunHeat = 0;
      f.overheated = false;
      f.lockLevel = 0;
      f.lastDronePos.copy(_dronePos);
      droneMouseDelta.x = 0;
      droneMouseDelta.y = 0;
      const pc = camera as THREE.PerspectiveCamera;
      if (pc.isPerspectiveCamera) {
        f.savedFov = pc.fov;
        pc.fov = FLY_FOV;
        pc.updateProjectionMatrix();
      }
    }
    if (!isActive && wasActive.current) {
      const pc = camera as THREE.PerspectiveCamera;
      if (pc.isPerspectiveCamera && f.savedFov) {
        pc.fov = f.savedFov;
        pc.updateProjectionMatrix();
      }
      body.setBodyType(rapier.RigidBodyType.Dynamic, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      if (sounds.current.gatling?.isPlaying) sounds.current.gatling.stop();
      f.gunOn = false;
      droneHud.active = false;
      droneHud.targets = [];
    }
    wasActive.current = isActive;

    updateProjectiles(delta);

    if (!isActive) {
      // -- Companion float ----------------------------------------------------
      const t = body.translation();
      _dronePos.set(t.x, t.y, t.z);
      _fwd.copy(FOLLOW_OFFSET).applyAxisAngle(WORLD_UP, playerYaw);
      const targetX = playerPos[0] + _fwd.x;
      const targetY = playerPos[1] + _fwd.y + Math.sin(state.clock.elapsedTime * FOLLOW_BOB_SPEED) * FOLLOW_BOB_AMPLITUDE;
      const targetZ = playerPos[2] + _fwd.z;
      const ex = targetX - _dronePos.x;
      const ey = targetY - _dronePos.y;
      const ez = targetZ - _dronePos.z;
      const dist = Math.hypot(ex, ey, ez) || 1;
      const speed = Math.min(dist * FOLLOW_GAIN, FOLLOW_MAX_SPEED);
      body.setLinvel({ x: (ex / dist) * speed, y: (ey / dist) * speed, z: (ez / dist) * speed }, true);

      _euler.set(0, playerYaw, 0, 'YXZ');
      _q.setFromEuler(_euler);
      droneQuaternion.current.slerp(_q, 1 - Math.pow(1 - FOLLOW_LEVEL_SLERP, delta * 60));
      body.setRotation(droneQuaternion.current, true);
      visual.position.copy(_dronePos);
      visual.quaternion.copy(droneQuaternion.current);
      return;
    }

    // ===================== VOLO (FlyControls.js) =========================
    const dtMs = delta * 1000;
    const w = state.size.width;
    const h = state.size.height;
    // schermi piccoli: limitatore e cerchio focale in proporzione (la
    // risposta dipende dal rapporto puntatore/limitatore: resta uguale)
    const zone = Math.min(ZONE_PX, 0.45 * Math.min(w, h));
    const focal = zone * (FOCAL_PX / ZONE_PX);

    // puntatore virtuale: si accumula e resta dove lo lasci (una cloche)
    f.pointer.x += droneMouseDelta.x;
    f.pointer.y += droneMouseDelta.y;
    droneMouseDelta.x = 0;
    droneMouseDelta.y = 0;
    if (f.pointer.length() > zone) f.pointer.setLength(zone);

    // assi del telaio (come una camera: avanti -Z, su +Y, destra +X)
    _up.set(0, 1, 0).applyQuaternion(f.quat);
    _right.set(1, 0, 0).applyQuaternion(f.quat);
    // rollio attuale, calcolato come l'HUD di droneWorld
    const rollAngle = Math.PI / 2 - WORLD_UP.angleTo(_right) * (Math.sign(WORLD_UP.dot(_up)) || 1);

    const k = keys.current;
    // pad (lib/droneFlight.ts dronePad): la levetta destra e' una cloche
    // come il mouse, ma torna al centro quando la lasci; la sinistra
    // spinge avanti/indietro e imbarda
    const pd = dronePad;
    _v1.set(f.pointer.x + pd.rx * zone, f.pointer.y + pd.ry * zone, 0);
    if (_v1.length() > zone) _v1.setLength(zone);
    const mouseYawLeft = -(_v1.x / POINTER_DIVIDER) / zone;
    const mousePitchDown = (_v1.y / POINTER_DIVIDER) / zone;
    const yawLeft = mouseYawLeft + (k.KeyA || k.ArrowLeft ? 1 : 0) + Math.max(0, -pd.lx);
    const yawRight = (k.KeyD || k.ArrowRight ? 1 : 0) + Math.max(0, pd.lx);
    const pitchUp = k.ArrowUp ? 1 : 0;
    const pitchDown = mousePitchDown + (k.ArrowDown ? 1 : 0);
    // FlyControls.mousemove: rollLeft = yawLeft/2 - rollAngle/5 (si
    // inclina in virata e torna livellato da solo)
    const rollLeft = mouseYawLeft / 2 - rollAngle / 5 + (k.KeyQ || pd.rollL ? 1 : 0);
    const rollRight = k.KeyE || pd.rollR ? 1 : 0;

    const rotMult = dtMs * ROLL_SPEED;
    _q.set((pitchUp - pitchDown) * rotMult, (yawLeft - yawRight) * rotMult, (rollLeft - rollRight) * rotMult, 1).normalize();
    f.quat.multiply(_q).normalize();

    // spinta e attrito (FlyControls.update)
    const forward = Math.max(k.KeyW ? 1 : 0, -pd.ly);
    const back = Math.max(k.KeyS ? 1 : 0, pd.ly);
    const upK = Math.max(k.KeyR || k.Space ? 1 : 0, pd.up);
    const downK = Math.max(k.KeyF || k.ShiftLeft || k.ShiftRight ? 1 : 0, pd.down);
    const accel = f.accelOff > 0 ? 0 : ACCELERATION;
    if (f.accelOff > 0) f.accelOff -= delta;
    _v1.set(0, upK - downK, back - forward).multiplyScalar(delta * accel); // deltaVelocity
    const coast = _v1.lengthSq() === 0 ? (100 * DW) / (f.vel.length() + DW) : 1;
    const damp = Math.min(1, Math.max(1, coast) * 0.01 * (dtMs / 16.67));
    f.vel.addScaledVector(f.vel, -damp).add(_v1);

    // spostamento nel mondo, con urti (il drone sta davanti al telaio)
    const move = _v2.copy(f.vel).applyQuaternion(f.quat).multiplyScalar(delta);
    _fwd.set(0, 0, -1).applyQuaternion(f.quat);
    _up.set(0, 1, 0).applyQuaternion(f.quat);
    f.pos.add(move);
    _dronePos.copy(f.pos).addScaledVector(_fwd, CAM_AHEAD).addScaledVector(_up, -CAM_BELOW);
    _v3.copy(_dronePos).sub(f.lastDronePos);
    const travel = _v3.length();
    if (travel > 1e-5) {
      const hit = world.castShape(
        { x: f.lastDronePos.x, y: f.lastDronePos.y, z: f.lastDronePos.z },
        { x: 0, y: 0, z: 0, w: 1 },
        { x: _v3.x, y: _v3.y, z: _v3.z },
        new rapier.Ball(DRONE_RADIUS),
        0,
        1,
        false,
        rapier.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        undefined,
        body
      );
      if (hit && toiOf(hit) < 1) {
        // droneWorld: botto, velocita' riflessa sulla superficie e un
        // secondo senza spinta
        const toi = toiOf(hit);
        const dirN = _v1.copy(_v3).normalize();
        const ray = new rapier.Ray({ x: f.lastDronePos.x, y: f.lastDronePos.y, z: f.lastDronePos.z }, { x: dirN.x, y: dirN.y, z: dirN.z });
        const nh = world.castRayAndGetNormal(ray, travel + DRONE_RADIUS * 2, true, rapier.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, body);
        const normal = nh ? new THREE.Vector3(nh.normal.x, nh.normal.y, nh.normal.z) : dirN.clone().negate();
        _dronePos.lerpVectors(f.lastDronePos, _dronePos, Math.max(0, toi - 0.05));
        f.pos.copy(_dronePos).addScaledVector(_fwd, -CAM_AHEAD).addScaledVector(_up, CAM_BELOW);
        const worldVel = _v1.copy(f.vel).applyQuaternion(f.quat);
        const impactSpeed = worldVel.length();
        if (worldVel.dot(normal) < 0) worldVel.reflect(normal);
        f.vel.copy(worldVel).applyQuaternion(_q.copy(f.quat).invert());
        if (f.accelOff <= 0 && impactSpeed > 3) {
          addBoom(_dronePos, 0.4);
          playAt(SOUND_URLS.explosions[Math.floor(Math.random() * 2)], _dronePos, 15, 0.6);
        }
        f.accelOff = CRASH_ACCEL_OFF_S;
      }
    }

    // posa del drone: "guarda" un punto 20 avanti e 60 in su -> dritto e
    // inclinato verso la direzione di volo (drones/init.js)
    const dUp = _v3.copy(_fwd).multiplyScalar(20).addScaledVector(WORLD_UP, 60).normalize();
    const dFwd = _v1.copy(_fwd).addScaledVector(dUp, -_fwd.dot(dUp));
    if (dFwd.lengthSq() < 1e-6) dFwd.set(0, 0, 1);
    dFwd.normalize();
    _right.crossVectors(dUp, dFwd).normalize();
    _m.makeBasis(_right, dUp, dFwd);
    droneQuaternion.current.setFromRotationMatrix(_m);
    body.setNextKinematicTranslation(_dronePos);
    body.setNextKinematicRotation(droneQuaternion.current);
    visual.position.copy(_dronePos);
    visual.quaternion.copy(droneQuaternion.current);
    droneOrientation.copy(droneQuaternion.current);

    f.speed = f.lastDronePos.distanceTo(_dronePos) / Math.max(delta, 1e-4);
    f.lastDronePos.copy(_dronePos);

    // camera = telaio (+ scuotimento mentre spara la mitragliatrice)
    droneCamPose.position.copy(f.pos);
    droneCamPose.quaternion.copy(f.quat);
    camera.position.copy(f.pos);
    camera.quaternion.copy(f.quat);
    if (f.gunOn) droneShake.current = SHAKE;
    if (droneShake.current > 1e-4) {
      camera.position.x += (Math.random() - 0.5) * droneShake.current;
      camera.position.y += (Math.random() - 0.5) * droneShake.current;
      camera.position.z += (Math.random() - 0.5) * droneShake.current;
      droneShake.current *= Math.pow(0.85, delta * 60);
    }
    camera.updateMatrixWorld();

    // minimappa & co.
    _euler.setFromQuaternion(droneQuaternion.current, 'YXZ');
    useStore.getState().setPlayerInfo([_dronePos.x, _dronePos.y, _dronePos.z], _euler.y);

    // altitudine (ogni 200 ms, raggio verso il basso)
    f.altitudeT -= delta;
    if (f.altitudeT <= 0) {
      f.altitudeT = 0.2;
      const ray = new rapier.Ray({ x: _dronePos.x, y: _dronePos.y, z: _dronePos.z }, { x: 0, y: -1, z: 0 });
      const r = world.castRay(ray, 500, true, rapier.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, body);
      f.altitude = r ? toiOf(r) : NaN;
    }

    // ========================= HUD (hud/index.js) ==========================
    const cx = w / 2, cy = h / 2;
    const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(f.quat);
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(f.quat);
    const pitch = WORLD_UP.dot(camDir);
    const targets: DroneHudTarget[] = [];
    let anyInSight = false;
    let gunTarget: { d: FighterData; lead: THREE.Vector3; score: number } | null = null;
    for (const d of cityOpponents) {
      if (!isHudTarget(d)) continue;
      const tp = chestOf(d, new THREE.Vector3());
      // velocita' del bersaglio (per l'anticipo)
      const last = f.lastTargetPos.get(d.id);
      const vel = f.targetVel.get(d.id) ?? new THREE.Vector3();
      if (last) vel.lerp(_v1.copy(tp).sub(last).divideScalar(Math.max(delta, 1e-4)), 0.2);
      f.lastTargetPos.set(d.id, tp.clone());
      f.targetVel.set(d.id, vel);

      _proj.copy(tp).project(camera);
      const behind = _proj.z > 1;
      let hx = Math.min(Math.max(10, (_proj.x * 0.5 + 0.5) * w), w - 10);
      let hy = Math.min(Math.max(10, (-_proj.y * 0.5 + 0.5) * h), h - 10);
      if (behind) {
        hx = w - hx;
        hy = h - 10;
      }
      let mx = hx - cx, my = hy - cy;
      let vlen = Math.hypot(mx, my);
      if (vlen > zone) {
        mx = (mx / vlen) * zone;
        my = (my / vlen) * zone;
        vlen = zone;
      }
      const dist3 = camera.position.distanceTo(tp);
      const inSight = !behind && vlen < focal;
      if (inSight) anyInSight = true;
      const t: DroneHudTarget = {
        id: d.id,
        name: d.team.startsWith('REMOTE_') ? d.name : 'nemico',
        x: mx + cx,
        y: my + cy,
        scale: 1.1 - Math.min(0.2, dist3 / (2000 * DW)),
        behind,
        inSight,
        distance: dist3,
        inRange: dist3 < GUN_RANGE,
        life: Math.max(0, d.hp) / 100,
        arrowDeg: (Math.atan2(my, mx) / Math.PI) * 180 + 90,
        arrowOpacity: Math.max(0, 0.8 * (1 - (zone - vlen) / 50)),
        gunHud: false,
        hudX: hx,
        hudY: hy,
        leadDX: 0,
        leadDY: 0,
      };
      if (!behind && vlen < zone * 0.8) {
        // anticipo: dove sara' quando arriva la raffica
        const tv = _v1.copy(camera.position).sub(tp);
        const kLead = Math.min(1, (dist3 + tv.add(vel).length()) / 2 / GUN_RANGE);
        const lead = tp.clone().addScaledVector(vel, kLead);
        _proj.copy(lead).project(camera);
        const lx = Math.min(Math.max(10, (_proj.x * 0.5 + 0.5) * w), w - 10);
        const ly = Math.min(Math.max(10, (-_proj.y * 0.5 + 0.5) * h), h - 10);
        t.gunHud = true;
        t.leadDX = lx - hx;
        t.leadDY = ly - hy;
        if (inSight) {
          const score = Math.hypot(hx - cx + t.leadDX, hy - cy + t.leadDY);
          if (!gunTarget || score < gunTarget.score) gunTarget = { d, lead, score };
        }
      }
      targets.push(t);
    }
    // aggancio: 2 s con qualcuno nel cerchio focale
    if (anyInSight) f.lockLevel = Math.min(1, f.lockLevel + delta / LOCK_S);
    else f.lockLevel = Math.max(0, f.lockLevel - LOCK_DECAY_PER_S * delta);

    // ======================= MITRAGLIATRICE ==============================
    const trigger = input.primary;
    if (!trigger) f.overheated = false;
    const gunNow = trigger && !f.overheated;
    if (gunNow) {
      f.gunHeat = Math.min(1, f.gunHeat + delta / GUN_HEAT_S);
      // surriscaldata: si ferma finche' non si rilascia il grilletto
      if (f.gunHeat >= 1) f.overheated = true;
    } else {
      f.gunHeat = Math.max(0, f.gunHeat - GUN_COOL_PER_S * delta);
    }
    const shooting = gunNow && !f.overheated;
    if (shooting !== f.gunOn) {
      f.gunOn = shooting;
      const g = sounds.current.gatling;
      if (g && g.buffer) {
        if (shooting && !g.isPlaying) g.play();
        if (!shooting && g.isPlaying) g.stop();
      }
    }
    if (shooting) {
      f.bulletAcc += delta * BULLET_RATE;
      const gt = gunTarget as { d: FighterData; lead: THREE.Vector3 } | null;
      let steps = 0;
      while (f.bulletAcc >= 1 && steps < 20) {
        f.bulletAcc -= 1;
        steps++;
        // parte 5 unita' davanti al drone, verso l'anticipo del bersaglio
        // nel mirino se c'e', altrimenti dritto (un filo verso l'alto)
        const origin = _dronePos.clone().addScaledVector(camDir, 5 * DW);
        const vel = new THREE.Vector3();
        if (gt) {
          vel.copy(gt.lead).sub(origin);
          const tvel = f.targetVel.get(gt.d.id);
          if (tvel) vel.addScaledVector(tvel, vel.length() / BULLET_SPEED);
          vel.normalize().multiplyScalar(BULLET_SPEED);
        } else {
          vel.copy(camDir).multiplyScalar(BULLET_SPEED).addScaledVector(camUp, BULLET_UP);
        }
        vel.x += (Math.random() - 0.5) * BULLET_SPREAD;
        vel.y += (Math.random() - 0.5) * BULLET_SPREAD;
        vel.z += (Math.random() - 0.5) * BULLET_SPREAD;
        if (bulletsRef.current.length >= MAX_BULLETS) bulletsRef.current.shift();
        bulletsRef.current.push({ pos: origin, vel, age: 0 });
      }
    } else {
      f.bulletAcc = 0;
    }

    // ============================ MISSILE ================================
    if (input.consumeJustPressed('secondary')) {
      // selectNearestTargetInSight: il piu' vicino tra quelli nel cerchio
      let best: FighterData | null = null;
      let bestD = Infinity;
      for (const t of targets) {
        if (!t.inSight || t.distance >= bestD) continue;
        const d = cityOpponents.find((o) => o.id === t.id);
        if (d && !d.isDead) {
          bestD = t.distance;
          best = d;
        }
      }
      if (!best) {
        best = cityOpponents.find((o) => !o.isDead) ?? null;
      }
      if (!best && cityOpponents.length > 0) {
        best = cityOpponents[0];
      }
      if (best) {
        const id = serial.current++;
        missilesRef.current.push({ id, pos: _dronePos.clone(), target: best, age: 0 });
        setMissileIds((l) => [...l, id]);
        f.lockLevel = 0;
        playAt(SOUND_URLS.missile, null, 0, 0.7);
      }
    }

    // pubblica per DroneHUD
    droneHud.active = true;
    droneHud.width = w;
    droneHud.height = h;
    droneHud.zone = zone;
    droneHud.focal = focal;
    droneHud.pointerX = f.pointer.x;
    droneHud.pointerY = f.pointer.y;
    droneHud.horizonY = (pitch * h) / 2;
    droneHud.horizonDeg = (rollAngle / Math.PI) * 180;
    droneHud.altitude = f.altitude;
    droneHud.speed = f.speed;
    droneHud.gunHeat = f.gunHeat;
    droneHud.lockLevel = f.lockLevel;
    droneHud.lock = f.lockLevel >= 1;
    droneHud.gunTargetId = gunTarget ? (gunTarget as { d: FighterData }).d.id : null;
    droneHud.targets = targets;

    // B (o Triangolo / Select tenuto sul pad): torna al giocatore
    if (flyPressed) {
      setIsDrone(false);
      useStore.getState().setCurrentControllable('player');
    }
  });

  return (
    <>
      <RigidBody
        ref={bodyRef}
        name={`${DRONE_ID}-body`}
        type="dynamic"
        colliders={false}
        position={initialPos}
        gravityScale={0}
        linearDamping={0}
        angularDamping={0}
        collisionGroups={groupsExcluding(CollisionGroups.Default, CollisionGroups.Characters)}
      >
        <BallCollider args={[DRONE_RADIUS]} mass={2} friction={0.2} restitution={0} />
      </RigidBody>
      {/* modello disegnato con la posa calcolata in questo stesso frame (la
          stessa che usa la camera): nessuno scarto fra drone e camera */}
      <group ref={visualRef} name={DRONE_ID} position={initialPos}>
        <group rotation={DRONE_MODEL_ROTATION} scale={DRONE_MODEL_SCALE}>
          <primitive object={clonedScene} />
        </group>
      </group>
      <instancedMesh ref={bulletMeshRef} args={[undefined, undefined, MAX_BULLETS]} frustumCulled={false}>
        <sphereGeometry args={[0.07, 6, 6]} />
        <meshBasicMaterial color="#ffffb0" toneMapped={false} />
      </instancedMesh>
      {missileIds.map((id) => (
        <group
          key={id}
          ref={(o) => {
            if (o) missileMeshes.current.set(id, o);
          }}
        >
          <mesh>
            <sphereGeometry args={[1 * DW, 8, 8]} />
            <meshPhongMaterial color="#111111" />
          </mesh>
          <mesh position={[0, 0, -0.35]}>
            <sphereGeometry args={[0.12, 8, 8]} />
            <meshBasicMaterial color="#ffb347" toneMapped={false} />
          </mesh>
        </group>
      ))}
      {booms.map((b) => (
        <Explosion key={b.id} position={b.pos} scale={b.scale} color="#ff6a00" onFinish={() => removeBoom(b.id)} />
      ))}
    </>
  );
};

export default Drone;
