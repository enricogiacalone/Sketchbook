// Semafori della citta': stesso ciclo per le luci disegnate (Road.tsx) e per
// il traffico (components/city/Traffic.tsx). Un'asse (0 = auto che vanno
// lungo X, 1 = lungo Z) ha il verde mentre l'altro ha il rosso, con un
// attimo di giallo e di rosso per tutti in mezzo.

export const SIGNAL_CYCLE_S = 16;
export type Light = 'green' | 'yellow' | 'red';

export const signalClock = () => performance.now() / 1000;

export function signalFor(axis: 0 | 1, t: number): Light {
  const p = ((t % SIGNAL_CYCLE_S) + SIGNAL_CYCLE_S) % SIGNAL_CYCLE_S;
  const q = axis === 0 ? p : (p + SIGNAL_CYCLE_S / 2) % SIGNAL_CYCLE_S;
  if (q < 6) return 'green';
  if (q < 7) return 'yellow';
  return 'red';
}
