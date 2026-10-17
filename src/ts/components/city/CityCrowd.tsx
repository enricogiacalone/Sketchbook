import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { vehicleBodyHandles } from '../Vehicles/vehicleRegistry';
import { useStore } from '../../store';
import AllyNpc from './AllyNpc';
import type { Order } from './allyOrders';
import CrowdPedestrian from './CrowdPedestrian';
import CrowdInstances from './CrowdInstances';
import NpcInspector from '../UI/NpcInspector';
import { CITY_LAYOUT, getBuildingDetails } from '../Environment/City';
import { ROAD_OFFSETS, ROAD_WIDTH } from '../Environment/Road';
import { insideStatics, setCrowdStatics } from './crowdObstacles';
import { BANK, getStreetProps, HOSPITAL, POLICE_STATION } from '../Environment/streetPropsData';
import { onPlanetRebuild } from '../../lib/planet';
import { AIM_CHEST_Y, registerAimTargets } from '../../lib/aimTargets';
import {
  assignCrowdSlots,
  crowdAgents,
  CROWD_FULL_SLOTS,
  CROWD_MAX_SLOTS,
  setCrowdSlotCount,
  reviveCrowdAgent,
  stepCrowd,
  type CrowdAgent,
  type CrowdObstacle,
} from './crowdSim';

// La folla della citta': simulazione leggera di tutti gli agenti, pool di
// corpi veri per i vicini, sagome instanziate per gli altri. Un passante che
// si arrabbia resta nel suo corpo e passa al comportamento ostile
// (brains/hostile.ts, vedi CrowdPedestrian); se rinuncia o muore l'agente
// torna a camminare.

const ASSIGN_EVERY_S = 0.2;
// alleati reclutati in chat contemporaneamente
const MAX_ALLIES = 3;
// corpi veri aggiunti dal pannello: uno alla volta (crearne uno -- manichino,
// mixer, ragdoll -- costa qualche millisecondo), per non bloccare il gioco
const BODY_MOUNT_EVERY_S = 0.12;

// Muri dei palazzi (con zoccolo e annesso), pali di lampioni e semafori e
// colonnine delle pensiline: le forme fisse che la folla deve evitare.
function buildCrowdStatics() {
  const rects: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> = [];
  const circles: Array<{ x: number; z: number; r: number }> = [];
  const PLINTH = 0.15;
  CITY_LAYOUT.buildings.forEach((b, i) => {
    rects.push({ minX: b.x - b.w / 2 - PLINTH, maxX: b.x + b.w / 2 + PLINTH, minZ: b.z - b.d / 2 - PLINTH, maxZ: b.z + b.d / 2 + PLINTH });
    const det = getBuildingDetails(i);
    const an = det.annex;
    if (an) {
      const ax = b.x + an.ox;
      const az = b.z + an.oz;
      rects.push({ minX: ax - an.w / 2, maxX: ax + an.w / 2, minZ: az - an.d / 2, maxZ: az + an.d / 2 });
    }
    if (det.hasCanopy) {
      const off = Math.min(b.w * 0.5, 8) * 0.4;
      const pz = b.z - b.d / 2 - 1.1 + 0.9;
      circles.push({ x: b.x - off, z: pz, r: 0.08 }, { x: b.x + off, z: pz, r: 0.08 });
    }
  });
  // un palo per angolo di ogni incrocio (Road.tsx: lampioni e semafori)
  const c = ROAD_WIDTH / 2 + 1;
  for (const ox of ROAD_OFFSETS)
    for (const oz of ROAD_OFFSETS)
      for (const [sx, sz] of [
        [-1, -1],
        [1, 1],
        [-1, 1],
        [1, -1],
      ])
        circles.push({ x: ox + sx * c, z: oz + sz * c, r: 0.15 });
  // arredo urbano nuovo (alberi, chioschi, fermate...) e i due edifici di servizio
  const sp = getStreetProps();
  for (const r of sp.crowdRects) rects.push(r);
  for (const c of sp.crowdCircles) circles.push(c);
  for (const b of [HOSPITAL, POLICE_STATION, BANK]) rects.push({ minX: b.x - b.w / 2 - 0.2, maxX: b.x + b.w / 2 + 0.2, minZ: b.z - b.d / 2 - 0.2, maxZ: b.z + b.d / 2 + 0.2 });
  setCrowdStatics(rects, circles);
}

// auto: il collider cuboide piu' grande del telaio, cercato una volta
const carColliderOf = new Map<number, number>();
// (gli handle Rapier si riusano nel mondo nuovo)
onPlanetRebuild(() => carColliderOf.clear());

const Crowd: React.FC = () => {
  const [allies, setAllies] = useState<
    Array<{ id: string; agent: CrowdAgent; position: [number, number, number]; hp: number; order: Order }>
  >([]);
  const acc = useRef(ASSIGN_EVERY_S);
  // quanti corpi veri sono montati (verso store.crowdBodies, Debug > Citta')
  const bodiesWanted = useStore((s) => Math.max(0, Math.min(CROWD_MAX_SLOTS, Math.round(s.crowdBodies))));
  const [bodies, setBodies] = useState(() => Math.min(bodiesWanted, CROWD_FULL_SLOTS));
  const mountAcc = useRef(0);
  useEffect(() => {
    if (bodies > bodiesWanted) setBodies(bodiesWanted);
  }, [bodies, bodiesWanted]);
  useEffect(() => {
    setCrowdSlotCount(Math.min(bodies, bodiesWanted));
  }, [bodies, bodiesWanted]);
  const { world } = useRapier();
  const obstacles = useRef<CrowdObstacle[]>([]);

  // passanti disegnati come sagome: anche loro si agganciano con la mira
  // (quelli col corpo vero sono gia' tra gli avversari, CityPlayer.tsx)
  useEffect(
    () =>
      registerAimTargets((out) => {
        for (const a of crowdAgents) {
          if (a.gone || a.slot >= 0 || a.dist > 60) continue;
          out.push({ id: `crowd-agent-${a.id}`, x: a.x, y: a.y + AIM_CHEST_Y, z: a.z });
        }
      }),
    []
  );

  useEffect(() => {
    buildCrowdStatics();
    if (import.meta.env.DEV) {
      // per i test (spostare un'auto sul marciapiede, ...)
      (window as any).__crowdWorld = world;
      // stress test dei corpi veri (debug/stressBodies.ts): window.__stress.run()
      void import('../../debug/stressBodies').then((m) => m.setStressWorld(world));
      // quanti passanti (vicini) stanno dentro a un muro o a un palo adesso
      (window as any).__crowdInsideStatics = () =>
        crowdAgents.filter((a) => !a.gone && a.dist < 60 && insideStatics(a.x, a.z, 0.2)).map((a) => a.id);
    }
  }, [world]);

  useFrame((state, dt) => {
    if (bodies < bodiesWanted) {
      mountAcc.current += dt;
      if (mountAcc.current >= BODY_MOUNT_EVERY_S) {
        mountAcc.current = 0;
        setBodies((b) => Math.min(bodiesWanted, b + 1));
      }
    }
    const st = useStore.getState();
    // vicino a chi? al giocatore (anche in auto/drone: playerPos segue il
    // veicolo guidato) e alla telecamera, il piu' vicino dei due
    const pp = st.playerPos;
    const cam = state.camera.position;
    const camFar = Math.hypot(cam.x - pp[0], cam.z - pp[2]) > 40;
    // da evitare: il giocatore a piedi e le auto (quelle in movimento fanno aspettare)
    const obs = obstacles.current;
    obs.length = 0;
    if (st.currentControllable === 'player') obs.push({ x: pp[0], z: pp[2], r: 0.45, moving: false });
    for (const h of vehicleBodyHandles) {
      const b = world.getRigidBody(h);
      if (!b) continue;
      // lontano dal punto che seguiamo la folla non li evita (oltre AVOID_DIST):
      // inutile leggerne collider e rotazione
      const bt = b.translation();
      const bdx = bt.x - (camFar ? cam.x : pp[0]);
      const bdz = bt.z - (camFar ? cam.z : pp[2]);
      if (bdx * bdx + bdz * bdz > 80 * 80) continue;
      const v = b.linvel();
      const moving = v.x * v.x + v.z * v.z > 1;
      let ch = carColliderOf.get(h);
      if (ch === undefined) {
        let best = -1;
        let area = 0;
        for (let i = 0; i < b.numColliders(); i++) {
          const c = b.collider(i);
          const he = (c as any).halfExtents?.();
          if (he && he.x * he.z > area) {
            area = he.x * he.z;
            best = c.handle;
          }
        }
        carColliderOf.set(h, (ch = best));
      }
      const col = ch >= 0 ? world.getCollider(ch) : null;
      const he = col ? (col as any).halfExtents?.() : null;
      if (!col || !he) {
        const t = b.translation();
        obs.push({ x: t.x, z: t.z, r: 2.2, moving });
        continue;
      }
      const t = col.translation();
      const q = col.rotation();
      // assi locali X e Z del collider, proiettati a terra
      let ux = 1 - 2 * (q.y * q.y + q.z * q.z);
      let uz = 2 * (q.x * q.z - q.w * q.y);
      let vx = 2 * (q.x * q.z + q.w * q.y);
      let vz = 1 - 2 * (q.x * q.x + q.y * q.y);
      const lu = Math.hypot(ux, uz) || 1;
      const lv = Math.hypot(vx, vz) || 1;
      ux /= lu;
      uz /= lu;
      vx /= lv;
      vz /= lv;
      obs.push({ x: t.x, z: t.z, r: Math.hypot(he.x, he.z), moving, box: { ux, uz, vx, vz, hx: he.x, hz: he.z } });
    }
    const t0 = import.meta.env.DEV ? performance.now() : 0;
    stepCrowd(Math.min(dt, 0.1), camFar ? cam.x : pp[0], camFar ? cam.z : pp[2], obs);
    if (import.meta.env.DEV) {
      const w = window as any;
      w.__crowdMs = (w.__crowdMs ?? 0) * 0.95 + (performance.now() - t0) * 0.05;
    }
    acc.current += dt;
    if (acc.current >= ASSIGN_EVERY_S) {
      acc.current = 0;
      assignCrowdSlots();
    }
  });

  // l'agente torna a camminare nella folla (nemico che rinuncia, alleato congedato o morto)
  const returnToCrowd = useCallback((agent: CrowdAgent) => {
    reviveCrowdAgent(agent);
    if (!crowdAgents.includes(agent)) crowdAgents.push(agent);
  }, []);

  // reclutato in chat: esce dalla folla e diventa un alleato (al massimo MAX_ALLIES)
  const handleBecomeAlly = useCallback(
    (agent: CrowdAgent, position: [number, number, number], hp: number, order: Order) => {
      agent.gone = true;
      agent.slot = -1;
      const idx = crowdAgents.indexOf(agent);
      if (idx !== -1) crowdAgents.splice(idx, 1);
      setAllies((prev) => {
        if (prev.some((x) => x.agent === agent)) return prev;
        const next = [...prev, { id: `ally-${agent.id}`, agent, position, hp, order }];
        // il piu' vecchio se ne va, se sono troppi
        while (next.length > MAX_ALLIES) returnToCrowd(next.shift()!.agent);
        return next;
      });
    },
    [returnToCrowd]
  );
  const handleAllyGone = useCallback(
    (id: string) => {
      setAllies((prev) => {
        const x = prev.find((a) => a.id === id);
        if (x) returnToCrowd(x.agent);
        return prev.filter((a) => a.id !== id);
      });
    },
    [returnToCrowd]
  );
  if (import.meta.env.DEV) (window as any).__crowd = { agents: crowdAgents };

  return (
    <>
      <CrowdInstances />
      <NpcInspector />
      {Array.from({ length: Math.min(bodies, bodiesWanted) }, (_, s) => (
        <CrowdPedestrian key={s} slot={s} onBecomeAlly={handleBecomeAlly} />
      ))}
      {allies.map((a, i) => (
        <AllyNpc key={a.id} id={a.id} index={i} initialPosition={a.position} initialHp={a.hp} order={a.order} onGone={handleAllyGone} />
      ))}
    </>
  );
};

export default Crowd;
