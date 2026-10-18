// "la struttura della citta' cosi' non dobbiamo rigenerarla diversa tutte le
// volte": la citta' (palazzi, dettagli, alberi) si genera da un seme. Lo
// stesso seme da' sempre la stessa citta'. Il seme sta nel database del
// server (server.js, tabella world); se il server non risponde, quello
// ricordato nel browser. Va letto PRIMA di caricare il gioco (main.tsx):
// la citta' si genera quando il suo modulo viene importato.

import { citySite, setCurrentSite } from './site';
import { DEFAULT_GRID_RADIUS, profileFromSeed, setPlanet, type PlanetProfile } from './planet';

const LS_KEY = 'sketchbook-world-seed';
const LS_KEY_GRID = 'sketchbook-world-grid';
let seed = 1;

export const getWorldSeed = () => seed;

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 1500): Promise<any | null> {
  const ctl = new AbortController();
  const id = window.setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    // senza server (solo Vite) torna la pagina html: non e' una risposta
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('application/json')) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    window.clearTimeout(id);
  }
}

const readLocal = (): { seed: number; gridRadius?: number } | null => {
  try {
    const v = Number(localStorage.getItem(LS_KEY));
    if (!(Number.isInteger(v) && v > 0)) return null;
    const g = Number(localStorage.getItem(LS_KEY_GRID));
    return { seed: v, gridRadius: Number.isInteger(g) && g > 0 ? g : undefined };
  } catch {
    return null;
  }
};
const writeLocal = (p: PlanetProfile) => {
  try {
    localStorage.setItem(LS_KEY, String(p.seed));
    localStorage.setItem(LS_KEY_GRID, String(p.gridRadius));
  } catch {
    /* niente */
  }
};

// legge il pianeta salvato (server, se no il browser) e lo imposta
export async function initWorldSeed(): Promise<number> {
  const res = await fetchJson('/api/world');
  const fromServer = Number(res?.seed);
  let profile: PlanetProfile;
  if (Number.isInteger(fromServer) && fromServer > 0) {
    const g = Number(res?.gridRadius);
    profile = profileFromSeed(fromServer, Number.isInteger(g) && g > 0 ? g : DEFAULT_GRID_RADIUS);
  } else {
    const l = readLocal();
    profile = l ? profileFromSeed(l.seed, l.gridRadius ?? DEFAULT_GRID_RADIUS) : profileFromSeed(Math.floor(Math.random() * 2147483646) + 1);
  }
  seed = profile.seed;
  setPlanet(profile);
  setCurrentSite(citySite(profile.seed)); // si parte sempre dalla citta' (polo nord del pianeta)
  writeLocal(profile);
  return seed;
}

// cambio pianeta a runtime (lib/warp.ts): il seme dei numeri casuali segue il profilo
export function applyWorldSeed(profile: PlanetProfile) {
  seed = profile.seed;
  setPlanet(profile);
  writeLocal(profile);
}

// cambio pianeta con ricarica: salva il profilo (server e browser) e ricarica la pagina.
// La ricarica smonta tutto e ricrea da zero il mondo fisico Rapier: le
// ricariche a caldo danno errori noti ("unreachable / recursive use").
export async function travelToPlanet(profile: PlanetProfile) {
  const res = await fetchJson('/api/world/reseed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seed: profile.seed, gridRadius: profile.gridRadius }),
  });
  void res;
  writeLocal(profile);
  window.location.reload();
}

// nuova citta': nuovo seme, poi si ricarica la pagina
export async function reseedWorld() {
  await travelToPlanet(profileFromSeed(Math.floor(Math.random() * 2147483646) + 1));
}

// numeri casuali ripetibili (mulberry32): uno "stream" per ogni cosa che si
// genera (tag + indice), cosi' aggiungere un numero da una parte non cambia
// il resto della citta'
function hash(str: string, n: number): number {
  let h = (2166136261 ^ seed ^ Math.imul(n | 0, 0x9e3779b1)) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
export function worldRng(tag: string, index = 0): () => number {
  let a = hash(tag, index) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { fetchJson };
