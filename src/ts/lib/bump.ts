// Spallate a piedi, alla GTA. Il player che corre contro un passante lo
// sposta, lo fa barcollare o lo butta a terra a seconda della velocita' di
// avvicinamento; PlayerCombatSoldier.tsx le rileva e le manda qui, e il
// passante (CrowdPedestrian.tsx) le ritira e reagisce: spostamento laterale,
// frase, sguardo verso di te, a volte fuga o panico dei vicini.

export type BumpStrength = 'light' | 'medium' | 'heavy';

// velocita' di avvicinamento (m/s) oltre cui: spinta leggera, spallata, caduta
// (camminata 1.25, corsa leggera 3.2, scatto 4.8)
export const BUMP_MIN_SPEED = 1.9;
export const BUMP_MEDIUM = 3.0;
export const BUMP_HEAVY = 4.2;
export const BUMP_DIST = 0.95; // m tra i centri
export const BUMP_COOLDOWN_MS = 800; // stesso passante

export interface BumpEvent {
  id: string;
  strength: BumpStrength;
  // di quanto va spostato (m, orizzontale)
  px: number;
  pz: number;
  // da dove arriva il colpo
  fromX: number;
  fromZ: number;
}

const pending = new Map<string, BumpEvent>();
export const pushBump = (e: BumpEvent) => pending.set(e.id, e);
export const takeBump = (id: string): BumpEvent | undefined => {
  const e = pending.get(id);
  if (e) pending.delete(id);
  return e;
};

export const BUMP_LINES: Record<BumpStrength, string[]> = {
  light: ['Ehi!', 'Attento!', 'Scusa... prego!', 'Occhio!'],
  medium: ['Ma che fai?!', 'Guarda dove vai!', 'Sei scemo?!', 'Ehi! Piano!'],
  heavy: ['AHIA!', 'Ma sei pazzo?!', 'Chiamate la polizia!', 'Che ti prende?!'],
};
