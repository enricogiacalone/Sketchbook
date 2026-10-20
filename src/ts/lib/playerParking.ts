import { useSyncExternalStore } from 'react';

// Dove sta il giocatore mentre si pilota il drone. Il giocatore resta DOVE L'HAI LASCIATO: si ricorda la sua posizione sul
// pianeta (direzione dal centro, nel riferimento fisso del pianeta, + quota sul suolo + dove guardava), cosi' il cambio di
// sito (il mondo di gioco si ricrea) non lo sposta. Se il punto sta dentro la zona montata il giocatore riappare li'; se e'
// lontano e' "dormiente" (non montato) finche' non si torna o si preme B (che lo fa scendere sotto il drone).
export interface ParkedPlayer {
  seed: number;
  dir: [number, number, number]; // direzione unitaria dal centro del pianeta (riferimento del pianeta)
  fwd: [number, number, number]; // dove guardava (vettore orizzontale, riferimento del pianeta)
  above: number; // m sopra il suolo (tetti, scale)
}

export const parking = {
  parked: null as ParkedPlayer | null,
  dormant: false,
  epoch: 0, // cambia per rimontare il giocatore (nuovo punto di partenza)
};
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
export const setDormant = (d: boolean) => {
  if (parking.dormant === d) return;
  parking.dormant = d;
  notify();
};
export const respawnPlayer = () => {
  parking.dormant = false;
  parking.epoch++;
  notify();
};
let snapshot = { dormant: false, epoch: 0 };
const getSnapshot = () => {
  if (snapshot.dormant !== parking.dormant || snapshot.epoch !== parking.epoch) snapshot = { dormant: parking.dormant, epoch: parking.epoch };
  return snapshot;
};
export const usePlayerParking = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSnapshot
  );
