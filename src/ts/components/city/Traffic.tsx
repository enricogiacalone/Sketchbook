import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RigidBody, interactionGroups, useBeforePhysicsStep, type RapierRigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { useGLTF } from '../../lib/gltf';
import { useStore } from '../../store';
import { getRoadOffset, ROAD_OFFSETS } from '../Environment/Road';
import { getTerrainHeight } from '../Environment/Terrain';
import { vehicleBodyHandles } from '../Vehicles/vehicleRegistry';
import { buildCarBatches } from '../Vehicles/FarCars';
import { DEFAULT_CAR_SCALE } from '../Vehicles/Car';
import { CollisionGroups } from '../../enums/CollisionGroups';
import { crowdAgents } from './crowdSim';
import { allyRegistry } from './npcCombat';
import { copRegistry, pickRoadSpawn, wanted } from '../../lib/wanted';
import { signalClock, signalFor } from '../../lib/traffic';

// Traffico civile: auto che girano per la griglia di strade, in corsia
// (guida a destra), che rispettano i semafori (lib/traffic.ts), si mettono in
// coda dietro a chi hanno davanti, si fermano per pedoni e giocatore, girano
// agli incroci e se sentono spari scappano. Non sono veicoli fisici completi
// (costerebbero come le volanti): la simulazione e' tutta a conti, disegnate
// in blocco (instanced) come le auto lontane, e solo le piu' vicine al
// giocatore ricevono un corpo cinematico (pool) per urtare, essere urtate e
// investire i pedoni.

const N_CARS = 30;
const POOL = 10; // corpi fisici
const PHYS_DIST = 48;
const RESPAWN_DIST = 190;
const G = 60; // distanza tra le strade
const LIM = ROAD_OFFSETS[ROAD_OFFSETS.length - 1];
const LANE = 1.4;
const STOP_DIST = 7.6; // dal centro dell'incrocio
const CAR_LEN = 4.3;
const S = DEFAULT_CAR_SCALE;
// centro del telaio sopra il suolo (come Car.tsx a riposo)
const RIDE_Y = 0.62;
const TRAFFIC_GROUPS = interactionGroups([CollisionGroups.TrimeshColliders], [CollisionGroups.Default]);
const PARK_X = 6000;

// come CHASSIS_SHAPES di Car.tsx
const SHAPES = [
  { dim: [1.2233487, 0.4973112, 2.4203892], pos: [0, 0.091266, 0.037997] },
  { dim: [1.083702, 0.5600574, 1.0714358], pos: [0, 0.61995, -0.255213] },
];

const TINTS = ['#ffffff', '#ffd6d6', '#d6e4ff', '#d9ffd6', '#fff2c2', '#e0d0ff', '#c9c9c9', '#ffb98a', '#9fb7d1', '#b5d6c0'];

interface TCar {
  id: number;
  axis: 0 | 1; // 0: lungo X, 1: lungo Z
  line: number; // coordinata della strada (z se axis 0, x se axis 1)
  dir: 1 | -1;
  s: number; // posizione lungo l'asse
  speed: number;
  cruise: number;
  state: 'road' | 'turn';
  plan: null | { turn: boolean; nd: 1 | -1 };
  turn: null | { x0: number; z0: number; x1: number; z1: number; x2: number; z2: number; t: number; len: number; axis: 0 | 1; line: number; nd: 1 | -1 };
  x: number;
  z: number;
  y: number;
  yaw: number;
  tint: number;
  slot: number;
  waitT: number;
  stuckT: number;
  panicUntil: number;
  progress: number; // s * dir, per ordinare le corsie
  vx: number;
  vz: number;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pickOffset = () => ROAD_OFFSETS[Math.floor(Math.random() * ROAD_OFFSETS.length)];

function place(c: TCar) {
  if (c.state === 'turn' && c.turn) {
    const k = c.turn;
    const u = k.t;
    const a = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const d = u * u;
    c.x = a * k.x0 + b * k.x1 + d * k.x2;
    c.z = a * k.z0 + b * k.z1 + d * k.z2;
    const tx = 2 * (1 - u) * (k.x1 - k.x0) + 2 * u * (k.x2 - k.x1);
    const tz = 2 * (1 - u) * (k.z1 - k.z0) + 2 * u * (k.z2 - k.z1);
    c.yaw = Math.atan2(tx, tz);
  } else if (c.axis === 0) {
    c.x = c.s;
    c.z = c.line + LANE * c.dir;
    c.yaw = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  } else {
    c.z = c.s;
    c.x = c.line - LANE * c.dir;
    c.yaw = c.dir > 0 ? 0 : Math.PI;
  }
}

function makeCar(id: number): TCar {
  const c: TCar = {
    id,
    axis: 0,
    line: 0,
    dir: 1,
    s: 0,
    speed: 0,
    cruise: rnd(8, 12.5),
    state: 'road',
    plan: null,
    turn: null,
    x: 0,
    z: 0,
    y: 0,
    yaw: 0,
    tint: id % TINTS.length,
    slot: -1,
    waitT: 0,
    stuckT: 0,
    panicUntil: 0,
    progress: 0,
    vx: 0,
    vz: 0,
  };
  return c;
}

function laneFree(cars: TCar[], me: TCar, axis: number, line: number, dir: number, s: number) {
  for (const o of cars) {
    if (o === me || o.state !== 'road' || o.axis !== axis || o.line !== line || o.dir !== dir) continue;
    if (Math.abs(o.s - s) < 14) return false;
  }
  return true;
}

// rimette l'auto su una strada: a caso nella citta', o in un anello attorno al giocatore (rinnovo)
function respawn(c: TCar, cars: TCar[], px: number, pz: number, ring: boolean) {
  for (let tries = 0; tries < 8; tries++) {
    let axis: 0 | 1;
    let line: number;
    let s: number;
    if (ring) {
      const sp = pickRoadSpawn(px, pz, rnd(85, 150));
      if (Math.abs(ROAD_OFFSETS.reduce((b, o) => Math.min(b, Math.abs(o - sp.x)), 1e9)) < 0.01) {
        axis = 1;
        line = ROAD_OFFSETS.reduce((b, o) => (Math.abs(o - sp.x) < Math.abs(b - sp.x) ? o : b), 0);
        s = sp.z;
      } else {
        axis = 0;
        line = ROAD_OFFSETS.reduce((b, o) => (Math.abs(o - sp.z) < Math.abs(b - sp.z) ? o : b), 0);
        s = sp.x;
      }
    } else {
      axis = Math.random() < 0.5 ? 0 : 1;
      line = pickOffset();
      s = rnd(-LIM + 10, LIM - 10);
    }
    s = Math.max(-LIM + 8, Math.min(LIM - 8, s));
    const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    // non dentro un incrocio, ne' addosso a un'altra
    const toC = Math.abs(s - Math.round(s / G) * G);
    if (toC < 10 || !laneFree(cars, c, axis, line, dir, s)) continue;
    c.axis = axis;
    c.line = line;
    c.dir = dir;
    c.s = s;
    c.state = 'road';
    c.turn = null;
    c.plan = null;
    c.speed = rnd(3, 6);
    c.cruise = rnd(8, 12.5);
    c.waitT = 0;
    c.stuckT = 0;
    c.panicUntil = 0;
    place(c);
    return;
  }
  // niente di libero: la lascio dov'e' ma ferma in coda (riprova al prossimo giro)
  c.stuckT = 0;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _sc = new THREE.Vector3(S, S, S);
const _up = new THREE.Vector3(0, 1, 0);
const _col = new THREE.Color();
const _hz: number[] = [];

const Traffic: React.FC = () => {
  const { scene } = useGLTF('car.glb');
  const batches = useMemo(() => buildCarBatches(scene), [scene]);
  const cars = useRef<TCar[]>([]);
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  const bodies = useRef<(RapierRigidBody | null)[]>([]);
  const slotCar = useRef<(TCar | null)[]>(Array.from({ length: POOL }, () => null));
  const slotAcc = useRef(0);

  if (cars.current.length === 0) {
    for (let i = 0; i < N_CARS; i++) {
      const c = makeCar(i);
      respawn(c, cars.current, 0, 0, false);
      cars.current.push(c);
    }
  }

  useEffect(() => {
    if (import.meta.env.DEV) (window as any).__traffic = cars.current;
  }, []);
  useEffect(
    () => () => {
      for (const b of bodies.current) if (b) vehicleBodyHandles.delete(b.handle);
    },
    []
  );

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const st = useStore.getState();
    if (st.isPaused) return;
    const pp = st.playerPos;
    const list = cars.current;
    const t = signalClock();
    const now = performance.now() / 1000;
    const startled = now - wanted.lastGunshotAt < 3;

    // pericoli: il giocatore, i passanti vicini, agenti e alleati
    _hz.length = 0;
    _hz.push(pp[0], pp[2], st.currentControllable === 'player' ? 0.7 : 2.2);
    for (const a of crowdAgents) if (!a.gone && a.dist < 45) _hz.push(a.x, a.z, 0.6);
    for (const c of copRegistry.values()) if (!c.car) _hz.push(c.x, c.z, 0.6);
    for (const a of allyRegistry.values()) _hz.push(a.data.position.x, a.data.position.z, 0.6);

    // corsie: ordine per progresso, per sapere chi sta davanti
    const lanes = new Map<number, TCar[]>();
    for (const c of list) {
      if (c.state !== 'road') continue;
      c.progress = c.s * c.dir;
      const key = (c.axis * 100 + (c.line + 300)) * 2 + (c.dir > 0 ? 1 : 0);
      let arr = lanes.get(key);
      if (!arr) lanes.set(key, (arr = []));
      arr.push(c);
    }
    for (const arr of lanes.values()) arr.sort((a, b) => a.progress - b.progress);

    for (const c of list) {
      const panic = now < c.panicUntil;
      if (startled && !panic && Math.hypot(c.x - pp[0], c.z - pp[2]) < 38) c.panicUntil = now + 6;
      let vTarget = panic ? c.cruise * 1.45 : c.cruise;
      const fx = Math.sin(c.yaw);
      const fz = Math.cos(c.yaw);

      // ostacoli davanti (persone, giocatore): corridoio stretto davanti al muso
      const look = 4 + c.speed * 1.2;
      for (let i = 0; i < _hz.length; i += 3) {
        const rx = _hz[i] - c.x;
        const rz = _hz[i + 1] - c.z;
        const along = rx * fx + rz * fz;
        if (along < 0.5 || along > look + 2) continue;
        const lat = Math.abs(rx * fz - rz * fx);
        if (lat < 1.45 + _hz[i + 2]) vTarget = Math.min(vTarget, Math.sqrt(2 * 6 * Math.max(0, along - 2.8)));
      }

      if (c.state === 'road') {
        const key = (c.axis * 100 + (c.line + 300)) * 2 + (c.dir > 0 ? 1 : 0);
        const arr = lanes.get(key)!;
        const idx = arr.indexOf(c);
        const leader = idx >= 0 && idx < arr.length - 1 ? arr[idx + 1] : null;
        if (leader) {
          const gap = leader.progress - c.progress - CAR_LEN;
          if (gap < 20) vTarget = Math.min(vTarget, gap <= 0.4 ? 0 : Math.min(leader.speed + gap * 0.7, Math.sqrt(2 * 5 * (gap - 0.4))));
        }

        // prossimo incrocio
        const cNext = c.dir > 0 ? Math.ceil((c.s + 1e-3) / G) * G : Math.floor((c.s - 1e-3) / G) * G;
        const hasX = Math.abs(cNext) <= LIM;
        const dc = hasX ? (c.dir > 0 ? cNext - c.s : c.s - cNext) : 999;
        if (hasX && dc < 40) {
          if (!c.plan) {
            const opts: Array<{ turn: boolean; nd: 1 | -1; w: number }> = [];
            if (Math.abs(cNext + c.dir * G) <= LIM) opts.push({ turn: false, nd: c.dir, w: 0.58 });
            // dopo la svolta si deve restare nella griglia
            const right: 1 | -1 = (c.axis === 0 ? c.dir : -c.dir) as 1 | -1;
            for (const nd of [right, -right] as Array<1 | -1>) {
              if (Math.abs(c.line + nd * G) <= LIM) opts.push({ turn: true, nd, w: nd === right ? 0.24 : 0.18 });
            }
            let r = Math.random() * opts.reduce((a, o) => a + o.w, 0);
            let ch = opts[0];
            for (const o of opts) {
              r -= o.w;
              if (r <= 0) {
                ch = o;
                break;
              }
            }
            c.plan = ch ? { turn: ch.turn, nd: ch.nd } : { turn: false, nd: c.dir };
          }
          // segnale e incrocio occupato da chi attraversa
          if (!panic && dc > STOP_DIST - 1.2) {
            const lt = signalFor(c.axis, t);
            const icx = c.axis === 0 ? cNext : c.line;
            const icz = c.axis === 0 ? c.line : cNext;
            let busy = false;
            for (const o of list) {
              if (o === c) continue;
              if (Math.abs(o.x - icx) < 6.2 && Math.abs(o.z - icz) < 6.2 && (o.state === 'turn' || o.axis !== c.axis)) {
                busy = true;
                break;
              }
            }
            const canStop = dc - STOP_DIST > (c.speed * c.speed) / (2 * 4.2);
            const mustStop = lt === 'red' || (lt === 'yellow' && canStop) || (busy && c.waitT < 12);
            if (mustStop) vTarget = Math.min(vTarget, Math.sqrt(2 * 3.2 * Math.max(0, dc - STOP_DIST + 0.4)));
          }
          // si inizia la svolta
          if (c.plan.turn && dc <= 5 && dc > 0) {
            const nd = c.plan.nd;
            const icx = c.axis === 0 ? cNext : c.line;
            const icz = c.axis === 0 ? c.line : cNext;
            let x1: number;
            let z1: number;
            let x2: number;
            let z2: number;
            if (c.axis === 0) {
              x1 = icx - LANE * nd;
              z1 = icz + LANE * c.dir;
              x2 = x1;
              z2 = icz + nd * 5;
            } else {
              x1 = icx - LANE * c.dir;
              z1 = icz + LANE * nd;
              x2 = icx + nd * 5;
              z2 = z1;
            }
            const len = (Math.hypot(x1 - c.x, z1 - c.z) + Math.hypot(x2 - x1, z2 - z1)) * 0.82;
            c.turn = { x0: c.x, z0: c.z, x1, z1, x2, z2, t: 0, len, axis: (1 - c.axis) as 0 | 1, line: c.axis === 0 ? icx : icz, nd };
            c.state = 'turn';
          }
        } else if (!hasX || dc >= 40) {
          if (dc > 60) c.plan = null;
        }
        // chi ha passato il centro dimentica il piano
        if (hasX && dc > G - 12) c.plan = null;
      } else if (c.turn) {
        vTarget = Math.min(vTarget, panic ? 8 : 6.2);
      }

      // velocita'
      if (vTarget < c.speed) c.speed = Math.max(vTarget, c.speed - 8 * dt);
      else c.speed = Math.min(vTarget, c.speed + 3.2 * dt);
      if (c.speed < 0.15) {
        c.stuckT += dt;
        c.waitT += dt;
      } else {
        c.stuckT = 0;
        c.waitT = Math.max(0, c.waitT - dt * 2);
      }

      const px0 = c.x;
      const pz0 = c.z;
      if (c.state === 'road') {
        c.s += c.dir * c.speed * dt;
      } else if (c.turn) {
        c.turn.t = Math.min(1, c.turn.t + (c.speed * dt) / c.turn.len);
        if (c.turn.t >= 1) {
          const k = c.turn;
          c.axis = k.axis;
          c.line = k.line;
          c.dir = k.nd;
          c.s = k.axis === 0 ? k.x2 : k.z2;
          c.state = 'road';
          c.turn = null;
          c.plan = null;
        }
      }
      place(c);
      if (dt > 0) {
        c.vx = (c.x - px0) / dt;
        c.vz = (c.z - pz0) / dt;
      }
      c.y = getTerrainHeight(c.x, c.z) + getRoadOffset(c.x, c.z) + RIDE_Y;

      // lontana dal giocatore o bloccata da un pezzo: torna in gioco altrove
      const far = Math.hypot(c.x - pp[0], c.z - pp[2]);
      if (far > RESPAWN_DIST || c.stuckT > 28) {
        respawn(c, list, pp[0], pp[2], true);
        c.slot = -1;
      }
    }

    // corpi fisici alle auto piu' vicine
    slotAcc.current += dt;
    if (slotAcc.current > 0.25) {
      slotAcc.current = 0;
      const cand = list
        .map((c) => ({ c, d: Math.hypot(c.x - pp[0], c.z - pp[2]) }))
        .filter((o) => o.d < PHYS_DIST)
        .sort((a, b) => a.d - b.d)
        .slice(0, POOL);
      const want = new Set(cand.map((o) => o.c));
      for (let i = 0; i < POOL; i++) {
        const cur = slotCar.current[i];
        if (cur && !want.has(cur)) {
          slotCar.current[i] = null;
          cur.slot = -1;
          const b = bodies.current[i];
          if (b) {
            vehicleBodyHandles.delete(b.handle);
            b.setTranslation({ x: PARK_X + i * 10, y: -50, z: 0 }, true);
            b.setLinvel({ x: 0, y: 0, z: 0 }, true);
          }
        }
      }
      for (const o of cand) {
        if (o.c.slot >= 0) continue;
        const free = slotCar.current.findIndex((x) => x === null);
        if (free < 0) break;
        slotCar.current[free] = o.c;
        o.c.slot = free;
        const b = bodies.current[free];
        if (b) {
          b.setTranslation({ x: o.c.x, y: o.c.y, z: o.c.z }, true);
          vehicleBodyHandles.add(b.handle);
        }
      }
    }

    // disegno: un'istanza per auto
    let n = 0;
    for (const c of list) {
      _q.setFromAxisAngle(_up, c.yaw);
      _p.set(c.x, c.y, c.z);
      _m.compose(_p, _q, _sc);
      for (let i = 0; i < batches.length; i++) {
        const m = meshes.current[i];
        if (!m) continue;
        m.setMatrixAt(n, _m);
        if (batches[i].mat.name === 'Car') m.setColorAt(n, _col.set(TINTS[c.tint]));
      }
      n++;
    }
    for (let i = 0; i < batches.length; i++) {
      const m = meshes.current[i];
      if (!m) continue;
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    void state;
  });

  // il corpo cinematico segue l'auto con la velocita' vera (spinge, investe)
  useBeforePhysicsStep((world) => {
    const dt = world.timestep || 1 / 60;
    for (let i = 0; i < POOL; i++) {
      const c = slotCar.current[i];
      const b = bodies.current[i];
      if (!c || !b) continue;
      const cur = b.translation();
      b.setLinvel({ x: (c.x - cur.x) / dt, y: (c.y - cur.y) / dt, z: (c.z - cur.z) / dt }, true);
      _q.setFromAxisAngle(_up, c.yaw);
      b.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    }
  });

  return (
    <>
      {batches.map((b, i) => (
        <instancedMesh
          key={i}
          name="traffic-cars"
          ref={(m) => {
            meshes.current[i] = m;
          }}
          args={[b.geo, b.mat, N_CARS]}
          castShadow
          receiveShadow
          frustumCulled={false}
        />
      ))}
      {Array.from({ length: POOL }, (_, i) => (
        <RigidBody
          key={i}
          ref={(r) => {
            bodies.current[i] = r;
          }}
          type="kinematicVelocity"
          colliders={false}
          position={[PARK_X + i * 10, -50, 0]}
          canSleep={false}
          collisionGroups={TRAFFIC_GROUPS}
        >
          {SHAPES.map((sh, k) => (
            <CuboidCollider
              key={k}
              args={[(sh.dim[0] / 2) * S, (sh.dim[1] / 2) * S, (sh.dim[2] / 2) * S]}
              position={[sh.pos[0] * S, sh.pos[1] * S, sh.pos[2] * S]}
              friction={0.1}
              restitution={0}
            />
          ))}
        </RigidBody>
      ))}
    </>
  );
};

export default Traffic;
