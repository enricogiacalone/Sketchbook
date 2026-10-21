import type { NavGrid } from '../../../lib/nav';

// Copertura: dietro quale muro nascondersi da un tiratore. Una copertura e' un punto libero e raggiungibile
// a pochi metri da cui il tiratore non si vede (NavGrid.lineOfSight), piu' un punto "da sporgersi" lì vicino
// da cui invece lo si vede (per sparare/colpire e poi rientrare).

export interface Cover {
  // dove ci si nasconde
  hx: number;
  hz: number;
  // da dove ci si sporge (vede il bersaglio)
  px: number;
  pz: number;
}

// tiratori armati vivi che vedono il mondo (aggiornato da brains/hostile.ts): il pilota automatico li usa per sapere
// da chi nascondersi
export const armedShooters = new Map<string, { x: number; z: number; t: number }>();
// (se un tiratore non si aggiorna da piu' di mezzo secondo e' morto o smontato)
export const liveShooters = () => {
  const now = performance.now();
  const out: Array<{ x: number; z: number }> = [];
  for (const [id, s] of armedShooters) {
    if (now - s.t > 500) armedShooters.delete(id);
    else out.push(s);
  }
  return out;
};

const RINGS = [1.2, 2.4, 3.6, 4.8, 6.4, 8];
const SECTORS = 16;
const PEEK_RADII = [0.8, 1.2, 1.7];

export function findCover(nav: NavGrid, x: number, z: number, tx: number, tz: number, maxDist = 8, minShooterDist = 3): Cover | null {
  let best: Cover | null = null;
  let bestScore = Infinity;
  for (const r of RINGS) {
    if (r > maxDist) break;
    for (let s = 0; s < SECTORS; s++) {
      const a = (s / SECTORS) * Math.PI * 2;
      const hx = x + Math.cos(a) * r;
      const hz = z + Math.sin(a) * r;
      if (!nav.isFree(hx, hz) || nav.lineOfSight(hx, hz, tx, tz)) continue;
      const dShooter = Math.hypot(hx - tx, hz - tz);
      if (dShooter < minShooterDist) continue;
      // raggiungibile senza scavalcare: strada libera in linea d'aria o percorso corto
      if (!nav.lineClear(x, z, hx, hz)) continue;
      // la sporgenza: il punto libero piu' vicino alla copertura da cui lo si vede
      let peek: { x: number; z: number } | null = null;
      for (const pr of PEEK_RADII) {
        for (let k = 0; k < 8 && !peek; k++) {
          const pa = (k / 8) * Math.PI * 2;
          const qx = hx + Math.cos(pa) * pr;
          const qz = hz + Math.sin(pa) * pr;
          if (nav.isFree(qx, qz) && nav.lineClear(hx, hz, qx, qz) && nav.lineOfSight(qx, qz, tx, tz)) peek = { x: qx, z: qz };
        }
        if (peek) break;
      }
      if (!peek) continue;
      // preferisce vicino a se' e che la copertura non sia sulla strada del tiratore
      const score = r + Math.max(0, 6 - dShooter) * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = { hx, hz, px: peek.x, pz: peek.z };
      }
    }
    if (best) break;
  }
  return best;
}
