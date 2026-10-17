import { getPlanet, planetCatalog, type PlanetProfile } from './planet';

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
export const SURFACE_SINK = 4; // la sfera sta un po' sotto il terreno piatto della citta'

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
// Il riferimento di gioco segue il pianeta corrente, quindi il sole si muove in esso.
export const SUN_R = 16000;
const _sun: [number, number, number] = [0, 0, 0];
export function sunPos(): [number, number, number] {
  refresh();
  return _sun;
}

export interface SpacePlanet {
  profile: PlanetProfile;
  pole: [number, number, number]; // la citta', nel riferimento di gioco (si aggiorna da sola)
  center: [number, number, number];
  isCurrent: boolean;
}

// tutti i pianeti nel riferimento di gioco (origine = citta' del corrente). Gli oggetti sono
// stabili finche' non cambia il pianeta corrente; le posizioni si aggiornano in sul posto (refresh)
let cache: { key: string; list: SpacePlanet[] } | null = null;
let lastRefresh = -1;
function refresh() {
  const now = performance.now();
  if (cache && now - lastRefresh < 3) return;
  lastRefresh = now;
  const cur = getPlanet();
  const key = `${cur.seed}:${planetCatalog().length}`;
  if (!cache || cache.key !== key) {
    cache = {
      key,
      list: planetCatalog().map((profile) => ({
        profile,
        pole: [0, 0, 0] as [number, number, number],
        center: [0, 0, 0] as [number, number, number],
        isCurrent: profile.seed === cur.seed,
      })),
    };
  }
  const t = spaceTime();
  const g0 = globalPole(cur.seed, t);
  _sun[0] = -g0[0];
  _sun[1] = -g0[1];
  _sun[2] = -g0[2];
  for (const pl of cache.list) {
    if (pl.isCurrent) {
      pl.pole[0] = pl.pole[1] = pl.pole[2] = 0;
    } else {
      const g = globalPole(pl.profile.seed, t);
      pl.pole[0] = g[0] - g0[0];
      pl.pole[1] = g[1] - g0[1];
      pl.pole[2] = g[2] - g0[2];
    }
    const sink = pl.isCurrent ? SURFACE_SINK : 0;
    pl.center[0] = pl.pole[0];
    pl.center[1] = pl.pole[1] - PLANET_R - sink;
    pl.center[2] = pl.pole[2];
  }
}
export function spacePlanets(): SpacePlanet[] {
  refresh();
  return cache!.list;
}

// spostamento da applicare a tutto quando l'origine passa dal polo di `from` a
// quello di `to` (cio' che si sottrae alle posizioni)
export function poleShift(from: PlanetProfile, to: PlanetProfile): [number, number, number] {
  const t = spaceTime();
  const a = globalPole(from.seed, t);
  const b = globalPole(to.seed, t);
  return [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
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
  resident: null as PlanetProfile | null, // la citta' montata adesso (null = nessuna)
};
export const getSpaceBoost = () => spaceState.boost;

// il drone si sposta di questo (rebase): lo applica Drone.tsx al prossimo frame
export const droneRebase = { x: 0, y: 0, z: 0, pending: false };
export function requestDroneRebase(d: [number, number, number]) {
  droneRebase.x += d[0];
  droneRebase.y += d[1];
  droneRebase.z += d[2];
  droneRebase.pending = true;
}
