import type { DialogueTree } from '../lib/dialogue';
import { DESTINATION_SEEDS, profileFromSeed } from '../lib/planet';

// "Il Seme": la storia principale (docs/storia.md). Qui solo dati, testi e regole; il gioco la esegue in
// components/Missions/MainStory.tsx e la mostra in components/UI/MainStoryHUD.tsx.

export interface MainStoryState {
  started: boolean;
  home: number; // pianeta da cui si e' partiti (ha anche lui un frammento)
  elders: string[]; // anziani con cui si e' parlato: `${seed}:${villageId}`
  hints: number[]; // pianeti di cui si conosce la rovina
  fragments: number[]; // pianeti di cui si ha il frammento
  ending: null | 'awaken' | 'dream';
}
export const initialStory = (): MainStoryState => ({ started: false, home: 0, elders: [], hints: [], fragments: [], ending: null });

// pianeti con un frammento: quello di partenza e i cinque di destinazione
export const fragmentPlanets = (s: MainStoryState): number[] => [...new Set([s.home, ...DESTINATION_SEEDS].filter((x) => x > 0))];
export const planetName = (seed: number) => profileFromSeed(seed).name;

export type Hint = { kind: 'elder' | 'ruin' | 'planet' | 'lab' | 'done'; text: string };

// obiettivo di adesso, dato lo stato e il pianeta in cui si e' (seed)
export function currentObjective(s: MainStoryState, here: number): Hint {
  if (s.ending) return { kind: 'done', text: s.ending === 'awaken' ? 'La mosca e\' sveglia. Il sogno e\' finito.' : 'La mosca sogna ancora. Il sogno continua.' };
  const planets = fragmentPlanets(s);
  const missing = planets.filter((p) => !s.fragments.includes(p));
  if (missing.length === 0) return { kind: 'lab', text: 'Hai tutti i frammenti. Torna al Laboratorio cervello mosca (menu iniziale) e risveglia la mosca.' };
  if (missing.includes(here)) {
    if (s.hints.includes(here)) return { kind: 'ruin', text: 'Raggiungi le rovine segnate e prendi il frammento.' };
    return { kind: 'elder', text: "Parla con l'anziano di un villaggio: sa dove sono le rovine." };
  }
  // pianeta finito: il prossimo
  const next = missing[0];
  return { kind: 'planet', text: `Frammento di questo pianeta preso. Prossimo: ${planetName(next)} (lascia l'atmosfera col drone, menu pianeti).` };
}

const ELDER_NAMES = ['Mira', 'Bartolo', 'Ines', 'Tarso', 'Olga', 'Nilo', 'Sabra', 'Ettore', 'Veda', 'Corrado'];
export const elderName = (seed: number, villageId: number) => ELDER_NAMES[Math.abs((seed >>> 0) + villageId * 7) % ELDER_NAMES.length];
export const elderId = (seed: number, villageId: number) => `${seed}:${villageId}`;

export interface StoryActions {
  reveal: (seed: number) => void;
  markElder: (id: string) => void;
  say: (title: string, subtitle: string) => void;
}

export function elderDialogue(seed: number, villageId: number, s: MainStoryState, a: StoryActions): DialogueTree {
  const id = elderId(seed, villageId);
  const planet = planetName(seed);
  const hasFragment = s.fragments.includes(seed);
  const known = s.hints.includes(seed);
  const first = !s.elders.includes(id);
  const isStoryPlanet = fragmentPlanets(s).includes(seed);
  const mark = () => a.markElder(id);
  return {
    start: {
      text: first
        ? `Un viaggiatore col suo drone... Siediti, straniero. Io sono ${elderName(seed, villageId)}, e questo e' il nostro villaggio su ${planet}.`
        : `Bentornato, viaggiatore. Che cosa ti porta da ${elderName(seed, villageId)}?`,
      onEnter: mark,
      options: [
        { label: 'Cerco dei frammenti. Il Laboratorio mi manda.', goto: 'fragments' },
        { label: 'Chi ha costruito questo posto?', goto: 'builders' },
        { label: 'Solo di passaggio.', goto: 'bye' },
      ],
    },
    builders: {
      text: "I Costruttori. Dicono che non abbiano costruito il mondo: lo hanno sognato, con la mente piccola di una mosca. Per questo il cielo cambia, il fiume non e' mai uguale e gli alberi ricrescono... sempre un po' diversi.",
      next: 'builders2',
    },
    builders2: { text: 'Ma i sogni si consumano, straniero. Qualcosa si e\' rotto, e la mente e\' stata spezzata in pezzi. Uno per pianeta, nascosto dove la gente non va.', next: 'start' },
    fragments: isStoryPlanet
      ? hasFragment
        ? { text: `Hai gia' preso il frammento di ${planet}. Ne mancano ancora, su altri pianeti: l'aria li canta, se li ascolti. Vai, il Laboratorio ti aspetta.`, next: 'start' }
        : known
          ? { text: "Le rovine le hai gia' segnate: guarda la bussola in alto a sinistra. Il frammento brilla, non puoi sbagliare.", next: 'start' }
          : {
              text: "Le rovine dei Costruttori... a un'ora di cammino, dove l'erba e' piu' alta. Segnatele, ti guiderò.",
              options: [{ label: 'Segna le rovine sulla bussola.', goto: 'marked', action: () => { a.reveal(seed); a.say('ROVINE SEGNATE', `Una rovina su ${planet} e' ora sulla bussola`); } }],
            }
      : { text: `Su ${planet} le rovine sono mute: i Costruttori non lasciarono qui un frammento. Cerca sui pianeti vicini.`, next: 'start' },
    marked: { text: 'Fai attenzione: le rovine ricordano chi le disturba. E torna a trovarmi, se cerchi un consiglio.', next: null },
    bye: { text: 'Che il vento ti sia lieve. Quando vorrai ascoltare, io sono qui.', next: null },
  };
}

export const ENDING_TEXT = {
  awaken: {
    title: 'IL RISVEGLIO',
    text: "I frammenti si fondono. La mosca apre gli occhi dentro il corpo che non e' suo, si alza, fa un passo, poi un altro. Fuori i pianeti si fanno silenziosi: il sogno e' finito. Ma forse, ora, e' tutto vero.",
  },
  dream: {
    title: 'IL SOGNO CONTINUA',
    text: 'Lasci i frammenti dove sono: il Seme li ha riassorbiti. La mosca dorme e sogna, e nel suo sogno ci sono ancora fiumi, villaggi, rovine e un viaggiatore col suo drone. Si ricomincia, quando vuoi.',
  },
};
