import { BANK } from '../components/Environment/streetPropsData';
import { YARD } from './storyPlaces';

// "Il colpo del secolo": la terza missione. Vito (finite le altre due) ti
// propone la Banca Centrale:
//   1. procurati un'auto per la fuga
//   2. recluta due complici (chat: "seguimi" ai passanti vicini)
//   3. alla banca: guardie armate all'ingresso
//   4. forza la cassaforte -- scatta l'allarme: resisti mentre arriva la polizia
//   5. con 4 stelle: semina la polizia (traffico, inseguimento, ricerca)
//   6. raggiungi il rifugio (il deposito) senza stelle: si divide il bottino
// Morire o essere arrestati col bottino fa ricominciare dalla banca.
// (la logica e' in Missions/HeistMission.tsx; qui testi e luoghi)

export const MISSION_3 = 'colpo';
export const MISSION_3_TITLE = 'Il colpo del secolo';

export type HeistStep = 'idle' | 'h_car' | 'h_crew' | 'h_bank' | 'h_drill' | 'h_escape' | 'h_done';

// acceso dal dialogo di Vito (StoryMission.tsx), letto da HeistMission
export const heistBus = { start: false, active: false, talk: false, prompt: null as string | null };

// l'ingresso (la facciata guarda a est) e il punto della cassaforte
export const VAULT: [number, number] = [BANK.x + BANK.w / 2 + 2.6, BANK.z];
export const HIDEOUT: [number, number] = [YARD.x - 6, YARD.z + 1];
export const CREW_NEEDED = 2;
export const DRILL_S = 14;
export const LOOT = 3000;
export const CREW_BONUS = 250;

// le guardie della banca: sul piazzale davanti all'ingresso e sul marciapiede di fronte
export const BANK_GUARDS: Array<{ x: number; z: number; facing: number }> = [
  { x: VAULT[0] + 1.5, z: VAULT[1] - 4, facing: Math.PI / 2 },
  { x: VAULT[0] + 1.5, z: VAULT[1] + 4, facing: Math.PI / 2 },
  { x: VAULT[0] + 0.5, z: VAULT[1] - 10, facing: Math.PI / 2 },
  { x: VAULT[0] + 0.5, z: VAULT[1] + 10, facing: Math.PI / 2 },
  { x: VAULT[0] + 15, z: VAULT[1], facing: -Math.PI / 2 },
];

export const HEIST_OBJECTIVES: Record<HeistStep, string> = {
  idle: '',
  h_car: "Procurati un'auto per la fuga: sali su una qualsiasi (i parcheggi sono a ovest).",
  h_crew: 'Recluta 2 complici: apri la chat (Invio) e di\' "seguimi" ai passanti vicini.',
  h_bank: 'La Banca Centrale (nord-ovest): elimina le guardie e raggiungi la cassaforte all\'ingresso.',
  h_drill: 'Forzatura in corso! Resisti nella zona della cassaforte: arriva la polizia!',
  h_escape: 'Hai il bottino! Semina la polizia (quattro stelle) e portalo al rifugio, a sud-est.',
  h_done: '',
};
