import { spawnAnchoredAgent, crowdAgents, LOOK_CLIP, type CrowdAgent } from './crowdSim';
import { getStreetProps } from '../Environment/streetPropsData';
import { getTerrainHeight } from '../Environment/Terrain';
import { getRoadOffset } from '../Environment/Road';
import { worldRng } from '../../lib/worldSeed';

// "usane il piu' possibile in citta', ma con realta' fisica": gente ferma a un
// posto con la clip che ha senso li' -- seduti sulle panchine e nelle
// pensiline, uno al chiosco, chi innaffia la fioriera, qualcuno che balla,
// fa ginnastica o medita nelle piazze e nel parco, coppie che chiacchierano.
// Sono agenti "ancorati" (crowdSim: anchored): un corpo vero quando si e'
// vicini, una sagoma da lontano, fermi finche' non c'e' panico.

export const SIT_CLIPS = ['Sitting_Idle', 'Sitting_Talking'];
export const DANCE_CLIPS = ['Dance Body Roll', 'Dance Charleston', 'Dance Reach Hip', 'Dance_Simple'];
export const EXERCISE_CLIPS = ['Jumping Jacks', 'Pushup', 'Kimodo_stretch', 'Meditate'];
const WAIT_CLIPS = ['Idle_FoldArms', 'Kimodo_wait_impatient', 'Idle_TalkingPhone', 'Idle_A', LOOK_CLIP];
const SHOP_CLIPS = ['Interact', 'Consume Item', 'Idle_A', 'Idle_TalkingPhone'];
const CHAT_CLIPS = ['Idle_Talking', 'Idle Listening', 'Head Nod', 'Idle_FoldArms'];
const PARK_POOL = ['Meditate', 'Kimodo_stretch', 'Jumping Jacks', 'Idle_A', 'Dance_Simple'];
export const SCENE_CLIPS = [
  ...WAIT_CLIPS,
  ...SHOP_CLIPS,
  ...CHAT_CLIPS,
  ...PARK_POOL,
  ...SIT_CLIPS,
  ...DANCE_CLIPS,
  ...EXERCISE_CLIPS,
  'Interact',
  'Consume Item',
  'Farm_Watering',
  'PickUp_Table',
  'Fixing_Kneeling',
  'Farm_Harvest',
  'Idle Listening',
  'Idle_Rail_Call',
  'Greeting',
  'Head Nod',
];

export interface FurnitureLike {
  kind: string;
  x: number;
  z: number;
  rotationY: number;
}

const groundY = (x: number, z: number) => getTerrainHeight(x, z) + getRoadOffset(x, z);
// locale (lx, lz) di un oggetto con rotazione `ry` -> mondo (stessa regola di Environment)
const toWorld = (cx: number, cz: number, ry: number, lx: number, lz: number): [number, number] => [
  cx + lx * Math.cos(ry) + lz * Math.sin(ry),
  cz - lx * Math.sin(ry) + lz * Math.cos(ry),
];

let spawned: CrowdAgent[] = [];

// da chiamare una volta (idempotente: con l'HMR toglie quelli di prima)
export function spawnCrowdScenes(furniture: FurnitureLike[]) {
  if (spawned.length && crowdAgents.includes(spawned[0])) return;
  for (const a of spawned) {
    const i = crowdAgents.indexOf(a);
    if (i !== -1) crowdAgents.splice(i, 1);
  }
  spawned = [];
  const rnd = worldRng('crowd-scenes');
  const pick = <T,>(l: T[]) => l[Math.floor(rnd() * l.length)];
  const add = (x: number, z: number, yaw: number, clip: string, pool?: string[]) => {
    spawned.push(spawnAnchoredAgent(x, z, yaw, clip, groundY(x, z), pool));
  };

  // panchine: seduti, uno o due; in due si parlano. (Nelle clip da seduto il
  // bacino sta ~0.31 m dietro all'origine del corpo: per questo lz = +0.26
  // sulla panchina, che mette il bacino sul sedile.)
  for (const f of furniture) {
    if (f.kind !== 'bench' || rnd() > 0.6) continue;
    const two = rnd() < 0.45;
    const seats = two ? [-0.5, 0.5] : [rnd() < 0.5 ? -0.45 : 0.45];
    const talk = two && rnd() < 0.7;
    for (const lx of seats) {
      const [x, z] = toWorld(f.x, f.z, f.rotationY, lx, 0.26);
      add(x, z, f.rotationY, talk ? 'Sitting_Talking' : pick(SIT_CLIPS), SIT_CLIPS);
    }
  }

  // idrante: ogni tanto un operaio inginocchiato a ripararlo
  for (const f of furniture) {
    if (f.kind !== 'hydrant' || rnd() > 0.18) continue;
    const [x, z] = toWorld(f.x, f.z, f.rotationY, 0.0, 0.7);
    add(x, z, f.rotationY + Math.PI, 'Fixing_Kneeling');
  }

  const sp = getStreetProps().spots;
  for (const s of sp) {
    if (s.kind === 'shelter') {
      // la panca della pensilina e' a (0, 0.5, -0.45) locale, si guarda verso +z
      const seats = rnd() < 0.5 ? [-0.55, 0.55] : [rnd() < 0.5 ? -0.5 : 0.5];
      for (const lx of seats) {
        const [x, z] = toWorld(s.x, s.z, s.yaw, lx, -0.14);
        add(x, z, s.yaw, rnd() < 0.5 ? 'Sitting_Idle' : 'Sitting_Talking', SIT_CLIPS);
      }
      // chi aspetta in piedi, in fondo alla pensilina
      const [x, z] = toWorld(s.x, s.z, s.yaw, 1.0, 0.35);
      add(x, z, s.yaw + 0.5, pick(WAIT_CLIPS), WAIT_CLIPS);
    } else if (s.kind === 'kiosk') {
      // il cliente davanti alla finestra del chiosco (locale +z), guarda il chiosco
      if (rnd() > 0.85) continue;
      const [x, z] = toWorld(s.x, s.z, s.yaw, rnd() * 1.2 - 0.6, 1.75);
      add(x, z, s.yaw + Math.PI, pick(['Interact', 'Interact', 'Consume Item']), SHOP_CLIPS);
    } else if (s.kind === 'dumpster') {
      // il netturbino davanti al cassonetto
      if (rnd() > 0.3) continue;
      const [x, z] = toWorld(s.x, s.z, s.yaw, 0, 1.1);
      add(x, z, s.yaw + Math.PI, 'PickUp_Table', ['PickUp_Table', 'Idle_FoldArms', 'Idle_A', 'Kimodo_stretch']);
    } else if (s.kind === 'planter') {
      if (rnd() > 0.25) continue;
      const [x, z] = toWorld(s.x, s.z, s.yaw, 0, 0.95);
      add(x, z, s.yaw + Math.PI, 'Farm_Watering', ['Farm_Watering', 'Idle_A', LOOK_CLIP]);
    }
  }

  // piazze e parco: gruppi che ballano, ginnastica, meditazione, chiacchiere
  const group = (cx: number, cz: number, r: number, n: number, clips: string[], face: 'centre' | 'out') => {
    for (let k = 0; k < n; k++) {
      const th = (k / n) * Math.PI * 2 + rnd() * 0.4;
      const x = cx + Math.cos(th) * r;
      const z = cz + Math.sin(th) * r;
      const toC = Math.atan2(cx - x, cz - z);
      add(x, z, face === 'centre' ? toC : toC + Math.PI, pick(clips), clips);
    }
  };
  const pair = (cx: number, cz: number, yaw: number, a: string, b: string) => {
    const dx = Math.sin(yaw + Math.PI / 2) * 0.55;
    const dz = Math.cos(yaw + Math.PI / 2) * 0.55;
    // uno di fronte all'altro, a ~1.1 m
    add(cx - dx, cz - dz, yaw + Math.PI / 2, a, CHAT_CLIPS);
    add(cx + dx, cz + dz, yaw - Math.PI / 2, b, CHAT_CLIPS);
  };
  for (const [cx, cz] of PLAZA_DANCE) group(cx, cz, 1.7, 5, DANCE_CLIPS, 'centre');
  for (const [cx, cz] of PLAZA_EXERCISE) {
    group(cx, cz, 2.6, 4, ['Jumping Jacks', 'Kimodo_stretch', 'Pushup', 'Meditate'], 'out');
  }
  for (const [x, z, clip] of PARK_SPOTS) add(x, z, rnd() * Math.PI * 2, clip, PARK_POOL);
  for (const [cx, cz, yaw] of PLAZA_CHAT) pair(cx, cz, yaw, 'Idle_Talking', 'Idle Listening');
}

// Punti scelti nelle zone libere (piazze e parco): verificati in partita
// con insideStatics (nessuno dentro un ostacolo).
export const PLAZA_DANCE: Array<[number, number]> = [[-90, 150]];
export const PLAZA_EXERCISE: Array<[number, number]> = [[150, -90]];
export const PLAZA_CHAT: Array<[number, number, number]> = [
  [-75, 138, 0.3],
  [165, -104, 1.2],
];

// nel parco (centro 30,30, fontana r 4): chi medita, chi si allena, il giardiniere
export const PARK_SPOTS: Array<[number, number, string]> = [
  [20, 20, 'Meditate'],
  [40, 40, 'Meditate'],
  [20, 42, 'Jumping Jacks'],
  [42, 18, 'Kimodo_stretch'],
  [30, 14, 'Farm_Harvest'],
];
