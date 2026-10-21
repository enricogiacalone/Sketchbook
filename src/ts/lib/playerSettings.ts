// Impostazioni del giocatore salvate nel browser (localStorage): leggerle e scriverle non deve mai rompere il gioco.
const KEY = 'sketchbook.player.torsoFollowsCamera';
const load = (): boolean => {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
};

export const playerSettings = {
  // il busto si gira verso dove guarda la camera (rispetto alle gambe); spento, il busto resta quello dell'animazione
  _torso: load(),
  get torsoFollowsCamera(): boolean {
    return this._torso;
  },
  set torsoFollowsCamera(v: boolean) {
    this._torso = v;
    try {
      localStorage.setItem(KEY, v ? '1' : '0');
    } catch {
      /* niente */
    }
  },
};
