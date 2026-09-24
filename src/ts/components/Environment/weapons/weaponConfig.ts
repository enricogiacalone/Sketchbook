// "analizzali ed estrai la pistola e la logica di sparo e mirata.
// aggiungilo al nostro personaggio" -- da:
//  - enari-engine (https://github.com/iErcann/enari-engine, licenza MIT,
//    (c) 2024 iercan): la PISTOLA (USP silenziata di fps_mine_sketch.glb,
//    solo i nodi dell'arma ROOT/UP/MAG/TRIGGER -- le mani/braccia in prima
//    persona del file sono escluse apposta, i loro materiali "v_hands"/
//    "t_phoenix" vengono da Counter-Strike) e la LOGICA DI SPARO: hitscan
//    (Player.shoot: raggio dall'occhio lungo la direzione di mira, colpo
//    "istantaneo", impulso al corpo colpito lungo la direzione del
//    raggio), cadenza (canShoot/rateOfFire), ricarica e zoom col tasto
//    destro (handleZoom). Texture dell'arma: Rock035 di ambientCG (CC0).
//  - Dusterheim (discourse.threejs.org/t/.../93170): codice non pubblico,
//    presi solo gli effetti descritti -- traccianti "world-locked", lampo
//    alla canna, fori (decal) e particelle d'impatto.
// Adattata alla nostra terza persona: il raggio di mira parte dalla
// camera attraverso il mirino, il proiettile vero parte dalla canna verso
// quel punto (il classico schema degli sparatutto in terza persona).
export const PISTOL_MODEL_URL = 'pistol-usp.glb';

// Lunghezza reale dell'arma col silenziatore (m) -- il modello e' in
// scala "viewmodel", viene riscalato a questa misura.
export const PISTOL_LENGTH_M = 0.3;
// Punti notevoli del modello, come frazione del suo box (misurati sul
// render del file originale: canna verso -Z, carrello verso +Y).
export const PISTOL_GRIP_FROM_REAR = 0.08; // centro dell'impugnatura, dal retro
export const PISTOL_GRIP_FROM_BOTTOM = 0.29;
export const PISTOL_BORE_FROM_TOP = 0.12; // asse canna/silenziatore, dall'alto

export const PISTOL_MAG_SIZE = 12;
// Semi-automatica: un colpo per pressione, al massimo uno ogni...
export const PISTOL_FIRE_INTERVAL_S = 0.16;
export const PISTOL_RELOAD_FALLBACK_S = 1.8; // se manca la clip Pistol_Reload

// Suoni (public/weapon-sounds, vedi PROVENIENZA.txt la' dentro).
export const PISTOL_SHOT_SOUND_URL = '/weapon-sounds/gun_shoot.mp3';
export const PISTOL_RELOAD_SOUND_URL = '/weapon-sounds/aksu_74_reload.mp3';
// aksu_74_reload.mp3 (2.66 s) misurato con silencedetect: 0.46 s di
// silenzio iniziale, poi tre rumori -- sgancio caricatore 0.46-0.53 s,
// inserimento 1.28-1.43 s, otturatore 2.10-2.39 s. Si salta l'inizio
// muto e la ricarica dura quanto il resto del suono, cosi' i rumori
// cadono sui movimenti del caricatore/carrello (vedi usePistolModel).
export const PISTOL_RELOAD_SOUND_OFFSET_S = 0.3;
export const PISTOL_RELOAD_S = 2.36;
// fasi della ricarica (frazione 0..1 di PISTOL_RELOAD_S), dai tempi sopra
export const RELOAD_MAG_OUT_END = 0.1; // caricatore fuori (click a ~0.07)
export const RELOAD_MAG_IN_START = 0.36; // rientra...
export const RELOAD_MAG_IN_END = 0.43; // ...click a ~0.42
export const RELOAD_SLIDE_START = 0.76; // carrello tirato (click a ~0.77)
export const RELOAD_SLIDE_END = 0.88;
export const PISTOL_SOUND_REF_DISTANCE = 3;
export const PISTOL_SHOT_VOLUME = 0.7;
export const PISTOL_RELOAD_VOLUME = 0.9;
export const PISTOL_RANGE_M = 150;
// Dispersione (cono, gradi): dall'anca molto meno precisa che in mira.
export const PISTOL_SPREAD_HIP_DEG = 2.5;
export const PISTOL_SPREAD_AIM_DEG = 0.25;
// Dopo uno sparo dall'anca il braccio resta alzato in mira per un attimo.
export const PISTOL_RAISE_AFTER_SHOT_S = 0.6;
// Rinculo del carrello (m) e tempo di ritorno.
export const PISTOL_SLIDE_KICK_M = 0.03;
export const PISTOL_SLIDE_RETURN_S = 0.09;

// Danni per zona (hp del duello = 250) e spinta del proiettile sul
// ragdoll attivo (variazione di velocita' del segmento colpito, m/s).
export const PISTOL_DAMAGE_BY_SEGMENT: Record<string, number> = {
  Head: 110,
  SpineHigh: 45,
  SpineMid: 45,
  Torso: 45,
  Hips: 40,
};
export const PISTOL_DAMAGE_LIMB = 25;
export const PISTOL_HIT_SPEED_BY_SEGMENT: Record<string, number> = {
  Head: 14,
  SpineHigh: 11,
  SpineMid: 11,
  Torso: 11,
  Hips: 10,
};
export const PISTOL_HIT_SPEED_LIMB = 9;
// Impulso su un corpo dinamico qualsiasi del mondo (N*s).
export const PISTOL_WORLD_IMPULSE = 1.5;
