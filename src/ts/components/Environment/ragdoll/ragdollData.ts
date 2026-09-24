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
}


export const ACTIVE_RAGDOLL_SEGMENTS: RagdollSegment[] = [
  { name: 'Hips', drivingBone: 'pelvis', parent: null, toBone: 'spine_01', radius: 0.15, lengthScale: 0.6 },
  // "osserva bene questo collider ragdoll attivo.. mi pare nn
  // corrispondere molto al personaggio" -- misurato dal vivo sullo
  // scheletro reale (soldier-citizen.glb): spine_01->neck_01 e' 0.44m,
  // ma spine_02->spine_03 e' solo 0.14m e spine_03->neck_01 solo 0.17m.
  // Torso qui sotto teneva ANCORA il vecchio toBone: 'neck_01' ereditato
  // dal design a 3 pezzi (RAGDOLL_SEGMENTS sopra, dove Torso e' l'UNICO
  // corpo della schiena) -- quindi Torso copriva l'INTERO tronco da
  // spine_01 a neck_01, esattamente sovrapposto per intero a
  // SpineMid+SpineHigh sotto, che vivono nello stesso range. Tre corpi
  // fisici indipendenti impilati sulla stessa porzione di spina, ognuno
  // tirato dal proprio motore PD verso una MEDIA leggermente diversa
  // della posa animata -- e' la causa principale del "grumo" visibile a
  // schermo vicino a petto/spalla e dell'instabilita' che non si ferma
  // mai nemmeno da fermi. Accorciato a spine_02 cosi' Torso copre SOLO
  // la sua fetta (spine_01->spine_02), come SpineMid/SpineHigh coprono
  // la propria.
  { name: 'Torso', drivingBone: 'spine_01', parent: 'Hips', toBone: 'spine_02', radius: 0.13 },
  // Raggio ridotto rispetto al vecchio 0.16/0.15 (pensati per un UNICO
  // pezzo che faceva da tronco intero) -- ora che ognuno di questi copre
  // solo 0.13-0.18m di spina invece di 0.44m, un raggio da "petto
  // intero" li faceva sovrapporre pesantemente anche ai vicini non
  // adiacenti (es. Hips-SpineHigh). Restano comunque piu' tozzi che
  // allungati (halfHeight vicino al raggio o sotto), normale per
  // segmenti di colonna cosi' corti -- l'obiettivo qui e' ridurre la
  // sovrapposizione, non eliminarla del tutto.
  { name: 'SpineMid', drivingBone: 'spine_02', parent: 'Torso', toBone: 'spine_03', radius: 0.12 },
  { name: 'SpineHigh', drivingBone: 'spine_03', parent: 'SpineMid', toBone: 'neck_01', radius: 0.12 },
  { name: 'Head', drivingBone: 'neck_01', parent: 'SpineHigh', toBone: 'head_leaf', radius: 0.15, lengthScale: 1.3 },
  { name: 'ClavicleL', drivingBone: 'clavicle_l', parent: 'SpineHigh', toBone: 'upperarm_l', radius: 0.05 },
  { name: 'UpperArm_L', drivingBone: 'upperarm_l', parent: 'ClavicleL', toBone: 'lowerarm_l', radius: 0.06 },
  { name: 'ForeArm_L', drivingBone: 'lowerarm_l', parent: 'UpperArm_L', toBone: 'hand_l', radius: 0.05 },
  { name: 'ClavicleR', drivingBone: 'clavicle_r', parent: 'SpineHigh', toBone: 'upperarm_r', radius: 0.05 },
  { name: 'UpperArm_R', drivingBone: 'upperarm_r', parent: 'ClavicleR', toBone: 'lowerarm_r', radius: 0.06 },
  { name: 'ForeArm_R', drivingBone: 'lowerarm_r', parent: 'UpperArm_R', toBone: 'hand_r', radius: 0.05 },
  { name: 'Thigh_L', drivingBone: 'thigh_l', parent: 'Hips', toBone: 'calf_l', radius: 0.095 },
  { name: 'Shin_L', drivingBone: 'calf_l', parent: 'Thigh_L', toBone: 'foot_l', radius: 0.07 },
  { name: 'Foot_L', drivingBone: 'foot_l', parent: 'Shin_L', toBone: 'ball_l', radius: 0.075, lengthScale: 1.4 },
  { name: 'Thigh_R', drivingBone: 'thigh_r', parent: 'Hips', toBone: 'calf_r', radius: 0.095 },
  { name: 'Shin_R', drivingBone: 'calf_r', parent: 'Thigh_R', toBone: 'foot_r', radius: 0.07 },
  { name: 'Foot_R', drivingBone: 'foot_r', parent: 'Shin_R', toBone: 'ball_r', radius: 0.075, lengthScale: 1.4 },
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
  Thigh_L: 0.10,
  Thigh_R: 0.10,
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
export const ACTIVE_RAGDOLL_JOINT_LIMITS_DEG: Record<
  string,
  { x: [number, number]; y: [number, number]; z: [number, number] }
> = {
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
