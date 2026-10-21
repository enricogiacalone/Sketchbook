import type { NavGrid, NavLink, NavPoint } from '../../../lib/nav';

// Segue un percorso A* verso un obiettivo che puo' muoversi: lo rifa' ogni
// ~secondo o quando l'obiettivo si sposta, e prende le scorciatoie quando la
// strada e' libera. Restituisce la direzione (versore) in cui camminare.

export interface PathState {
  pts: NavPoint[];
  i: number;
  gx: number;
  gz: number;
  replanT: number;
}

export const newPathState = (): PathState => ({ pts: [], i: 0, gx: 1e9, gz: 1e9, replanT: 0 });

// `vault`: e' arrivato al punto da cui si scavalca (chi chiama fa il salto e poi chiama `vaultDone`)
export type Steer = { dx: number; dz: number; done: boolean; vault?: NavLink };

// finito il salto: si riparte dal punto d'atterraggio
export const vaultDone = (ps: PathState) => {
  if (ps.pts[ps.i]?.vault) ps.i++;
};

export function steerTo(ps: PathState, nav: NavGrid, px: number, pz: number, gx: number, gz: number, dt: number): Steer {
  ps.replanT -= dt;
  if (ps.replanT <= 0 || Math.hypot(gx - ps.gx, gz - ps.gz) > 1.5) {
    ps.pts = nav.findPath(px, pz, gx, gz) ?? [];
    ps.i = 0;
    ps.gx = gx;
    ps.gz = gz;
    ps.replanT = 0.8 + Math.random() * 0.4;
  }
  const toGoal = Math.hypot(gx - px, gz - pz);
  let tx = gx;
  let tz = gz;
  const hasVault = ps.pts.some((p) => p.vault);
  const clear = !hasVault && toGoal < 40 && nav.lineClear(px, pz, gx, gz);
  // niente strada e nemmeno vista libera: l'obiettivo non e' raggiungibile (fuori dal labirinto, dietro
  // un ostacolo chiuso): si sta fermi invece di andare a sbattere contro un muro
  if (!clear && !ps.pts.length) return { dx: 0, dz: 0, done: false };
  if (!clear && ps.pts.length) {
    while (ps.i < ps.pts.length - 1 && !ps.pts[ps.i].vault && Math.hypot(ps.pts[ps.i].x - px, ps.pts[ps.i].z - pz) < 0.7) ps.i++;
    while (ps.i < ps.pts.length - 1 && !ps.pts[ps.i].vault && !ps.pts[ps.i + 1].vault && nav.lineClear(px, pz, ps.pts[ps.i + 1].x, ps.pts[ps.i + 1].z)) ps.i++;
    const cur = ps.pts[ps.i];
    if (cur.vault && Math.hypot(cur.x - px, cur.z - pz) < 0.5) return { dx: 0, dz: 0, done: false, vault: cur.vault };
    tx = ps.pts[ps.i].x;
    tz = ps.pts[ps.i].z;
  }
  const d = Math.hypot(tx - px, tz - pz);
  if (d < 1e-3) return { dx: 0, dz: 0, done: toGoal < 0.8 };
  return { dx: (tx - px) / d, dz: (tz - pz) / d, done: toGoal < 0.8 };
}
