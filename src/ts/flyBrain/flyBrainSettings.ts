import type { FlyTask } from './flyController';

// Pannello "Cervello mosca" (CombatArenaGUI.tsx) <-> FlyBrainFighter.tsx.
// Oggetto mutabile letto ogni frame, come pistolHoldTuning/locomotionTuning.
export const flyBrainSettings = {
  show: false,
  task: 'stand' as FlyTask,
  resetNonce: 0,
  reloadNonce: 0,
  // "cervello spento": stesso corpo che insegue solo l'animazione, per confronto
  brainOff: false,
  info: 'spento',
};
