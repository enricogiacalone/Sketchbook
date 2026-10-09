// Dati PURI del ragdoll attivo (nessun import): condivisi dal gioco
// (ragdollConfig.ts li riesporta) e dall'addestramento del "cervello
// della mosca" in Node (training/fly-brain), che non puo' importare
// React/@react-three/rapier ne' enum TypeScript. Spostati qui tali e quali
// da ragdollConfig.ts, commenti compresi.

export interface RagdollSegment {
  name: string;
  // The one bone whose LOCAL transform gets overwritten from physics each
  // frame while the ragdoll drives this segment.
  drivingBone: string;
  // Name of the parent segment (by `name`), or null for the root (pelvis).
  parent: string | null;
  // Which bone marks the "far end" of this capsule -- its live world
  // position (relative to drivingBone) at activation time sets the
  // capsule's length and local orientation. Usually the child segment's
  // own drivingBone.
  toBone: string;
  radius: number;
  // Extra fraction to trim off the measured length so neighboring
  // capsules don't visibly overlap/z-fight at the joint (capsule caps are
  // already rounded, so a small margin reads better than none).
  lengthScale?: number;
  // Spostamenti degli estremi della capsula (metri, nel frame del
  // personaggio in posa di bind: X sinistra, Y su, Z avanti): l'inizio e'
  // drivingBone + fromOffset, la direzione va verso toBone + toOffset.
  // Servono dove l'osso non sta al centro della carne (testa, petto,
  // tallone). Solo il ragdoll attivo li legge (segmentCapsuleLocal).
  fromOffset?: [number, number, number];
  toOffset?: [number, number, number];
}

export const ACTIVE_RAGDOLL_SEGMENTS: RagdollSegment[] = [
  // Forme misurate sulla mesh di soldier-citizen.glb in posa a T con
  // scripts/ragdoll-fit.mjs (ottobre 2026): ogni pezzo copre la carne
  // dei SUOI vertici (osso dominante) e sporge al massimo ~3 cm, nessun
  // vertice resta fuori da tutte le capsule per piu' di ~4 cm (prima:
  // fino a 10 cm scoperti sulla testa, 7 su petto e spalle, sfera del
  // bacino che sporgeva di 9 cm). Le mani restano senza collider.
  //
  // Torso copre solo spine_01->spine_02, SpineMid e SpineHigh la loro
  // fetta (vedi la storia in git: un Torso fino a neck_01 impilava tre
  // corpi sulla stessa porzione di spina). Niente pezzo per il collo: lo
  // copre la capsula della testa.
  { name: 'Hips', drivingBone: 'pelvis', parent: null, toBone: 'spine_01', radius: 0.12, lengthScale: 1.1, fromOffset: [0, 0.004, 0.052] },
  {
    name: 'Torso',
    drivingBone: 'spine_01',
    parent: 'Hips',
    toBone: 'spine_02',
    radius: 0.124,
    lengthScale: 0.75,
    fromOffset: [0, 0, 0.037],
  },
  {
    name: 'SpineMid',
    drivingBone: 'spine_02',
    parent: 'Torso',
    toBone: 'spine_03',
    radius: 0.13,
    lengthScale: 1.43,
    toOffset: [0, -0.004, 0.024],
  },
  // petto: capsula ORIZZONTALE da spalla a spalla (x +-0.2 a y 1.36),
  // non lungo la spina -- il torace e' largo 34 cm e profondo 25
  {
    name: 'SpineHigh',
    drivingBone: 'spine_03',
    parent: 'SpineMid',
    toBone: 'neck_01',
    radius: 0.14,
    lengthScale: 1,
    fromOffset: [0.2, 0.078, -0.017],
    toOffset: [-0.2, -0.092, 0.021],
  },
  // testa: dal collo fin sopra il cranio (head_leaf sta 19 cm sotto la
  // sommita'), leggermente inclinata all'indietro come la nuca
  {
    name: 'Head',
    drivingBone: 'neck_01',
    parent: 'SpineHigh',
    toBone: 'head_leaf',
    radius: 0.095,
    lengthScale: 1.99,
    toOffset: [0, 0.005, -0.022],
  },
  {
    name: 'ClavicleL',
    drivingBone: 'clavicle_l',
    parent: 'SpineHigh',
    toBone: 'upperarm_l',
    radius: 0.056,
    lengthScale: 1.4,
    toOffset: [-0.015, 0, -0.002],
  },
  {
    name: 'UpperArm_L',
    drivingBone: 'upperarm_l',
    parent: 'ClavicleL',
    toBone: 'lowerarm_l',
    radius: 0.066,
    lengthScale: 1.02,
    fromOffset: [-0.051, 0.007, 0.002],
  },
  {
    name: 'ForeArm_L',
    drivingBone: 'lowerarm_l',
    parent: 'UpperArm_L',
    toBone: 'hand_l',
    radius: 0.052,
    lengthScale: 0.98,
    fromOffset: [-0.013, -0.007, 0],
    toOffset: [0, -0.009, 0.007],
  },
  {
    name: 'ClavicleR',
    drivingBone: 'clavicle_r',
    parent: 'SpineHigh',
    toBone: 'upperarm_r',
    radius: 0.056,
    lengthScale: 1.4,
    toOffset: [0.015, 0, -0.002],
  },
  {
    name: 'UpperArm_R',
    drivingBone: 'upperarm_r',
    parent: 'ClavicleR',
    toBone: 'lowerarm_r',
    radius: 0.066,
    lengthScale: 1.02,
    fromOffset: [0.051, 0.007, 0.002],
  },
  {
    name: 'ForeArm_R',
    drivingBone: 'lowerarm_r',
    parent: 'UpperArm_R',
    toBone: 'hand_r',
    radius: 0.052,
    lengthScale: 0.98,
    fromOffset: [0.013, -0.007, 0],
    toOffset: [0, -0.009, 0.007],
  },
  {
    name: 'Thigh_L',
    drivingBone: 'thigh_l',
    parent: 'Hips',
    toBone: 'calf_l',
    radius: 0.082,
    lengthScale: 1.03,
    fromOffset: [0.007, 0.07, -0.004],
  },
  {
    name: 'Shin_L',
    drivingBone: 'calf_l',
    parent: 'Thigh_L',
    toBone: 'foot_l',
    radius: 0.051,
    lengthScale: 1.08,
    fromOffset: [0.005, 0.022, -0.028],
    toOffset: [0, -0.002, -0.015],
  },
  // piede: dal tallone (5 cm dietro e 3 sotto la caviglia) alla punta
  {
    name: 'Foot_L',
    drivingBone: 'foot_l',
    parent: 'Shin_L',
    toBone: 'ball_l',
    radius: 0.052,
    lengthScale: 1.4,
    fromOffset: [0, -0.034, -0.049],
  },
  {
    name: 'Thigh_R',
    drivingBone: 'thigh_r',
    parent: 'Hips',
    toBone: 'calf_r',
    radius: 0.082,
    lengthScale: 1.03,
    fromOffset: [-0.007, 0.07, -0.004],
  },
  {
    name: 'Shin_R',
    drivingBone: 'calf_r',
    parent: 'Thigh_R',
    toBone: 'foot_r',
    radius: 0.051,
    lengthScale: 1.08,
    fromOffset: [-0.005, 0.022, -0.028],
    toOffset: [0, -0.002, -0.015],
  },
  {
    name: 'Foot_R',
    drivingBone: 'foot_r',
    parent: 'Shin_R',
    toBone: 'ball_r',
    radius: 0.052,
    lengthScale: 1.4,
    fromOffset: [0, -0.034, -0.049],
  },
];

export const ACTIVE_RAGDOLL_MASS_WEIGHT: Record<string, number> = {
  Hips: 0.199,
  Torso: 0.149,
  SpineMid: 0.0895,
  SpineHigh: 0.0596,
  Head: 0.081,
  // Non e' il vero 0.5% anatomico (una clavicola pesa pochissimo) --
  // misurato dal vivo (scomposizione swing/twist sui bone dopo la
  // sync 1:1 in modalita' passiva): con 0.005 la clavicola (massa
  // ~0.4kg) doveva reggere via il giunto sferico un braccio intero
  // appeso (upperarm+forearm ~3.75kg, rapporto 10:1) -- la coppia
  // gravitazionale/di collisione trasmessa dal braccio la faceva
  // accelerare troppo in fretta (bassa massa = bassa inerzia = alta
  // accelerazione angolare a parita' di coppia) perche' solveJointCones
  // riuscisse a correggerla entro i suoi limiti di velocita' per frame
  // (torsione misurata fino a ~133 gradi contro un limite di 90) --
  // il giunto restava sopraffatto invece di convergere. Alzata cosi'
  // da restare comunque molto piu' leggera di torso/braccio ma senza
  // il rapporto 10:1 che la rendeva dinamicamente instabile.
  ClavicleL: 0.02,
  ClavicleR: 0.02,
  UpperArm_L: 0.028,
  UpperArm_R: 0.028,
  ForeArm_L: 0.022, // include la mano (non simulata a parte), come "forearm and hand" di Winter
  ForeArm_R: 0.022,
  Thigh_L: 0.1,
  Thigh_R: 0.1,
  Shin_L: 0.0465,
  Shin_R: 0.0465,
  Foot_L: 0.0145,
  Foot_R: 0.0145,
};
// Peso di riserva per un segmento eventualmente assente dalla tabella
// sopra (non dovrebbe succedere con la lista attuale, ma se ne aggiungo
// uno domani e mi scordo di aggiornare la tabella, meglio una massa
// piccola ma finita che una eccezione o un corpo a massa zero).
export const ACTIVE_RAGDOLL_MASS_WEIGHT_FALLBACK = 0.02;
// Massa totale del combattente (kg) -- un adulto atletico medio, non
// misurata dal modello (le capsule non hanno un "peso reale" dichiarato
// altrove nel progetto).
export const ACTIVE_RAGDOLL_TOTAL_MASS_KG = 75;

export const ACTIVE_RAGDOLL_JOINT_LIMIT_FALLBACK_DEG = 150;
//
// Valori: unione di (a) il range MISURATO sulle clip usate in combattimento
// (Fighting Idle, Walk/Walk_Backwards/Strafe, Sprint/Jog, Dodge_*, Defend,
// Victory, Punch_Jab/Cross, Melee_Hook, Fighting Left/Right Jab,
// Hit_Chest/Head, Idle_A) allargato di 15 gradi per lato, e (b) un range
// anatomico di base (quanto un colpo puo' piegare un giunto oltre quello
// che fa l'animazione). Cosi' nessuna animazione del gioco finisce mai
// contro un limite, e un colpo o un KO non producono pose disumane.
// Ginocchia: iperestensione tenuta a -15.
export const ACTIVE_RAGDOLL_JOINT_LIMITS_DEG: Record<string, { x: [number, number]; y: [number, number]; z: [number, number] }> = {
  Torso: { x: [-31, 30], y: [-32, 33], z: [-25, 25] },
  SpineMid: { x: [-35, 56], y: [-36, 44], z: [-26, 41] },
  SpineHigh: { x: [-36, 39], y: [-44, 60], z: [-46, 32] },
  Head: { x: [-55, 46], y: [-31, 77], z: [-39, 44] },
  ClavicleL: { x: [-28, 29], y: [-55, 25], z: [-36, 25] },
  ClavicleR: { x: [-36, 33], y: [-42, 54], z: [-43, 28] },
  UpperArm_L: { x: [-56, 81], y: [-108, 110], z: [-26, 109] },
  UpperArm_R: { x: [-79, 102], y: [-110, 95], z: [-132, 52] },
  ForeArm_L: { x: [-52, 116], y: [-38, 88], z: [-77, 76] },
  ForeArm_R: { x: [-88, 104], y: [-88, 39], z: [-80, 36] },
  Thigh_L: { x: [-138, 49], y: [-86, 79], z: [-48, 109] },
  Thigh_R: { x: [-81, 83], y: [-47, 93], z: [-104, 50] },
  Shin_L: { x: [-22, 116], y: [-26, 55], z: [-53, 25] },
  Shin_R: { x: [-42, 91], y: [-57, 26], z: [-42, 65] },
  Foot_L: { x: [-62, 98], y: [-58, 49], z: [-44, 62] },
  Foot_R: { x: [-61, 88], y: [-37, 68], z: [-52, 48] },
};

// Motori nativi Rapier dei giunti: pulsazione propria (rad/s) per
// segmento. Misurato dal vivo su un giunto isolato: il modello
// "acceleration based" di Rapier NON si comporta come una molla k in
// rad/s^2 (con k=700 oscillava con periodo ~1.3s invece di 0.24s) -- si
// usa il modello "force based" (unita' fisiche vere, N*m/rad) e la
// rigidita' si calcola dall'inerzia reale di TUTTO cio' che il giunto
// muove (il sotto-albero: la spalla muove braccio+avambraccio), cosi' la
// risposta e' quella scritta qui a prescindere dalla massa: 25 rad/s,
// smorzamento critico = ~0.15s per raggiungere il bersaglio senza
// rimbalzi.
export const ACTIVE_RAGDOLL_JOINT_FREQ_DEFAULT = 35;
// Tarati dal vivo col banco (errore medio: idle 0.3 gradi, camminata ~1,
// corsa ~5, pugni ~4, gancio ~9): piu' bassi il corpo resta indietro nei
// movimenti veloci, piu' alti un colpo non lo piega quasi per niente
// (anche se durante il colpo i motori vengono comunque indeboliti, vedi
// applyActiveHit/staggerRef in useRagdollActive.ts).
export const ACTIVE_RAGDOLL_JOINT_FREQ: Record<string, number> = {
  Torso: 42,
  SpineMid: 42,
  SpineHigh: 42,
  Head: 35,
  ClavicleL: 42,
  ClavicleR: 42,
  UpperArm_L: 35,
  UpperArm_R: 35,
  ForeArm_L: 35,
  ForeArm_R: 35,
  Thigh_L: 42,
  Thigh_R: 42,
  Shin_L: 42,
  Shin_R: 42,
  Foot_L: 28,
  Foot_R: 28,
};
// Attrito nei giunti quando i motori sono spenti (passivo/KO), in 1/s
// (moltiplicato per l'inerzia del sotto-albero) -- evita che un corpo
// molle oscilli all'infinito come un pendolo senza attrito.
export const ACTIVE_RAGDOLL_PASSIVE_JOINT_FRICTION = 4;

// KO "alla GTA IV": tono di ogni giunto rispetto agli altri (moltiplica
// la pulsazione da vivo insieme a koTone/koFloor del banco). Il tronco e
// il collo tengono di piu' (la testa non ciondola come uno straccio),
// spalle e gomiti sono morbidi, gambe a meta'.
export const ACTIVE_RAGDOLL_KO_TONE: Record<string, number> = {
  Torso: 1,
  SpineMid: 1,
  SpineHigh: 1,
  Head: 0.9,
  ClavicleL: 0.8,
  ClavicleR: 0.8,
  UpperArm_L: 0.6,
  UpperArm_R: 0.6,
  ForeArm_L: 0.5,
  ForeArm_R: 0.5,
  Thigh_L: 0.75,
  Thigh_R: 0.75,
  Shin_L: 0.6,
  Shin_R: 0.6,
  Foot_L: 0.5,
  Foot_R: 0.5,
};
