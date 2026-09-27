// Corpi rigidi dei veicoli guidabili (Car.tsx): i combattenti del duello li
// usano per non attraversarli a piedi e per essere investiti (vedi
// useRagdollSolidBodies.resolveObstacleContacts). I veicoli non sono nel
// gruppo Characters, quindi le query "a misura di personaggio" non li
// vedono da sole.
export const vehicleBodyHandles = new Set<number>();
if (import.meta.env.DEV) (window as any).__vehicleBodyHandles = vehicleBodyHandles;
