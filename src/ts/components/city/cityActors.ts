import type { FighterData } from '../Environment/SquadArenaTypes';

// Tutti i manichini della citta' che il giocatore puo' colpire (passanti,
// nemici, giocatori remoti): e' la lista `opponents` di PlayerCombatSoldier
// nel mondo aperto (CityPlayer.tsx) -- pugni, coltello e spari del
// giocatore li colpiscono con lo stesso codice del duello (vita, reazione,
// ragdoll). Stesso array per sempre, modificato sul posto.
export const cityOpponents: FighterData[] = [];

export function addCityOpponent(d: FighterData) {
  if (!cityOpponents.includes(d)) cityOpponents.push(d);
}

export function removeCityOpponent(d: FighterData) {
  const i = cityOpponents.indexOf(d);
  if (i >= 0) cityOpponents.splice(i, 1);
}
