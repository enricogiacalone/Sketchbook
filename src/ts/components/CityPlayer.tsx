import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import * as THREE from 'three';
import PlayerCombatSoldier from './Environment/PlayerCombatSoldier';
import { makeFighter } from './Environment/DuelArena';
import type { FighterData } from './Environment/SquadArenaTypes';
import { DRONE_ID } from './Drone';
import SpeechBubble from './UI/SpeechBubble';
import RadarCameraBridge from './UI/RadarCameraBridge';
import Enemy from './Enemy';
import Pedestrian from './Environment/Pedestrian';
import WeaponEffects from './Environment/weapons/WeaponEffects';
import { emitShotFx, onLocalShotFx } from './Environment/weapons/weaponFx';
import { applyFighterHit, registerFighterDamageHandler, registerFighterHitHandler } from './Environment/weapons/shootableRegistry';
import { useStore } from '../store';
import { OutgoingState, useMannequinNetwork } from './multiplayer/useMannequinNetwork';
import NetworkMannequin, { REMOTE_BLOCK_ANIM } from './multiplayer/NetworkMannequin';
import { POSE_LEN, capturePose, poseBoneList } from './multiplayer/mannequinPose';
import type { MannequinExt, NetHit, NetShot, Vec3 } from './multiplayer/netTypes';
import { remoteDrivenCars, isRemoteDriven } from './multiplayer/remoteVehicles';
import { remoteGunFx } from './multiplayer/remoteRegistry';
import { cityOpponents, cityOpponentsVersion, addCityOpponent, removeCityOpponent } from './city/cityActors';
import { AIM_CHEST_Y, registerAimTargets } from '../lib/aimTargets';
import { getTerrainHeight } from './Environment/Terrain';
import { getRoadOffset } from './Environment/Road';

// "sostituire il personaggio boxman in playground con il nostro manichino":
// nel mondo aperto il giocatore e' lo stesso manichino del duello
// (PlayerCombatSoldier: animazioni, ragdoll, salto/parkour, armi, auto),
// con il tipo di controllo 'player' che il resto del playground conosce
// (Drone.tsx, pedoni, minimappa, camera).
//
// Multiplayer (multiplayer/): ogni giocatore manda la posa del suo
// scheletro + lo stato di gioco (vita, arma, auto, drone); gli altri sono
// manichini remoti con armi in mano, bersagli per spari e pugni. I colpi li
// decide chi colpisce, li applica il colpito (evento 'hit').
export const CITY_PLAYER_ID = 'player';
const SPAWN_X = 0;
const SPAWN_Z = 0;
const GLOBAL_SPEED = 1.0;
// vita che si recupera da sola (GTA V): dopo REGEN_DELAY_S senza colpi,
// REGEN_PER_S punti al secondo fino a REGEN_CAP della vita massima
const REGEN_DELAY_S = 5;
const REGEN_PER_S = 4;
const REGEN_CAP = 0.5;

const _wp = new THREE.Vector3();
const _wq = new THREE.Quaternion();
const _hitDir = new THREE.Vector3();
const _hitPt = new THREE.Vector3();
const v3 = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];

// fumetto della chat sopra il proprio manichino (lo faceva Player.tsx)
const OwnSpeechBubble: React.FC = () => {
  const message = useStore((s) => s.playerMessage);
  const ref = useRef<THREE.Group>(null);
  const { scene } = useThree();
  // il manichino si cerca nella scena solo se non lo si ha gia' (cercarlo
  // a ogni frame attraversava tutta la scena: ~1 ms)
  const targetRef = useRef<THREE.Object3D | null>(null);
  useFrame(() => {
    if (!message) return;
    let target = targetRef.current;
    if (!target || !target.parent) target = targetRef.current = scene.getObjectByName(CITY_PLAYER_ID) ?? null;
    if (target && ref.current) target.getWorldPosition(ref.current.position);
  });
  return (
    <group ref={ref}>
      <SpeechBubble message={message} position={[0, 2.3, 0]} />
    </group>
  );
};

// avversario "specchio" di un giocatore remoto (NetworkMannequin lo tiene
// aggiornato): il codice di combattimento del giocatore locale lo colpisce
// come un nemico qualsiasi, qui si legge cosa gli ha fatto
interface RemoteProxy {
  data: FighterData;
  // vita riportata dal remoto: base per capire quanto danno e' stato fatto
  baseHp: number;
  shot: NetHit['shot'];
  unregister: () => void;
}

const CityPlayer: React.FC<{ userName: string }> = ({ userName }) => {
  const data = useMemo(() => {
    const f = makeFighter(CITY_PLAYER_ID, 'Tu', 'PLAYER', SPAWN_X, SPAWN_Z, 0);
    // vita del mondo aperto = la barra della vita (store), non quella del duello
    f.hp = useStore.getState().maxHealth || 100;
    return f;
  }, []);
  const maxHp = useRef(data.hp);
  const { scene } = useThree();

  useEffect(() => {
    // questo effetto parte solo dopo che il modello (useGLTF, Suspense) e'
    // pronto: come faceva Player.tsx, toglie la schermata di caricamento
    const st = useStore.getState();
    st.setIsLoading(false);
    if (st.currentControllable === 'combatSoldier') st.setCurrentControllable('player');
    st.setHealth(data.hp);
  }, [data]);

  // --- colpi ricevuti -------------------------------------------------------
  const applyHit = (h: {
    damage: number;
    triggerHit: string | null;
    fromX: number;
    fromZ: number;
    knockdown: NetHit['knockdown'];
    shot: NetHit['shot'];
  }) => {
    if (data.isDead) return;
    // dentro un veicolo (o pilotando il drone) il manichino e' al riparo
    if (useStore.getState().currentControllable !== 'player') return;
    data.hp -= h.damage;
    if (data.hp <= 0) {
      data.hp = 0;
      data.isDead = true;
      data.attackLock = 0;
    } else {
      // proiettili: solo la spinta fisica sul corpo (applyFighterHit sotto),
      // niente "barcollo" che blocca le azioni -- sotto il fuoco si deve
      // poter continuare a sparare e a correre. I colpi corpo a corpo si'.
      if (h.triggerHit && !h.shot) {
        data.triggerHit = h.triggerHit;
        data.hitFromX = h.fromX;
        data.hitFromZ = h.fromZ;
        data.hitReactionHandled = !!h.shot;
      }
      if (h.knockdown) data.knockdown = h.knockdown;
    }
    if (h.shot) {
      _hitDir.set(h.shot.dir[0], h.shot.dir[1], h.shot.dir[2]);
      _hitPt.set(h.shot.point[0], h.shot.point[1], h.shot.point[2]);
      applyFighterHit(CITY_PLAYER_ID, h.shot.seg, _hitDir, h.shot.speed, _hitPt);
    }
  };
  const applyHitRef = useRef(applyHit);
  applyHitRef.current = applyHit;

  // proiettili dei nemici della citta' (Bullet.tsx -> damageFighter)
  useEffect(
    () =>
      registerFighterDamageHandler(CITY_PLAYER_ID, (hit) => {
        applyHitRef.current({
          damage: hit.damage,
          triggerHit: hit.segment === 'Head' ? 'Hit_Head' : 'Hit_Chest',
          fromX: hit.pointWorld.x - hit.dirWorld.x,
          fromZ: hit.pointWorld.z - hit.dirWorld.z,
          knockdown: null,
          shot: { seg: hit.segment, dir: v3(hit.dirWorld), speed: hit.speed, point: v3(hit.pointWorld) },
        });
      }),
    []
  );

  // --- avversari remoti (proxy) ---------------------------------------------
  const proxiesRef = useRef(new Map<string, RemoteProxy>());
  const duelEnemies = useStore((s) => s.duelArenaEnemies);
  const duelBagHurtbox = useStore((s) => s.duelBagHurtboxHandle);
  const duelBagSolid = useStore((s) => s.duelBagSolidHandle);
  const showCar = useStore((s) => s.arenaScene.car);

  const [oppVersion, setOppVersion] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      if (oppVersion !== cityOpponentsVersion) {
        setOppVersion(cityOpponentsVersion);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [oppVersion]);

  const opponents = useMemo(() => {
    return [...cityOpponents, ...duelEnemies];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oppVersion, duelEnemies]);

  // bersagli per l'aggancio della mira col pad (lib/aimTargets.ts): nemici,
  // passanti col corpo vero, avversari del duello
  const opponentsRef = useRef(opponents);
  opponentsRef.current = opponents;
  useEffect(
    () =>
      registerAimTargets((out) => {
        for (const o of opponentsRef.current) {
          if (o.isDead || o === data) continue;
          const p = o.position;
          out.push({ id: o.id, x: p.x, y: getTerrainHeight(p.x, p.z) + getRoadOffset(p.x, p.z) + Math.max(0, p.y) + AIM_CHEST_Y, z: p.z });
        }
      }),
    [data]
  );

  useEffect(() => {
    const st = useStore.getState();
    st.setDuelArenaPlayer(data);
    return () => {
      useStore.getState().setDuelArenaPlayer(null);
    };
  }, [data]);

  // veicoli guidabili: auto della citta', elicottero ed eventuali auto d'arena (store), non guidati da altri
  const cityCarIds = useMemo(
    () => () => {
      const out: string[] = [];
      if (showCar) out.push('duel-car');
      for (const [id, e] of useStore.getState().entities)
        if ((e.type === 'car' || e.type === 'helicopter') && !isRemoteDriven(id)) out.push(id);
      return out;
    },
    [showCar]
  );

  // --- rete -------------------------------------------------------------------
  const netRef = useRef<{ group: THREE.Object3D | null; bones: (THREE.Object3D | null)[]; buf: Int16Array; drone: THREE.Object3D | null }>({
    group: null,
    bones: [],
    buf: new Int16Array(POSE_LEN),
    drone: null,
  });
  const sample = (): OutgoingState | null => {
    const n = netRef.current;
    if (!n.group || !n.group.parent) {
      n.group = scene.getObjectByName(CITY_PLAYER_ID) ?? null;
      n.bones = n.group ? poseBoneList(n.group) : [];
    }
    if (!n.group || !n.bones[1]) return null;
    const st = useStore.getState();
    n.group.getWorldPosition(_wp);
    n.group.getWorldQuaternion(_wq);
    capturePose(n.bones, n.buf);
    const position = { x: _wp.x, y: _wp.y, z: _wp.z };
    const quaternion: [number, number, number, number] = [_wq.x, _wq.y, _wq.z, _wq.w];

    let veh: MannequinExt['veh'] = null;
    if (st.currentControllable === 'car' && st.controlledEntityId) {
      const car = scene.getObjectByName(st.controlledEntityId);
      if (car) {
        car.getWorldPosition(_wp);
        car.getWorldQuaternion(_wq);
        veh = { id: st.controlledEntityId, p: [_wp.x, _wp.y, _wp.z], q: [_wq.x, _wq.y, _wq.z, _wq.w] };
      }
    }
    // modello del drone (il gruppo scalato dentro Drone.tsx)
    if (!n.drone || !n.drone.parent) {
      n.drone = null;
      scene.getObjectByName(DRONE_ID)?.traverse((o) => {
        if (!n.drone && Math.abs(o.scale.x - 0.016) < 1e-4) n.drone = o;
      });
    }
    let drone: MannequinExt['drone'] = null;
    if (n.drone) {
      n.drone.getWorldPosition(_wp);
      n.drone.getWorldQuaternion(_wq);
      drone = { p: [_wp.x, _wp.y, _wp.z], q: [_wq.x, _wq.y, _wq.z, _wq.w], flying: st.isDrone };
    }

    return {
      position,
      quaternion,
      animation: data.currentAnim,
      model: 'mannequin',
      weapon: st.playerWeapon ?? 'fists',
      // copia: il buffer viene riusato al prossimo invio
      pose: n.buf.slice().buffer,
      ext: {
        hp: data.hp,
        maxHp: maxHp.current,
        dead: data.isDead,
        blocking: !!data.animCatalog && data.currentAnim === data.animCatalog.block,
        raise: st.playerAiming ? 1 : 0,
        reloading: !!st.pistolReloading,
        veh,
        drone,
      },
    };
  };

  const onShot = (s: NetShot) => {
    emitShotFx(
      {
        from: new THREE.Vector3(...s.a),
        to: new THREE.Vector3(...s.b),
        normal: s.n ? new THREE.Vector3(...s.n) : null,
        surface: s.surface,
        decal: s.decal,
      },
      true
    );
    if (s.from) remoteGunFx.get(s.from)?.shot(s.weapon);
  };
  const { remotesRef, ids, messages, sendChat, sendHit, sendShot } = useMannequinNetwork(userName, sample, {
    onHit: (h) => applyHitRef.current(h),
    onShot,
  });

  // i propri spari (tracciante, lampo) li vedono anche gli altri
  useEffect(
    () =>
      onLocalShotFx((fx) =>
        sendShot({
          weapon: useStore.getState().playerWeapon ?? 'pistol',
          a: v3(fx.from),
          b: v3(fx.to),
          n: fx.normal ? v3(fx.normal) : null,
          surface: fx.surface,
          decal: fx.decal,
        })
      ),
    [sendShot]
  );

  // chat: il messaggio scritto (ChatInput -> store) va anche agli altri
  const playerMessage = useStore((s) => s.playerMessage);
  useEffect(() => {
    if (playerMessage) sendChat(playerMessage);
  }, [playerMessage, sendChat]);

  // proxy per ogni giocatore remoto (entrano/escono)
  const proxyFor = (id: string): FighterData => {
    const map = proxiesRef.current;
    let p = map.get(id);
    if (!p) {
      const r = remotesRef.current.get(id);
      const d = makeFighter(id, r?.name ?? id, `REMOTE_${id}`, 0, 0, 0);
      d.hp = r?.ext?.hp ?? 100;
      d.animCatalog = { block: REMOTE_BLOCK_ANIM } as FighterData['animCatalog'];
      const proxy: RemoteProxy = { data: d, baseHp: d.hp, shot: null, unregister: () => {} };
      // colpo di pistola/fucile sul remoto: la spinta la applica lui
      proxy.unregister = registerFighterHitHandler(id, (seg, dir, speed, point) => {
        proxy.shot = { seg, dir: v3(dir), speed, point: v3(point) };
      });
      map.set(id, (p = proxy));
      addCityOpponent(d);
    }
    return p.data;
  };
  useEffect(() => {
    const map = proxiesRef.current;
    for (const [id, p] of Array.from(map.entries())) {
      if (ids.includes(id)) continue;
      p.unregister();
      map.delete(id);
      removeCityOpponent(p.data);
    }
  }, [ids, opponents]);
  useEffect(
    () => () => {
      for (const p of proxiesRef.current.values()) {
        p.unregister();
        removeCityOpponent(p.data);
      }
      proxiesRef.current.clear();
    },
    [opponents]
  );

  // --- ogni frame ------------------------------------------------------------
  const lastHpRef = useRef(data.hp);
  const regenRef = useRef({ lastHp: data.hp, quiet: 0, acc: 0 });
  useFrame((_state, delta) => {
    const st = useStore.getState();
    // "la vita si recupera se ferito come in GTA" (GTA V): dopo qualche
    // secondo senza colpi risale piano, ma solo fino a meta'; il resto lo
    // ridanno le cure (la frutta di Salvo, i collezionabili)
    {
      const rg = regenRef.current;
      const hp = Math.min(data.hp, st.health);
      if (hp < rg.lastHp || data.isDead) {
        rg.quiet = 0;
        rg.acc = 0;
      } else rg.quiet += delta;
      const cap = maxHp.current * REGEN_CAP;
      if (!data.isDead && hp > 0 && hp < cap && rg.quiet > REGEN_DELAY_S && !st.isPaused) {
        rg.acc += REGEN_PER_S * delta;
        if (rg.acc >= 1) {
          const add = Math.floor(rg.acc);
          rg.acc -= add;
          // a punti interi: la barra della vita non si ridisegna a ogni frame
          st.setHealth(Math.min(cap, Math.round(hp) + add));
        }
      }
      rg.lastHp = Math.min(data.hp, useStore.getState().health);
    }
    // vita <-> barra della vita: danni/cure da altre parti del gioco
    // (store.takeDamage, collezionabili) arrivano al manichino e viceversa
    if (st.health !== lastHpRef.current) {
      data.hp = Math.max(0, Math.min(maxHp.current, st.health));
      if (data.hp <= 0 && !data.isDead) {
        data.isDead = true;
        data.attackLock = 0;
      }
    } else if (data.hp !== lastHpRef.current) {
      st.setHealth(data.hp);
    }
    lastHpRef.current = data.hp;

    // colpi dati ai remoti -> rete
    for (const [id, p] of proxiesRef.current) {
      const d = p.data;
      const damage = p.baseHp - d.hp;
      if (damage > 0 || d.triggerHit || d.knockdown || p.shot) {
        sendHit({
          target: id,
          damage: Math.max(0, damage),
          triggerHit: d.triggerHit,
          fromX: d.hitFromX,
          fromZ: d.hitFromZ,
          knockdown: d.knockdown ?? null,
          shot: p.shot,
        });
      }
      d.triggerHit = null;
      d.knockdown = null;
      d.hitReactionHandled = false;
      p.shot = null;
      const r = remotesRef.current.get(id);
      p.baseHp = r?.ext?.hp ?? p.baseHp;
      d.hp = p.baseHp;
    }

    // auto guidate dagli altri: Car.tsx le fa seguire
    for (const r of remotesRef.current.values()) {
      const v = r.ext?.veh;
      if (v) remoteDrivenCars.set(v.id, { p: v.p, q: v.q, driver: r.id, at: r.at });
    }
    const now = performance.now();
    for (const [cid, c] of Array.from(remoteDrivenCars.entries())) if (now - c.at > 2000) remoteDrivenCars.delete(cid);
  });

  // DEV: nemici di prova a comando (i nemici della citta' sono spenti in
  // Scene.tsx): window.__cityDebug.spawnEnemy(x, z) / clearEnemies()
  const rapierCtx = useRapier();
  const [testEnemies, setTestEnemies] = useState<{ id: string; pos: [number, number, number]; hp?: number }[]>([]);
  const [testPeds, setTestPeds] = useState<{ id: string; x1: number; z1: number; x2: number; z2: number }[]>([]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let n = 0;
    (window as any).__cityDebug = {
      data,
      opponents,
      world: rapierCtx.world,
      rapier: rapierCtx.rapier,
      spawnEnemy: (x: number, z: number) => setTestEnemies((l) => [...l, { id: `test-enemy-${n++}`, pos: [x, 3, z] }]),
      clearEnemies: () => setTestEnemies([]),
      spawnPedestrian: (x1: number, z1: number, x2: number, z2: number) =>
        setTestPeds((l) => [...l, { id: `test-ped-${n++}`, x1, z1, x2, z2 }]),
      clearPedestrians: () => setTestPeds([]),
    };
    return () => {
      delete (window as any).__cityDebug;
    };
  }, [data, opponents, rapierCtx]);

  return (
    <>
      <PlayerCombatSoldier
        data={data}
        opponents={opponents}
        entityName={CITY_PLAYER_ID}
        globalSpeed={GLOBAL_SPEED}
        vehicleIds={cityCarIds}
        footControllable="player"
        droneId={DRONE_ID}
        bagHurtboxHandle={duelBagHurtbox}
        bagSolidHandle={duelBagSolid}
        publishPlayerInfo
      />
      <WeaponEffects />
      {testEnemies.map((e) => (
        <Enemy
          key={e.id}
          id={e.id}
          initialPosition={e.pos}
          initialHp={e.hp}
          onGiveUp={(gid) => setTestEnemies((l) => l.filter((x) => x.id !== gid))}
        />
      ))}
      {testPeds
        .filter((p) => !testEnemies.some((e) => e.id === p.id))
        .map((p) => (
          <Pedestrian
            key={p.id}
            id={p.id}
            x1={p.x1}
            z1={p.z1}
            x2={p.x2}
            z2={p.z2}
            onBecomeEnemy={(pid, pos, hp) => setTestEnemies((l) => (l.some((e) => e.id === pid) ? l : [...l, { id: pid, pos, hp }]))}
          />
        ))}
      <OwnSpeechBubble />
      <RadarCameraBridge />
      {ids.map((id) => (
        <NetworkMannequin key={id} id={id} remotesRef={remotesRef} proxy={proxyFor(id)} message={messages[id]} />
      ))}
    </>
  );
};

export default CityPlayer;
