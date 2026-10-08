import { K } from '../../lib/kimodo';
import { getTerrainHeight } from '../Environment/Terrain';
import { getRoadOffset, ROAD_WIDTH, SIDEWALK_WIDTH } from '../Environment/Road';
import {
  pushOutOfStatics,
  queryStatics,
  segHitsBox,
  segHitsCircle,
  segHitsRect,
  type StaticCircle,
  type StaticRect,
} from './crowdObstacles';

// "Folle disegnate in blocco": la folla della citta' e' fatta di AGENTI
// leggeri (solo numeri: tratto di marciapiede, posizione, passo) che
// camminano tutti, sempre, per pochi microsecondi l'uno. Solo i piu' vicini
// al giocatore prendono un corpo vero -- un manichino completo con fisica,
// animazioni, ragdoll -- da un pool fisso (Crowd.tsx / CrowdPedestrian.tsx);
// tutti gli altri sono disegnati in blocco come sagome instanziate
// (CrowdInstances.tsx), senza fisica e senza mixer di animazione.

export const CROWD_FULL_SLOTS = 6; // corpi veri al massimo
export const CROWD_ASSIGN_DIST = 26; // entro questa distanza un agente prende un corpo vero
export const CROWD_RELEASE_DIST = 32; // oltre, lo restituisce al pool
export const CROWD_DRAW_DIST = 190; // le sagome oltre non si disegnano
// le pose da fermo delle sagome sono a questo punto della clip (0-1): il
// corpo vero, quando prende il posto della sagoma, riparte da li'
export const IDLE_POSE_AT = 0.35;

const GRID_SPACING = 60;
const GRID_RADIUS = 1;
const BLOCK_HALF = GRID_SPACING / 2;
const SIDEWALK_CENTER_OFFSET = ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2;
const SIDE_HALF_LEN = BLOCK_HALF - 12; // lascia spazio tra i passanti e le strisce agli incroci
const AGENTS_PER_SIDE = 5;
const CROSSWALK_OFFSET = ROAD_WIDTH / 2 + 2;

const isSkippedBlock = (i: number, j: number): boolean => (i === 0 && j === 0) || (i === -1 && j === 1) || (i === 1 && j === -1);

export const CIVILIAN_COLORS = ['#8d6e63', '#607d8b', '#9e9d24', '#6d4c41', '#78909c', '#a1887f', '#5d4037', '#827717', '#455a64'];
export const WALK_CLIPS = ['Walk'];
// (le Kimodo_* solo se generate: CrowdPedestrian ripiega su Idle_A)
export const IDLE_CLIPS = ['Idle_A', 'Idle_TalkingPhone', 'Idle_FoldArms', 'Idle_Talking', 'Idle_Subtle', ...K.crowdIdles];
// (le clip da fermo usate davvero: vedi LOOK_CLIP / LINGER_CLIPS sotto)
// velocita' "a terra" delle camminate (m/s, per non far scivolare i piedi)
export const WALK_BASE_SPEED: Record<string, number> = { Walk: 0.73 };

export interface CrowdAgent {
  id: number;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  len: number;
  speed: number;
  t: number;
  dir: number;
  pause: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  gait: number; // fase del ciclo del passo (0..1) per le sagome
  color: string;
  walkClip: string;
  idleClip: string;
  // passato al corpo vero e diventato nemico, o morto: lo gestisce il suo
  // corpo (o il nemico); la folla non lo muove e non lo disegna
  gone: boolean;
  slot: number;
  dist: number; // dal giocatore, aggiornata dal gestore
  // panico (crowdPanic): secondi rimasti e da dove e' venuto lo spavento
  fear: number;
  fearX: number;
  fearZ: number;
  turnAxis: 'horizontal' | 'vertical' | null;
  // corsia: ognuno cammina un po' di lato rispetto alla linea del suo
  // tratto, dalla sua parte (chi va e chi viene non si attraversano)
  lane: number; // m, 0.12..0.42
  ox: number; // spostamento laterale attuale (mondo), si avvicina piano a quello voluto
  oz: number;
  // evitare gli altri: velocita' effettiva (m/s) e passo di lato voluto (m)
  curSpeed: number;
  avoid: number;
  // spostamento laterale scelto per girare intorno a muri, pali e auto
  // ferme (steerAround); NaN = nessun ostacolo, si usa corsia + avoid
  steer: number;
  // perche' rallenta/si ferma (per l'ispettore NPC e i test)
  blockedBy: string;
  stuckT: number; // s fermo davanti a un ostacolo senza via d'uscita
  // cosa fa da fermo: 'pause' (attimo), 'look' (si guarda intorno prima di
  // cambiare strada), 'linger' (si ferma a lungo: telefono, chiacchiere...)
  activity: 'walk' | 'pause' | 'look' | 'linger';
  // colpito da lontano mentre era una sagoma: il colpo da applicare al
  // corpo vero appena lo prende (vedi promoteCrowdAgent)
  pendingHit: CrowdPendingHit | null;
}

export interface CrowdPendingHit {
  seg: string;
  dir: [number, number, number];
  point: [number, number, number];
  speed: number;
  damage: number;
}

// "la gente che parla al telefono nn la vedo quasi mai e potresti usare
// l'animazione di quando si guarda in giro quando si ferma e cambiano
// direzione": prima a fine tratto c'era una pausa di 0-0.2 s (la clip da
// fermo non si vedeva mai). Ora a fine tratto: a volte ci si guarda intorno
// prima di girare, a volte ci si ferma a lungo al bordo del marciapiede
// (telefono, braccia conserte, impaziente...).
const LOOK_CHANCE = 0.35;
const LOOK_S: [number, number] = [3, 5];
const LINGER_CHANCE = 0.3;
const LINGER_S: [number, number] = [12, 35];
const LINGER_START = 0.15; // quanti partono gia' fermi
export const LOOK_CLIP = 'Kimodo_look_around';
export const LINGER_CLIPS = [
  'Kimodo_phone_talk',
  'Idle_TalkingPhone',
  'Idle_FoldArms',
  'Kimodo_wait_impatient',
  'Idle_Talking',
  'Kimodo_stretch',
];
// dove sta di lato chi si ferma a lungo: verso le case (m dal centro del marciapiede)
const LINGER_SIDE = 0.5;

// "ci sono glitch strani" (folla): misurato, 3-7 coppie di passanti a meno
// di 60 cm l'uno dall'altro in ogni momento, tutti sulla stessa linea
// (6 agenti esattamente su x=-4.75) -- si attraversavano camminando, e
// camminavano addosso al giocatore e alle auto (e chi tocca il giocatore
// diventa un nemico). Adesso: corsie, si rallenta dietro a chi e' piu'
// lento, si fa un passo di lato per chi viene incontro, ci si ferma
// davanti a un'auto in movimento.
export interface CrowdObstacle {
  x: number;
  z: number;
  r: number; // raggio (m); per le auto quello che le contiene
  moving: boolean;
  // auto: rettangolo orientato (assi locali X e Z a terra, mezze misure)
  box?: { ux: number; uz: number; vx: number; vz: number; hx: number; hz: number };
}
const AVOID_RANGE = 1.3; // m davanti
const FOLLOW_GAP = 0.6; // m: dietro a qualcuno ci si ferma a questa distanza
const SIDESTEP = 0.35; // m di lato per chi viene incontro
const LANE_EASE = 0.9; // m/s: quanto in fretta si cambia corsia
const CAR_LOOK = 4.5; // m davanti: un'auto in movimento qui fa aspettare
const AVOID_DIST = 60; // oltre, niente evitamenti (non si vede)

// "folla piu' viva": uno sparo spaventa chi e' vicino. Si scappa lungo il
// proprio marciapiede, dalla parte opposta allo sparo; arrivati in fondo (o
// se lo sparo e' vicinissimo) ci si accuccia coprendosi la testa.
export const PANIC_RADIUS = 30;
export const PANIC_S = 9;
export const PANIC_SPEED = 3.6; // m/s
export const COWER_DIST = 5;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function randomRouteTarget(current: number, previous: number, extent: number): number {
  for (let attempt = 0; attempt < 12; attempt++) {
    const target = rand(-extent, extent);
    if (Math.abs(target - current) >= 24 && Math.abs(target - previous) >= 24) return target;
  }

  const alternatives = [-extent, -extent / 2, 0, extent / 2, extent].filter(
    (target) => Math.abs(target - current) >= 24 && Math.abs(target - previous) >= 24
  );
  return alternatives[Math.floor(Math.random() * alternatives.length)] ?? (current < 0 ? extent : -extent);
}

function randomTurnTarget(current: number, extent: number): number | null {
  const points: number[] = [];
  for (let offset = -extent; offset <= extent; offset += GRID_SPACING) {
    for (const side of [-1, 1]) {
      const target = offset + side * SIDEWALK_CENTER_OFFSET;
      if (Math.abs(target - current) >= 24) points.push(target);
    }
  }
  return points.length > 0 ? points[Math.floor(Math.random() * points.length)] : null;
}

function makeAgent(id: number, x1: number, z1: number, x2: number, z2: number): CrowdAgent {
  const h = id * 7919;
  return {
    id,
    x1,
    z1,
    x2,
    z2,
    len: Math.hypot(x2 - x1, z2 - z1),
    speed: rand(0.75, 1.05),
    t: Math.random(),
    dir: Math.random() < 0.5 ? 1 : -1,
    pause: 0,
    x: x1,
    y: 0,
    z: z1,
    yaw: 0,
    gait: Math.random(),
    color: CIVILIAN_COLORS[h % CIVILIAN_COLORS.length],
    walkClip: WALK_CLIPS[(h >> 2) % WALK_CLIPS.length],
    idleClip: IDLE_CLIPS[(h >> 5) % IDLE_CLIPS.length],
    gone: false,
    slot: -1,
    dist: Infinity,
    fear: 0,
    fearX: 0,
    fearZ: 0,
    turnAxis: null,
    lane: rand(0.12, 0.42),
    ox: 0,
    oz: 0,
    curSpeed: 0,
    avoid: 0,
    steer: NaN,
    blockedBy: '',
    stuckT: 0,
    activity: 'walk',
    pendingHit: null,
  };
}

function makeAgents(): CrowdAgent[] {
  const out: CrowdAgent[] = [];
  let id = 0;
  for (let i = -GRID_RADIUS; i <= GRID_RADIUS; i++) {
    for (let j = -GRID_RADIUS; j <= GRID_RADIUS; j++) {
      if (isSkippedBlock(i, j)) continue;
      const bx = i * GRID_SPACING + GRID_SPACING / 2;
      const bz = j * GRID_SPACING + GRID_SPACING / 2;
      // i quattro marciapiedi del blocco
      const sides: Array<[number, number, number, number]> = [
        [bx - BLOCK_HALF + SIDEWALK_CENTER_OFFSET, bz - SIDE_HALF_LEN, bx - BLOCK_HALF + SIDEWALK_CENTER_OFFSET, bz + SIDE_HALF_LEN],
        [bx + BLOCK_HALF - SIDEWALK_CENTER_OFFSET, bz - SIDE_HALF_LEN, bx + BLOCK_HALF - SIDEWALK_CENTER_OFFSET, bz + SIDE_HALF_LEN],
        [bx - SIDE_HALF_LEN, bz - BLOCK_HALF + SIDEWALK_CENTER_OFFSET, bx + SIDE_HALF_LEN, bz - BLOCK_HALF + SIDEWALK_CENTER_OFFSET],
        [bx - SIDE_HALF_LEN, bz + BLOCK_HALF - SIDEWALK_CENTER_OFFSET, bx + SIDE_HALF_LEN, bz + BLOCK_HALF - SIDEWALK_CENTER_OFFSET],
      ];
      for (const [ax, az, cx, cz] of sides) {
        for (let k = 0; k < AGENTS_PER_SIDE; k++) {
          // un tratto a caso del marciapiede, un po' spostato di lato
          const a = rand(0, 0.5);
          const b = rand(a + 0.3, 1);
          const lat = rand(-0.25, 0.25);
          const vertical = ax === cx;
          const x1 = ax + (cx - ax) * a + (vertical ? lat : 0);
          const z1 = az + (cz - az) * a + (vertical ? 0 : lat);
          const x2 = ax + (cx - ax) * b + (vertical ? lat : 0);
          const z2 = az + (cz - az) * b + (vertical ? 0 : lat);
          out.push(makeAgent(id++, x1, z1, x2, z2));
        }
      }
    }
  }

  // Aggiunge passanti che attraversano da un marciapiede all'altro,
  // seguendo i passaggi segnati alle intersezioni della griglia cittadina.
  for (let i = -GRID_RADIUS; i <= GRID_RADIUS + 1; i++) {
    for (let j = -GRID_RADIUS; j <= GRID_RADIUS + 1; j++) {
      const ox = i * GRID_SPACING;
      const oz = j * GRID_SPACING;
      for (const side of [-1, 1]) {
        const crosswalkZ = oz + side * CROSSWALK_OFFSET;
        out.push(makeAgent(id++, ox - SIDEWALK_CENTER_OFFSET, crosswalkZ, ox + SIDEWALK_CENTER_OFFSET, crosswalkZ));

        const crosswalkX = ox + side * CROSSWALK_OFFSET;
        out.push(makeAgent(id++, crosswalkX, oz - SIDEWALK_CENTER_OFFSET, crosswalkX, oz + SIDEWALK_CENTER_OFFSET));
      }
    }
  }

  return out;
}

export const crowdAgents: CrowdAgent[] = makeAgents();
// agente assegnato a ciascun corpo vero del pool (null = libero)
export const crowdSlots: (CrowdAgent | null)[] = Array.from({ length: CROWD_FULL_SLOTS }, () => null);

// durata del ciclo della camminata delle sagome (s a velocita' base)
export const CROWD_GAIT_CYCLE_S = 1.1;

// sul marciapiede (non mentre attraversa la strada): le strade corrono
// lungo i multipli di GRID_SPACING, il marciapiede e' tra ROAD_WIDTH/2 e
// ROAD_WIDTH/2 + SIDEWALK_WIDTH dal loro centro
function onSidewalk(a: CrowdAgent): boolean {
  const horizontal = Math.abs(a.x2 - a.x1) >= Math.abs(a.z2 - a.z1);
  const c = horizontal ? a.z : a.x;
  const d = Math.abs(c - Math.round(c / GRID_SPACING) * GRID_SPACING);
  return d > ROAD_WIDTH / 2 + 0.1 && d < ROAD_WIDTH / 2 + SIDEWALK_WIDTH + 0.1;
}

// a fine tratto (o all'inizio): cosa fa da fermo
// meta' delle soste lunghe sono al telefono, il resto le altre
const PHONE_CLIPS = ['Kimodo_phone_talk', 'Idle_TalkingPhone'];
function pickLingerClip() {
  const pool = Math.random() < 0.5 ? PHONE_CLIPS : LINGER_CLIPS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function chooseStop(a: CrowdAgent) {
  const r = Math.random();
  if (onSidewalk(a) && r < LINGER_CHANCE) {
    a.activity = 'linger';
    a.idleClip = pickLingerClip();
    a.pause = rand(LINGER_S[0], LINGER_S[1]);
  } else if (r < LINGER_CHANCE + LOOK_CHANCE) {
    a.activity = 'look';
    a.idleClip = LOOK_CLIP;
    a.pause = rand(LOOK_S[0], LOOK_S[1]);
  } else {
    a.activity = 'pause';
    a.idleClip = 'Idle_A';
    a.pause = rand(0.3, 0.9);
  }
}

// direzione di marcia (unitaria) di un agente sul suo tratto
function forwardOf(a: CrowdAgent, out: { x: number; z: number }) {
  const sx = a.x2 - a.x1;
  const sz = a.z2 - a.z1;
  const l = Math.hypot(sx, sz) || 1;
  const sg = a.dir >= 0 ? 1 : -1;
  out.x = (sx / l) * sg;
  out.z = (sz / l) * sg;
}

const _fa = { x: 0, z: 0 };
const _fb = { x: 0, z: 0 };
const _grid = new Map<number, CrowdAgent[]>();
const cellKey = (cx: number, cz: number) => (cx + 1000) * 4096 + (cz + 1000);

// Quanto puo' andare avanti ogni agente (0..1) e di quanto spostarsi di
// lato, guardando chi ha davanti (altri passanti, giocatore, auto).
function avoidance(obstacles: CrowdObstacle[]): Map<CrowdAgent, number> {
  const speedK = new Map<CrowdAgent, number>();
  _grid.clear();
  for (const a of crowdAgents) {
    if (a.gone || a.dist > AVOID_DIST + 5) continue;
    const k = cellKey(Math.floor(a.x / 2), Math.floor(a.z / 2));
    let l = _grid.get(k);
    if (!l) _grid.set(k, (l = []));
    l.push(a);
  }
  for (const a of crowdAgents) {
    a.steer = NaN;
    a.blockedBy = '';
    if (a.gone || a.dist > AVOID_DIST || a.pause > 0 || isCowering(a)) continue;
    forwardOf(a, _fa);
    // destra della direzione di marcia
    const rx = -_fa.z;
    const rz = _fa.x;
    let k = 1;
    let avoid = 0;
    const cx = Math.floor(a.x / 2);
    const cz = Math.floor(a.z / 2);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        const l = _grid.get(cellKey(cx + i, cz + j));
        if (!l) continue;
        for (const b of l) {
          if (b === a) continue;
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const ahead = dx * _fa.x + dz * _fa.z;
          if (ahead <= 0 || ahead > AVOID_RANGE) continue;
          const lat = dx * rx + dz * rz;
          if (Math.abs(lat) > 0.55) continue;
          forwardOf(b, _fb);
          const same = _fa.x * _fb.x + _fa.z * _fb.z;
          if (same > 0.3 && b.pause <= 0) {
            // stessa direzione: dietro, alla sua velocita' se e' piu' lento
            if (b.curSpeed < a.speed) {
              const kf = Math.max(0, (ahead - FOLLOW_GAP) / (AVOID_RANGE - FOLLOW_GAP));
              if (kf < k) {
                k = kf;
                a.blockedBy = `segue ${b.id}`;
              }
            }
          } else if (same > 0.3 || b.pause > 0) {
            // fermo davanti: si passa di lato
            avoid += lat >= 0 ? -SIDESTEP : SIDESTEP;
            if (ahead < FOLLOW_GAP && k > 0.3) {
              k = 0.3;
              a.blockedBy = `fermo davanti ${b.id}`;
            }
          } else {
            // viene incontro o attraversa: un passo di lato
            avoid += lat >= 0 ? -SIDESTEP : SIDESTEP;
          }
        }
      }
    for (const o of obstacles) {
      if (!o.moving) continue;
      const dx = o.x - a.x;
      const dz = o.z - a.z;
      const ahead = dx * _fa.x + dz * _fa.z;
      const lat = dx * rx + dz * rz;
      // auto in movimento davanti (anche di poco di lato): si aspetta
      if (ahead > -0.5 && ahead < CAR_LOOK && Math.abs(lat) < o.r + 0.6) {
        k = 0;
        a.blockedBy = 'auto in movimento';
      }
    }
    a.avoid = Math.max(-0.9, Math.min(0.9, avoid));
    // muri, pali, auto ferme e giocatore: di quanto andare di lato
    const ks = steerAround(a, a.fear > 0 ? 0 : a.lane + a.avoid, obstacles);
    if (ks < k) {
      k = ks;
      a.blockedBy = 'ostacolo davanti';
    }
    speedK.set(a, k);
  }
  return speedK;
}

// "nn riescono ad aggirare un'auto messa sul marciapiede e si formano code"
// e "nn devono compenetrare i muri degli edifici o i pali": prima un
// ostacolo fermo dava al massimo 0.9 m di passo di lato (un'auto ne occupa
// 2 e il marciapiede e' largo 1.5) e chi non passava si fermava, con tutti
// dietro in coda; muri e pali la folla non li conosceva proprio. Ora ogni
// passante guarda il corridoio davanti a se' (STEER_LOOK) e, se e'
// occupato, sceglie lo spostamento laterale libero piu' vicino alla sua
// corsia, anche scendendo dal marciapiede (fino a STEER_MAX), e intanto
// rallenta finche' la strada davanti non e' libera.
const BODY_R = 0.28; // m, mezzo passante
const YAW_RATE = 6; // rad/s: quanto in fretta ci si gira verso dove si va
const STEER_LOOK = 2.6; // m di corridoio davanti da tenere libero
const STEER_MAX = 3; // m di lato al massimo rispetto alla linea del tratto
const STEER_STEP = 0.2;
const STUCK_TURN_S = 2.5;
const STEER_EASE = 1.3; // m/s di spostamento laterale quando si gira intorno
const _sr: StaticRect[] = [];
const _sc: StaticCircle[] = [];
const _near: CrowdObstacle[] = [];

function segBlocked(ax: number, az: number, bx: number, bz: number) {
  for (const r of _sr) if (segHitsRect(ax, az, bx, bz, r, BODY_R)) return true;
  for (const c of _sc) if (segHitsCircle(ax, az, bx, bz, c, BODY_R)) return true;
  for (const o of _near) {
    const b = o.box;
    if (!b) {
      if (segHitsCircle(ax, az, bx, bz, o, BODY_R)) return true;
      continue;
    }
    const lax = (ax - o.x) * b.ux + (az - o.z) * b.uz;
    const laz = (ax - o.x) * b.vx + (az - o.z) * b.vz;
    const lbx = (bx - o.x) * b.ux + (bz - o.z) * b.uz;
    const lbz = (bx - o.x) * b.vx + (bz - o.z) * b.vz;
    if (segHitsBox(lax, laz, lbx, lbz, b.hx + BODY_R, b.hz + BODY_R)) return true;
  }
  return false;
}

// fuori da un'auto ferma (rettangolo orientato)
function pushOutOfBox(x: number, z: number, o: CrowdObstacle): [number, number] {
  const b = o.box!;
  const dx = x - o.x;
  const dz = z - o.z;
  const lx = dx * b.ux + dz * b.uz;
  const lz = dx * b.vx + dz * b.vz;
  const hx = b.hx + BODY_R;
  const hz = b.hz + BODY_R;
  if (Math.abs(lx) >= hx || Math.abs(lz) >= hz) return [x, z];
  // esce dal lato piu' vicino
  let nx = lx;
  let nz = lz;
  if (hx - Math.abs(lx) < hz - Math.abs(lz)) nx = Math.sign(lx || 1) * hx;
  else nz = Math.sign(lz || 1) * hz;
  return [o.x + nx * b.ux + nz * b.vx, o.z + nx * b.uz + nz * b.vz];
}

// ritorna quanto puo' andare avanti (0..1); scrive a.steer
function steerAround(a: CrowdAgent, pref: number, obstacles: CrowdObstacle[]): number {
  const fx = _fa.x;
  const fz = _fa.z;
  const rx = -fz;
  const rz = fx;
  const reach = STEER_LOOK + STEER_MAX + 0.5;
  queryStatics(a.x - reach, a.z - reach, a.x + reach, a.z + reach, _sr, _sc);
  _near.length = 0;
  for (const o of obstacles) if (!o.moving && Math.hypot(o.x - a.x, o.z - a.z) < reach + o.r) _near.push(o);
  if (_sr.length === 0 && _sc.length === 0 && _near.length === 0) return 1;
  const cur = a.ox * rx + a.oz * rz;
  // corridoio dritto davanti con spostamento laterale `lat`
  const clear = (lat: number, len: number) => {
    const sx = a.x + rx * (lat - cur) + fx * 0.1;
    const sz = a.z + rz * (lat - cur) + fz * 0.1;
    return !segBlocked(sx, sz, sx + fx * len, sz + fz * len);
  };
  // per arrivarci: in diagonale da dove si e' adesso
  const reachable = (lat: number) =>
    Math.abs(lat - cur) < 0.05 || !segBlocked(a.x, a.z, a.x + rx * (lat - cur) + fx * 0.6, a.z + rz * (lat - cur) + fz * 0.6);
  let best = NaN;
  if (clear(pref, STEER_LOOK)) best = pref;
  else {
    const prev = cur;
    let bestCost = Infinity;
    const n = Math.round(STEER_MAX / STEER_STEP) * 2;
    for (let i = 1; i <= n; i++) {
      const d = i * STEER_STEP;
      if (d > bestCost) break;
      for (const sg of [1, -1]) {
        const lat = pref + sg * d;
        if (Math.abs(lat) > STEER_MAX) continue;
        // vicino alla corsia, e senza cambiare lato a ogni frame
        const cost = d + 0.5 * Math.abs(lat - prev);
        if (cost >= bestCost) continue;
        if (clear(lat, STEER_LOOK) && reachable(lat)) {
          best = lat;
          bestCost = cost;
        }
      }
    }
  }
  a.steer = Number.isFinite(best) ? best : pref;
  // avanti solo quanto e' libero dove si e' adesso
  if (clear(cur, STEER_LOOK)) return 1;
  if (clear(cur, 1.2)) return 0.85;
  if (clear(cur, 0.6)) return 0.25;
  return 0;
}

// Un passo di simulazione per tutti: pochi conti per agente.
export function stepCrowd(dt: number, px: number, pz: number, obstacles: CrowdObstacle[] = []) {
  for (const a of crowdAgents) a.dist = Math.hypot(a.x - px, a.z - pz);
  const speedK = avoidance(obstacles);
  for (const a of crowdAgents) {
    if (a.gone) continue;
    a.curSpeed = 0;
    if (a.fear > 0) {
      a.fear -= dt;
      // verso quale capo del tratto ci si allontana dallo sparo
      const away = (a.x2 - a.x1) * (a.x - a.fearX) + (a.z2 - a.z1) * (a.z - a.fearZ) >= 0 ? 1 : -1;
      a.dir = away;
      a.pause = 0;
      if (!isCowering(a) && a.len > 0.01) {
        a.t = Math.min(1, Math.max(0, a.t + (a.dir * PANIC_SPEED * dt) / a.len));
        a.curSpeed = PANIC_SPEED;
        a.gait = (a.gait + (dt * PANIC_SPEED) / ((WALK_BASE_SPEED[a.walkClip] ?? 0.75) * CROWD_GAIT_CYCLE_S * 2.5)) % 1;
      }
      if (a.fear <= 0) a.pause = rand(0.5, 1.0); // si riprende un attimo
    } else if (a.pause > 0) {
      a.pause -= dt;
      if (a.pause <= 0) a.activity = 'walk';
    } else if (a.len > 0.01) {
      const v = a.speed * (speedK.get(a) ?? 1);
      a.curSpeed = v;
      // strada chiusa del tutto (niente spazio di lato): dopo un po' ci si
      // guarda intorno e si torna indietro, invece di restare li' con la
      // coda dietro
      a.stuckT = v < 0.05 && a.blockedBy === 'ostacolo davanti' ? a.stuckT + dt : 0;
      if (a.stuckT > STUCK_TURN_S) {
        a.stuckT = 0;
        a.dir = a.dir >= 0 ? -1 : 1;
        a.activity = 'look';
        a.idleClip = LOOK_CLIP;
        a.pause = rand(LOOK_S[0], LOOK_S[1]);
      }
      a.t += (a.dir * v * dt) / a.len;
      if (a.t >= 1 || a.t <= 0) {
        a.t = Math.min(1, Math.max(0, a.t));
        const reachedX = a.x1 + (a.x2 - a.x1) * a.t;
        const reachedZ = a.z1 + (a.z2 - a.z1) * a.t;
        const horizontal = Math.abs(a.x2 - a.x1) >= Math.abs(a.z2 - a.z1);
        const extent = (GRID_RADIUS + 1) * GRID_SPACING;
        const currentAxis = horizontal ? 'horizontal' : 'vertical';
        const nextAxis = a.turnAxis ?? currentAxis;
        a.turnAxis = null;
        const previousTarget = nextAxis === 'horizontal' ? (a.t === 0 ? a.x2 : a.x1) : a.t === 0 ? a.z2 : a.z1;
        let nextTarget: number;
        if (nextAxis === currentAxis && Math.random() < 0.35) {
          const turn = randomTurnTarget(horizontal ? reachedX : reachedZ, extent);
          if (turn !== null) {
            nextTarget = turn;
            a.turnAxis = horizontal ? 'vertical' : 'horizontal';
          } else {
            nextTarget = randomRouteTarget(horizontal ? reachedX : reachedZ, previousTarget, extent);
          }
        } else {
          nextTarget = randomRouteTarget(nextAxis === 'horizontal' ? reachedX : reachedZ, previousTarget, extent);
        }
        a.x1 = reachedX;
        a.z1 = reachedZ;
        a.x2 = nextAxis === 'horizontal' ? nextTarget : reachedX;
        a.z2 = nextAxis === 'horizontal' ? reachedZ : nextTarget;
        a.t = 0;
        a.dir = 1;
        a.len = Math.abs(nextTarget - (nextAxis === 'horizontal' ? reachedX : reachedZ));
        chooseStop(a);
      }
      // il passo va con la velocita' vera (fermo dietro a qualcuno: fermo)
      a.gait = (a.gait + (dt * v) / ((WALK_BASE_SPEED[a.walkClip] ?? 0.75) * CROWD_GAIT_CYCLE_S)) % 1;
    }
    const nx = a.x1 + (a.x2 - a.x1) * a.t;
    const nz = a.z1 + (a.z2 - a.z1) * a.t;
    forwardOf(a, _fa);
    const fwdV = a.curSpeed;
    const pox = a.ox;
    const poz = a.oz;
    const steering = Number.isFinite(a.steer);
    // corsia (dalla propria destra) + passo di lato, avvicinati piano
    if (a.len > 0.01) {
      const off = steering ? a.steer : a.fear > 0 ? 0 : a.lane + a.avoid;
      let tx = -_fa.z * off;
      let tz = _fa.x * off;
      if (a.activity === 'linger' && a.pause > 0) {
        // fermo a lungo: di lato, verso le case (lontano dalla strada)
        const horizontal = Math.abs(a.x2 - a.x1) >= Math.abs(a.z2 - a.z1);
        if (horizontal) {
          tx = 0;
          tz = Math.sign(nz - Math.round(nz / GRID_SPACING) * GRID_SPACING) * LINGER_SIDE;
        } else {
          tx = Math.sign(nx - Math.round(nx / GRID_SPACING) * GRID_SPACING) * LINGER_SIDE;
          tz = 0;
        }
      }
      const dx = tx - a.ox;
      const dz = tz - a.oz;
      const d = Math.hypot(dx, dz);
      const step = (steering ? STEER_EASE : LANE_EASE) * dt;
      if (d <= step) {
        a.ox = tx;
        a.oz = tz;
      } else {
        a.ox += (dx / d) * step;
        a.oz += (dz / d) * step;
      }
    }
    a.x = nx + a.ox;
    a.z = nz + a.oz;
    // mai dentro muri, pali o auto ferme (rete di sicurezza)
    if (a.dist < AVOID_DIST) {
      const p = pushOutOfStatics(a.x, a.z, BODY_R);
      let qx = p.x;
      let qz = p.z;
      for (const o of obstacles) if (!o.moving && o.box) [qx, qz] = pushOutOfBox(qx, qz, o);
      if (qx !== a.x || qz !== a.z) {
        a.ox += qx - a.x;
        a.oz += qz - a.z;
        a.x = qx;
        a.z = qz;
      }
    }
    // velocita' vera (avanti + di lato) e sguardo dove si va davvero
    if (dt > 0 && a.len > 0.01) {
      const lvx = (a.ox - pox) / dt;
      const lvz = (a.oz - poz) / dt;
      const vx = _fa.x * fwdV + lvx;
      const vz = _fa.z * fwdV + lvz;
      const sp = Math.hypot(vx, vz);
      if (sp > fwdV + 0.05 && a.fear <= 0) {
        a.gait = (a.gait + (dt * (sp - fwdV)) / ((WALK_BASE_SPEED[a.walkClip] ?? 0.75) * CROWD_GAIT_CYCLE_S)) % 1;
      }
      a.curSpeed = Math.min(sp, Math.max(fwdV, 1.6));
      const want = sp > 0.15 ? Math.atan2(vx, vz) : Math.atan2(_fa.x, _fa.z);
      let dy = want - a.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const maxTurn = YAW_RATE * dt;
      a.yaw += Math.abs(dy) <= maxTurn ? dy : Math.sign(dy) * maxTurn;
    }
    // la quota solo per chi si vede (il terreno costa qualche conto)
    if (a.dist < CROWD_DRAW_DIST) a.y = getTerrainHeight(a.x, a.z) + getRoadOffset(a.x, a.z);
  }
}

// accucciato: solo se troppo vicino allo sparo (evita blocchi innaturali agli angoli)
export function isCowering(a: CrowdAgent): boolean {
  if (a.fear <= 0) return false;
  return Math.hypot(a.x - a.fearX, a.z - a.fearZ) < COWER_DIST;
}

export function crowdPanic(x: number, z: number, radius = PANIC_RADIUS) {
  for (const a of crowdAgents) {
    if (a.gone || Math.hypot(a.x - x, a.z - z) > radius) continue;
    // chi e' gia' spaventato non cambia direzione a ogni sparo
    if (a.fear <= 0) {
      a.fearX = x;
      a.fearZ = z;
    }
    a.fear = PANIC_S;
  }
}

// Chi ha un corpo vero: i piu' vicini entro CROWD_ASSIGN_DIST. Se il pool e'
// pieno e c'e' un agente parecchio piu' vicino dell'assegnato piu' lontano,
// si scambiano.
export function assignCrowdSlots() {
  for (let s = 0; s < crowdSlots.length; s++) {
    const a = crowdSlots[s];
    // i corpi con un agente "andato" (nemico/morto) li libera il corpo stesso
    if (a && !a.gone && !a.pendingHit && a.dist > CROWD_RELEASE_DIST) {
      a.slot = -1;
      crowdSlots[s] = null;
    }
  }
  // prima i colpiti in attesa di un corpo (a qualunque distanza), poi i piu' vicini
  const candidates = crowdAgents
    .filter((a) => !a.gone && a.slot < 0 && (a.pendingHit || a.dist < CROWD_ASSIGN_DIST))
    .sort((a, b) => (a.pendingHit ? 0 : 1) - (b.pendingHit ? 0 : 1) || a.dist - b.dist);
  for (const c of candidates) {
    let free = crowdSlots.indexOf(null);
    if (free < 0) {
      // il piu' lontano tra gli assegnati (non impegnato in qualcosa)
      let worst = -1;
      for (let s = 0; s < crowdSlots.length; s++) {
        const a = crowdSlots[s];
        if (a && !a.gone && !a.pendingHit && (worst < 0 || a.dist > crowdSlots[worst]!.dist)) worst = s;
      }
      if (worst < 0) break;
      if (!c.pendingHit && crowdSlots[worst]!.dist < c.dist + 6) break;
      crowdSlots[worst]!.slot = -1;
      crowdSlots[worst] = null;
      free = worst;
    }
    c.slot = free;
    crowdSlots[free] = c;
  }
}

// rimette l'agente sul suo tratto (dopo essere stato nemico o morto)
export function reviveCrowdAgent(a: CrowdAgent) {
  a.gone = false;
  a.t = Math.random();
  a.pendingHit = null;
  a.activity = 'pause';
  a.idleClip = 'Idle_A';
  a.pause = rand(0.5, 2);
}

// all'inizio una parte della folla e' gia' ferma a fare qualcosa
for (const a of crowdAgents) {
  if (Math.random() < LINGER_START && onSidewalk(a)) {
    a.activity = 'linger';
    a.idleClip = pickLingerClip();
    a.pause = rand(2, LINGER_S[1]);
  } else a.idleClip = 'Idle_A';
}

// "un giorno potrei avere un fucile di precisione e colpire obiettivi
// lontani": le sagome non hanno fisica, ma un colpo da lontano deve poterle
// prendere. Il colpo si prova contro tre capsule verticali per agente
// (gambe, busto, testa: conti da poco, anche per 200 agenti), e chi viene
// preso riceve SUBITO un corpo vero dal pool (al posto di quello piu'
// lontano) con il colpo da applicare: muore e cade come chiunque altro.
export const HIT_SHAPES: Array<{ seg: string; y0: number; y1: number; r: number }> = [
  { seg: 'Thigh_L', y0: 0.1, y1: 0.85, r: 0.17 },
  { seg: 'Torso', y0: 0.95, y1: 1.4, r: 0.21 },
  { seg: 'Head', y0: 1.58, y1: 1.72, r: 0.11 },
];

// raggio contro capsula verticale (x,z) da y0 a y1: distanza lungo il raggio o -1
export function rayVsVerticalCapsule(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cz: number,
  y0: number,
  y1: number,
  r: number
): number {
  // punto del raggio piu' vicino all'asse (in pianta), poi controllo sull'altezza
  const px = ox - cx;
  const pz = oz - cz;
  const a = dx * dx + dz * dz;
  let best = -1;
  if (a > 1e-9) {
    const b = px * dx + pz * dz;
    const c = px * px + pz * pz - r * r;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a;
      const y = oy + dy * t;
      if (t > 0 && y >= y0 && y <= y1) best = t;
    }
  }
  // calotte (sfere agli estremi)
  for (const yc of [y0, y1]) {
    const qx = px;
    const qy = oy - yc;
    const qz = pz;
    const b = qx * dx + qy * dy + qz * dz;
    const c = qx * qx + qy * qy + qz * qz - r * r;
    const disc = b * b - c;
    if (disc < 0) continue;
    const t = -b - Math.sqrt(disc);
    if (t > 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}

export function raycastCrowd(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number
): { agent: CrowdAgent; seg: string; distance: number } | null {
  let hit: { agent: CrowdAgent; seg: string; distance: number } | null = null;
  for (const a of crowdAgents) {
    if (a.gone || a.slot >= 0 || a.dist > CROWD_DRAW_DIST) continue;
    // scarto veloce: l'agente e' vicino alla retta del colpo?
    const rx = a.x - ox;
    const rz = a.z - oz;
    const along = rx * dx + rz * dz;
    if (along < 0 || along > maxDist + 1) continue;
    const ex = rx - dx * along;
    const ez = rz - dz * along;
    if (ex * ex + ez * ez > 1.5) continue;
    for (const sh of HIT_SHAPES) {
      const t = rayVsVerticalCapsule(ox, oy, oz, dx, dy, dz, a.x, a.z, a.y + sh.y0, a.y + sh.y1, sh.r);
      if (t > 0 && t <= maxDist && (!hit || t < hit.distance)) hit = { agent: a, seg: sh.seg, distance: t };
    }
  }
  return hit;
}

// l'agente colpito da sagoma prende subito un corpo vero (vedi CrowdPedestrian)
export function promoteCrowdAgent(a: CrowdAgent, hit: CrowdPendingHit) {
  a.pendingHit = hit;
  if (a.slot >= 0) return;
  let free = crowdSlots.indexOf(null);
  if (free < 0) {
    // il corpo assegnato piu' lontano (non uno gia' impegnato: nemico o morto)
    let worst = -1;
    for (let s = 0; s < crowdSlots.length; s++) {
      const b = crowdSlots[s];
      if (b && !b.gone && !b.pendingHit && (worst < 0 || b.dist > crowdSlots[worst]!.dist)) worst = s;
    }
    if (worst < 0) return; // tutti impegnati: il colpo aspetta il primo corpo libero (assignCrowdSlots)
    crowdSlots[worst]!.slot = -1;
    free = worst;
  }
  a.slot = free;
  crowdSlots[free] = a;
}

// righe dell'ispettore NPC per un agente della folla (corpo vero o sagoma)
export function describeCrowdAgent(a: CrowdAgent): [string, string][] {
  const what = a.gone
    ? 'gestito dal suo corpo (nemico o morto)'
    : a.fear > 0
      ? isCowering(a)
        ? `panico: accucciato (${a.fear.toFixed(1)} s)`
        : `panico: scappa a ${PANIC_SPEED} m/s (${a.fear.toFixed(1)} s)`
      : a.pause > 0
        ? `fermo (${a.pause.toFixed(1)} s)`
        : `cammina a ${a.speed.toFixed(2)} m/s`;
  return [
    ['agente', `#${a.id}${a.slot >= 0 ? ` (corpo vero ${a.slot})` : ' (sagoma)'}`],
    ['comportamento', what],
    ['clip di camminata', a.walkClip],
    ['clip da fermo', a.idleClip],
    ['tratto', `${(a.t * 100).toFixed(0)}% di ${a.len.toFixed(1)} m, verso ${a.dir > 0 ? 'avanti' : 'indietro'}`],
    ['rallentato da', a.blockedBy || '-'],
    [
      'di lato',
      Number.isFinite(a.steer) && Math.abs(a.steer - (a.lane + a.avoid)) > 0.05
        ? `${a.steer.toFixed(2)} m (aggira un ostacolo)`
        : 'corsia normale',
    ],
  ];
}

if (import.meta.env.DEV) (window as any).__promoteCrowdAgent = promoteCrowdAgent;
