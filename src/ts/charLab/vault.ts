import type { NavLink } from '../lib/nav';
import { DIRS, MAZE_CELL, MAZE_N, WALL_H, WALL_T, type Maze } from './maze';

// Gli scavalchi del labirinto: ogni muro interno si puo' superare, in tutti e due i versi. Il punto di partenza sta
// a 1.3 m dal muro (fuori dall'ingombro per camminare), l'atterraggio altrettanto dall'altra parte; scavalcare
// vale VAULT_COST m di strada (ci si tira su, si passa, si scende: piu' lento che correre).
export const VAULT_COST = 7;
const OFF = 1.3;

// il muro tra la cella (cx, cz) e la vicina nella direzione d, se si scavalca (dentro una fascia, non una scala)
export const wallBetween = (maze: Maze, cx: number, cz: number, d: number) => maze.canVault(cx, cz, d);

export function vaultLinks(maze: Maze, ox: number, oz: number): NavLink[] {
  const out: NavLink[] = [];
  const reach = MAZE_CELL / 2 - OFF; // dal centro cella verso il muro
  for (let cz = 0; cz < MAZE_N; cz++)
    for (let cx = 0; cx < MAZE_N; cx++)
      for (let d = 0; d < 4; d++) {
        if (!wallBetween(maze, cx, cz, d)) continue;
        const a = maze.cellCenter(cx, cz);
        const b = maze.cellCenter(cx + DIRS[d][0], cz + DIRS[d][1]);
        out.push({
          ax: ox + a.x + DIRS[d][0] * reach,
          az: oz + a.z + DIRS[d][1] * reach,
          bx: ox + b.x - DIRS[d][0] * reach,
          bz: oz + b.z - DIRS[d][1] * reach,
          h: WALL_H,
          cost: VAULT_COST,
        });
      }
  return out;
}

export const WALL_HALF_T = WALL_T / 2;
