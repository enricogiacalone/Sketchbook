import React, { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { CuboidCollider, Physics, RigidBody, useRapier } from '@react-three/rapier';
import * as THREE from 'three';
import { createGameRenderer } from '../lib/gameRenderer';
import { useStore } from '../store';
import { getTerrainHeight } from '../components/Environment/Terrain';
import { getRoadOffset } from '../components/Environment/Road';
import { cityOpponents } from '../components/city/cityActors';
import { allyRegistry } from '../components/city/npcCombat';
import CrowdPedestrian from '../components/city/CrowdPedestrian';
import {
  assignCrowdSlots,
  crowdAgents,
  crowdSlots,
  setCrowdSlotCount,
  spawnAnchoredAgent,
  stepCrowd,
  type CrowdAgent,
} from '../components/city/crowdSim';
import { markPlayerHit } from '../lib/wanted';
import { buildMaze, WALL_H, MAZE_CELL, DIRS, type Maze } from './maze';
import { Autopilot, type AutoStatus } from './autopilot';
import CityPlayer from '../components/CityPlayer';
import { playerAuto } from '../lib/playerAutopilot';
import { NavGrid, setNav } from '../lib/nav';
import Enemy from '../components/Enemy';
import Motorcycle from '../components/Vehicles/Motorcycle';
import Zombie, { type ZombieKind } from '../components/city/Zombie';
import PoliceOfficer from '../components/city/PoliceOfficer';
import AllyNpc from '../components/city/AllyNpc';

// Laboratorio personaggi (quarta voce del menu, o ?lab=char con il server di
// sviluppo): una piazza vuota, un "giocatore" da muovere con WASD e i
// personaggi della citta' da far comparire uno alla volta, senza traffico,
// folla, missioni, cielo o altro. Serve a provare il corpo comune
// (useMannequinActor) e i comportamenti sopra, e a vedere subito se qualcuno
// resta in posa a T. `window.__charLab` espone lo stato per i test automatici.

// una piazza piana gia' usata dalla folla (crowdScenes.PLAZA_EXERCISE)
const LAB_X = 150;
const LAB_Z = -90;
const groundY = () => getTerrainHeight(LAB_X, LAB_Z) + getRoadOffset(LAB_X, LAB_Z);

type Kind = 'moto' | 'pedestrian' | 'hunter-fists' | 'hunter-armed' | 'enemy' | 'enemy-fists' | 'police' | 'swat' | 'ally' | 'zombie-slow' | 'zombie-brisk' | 'zombie-runner';
interface Spawned {
  id: string;
  kind: Kind;
  x: number;
  z: number;
}

const KINDS: { kind: Kind; label: string }[] = [
  { kind: 'moto', label: 'Moto' },
  { kind: 'pedestrian', label: 'Passante (folla)' },
  { kind: 'hunter-fists', label: 'Cacciatore (pugni)' },
  { kind: 'hunter-armed', label: 'Cacciatore (pistola)' },
  { kind: 'enemy', label: 'Nemico (pistola)' },
  { kind: 'enemy-fists', label: 'Nemico (pugni)' },
  { kind: 'police', label: 'Poliziotto' },
  { kind: 'swat', label: 'SWAT' },
  { kind: 'ally', label: 'Alleato' },
  { kind: 'zombie-slow', label: 'Zombi lento' },
  { kind: 'zombie-brisk', label: 'Zombi svelto' },
  { kind: 'zombie-runner', label: 'Zombi corridore' },
];

// ---------------------------------------------------------------- giocatore
const keys = new Set<string>();
// Tasti a mano: se se ne preme uno, il pilota automatico lascia il giocatore a chi preme.
const MANUAL_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

// Il pilota automatico: ogni frame legge dove sta il giocatore VERO (CityPlayer, che gira da solo la
// sua locomozione, i suoi pugni, la sua fisica) e gli da' un comando al posto dei tasti.
interface PilotDriverProps {
  pilot: React.MutableRefObject<Autopilot | null>;
  pilotOn: React.MutableRefObject<boolean>;
}
const PilotDriver: React.FC<PilotDriverProps> = ({ pilot, pilotOn }) => {
  useEffect(() => {
    const down = (e: KeyboardEvent) => keys.add(e.code);
    const up = (e: KeyboardEvent) => keys.delete(e.code);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    // per le prove dalla console: window.__playerAuto.active/mx/mz/gait
    (window as any).__playerAuto = playerAuto;
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      playerAuto.active = false;
    };
  }, []);
  useFrame((_s, dt) => {
    const ap = pilot.current;
    const manual = MANUAL_KEYS.some((k) => keys.has(k));
    if (!ap || !pilotOn.current || manual) {
      playerAuto.active = false;
      return;
    }
    const st = useStore.getState();
    const cmd = ap.step(dt, st.playerPos[0], st.playerPos[2], st.health, cityOpponents);
    playerAuto.active = ap.mode !== 'uscito' && ap.mode !== 'sconfitto';
    playerAuto.mx = cmd.x;
    playerAuto.mz = cmd.z;
    playerAuto.gait = cmd.gait;
    playerAuto.lockOn = cmd.lockOn;
    if (cmd.attack) playerAuto.attack = true;
    // riprende fiato quando e' al sicuro (la rigenerazione del gioco si ferma a meta' vita)
    if (ap.calm && st.health > 0 && st.health < 100) useStore.setState({ health: Math.min(100, st.health + 3 * dt) });
  });
  return null;
};

// Prima persona: true mentre la telecamera e' dentro a un personaggio (la telecamera che segue sta ferma)
const fpState = { active: false };

// La telecamera segue il giocatore tenendo la distanza e l'angolo che si e' scelti. Mentre segue il busto del
// giocatore non e' piu' allacciato alla telecamera (PlayerCombatSoldier: playerAuto.freeTorso).
const FollowCam: React.FC<{ on: boolean }> = ({ on }) => {
  const controls = useThree((st) => st.controls) as any;
  const camera = useThree((st) => st.camera);
  const last = useRef<THREE.Vector3 | null>(null);
  useEffect(() => {
    playerAuto.freeTorso = on;
    return () => {
      playerAuto.freeTorso = false;
    };
  }, [on]);
  useFrame(() => {
    if (!controls) return;
    if (fpState.active) {
      last.current = null;
      return;
    }
    const p = useStore.getState().playerPos;
    const target = new THREE.Vector3(p[0], p[1], p[2]);
    if (on && last.current) {
      const d = target.clone().sub(last.current);
      camera.position.add(d);
      controls.target.add(d);
    }
    last.current = target;
  });
  return null;
};

// Clic su un cacciatore o sul giocatore: la telecamera entra nella sua testa (prima persona). Esc, o un clic
// nel vuoto, per tornare. Si distingue il clic dal trascinamento dell'orbita.
const FirstPersonPick: React.FC<{ onChange: (name: string | null) => void }> = ({ onChange }) => {
  const { gl, camera, scene } = useThree();
  const controls = useThree((st) => st.controls) as any;
  const sel = useRef<{ kind: 'player' } | { kind: 'fighter'; id: string } | null>(null);
  const saved = useRef<{ pos: THREE.Vector3; target: THREE.Vector3; near: number; fov: number } | null>(null);
  const hiddenHead = useRef<THREE.Object3D | null>(null);
  const yawRef = useRef(0);
  const tmp = useRef({ p: new THREE.Vector3(), f: new THREE.Vector3(), look: new THREE.Vector3() });

  // la testa (osso 'head') del manichino piu' vicino a (x, z)
  const headNear = (x: number, z: number): THREE.Object3D | null => {
    let best: THREE.Object3D | null = null;
    let bd = 1.5;
    scene.traverse((o: any) => {
      if (!o.isSkinnedMesh || !o.skeleton) return;
      let n: THREE.Object3D | null = o;
      for (; n; n = n.parent) if (!n.visible) return;
      const head = o.skeleton.bones.find((b: THREE.Bone) => b.name === 'head');
      const hips = o.skeleton.bones[0];
      if (!head || !hips) return;
      hips.getWorldPosition(tmp.current.p);
      const d = Math.hypot(tmp.current.p.x - x, tmp.current.p.z - z);
      if (d < bd) {
        bd = d;
        best = head;
      }
    });
    return best;
  };

  const exit = () => {
    if (!sel.current) return;
    sel.current = null;
    fpState.active = false;
    if (hiddenHead.current) hiddenHead.current.scale.setScalar(1);
    hiddenHead.current = null;
    const s0 = saved.current;
    if (s0) {
      camera.position.copy(s0.pos);
      (camera as THREE.PerspectiveCamera).near = s0.near;
      (camera as THREE.PerspectiveCamera).fov = s0.fov;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
      if (controls) {
        controls.target.copy(s0.target);
        controls.enabled = true;
        controls.update();
      }
    }
    onChange(null);
  };

  useEffect(() => {
    const el = gl.domElement;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const r = el.getBoundingClientRect();
      const rc = new THREE.Raycaster();
      rc.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = rc.intersectObjects(scene.children, true).find((h: any) => h.object.isSkinnedMesh);
      if (!hit) {
        exit();
        return;
      }
      // chi e': il giocatore o il cacciatore piu' vicino al punto colpito
      const pp = useStore.getState().playerPos;
      let pick: typeof sel.current = null;
      let bd = 1.5;
      const dp = Math.hypot(pp[0] - hit.point.x, pp[2] - hit.point.z);
      if (dp < bd) {
        bd = dp;
        pick = { kind: 'player' };
      }
      for (const o of cityOpponents) {
        if (o.isDead || !o.id.startsWith('lab-')) continue;
        const d = Math.hypot(o.position.x - hit.point.x, o.position.z - hit.point.z);
        if (d < bd) {
          bd = d;
          pick = { kind: 'fighter', id: o.id };
        }
      }
      if (!pick) return;
      if (!sel.current) {
        saved.current = {
          pos: camera.position.clone(),
          target: controls ? controls.target.clone() : new THREE.Vector3(),
          near: (camera as THREE.PerspectiveCamera).near,
          fov: (camera as THREE.PerspectiveCamera).fov,
        };
      }
      if (hiddenHead.current) hiddenHead.current.scale.setScalar(1);
      hiddenHead.current = null;
      sel.current = pick;
      fpState.active = true;
      if (controls) controls.enabled = false;
      (camera as THREE.PerspectiveCamera).near = 0.05;
      (camera as THREE.PerspectiveCamera).fov = 75;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
      yawRef.current = NaN;
      onChange(pick.kind === 'player' ? 'giocatore' : pick.id.replace('lab-', ''));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') exit();
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      exit();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera, scene, controls]);

  useFrame((_s, dt) => {
    const cur = sel.current;
    if (!cur) return;
    const t = tmp.current;
    let x: number;
    let z: number;
    let yaw: number;
    if (cur.kind === 'player') {
      const st = useStore.getState();
      x = st.playerPos[0];
      z = st.playerPos[2];
      yaw = st.playerYaw; // direzione di +Z avanti
    } else {
      const o = cityOpponents.find((q) => q.id === cur.id);
      if (!o || o.isDead) {
        exit();
        return;
      }
      x = o.position.x;
      z = o.position.z;
      yaw = o.rotation + Math.PI;
    }
    const head = headNear(x, z);
    if (!head) return;
    // la testa sparisce (scala quasi zero) cosi' non si vede dall'interno
    if (hiddenHead.current !== head) {
      if (hiddenHead.current) hiddenHead.current.scale.setScalar(1);
      hiddenHead.current = head;
    }
    head.scale.setScalar(0.001);
    // sguardo: segue dove guarda il corpo, ammorbidito
    if (Number.isNaN(yawRef.current)) yawRef.current = yaw;
    let dy = yaw - yawRef.current;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    yawRef.current += dy * Math.min(1, dt * 10);
    head.getWorldPosition(t.p);
    t.f.set(Math.sin(yawRef.current), 0, Math.cos(yawRef.current));
    camera.position.set(t.p.x + t.f.x * 0.12, t.p.y + 0.04, t.p.z + t.f.z * 0.12);
    t.look.set(camera.position.x + t.f.x, camera.position.y - 0.05, camera.position.z + t.f.z);
    camera.lookAt(t.look);
  });
  return null;
};

// il faro dell'uscita: una colonna verde fuori dal varco
const ExitBeacon: React.FC<{ maze: Maze; gy: number }> = ({ maze, gy }) => (
  <group position={[LAB_X + maze.exit.x, gy, LAB_Z + maze.exit.z]}>
    <mesh position={[0, 2.5, 0]}>
      <cylinderGeometry args={[0.35, 0.35, 5, 16]} />
      <meshBasicMaterial color="#22c55e" />
    </mesh>
    <pointLight position={[0, 3, 0]} intensity={30} distance={14} color="#22c55e" />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
      <circleGeometry args={[MAZE_CELL * 0.45, 24]} />
      <meshBasicMaterial color="#16a34a" />
    </mesh>
  </group>
);

// Pavimento a quadretti (1 m per quadretto): un riferimento visivo per distanze e velocita'
const CheckerFloor: React.FC<{ y: number }> = ({ y }) => {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) {
        g.fillStyle = (i + j) % 2 ? '#2b303b' : '#4a5263';
        g.fillRect(i * 128, j * 128, 128, 128);
      }
    // un filo piu' chiaro sui bordi dei quadretti
    g.strokeStyle = '#6b7488';
    g.lineWidth = 2;
    g.strokeRect(0, 0, 256, 256);
    g.strokeRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(60, 60); // 120 m / 2 m per tessera (2x2 quadretti)
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[LAB_X, y, LAB_Z]} receiveShadow>
      <planeGeometry args={[120, 120]} />
      <meshStandardMaterial map={tex} roughness={1} />
    </mesh>
  );
};

// il mondo fisico, per i test dalla console (window.__labWorld)
const WorldHandle: React.FC = () => {
  const { world } = useRapier();
  useEffect(() => {
    (window as any).__labWorld = world;
    return () => {
      delete (window as any).__labWorld;
    };
  }, [world]);
  return null;
};

// ---------------------------------------------------------------- sonda
// Ogni mezzo secondo guarda tutti i personaggi della scena: posa a T (mani
// alla stessa altezza delle spalle, larghe) e clip in corso.
interface ProbeRow {
  name: string;
  clip: string;
  hp: number;
  tpose: boolean;
  x: number;
  z: number;
}
const Probe: React.FC<{ onRows: (r: ProbeRow[]) => void }> = ({ onRows }) => {
  const { scene } = useThree();
  const acc = useRef(0);
  const v1 = useRef(new THREE.Vector3());
  const v2 = useRef(new THREE.Vector3());
  useFrame((_s, dt) => {
    acc.current += dt;
    if (acc.current < 0.5) return;
    acc.current = 0;
    const rows: ProbeRow[] = [];
    const byId = new Map([...cityOpponents, ...[...allyRegistry.values()].map((a) => a.data)].map((o) => [o.id, o]));
    const shown = (o: THREE.Object3D) => {
      for (let n: THREE.Object3D | null = o; n; n = n.parent) if (!n.visible) return false;
      return true;
    };
    scene.traverse((o: any) => {
      if (!o.isSkinnedMesh || !o.skeleton || !shown(o)) return;
      const bone = (n: string) => o.skeleton.bones.find((b: THREE.Bone) => b.name === n);
      const ual = bone('upperarm_l');
      const hl = bone('hand_l');
      const uar = bone('upperarm_r');
      const hr = bone('hand_r');
      if (!ual || !hl || !uar || !hr) return;
      const arm = (u: THREE.Bone, h: THREE.Bone) => {
        u.getWorldPosition(v1.current);
        h.getWorldPosition(v2.current);
        return { dy: Math.abs(v2.current.y - v1.current.y), dxz: Math.hypot(v2.current.x - v1.current.x, v2.current.z - v1.current.z) };
      };
      const a = arm(ual, hl);
      const b = arm(uar, hr);
      // posa a T: braccia aperte ai lati, mani larghe tra loro e all'altezza delle spalle
      // (mirare in avanti ha le mani vicine; "braccia in alto" ha le mani sopra le spalle)
      hl.getWorldPosition(v1.current);
      hr.getWorldPosition(v2.current);
      const handsApart = v1.current.distanceTo(v2.current);
      const tpose = a.dy < 0.15 && b.dy < 0.15 && a.dxz > 0.45 && b.dxz > 0.45 && handsApart > 1.1;
      let group: THREE.Object3D | null = o;
      let who: any = null;
      while (group && !who) {
        who = (group.userData as any).labId ? group : null;
        group = group.parent;
      }
      const hips = o.skeleton.bones[0] as THREE.Object3D;
      hips.getWorldPosition(v1.current);
      let best: any = null;
      let bd = 1e9;
      for (const f of byId.values()) {
        const d = Math.hypot(f.position.x - v1.current.x, f.position.z - v1.current.z);
        if (d < bd) {
          bd = d;
          best = f;
        }
      }
      rows.push({
        name: best && bd < 1.5 ? `${best.name} ${best.id}` : 'senza dati',
        clip: best && bd < 1.5 ? best.currentAnim ?? '-' : '-',
        hp: best && bd < 1.5 ? Math.round(best.hp) : 0,
        tpose,
        x: Math.round(v1.current.x),
        z: Math.round(v1.current.z),
      });
    });
    onRows(rows);
  });
  return null;
};

// ---------------------------------------------------------------- folla
// Pochi passanti con il corpo vero, presi dalla folla della citta' (la stessa
// simulazione e gli stessi corpi a pool): gli agenti di partenza si tolgono e
// al loro posto ci sono solo quelli che si fanno comparire; all'uscita si
// rimettono. Gli agenti sono "ancorati" (fermi, come quelli seduti o in piazza).
const LAB_SLOTS = 6;
const SPAWN_GAP_S = 1.2;
const LabCrowd: React.FC<{ agentsRef: React.MutableRefObject<CrowdAgent[]> }> = ({ agentsRef }) => {
  const acc = useRef(0);
  useEffect(() => {
    const saved = crowdAgents.splice(0, crowdAgents.length);
    for (const s of crowdSlots.keys()) crowdSlots[s] = null;
    setCrowdSlotCount(LAB_SLOTS);
    return () => {
      crowdAgents.splice(0, crowdAgents.length, ...saved);
      for (const s of crowdSlots.keys()) crowdSlots[s] = null;
    };
  }, []);
  useFrame((_s, dt) => {
    const pp = useStore.getState().playerPos;
    stepCrowd(Math.min(dt, 0.1), pp[0], pp[2], []);
    acc.current += dt;
    if (acc.current >= 0.2) {
      acc.current = 0;
      assignCrowdSlots();
    }
    agentsRef.current = crowdAgents.slice();
  });
  return (
    <>
      {Array.from({ length: LAB_SLOTS }, (_, s) => (
        <CrowdPedestrian key={s} slot={s} onBecomeAlly={() => {}} />
      ))}
    </>
  );
};

// ---------------------------------------------------------------- labirinto
const MazeWalls: React.FC<{ maze: ReturnType<typeof buildMaze>; gy: number }> = ({ maze, gy }) => {
  const inst = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = inst.current;
    if (!m) return;
    const o = new THREE.Object3D();
    maze.walls.forEach((w, i) => {
      o.position.set(LAB_X + w.x, gy + WALL_H / 2, LAB_Z + w.z);
      o.scale.set(w.w, WALL_H, w.d);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [maze, gy]);
  return (
    <>
      <instancedMesh ref={inst} args={[undefined, undefined, maze.walls.length]} castShadow receiveShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#8b93a1" />
      </instancedMesh>
      {/* un solo corpo fisso con un collider per muro */}
      <RigidBody type="fixed" colliders={false}>
        {maze.walls.map((w, i) => (
          <CuboidCollider key={i} args={[w.w / 2, WALL_H / 2, w.d / 2]} position={[LAB_X + w.x, gy + WALL_H / 2, LAB_Z + w.z]} friction={0} />
        ))}
      </RigidBody>
      {/* la piazza al centro, di un colore diverso */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[LAB_X, gy + 0.02, LAB_Z]} receiveShadow>
        <planeGeometry args={[maze.plazaHalf * 2, maze.plazaHalf * 2]} />
        <meshStandardMaterial color="#6b7a63" />
      </mesh>
    </>
  );
};

// ---------------------------------------------------------------- scena
let counter = 0;
const CharLab: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const [list, setList] = useState<Spawned[]>([]);
  const [rows, setRows] = useState<ProbeRow[]>([]);
  const rowsRef = useRef<ProbeRow[]>([]);
  rowsRef.current = rows;
  const agentsRef = useRef<CrowdAgent[]>([]);
  const listRef = useRef<Spawned[]>([]);
  listRef.current = list;

  // il giocatore vero nasce nella piazza (CityPlayer legge spawnPoint = [x, z, orientamento, quota piedi])
  const putPlayerAtStart = useCallback(() => {
    useStore.setState({
      health: 100,
      playerPos: [LAB_X, groundY() + 0.5, LAB_Z],
      spawnPoint: [LAB_X, LAB_Z, Math.PI, groundY()],
      currentControllable: 'player',
    });
  }, []);
  useState(() => {
    putPlayerAtStart();
    return 0;
  });

  // Il mondo del laboratorio (labirinto + griglie di navigazione) e' uno stato, non un useMemo: React puo'
  // dimenticare i valori memorizzati e rifarli (e col labirinto si perderebbe tutto cio' che il pilota ha esplorato).
  const makeWorld = (seed: number, mazeOn: boolean) => {
    const maze = buildMaze(seed);
    const m = maze.half + 8;
    // senza labirinto la griglia di navigazione e' vuota (e i muri non ci sono)
    const wallRects = mazeOn ? maze.walls.map((w) => ({ x: LAB_X + w.x, z: LAB_Z + w.z, w: w.w, d: w.d })) : [];
    // il tappo: sul muro esterno, largo come il varco (i cacciatori non devono lasciare il labirinto;
    // il giocatore invece l'uscita la attraversa: la sua griglia non ha il tappo)
    const [dx, dz] = DIRS[maze.exit.dir];
    const plug = {
      x: LAB_X + maze.exit.x - dx * MAZE_CELL * 1.5,
      z: LAB_Z + maze.exit.z - dz * MAZE_CELL * 1.5,
      w: dx ? 1 : MAZE_CELL + 1,
      d: dz ? 1 : MAZE_CELL + 1,
    };
    // fuori dal labirinto, per i cacciatori, non esiste: quattro fasce che coprono tutto il margine della griglia
    const h = maze.half;
    const band = (cx: number, cz: number, w: number, d: number) => ({ x: LAB_X + cx, z: LAB_Z + cz, w, d });
    const outside = [
      band(h + 4, 0, 8, 2 * m + 2),
      band(-h - 4, 0, 8, 2 * m + 2),
      band(0, h + 4, 2 * m + 2, 8),
      band(0, -h - 4, 2 * m + 2, 8),
    ];
    return {
      seed,
      mazeOn,
      maze,
      nav: new NavGrid(LAB_X - m, LAB_Z - m, LAB_X + m, LAB_Z + m, 0.5, wallRects, 0.6),
      huntNav: new NavGrid(LAB_X - m, LAB_Z - m, LAB_X + m, LAB_Z + m, 0.5, [...wallRects, plug, ...outside], 0.6),
    };
  };
  // di partenza senza labirinto (spazio libero per fare un giro); il pulsante lo rimette
  const [world, setWorld] = useState(() => makeWorld(7, false));
  const { maze, nav, huntNav } = world;
  useEffect(() => {
    setNav(huntNav);
    return () => setNav(null);
  }, [huntNav]);
  // pilota automatico del giocatore: acceso all'inizio, i tasti lo scavalcano
  const pilot = useRef<Autopilot | null>(null);
  const pilotOn = useRef(false);
  const [pilotOnState, setPilotOnState] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [follow, setFollow] = useState(true);
  const [fpName, setFpName] = useState<string | null>(null);
  const [pilotStatus, setPilotStatus] = useState<AutoStatus | null>(null);
  // un pilota nuovo a ogni ricomincia / nuovo labirinto (non prima: i valori memorizzati non sono una garanzia)
  const lastPilotFor = useRef<{ nav: NavGrid; key: number } | null>(null);
  if (!pilot.current || !lastPilotFor.current || lastPilotFor.current.nav !== nav || lastPilotFor.current.key !== resetKey) {
    pilot.current = new Autopilot(maze, nav, LAB_X, LAB_Z);
    lastPilotFor.current = { nav, key: resetKey };
  }
  useEffect(() => {
    const t = window.setInterval(() => setPilotStatus(pilot.current?.status() ?? null), 300);
    return () => window.clearInterval(t);
  }, []);
  const restart = useCallback(() => {
    setList([]);
    crowdAgents.splice(0, crowdAgents.length);
    for (const s of crowdSlots.keys()) crowdSlots[s] = null;
    putPlayerAtStart();
    setResetKey((k) => k + 1);
  }, [putPlayerAtStart]);
  const newMaze = useCallback(() => {
    setWorld((w) => makeWorld(w.seed + 1, w.mazeOn));
    setResetKey((k) => k + 1);
    setList([]);
    crowdAgents.splice(0, crowdAgents.length);
    for (const s of crowdSlots.keys()) crowdSlots[s] = null;
    putPlayerAtStart();
  }, [putPlayerAtStart]);
  const toggleMaze = useCallback(() => {
    setWorld((w) => makeWorld(w.seed, !w.mazeOn));
    setResetKey((k) => k + 1);
    pilotOn.current = false;
    setPilotOnState(false);
    putPlayerAtStart();
  }, [putPlayerAtStart]);
  // tre cacciatori (due a pugni, uno armato) sparsi nel labirinto, lontani dalla piazza
  const hunters = useCallback(() => {
    const far = maze.corridorCells.filter((c) => Math.hypot(c.x, c.z) > 14);
    for (let i = 0; i < 3; i++) {
      const c = far[Math.floor(Math.random() * far.length)];
      const kind: Kind = i === 2 ? 'hunter-armed' : 'hunter-fists';
      const wait = Math.max(0, lastSpawn.current + SPAWN_GAP_S * 1000 - performance.now());
      lastSpawn.current = performance.now() + wait;
      window.setTimeout(() => setList((l) => [...l, { id: `lab-${kind}-${++counter}`, kind, x: LAB_X + c.x, z: LAB_Z + c.z }]), wait);
    }
  }, [maze]);
  // dove compaiono: nella piazza (vicino al giocatore) o in una cella a caso del labirinto
  const whereRef = useRef<'plaza' | 'maze'>('plaza');
  const [where, setWhereState] = useState<'plaza' | 'maze'>('plaza');
  const setWhere = useCallback((w: 'plaza' | 'maze' | ((p: 'plaza' | 'maze') => 'plaza' | 'maze')) => {
    const next = typeof w === 'function' ? w(whereRef.current) : w;
    whereRef.current = next;
    setWhereState(next);
  }, []);
  // I personaggi compaiono uno alla volta, almeno SPAWN_GAP_S secondi l'uno dall'altro: due corpi
  // montati nello stesso istante si bloccano a vicenda (collider del corpo solido, limite noto)
  const lastSpawn = useRef(0);
  const spawn = useCallback(
    (kind: Kind) => {
      const wait = Math.max(0, lastSpawn.current + SPAWN_GAP_S * 1000 - performance.now());
      lastSpawn.current = performance.now() + wait;
      if (wait > 0) {
        window.setTimeout(() => spawnNow(kind), wait);
        return;
      }
      spawnNow(kind);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [maze]
  );
  const spawnNow = useCallback(
    (kind: Kind) => {
      const p = useStore.getState().playerPos;
      let x: number;
      let z: number;
      if (whereRef.current === 'maze') {
        const c = maze.corridorCells[Math.floor(Math.random() * maze.corridorCells.length)];
        x = LAB_X + c.x + (Math.random() - 0.5) * 2;
        z = LAB_Z + c.z + (Math.random() - 0.5) * 2;
      } else {
        const a = Math.random() * Math.PI * 2;
        const r = 2.5 + Math.random() * (maze.plazaHalf - 3.5);
        x = LAB_X + Math.cos(a) * r;
        z = LAB_Z + Math.sin(a) * r;
      }
      if (kind === 'pedestrian') {
        // un passante della folla, fermo, che guarda verso il giocatore
        spawnAnchoredAgent(x, z, Math.atan2(p[0] - x, p[2] - z), 'Idle_A', groundY());
        return;
      }
      setList((l) => [...l, { id: `lab-${kind}-${++counter}`, kind, x, z }]);
    },
    [maze]
  );
  const remove = useCallback((id: string) => setList((l) => l.filter((x) => x.id !== id)), []);
  const clear = useCallback(() => {
    setList([]);
    crowdAgents.splice(0, crowdAgents.length);
    for (const s of crowdSlots.keys()) crowdSlots[s] = null;
  }, []);
  // come se il giocatore avesse colpito il passante: lo ferisce e lo segna come "colpito da lui"
  const provoke = useCallback((armed = false) => {
    for (const o of cityOpponents) {
      if (!o.id.startsWith('crowd-') || o.isDead || o.team === 'CITY_ENEMY') continue;
      markPlayerHit(o.id);
      const agent = crowdAgents.find((a) => a.slot === Number(o.id.replace('crowd-', '')));
      if (agent) agent.forceHostile = armed ? 'armed' : 'fists';
      o.hp = Math.max(1, o.hp - 10);
      o.triggerHit = 'Hit_Chest';
      o.hitReactionHandled = true;
      o.hitFromX = useStore.getState().playerPos[0];
      o.hitFromZ = useStore.getState().playerPos[2];
      return o.id;
    }
    return null;
  }, []);

  useEffect(() => {
    (window as any).__charLab = {
      spawn,
      clear,
      provoke,
      hunters,
      restart,
      newMaze,
      setPilot: (on: boolean) => {
        pilotOn.current = on;
        setPilotOnState(on);
      },
      pilot: () => pilot.current?.status(),
      toggleMaze,
      exit: () => ({ x: LAB_X + maze.exit.x, z: LAB_Z + maze.exit.z }),
      setWhere,
      maze: () => ({ walls: maze.walls.length, cells: maze.corridorCells.length }),
      agents: () => agentsRef.current.map((a) => ({ id: a.id, slot: a.slot, gone: a.gone })),
      rows: () => rowsRef.current,
      list: () => listRef.current,
    };
  }, [spawn, clear, provoke, maze, hunters, restart, newMaze, toggleMaze]);

  const tposes = rows.filter((r) => r.tpose).length;
  const gy = groundY();

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0d1117', position: 'relative' }}>
      <Canvas
        gl={createGameRenderer}
        shadows={{ type: THREE.PCFShadowMap }}
        camera={{ position: [LAB_X + 8, gy + 16, LAB_Z + 18], fov: 50 }}
        dpr={[1, 1.5]}
        onCreated={(state) => ((window as any).__r3fState = state)}
      >
        <color attach="background" args={['#161b22']} />
        <ambientLight intensity={0.8} />
        <hemisphereLight args={['#bcd4ff', '#2a2f3a', 0.6]} />
        <directionalLight position={[LAB_X + 10, gy + 20, LAB_Z + 6]} intensity={2} castShadow />
        <Suspense fallback={null}>
          <Physics gravity={[0, -20, 0]} numSolverIterations={15} timeStep={1 / 120} interpolate={false}>
            <RigidBody type="fixed" colliders={false} position={[LAB_X, gy - 0.5, LAB_Z]}>
              <CuboidCollider args={[60, 0.5, 60]} friction={1} />
            </RigidBody>
            <CheckerFloor y={gy} />
            <WorldHandle />
            {world.mazeOn && <MazeWalls maze={maze} gy={gy} />}
            {world.mazeOn && <ExitBeacon maze={maze} gy={gy} />}
            <CityPlayer key={resetKey} userName="Lab" />
            <PilotDriver pilot={pilot} pilotOn={pilotOn} />
            <FollowCam on={follow} />
            <FirstPersonPick onChange={setFpName} />
            <LabCrowd agentsRef={agentsRef} />
            {list.map((s) => {
              const y = 0;
              switch (s.kind) {
                case 'moto':
                  return <Motorcycle key={s.id} id={s.id} position={[s.x, groundY() + 0.45, s.z]} yaw={Math.PI * 0.75} />;
                case 'enemy':
                case 'enemy-fists':
                  return <Enemy key={s.id} id={s.id} initialPosition={[s.x, y, s.z]} onGiveUp={remove} armed={s.kind === 'enemy'} />;
                case 'hunter-fists':
                case 'hunter-armed':
                  return <Enemy key={s.id} id={s.id} initialPosition={[s.x, y, s.z]} onGiveUp={remove} armed={s.kind === 'hunter-armed'} hunt />;
                case 'police':
                case 'swat':
                  return <PoliceOfficer key={s.id} id={s.id} spawn={[s.x, s.z]} swat={s.kind === 'swat'} onRemove={remove} />;
                case 'ally':
                  return <AllyNpc key={s.id} id={s.id} index={0} initialPosition={[s.x, y, s.z]} order={{ kind: 'follow', target: 'any', all: false }} onGone={remove} />;
                default:
                  return <Zombie key={s.id} id={s.id} kind={s.kind.replace('zombie-', '') as ZombieKind} x={s.x} z={s.z} onGone={remove} />;
              }
            })}
            <Probe onRows={setRows} />
          </Physics>
        </Suspense>
        <OrbitControls makeDefault target={[LAB_X, gy + 1, LAB_Z]} />
      </Canvas>

      <div style={{ position: 'absolute', top: 12, left: 12, width: 260, color: '#e6edf3', font: '13px system-ui', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Laboratorio personaggi</div>
        <div style={{ opacity: 0.7 }}>WASD muove il giocatore blu (Maiusc corre)</div>
        {KINDS.map((k) => (
          <button key={k.kind} onClick={() => spawn(k.kind)} style={btn}>
            + {k.label}
          </button>
        ))}
        <button onClick={() => provoke(false)} style={{ ...btn, background: '#b45309' }}>
          Colpisci un passante (pugni)
        </button>
        <button onClick={() => provoke(true)} style={{ ...btn, background: '#b45309' }}>
          Colpisci un passante (pistola)
        </button>
        <button onClick={hunters} style={{ ...btn, background: '#9a3412' }}>
          + 3 cacciatori nel labirinto
        </button>
        <button
          onClick={() => {
            pilotOn.current = !pilotOn.current;
            setPilotOnState(pilotOn.current);
          }}
          style={{ ...btn, background: pilotOnState ? '#15803d' : '#4b5563' }}
        >
          Pilota automatico: {pilotOnState ? 'acceso' : 'spento'}
        </button>
        <button onClick={() => setFollow((f) => !f)} style={{ ...btn, background: follow ? '#0e7490' : '#4b5563' }}>
          Telecamera: {follow ? 'segue il giocatore' : 'ferma'}
        </button>
        <button onClick={toggleMaze} style={{ ...btn, background: '#7c3aed' }}>
          Labirinto: {world.mazeOn ? 'acceso' : 'spento'}
        </button>
        <button onClick={restart} style={{ ...btn, background: '#1d4ed8' }}>
          Ricomincia
        </button>
        <button onClick={newMaze} style={{ ...btn, background: '#1d4ed8' }}>
          Nuovo labirinto
        </button>
        <button onClick={() => setWhere((w) => (w === 'plaza' ? 'maze' : 'plaza'))} style={{ ...btn, background: '#0f766e' }}>
          Compaiono: {where === 'plaza' ? 'nella piazza' : 'nel labirinto'}
        </button>
        <button onClick={clear} style={{ ...btn, background: '#7f1d1d' }}>
          Svuota
        </button>
        <button onClick={onExit} style={{ ...btn, background: '#374151' }}>
          Esci
        </button>
      </div>
      <div style={{ position: 'absolute', top: 12, right: 12, minWidth: 280, color: '#e6edf3', font: '12px ui-monospace, monospace', background: '#0009', padding: 10, borderRadius: 8 }}>
        {fpName && <div style={{ marginBottom: 6, color: '#93c5fd' }}>prima persona: {fpName} (Esc o clic nel vuoto per uscire)</div>}
        {pilotStatus && (
          <div style={{ marginBottom: 6, color: pilotStatus.mode === 'uscito' ? '#86efac' : pilotStatus.mode === 'sconfitto' ? '#f87171' : '#fde68a' }}>
            giocatore: {pilotOnState ? pilotStatus.mode : 'a mano'} | celle {pilotStatus.visited}/{pilotStatus.total} | uscita {pilotStatus.exitKnown ? 'trovata' : 'non trovata'} | minacce {pilotStatus.threats}
          </div>
        )}
        <div style={{ fontWeight: 700, color: tposes ? '#f87171' : '#86efac' }}>
          {rows.length} personaggi, {tposes} in posa a T
        </div>
        {rows.map((r, i) => (
          <div key={i} style={{ color: r.tpose ? '#f87171' : undefined }}>
            {r.name} | {r.clip} | hp {r.hp} {r.tpose ? '| T-POSE' : ''}
          </div>
        ))}
      </div>
    </div>
  );
};

const btn: React.CSSProperties = {
  background: '#1f6feb',
  color: '#fff',
  border: 0,
  borderRadius: 6,
  padding: '7px 10px',
  cursor: 'pointer',
  textAlign: 'left',
};

export default CharLab;
