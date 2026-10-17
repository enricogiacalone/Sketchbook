// Labirinto del laboratorio personaggi: una griglia N x N di celle da CELL
// metri, con una piazza aperta (PLAZA x PLAZA celle) al centro. Il resto e' un
// labirinto "perfetto" (un solo percorso tra due celle) con qualche muro in
// meno (BRAID) per fare anelli, cosi' un inseguitore ha piu' di una strada. La
// piazza ha un ingresso nel mezzo di ogni lato. Deterministico (seme fisso).

export const MAZE_N = 11;
export const MAZE_CELL = 4; // m
export const MAZE_PLAZA = 3; // celle per lato
export const WALL_T = 0.4; // spessore, m
export const WALL_H = 3; // altezza, m

export interface WallRect {
  // centro e dimensioni sul piano (x, z) rispetto al centro del labirinto
  x: number;
  z: number;
  w: number; // lungo x
  d: number; // lungo z
}

// direzioni di una cella: 0 = +x, 1 = -x, 2 = +z, 3 = -z
export const DIRS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

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
}

const rng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export function buildMaze(seed = 7): Maze {
  const N = MAZE_N;
  const rnd = rng(seed);
  // vw[x][z]: muro verticale a sinistra della cella (x, z) (x = 0..N); hw[x][z]: muro orizzontale sopra la cella (z = 0..N)
  const vw = Array.from({ length: N + 1 }, () => new Array(N).fill(true));
  const hw = Array.from({ length: N }, () => new Array(N + 1).fill(true));
  const p0 = Math.floor((N - MAZE_PLAZA) / 2);
  const p1 = p0 + MAZE_PLAZA - 1;
  const inPlaza = (x: number, z: number) => x >= p0 && x <= p1 && z >= p0 && z <= p1;

  // piazza: via i muri tra le sue celle
  for (let x = p0; x <= p1; x++)
    for (let z = p0; z <= p1; z++) {
      if (x > p0) vw[x][z] = false;
      if (z > p0) hw[x][z] = false;
    }

  // labirinto sulle celle fuori dalla piazza (percorso a profondita', "recursive backtracker")
  const seen = Array.from({ length: N }, (_, x) => Array.from({ length: N }, (_, z) => inPlaza(x, z)));
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
  const stack: Array<[number, number]> = [[0, 0]];
  seen[0][0] = true;
  while (stack.length) {
    const [x, z] = stack[stack.length - 1];
    const next = dirs
      .map(([dx, dz]) => [x + dx, z + dz, dx, dz] as const)
      .filter(([nx, nz]) => nx >= 0 && nz >= 0 && nx < N && nz < N && !seen[nx][nz]);
    if (!next.length) {
      stack.pop();
      continue;
    }
    const [nx, nz, dx, dz] = next[Math.floor(rnd() * next.length)];
    open(x, z, dx, dz);
    seen[nx][nz] = true;
    stack.push([nx, nz]);
  }

  // qualche anello: toglie ~8% dei muri interni (non quelli della piazza)
  for (let x = 1; x < N; x++)
    for (let z = 0; z < N; z++) if (vw[x][z] && !(inPlaza(x, z) || inPlaza(x - 1, z)) && rnd() < 0.08) vw[x][z] = false;
  for (let x = 0; x < N; x++)
    for (let z = 1; z < N; z++) if (hw[x][z] && !(inPlaza(x, z) || inPlaza(x, z - 1)) && rnd() < 0.08) hw[x][z] = false;

  // un ingresso nel mezzo di ogni lato della piazza
  const mid = p0 + Math.floor(MAZE_PLAZA / 2);
  vw[p0][mid] = false; // lato ovest
  vw[p1 + 1][mid] = false; // lato est
  hw[mid][p0] = false; // lato nord
  hw[mid][p1 + 1] = false; // lato sud

  // l'uscita: un varco nel muro esterno, scelto a caso lontano dal centro (non in un angolo stretto)
  const sideRoll = Math.floor(rnd() * 4);
  const posRoll = 1 + Math.floor(rnd() * (N - 2));
  let exitCx: number;
  let exitCz: number;
  let exitDir: number;
  if (sideRoll === 0) {
    exitCx = N - 1;
    exitCz = posRoll;
    exitDir = 0;
    vw[N][posRoll] = false;
  } else if (sideRoll === 1) {
    exitCx = 0;
    exitCz = posRoll;
    exitDir = 1;
    vw[0][posRoll] = false;
  } else if (sideRoll === 2) {
    exitCx = posRoll;
    exitCz = N - 1;
    exitDir = 2;
    hw[posRoll][N] = false;
  } else {
    exitCx = posRoll;
    exitCz = 0;
    exitDir = 3;
    hw[posRoll][0] = false;
  }

  const half = (N * MAZE_CELL) / 2;
  const cx = (x: number) => (x + 0.5) * MAZE_CELL - half;
  const isOpen = (x: number, z: number, dir: number) => {
    if (dir === 0) return !vw[x + 1][z];
    if (dir === 1) return !vw[x][z];
    if (dir === 2) return !hw[x][z + 1];
    return !hw[x][z];
  };
  const walls: WallRect[] = [];
  for (let x = 0; x <= N; x++)
    for (let z = 0; z < N; z++)
      if (vw[x][z]) walls.push({ x: x * MAZE_CELL - half, z: cx(z), w: WALL_T, d: MAZE_CELL + WALL_T });
  for (let x = 0; x < N; x++)
    for (let z = 0; z <= N; z++)
      if (hw[x][z]) walls.push({ x: cx(x), z: z * MAZE_CELL - half, w: MAZE_CELL + WALL_T, d: WALL_T });

  const corridorCells: Maze['corridorCells'] = [];
  for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) if (!inPlaza(x, z)) corridorCells.push({ x: cx(x), z: cx(z) });

  const cellOf = (x: number, z: number) => ({ cx: Math.floor((x + half) / MAZE_CELL), cz: Math.floor((z + half) / MAZE_CELL) });
  const exitCenter = { x: cx(exitCx), z: cx(exitCz) };
  const exit = { cx: exitCx, cz: exitCz, dir: exitDir, x: exitCenter.x + DIRS[exitDir][0] * MAZE_CELL, z: exitCenter.z + DIRS[exitDir][1] * MAZE_CELL };
  return { walls, isOpen, cellOf, cellCenter: (a, b) => ({ x: cx(a), z: cx(b) }), exit, corridorCells, plazaHalf: (MAZE_PLAZA * MAZE_CELL) / 2, half };
}
