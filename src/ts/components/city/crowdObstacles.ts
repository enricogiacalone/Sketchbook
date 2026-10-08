// Ostacoli per la folla analitica (crowdSim): la folla non ha fisica, quindi
// muri dei palazzi e pali li conosce da qui, come rettangoli e cerchi a
// terra in una griglia. Le auto (che si muovono) arrivano ogni frame come
// rettangoli orientati (CrowdObstacle in crowdSim).
//
// "nn devono compenetrare i muri degli edifici o i pali": con queste forme
// ogni passante sceglie di quanto spostarsi di lato per passare libero
// (crowdSim.steerAround) e, come rete di sicurezza, viene spinto fuori se ci
// finisce dentro lo stesso (pushOutOfStatics).

export interface StaticRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  stamp: number;
}
export interface StaticCircle {
  x: number;
  z: number;
  r: number;
  stamp: number;
}

const CELL = 4;
const cellKey = (cx: number, cz: number) => (cx + 2000) * 8192 + (cz + 2000);
const rectCells = new Map<number, StaticRect[]>();
const circleCells = new Map<number, StaticCircle[]>();
let staticCount = 0;
let stampNow = 1;

export function setCrowdStatics(rects: Array<Omit<StaticRect, 'stamp'>>, circles: Array<Omit<StaticCircle, 'stamp'>>) {
  rectCells.clear();
  circleCells.clear();
  for (const r0 of rects) {
    const r: StaticRect = { ...r0, stamp: 0 };
    for (let cx = Math.floor(r.minX / CELL); cx <= Math.floor(r.maxX / CELL); cx++)
      for (let cz = Math.floor(r.minZ / CELL); cz <= Math.floor(r.maxZ / CELL); cz++) {
        const k = cellKey(cx, cz);
        let l = rectCells.get(k);
        if (!l) rectCells.set(k, (l = []));
        l.push(r);
      }
  }
  for (const c0 of circles) {
    const c: StaticCircle = { ...c0, stamp: 0 };
    for (let cx = Math.floor((c.x - c.r) / CELL); cx <= Math.floor((c.x + c.r) / CELL); cx++)
      for (let cz = Math.floor((c.z - c.r) / CELL); cz <= Math.floor((c.z + c.r) / CELL); cz++) {
        const k = cellKey(cx, cz);
        let l = circleCells.get(k);
        if (!l) circleCells.set(k, (l = []));
        l.push(c);
      }
  }
  staticCount = rects.length + circles.length;
}
export const hasCrowdStatics = () => staticCount > 0;

// forme che toccano il rettangolo (senza doppioni); riempie gli array dati
export function queryStatics(minX: number, minZ: number, maxX: number, maxZ: number, rects: StaticRect[], circles: StaticCircle[]) {
  rects.length = 0;
  circles.length = 0;
  if (staticCount === 0) return;
  const s = ++stampNow;
  for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++)
    for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
      const k = cellKey(cx, cz);
      const lr = rectCells.get(k);
      if (lr)
        for (const r of lr) {
          if (r.stamp === s || r.maxX < minX || r.minX > maxX || r.maxZ < minZ || r.minZ > maxZ) continue;
          r.stamp = s;
          rects.push(r);
        }
      const lc = circleCells.get(k);
      if (lc)
        for (const c of lc) {
          if (c.stamp === s || c.x + c.r < minX || c.x - c.r > maxX || c.z + c.r < minZ || c.z - c.r > maxZ) continue;
          c.stamp = s;
          circles.push(c);
        }
    }
}

// --- test segmento (con raggio) contro le forme --------------------------

// distanza^2 tra il punto (px,pz) e il segmento a-b
export function segPointDist2(ax: number, az: number, bx: number, bz: number, px: number, pz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px;
  const qz = az + dz * t - pz;
  return qx * qx + qz * qz;
}

// il segmento a-b (in coordinate locali del rettangolo) tocca il
// rettangolo [-hx,hx]x[-hz,hz]? (test a lastre)
export function segHitsBox(ax: number, az: number, bx: number, bz: number, hx: number, hz: number) {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  // asse x
  if (Math.abs(dx) < 1e-9) {
    if (ax < -hx || ax > hx) return false;
  } else {
    let ta = (-hx - ax) / dx;
    let tb = (hx - ax) / dx;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (az < -hz || az > hz) return false;
  } else {
    let ta = (-hz - az) / dz;
    let tb = (hz - az) / dz;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

export function segHitsRect(ax: number, az: number, bx: number, bz: number, r: StaticRect, rad: number) {
  const cx = (r.minX + r.maxX) / 2;
  const cz = (r.minZ + r.maxZ) / 2;
  return segHitsBox(ax - cx, az - cz, bx - cx, bz - cz, (r.maxX - r.minX) / 2 + rad, (r.maxZ - r.minZ) / 2 + rad);
}

export function segHitsCircle(ax: number, az: number, bx: number, bz: number, c: { x: number; z: number; r: number }, rad: number) {
  const rr = c.r + rad;
  return segPointDist2(ax, az, bx, bz, c.x, c.z) < rr * rr;
}

// --- rete di sicurezza: fuori dalle forme fisse -------------------------
const _qr: StaticRect[] = [];
const _qc: StaticCircle[] = [];
const _out = { x: 0, z: 0, moved: false };
export function pushOutOfStatics(x: number, z: number, rad: number) {
  _out.x = x;
  _out.z = z;
  _out.moved = false;
  queryStatics(x - rad, z - rad, x + rad, z + rad, _qr, _qc);
  for (const r of _qr) {
    const minX = r.minX - rad;
    const maxX = r.maxX + rad;
    const minZ = r.minZ - rad;
    const maxZ = r.maxZ + rad;
    if (_out.x <= minX || _out.x >= maxX || _out.z <= minZ || _out.z >= maxZ) continue;
    // esce dal lato piu' vicino
    const dl = _out.x - minX;
    const dr = maxX - _out.x;
    const dn = _out.z - minZ;
    const df = maxZ - _out.z;
    const m = Math.min(dl, dr, dn, df);
    if (m === dl) _out.x = minX;
    else if (m === dr) _out.x = maxX;
    else if (m === dn) _out.z = minZ;
    else _out.z = maxZ;
    _out.moved = true;
  }
  for (const c of _qc) {
    const dx = _out.x - c.x;
    const dz = _out.z - c.z;
    const rr = c.r + rad;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) continue;
    const d = Math.sqrt(d2) || 1e-3;
    _out.x = c.x + (dx / d) * rr;
    _out.z = c.z + (dz / d) * rr;
    _out.moved = true;
  }
  return _out;
}

// quanti punti (x,z) col raggio dato stanno dentro a una forma fissa
export function insideStatics(x: number, z: number, rad: number) {
  queryStatics(x - rad, z - rad, x + rad, z + rad, _qr, _qc);
  for (const r of _qr) if (x > r.minX - rad && x < r.maxX + rad && z > r.minZ - rad && z < r.maxZ + rad) return true;
  for (const c of _qc) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + rad) ** 2) return true;
  return false;
}
