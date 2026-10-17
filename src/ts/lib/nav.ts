// Navigazione su griglia: ostacoli rettangolari (gia' ingranditi del raggio di
// chi cammina), percorso A* a 8 direzioni senza tagliare gli angoli, percorso
// accorciato (string pulling) e linea di vista. Pensata per essere usata da
// qualunque comportamento (brains/*): chi non trova una griglia registrata
// (`setNav`) continua ad andare dritto, come prima.

export interface NavRect {
  // centro e dimensioni nel mondo (x, z)
  x: number;
  z: number;
  w: number;
  d: number;
}
export interface NavPoint {
  x: number;
  z: number;
}

const SQRT2 = Math.SQRT2;

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  // `blocked`: per camminare (muri ingranditi del raggio di chi cammina);
  // `solid`: i muri veri (ingranditi appena), per la linea di vista
  private blocked: Uint8Array;
  private solid: Uint8Array;

  constructor(
    readonly minX: number,
    readonly minZ: number,
    maxX: number,
    maxZ: number,
    readonly cell: number,
    rects: NavRect[],
    inflate: number
  ) {
    this.cols = Math.ceil((maxX - minX) / cell);
    this.rows = Math.ceil((maxZ - minZ) / cell);
    this.blocked = new Uint8Array(this.cols * this.rows);
    this.solid = new Uint8Array(this.cols * this.rows);
    const mark = (arr: Uint8Array, r: NavRect, grow: number) => {
      const x0 = Math.max(0, Math.floor((r.x - r.w / 2 - grow - minX) / cell));
      const x1 = Math.min(this.cols - 1, Math.floor((r.x + r.w / 2 + grow - minX) / cell));
      const z0 = Math.max(0, Math.floor((r.z - r.d / 2 - grow - minZ) / cell));
      const z1 = Math.min(this.rows - 1, Math.floor((r.z + r.d / 2 + grow - minZ) / cell));
      for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) arr[cz * this.cols + cx] = 1;
    };
    for (const r of rects) {
      mark(this.blocked, r, inflate);
      mark(this.solid, r, 0);
    }
  }

  private idx(x: number, z: number): number {
    const cx = Math.floor((x - this.minX) / this.cell);
    const cz = Math.floor((z - this.minZ) / this.cell);
    if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) return -1;
    return cz * this.cols + cx;
  }

  // fuori dalla griglia conta come libero (il mondo continua fuori dal labirinto)
  isFree(x: number, z: number): boolean {
    const i = this.idx(x, z);
    return i < 0 || this.blocked[i] === 0;
  }

  private center(i: number): NavPoint {
    return { x: this.minX + ((i % this.cols) + 0.5) * this.cell, z: this.minZ + (Math.floor(i / this.cols) + 0.5) * this.cell };
  }

  // la cella libera piu' vicina a (x, z) (a spirale), o -1
  private nearestFreeIdx(x: number, z: number): number {
    const i = this.idx(x, z);
    if (i >= 0 && !this.blocked[i]) return i;
    const cx0 = Math.floor((x - this.minX) / this.cell);
    const cz0 = Math.floor((z - this.minZ) / this.cell);
    for (let r = 1; r < 12; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cx = cx0 + dx;
          const cz = cz0 + dz;
          if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) continue;
          if (!this.blocked[cz * this.cols + cx]) return cz * this.cols + cx;
        }
    return -1;
  }

  // vista libera tra due punti (campionata a mezza cella)
  lineClear(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    const n = Math.ceil(len / (this.cell * 0.5));
    for (let k = 0; k <= n; k++) {
      const t = n ? k / n : 0;
      if (!this.isFree(ax + dx * t, az + dz * t)) return false;
    }
    return true;
  }

  // linea di vista: solo i muri veri la fermano (non il loro ingombro per camminare); i punti di
  // partenza e arrivo possono stare vicinissimi a un muro
  lineOfSight(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    const n = Math.ceil(len / (this.cell * 0.5));
    for (let k = 0; k <= n; k++) {
      const t = n ? k / n : 0;
      const i = this.idx(ax + dx * t, az + dz * t);
      if (i >= 0 && this.solid[i]) return false;
    }
    return true;
  }

  // un punto libero a caso entro `radius` da (x, z), raggiungibile in linea d'aria o no
  randomFreeNear(x: number, z: number, radius: number): NavPoint | null {
    for (let k = 0; k < 24; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      const i = this.idx(px, pz);
      if (i >= 0 && !this.blocked[i]) return this.center(i);
    }
    return null;
  }

  // percorso (punti nel mondo, senza il punto di partenza); null se non c'e'
  findPath(ax: number, az: number, bx: number, bz: number, maxExpand = 30000): NavPoint[] | null {
    const s = this.nearestFreeIdx(ax, az);
    const g = this.nearestFreeIdx(bx, bz);
    if (s < 0 || g < 0) return null;
    if (s === g) return [{ x: bx, z: bz }];
    const N = this.cols * this.rows;
    const gs = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const gx = g % this.cols;
    const gz = Math.floor(g / this.cols);
    const h = (i: number) => {
      const dx = Math.abs((i % this.cols) - gx);
      const dz = Math.abs(Math.floor(i / this.cols) - gz);
      return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
    };
    // heap binario su (f, indice)
    const heapI: number[] = [];
    const heapF: number[] = [];
    const push = (i: number, f: number) => {
      let k = heapI.length;
      heapI.push(i);
      heapF.push(f);
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heapF[p] <= heapF[k]) break;
        [heapF[p], heapF[k]] = [heapF[k], heapF[p]];
        [heapI[p], heapI[k]] = [heapI[k], heapI[p]];
        k = p;
      }
    };
    const pop = () => {
      const top = heapI[0];
      const li = heapI.pop()!;
      const lf = heapF.pop()!;
      if (heapI.length) {
        heapI[0] = li;
        heapF[0] = lf;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1;
          const r = l + 1;
          let m = k;
          if (l < heapI.length && heapF[l] < heapF[m]) m = l;
          if (r < heapI.length && heapF[r] < heapF[m]) m = r;
          if (m === k) break;
          [heapF[m], heapF[k]] = [heapF[k], heapF[m]];
          [heapI[m], heapI[k]] = [heapI[k], heapI[m]];
          k = m;
        }
      }
      return top;
    };
    gs[s] = 0;
    push(s, h(s));
    let expanded = 0;
    let found = false;
    while (heapI.length && expanded++ < maxExpand) {
      const cur = pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (cur === g) {
        found = true;
        break;
      }
      const cx = cur % this.cols;
      const cz = Math.floor(cur / this.cols);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= this.cols || nz >= this.rows) continue;
          const ni = nz * this.cols + nx;
          if (this.blocked[ni] || closed[ni]) continue;
          // niente angoli tagliati
          if (dx && dz && (this.blocked[cz * this.cols + nx] || this.blocked[nz * this.cols + cx])) continue;
          const ng = gs[cur] + (dx && dz ? SQRT2 : 1);
          if (ng < gs[ni]) {
            gs[ni] = ng;
            came[ni] = cur;
            push(ni, ng + h(ni));
          }
        }
    }
    if (!found) return null;
    const cells: number[] = [];
    for (let i = g; i !== -1; i = came[i]) cells.push(i);
    cells.reverse();
    const pts = cells.map((i) => this.center(i));
    // accorcia: dal punto corrente al piu' lontano visibile
    const out: NavPoint[] = [];
    let a = 0;
    const start: NavPoint = { x: ax, z: az };
    let from = start;
    while (a < pts.length - 1) {
      let b = pts.length - 1;
      while (b > a + 1 && !this.lineClear(from.x, from.z, pts[b].x, pts[b].z)) b--;
      out.push(pts[b]);
      from = pts[b];
      a = b;
    }
    // l'ultimo punto e' proprio la destinazione richiesta se e' libera
    if (this.isFree(bx, bz) && out.length) out[out.length - 1] = { x: bx, z: bz };
    return out;
  }
}

let current: NavGrid | null = null;
export const setNav = (n: NavGrid | null) => {
  current = n;
};
export const getNav = () => current;
