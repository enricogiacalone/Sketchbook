import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { vehicleBodyHandles } from '../Vehicles/vehicleRegistry';
import { useStore } from '../../store';
import Enemy from '../Enemy';
import CrowdPedestrian from './CrowdPedestrian';
import CrowdInstances from './CrowdInstances';
import NpcInspector from '../UI/NpcInspector';
import { CITY_LAYOUT, getBuildingDetails } from '../Environment/City';
import { ROAD_OFFSETS, ROAD_WIDTH } from '../Environment/Road';
import { insideStatics, setCrowdStatics } from './crowdObstacles';
import {
  assignCrowdSlots,
  crowdAgents,
  CROWD_FULL_SLOTS,
  reviveCrowdAgent,
  stepCrowd,
  type CrowdAgent,
  type CrowdObstacle,
} from './crowdSim';

// La folla della citta': simulazione leggera di tutti gli agenti, pool di
// corpi veri per i vicini, sagome instanziate per gli altri, e i passanti
// diventati nemici (Enemy.tsx al posto del passante finche' non rinuncia o
// muore, poi l'agente torna a camminare).

const ASSIGN_EVERY_S = 0.2;

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
  setCrowdStatics(rects, circles);
}

// auto: il collider cuboide piu' grande del telaio, cercato una volta
const carColliderOf = new Map<number, number>();

const Crowd: React.FC = () => {
  const [enemies, setEnemies] = useState<Array<{ id: string; agentId: number; position: [number, number, number]; hp?: number }>>([]);
  const acc = useRef(ASSIGN_EVERY_S);
  const { world } = useRapier();
  const obstacles = useRef<CrowdObstacle[]>([]);

  useEffect(() => {
    buildCrowdStatics();
    if (import.meta.env.DEV) {
      // per i test (spostare un'auto sul marciapiede, ...)
      (window as any).__crowdWorld = world;
      // quanti passanti (vicini) stanno dentro a un muro o a un palo adesso
      (window as any).__crowdInsideStatics = () =>
        crowdAgents.filter((a) => !a.gone && a.dist < 60 && insideStatics(a.x, a.z, 0.2)).map((a) => a.id);
    }
  }, [world]);

  useFrame((state, dt) => {
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

  const handleBecomeEnemy = useCallback((agent: CrowdAgent, position: [number, number, number], hp?: number) => {
    setEnemies((prev) =>
      prev.some((e) => e.agentId === agent.id) ? prev : [...prev, { id: `crowd-enemy-${agent.id}`, agentId: agent.id, position, hp }]
    );
  }, []);
  const handleEnemyGiveUp = useCallback((id: string) => {
    setEnemies((prev) => {
      const e = prev.find((x) => x.id === id);
      if (e) {
        const a = crowdAgents.find((x) => x.id === e.agentId);
        if (a) reviveCrowdAgent(a);
      }
      return prev.filter((x) => x.id !== id);
    });
  }, []);

  if (import.meta.env.DEV) (window as any).__crowd = { agents: crowdAgents, enemies };

  return (
    <>
      <CrowdInstances />
      <NpcInspector />
      {Array.from({ length: CROWD_FULL_SLOTS }, (_, s) => (
        <CrowdPedestrian key={s} slot={s} onBecomeEnemy={handleBecomeEnemy} />
      ))}
      {enemies.map((e) => (
        <Enemy key={e.id} id={e.id} initialPosition={e.position} initialHp={e.hp} onGiveUp={handleEnemyGiveUp} />
      ))}
    </>
  );
};

export default Crowd;
