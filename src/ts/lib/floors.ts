// Quota del pavimento sopra il terreno in un punto (piani, scale): chi cammina senza fisica verticale (i combattenti
// della citta': brains/hostile.ts) la somma alla quota del terreno. Senza piani registrati e' sempre 0.
let lift: ((x: number, z: number) => number) | null = null;
export const setFloorLift = (fn: ((x: number, z: number) => number) | null) => {
  lift = fn;
};
export const floorLift = (x: number, z: number) => (lift ? lift(x, z) : 0);
