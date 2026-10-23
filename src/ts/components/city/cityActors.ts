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

// I droni nemici che pattugliano lo spazio tra i pianeti (SpaceEnemies.tsx): bersagli SOLO del drone del giocatore (mira,
// mitragliatrice, missili). Non stanno in `cityOpponents` perche' i personaggi a terra (alleati, minimappa, mischia) non
// devono inseguirli. Le posizioni sono nel riferimento del sito corrente (quota vera in `position.y`).
export const spaceFlyers: FighterData[] = [];
let flyersVersion = 0;
export const isFlyer = (d: FighterData) => spaceFlyers.includes(d);
export function addSpaceFlyer(d: FighterData) {
  if (!spaceFlyers.includes(d)) {
    spaceFlyers.push(d);
    flyersVersion++;
  }
}
export function removeSpaceFlyer(d: FighterData) {
  const i = spaceFlyers.indexOf(d);
  if (i >= 0) {
    spaceFlyers.splice(i, 1);
    flyersVersion++;
  }
}
// bersagli del drone: nemici a terra + droni nemici (lista in cache, si rifa solo se cambia qualcosa)
let cache: FighterData[] = [];
let cacheKey = '';
export function getDroneTargets(): FighterData[] {
  const k = cityOpponentsVersion + ':' + flyersVersion + ':' + cityOpponents.length;
  if (k !== cacheKey) {
    cacheKey = k;
    cache = [...cityOpponents, ...spaceFlyers];
  }
  return cache;
}
