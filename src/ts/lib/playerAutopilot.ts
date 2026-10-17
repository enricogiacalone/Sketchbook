// Pilota automatico del giocatore vero (PlayerCombatSoldier): invece dei tasti,
// un comando in coordinate del mondo. Con `active` spento non cambia niente e
// restano i tasti. Lo scrive chi guida (laboratorio personaggi, charLab) e lo
// legge PlayerCombatSoldier (locomozione, pugni, mira) come se fosse input.

export type AutoGait = 'walk' | 'jog' | 'sprint';

export interface PlayerAutoCmd {
  active: boolean;
  // direzione in cui camminare, nel mondo (versore, o 0,0 = fermo)
  mx: number;
  mz: number;
  gait: AutoGait;
  // si gira verso il nemico piu' vicino (come tenere premuto lock-on)
  lockOn: boolean;
  // un pugno (si consuma quando il giocatore lo prende)
  attack: boolean;
  // niente torsione del busto verso la camera (telecamera libera che segue il giocatore: laboratorio)
  freeTorso: boolean;
}

export const playerAuto: PlayerAutoCmd = { active: false, mx: 0, mz: 0, gait: 'jog', lockOn: false, attack: false, freeTorso: false };

export function takeAutoAttack(): boolean {
  const a = playerAuto.attack;
  playerAuto.attack = false;
  return a;
}

// L'input del giocatore con il pilota sopra: ogni lettura guarda `playerAuto`
// in quel momento (il pilota cambia ogni frame, l'input React no).
export function withAutopilot<T extends object>(raw: T): T {
  return new Proxy(raw, {
    get(target: any, key: string | symbol) {
      if (playerAuto.active && typeof key === 'string') {
        switch (key) {
          case 'forward':
          case 'backward':
          case 'left':
          case 'right':
            return false; // la direzione la da' playerAuto (vedi PlayerCombatSoldier)
          case 'shift':
            return playerAuto.gait !== 'walk';
          case 'sprintMash':
            return () => (playerAuto.gait === 'sprint' ? 1 : 0);
          case 'lockOn':
            return playerAuto.lockOn;
          case 'primary':
            return playerAuto.attack;
          case 'consumeJustPressed':
            return (action: string) => (action === 'primary' ? takeAutoAttack() : target.consumeJustPressed(action));
        }
      }
      return target[key];
    },
  }) as T;
}
