// Dialoghi con i personaggi (Missions/StoryMission.tsx): stato condiviso
// fuori da React, letto ogni frame da useInput.ts (vicino a qualcuno: il
// Triangolo del pad parla invece di salire in auto; dialogo aperto: niente
// spari, salti, cambi d'arma) e da UI/DialogueBox.tsx (le scelte tornano
// a chi ha aperto il dialogo con choose/advance/close).

export interface DialogueOption {
  label: string;
  // va a un'altra battuta (null = chiude)
  goto?: string | null;
  // fatto quando si sceglie (soldi, passo della missione...)
  action?: () => void;
  // non sceglibile (es. pochi soldi): si vede in grigio
  disabled?: boolean;
}

export interface DialogueNode {
  // chi parla (vuoto: il personaggio con cui si parla; 'Tu': il giocatore)
  speaker?: string;
  text: string;
  options?: DialogueOption[];
  // senza scelte: la battuta dopo (null o assente = fine)
  next?: string | null;
  // fatto quando la battuta compare
  onEnter?: () => void;
}

export type DialogueTree = Record<string, DialogueNode> & { start: DialogueNode };

export const talkState = {
  // id del personaggio (o oggetto) a portata di mano, null = nessuno
  near: null as string | null,
  open: false,
};

type Handlers = { choose: (i: number) => void; advance: () => void; close: () => void };
let handlers: Handlers | null = null;
export function setDialogueHandlers(h: Handlers | null) {
  handlers = h;
}
export const dialogueInput = {
  choose: (i: number) => handlers?.choose(i),
  advance: () => handlers?.advance(),
  close: () => handlers?.close(),
};
