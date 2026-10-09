// Gradini delle scale. Su una scala si cammina su una rampa di collisione
// liscia (ParkourCourse.tsx, BuildingStairwell.tsx); i gradini visibili e
// l'IK dei piedi (footIK.ts) usano questa disposizione.
//
// "ogni gradino deve avere la stessa altezza": prima la cima di ogni
// gradino stava sulla rampa al centro del gradino, cosi' il primo (dal
// pavimento) e l'ultimo (verso il pianerottolo) erano alti mezza alzata e
// gli altri una intera. Ora: `steps` alzate tutte uguali (rise / steps) e
// steps - 1 pedate, ognuna centrata dove la rampa ha la sua quota (la rampa
// passa per il centro di ogni pedata, il pavimento a un capo e il
// pianerottolo all'altro), piu' mezza pedata alla quota d'arrivo davanti al
// pianerottolo.

export interface StepFlight {
  // rampa lungo X: attacco (xa, ya), arrivo (xb, yb), asse z, mezza larghezza
  xa: number;
  ya: number;
  xb: number;
  yb: number;
  z: number;
  halfWidth: number;
  steps: number;
}

export interface StepTread {
  u0: number; // inizio e fine della pedata lungo la rampa (0..1)
  u1: number;
  top: number; // quota della pedata
}

// pedate di una rampa, dal basso: steps - 1 pedate intere + mezza in cima
export function stepTreads(f: Pick<StepFlight, 'ya' | 'yb' | 'steps'>): StepTread[] {
  const n = f.steps;
  const h = (f.yb - f.ya) / n;
  const out: StepTread[] = [];
  for (let i = 0; i < n - 1; i++) out.push({ u0: (i + 0.5) / n, u1: (i + 1.5) / n, top: f.ya + h * (i + 1) });
  out.push({ u0: (n - 0.5) / n, u1: 1, top: f.yb });
  return out;
}

const flights = new Set<StepFlight>();

export function registerStepFlights(list: StepFlight[]): () => void {
  for (const f of list) flights.add(f);
  return () => {
    for (const f of list) flights.delete(f);
  };
}

export interface StepHit {
  top: number; // quota della pedata (o del pavimento / pianerottolo ai capi)
  // centro della pedata lungo la rampa (x del mondo), lunghezza di una
  // pedata e verso di salita lungo x (+1 / -1)
  centerX: number;
  tread: number;
  upX: number;
  flight: StepFlight;
}
const _hit: StepHit = { top: 0, centerX: 0, tread: 0, upX: 1, flight: null as unknown as StepFlight };

// pedata sotto (x, z) se c'e' una scala li' a una quota vicina a nearY (i
// piani di un palazzo hanno scale una sopra l'altra); null se no. L'oggetto
// restituito e' riusato.
export function stepAt(x: number, z: number, nearY: number): StepHit | null {
  for (const f of flights) {
    if (Math.abs(z - f.z) > f.halfWidth) continue;
    const u = (x - f.xa) / (f.xb - f.xa);
    if (u < 0 || u > 1) continue;
    const rise = f.yb - f.ya;
    if (Math.abs(f.ya + rise * u - nearY) > 0.35) continue;
    const n = f.steps;
    const h = rise / n;
    // indice della pedata: -1 = pavimento prima del primo gradino
    const i = Math.min(n - 1, Math.floor(u * n - 0.5));
    _hit.top = i < 0 ? f.ya : f.ya + h * (i + 1);
    const uc = i < 0 ? 0.25 / n : i >= n - 1 ? (n - 0.25) / n : (i + 1) / n;
    _hit.centerX = f.xa + (f.xb - f.xa) * uc;
    _hit.tread = Math.abs(f.xb - f.xa) / n;
    _hit.upX = f.xb > f.xa ? 1 : -1;
    _hit.flight = f;
    return _hit;
  }
  return null;
}

export function stepTopAt(x: number, z: number, nearY: number): number | null {
  return stepAt(x, z, nearY)?.top ?? null;
}
