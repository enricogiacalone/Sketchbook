// Comandi al giocatore da fuori (PlayerCombatSoldier.tsx li registra):
// teletrasporto per l'ospedale / la stazione di polizia (UI/PlayerFate.tsx).
export const playerControl = {
  teleport: null as null | ((x: number, z: number, rotation?: number) => void),
};
