import { useStore } from '../store';
import { fetchJson } from './worldSeed';

// "colleghiamo il db per ricordare dove mi trovo, le missioni completate e i
// soldi accumulati": un salvataggio per giocatore (il nome del menu
// iniziale) nel database del server (server.js, tabella progress), con una
// copia nel browser se il server non c'e'. Come in GTA si salva la
// situazione, non il punto esatto di una missione in corso: si riprende
// dall'inizio della missione non ancora finita.

export interface SaveData {
  v: 1;
  // dove ricomparire: x, z, imbardata (come store.playerYaw), quota dei
  // piedi (sul tetto di un palazzo si ricompare sul tetto)
  pos?: [number, number, number, number];
  cash: number;
  completed: string[];
  savedAt: number;
}

const lsKey = (player: string) => `sketchbook-save-${player}`;
const url = (player: string) => `/api/progress/${encodeURIComponent(player)}`;

function readLocal(player: string): SaveData | null {
  try {
    const raw = localStorage.getItem(lsKey(player));
    return raw ? (JSON.parse(raw) as SaveData) : null;
  } catch {
    return null;
  }
}

// carica (server, se no il browser; il piu' recente dei due) e lo mette nello
// store: soldi, missioni, punto di ripartenza
export async function loadGame(player: string): Promise<SaveData | null> {
  const st = useStore.getState();
  st.setPlayerName(player);
  const res = await fetchJson(url(player), undefined, 2000);
  const remote = (res?.data ?? null) as SaveData | null;
  const local = readLocal(player);
  const save = remote && local ? (local.savedAt > remote.savedAt ? local : remote) : (remote ?? local);
  if (!save) return null;
  st.setCash(save.cash);
  st.setCompletedMissions(save.completed ?? []);
  st.setSpawnPoint(save.pos ?? null);
  return save;
}

// la situazione di adesso (null se non si puo' salvare: duello, drone...)
function snapshot(): SaveData | null {
  const st = useStore.getState();
  if (!st.gameJoined || !st.playerName) return null;
  const data: SaveData = { v: 1, cash: st.cash, completed: st.completedMissions, savedAt: Date.now() };
  // la posizione solo in citta' e col personaggio (a piedi o in auto), non
  // col drone o in un test
  const keepPos = st.testScene === 'none' && !st.isDrone;
  if (keepPos) {
    const p = st.playerPos;
    const r = (v: number) => Math.round(v * 100) / 100;
    // (playerPos e' mezzo metro sopra i piedi, vedi PlayerCombatSoldier)
    data.pos = [r(p[0]), r(p[2]), r(st.playerYaw), r(p[1] - 0.5)];
  } else {
    const prev = readLocal(st.playerName);
    if (prev?.pos) data.pos = prev.pos;
  }
  return data;
}

let lastJson = '';
export function saveGame(opts: { beacon?: boolean } = {}) {
  const data = snapshot();
  if (!data) return;
  const player = useStore.getState().playerName;
  const json = JSON.stringify({ data });
  try {
    localStorage.setItem(lsKey(player), JSON.stringify(data));
  } catch {
    /* niente */
  }
  // (uguale a prima a parte l'ora: non si manda di nuovo)
  const key = JSON.stringify({ ...data, savedAt: 0 });
  if (key === lastJson && !opts.beacon) return;
  lastJson = key;
  if (opts.beacon && navigator.sendBeacon) {
    navigator.sendBeacon(url(player), new Blob([json], { type: 'text/plain' }));
    return;
  }
  fetch(url(player), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true }).catch(() => {});
}

// per i test: si riparte da zero
export async function deleteSave() {
  const st = useStore.getState();
  try {
    localStorage.removeItem(lsKey(st.playerName));
  } catch {
    /* niente */
  }
  const fresh: SaveData = { v: 1, cash: 200, completed: [], savedAt: Date.now() };
  await fetch(url(st.playerName), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: fresh }),
  }).catch(() => {});
  try {
    localStorage.setItem(lsKey(st.playerName), JSON.stringify(fresh));
  } catch {
    /* niente */
  }
  window.location.reload();
}
