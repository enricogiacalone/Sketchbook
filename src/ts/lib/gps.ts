import { ROAD_OFFSETS, ROAD_SIZE } from '../components/Environment/Road';

// GPS alla GTA: "Waypoint: lo metti con un clic sulla mappa. Tragitto: il
// gioco calcola il percorso piu' breve sulle strade. GPS: la linea del
// tragitto compare sulla minimappa e si ricalcola se sbagli strada; si attiva
// da sola anche verso l'obiettivo della missione."
//
// La rete stradale e' un grafo: nodi = incroci (e le estremita' delle strade
// sul bordo dell'isola), archi = tratti di strada tra due nodi. Oggi la
// citta' e' una griglia (ROAD_OFFSETS su X e su Z), ma il router non lo sa:
// lavora su nodi/archi qualsiasi, quindi se un giorno le strade diventano
// storte basta cambiare buildRoadGraph().
//
// Tragitto da A a B: A e B si "agganciano" al punto di strada piu' vicino,
// poi Dijkstra sui nodi; l'ultimo pezzo dalla strada a B (un bar, la pista
// dell'aeroporto) e' una linea dritta, come in GTA.

export type P2 = [number, number];

export interface RoadEdge {
  a: number;
  b: number;
  len: number;
}

export interface RoadGraph {
  nodes: P2[];
  edges: RoadEdge[];
  adj: Array<Array<{ edge: number; to: number }>>;
}

function buildRoadGraph(): RoadGraph {
  const half = ROAD_SIZE / 2;
  const nodes: P2[] = [];
  const index = new Map<string, number>();
  const node = (x: number, z: number) => {
    const k = `${x},${z}`;
    let i = index.get(k);
    if (i === undefined) {
      i = nodes.length;
      nodes.push([x, z]);
      index.set(k, i);
    }
    return i;
  };
  const edges: RoadEdge[] = [];
  const stops = [-half, ...ROAD_OFFSETS.filter((o) => o > -half && o < half), half];
  for (const o of ROAD_OFFSETS) {
    // strada lungo X (z = o) e strada lungo Z (x = o), spezzate a ogni incrocio
    for (let i = 0; i < stops.length - 1; i++) {
      edges.push({ a: node(stops[i], o), b: node(stops[i + 1], o), len: stops[i + 1] - stops[i] });
      edges.push({ a: node(o, stops[i]), b: node(o, stops[i + 1]), len: stops[i + 1] - stops[i] });
    }
  }
  const adj: RoadGraph['adj'] = nodes.map(() => []);
  edges.forEach((e, i) => {
    adj[e.a].push({ edge: i, to: e.b });
    adj[e.b].push({ edge: i, to: e.a });
  });
  return { nodes, edges, adj };
}

export const roadGraph = buildRoadGraph();

export interface RoadSnap {
  edge: number;
  t: number; // 0 = nodo a, 1 = nodo b
  x: number;
  z: number;
  distance: number;
}

/** Il punto di strada piu' vicino a (x, z). */
export function snapToRoad(x: number, z: number, g: RoadGraph = roadGraph): RoadSnap | null {
  let best: RoadSnap | null = null;
  g.edges.forEach((e, i) => {
    const [ax, az] = g.nodes[e.a];
    const [bx, bz] = g.nodes[e.b];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const sx = ax + dx * t;
    const sz = az + dz * t;
    const d = Math.hypot(x - sx, z - sz);
    if (!best || d < best.distance) best = { edge: i, t, x: sx, z: sz, distance: d };
  });
  return best;
}

export interface GpsRoute {
  points: P2[];
  length: number;
}

// inversione a U in auto: costa come 150 m di strada in piu' (se c'e' un
// giro dell'isolato che non la richiede, il GPS sceglie quello)
const U_TURN_PENALTY = 150;

/**
 * Percorso piu' breve sulle strade da `from` a `to`. `heading` (direzione di
 * marcia, vettore unitario) fa evitare le inversioni a U: serve in auto, a
 * piedi si lascia vuoto.
 *
 * Dijkstra sugli archi "con il verso": lo stato 2*i e' "sull'arco i, andando
 * da a verso b" (arrivati in b), 2*i+1 il contrario. Cosi' si sa da dove si
 * arriva a un incrocio e tornare indietro sullo stesso arco si paga.
 */
export function findRoute(from: P2, to: P2, heading?: P2 | null, g: RoadGraph = roadGraph): GpsRoute | null {
  const sa = snapToRoad(from[0], from[1], g);
  const sb = snapToRoad(to[0], to[1], g);
  if (!sa || !sb) return null;
  const U = heading ? U_TURN_PENALTY : 0;
  const ea = g.edges[sa.edge];
  const eb = g.edges[sb.edge];
  const S = g.edges.length * 2;
  const END = S;
  const dist = new Float64Array(S + 1).fill(Infinity);
  const prev = new Int32Array(S + 1).fill(-1); // -2 = dal punto di partenza
  const done = new Uint8Array(S + 1);
  const nodeOf = (st: number) => (st & 1 ? g.edges[st >> 1].a : g.edges[st >> 1].b);

  // partire nel verso opposto a quello di marcia = inversione
  const turn = (dx: number, dz: number) => {
    if (!heading) return 0;
    const l = Math.hypot(dx, dz);
    if (l < 1e-3) return 0;
    return (dx * heading[0] + dz * heading[1]) / l < -0.3 ? U : 0;
  };
  const [ax, az] = g.nodes[ea.a];
  const [bx, bz] = g.nodes[ea.b];
  const fwd = turn(bx - ax, bz - az); // verso b
  const back = turn(ax - bx, az - bz); // verso a
  const relax = (st: number, d: number, p: number) => {
    if (d < dist[st]) {
      dist[st] = d;
      prev[st] = p;
    }
  };
  relax(sa.edge * 2, (1 - sa.t) * ea.len + fwd, -2);
  relax(sa.edge * 2 + 1, sa.t * ea.len + back, -2);
  // stesso arco, nel verso giusto: si va dritti
  if (sa.edge === sb.edge) relax(END, Math.abs(sb.t - sa.t) * ea.len + (sb.t >= sa.t ? fwd : back), -2);

  // (la rete e' piccola: il minimo si cerca a mano, niente heap)
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i <= S; i++) {
      if (!done[i] && dist[i] < best) {
        best = dist[i];
        u = i;
      }
    }
    if (u < 0 || u === END) break;
    done[u] = 1;
    const at = nodeOf(u);
    const via = u >> 1;
    // da qui si entra sull'arco dell'arrivo
    if (at === eb.a) relax(END, best + sb.t * eb.len + (via === sb.edge ? U : 0), u);
    if (at === eb.b) relax(END, best + (1 - sb.t) * eb.len + (via === sb.edge ? U : 0), u);
    for (const { edge, to } of g.adj[at]) {
      const st = to === g.edges[edge].b ? edge * 2 : edge * 2 + 1;
      relax(st, best + g.edges[edge].len + (edge === via ? U : 0), u);
    }
  }
  if (!Number.isFinite(dist[END])) return null;

  const chain: number[] = [];
  for (let v = prev[END]; v >= 0; v = prev[v]) chain.push(nodeOf(v));
  chain.reverse();
  const pts: P2[] = [from, [sa.x, sa.z], ...chain.map((i) => g.nodes[i]), [sb.x, sb.z], to];
  // via i punti doppi (partenza gia' sulla strada, arrivo su un incrocio...)
  const points: P2[] = [];
  for (const p of pts) {
    const q = points[points.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.5) points.push([p[0], p[1]]);
  }
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return { points, length };
}

// --- stato del GPS ------------------------------------------------------------
// Fuori da zustand: la minimappa e la mappa lo leggono a ogni frame dai loro
// requestAnimationFrame, senza far ridisegnare React.

export type GpsKind = 'waypoint' | 'mission';

export const gps = {
  /** il waypoint messo dal giocatore sulla mappa */
  waypoint: null as P2 | null,
  /** dove porta il GPS adesso (waypoint, se no l'obiettivo della missione) */
  target: null as P2 | null,
  kind: null as GpsKind | null,
  route: null as GpsRoute | null,
};

const ARRIVED_DIST = 10; // m: arrivati, il waypoint sparisce (come in GTA)
const REROUTE_EVERY_MS = 400;
const OFF_ROUTE_DIST = 6; // m fuori dalla linea: si ricalcola subito

let lastRouteAt = 0;
let lastPos: { x: number; z: number; t: number } | null = null;
const heading: P2 = [0, 0];
let headingOk = false;

export function setWaypoint(p: P2 | null) {
  gps.waypoint = p ? [p[0], p[1]] : null;
  lastRouteAt = 0; // ricalcola al prossimo giro
}

function distToRoute(x: number, z: number, r: GpsRoute) {
  let best = Infinity;
  for (let i = 1; i < r.points.length; i++) {
    const [ax, az] = r.points[i - 1];
    const [bx, bz] = r.points[i];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

/**
 * Da chiamare a ogni frame (lo fa la minimappa): segue il giocatore,
 * ricalcola il tragitto ogni tanto o subito se si esce dalla linea.
 */
export function updateGps(px: number, pz: number, inVehicle: boolean, missionTarget: P2 | null, now: number) {
  // direzione di marcia dal movimento vero (vale per auto, aereo, drone...)
  if (lastPos) {
    const dt = (now - lastPos.t) / 1000;
    const dx = px - lastPos.x;
    const dz = pz - lastPos.z;
    const d = Math.hypot(dx, dz);
    if (dt > 0 && d / dt > 2 && d < 50) {
      heading[0] = dx / d;
      heading[1] = dz / d;
      headingOk = true;
    } else if (dt > 0 && d / dt < 0.5) headingOk = false;
  }
  lastPos = { x: px, z: pz, t: now };

  if (gps.waypoint && Math.hypot(gps.waypoint[0] - px, gps.waypoint[1] - pz) < ARRIVED_DIST) setWaypoint(null);

  const target = gps.waypoint ?? missionTarget;
  const kind: GpsKind | null = gps.waypoint ? 'waypoint' : missionTarget ? 'mission' : null;
  const moved = !gps.target || !target || gps.target[0] !== target[0] || gps.target[1] !== target[1] || gps.kind !== kind;
  gps.target = target ? [target[0], target[1]] : null;
  gps.kind = kind;
  if (!target) {
    gps.route = null;
    return;
  }
  const off = gps.route ? distToRoute(px, pz, gps.route) > OFF_ROUTE_DIST : true;
  if (moved || off || now - lastRouteAt > REROUTE_EVERY_MS) {
    lastRouteAt = now;
    gps.route = findRoute([px, pz], target, inVehicle && headingOk ? heading : null);
  }
}

/** Tempo stimato, per la mappa: a piedi di corsa / in auto in citta'. */
export function routeEta(lengthM: number, inVehicle: boolean) {
  const speed = inVehicle ? 14 : 4.5; // m/s
  return lengthM / speed;
}
