// Labirinto del laboratorio personaggi: una griglia N x N di celle da CELL metri, divisa in fasce di BAND_W colonne
// su piu' LIVELLI (BAND_LEVELS: al centro il piano terra con la piazza aperta PLAZA x PLAZA, verso i lati fasce piu'
// alte di LEVEL_STEP m ciascuna, su blocchi pieni). Ogni fascia e' un labirinto "perfetto" per conto suo (con qualche
// muro in meno per fare anelli); le fasce vicine si collegano con scale larghe come una cella (due celle di rampa,
// STAIRS_PER_BOUNDARY per confine), sempre lungo x. Il muro tra due fasce e' la parete del blocco (non si scavalca);
// i muri dentro una fascia si scavalcano. Deterministico (seme fisso).

export const MAZE_CELL = 4; // m
export const MAZE_PLAZA = 3; // celle per lato
export const WALL_T = 0.4; // spessore, m
export const WALL_H = 2.2; // altezza, m (si scavalca: ci si tira su con le mani, vedi traversal.ts)
export const BAND_W = 5; // colonne per fascia
export const BAND_LEVELS = [2, 1, 0, 1, 2]; // livello di ogni fascia (0 = terra)
export const LEVEL_STEP = 2.8; // m per livello (sotto i 2.93 m: ci si arrampica anche dalla parete del blocco)
export const MAZE_N = BAND_W * BAND_LEVELS.length;
const STAIRS_PER_BOUNDARY = 2;
const STAIR_STEPS = 15;

export interface WallRect {
  // centro e dimensioni sul piano (x, z) rispetto al centro del labirinto
  x: number;
  z: number;
  w: number; // lungo x
  d: number; // lungo z
  y0: number; // quota della base (m sopra il piano terra)
  h: number; // altezza
  vault: boolean; // si scavalca (muro dentro una fascia, non la parete di un blocco ne' di una scala)
}

// una scala: rampa lungo x da (xa, ya) a (xb, yb), larga come la cella della riga z
export interface Stair {
  xa: number;
  xb: number;
  ya: number;
  yb: number;
  z: number;
  width: number;
  steps: number;
  cells: Array<[number, number]>;
}

// direzioni di una cella: 0 = +x, 1 = -x, 2 = +z, 3 = -z
export const DIRS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// una scala a pioli sulla parete di un blocco: piano dei pioli (x, z), normale verso chi sale, da bottomY a topY
export interface MazeLadder {
  x: number;
  z: number;
  nx: number;
  nz: number;
  bottomY: number;
  topY: number;
  halfWidth: number;
}

export interface Maze {
  walls: WallRect[];
  // si passa dalla cella (cx, cz) alla vicina nella direzione dir? (fuori dalla griglia: solo dall'uscita)
  isOpen: (cx: number, cz: number, dir: number) => boolean;
  // cella di un punto (rispetto al centro del labirinto) e centro di una cella
  cellOf: (x: number, z: number) => { cx: number; cz: number };
  cellCenter: (cx: number, cz: number) => { x: number; z: number };
  // l'uscita: un varco nel muro esterno
  exit: { cx: number; cz: number; dir: number; x: number; z: number };
  // centri delle celle (rispetto al centro) fuori dalla piazza: dove si puo' comparire
  corridorCells: Array<{ x: number; z: number }>;
  // mezzo lato della piazza (m): dentro, spazio libero
  plazaHalf: number;
  // mezzo lato del labirinto (m)
  half: number;
  // livelli
  stairs: Stair[];
  ladders: MazeLadder[];
  slabs: Array<{ x: number; z: number; w: number; d: number; h: number }>;
  isStairCell: (cx: number, cz: number) => boolean;
  // quota del pavimento in un punto (rispetto al centro del labirinto; sulle rampe interpola)
  heightAt: (x: number, z: number) => number;
  // il muro tra la cella e la vicina nella direzione dir si scavalca?
  canVault: (cx: number, cz: number, dir: number) => boolean;
}

const rng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const levelOfCol = (x: number) => BAND_LEVELS[Math.floor(x / BAND_W)] * LEVEL_STEP;

export function buildMaze(seed = 7): Maze {
  for (let attempt = 0; attempt < 40; attempt++) {
    const m = tryBuild(seed + attempt * 7919);
    if (m) return m;
  }
  throw new Error('labirinto: non riesco a collegare tutte le celle');
}

function tryBuild(seed: number): Maze | null {
  const N = MAZE_N;
  const rnd = rng(seed);
  // vw[x][z]: muro verticale a sinistra della cella (x, z) (x = 0..N); hw[x][z]: muro orizzontale sopra la cella (z = 0..N)
  const vw = Array.from({ length: N + 1 }, () => new Array(N).fill(true));
  const hw = Array.from({ length: N }, () => new Array(N + 1).fill(true));
  const p0 = Math.floor((N - MAZE_PLAZA) / 2);
  const p1 = p0 + MAZE_PLAZA - 1;
  const inPlaza = (x: number, z: number) => x >= p0 && x <= p1 && z >= p0 && z <= p1;
  const half = (N * MAZE_CELL) / 2;
  const cx = (x: number) => (x + 0.5) * MAZE_CELL - half;
  const bandOf = (x: number) => Math.floor(x / BAND_W);

  // piazza: via i muri tra le sue celle
  for (let x = p0; x <= p1; x++)
    for (let z = p0; z <= p1; z++) {
      if (x > p0) vw[x][z] = false;
      if (z > p0) hw[x][z] = false;
    }

  // scale: per ogni confine tra due fasce, STAIRS_PER_BOUNDARY rampe nelle ultime due celle della fascia piu' bassa
  const stairs: Stair[] = [];
  const stairCell = new Set<number>();
  const key = (x: number, z: number) => x * N + z;
  const center = bandOf(p0);
  const upperLinks: Array<{ x: number; z: number; dir: number; c2dir: number }> = [];
  for (let k = 0; k < BAND_LEVELS.length - 1; k++) {
    const lb = BAND_LEVELS[k] < BAND_LEVELS[k + 1] ? k : k + 1;
    const dirX = lb === k ? 1 : -1; // da che parte sta la fascia alta
    const c1 = dirX > 0 ? (lb + 1) * BAND_W - 1 : lb * BAND_W;
    const c2 = c1 - dirX;
    const ya = levelOfCol(c1);
    const yb = levelOfCol(c1 + dirX);
    const used: number[] = [];
    for (let n = 0; n < STAIRS_PER_BOUNDARY; n++) {
      // una riga per meta' del labirinto, mai nella piazza (e un margine) se la fascia e' quella centrale
      let z = 0;
      for (let tries = 0; tries < 50; tries++) {
        const lo = n === 0 ? 1 : Math.floor(N / 2) + 1;
        const hi = n === 0 ? Math.floor(N / 2) - 1 : N - 2;
        z = lo + Math.floor(rnd() * (hi - lo + 1));
        if (lb === center && z >= p0 - 1 && z <= p1 + 1) continue;
        if (used.every((u) => Math.abs(u - z) > 2)) break;
      }
      used.push(z);
      stairCell.add(key(c1, z));
      stairCell.add(key(c2, z));
      stairs.push({
        xa: dirX > 0 ? c2 * MAZE_CELL - half : (c2 + 1) * MAZE_CELL - half,
        xb: dirX > 0 ? (c1 + 1) * MAZE_CELL - half : c1 * MAZE_CELL - half,
        ya,
        yb,
        z: cx(z),
        width: MAZE_CELL,
        steps: STAIR_STEPS,
        cells: [[c2, z], [c1, z]],
      });
      upperLinks.push({ x: c1, z, dir: dirX > 0 ? 0 : 1, c2dir: dirX > 0 ? 1 : 0 });
    }
  }
  const isStairCell = (x: number, z: number) => stairCell.has(key(x, z));

  // scale a pioli: una per confine, sulla parete del blocco, a una riga lontana dalle scale
  const ladders: MazeLadder[] = [];
  const ladderLines = new Set<number>(); // linea verticale x * N + z dove la parete del blocco e' a filo con la cima
  for (let k = 0; k < BAND_LEVELS.length - 1; k++) {
    const lb = BAND_LEVELS[k] < BAND_LEVELS[k + 1] ? k : k + 1;
    const dirX = lb === k ? 1 : -1;
    const c1 = dirX > 0 ? (lb + 1) * BAND_W - 1 : lb * BAND_W;
    for (let tries = 0; tries < 80; tries++) {
      const z = 1 + Math.floor(rnd() * (N - 2));
      if (isStairCell(c1, z) || stairs.some((st) => Math.abs(st.z - cx(z)) < MAZE_CELL * 3 && st.cells.some(([a]) => a === c1))) continue;
      if (inPlaza(c1, z) || inPlaza(c1 + dirX, z)) continue;
      const line = (dirX > 0 ? c1 + 1 : c1) * MAZE_CELL - half;
      ladders.push({
        x: line - dirX * (WALL_T / 2 + 0.06),
        z: cx(z),
        nx: -dirX,
        nz: 0,
        bottomY: levelOfCol(c1),
        topY: levelOfCol(c1 + dirX),
        halfWidth: 0.3,
      });
      ladderLines.add((dirX > 0 ? c1 + 1 : c1) * N + z);
      break;
    }
  }

  const dirs: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const open = (x: number, z: number, dx: number, dz: number) => {
    if (dx === 1) vw[x + 1][z] = false;
    else if (dx === -1) vw[x][z] = false;
    else if (dz === 1) hw[x][z + 1] = false;
    else hw[x][z] = false;
  };

  // labirinto di ogni fascia (percorso a profondita', "recursive backtracker"); piazza e celle delle scale restano fuori
  const seen = Array.from({ length: N }, (_, x) => Array.from({ length: N }, (_, z) => inPlaza(x, z) || isStairCell(x, z)));
  for (let b = 0; b < BAND_LEVELS.length; b++) {
    let start: [number, number] | null = null;
    for (let z = 0; z < N && !start; z++) for (let x = b * BAND_W; x < (b + 1) * BAND_W && !start; x++) if (!seen[x][z]) start = [x, z];
    if (!start) continue;
    const stack: Array<[number, number]> = [start];
    seen[start[0]][start[1]] = true;
    while (stack.length) {
      const [x, z] = stack[stack.length - 1];
      const next = dirs
        .map(([dx, dz]) => [x + dx, z + dz, dx, dz] as const)
        .filter(([nx, nz]) => nx >= 0 && nz >= 0 && nx < N && nz < N && bandOf(nx) === b && !seen[nx][nz]);
      if (!next.length) {
        stack.pop();
        continue;
      }
      const [nx, nz, dx, dz] = next[Math.floor(rnd() * next.length)];
      open(x, z, dx, dz);
      seen[nx][nz] = true;
      stack.push([nx, nz]);
    }
  }

  // le scale: dalla cella interna della fascia bassa alla rampa e da li' alla fascia alta
  for (const u of upperLinks) {
    const [dx] = dirs[u.dir];
    open(u.x, u.z, dx, 0); // c1 -> fascia alta
    open(u.x, u.z, -dx, 0); // c1 <-> c2
    open(u.x - dx, u.z, -dx, 0); // c2 <-> cella interna
  }

  // qualche anello: toglie ~8% dei muri interni a una fascia (non quelli della piazza, delle scale, dei confini)
  const plain = (x: number, z: number) => !inPlaza(x, z) && !isStairCell(x, z);
  for (let x = 1; x < N; x++)
    for (let z = 0; z < N; z++)
      if (vw[x][z] && bandOf(x) === bandOf(x - 1) && plain(x, z) && plain(x - 1, z) && rnd() < 0.08) vw[x][z] = false;
  for (let x = 0; x < N; x++)
    for (let z = 1; z < N; z++) if (hw[x][z] && plain(x, z) && plain(x, z - 1) && rnd() < 0.08) hw[x][z] = false;

  // un ingresso nel mezzo di ogni lato della piazza
  const mid = p0 + Math.floor(MAZE_PLAZA / 2);
  vw[p0][mid] = false; // lato ovest
  vw[p1 + 1][mid] = false; // lato est
  hw[mid][p0] = false; // lato nord
  hw[mid][p1 + 1] = false; // lato sud

  // l'uscita: un varco nel muro esterno (nord o sud) della fascia centrale, a terra
  const north = rnd() < 0.5;
  const exitCx = center * BAND_W + Math.floor(rnd() * BAND_W);
  let exitCz: number;
  let exitDir: number;
  if (north) {
    exitCz = N - 1;
    exitDir = 2;
    hw[exitCx][N] = false;
  } else {
    exitCz = 0;
    exitDir = 3;
    hw[exitCx][0] = false;
  }

  const isOpen = (x: number, z: number, dir: number) => {
    if (dir === 0) return !vw[x + 1][z];
    if (dir === 1) return !vw[x][z];
    if (dir === 2) return !hw[x][z + 1];
    return !hw[x][z];
  };

  // tutte le celle raggiungibili dalla piazza?
  {
    const vis = new Uint8Array(N * N);
    const q = [key(mid, mid)];
    vis[q[0]] = 1;
    for (let h = 0; h < q.length; h++) {
      const x = Math.floor(q[h] / N);
      const z = q[h] % N;
      for (let d = 0; d < 4; d++) {
        const nx = x + dirs[d][0];
        const nz = z + dirs[d][1];
        if (nx < 0 || nz < 0 || nx >= N || nz >= N || !isOpen(x, z, d) || vis[key(nx, nz)]) continue;
        vis[key(nx, nz)] = 1;
        q.push(key(nx, nz));
      }
    }
    if (q.length < N * N) return null;
  }

  const canVault = (x: number, z: number, d: number) => {
    const nx = x + dirs[d][0];
    const nz = z + dirs[d][1];
    if (nx < 0 || nz < 0 || nx >= N || nz >= N) return false;
    return !isOpen(x, z, d) && bandOf(x) === bandOf(nx) && !isStairCell(x, z) && !isStairCell(nx, nz);
  };

  // i muri: la base sta al livello della fascia (sulla parete tra due fasce a terra, alta fino al livello piu' alto + WALL_H;
  // ai lati di una scala alta quanto la rampa piu' WALL_H)
  const walls: WallRect[] = [];
  const stairAt = (x: number, z: number) => stairs.find((s) => s.cells.some(([a, b]) => a === x && b === z));
  for (let x = 0; x <= N; x++)
    for (let z = 0; z < N; z++) {
      if (!vw[x][z]) continue;
      const l1 = x > 0 ? levelOfCol(x - 1) : levelOfCol(0);
      const l2 = x < N ? levelOfCol(x) : levelOfCol(N - 1);
      const boundary = l1 !== l2;
      walls.push({
        x: x * MAZE_CELL - half,
        z: cx(z),
        w: WALL_T,
        d: MAZE_CELL + WALL_T,
        y0: boundary ? 0 : l1,
        // dove c'e' una scala a pioli la parete arriva a filo con la cima del blocco
        h: boundary ? (ladderLines.has(x * N + z) ? Math.max(l1, l2) : Math.max(l1, l2) + WALL_H) : WALL_H,
        vault: !boundary && x > 0 && x < N && canVault(x - 1, z, 0),
      });
    }
  for (let x = 0; x < N; x++)
    for (let z = 0; z <= N; z++) {
      if (!hw[x][z]) continue;
      const lv = levelOfCol(x);
      const st = (z > 0 && stairAt(x, z - 1)) || (z < N && stairAt(x, z)) || null;
      walls.push({
        x: cx(x),
        z: z * MAZE_CELL - half,
        w: MAZE_CELL + WALL_T,
        d: WALL_T,
        y0: st ? Math.min(st.ya, st.yb) : lv,
        h: st ? Math.abs(st.yb - st.ya) + WALL_H : WALL_H,
        vault: z > 0 && z < N && canVault(x, z - 1, 2),
      });
    }

  // blocchi pieni sotto le fasce alte
  const slabs: Maze['slabs'] = [];
  for (let b = 0; b < BAND_LEVELS.length; b++) {
    if (BAND_LEVELS[b] === 0) continue;
    slabs.push({ x: (b + 0.5) * BAND_W * MAZE_CELL - half, z: 0, w: BAND_W * MAZE_CELL, d: N * MAZE_CELL, h: BAND_LEVELS[b] * LEVEL_STEP });
  }

  const heightAt = (x: number, z: number) => {
    const cxI = Math.floor((x + half) / MAZE_CELL);
    const czI = Math.floor((z + half) / MAZE_CELL);
    if (cxI < 0 || cxI >= N || czI < 0 || czI >= N) return 0;
    for (const s of stairs) {
      if (Math.abs(z - s.z) > MAZE_CELL / 2) continue;
      const t = (x - s.xa) / (s.xb - s.xa);
      if (t >= 0 && t <= 1) return s.ya + (s.yb - s.ya) * t;
    }
    return levelOfCol(cxI);
  };

  const corridorCells: Maze['corridorCells'] = [];
  // dove si puo' comparire: la fascia centrale (a terra), fuori dalla piazza e dalle scale
  for (let x = center * BAND_W; x < (center + 1) * BAND_W; x++)
    for (let z = 0; z < N; z++) if (plain(x, z)) corridorCells.push({ x: cx(x), z: cx(z) });

  const cellOf = (x: number, z: number) => ({ cx: Math.floor((x + half) / MAZE_CELL), cz: Math.floor((z + half) / MAZE_CELL) });
  const exitCenter = { x: cx(exitCx), z: cx(exitCz) };
  const exit = { cx: exitCx, cz: exitCz, dir: exitDir, x: exitCenter.x + DIRS[exitDir][0] * MAZE_CELL, z: exitCenter.z + DIRS[exitDir][1] * MAZE_CELL };
  return {
    walls,
    isOpen,
    cellOf,
    cellCenter: (a, b) => ({ x: cx(a), z: cx(b) }),
    exit,
    corridorCells,
    plazaHalf: (MAZE_PLAZA * MAZE_CELL) / 2,
    half,
    stairs,
    ladders,
    slabs,
    isStairCell,
    heightAt,
    canVault,
  };
}
