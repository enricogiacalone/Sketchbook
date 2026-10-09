import type { Quat, Vec3 } from './netTypes';

// Auto della citta' guidate da un ALTRO giocatore: CityPlayer.tsx le scrive
// qui ogni frame dai pacchetti di rete; Car.tsx, se trova la propria id,
// smette di simulare e segue quella posa (corpo cinematico), cosi' tutti
// vedono la stessa auto muoversi invece di una copia ferma al parcheggio.
export interface RemoteCarPose {
  p: Vec3;
  q: Quat;
  driver: string;
  at: number; // performance.now() dell'ultimo aggiornamento
}

export const remoteDrivenCars = new Map<string, RemoteCarPose>();

// oltre questo tempo senza aggiornamenti l'auto torna fisica (il guidatore
// e' sceso, si e' disconnesso, ha perso la connessione)
export const REMOTE_CAR_STALE_MS = 500;

export function isRemoteDriven(id: string, now = performance.now()): boolean {
  const r = remoteDrivenCars.get(id);
  return !!r && now - r.at < REMOTE_CAR_STALE_MS;
}
