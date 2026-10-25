import { useSyncExternalStore } from 'react';

// Il "pianeta" in cui si gioca: un seme + la dimensione della mappa (stile No
// Man's Sky: ogni pianeta e' una citta' procedurale, anche di taglia
// diversa). Tutte le misure della citta' (griglia di isolati, strade,
// terreno, aeroporto, minimappa, traffico, folla, nav) derivano da qui e
// da nessun'altra costante: i moduli del mondo le leggono UNA volta
// all'import, dopo che main.tsx ha impostato il profilo (setPlanet).
// Cambiare pianeta = salvare il nuovo profilo e ricaricare la pagina
// (travelToPlanet, lib/worldSeed.ts): niente scambio a caldo, il mondo
// Rapier si ricrea da zero.

export interface PlanetProfile {
  seed: number;
  // raggio della griglia di isolati: (2R+1)x(2R+1) isolati, il centrale e'
  // il parco, due angoli opposti sono piazze
  gridRadius: number;
  name: string;
}

// taglie possibili (2 = la citta' di sempre, 5x5 isolati)
export const GRID_RADII = [2, 3];
export const DEFAULT_GRID_RADIUS = 2;
export const BLOCK_SIZE = 60; // lato di un isolato (strada compresa)

const SYLLABLES = ['ka', 'lo', 'mi', 'ra', 've', 'zu', 'ti', 'or', 'an', 'el', 'sy', 'qu', 'da', 'no'];
function planetName(seed: number): string {
  let h = (seed * 2654435761) >>> 0;
  let s = '';
  for (let i = 0; i < 3; i++) {
    s += SYLLABLES[h % SYLLABLES.length];
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
  }
  return s[0].toUpperCase() + s.slice(1) + '-' + (seed % 997);
}

// il profilo di un seme: la taglia e' derivata dal seme se non e' data
export function profileFromSeed(seed: number, gridRadius?: number): PlanetProfile {
  const r = gridRadius !== undefined && GRID_RADII.includes(gridRadius) ? gridRadius : GRID_RADII[(Math.imul(seed, 0x9e3779b1) >>> 0) % GRID_RADII.length];
  return { seed, gridRadius: r, name: planetName(seed) };
}

let current: PlanetProfile = profileFromSeed(1, DEFAULT_GRID_RADIUS);
export const getPlanet = (): PlanetProfile => current;
// i pianeti gia' visitati restano nell'universo (anche quelli non nel catalogo fisso)
const visited = new Map<number, PlanetProfile>();
visited.set(current.seed, current);
export const setPlanet = (p: PlanetProfile) => {
  current = p;
  visited.set(p.seed, p);
};

// --- Rigenerazione a runtime ------------------------------------------------
// I moduli del mondo calcolano le loro misure/dati all'import (liste di
// strade, palazzi, folla...). Per cambiare pianeta senza ricaricare la pagina
// ognuno registra qui una funzione che li ricalcola: `export let X` (binding
// vivo, chi importa vede il valore nuovo) oppure svuota e riempie sul posto.
// I moduli si valutano dopo le loro dipendenze, quindi le funzioni si
// registrano, e girano, in ordine di dipendenza.
const rebuilders: Array<() => void> = [];
export const onPlanetRebuild = (fn: () => void) => {
  rebuilders.push(fn);
};
let epoch = 0;
const epochListeners = new Set<() => void>();
export const getPlanetEpoch = () => epoch;
const subscribeEpoch = (fn: () => void) => {
  epochListeners.add(fn);
  return () => epochListeners.delete(fn);
};
// React: cambia a ogni pianeta; la scena si rimonta con questa come key
export const usePlanetEpoch = (): number => useSyncExternalStore(subscribeEpoch, getPlanetEpoch);

// La scena si smonta DAVVERO prima di ricalcolare e rimontare: cambiare solo
// la key dentro un <Suspense> lascia l'albero vecchio montato (nascosto) e i
// suoi corpi Rapier restano nel mondo. unmountWorld() la toglie e aspetta che
// React la smonti; rebuildPlanet() ricalcola i dati e la rimonta nuova.
let mounted = true;
export const isWorldMounted = () => mounted;
export const usePlanetMounted = (): boolean => useSyncExternalStore(subscribeEpoch, () => mounted);
const notify = () => epochListeners.forEach((l) => l());
// Smontando, R3F libera geometrie e materiali, molti condivisi a livello di
// modulo: se la GPU li distrugge davvero, il mondo nuovo li ritrova distrutti e
// il renderer WebGPU smette di disegnare ("Buffer used in submit while
// destroyed", schermo nero). Per qualche secondo dallo smontaggio buffer e
// texture GPU non si distruggono (si perde un po' di memoria GPU a ogni
// cambio di mondo; lo stesso problema c'e' gia' col cambio di testScene).
function holdGpuDestroy(ms: number) {
  const g = globalThis as any;
  const protos = [g.GPUBuffer?.prototype, g.GPUTexture?.prototype].filter(Boolean);
  const origs = protos.map((p) => p.destroy);
  protos.forEach((p) => {
    p.destroy = function () {};
  });
  window.setTimeout(() => protos.forEach((p, i) => (p.destroy = origs[i])), ms);
}

let physEpoch = 0;
export const usePhysicsEpoch = (): number => useSyncExternalStore(subscribeEpoch, () => physEpoch);
// mondo Rapier nuovo (PhysicsHost.tsx): solo a figli del mondo gia' smontati
export async function recreatePhysics() {
  physEpoch++;
  notify();
  await new Promise<void>((r) => window.setTimeout(r, 600));
}

export async function unmountWorld() {
  holdGpuDestroy(4000);
  mounted = false;
  notify();
  await new Promise<void>((r) => window.setTimeout(r, 1200)); // qualche frame: i cleanup girano
}

// ricalcola tutto il mondo per il profilo corrente (setPlanet gia' fatto) e
// rimonta la scena
export let worldBornAt = 0; // ms: quando e' nato il mondo montato adesso (le citta' crescono a partire da qui)
// (in due tempi: i dati si ricalcolano a mondo smontato e si possono "scaldare" a pezzetti, poi si monta)
// il pianeta di cui sono costruiti adesso i dati del mondo (citta', strade, ...): puo' essere diverso da quello salvato quando si
// anticipa un pianeta avvicinandosi (previewWorldSeed in lib/worldSeed.ts: la citta' da lontano, CityProxy.tsx)
let dataSeed = current.seed;
export const getDataSeed = () => dataSeed;
let dataVersion = 0;
const dataListeners = new Set<() => void>();
export const usePlanetData = (): number =>
  useSyncExternalStore(
    (l) => {
      dataListeners.add(l);
      return () => dataListeners.delete(l);
    },
    () => dataVersion
  );
export function rebuildPlanetData() {
  for (const fn of rebuilders) fn();
  dataSeed = current.seed;
  dataVersion++;
  dataListeners.forEach((l) => l());
}
export function mountPlanetWorld() {
  worldBornAt = performance.now();
  epoch++;
  mounted = true;
  notify();
}
export function rebuildPlanet() {
  rebuildPlanetData();
  mountPlanetWorld();
}

export interface PlanetGeometry {
  gridRadius: number;
  blockSize: number;
  // le strade vanno un anello oltre l'ultimo isolato
  roadRadius: number;
  roadExtent: number; // |coordinata| dell'ultima strada
  roadSize: number; // lato di strade e terreno
}

export function planetGeometry(p: PlanetProfile = current): PlanetGeometry {
  const R = p.gridRadius;
  return {
    gridRadius: R,
    blockSize: BLOCK_SIZE,
    roadRadius: R + 1,
    roadExtent: (R + 1) * BLOCK_SIZE,
    // 600 per la citta' di sempre (R=2): un anello di terreno oltre le strade
    roadSize: 2 * ((R + 1) * BLOCK_SIZE + 120),
  };
}

// Le piazze (mercato e deposito della missione, missions/storyPlaces.ts, con
// tutte le sue coordinate) restano agli isolati (-2,2) e (2,-2) su ogni
// pianeta: la storia vive nel cuore della citta', gli anelli in piu' sono
// isolati normali. `_R` resta per compatibilita' con i chiamanti.
export const isPlazaBlock = (i: number, j: number, _R = current.gridRadius): boolean =>
  (i === -2 && j === 2) || (i === 2 && j === -2);

// Il blocco vuoto a ovest (ospedale, polizia, banca, parcheggi) sta oltre
// l'ultimo isolato: si sposta di un isolato per ogni anello in piu'.
export const serviceShiftX = (p: PlanetProfile = current): number => -(p.gridRadius - DEFAULT_GRID_RADIUS) * BLOCK_SIZE;

// Stile del pianeta, derivato dal seme (stesso seme = stesso stile): cielo,
// nebbia, palazzi, gravita'. Letto all'import dai moduli del mondo, come la
// geometria. Acqua e pioggia non sono ancora collegate.
export interface PlanetStyle {
  gravity: number; // moltiplicatore sulla gravita' di base
  fogDensity: number; // moltiplicatore sulla nebbia
  fogTint: string; // colore della foschia di giorno
  skyRayleigh: number; // 3 = cielo terrestre; piu' alto = piu' saturo
  skyTurbidity: number;
  heightScale: number; // altezza dei palazzi
  density: number; // palazzi per isolato
  traffic: number; // auto del traffico
  vegetation: number; // alberi del parco
  cloudiness: number; // nuvole (meteo)
}

const FOG_TINTS = ['#c9d8e6', '#e6cfc0', '#c8e6d4', '#d9c8e6', '#e6e0b8', '#b8d4e6'];

export function styleFromSeed(seed: number): PlanetStyle {
  // un piccolo generatore proprio (non lo stream di worldRng, che dipende dal seme corrente)
  let a = (seed ^ 0x5bd1e995) >>> 0 || 1;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const range = (lo: number, hi: number) => lo + rnd() * (hi - lo);
  return {
    gravity: range(0.85, 1.2),
    fogDensity: range(0.6, 1.8),
    fogTint: FOG_TINTS[Math.floor(rnd() * FOG_TINTS.length)],
    skyRayleigh: range(2.4, 4.8),
    skyTurbidity: range(4, 10),
    heightScale: range(0.7, 1.35),
    density: range(0.85, 1.35),
    traffic: range(0.6, 1.5),
    vegetation: range(0.4, 2),
    cloudiness: range(0.25, 1.6),
  };
}

export const getPlanetStyle = (): PlanetStyle => styleFromSeed(current.seed);

// i pianeti raggiungibili: sempre gli stessi (stesso seme = stesso pianeta);
// quello dove si e' viene per primo
export const DESTINATION_SEEDS = [101, 202, 303, 404, 505];
export function planetCatalog(): PlanetProfile[] {
  const all = new Map<number, PlanetProfile>();
  DESTINATION_SEEDS.forEach((sd, i) => all.set(sd, profileFromSeed(sd, GRID_RADII[i % GRID_RADII.length])));
  visited.forEach((p, sd) => all.set(sd, p));
  return [current, ...[...all.values()].filter((p) => p.seed !== current.seed)];
}
export const planetSizeLabel = (r: number) => `${2 * r + 1}x${2 * r + 1} isolati`;
