import type { FighterData } from '../components/Environment/SquadArenaTypes';
import type { AutoGait } from '../lib/playerAutopilot';
import { newPathState, steerTo, type PathState, type Steer } from '../components/city/brains/pathFollow';
import type { NavGrid } from '../lib/nav';
import { DIRS, MAZE_CELL, MAZE_N, WALL_T, type Maze } from './maze';
import { VAULT_COST, wallBetween } from './vault';
import type { NavLink } from '../lib/nav';
import { findCover, liveShooters, type Cover } from '../components/city/brains/cover';

// Pilota automatico del giocatore del laboratorio: deve uscire dal labirinto
// senza sapere dov'e' l'uscita. Esplora (cella per cella, la piu' vicina non
// ancora visitata raggiungibile da quelle che conosce), e intanto si guarda
// intorno: se un nemico lo ha addosso combatte, se e' ferito troppo o sono in
// troppi scappa verso la cella che raggiunge prima di loro.

// i pugni li da' il giocatore vero (animazione e contatto): qui si decide solo quando partire
const PUNCH_RANGE = 1.0; // m: da qui in poi si ferma e picchia (il braccio arriva a ~1 m, i corpi non si compenetrano)
const PUNCH_CD = 0.65;
const SEE_DIST = 22; // m: li vede (linea libera), come loro
const HEAR_DIST = 7; // m: li sente anche dietro un muro, come loro

export type AutoMode = 'esplora' | 'combatte' | 'scappa' | 'uscito' | 'sconfitto';

export interface AutoStatus {
  mode: AutoMode;
  visited: number;
  total: number;
  exitKnown: boolean;
  threats: number;
}

export interface AutoCmd {
  // direzione in cui camminare (versore, 0,0 = fermo) e andatura
  x: number;
  z: number;
  gait: AutoGait;
  // si gira verso il nemico piu' vicino
  lockOn: boolean;
  // un pugno adesso
  attack: boolean;
  // un salto adesso (per scavalcare)
  jump: boolean;
}

const idx = (cx: number, cz: number) => cz * MAZE_N + cx;
const inGrid = (cx: number, cz: number) => cx >= 0 && cz >= 0 && cx < MAZE_N && cz < MAZE_N;

export class Autopilot {
  visited = new Set<number>();
  exitKnown = false;
  mode: AutoMode = 'esplora';
  threats = 0;
  private path: PathState = newPathState();
  private latch = 0; // secondi in cui resta nella decisione presa (scappa/combatte)
  private punchCd = 0;
  private calmT = 0;
  private fleeGoal: { x: number; z: number } | null = null;
  private fleeT = 0;
  // la cella che sta andando a visitare: ci resta finche' non l'ha raggiunta (altrimenti due celle
  // a pari distanza lo fanno ondeggiare avanti e indietro)
  private goalCell = -1;
  // sta scavalcando: va dritto verso il muro, salta quando e' a portata, poi giu' dall'altra parte
  private vault: NavLink | null = null;
  private vaultT = 0;
  vaultLog: string[] = []; // esito degli scavalchi (prove)
  private jumpCd = 0;
  // dietro un muro da un tiratore armato: ci resta un po' e poi riparte
  private cover: Cover | null = null;
  private coverHold = 0;
  private coverCd = 0;
  coverLog = 0; // quante coperture ha preso (prove)

  constructor(
    private maze: Maze,
    private nav: NavGrid,
    // centro del labirinto nel mondo
    private ox: number,
    private oz: number
  ) {}

  get vaulting() {
    return !!this.vault;
  }

  get calm() {
    return this.calmT > 3;
  }

  status(): AutoStatus {
    return { mode: this.mode, visited: this.visited.size, total: MAZE_N * MAZE_N, exitKnown: this.exitKnown, threats: this.threats };
  }

  // distanze (in celle) da una cella lungo i passaggi aperti; con `vault` anche scavalcando i muri interni
  // (a quel costo, in celle)
  private bfs(cx: number, cz: number, avoid?: number, vault = 0): Float32Array {
    const dist = new Float32Array(MAZE_N * MAZE_N).fill(-1);
    const q: number[] = [idx(cx, cz)];
    dist[q[0]] = 0;
    for (let h = 0; h < q.length; h++) {
      const cur = q[h];
      const x = cur % MAZE_N;
      const z = Math.floor(cur / MAZE_N);
      for (let d = 0; d < 4; d++) {
        const open = this.maze.isOpen(x, z, d);
        if (!open && !(vault > 0 && wallBetween(this.maze, x, z, d))) continue;
        const nx = x + DIRS[d][0];
        const nz = z + DIRS[d][1];
        if (!inGrid(nx, nz) || idx(nx, nz) === avoid) continue;
        const nd = dist[cur] + (open ? 1 : vault);
        if (dist[idx(nx, nz)] >= 0 && dist[idx(nx, nz)] <= nd) continue;
        dist[idx(nx, nz)] = nd;
        q.push(idx(nx, nz));
      }
    }
    return dist;
  }

  // un passo del percorso ha detto "scavalca qui": dai comandi fino a esserne oltre
  private startVault(st: Steer) {
    if (st.vault) {
      this.vault = st.vault;
      this.vaultT = 3;
      this.jumpCd = 0;
    }
    return !!st.vault;
  }

  private stepVault(dt: number, px: number, pz: number, cmd: AutoCmd): AutoCmd {
    const l = this.vault!;
    this.vaultT -= dt;
    this.jumpCd -= dt;
    const len = Math.hypot(l.bx - l.ax, l.bz - l.az) || 1;
    const ux = (l.bx - l.ax) / len;
    const uz = (l.bz - l.az) / len;
    // distanza dalla faccia del muro (negativa: oltre l'asse del muro) lungo la direzione del salto
    const along = (px - (l.ax + l.bx) / 2) * ux + (pz - (l.az + l.bz) / 2) * uz;
    const faceDist = -along - WALL_T / 2;
    cmd.x = ux;
    cmd.z = uz;
    cmd.gait = 'sprint';
    // salta quando il muro e' alla portata delle mani (la sonda del giocatore guarda a 0.9 m)
    if (faceDist < 0.8 && faceDist > 0.05 && this.jumpCd <= 0) {
      cmd.jump = true;
      this.jumpCd = 0.7;
    }
    // atterrato dall'altra parte (o il tempo e' scaduto): si ripianifica
    if (along > 0.9 || this.vaultT <= 0) {
      this.vaultLog.push(along > 0.9 ? 'ok' : 'scaduto');
      this.vault = null;
      this.path.pts = [];
      this.path.replanT = 0;
    }
    return cmd;
  }

  // la cella non visitata piu' vicina che si raggiunge da una visitata, o l'uscita se la conosce
  private exploreGoal(cx: number, cz: number): { x: number; z: number } | null {
    if (this.exitKnown) return { x: this.maze.exit.x + this.ox, z: this.maze.exit.z + this.oz };
    if (this.goalCell >= 0 && !this.visited.has(this.goalCell)) {
      const c = this.maze.cellCenter(this.goalCell % MAZE_N, Math.floor(this.goalCell / MAZE_N));
      return { x: c.x + this.ox, z: c.z + this.oz };
    }
    const dist = this.bfs(cx, cz);
    let best = -1;
    let bestD = 1e9;
    for (const v of this.visited) {
      if (dist[v] < 0) continue;
      const x = v % MAZE_N;
      const z = Math.floor(v / MAZE_N);
      for (let d = 0; d < 4; d++) {
        if (!this.maze.isOpen(x, z, d)) continue;
        const nx = x + DIRS[d][0];
        const nz = z + DIRS[d][1];
        if (!inGrid(nx, nz) || this.visited.has(idx(nx, nz))) continue;
        const dd = dist[v] + 1;
        if (dd < bestD) {
          bestD = dd;
          best = idx(nx, nz);
        }
      }
    }
    this.goalCell = best;
    if (best < 0) return null;
    const c = this.maze.cellCenter(best % MAZE_N, Math.floor(best / MAZE_N));
    return { x: c.x + this.ox, z: c.z + this.oz };
  }

  // la cella dove arriva prima lui che il nemico, la piu' lontana da lui
  private fleeTarget(cx: number, cz: number, tcx: number, tcz: number): { x: number; z: number } | null {
    // chi insegue scavalca come lui: le distanze contano i muri superabili
    const vc = VAULT_COST / MAZE_CELL;
    const dP = this.bfs(cx, cz, idx(tcx, tcz), vc);
    const dT = this.bfs(tcx, tcz, undefined, vc);
    let best = -1;
    let bestScore = 0.5;
    for (let i = 0; i < dP.length; i++) {
      if (dP[i] < 0 || dP[i] > 14 || dT[i] < 0) continue;
      const score = dT[i] - dP[i];
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) return null;
    const c = this.maze.cellCenter(best % MAZE_N, Math.floor(best / MAZE_N));
    return { x: c.x + this.ox, z: c.z + this.oz };
  }

  step(dt: number, px: number, pz: number, healthPct: number, enemies: FighterData[]): AutoCmd {
    const cmd: AutoCmd = { x: 0, z: 0, gait: 'jog', lockOn: false, attack: false, jump: false };
    if (this.mode === 'uscito' || this.mode === 'sconfitto') return cmd;
    if (healthPct <= 0) {
      this.mode = 'sconfitto';
      return cmd;
    }
    const half = this.maze.half;
    if (Math.abs(px - this.ox) > half + 0.8 || Math.abs(pz - this.oz) > half + 0.8) {
      this.mode = 'uscito';
      return cmd;
    }

    // dove sono: segno la cella e imparo i suoi passaggi (compreso un varco verso l'esterno)
    const { cx, cz } = this.maze.cellOf(px - this.ox, pz - this.oz);
    if (inGrid(cx, cz)) {
      this.visited.add(idx(cx, cz));
      for (let d = 0; d < 4; d++) {
        if (this.maze.isOpen(cx, cz, d) && !inGrid(cx + DIRS[d][0], cz + DIRS[d][1])) this.exitKnown = true;
      }
    }

    if (this.vault) return this.stepVault(dt, px, pz, cmd);

    // minacce: nemici vivi che vede o sente
    const near: Array<{ e: FighterData; d: number }> = [];
    for (const e of enemies) {
      if (e.isDead || e.team !== 'CITY_ENEMY') continue;
      const d = Math.hypot(e.position.x - px, e.position.z - pz);
      if (d > SEE_DIST) continue;
      if (d < HEAR_DIST || this.nav.lineOfSight(px, pz, e.position.x, e.position.z)) near.push({ e, d });
    }
    near.sort((a, b) => a.d - b.d);
    this.threats = near.length;
    this.latch -= dt;
    this.punchCd -= dt;

    // tranquillo da qualche secondo? (il laboratorio gli fa riprendere fiato)
    this.calmT = near.length ? 0 : this.calmT + dt;


    // coperture: un armato che lo vede (e non e' a portata di pugno di nessuno) -> va dietro il muro piu' vicino che
    // lo nasconde, ci resta qualche secondo, poi riparte
    this.coverCd -= dt;
    const closeFoe = near.length && near[0].d < 2.5;
    if (!closeFoe) {
      if (!this.cover && this.coverCd <= 0) {
        let sh: { x: number; z: number } | null = null;
        let shD = SEE_DIST;
        for (const s of liveShooters()) {
          const d = Math.hypot(s.x - px, s.z - pz);
          if (d < shD && this.nav.lineOfSight(px, pz, s.x, s.z)) {
            sh = s;
            shD = d;
          }
        }
        if (sh) {
          const c = findCover(this.nav, px, pz, sh.x, sh.z);
          if (c) {
            this.cover = c;
            this.coverHold = 2.5 + Math.random() * 1.5;
            this.coverLog++;
          } else this.coverCd = 1.5;
        }
      }
      if (this.cover) {
        const c = this.cover;
        const d = Math.hypot(c.hx - px, c.hz - pz);
        this.mode = 'scappa';
        if (d > 0.35) {
          const st = steerTo(this.path, this.nav, px, pz, c.hx, c.hz, dt);
          cmd.x = st.dx;
          cmd.z = st.dz;
          cmd.gait = 'sprint';
          this.coverHold -= dt * 0.3;
        } else {
          this.coverHold -= dt;
        }
        if (this.coverHold <= 0) {
          this.cover = null;
          this.coverCd = 2;
        }
        return cmd;
      }
    } else this.cover = null;

    if (near.length) {
      // contro i corpi veri un pugno a mani nude non basta (chi lo prende finisce a terra e il suo colpo salta):
      // scappa sempre (e' piu' veloce), e combatte solo se e' in trappola
      const wantFlee = true;
      const n0 = near[0];
      if (wantFlee && n0.d > PUNCH_RANGE * 0.8) {
        const t = this.maze.cellOf(n0.e.position.x - this.ox, n0.e.position.z - this.oz);
        this.fleeT -= dt;
        if (this.fleeT <= 0 || !this.fleeGoal) {
          this.fleeGoal = inGrid(cx, cz) && inGrid(t.cx, t.cz) ? this.fleeTarget(cx, cz, t.cx, t.cz) : null;
          this.fleeT = 0.6;
        }
        if (this.fleeGoal) {
          this.mode = 'scappa';
          const st = steerTo(this.path, this.nav, px, pz, this.fleeGoal.x, this.fleeGoal.z, dt);
          if (this.startVault(st)) return this.stepVault(dt, px, pz, cmd);
          cmd.x = st.dx;
          cmd.z = st.dz;
          cmd.gait = 'sprint';
          return cmd;
        }
        // in trappola: combatte
      }
      // combatte: va a colpire il piu' vicino
      this.mode = 'combatte';
      this.fleeGoal = null;
      cmd.lockOn = true;
      if (n0.d > PUNCH_RANGE) {
        const st = steerTo(this.path, this.nav, px, pz, n0.e.position.x, n0.e.position.z, dt);
        if (this.startVault(st)) return this.stepVault(dt, px, pz, cmd);
        cmd.x = st.dx;
        cmd.z = st.dz;
        cmd.gait = 'sprint';
      } else if (this.punchCd <= 0) {
        this.punchCd = PUNCH_CD;
        cmd.attack = true;
      }
      return cmd;
    }

    // nessuno intorno: esplora
    this.mode = 'esplora';
    this.fleeGoal = null;
    const goal = this.exploreGoal(cx, cz);
    if (!goal) return cmd;
    const st = steerTo(this.path, this.nav, px, pz, goal.x, goal.z, dt);
    if (this.startVault(st)) return this.stepVault(dt, px, pz, cmd);
    cmd.x = st.dx;
    cmd.z = st.dz;
    return cmd;
  }
}
