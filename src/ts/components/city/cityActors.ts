import type { FighterData } from '../Environment/SquadArenaTypes';

export const cityOpponents: FighterData[] = [];
export let cityOpponentsVersion = 0;

export function addCityOpponent(d: FighterData) {
  if (!cityOpponents.includes(d)) {
    cityOpponents.push(d);
    cityOpponentsVersion++;
  }
}

export function removeCityOpponent(d: FighterData) {
  const i = cityOpponents.indexOf(d);
  if (i >= 0) {
    cityOpponents.splice(i, 1);
    cityOpponentsVersion++;
  }
}
