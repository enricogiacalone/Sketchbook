import * as THREE from 'three';
import { getPlanet, planetCatalog, type PlanetProfile } from './planet';
import { getCurrentSite, type Site } from './site';
import { hEff, surfaceHeight } from './planetSurface';

// Lo spazio: tutti i pianeti stanno nello stesso universo e ogni citta' e' al
// polo nord (+Y) del suo pianeta, quindi cambiare "sistema di riferimento"
// (rebase) e' solo una traslazione. L'origine del mondo di gioco e' sempre
// la citta' del pianeta corrente; il pianeta corrente e' una sfera col centro
// sotto di essa, gli altri stanno a qualche chilometro (posizioni fisse per
// seme). Si vola dalla citta' di un pianeta a quella di un altro; le citta'
// si montano (proceduralmente, con la fisica) solo quando il drone si avvicina
// al polo del loro pianeta, e si smontano quando ci si allontana.

export const PLANET_R = 3000; // raggio visivo dei pianeti (m)
export const MOUNT_DIST = 1900; // dal polo: la citta' si genera e si monta
export const UNMOUNT_DIST = 3800; // dal polo: la citta' si smonta

// Orbite: ogni pianeta gira attorno al sole (origine dell'universo) su un'orbita circolare
// leggermente inclinata, con periodo alla Keplero (T ~ r^1.5): i pianeti piu' vicini al sole
// girano piu' in fretta. Raggio, fase e inclinazione vengono dal seme.
export interface Orbit {
  r: number;
  phase: number;
  omega: number; // rad/s
  inc: number; // inclinazione (rad)
}
// Scala del sistema: i pianeti restano piccoli (3 km, la citta' e' una zolla piatta sul polo e piu'
// curvo non regge), il sole e' ~5 volte piu' grande e le orbite sono lontane (120-400 km): per
// andare da un pianeta all'altro servono decine di secondi di volo interplanetario.
const T0 = 2400; // s: periodo a ORBIT_R0
const ORBIT_R0 = 120000;
export const SPACE_FAR = 1_000_000; // piano lontano della camera nello spazio (m)
export function orbitOf(seed: number): Orbit {
  let h = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ (seed >>> 15)) >>> 0;
  const r = () => {
    h = (Math.imul(h ^ (h >>> 13), 0xc2b2ae35) + 0x6d2b79f5) >>> 0;
    return h / 4294967296;
  };
  const phase = r() * Math.PI * 2;
  const rad = ORBIT_R0 + r() * 280000;
  const inc = (r() - 0.5) * 0.3;
  return { r: rad, phase, inc, omega: (Math.PI * 2) / (T0 * Math.pow(rad / ORBIT_R0, 1.5)) };
}

// il tempo dello spazio: lo stesso orologio per tutti, cosi' i pianeti si muovono in modo coerente
export const spaceTime = () => performance.now() / 1000;

// posizione assoluta del polo (la citta') di un pianeta nell'universo, al tempo t
export function globalPole(seed: number, t = spaceTime()): [number, number, number] {
  const o = orbitOf(seed);
  const th = o.phase + o.omega * t;
  return [Math.cos(th) * o.r, Math.sin(th) * o.r * Math.sin(o.inc), Math.sin(th) * o.r * Math.cos(o.inc)];
}

// Il sole sta al centro del sistema: l'origine dell'universo. Una sfera luminosa; in volo
// nello spazio e' anche la luce (SunCycle.getSunDirection si fonde con spaceState.sunDir).
// Il riferimento di gioco e' quello del SITO corrente (lib/site.ts): l'origine e' un punto della
// superficie di un pianeta, l'alto lungo la normale. Pianeti, sole, stelle e orbite si esprimono
// li' (posizione e rotazione `siteFrame`).
export const SUN_R = 16000;
const _sun: [number, number, number] = [0, 0, 0];
export function sunPos(): [number, number, number] {
  refresh();
  return _sun;
}
// rotazione universo -> sito corrente (per sfere, stelle, orbite: i gruppi la usano come quaternione)
export const siteFrame = { quat: new THREE.Quaternion() };

export interface SpacePlanet {
  profile: PlanetProfile;
  pole: [number, number, number]; // la citta' (polo nord), nel riferimento del sito (si aggiorna da sola)
  center: [number, number, number]; // centro del pianeta nel riferimento del sito
  isCurrent: boolean; // il pianeta del sito corrente
  hPole: number; // quota della superficie al polo (la citta')
}

const hPoleCache = new Map<number, number>();
const poleH = (seed: number) => {
  let h = hPoleCache.get(seed);
  if (h === undefined) hPoleCache.set(seed, (h = hEff(surfaceHeight(seed, 0, 1, 0))));
  return h;
};
const _g = new THREE.Vector3();
const _c = new THREE.Vector3();
const _S = new THREE.Vector3();
// centro del pianeta nell'universo al tempo t (il polo e' G, la superficie al polo e' R + hPole sopra il centro)
function centerUniv(seed: number, t: number, out: THREE.Vector3): THREE.Vector3 {
  const g = globalPole(seed, t);
  return out.set(g[0], g[1] - PLANET_R - poleH(seed), g[2]);
}
// origine del sito (punto della superficie) nell'universo al tempo t
export function siteOriginUniv(site: Site, t: number, out: THREE.Vector3): THREE.Vector3 {
  centerUniv(site.planetSeed, t, out);
  const r = PLANET_R + site.hN;
  return out.set(out.x + site.n[0] * r, out.y + site.n[1] * r, out.z + site.n[2] * r);
}

// tutti i pianeti nel riferimento del sito corrente. Gli oggetti sono stabili finche' non cambia
// il pianeta corrente; le posizioni si aggiornano in sul posto (refresh)
let cache: { key: string; list: SpacePlanet[] } | null = null;
let lastRefresh = -1;
function refresh() {
  const now = performance.now();
  if (cache && now - lastRefresh < 3) return;
  lastRefresh = now;
  const site = getCurrentSite();
  const key = `${site.planetSeed}:${planetCatalog().length}`;
  if (!cache || cache.key !== key) {
    cache = {
      key,
      list: planetCatalog().map((profile) => ({
        profile,
        pole: [0, 0, 0] as [number, number, number],
        center: [0, 0, 0] as [number, number, number],
        isCurrent: profile.seed === site.planetSeed,
        hPole: poleH(profile.seed),
      })),
    };
  }
  const t = spaceTime();
  siteOriginUniv(site, t, _S);
  siteFrame.quat.copy(site.quat);
  _c.set(-_S.x, -_S.y, -_S.z).applyQuaternion(site.quat);
  _sun[0] = _c.x;
  _sun[1] = _c.y;
  _sun[2] = _c.z;
  for (const pl of cache.list) {
    centerUniv(pl.profile.seed, t, _c);
    _g.copy(_c).sub(_S).applyQuaternion(site.quat);
    pl.center[0] = _g.x;
    pl.center[1] = _g.y;
    pl.center[2] = _g.z;
    // polo (citta') = centro + (0, R + hPole, 0) nel riferimento dell'universo
    _g.set(_c.x, _c.y + PLANET_R + pl.hPole, _c.z).sub(_S).applyQuaternion(site.quat);
    pl.pole[0] = _g.x;
    pl.pole[1] = _g.y;
    pl.pole[2] = _g.z;
    pl.isCurrent = pl.profile.seed === site.planetSeed;
  }
}
export function spacePlanets(): SpacePlanet[] {
  refresh();
  return cache!.list;
}

// passaggio da un sito all'altro (al tempo t): rotazione Q e traslazione T che portano le coordinate
// del riferimento vecchio in quello nuovo (x' = Q x + T)
export function siteTransform(a: Site, b: Site): { q: THREE.Quaternion; t: THREE.Vector3 } {
  const time = spaceTime();
  const sa = siteOriginUniv(a, time, new THREE.Vector3());
  const sb = siteOriginUniv(b, time, new THREE.Vector3());
  const q = b.quat.clone().multiply(a.quat.clone().invert());
  const t = sa.sub(sb).applyQuaternion(b.quat);
  return { q, t };
}

// impostazioni del cielo (pannello Grafica): lo shader del cielo si puo' spegnere
// (resta un colore piatto, utile per prestazioni e per vedere il resto senza il cielo)
export const skySettings = { shader: true };

// stato condiviso, aggiornato ogni frame da UI/SpaceController.tsx
export const spaceState = {
  alt: 0, // quota sulla superficie del pianeta piu' vicino
  t: 0, // 0 = atmosfera, 1 = spazio (largo e dolce: fonde la luce del sole vero)
  // strati dell'atmosfera, ciascuno una funzione continua della quota (SpaceController):
  sunBlend: 0, // quanto il sole del cielo/della luce coincide col sole vero del sistema (1 oltre ~4.5 km)
  dark: 0, // 0 = cielo di giorno, 1 = nero (la cupola scura copre il cielo)
  fog: 1, // quanta nebbia resta
  cloud: 1, // quante nuvole restano
  boost: 1, // moltiplicatore della spinta del drone
  vmax: 40, // limite di velocita' del drone (m/s): sale con la quota sul corpo piu' vicino
  sunDir: [0, 1, 0] as [number, number, number], // dalla camera verso il sole
  resident: null as PlanetProfile | null, // il pianeta del mondo montato adesso (null = nessuno)
  site: null as Site | null, // il sito del riferimento corrente
};
export const getSpaceBoost = () => spaceState.boost;

// il riferimento cambia (rebase): il drone (e la camera) restano dove sono nel mondo, cambiano i numeri
// e la rotazione: x' = q x + t. Lo applica Drone.tsx al prossimo frame.
export const droneRebase = { q: new THREE.Quaternion(), t: new THREE.Vector3(), pending: false };
export function requestDroneRebase(q: THREE.Quaternion, t: THREE.Vector3) {
  // composizione con un eventuale rebase non ancora applicato
  droneRebase.t.applyQuaternion(q).add(t);
  droneRebase.q.premultiply(q);
  droneRebase.pending = true;
}
// (comodo nei test: spostamento puro, "sottrai d")
export function requestDroneShift(d: [number, number, number]) {
  requestDroneRebase(new THREE.Quaternion(), new THREE.Vector3(-d[0], -d[1], -d[2]));
}
