// Gli ordini del giocatore ai suoi alleati (testo libero dalla chat): riconosciuti
// con parole chiave, cosi' funzionano subito anche senza il modello linguistico.

export type OrderKind = 'follow' | 'attack' | 'defend' | 'stay' | 'dismiss';
export type TargetKind = 'police' | 'civilian' | 'enemy' | 'any';

export interface Order {
  kind: OrderKind;
  target: TargetKind;
  // "tutti": non si ferma dopo il primo bersaglio
  all: boolean;
}

const norm = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export function parseOrder(text: string): Order | null {
  const t = norm(text);
  const has = (re: RegExp) => re.test(t);
  let kind: OrderKind | null = null;
  if (has(/\b(non seguirmi|smetti di seguirmi|vai via|vattene|congedat\w*|puoi andare|sei libero|sciogliti|addio|lasciami)\b/)) kind = 'dismiss';
  else if (has(/\b(fermo|ferma|fermati|resta\w*|aspetta\w*|rimani|stai (qui|li|fermo)|stop|basta)\b/)) kind = 'stay';
  else if (has(/\b(uccid\w*|ammazz\w*|elimin\w*|attacc\w*|spara\w*|fai fuori|fallo fuori|falli fuori|colpisc\w*|distrugg\w*|massacra\w*|kill)\b/)) kind = 'attack';
  else if (has(/\b(difend\w*|proteggi\w*|coprimi|copri\w*|guardami le spalle)\b/)) kind = 'defend';
  else if (has(/\b(segui\w*|vieni|con me|dietro di me|accompagna\w*|follow)\b/)) kind = 'follow';
  if (!kind) return null;
  let target: TargetKind = 'any';
  if (has(/\b(poliz\w*|agent\w*|sbirr\w*|cop|carabinier\w*|pula|swat)\b/)) target = 'police';
  else if (has(/\b(nemic\w*|cattiv\w*|ostil\w*|bandit\w*|criminal\w*|malvivent\w*)\b/)) target = 'enemy';
  else if (has(/\b(passant\w*|civil\w*|pedon\w*|gente|person\w*|tizi\w*|donn\w*|ragazz\w*|uomo|uomini|cittadin\w*)\b/)) target = 'civilian';
  const all = has(/\b(tutti|tutte|ogni|chiunque|sterminali|massacra\w*)\b/);
  return { kind, target, all };
}

export const LINES = {
  follow: ['Ti seguo!', 'Va bene, capo.', 'Sono con te.'],
  attack: ['Ci penso io!', 'Sara\' fatto.', 'Ricevuto. Vado.'],
  defend: ['Ti copro!', 'Non ti toccheranno.'],
  stay: ['Resto qui.', 'Agli ordini, aspetto.'],
  dismiss: ['Ok, ci vediamo.', 'Come vuoi. Ciao!'],
  done: ['Fatto.', 'Missione compiuta.'],
  none: ['Non vedo nessuno.', 'Non c\'e\' nessuno qui intorno.'],
  die: ['Argh...'],
};
export const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
