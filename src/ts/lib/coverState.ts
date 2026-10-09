// Copertura del giocatore (PlayerCombatSoldier.tsx la scrive a ogni frame)
// per la telecamera (useThirdPersonCamera.ts): in copertura si mette dalla
// parte libera del muro, dietro la spalla, guardando lungo il muro verso
// il lato dove ci si e' spostati per ultimo (come in GTA).
export const coverState = {
  on: false,
  // ultimo frame in copertura (performance.now): se il personaggio smette di
  // aggiornarlo (morto, in auto...) la telecamera non ci resta attaccata
  t: 0,
  // normale del muro (verso dove guarda il personaggio)
  nx: 0,
  nz: 1,
  // lato verso cui guarda la telecamera: +1 destra del personaggio, -1 sinistra
  side: 1,
};
