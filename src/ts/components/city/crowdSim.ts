import { K } from '../../lib/kimodo';
import { getTerrainHeight } from '../Environment/Terrain';
import { getRoadOffset, ROAD_WIDTH, SIDEWALK_WIDTH } from '../Environment/Road';

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
}

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

// Un passo di simulazione per tutti: pochi conti per agente.
export function stepCrowd(dt: number, px: number, pz: number) {
  for (const a of crowdAgents) {
    a.dist = Math.hypot(a.x - px, a.z - pz);
    if (a.gone) continue;
    if (a.fear > 0) {
      a.fear -= dt;
      // verso quale capo del tratto ci si allontana dallo sparo
      const away = (a.x2 - a.x1) * (a.x - a.fearX) + (a.z2 - a.z1) * (a.z - a.fearZ) >= 0 ? 1 : -1;
      a.dir = away;
      a.pause = 0;
      if (!isCowering(a) && a.len > 0.01) {
        a.t = Math.min(1, Math.max(0, a.t + (a.dir * PANIC_SPEED * dt) / a.len));
        a.gait = (a.gait + (dt * PANIC_SPEED) / ((WALK_BASE_SPEED[a.walkClip] ?? 0.75) * CROWD_GAIT_CYCLE_S * 2.5)) % 1;
      }
      if (a.fear <= 0) a.pause = rand(0.5, 1.0); // si riprende un attimo
    } else if (a.pause > 0) {
      a.pause -= dt;
    } else if (a.len > 0.01) {
      a.t += (a.dir * a.speed * dt) / a.len;
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
        a.pause = rand(0.0, 0.2);
      }
      a.gait = (a.gait + (dt * a.speed) / ((WALK_BASE_SPEED[a.walkClip] ?? 0.75) * CROWD_GAIT_CYCLE_S)) % 1;
    }
    const nx = a.x1 + (a.x2 - a.x1) * a.t;
    const nz = a.z1 + (a.z2 - a.z1) * a.t;
    a.x = nx;
    a.z = nz;
    // dove guarda: verso la meta del tratto
    const fx = a.dir >= 0 ? a.x2 - a.x1 : a.x1 - a.x2;
    const fz = a.dir >= 0 ? a.z2 - a.z1 : a.z1 - a.z2;
    if (fx * fx + fz * fz > 1e-6) a.yaw = Math.atan2(fx, fz);
    // la quota solo per chi si vede (il terreno costa qualche conto)
    if (a.dist < CROWD_DRAW_DIST) a.y = getTerrainHeight(nx, nz) + getRoadOffset(nx, nz);
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
    if (a && !a.gone && a.dist > CROWD_RELEASE_DIST) {
      a.slot = -1;
      crowdSlots[s] = null;
    }
  }
  const candidates = crowdAgents.filter((a) => !a.gone && a.slot < 0 && a.dist < CROWD_ASSIGN_DIST).sort((a, b) => a.dist - b.dist);
  for (const c of candidates) {
    let free = crowdSlots.indexOf(null);
    if (free < 0) {
      // il piu' lontano tra gli assegnati (non impegnato in qualcosa)
      let worst = -1;
      for (let s = 0; s < crowdSlots.length; s++) {
        const a = crowdSlots[s];
        if (a && !a.gone && (worst < 0 || a.dist > crowdSlots[worst]!.dist)) worst = s;
      }
      if (worst < 0 || crowdSlots[worst]!.dist < c.dist + 6) break;
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
  a.pause = rand(0.5, 2);
}
