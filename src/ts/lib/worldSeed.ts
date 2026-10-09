// "la struttura della citta' cosi' non dobbiamo rigenerarla diversa tutte le
// volte": la citta' (palazzi, dettagli, alberi) si genera da un seme. Lo
// stesso seme da' sempre la stessa citta'. Il seme sta nel database del
// server (server.js, tabella world); se il server non risponde, quello
// ricordato nel browser. Va letto PRIMA di caricare il gioco (main.tsx):
// la citta' si genera quando il suo modulo viene importato.

const LS_KEY = 'sketchbook-world-seed';
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

const readLocal = (): number | null => {
  try {
    const v = Number(localStorage.getItem(LS_KEY));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
};
const writeLocal = (v: number) => {
  try {
    localStorage.setItem(LS_KEY, String(v));
  } catch {
    /* niente */
  }
};

export async function initWorldSeed(): Promise<number> {
  const res = await fetchJson('/api/world');
  const fromServer = Number(res?.seed);
  if (Number.isInteger(fromServer) && fromServer > 0) seed = fromServer;
  else seed = readLocal() ?? Math.floor(Math.random() * 2147483646) + 1;
  writeLocal(seed);
  return seed;
}

// nuova citta': nuovo seme (sul server se c'e'), poi si ricarica la pagina
export async function reseedWorld() {
  const res = await fetchJson('/api/world/reseed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const next = Number(res?.seed);
  writeLocal(Number.isInteger(next) && next > 0 ? next : Math.floor(Math.random() * 2147483646) + 1);
  window.location.reload();
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
