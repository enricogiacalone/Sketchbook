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
