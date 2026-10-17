import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGLTF } from '../../lib/gltf';
import { useStore } from '../../store';
import { getRoadOffset, ROAD_OFFSETS } from '../Environment/Road';
import { getTerrainHeight } from '../Environment/Terrain';
import { buildCarBatches } from '../Vehicles/FarCars';
import Car, { DEFAULT_CAR_SCALE, makeTrafficDriver, type TrafficDriver } from '../Vehicles/Car';
import TrafficMoto from '../Vehicles/TrafficMoto';
import { getPlanet, getPlanetStyle, onPlanetRebuild } from '../../lib/planet';
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

const carsForPlanet = () => Math.max(8, Math.round(30 * getPlanetStyle().traffic * (getPlanet().gridRadius / 2)));
let N_CARS = carsForPlanet(); // dal pianeta (lib/planet.ts)
// moto del traffico: stessa simulazione delle auto (corsie, semafori, code), disegnate da sole (TrafficMoto.tsx)
const N_MOTOS = 8;
// volanti della polizia: auto del traffico come le altre (corsie, semafori, code)
// finche' non c'e' un ricercato a 2+ stelle; allora riprende la guida l'IA
// d'inseguimento della Car (patrolRoute), poi tornano in corsia
export const POLICE_CAR_IDS = ['police-1', 'police-2', 'police-3', 'police-4', 'police-5'];
const policeDrivers = new Map<string, TrafficDriver>();
export const policeDriver = (id: string) => {
  let d = policeDrivers.get(id);
  if (!d) policeDrivers.set(id, (d = makeTrafficDriver()));
  return d;
};
const POOL = 8; // auto fisiche vere (veicoli a ruote con sospensioni, come quella del giocatore)
const PHYS_DIST = 42; // le auto entro questa distanza dal giocatore diventano fisiche
const PHYS_RELEASE_DIST = 58;
const RESPAWN_DIST = 190;
const G = 60; // distanza tra le strade
let LIM = ROAD_OFFSETS[ROAD_OFFSETS.length - 1];
onPlanetRebuild(() => {
  N_CARS = carsForPlanet();
  LIM = ROAD_OFFSETS[ROAD_OFFSETS.length - 1];
  policeDrivers.clear();
});
const LANE = 1.4;
// dal centro dell'incrocio: la linea di stop sta a 9.2 m (segnaletica a terra,
// streetPropsData.ts) e il centro dell'auto a mezza lunghezza prima
const STOP_DIST = 11.4;
const CAR_LEN = 4.3;
const S = DEFAULT_CAR_SCALE;
// centro del telaio sopra il suolo (come Car.tsx a riposo)
const RIDE_Y = 0.62;
// dove riposano le auto del pool quando non servono (fuori dalla griglia)
const parkPose = (k: number) => {
  const x = -150 + k * 12;
  const z = 270;
  return { x, z, y: getTerrainHeight(x, z) + getRoadOffset(x, z) + 1.6 };
};
const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

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
  phys: number; // indice dell'auto fisica del pool, -1 = solo simulata
  police: boolean;
  moto: boolean;
  driver: TrafficDriver | null; // auto fisica fissa (polizia)
  chasing: boolean;
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
    phys: -1,
    police: false,
    moto: false,
    driver: null,
    chasing: false,
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
  const drivers = useRef(Array.from({ length: POOL }, () => makeTrafficDriver()));
  const slotCar = useRef<(TCar | null)[]>(Array.from({ length: POOL }, () => null));
  // un'auto del pool presa dal giocatore resta sua: esce dal pool finche' non e' lontana
  const slotFree = useRef<boolean[]>(Array.from({ length: POOL }, () => true));
  const slotAcc = useRef(0);

  // l'auto fisica del pool torna a riposo (o resta ferma e libera il posto)
  const releaseSlot = (c: TCar, park: boolean) => {
    const k = c.phys;
    if (k < 0) return;
    const d = drivers.current[k];
    c.speed = Math.max(0, d.speed);
    d.active = false;
    d.throttle = 0;
    d.brake = 0;
    d.steer = 0;
    if (park) {
      const pk = parkPose(k);
      d.warp = { x: pk.x, y: pk.y, z: pk.z, yaw: 0, speed: 0 };
    }
    slotCar.current[k] = null;
    c.phys = -1;
  };

  // rimette sulla corsia piu' vicina una volante (finito l'inseguimento, o uscita di strada)
  const snapToLane = (c: TCar, d: TrafficDriver, forceWarp: boolean) => {
    const near = (v: number) => ROAD_OFFSETS.reduce((b, o) => (Math.abs(o - v) < Math.abs(b - v) ? o : b), ROAD_OFFSETS[0]);
    const l0 = near(d.z);
    const l1 = near(d.x);
    const lat0 = Math.abs(d.z - l0);
    const lat1 = Math.abs(d.x - l1);
    const sx = Math.sin(d.yaw);
    const sz = Math.cos(d.yaw);
    if (lat0 <= lat1) {
      c.axis = 0;
      c.line = l0;
      c.dir = sx >= 0 ? 1 : -1;
      c.s = Math.max(-LIM + 8, Math.min(LIM - 8, d.x));
    } else {
      c.axis = 1;
      c.line = l1;
      c.dir = sz >= 0 ? 1 : -1;
      c.s = Math.max(-LIM + 8, Math.min(LIM - 8, d.z));
    }
    c.state = 'road';
    c.turn = null;
    c.plan = null;
    c.speed = Math.max(0, d.speed);
    c.waitT = 0;
    c.stuckT = 0;
    place(c);
    const lat = c.axis === 0 ? Math.abs(d.z - c.z) : Math.abs(d.x - c.x);
    // fuori carreggiata o ribaltata: la si rimette in corsia
    if (forceWarp || lat > 3 || d.upY < 0.5) {
      d.warp = { x: c.x, y: getTerrainHeight(c.x, c.z) + getRoadOffset(c.x, c.z) + 1.2, z: c.z, yaw: c.yaw, speed: Math.min(c.speed, 4) };
    }
    d.active = true;
  };

  if (cars.current.length === 0) {
    for (let i = 0; i < N_CARS; i++) {
      const c = makeCar(i);
      respawn(c, cars.current, 0, 0, false);
      cars.current.push(c);
    }
    POLICE_CAR_IDS.forEach((pid, i) => {
      const c = makeCar(N_CARS + i);
      c.police = true;
      c.cruise = rnd(8, 10.5);
      c.driver = policeDriver(pid);
      respawn(c, cars.current, 0, 0, false);
      cars.current.push(c);
      const d = c.driver;
      d.warp = { x: c.x, y: getTerrainHeight(c.x, c.z) + getRoadOffset(c.x, c.z) + 1.2, z: c.z, yaw: c.yaw, speed: c.speed };
      d.x = c.x;
      d.z = c.z;
      d.yaw = c.yaw;
      d.active = true;
    });
    for (let i = 0; i < N_MOTOS; i++) {
      const c = makeCar(N_CARS + POLICE_CAR_IDS.length + i);
      c.moto = true;
      c.cruise = rnd(10, 14.5);
      respawn(c, cars.current, 0, 0, false);
      cars.current.push(c);
    }
  }

  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as any).__traffic = cars.current;
      (window as any).__trafficDrivers = drivers.current;
      (window as any).__policeDrivers = policeDrivers;
    }
  }, []);
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
      const d = c.driver ?? (c.phys >= 0 ? drivers.current[c.phys] : null);
      if (c.police && d) {
        const chasing = wanted.level >= 2;
        if (chasing) {
          // ricercato: guida l'IA d'inseguimento della Car (patrolRoute), non il traffico
          if (!c.chasing) {
            c.chasing = true;
            d.active = false;
          }
          c.x = d.x;
          c.z = d.z;
          c.yaw = d.yaw;
          c.speed = Math.max(0, d.speed);
          c.y = getTerrainHeight(c.x, c.z) + getRoadOffset(c.x, c.z) + RIDE_Y;
          continue;
        }
        if (c.chasing) {
          // finita la caccia: torna in corsia e nel traffico
          c.chasing = false;
          snapToLane(c, d, false);
        }
      }
      if (d) {
        // l'auto e' fisica: la posizione la dice il telaio
        c.x = d.x;
        c.z = d.z;
        c.yaw = d.yaw;
        c.speed = Math.max(0, d.speed);
        c.y = getTerrainHeight(c.x, c.z) + getRoadOffset(c.x, c.z) + RIDE_Y;
        if (c.state === 'road') {
          c.s = c.axis === 0 ? c.x : c.z;
          const lat = c.axis === 0 ? Math.abs(c.z - (c.line + LANE * c.dir)) : Math.abs(c.x - (c.line - LANE * c.dir));
          // fuori strada, ribaltata o sparata lontano: si toglie dal traffico
          if (lat > 5 || d.upY < 0.35) {
            if (c.police) {
              snapToLane(c, d, true);
              continue;
            }
            releaseSlot(c, true);
            respawn(c, list, pp[0], pp[2], true);
            continue;
          }
        }
      }
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
          // prima di una svolta si rallenta (a 9 m/s un'auto vera non gira)
          if (c.plan.turn && dc < 30) vTarget = Math.min(vTarget, 6.2 + Math.max(0, dc - 6) * 0.3);
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

      if (d) {
        // ---- guida: punto da raggiungere, sterzo, gas e freno ---------------
        const L = Math.max(5, Math.min(13, 4 + c.speed * 0.55));
        let tx: number;
        let tz: number;
        if (c.state === 'road') {
          if (c.axis === 0) {
            tx = c.s + c.dir * L;
            tz = c.line + LANE * c.dir;
          } else {
            tz = c.s + c.dir * L;
            tx = c.line - LANE * c.dir;
          }
        } else {
          const k = c.turn!;
          // a che punto della curva e' (il piu' vicino, sempre in avanti)
          let bestT = k.t;
          let bestD = Infinity;
          for (let i = 0; i <= 12; i++) {
            const u = Math.min(1, k.t + (i / 12) * 0.3);
            const bx = (1 - u) * (1 - u) * k.x0 + 2 * (1 - u) * u * k.x1 + u * u * k.x2;
            const bz = (1 - u) * (1 - u) * k.z0 + 2 * (1 - u) * u * k.z1 + u * u * k.z2;
            const dd = (bx - c.x) ** 2 + (bz - c.z) ** 2;
            if (dd < bestD) {
              bestD = dd;
              bestT = u;
            }
          }
          k.t = bestT;
          const u = Math.min(1, k.t + L / k.len);
          tx = (1 - u) * (1 - u) * k.x0 + 2 * (1 - u) * u * k.x1 + u * u * k.x2;
          tz = (1 - u) * (1 - u) * k.z0 + 2 * (1 - u) * u * k.z1 + u * u * k.z2;
          if (k.t >= 0.97) {
            c.axis = k.axis;
            c.line = k.line;
            c.dir = k.nd;
            c.s = k.axis === 0 ? c.x : c.z;
            c.state = 'road';
            c.turn = null;
            c.plan = null;
          }
        }
        const err = wrapA(Math.atan2(tx - c.x, tz - c.z) - c.yaw);
        d.steer = Math.max(-1, Math.min(1, err * 1.8));
        const e = vTarget - c.speed;
        d.throttle = e > 0.3 ? Math.max(0.2, Math.min(1, e * 0.5)) : 0;
        d.brake = vTarget < 0.2 && c.speed < 1.5 ? 1 : e < -0.8 ? Math.min(1, -e * 0.22) : 0;
        d.active = true;
        c.waitT = c.speed < 0.15 ? c.waitT + dt : Math.max(0, c.waitT - dt * 2);
        c.stuckT = c.speed < 0.15 ? c.stuckT + dt : 0;
      } else {
        // ---- auto solo simulata: si muove a conti ---------------------------
        if (vTarget < c.speed) c.speed = Math.max(vTarget, c.speed - 8 * dt);
        else c.speed = Math.min(vTarget, c.speed + 3.2 * dt);
        if (c.speed < 0.15) {
          c.stuckT += dt;
          c.waitT += dt;
        } else {
          c.stuckT = 0;
          c.waitT = Math.max(0, c.waitT - dt * 2);
        }
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
        c.y = getTerrainHeight(c.x, c.z) + getRoadOffset(c.x, c.z) + RIDE_Y;
      }

      // lontana dal giocatore o bloccata da un pezzo: torna in gioco altrove
      const far = Math.hypot(c.x - pp[0], c.z - pp[2]);
      if (c.police) {
        // le volanti pattugliano tutta la citta': solo se bloccate da troppo si rimettono su una strada
        if (c.stuckT > 28 && d) {
          respawn(c, list, 0, 0, false);
          d.warp = { x: c.x, y: getTerrainHeight(c.x, c.z) + getRoadOffset(c.x, c.z) + 1.2, z: c.z, yaw: c.yaw, speed: c.speed };
        }
      } else if (far > RESPAWN_DIST || c.stuckT > 28) {
        releaseSlot(c, true);
        respawn(c, list, pp[0], pp[2], true);
      }
    }

    // auto fisiche vere alle piu' vicine al giocatore
    slotAcc.current += dt;
    if (slotAcc.current > 0.25) {
      slotAcc.current = 0;
      // rilascio: lontane, o prese dal giocatore (restano sue)
      for (let k = 0; k < POOL; k++) {
        const cur = slotCar.current[k];
        const taken = st.currentControllable === 'car' && st.controlledEntityId === `traffic-${k}`;
        if (cur && taken) {
          slotFree.current[k] = false;
          drivers.current[k].active = false;
          slotCar.current[k] = null;
          cur.phys = -1;
          respawn(cur, list, pp[0], pp[2], true);
        } else if (cur && Math.hypot(cur.x - pp[0], cur.z - pp[2]) > PHYS_RELEASE_DIST) {
          releaseSlot(cur, true);
        }
        // l'auto presa e poi lasciata lontano torna al pool
        if (!slotFree.current[k] && !taken && !slotCar.current[k]) {
          const d = drivers.current[k];
          if (Math.hypot(d.x - pp[0], d.z - pp[2]) > 120) {
            slotFree.current[k] = true;
            const pk = parkPose(k);
            d.warp = { x: pk.x, y: pk.y, z: pk.z, yaw: 0, speed: 0 };
          }
        }
      }
      // assegnazione: le piu' vicine senza auto fisica
      const cand = list
        .filter((c) => c.phys < 0 && !c.police && !c.moto)
        .map((c) => ({ c, d: Math.hypot(c.x - pp[0], c.z - pp[2]) }))
        .filter((o) => o.d < PHYS_DIST)
        .sort((a, b) => a.d - b.d);
      for (const o of cand) {
        const k = slotCar.current.findIndex((x, i) => x === null && slotFree.current[i]);
        if (k < 0) break;
        const d = drivers.current[k];
        d.warp = { x: o.c.x, y: o.c.y + 0.35, z: o.c.z, yaw: o.c.yaw, speed: o.c.speed };
        d.x = o.c.x;
        d.z = o.c.z;
        d.yaw = o.c.yaw;
        d.speed = o.c.speed;
        d.upY = 1;
        d.throttle = 0;
        d.brake = 0;
        d.steer = 0;
        d.active = true;
        slotCar.current[k] = o.c;
        o.c.phys = k;
      }
    }

    // disegno: un'istanza per auto
    let n = 0;
    for (const c of list) {
      if (c.phys >= 0 || c.driver || c.moto) continue; // si disegna da se' (auto fisica, moto)
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

  return (
    <>
      {batches.map((b, i) => (
        <instancedMesh
          key={i}
          name="traffic-cars"
          ref={(m) => {
            meshes.current[i] = m;
          }}
          args={[b.geo, b.mat, N_CARS + POLICE_CAR_IDS.length]}
          castShadow
          receiveShadow
          frustumCulled={false}
        />
      ))}
      {/* le moto del traffico (la posizione la scrive la simulazione sopra) */}
      {cars.current.filter((c) => c.moto).map((c) => (
        <TrafficMoto key={c.id} car={c} />
      ))}
      {/* le auto fisiche vere del pool: ferme e nascoste a riposo, guidate dal traffico quando servono */}
      {Array.from({ length: POOL }, (_, k) => {
        const pk = parkPose(k);
        return <Car key={k} id={`traffic-${k}`} position={[pk.x, pk.y, pk.z]} driver={drivers.current[k]} />;
      })}
    </>
  );
};

export default Traffic;
