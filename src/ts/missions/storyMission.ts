import type { DialogueTree } from '../lib/dialogue';

// "crea una missione interessante con personaggi con cui parlare e robe da
// fare" -- "La ricetta di nonna Rosa", crimine alla GTA:
//   1. Vito, al suo bar, ti affida un lavoro: i Serpenti gli hanno rubato un
//      pacco (puoi chiedere piu' soldi)
//   2. Lucky, all'edicola della Piazza del Mercato, sa dov'e' (lo paghi o lo
//      minacci -- se lo minacci avvisa i Serpenti, che ti aspettano fuori)
//   3. al deposito dei Serpenti: guardie, ripari, il pacco vicino alla baracca
//   4. preso il pacco arrivano i rinforzi: riportalo a Vito in tempo
//   5. Vito paga (e se glielo chiedi, ti dice cosa c'era dentro)
// In giro: Gina al bar, Salvo che vende frutta (ti rimette in sesto), Aldo
// sulla panchina che da' consigli, Marco al telefono.
//
// Questo file e' solo testo e scelte: i dialoghi sono costruiti da una
// funzione che riceve lo stato della storia e le azioni (StoryMission.tsx
// le esegue: soldi, passo della missione...).

export type StoryStep = 'meetVito' | 'findLucky' | 'warehouse' | 'escape' | 'done';

export interface StoryState {
  step: StoryStep;
  reward: number;
  greedy: boolean;
  snitched: boolean;
  cash: number;
  health: number;
}

export interface StoryActions {
  setStep: (s: StoryStep) => void;
  setReward: (amount: number, greedy: boolean) => void;
  pay: (amount: number) => void;
  heal: (amount: number) => void;
  setSnitched: () => void;
  complete: () => void;
}

export const STORY_TITLE = 'La ricetta di nonna Rosa';
export const ESCAPE_TIME_S = 180;
export const APPLE_PRICE = 10;
export const LUCKY_PRICE = 100;

export const OBJECTIVES: Record<StoryStep, string> = {
  meetVito: 'Vai al Bar Da Vito, vicino al parco, e parla con Vito.',
  findLucky: "Trova Lucky all'edicola della Piazza del Mercato (nord-ovest).",
  warehouse: 'Recupera il pacco al deposito dei Serpenti (sud-est).',
  escape: 'Riporta il pacco a Vito prima che i Serpenti ti riprendano!',
  done: '',
};

export function storyDialogue(npc: string, s: StoryState, a: StoryActions): DialogueTree | null {
  switch (npc) {
    case 'vito':
      if (s.step === 'meetVito')
        return {
          start: {
            text: 'Ehi, tu. Sì, proprio tu. Hai la faccia di uno che non fa troppe domande.',
            options: [
              { label: 'Dipende dalle domande.', goto: 'job' },
              { label: 'E tu chi saresti?', goto: 'who' },
              { label: 'Non ho tempo.', goto: 'bye' },
            ],
          },
          who: {
            text: 'Vito. Questo è il mio bar, e questo è il mio quartiere. E qualcuno mi ha mancato di rispetto.',
            next: 'job',
          },
          job: {
            text: 'I Serpenti, quei ragazzini con le giacche verdi, mi hanno fregato un pacco. Un pacco molto importante.',
            options: [
              { label: 'Lo riporto io. Quanto paghi?', goto: 'pay' },
              { label: "Cosa c'è dentro?", goto: 'secret' },
            ],
          },
          secret: { text: 'Roba che non ti riguarda. Ti basta sapere che vale più di te.', next: 'pay' },
          pay: {
            text: 'Trecento. In contanti, a lavoro finito.',
            options: [
              { label: 'Affare fatto.', goto: 'go', action: () => a.setReward(300, false) },
              { label: 'Facciamo cinquecento.', goto: 'greedy', action: () => a.setReward(500, true) },
              { label: 'Ci devo pensare.', goto: 'think' },
            ],
          },
          think: { text: 'Pensa in fretta. I Serpenti non aspettano, e io nemmeno.', next: null },
          greedy: {
            text: '...Hai fegato. Cinquecento. Ma se torni a mani vuote, i soldi li prendo da te.',
            next: 'go',
          },
          go: {
            text: "Lucky, quello dell'edicola nella Piazza del Mercato, sa dove l'hanno portato. Quel topo parla solo coi soldi... o con la paura.",
            onEnter: () => a.setStep('findLucky'),
            next: null,
          },
          bye: { text: 'Allora sparisci. Quando ti serve lavoro, sai dove trovarmi.', next: null },
        };
      if (s.step === 'findLucky') return { start: { text: 'Che ci fai ancora qui? Lucky. Edicola. Piazza del Mercato. Muoviti.' } };
      if (s.step === 'warehouse')
        return {
          start: {
            text: 'Il deposito dei Serpenti è a sud-est. Non farti ammazzare: mi servi vivo, almeno finché non mi riporti il pacco.',
          },
        };
      if (s.step === 'escape')
        return {
          start: {
            text: "Ce l'hai fatta! Fammi vedere... è intatto?",
            options: [
              { label: 'Intatto. Ecco il pacco.', goto: 'paid' },
              { label: "Prima dimmi cosa c'è dentro.", goto: 'reveal' },
            ],
          },
          reveal: {
            text: 'Va bene, te lo sei guadagnato. È il ricettario di mia nonna Rosa. I Serpenti vendevano cannoli in tutta la città... con la SUA ricetta.',
            next: 'reveal2',
          },
          reveal2: { text: 'Una vergogna. Adesso i cannoli tornano a casa. E tu hai un amico.', next: 'paid' },
          paid: {
            text: s.greedy
              ? `Ecco i tuoi ${s.reward}$. Tutti, come promesso. Non abituarti.`
              : `Ecco i tuoi ${s.reward}$. Te li sei guadagnati.`,
            onEnter: a.complete,
            next: null,
          },
        };
      return { start: { text: 'Ottimo lavoro, ragazzo. Torna più tardi: per uno come te ho sempre qualcosa da fare.' } };

    case 'lucky':
      if (s.step === 'findLucky')
        return {
          start: {
            text: 'Psst! Non qui in mezzo... Ah, ti manda Vito? Allora sai che le notizie costano.',
            options: [
              {
                label: `Ecco ${LUCKY_PRICE}$.`,
                goto: 'info',
                disabled: s.cash < LUCKY_PRICE,
                action: () => a.pay(LUCKY_PRICE),
              },
              { label: 'Parla, o ti faccio parlare io.', goto: 'threat' },
              { label: 'Ripasso dopo.', goto: null },
            ],
          },
          info: {
            text: "Il pacco è al deposito dei Serpenti, la piazza recintata a sud-est. Sono in quattro, armati. L'ingresso è il cancello a ovest.",
            onEnter: () => a.setStep('warehouse'),
            next: 'tip',
          },
          tip: {
            text: 'Un consiglio gratis: le guardie ci vedono poco, da lontano le prendi di sorpresa. E le casse fermano le pallottole. Io non ti ho mai visto.',
            next: null,
          },
          threat: {
            text: 'Ok, ok! Calma! Il deposito dei Serpenti, a sud-est, la piazza recintata! Il pacco è vicino alla baracca!',
            onEnter: () => {
              a.setSnitched();
              a.setStep('warehouse');
            },
            next: 'threat2',
          },
          threat2: { speaker: '', text: '(Appena ti giri, Lucky tira fuori il telefono e chiama qualcuno...)', next: null },
        };
      if (s.step === 'meetVito') return { start: { text: 'Giornali, riviste, biglietti del bus... Cerchi qualcosa? No? Allora circola.' } };
      if (s.step === 'done')
        return { start: { text: "Ho sentito che ai Serpenti è andata male. Bel lavoro. Non dire a nessuno che te l'ho detto." } };
      return { start: { text: 'Io non so niente, non ho visto niente, non ti conosco!' } };

    case 'gina':
      if (s.step === 'done')
        return { start: { text: 'Ho saputo della storia dei cannoli. In questo quartiere le notizie corrono più delle macchine.' } };
      return {
        start: {
          text: 'Il caffè di Vito è il migliore della città. Ti siedi?',
          options: [
            { label: "Com'è Vito?", goto: 'vito' },
            { label: 'Buona giornata.', goto: null },
          ],
        },
        vito: {
          text: 'Vito? Un gentiluomo. Con chi paga. Con gli altri... meglio non saperlo.',
          next: null,
        },
      };

    case 'salvo':
      return {
        start: {
          text: 'Frutta fresca! Arance, mele, limoni! Roba che ti rimette al mondo!',
          options: [
            {
              label: `Una mela (${APPLE_PRICE}$, rimette in sesto)`,
              goto: 'apple',
              disabled: s.cash < APPLE_PRICE,
              action: () => {
                a.pay(APPLE_PRICE);
                a.heal(30);
              },
            },
            { label: 'Come vanno gli affari?', goto: 'biz' },
            { label: 'Niente, grazie.', goto: null },
          ],
        },
        apple: { text: 'Tieni, la più bella del banco. Vedrai che ti senti meglio.', next: null },
        biz: {
          text:
            s.step === 'done'
              ? 'Meglio! Da quando i Serpenti si sono calmati, la gente è tornata a comprare.'
              : 'Male. I Serpenti passano ogni settimana a chiedere il pizzo. Se qualcuno desse loro una lezione...',
          next: null,
        },
      };

    case 'aldo':
      if (s.step === 'warehouse' || s.step === 'escape')
        return {
          start: {
            text: 'Vai dai Serpenti? Prendi una macchina, il deposito è lontano. E stai basso: dietro i container non ti vedono.',
          },
        };
      if (s.step === 'done') return { start: { text: 'Hai visto? Già sembra più tranquillo. Come ai miei tempi.' } };
      return {
        start: {
          text: 'Ai miei tempi il quartiere era tranquillo. Adesso ci sono quei Serpenti... stanno nel deposito a sud-est, giorno e notte.',
          options: [
            { label: 'Chi sono i Serpenti?', goto: 'who' },
            { label: 'Si sta bene qui.', goto: null },
          ],
        },
        who: {
          text: "Ragazzini con la pistola e la giacca verde. Si credono furbi. Prima o poi qualcuno gli insegna l'educazione.",
          next: null,
        },
      };

    case 'marco':
      return {
        start: {
          text: 'Sì, mamma... no, mamma... SÌ, ho mangiato. Scusa, sono al telefono.',
          options: [
            { label: 'Scusa tu.', goto: null },
            { label: "Sai dov'è l'aeroporto?", goto: 'airport' },
          ],
        },
        airport: { text: 'Fuori città, dove ci sono gli aerei. Ovviamente. ...No mamma, non parlavo con te.', next: null },
      };
  }
  return null;
}
