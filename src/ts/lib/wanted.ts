import type { FighterData } from '../components/Environment/SquadArenaTypes';
import { useStore } from '../store';
import { ROAD_OFFSETS } from '../components/Environment/Road';

// Livello di ricercato alla GTA 5. I crimini del giocatore (e dei suoi
// alleati) danno "calore" solo se un poliziotto li vede o li sente; il
// calore sale di stelle (1-5); la polizia ti vede -> ti insegue; nessuno ti
// vede piu' -> le stelle lampeggiano e la polizia cerca nell'ultima zona
// nota; dopo un po' senza essere visto le stelle spariscono.

export type CrimeKind = 'gunshot' | 'assault' | 'murder' | 'copAssault' | 'copKill' | 'runover';

const HEAT: Record<CrimeKind, number> = {
  gunshot: 0.6,
  assault: 1.5,
  murder: 3.5,
  copAssault: 2.5,
  copKill: 4.5,
  runover: 3,
};
// calore minimo per ogni stella: 1, 2, 3, 4, 5
const LEVEL_AT = [0, 1, 4, 8, 14, 22];
// da quanto lontano un poliziotto assiste (o sente) un crimine
const WITNESS_DIST: Record<CrimeKind, number> = {
  gunshot: 65,
  assault: 38,
  murder: 45,
  copAssault: 9999,
  copKill: 9999,
  runover: 40,
};
const LOST_AFTER_S = 3; // senza essere visti, dopo tanto inizia la ricerca
const SEEN_TTL_S = 0.6;

export interface CopInfo {
  id: string;
  x: number;
  z: number;
  // ultimo istante (s) in cui ha visto il giocatore
  seenAt: number;
  car: boolean;
}

export const copRegistry = new Map<string, CopInfo>();

export const wanted = {
  level: 0,
  heat: 0,
  searching: false,
  // ultima posizione nota del giocatore
  lastX: 0,
  lastZ: 0,
  unseenFor: 0,
  searchLeft: 0,
  lastGunshotAt: -99,
  // fino a quando (s) il giocatore e' "violento" (ha sparato o colpito da poco):
  // a 1-2 stelle la polizia cerca di arrestarlo, finche' e' violento spara
  violentUntil: 0,
  // arresto in corso (0..): sale mentre un agente e' addosso al giocatore a piedi
  arrestT: 0,
  // area di ricerca (come GTA 4): centro e raggio, visibili sul radar
  searchCx: 0,
  searchCz: 0,
  searchR: 0,
};

const nowS = () => performance.now() / 1000;

export function registerCop(id: string, car = false): CopInfo {
  let c = copRegistry.get(id);
  if (!c) {
    c = { id, x: 0, z: 0, seenAt: -99, car };
    copRegistry.set(id, c);
  }
  return c;
}
export function unregisterCop(id: string) {
  copRegistry.delete(id);
}

// un poliziotto vede il giocatore adesso
export function copSeesPlayer(id: string, px: number, pz: number) {
  const c = copRegistry.get(id);
  if (c) c.seenAt = nowS();
  wanted.lastX = px;
  wanted.lastZ = pz;
}

export function isPlayerSpotted(): boolean {
  const t = nowS();
  for (const c of copRegistry.values()) if (t - c.seenAt < SEEN_TTL_S) return true;
  return false;
}

function levelFor(heat: number) {
  let l = 0;
  for (let i = 1; i < LEVEL_AT.length; i++) if (heat >= LEVEL_AT[i]) l = i;
  return l;
}

function sync() {
  useStore.getState().setWanted(wanted.level, wanted.searching);
}

export function reportCrime(kind: CrimeKind, x: number, z: number) {
  const t = nowS();
  if (kind === 'gunshot') {
    // un colpo ogni tanto: non basta una raffica per fare 5 stelle
    if (t - wanted.lastGunshotAt < 1.2) return;
    wanted.lastGunshotAt = t;
  }
  if (wanted.level === 0) {
    let witnessed = false;
    const d2 = WITNESS_DIST[kind] ** 2;
    for (const c of copRegistry.values()) {
      if ((c.x - x) ** 2 + (c.z - z) ** 2 < d2) {
        witnessed = true;
        break;
      }
    }
    if (!witnessed) return;
  }
  wanted.violentUntil = Math.max(wanted.violentUntil, t + (kind === 'copKill' || kind === 'copAssault' ? 25 : 10));
  wanted.heat += HEAT[kind];
  if (kind === 'copKill') wanted.heat = Math.max(wanted.heat, LEVEL_AT[2]);
  if (kind === 'copAssault') wanted.heat = Math.max(wanted.heat, LEVEL_AT[1]);
  const prev = wanted.level;
  wanted.level = Math.max(wanted.level, levelFor(wanted.heat));
  if (wanted.level > 0 && prev === 0) {
    const pp = useStore.getState().playerPos;
    wanted.lastX = pp[0];
    wanted.lastZ = pp[2];
    wanted.unseenFor = 0;
  }
  // nuovo crimine: ti stanno gia' cercando, ora ti hanno trovato di nuovo
  wanted.searching = false;
  wanted.searchLeft = 0;
  sync();
}

// chi e' stato colpito dal giocatore (o dai suoi alleati) e quando: un passante
// si arrabbia solo con chi l'ha colpito davvero (CrowdPedestrian)
const playerHitAt = new Map<string, number>();
export function markPlayerHit(id: string) {
  playerHitAt.set(id, nowS());
}
export function playerHitRecently(id: string, within = 3): boolean {
  const t = playerHitAt.get(id);
  return t !== undefined && nowS() - t < within;
}

// il giocatore (o un suo alleato) ha colpito `target`
export function reportHit(target: FighterData, killed: boolean) {
  markPlayerHit(target.id);
  const team = target.team ?? '';
  if (team.startsWith('POLICE')) {
    reportCrime(killed ? 'copKill' : 'copAssault', target.position.x, target.position.z);
  } else if (team.startsWith('CIVILIAN')) {
    reportCrime(killed ? 'murder' : 'assault', target.position.x, target.position.z);
  }
}

export function clearWanted() {
  wanted.arrestT = 0;
  wanted.violentUntil = 0;
  wanted.level = 0;
  wanted.heat = 0;
  wanted.searching = false;
  wanted.searchLeft = 0;
  wanted.unseenFor = 0;
  sync();
}

// da chiamare a ogni frame (PoliceDirector)
export function stepWanted(dt: number) {
  const st = useStore.getState();
  if (st.health <= 0) {
    // sei morto: la polizia perde interesse (si riparte puliti)
    if (wanted.level > 0) clearWanted();
    return;
  }
  // arresto: cala da solo se nessuno e' addosso; solo a 1-2 stelle
  wanted.arrestT = wanted.level >= 1 && wanted.level <= 2 ? Math.max(0, wanted.arrestT - dt * 0.7) : 0;
  if (wanted.level === 0) return;
  if (isPlayerSpotted()) {
    wanted.unseenFor = 0;
    if (wanted.searching) {
      wanted.searching = false;
      sync();
    }
    return;
  }
  wanted.unseenFor += dt;
  if (!wanted.searching && wanted.unseenFor > LOST_AFTER_S) {
    wanted.searching = true;
    // piu' stelle = piu' ci vuole a seminarli
    wanted.searchLeft = 14 + wanted.level * 7;
    // l'area dove cercano: attorno all'ultimo punto in cui ti hanno visto
    wanted.searchCx = wanted.lastX;
    wanted.searchCz = wanted.lastZ;
    wanted.searchR = 30 + wanted.level * 10;
    sync();
  }
  if (wanted.searching) {
    // dentro l'area la polizia e' ancora addosso: il tempo scorre molto piu' piano
    const inside = Math.hypot(st.playerPos[0] - wanted.searchCx, st.playerPos[2] - wanted.searchCz) < wanted.searchR;
    wanted.searchLeft -= inside ? dt * 0.25 : dt;
    if (wanted.searchLeft <= 0) clearWanted();
  }
}

// Punto su una strada a `dist` metri dal giocatore (per far arrivare i
// rinforzi da lontano, fuori vista). Ritorna x, z e la direzione della strada
// verso il giocatore (yaw).
export function pickRoadSpawn(px: number, pz: number, dist: number): { x: number; z: number; yaw: number } {
  const lim = ROAD_OFFSETS[ROAD_OFFSETS.length - 1];
  const nearest = (v: number) => ROAD_OFFSETS.reduce((b, o) => (Math.abs(o - v) < Math.abs(b - v) ? o : b), ROAD_OFFSETS[0]);
  const th = Math.random() * Math.PI * 2;
  const qx = Math.max(-lim, Math.min(lim, px + Math.cos(th) * dist));
  const qz = Math.max(-lim, Math.min(lim, pz + Math.sin(th) * dist));
  const ox = nearest(qx);
  const oz = nearest(qz);
  let x: number;
  let z: number;
  if (Math.abs(qx - ox) < Math.abs(qz - oz)) {
    x = ox;
    z = qz;
  } else {
    x = qx;
    z = oz;
  }
  return { x, z, yaw: Math.atan2(px - x, pz - z) };
}

// un agente e' addosso al giocatore: l'arresto avanza
export function addArrest(dt: number) {
  wanted.arrestT = Math.min(3, wanted.arrestT + dt * 1.5);
}

export const isViolent = () => performance.now() / 1000 < wanted.violentUntil;

// livello di ricercato imposto (missioni: scatta l'allarme della banca)
export function setWantedLevel(level: number) {
  const l = Math.max(0, Math.min(5, Math.round(level)));
  const pp = useStore.getState().playerPos;
  wanted.heat = Math.max(wanted.heat, LEVEL_AT[l]);
  wanted.level = Math.max(wanted.level, l);
  wanted.searching = false;
  wanted.searchLeft = 0;
  wanted.lastX = pp[0];
  wanted.lastZ = pp[2];
  wanted.unseenFor = 0;
  wanted.violentUntil = Math.max(wanted.violentUntil, nowS() + 25);
  sync();
}
