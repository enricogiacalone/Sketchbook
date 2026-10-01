// Corpi rigidi dei veicoli guidabili (Car.tsx): i combattenti del duello li
// usano per non attraversarli a piedi e per essere investiti (vedi
// useRagdollSolidBodies.resolveObstacleContacts). I veicoli non sono nel
// gruppo Characters, quindi le query "a misura di personaggio" non li
// vedono da sole.
export const vehicleBodyHandles = new Set<number>();
if (import.meta.env.DEV) (window as any).__vehicleBodyHandles = vehicleBodyHandles;

// Auto lontane disegnate in blocco (FarCars.tsx): chi e' oltre la distanza
// di dettaglio nasconde il suo modello e lascia qui l'oggetto da cui
// leggere la posa (matrixWorld del modello, scala compresa).
import type { Object3D } from 'three';
export const farCars = new Map<string, Object3D>();
