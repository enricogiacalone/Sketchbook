import { interactionGroups } from "@react-three/rapier";
import { CollisionGroups } from "../../../enums/CollisionGroups";

export const HURTBOX_HEIGHT = 1.65; // feet to roughly head height
export const HURTBOX_RADIUS = 0.33;

// Member of AND only collides-with Hurtbox -- so a query using this same
// group only ever matches another fighter's hurtbox, never terrain,
// ragdoll pieces, or anything else sharing the physics world.
export const HURTBOX_GROUPS = interactionGroups(
  [CollisionGroups.Hurtbox],
  [CollisionGroups.Hurtbox]
);

// Ragdoll rig definition for the soldier-citizen.glb skeleton (an
// Epic/UE-mannequin-style bone naming convention -- pelvis/spine_0N/
// clavicle_l/upperarm_l/lowerarm_l/hand_l/thigh_l/calf_l/foot_l etc.,
// verified by parsing the GLB's own node list directly). Same skeleton
// used by both CombatSoldier.tsx (city-wide arena) and
// PlayerCombatSoldier.tsx (the 1v1 duel), so both share this one config
// via useRagdoll.ts.
//
// Inspired by epol1/trr's three.js-rapier-ragdoll approach (a capsule per
// limb + a limit joint per pair), but DATA-DRIVEN rather than hand-typed
// per-bone offsets: only a bone-name pair and a radius are declared here,
// every capsule's actual length/position/orientation is measured off the
// character's own live bone positions the moment the ragdoll activates
// (see useRagdoll.ts's buildBodies). That's both more robust (no
// hand-guessed numbers that can silently stop matching if the model is
// re-exported slightly differently) and reusable for a different
// similarly-named rig without editing this file's numbers.
//
// Simplified to 10 rigid bodies rather than one per bone (real ragdolls in
// shipped games are rarely much finer than this): the spine's 3 bones
// (spine_01/02/03) collapse into one rigid "Torso" capsule, each
// shoulder's clavicle collapses into its upper arm, and each hand/foot
// collapses into its forearm/shin. Every bone NOT given its own body here
// is listed in RAGDOLL_SEGMENT_FROZEN_BONES below -- while the segment
// that "owns" it is active, its local rotation is reset to identity every
// frame, so it rigidly extends whichever real ragdoll body is its nearest
// simulated ancestor instead of silently freezing at a stale animated
// pose (which would show as a kink where the simulated part ends and the
// frozen part begins).
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

export const RAGDOLL_SEGMENTS: RagdollSegment[] = [
  { name: 'Hips', drivingBone: 'pelvis', parent: null, toBone: 'spine_01', radius: 0.15, lengthScale: 0.6 },
  { name: 'Torso', drivingBone: 'spine_01', parent: 'Hips', toBone: 'neck_01', radius: 0.18 },
  // "la testa del solido e' troppo bassa rispetto a quella reale" --
  // head_leaf sits close to the true top of the skull but the mesh's
  // own hair/head volume still reads visibly taller than a capsule
  // sized off the bare neck_01->head_leaf bone distance (radius 0.13
  // alone gave a ~0.28m-tall near-sphere centered mid-skull) -- bumped
  // radius and lengthScale so the covered volume clears the real
  // rendered head, verified live against the debug wireframe.
  { name: 'Head', drivingBone: 'neck_01', parent: 'Torso', toBone: 'head_leaf', radius: 0.15, lengthScale: 1.3 },
  { name: 'UpperArm_L', drivingBone: 'upperarm_l', parent: 'Torso', toBone: 'lowerarm_l', radius: 0.06 },
  { name: 'ForeArm_L', drivingBone: 'lowerarm_l', parent: 'UpperArm_L', toBone: 'hand_l', radius: 0.05 },
  { name: 'UpperArm_R', drivingBone: 'upperarm_r', parent: 'Torso', toBone: 'lowerarm_r', radius: 0.06 },
  { name: 'ForeArm_R', drivingBone: 'lowerarm_r', parent: 'UpperArm_R', toBone: 'hand_r', radius: 0.05 },
  { name: 'Thigh_L', drivingBone: 'thigh_l', parent: 'Hips', toBone: 'calf_l', radius: 0.095 },
  { name: 'Shin_L', drivingBone: 'calf_l', parent: 'Thigh_L', toBone: 'foot_l', radius: 0.07 },
  { name: 'Foot_L', drivingBone: 'foot_l', parent: 'Shin_L', toBone: 'ball_l', radius: 0.075, lengthScale: 1.4 },
  { name: 'Thigh_R', drivingBone: 'thigh_r', parent: 'Hips', toBone: 'calf_r', radius: 0.095 },
  { name: 'Shin_R', drivingBone: 'calf_r', parent: 'Thigh_R', toBone: 'foot_r', radius: 0.07 },
  { name: 'Foot_R', drivingBone: 'foot_r', parent: 'Shin_R', toBone: 'ball_r', radius: 0.075, lengthScale: 1.4 },
];

// "estendere il controllo fisico anche a clavicole/spine_02/03 (piu'
// corpi, piu' complessita')" -- la scelta esplicita dell'utente dopo che
// il manichino risultava ancora deforme a spalle/schiena col layer
// attivo (root cause: spine_02/spine_03/clavicle_l/clavicle_r NON sono
// simulati indipendentemente, solo "congelati" a rotazione identita' via
// RAGDOLL_SEGMENT_FROZEN_BONES -- ma l'AnimationMixer continua a
// scrivere posizione/rotazione/scala fresche su questi stessi bone ogni
// frame per le clip di combattimento, e con deviazioni grandi e
// sostenute di Torso/UpperArm -- tipiche del layer sempre attivo, mai
// viste nel sistema transitorio breve -- il disallineamento si vede come
// una cucitura/strizzatura alla spalla e sulla schiena).
//
// SOLO per il layer attivo (activeBodiesRef in useRagdoll.ts) -- NON
// tocca RAGDOLL_SEGMENTS sopra, che resta condiviso col sistema
// transitorio pulseHit/activateDeath, gia' rifinito e testato a fondo.
export const ACTIVE_RAGDOLL_EXTRA_SEGMENTS: RagdollSegment[] = [
  { name: 'SpineMid', drivingBone: 'spine_02', parent: 'Torso', toBone: 'spine_03', radius: 0.16 },
  { name: 'SpineHigh', drivingBone: 'spine_03', parent: 'SpineMid', toBone: 'neck_01', radius: 0.15 },
  { name: 'ClavicleL', drivingBone: 'clavicle_l', parent: 'SpineHigh', toBone: 'upperarm_l', radius: 0.05 },
  { name: 'ClavicleR', drivingBone: 'clavicle_r', parent: 'SpineHigh', toBone: 'upperarm_r', radius: 0.05 },
];

// Set completo, esplicito e in ordine topologico (genitore sempre prima
// del figlio -- ensureActiveRagdoll/syncBonesFromPhysics li processano in
// quest'ordine) di TUTTI i segmenti del layer attivo: gli 11 originali
// (stessi bone/raggio di RAGDOLL_SEGMENTS, MA con Head/UpperArm_L/
// UpperArm_R riagganciati ai nuovi corpi intermedi invece che
// direttamente al Torso) intervallati con i 4 nuovi sopra. Duplicato a
// mano invece che costruito per lookup+override da RAGDOLL_SEGMENTS
// apposta: resta leggibile a colpo d'occhio quale genitore usa ciascun
// segmento, ed evita qualunque rischio di modificare per sbaglio
// l'array condiviso.
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

// "porta quello che ci interessa di piu'" -- da epol1/trr: invece di dare
// a ogni capsula la stessa densita' (setDensity(1.0), cioe' la massa di
// ogni segmento dipende SOLO dal volume della sua capsula, non da quanto
// dovrebbe pesare davvero), loro fissano un budget di massa TOTALE del
// corpo e lo distribuiscono per segmento in base a un peso relativo
// dichiarato -- un busto pesa di piu' delle braccia perche' glielo
// diciamo esplicitamente, non perche' la sua capsula ha piu' volume.
// Rilevante ora piu' che mai: solveJointCones/stabilizeActiveRelativeAngvel
// (useRagdollActive.ts) pesano le correzioni con l'inerzia REALE di ogni
// corpo (effectiveWorldInvInertia) -- masse relative piu' realistiche
// rendono anche quelle correzioni piu' realistiche (un urto sul avambraccio
// non dovrebbe far vacillare il bacino quanto uno sul busto).
//
// Pesi adattati dalla tabella antropometrica di Winter (frazione della
// massa corporea totale per segmento -- dati biomeccanici consolidati:
// avambraccio+mano 2.2%, braccio 2.8%, coscia 10%, gamba 4.65%, piede
// 1.45%, testa+collo 8.1%, tronco 49.7% nel suo insieme). I nostri
// segmenti del tronco (Hips/Torso/SpineMid/SpineHigh) non corrispondono
// 1:1 ai confini di Winter (che tratta il tronco come un unico blocco),
// quindi quel 49.7% e' suddiviso tra i 4 in una stima ragionevole (bacino
// il piu' pesante, via via meno salendo verso lo sterno) piuttosto che da
// una fonte biomeccanica diretta -- comunque molto piu' vicino alla
// realta' di "qualunque volume abbia la capsula".
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

// "mani e piedi nn sn solidi" -- the 11 segments above deliberately
// collapse each hand/foot into its forearm/shin (see this file's own
// top comment, "real ragdolls in shipped games are rarely much finer
// than this") -- a fine simplification for the transient hit-reaction/
// death ragdoll's own joint-solver cost, but NOT what's wanted for the
// permanent SOLID-BODY collision layer (useRagdoll.ts's ensureSolidBody/
// syncSolidBody/resolveBodyMovement): a fist that's just the end of the
// forearm capsule can't really connect with a punch, and a foot that's
// just the end of the shin capsule can clip through the opponent/ground
// at the ankle. So these 4 are declared SEPARATELY rather than folded
// into RAGDOLL_SEGMENTS above -- solid-body code reads BOTH arrays
// (SOLID_BODY_SEGMENTS below), the dynamic ragdoll (buildBodies) still
// reads ONLY RAGDOLL_SEGMENTS and is completely unaffected, exactly as
// asked (this is a collision-layer fix, not a ragdoll-physics one).
//
// toBone for each uses a real further-out bone rather than a guessed
// fixed size: middle_01_l/r (the middle finger's own first knuckle) for
// a hand -- close enough to the wrist that finger CURL at build time
// (fist vs open hand) barely changes the measured length, unlike a
// fingertip bone would -- and ball_l/r (the ball of the foot, already
// used as Shin's own frozen pass-through bone) for a foot, giving a real
// ankle-to-forefoot capsule instead of an arbitrary sphere.
export const SOLID_BODY_EXTRA_SEGMENTS: RagdollSegment[] = [
  { name: 'Hand_L', drivingBone: 'hand_l', parent: 'ForeArm_L', toBone: 'middle_01_l', radius: 0.045, lengthScale: 1.4 },
  { name: 'Hand_R', drivingBone: 'hand_r', parent: 'ForeArm_R', toBone: 'middle_01_r', radius: 0.045, lengthScale: 1.4 },
  { name: 'Foot_L', drivingBone: 'foot_l', parent: 'Shin_L', toBone: 'ball_l', radius: 0.075, lengthScale: 1.4 },
  { name: 'Foot_R', drivingBone: 'foot_r', parent: 'Shin_R', toBone: 'ball_r', radius: 0.075, lengthScale: 1.4 },
];

// What the solid-body system (useRagdoll.ts) actually builds every
// fighter out of: the 11 anatomical segments PLUS the 4 hand/foot ones
// above -- 15 real colliders per fighter. Kept as one combined list here
// (rather than having useRagdoll.ts concatenate the two arrays itself)
// so there's a single source of truth for "how many solid parts does a
// fighter have" that SolidBodyDebugView.tsx's own MAX_SOLID_SEGMENTS
// pool size is checked against.
export const SOLID_BODY_SEGMENTS: RagdollSegment[] = [...RAGDOLL_SEGMENTS, ...SOLID_BODY_EXTRA_SEGMENTS];

// Which pass-through bones belong to each segment, frozen to an identity
// local rotation while (and ONLY while) that segment is one of the
// currently-active ragdoll bodies (see useRagdoll.ts's syncBonesFromPhysics).
//
// This used to be one flat list applied unconditionally, back when every
// hit built the ENTIRE rig. Now that a live hit-reaction (pulseHit) only
// makes a couple of segments physical at a time -- see
// RAGDOLL_PULSE_NEARBY below -- freezing, say, spine_02/03 while only the
// Head is reacting would wrongly stomp the animated torso's own pose even
// though Torso itself was never touched. Keying frozen bones to their
// owning segment keeps each hit's effect scoped to exactly the body parts
// that are actually simulated. A bone with no entry here (finger bones,
// leaf helpers) is simply left alone -- whatever the AnimationMixer last
// wrote for it stays, which is harmless since nothing simulated depends
// on its exact pose.
// "le parti del corpo devono seguire sempre i constraint dell'anatomia
// umana.. a meno di un colpo davvero forte (di cui parleremo in futuro)"
// -- every joint below gets a REAL limit now instead of the free-
// spinning spherical joints this used to create for all 11 of them.
//
// Elbows and knees are genuine single-axis hinges anatomically, so they
// get a real Rapier revolute joint with a hard [min, max] flexion limit
// (degrees) -- see useRagdoll.ts's buildBodies, which passes these
// straight to JointData.revolute(...).limits. The hinge AXIS itself is
// computed at build time from live bone WORLD positions (thigh_l vs
// thigh_r), not guessed from this rig's raw per-bone local axis
// convention -- see buildBodies' own comment for why. Sign/exact plane
// is a reasonable anatomical approximation, not biomechanically exact;
// still, this is what actually stops "spinning 360" or bending
// backwards through the joint, which is the point.
export const RAGDOLL_HINGE_LIMITS_DEG: Record<string, [number, number]> = {
  ForeArm_L: [-10, 150],
  ForeArm_R: [-10, 150],
  Shin_L: [-10, 150],
  Shin_R: [-10, 150],
};

// "controlla gomiti e ginocchia" -> "ma le vedo un po deformate" (arto
// stirato/allungato) -- misurato dal vivo: la distanza reale spalla-gomito/
// gomito-mano/anca-ginocchio/ginocchio-piede resta identica (<1% di
// scarto) tra in piedi e crollato, quindi il giunto NON si allunga
// fisicamente -- l'ancoraggio tiene. Il problema e' lo SKINNING (linear
// blend skinning classico): una piega vicina al limite di 150 gradi qui
// sopra (misurato: braccio esterno arrivava a 41-54 gradi, cioe' quasi
// tutta la flessione disponibile) e' un angolo che le clip di animazione
// probabilmente non hanno mai davvero coperto, e a quell'estremo la
// mesh si assottiglia/stira invece di deformarsi in modo pulito -- non
// e' un bug di fisica, e' un limite della mesh a quell'angolo.
// SOLO per la modalita' passiva (vedi useRagdoll.ts/useRagdollActive.ts's
// applyPassiveHingeLimits/restoreActiveHingeLimits, che aggiornano il
// limite del giunto Rapier gia' esistente al volo con setLimits invece di
// ricostruirlo): il combattimento normale (motori PD) continua a usare
// RAGDOLL_HINGE_LIMITS_DEG sopra invariato, quindi un pugno/un calcio non
// perdono raggio di movimento. Valori "generosi" apposta (non troppo
// stretti): il crollo deve restare naturale, solo senza arrivare
// all'estremo che stira visibilmente la mesh.
export const PASSIVE_RAGDOLL_HINGE_LIMITS_DEG: Record<string, [number, number]> = {
  ForeArm_L: [-10, 100],
  ForeArm_R: [-10, 100],
  Shin_L: [-10, 100],
  Shin_R: [-10, 100],
};

// Everything else (spine, neck, shoulders, hips) is genuinely multi-axis
// in real anatomy -- shoulders in particular have a huge range of
// motion -- so these stay real Rapier spherical joints (3 rotational
// DOF), but useRagdoll.ts's clampJointCones() manually pulls each one
// back every frame once it strays more than this many degrees (in ANY
// direction at once, not a separate swing/twist split) from its own
// "neutral" pose -- whatever the character was actually doing the
// instant the hit landed, not a fixed bind/T-pose. Rapier's spherical
// joint has no native angular-limit API in this version, hence the
// manual clamp rather than a built-in one (see that function's comment).
export const RAGDOLL_CONE_LIMIT_DEG: Record<string, number> = {
  Torso: 45, // spine bend, relative to Hips
  Head: 50, // neck, relative to Torso
  UpperArm_L: 100, // shoulder, relative to Torso -- generous: real shoulders have a very wide range
  UpperArm_R: 100,
  Thigh_L: 80, // hip, relative to Hips
  Thigh_R: 80,
  Foot_L: 40,
  Foot_R: 40,
};

// "stringere ulteriormente la stabilita'" -- SEPARATA da
// RAGDOLL_CONE_LIMIT_DEG sopra apposta: quella tabella e' quella del
// sistema transitorio (pulseHit/activateDeath), gia' rifinita e testata
// a fondo in sessioni precedenti -- non va MAI toccata per tarare il
// layer PD sempre attivo, che e' un sistema completamente separato (vedi
// useRagdoll.ts's activeBodiesRef). Limiti piu' stretti qui perche' lo
// scopo e' diverso: la' servono a impedire pose anatomicamente assurde
// durante un contraccolpo forte; qui servono a tenere il rig vicino alla
// posa animata durante il moto normale (camminata/idle), dove uno
// scarto ampio si vede subito come "il personaggio balla" invece che
// come una reazione fisica plausibile.
export const ACTIVE_RAGDOLL_CONE_LIMIT_DEG: Record<string, number> = {
  Torso: 20,
  Head: 30,
  UpperArm_L: 60,
  UpperArm_R: 60,
  Thigh_L: 45,
  Thigh_R: 45,
  // "estendere il controllo fisico anche a clavicole/spine_02/03" --
  // limiti STRETTI apposta: SpineMid/SpineHigh sono suddivisioni interne
  // dello stesso busto (che da solo aveva gia' Torso:20), quindi ciascuna
  // non deve poter divergere quanto Torso stesso o la colonna si
  // spezzerebbe in modo innaturale; le clavicole sono una cerniera piccola
  // vicino alla spalla vera, non la spalla stessa (quella resta
  // UpperArm_L/R:60), quindi un range ancora piu' piccolo.
  SpineMid: 15,
  SpineHigh: 15,
  ClavicleL: 25,
  ClavicleR: 25,
  // ForeArm_L/R (gomito) e Shin_L/R (ginocchio) NON compaiono qui: sono
  // giunti a cerniera reali (revolute), gia' vincolati rigidamente da
  // Rapier stesso via RAGDOLL_HINGE_LIMITS_DEG -- un cono qui non
  // servirebbe a nulla (e infatti clampActiveJointCones li salta, non
  // catturano mai un restRelativeQuat).
};

// "il bacino secondo me e' ancora strano in ragdoll quando e' passivo
// sembra spezzarsi" -- causa REALE (verificata misurando la velocita'
// angolare vera dei body, non solo la posa a schermo): togliere del
// tutto clampActiveJointCones dalla modalita' passiva (per il bug del
// riferimento "in piedi" obsoleto, vedi il commento sul suo utilizzo in
// useRagdoll.ts) ha tolto anche l'UNICA cosa che vincolava l'ORIENTAMENTO
// relativo dei giunti sferici (busto-bacino, coscia-bacino, testa/
// clavicole-colonna) -- un giunto sferico Rapier vincola solo la
// POSIZIONE del suo punto di ancoraggio, MAI la rotazione: senza nessun
// cono, il busto puo' assestarsi a QUALSIASI angolo relativo al bacino,
// compresi angoli anatomicamente assurdi (torsione a 90-150+ gradi) che
// sembrano proprio una rottura al punto vita, e la velocita' angolare
// residua (piccola ma mai esattamente zero) continua a farlo scivolare
// lentamente verso quegli angoli invece di fermarsi in una posa
// plausibile.
// Fix: un cono anche in modalita' passiva, ma DIVERSO da quello del
// combattimento sopra -- qui il riferimento e' lo stesso (restRelativeQuat
// catturato una volta da ensureActiveRagdoll, in piedi) ma il limite e'
// VOLUTAMENTE largo, non stretto: lo scopo non e' "resta vicino alla
// posa animata" (impossibile per un corpo a terra, ed e' esattamente il
// bug gia' risolto altrove), ma solo "non torcerti in modo impossibile" --
// un limite generoso interviene raramente (la maggior parte delle pose
// da crollo naturale ci sta gia' dentro) invece di correggere ogni
// frame, quindi non dovrebbe ricreare il tremolio perenne del vecchio
// limite stretto.
export const PASSIVE_RAGDOLL_CONE_LIMIT_DEG: Record<string, number> = {
  Torso: 100,
  Head: 100,
  UpperArm_L: 130,
  UpperArm_R: 130,
  Thigh_L: 110,
  Thigh_R: 110,
  SpineMid: 70,
  SpineHigh: 70,
  ClavicleL: 90,
  ClavicleR: 90,
};

// "riusciamo a Ricreare la fisica ragdoll attiva in stile Euphoria?" --
// Step 2: Motori sui giunti (Joint Drives). Queste costanti definiscono
// quanto i muscoli virtuali sono "forti" (stiffness) e quanto "frenano"
// (damping) nel cercare di raggiungere la posa dell'animazione.
// Valori piu' alti = personaggio piu' rigido e reattivo, quasi robotico.
// Valori piu' bassi = personaggio piu' flaccido e "pesante", stile Euphoria.
//
// Espresse come ACCELERAZIONE ANGOLARE (rad/s^2 per radiante di errore
// di orientamento / per rad/s di velocita' angolare residua), NON come
// coppia pura -- useRagdoll.ts's syncActiveRagdollMotors moltiplica per
// il principalInertia REALE di ogni singolo corpo (il suo momento
// d'inerzia -- quanta coppia serve davvero per farlo ruotare, minuscolo
// per una mano, molto piu' grande per il busto) prima di applicarla,
// cosi' UNA sola coppia di costanti si comporta in modo coerente su
// segmenti di dimensioni molto diverse, invece di richiedere una coppia
// pura tarata a mano per ciascuno (stessa idea "acceleration-based" gia'
// usata sotto per la molla di posizione dell'Hips). I valori originali
// (1000/50, pensati come coppia pura) si sono rivelati IMPRATICABILI a
// queste capsule leggerissime una volta risolto il bug che ne impediva
// il test dal vivo (vedi syncActiveRagdollMotors -- addTorque/addForce
// mandavano in crash il motore fisico, sostituiti con applyTorqueImpulse/
// applyImpulse scalati per delta) -- il personaggio veniva scagliato in
// aria all'istante. Questi valori piu' bassi sono il punto di partenza
// live-tuned (vedi il proprio changelog per le sessioni di tuning
// successive) per una posa stabile, non piu' un placeholder mai testato.
export const RAGDOLL_MOTOR_STIFFNESS = 60; // rad/s^2 per radiante di errore
// "il personaggio viene scagliato in aria" (live-tuning, dopo aver risolto
// il crash addTorque/addForce) -- root cause del secondo bug, distinto dal
// crash: con RAGDOLL_MOTOR_STIFFNESS_BY_SEGMENT che varia per segmento
// (60/120/48) ma un singolo RAGDOLL_MOTOR_DAMPING fisso condiviso da TUTTI,
// i segmenti con stiffness piu' alta (Torso/Hips a 120) erano SOTTOSMORZATI
// (smorzamento critico = 2*sqrt(stiffness) ~= 22, ne avevano solo 14) --
// oscillavano invece di stabilizzarsi, con l'energia della molla di
// posizione dell'Hips ad alimentare l'oscillazione frame dopo frame senza
// mai smorzarla (confermato dal vivo: angVelMag/angleDeg per segmento non
// scendevano mai sotto qualche rad/s anche dopo diversi secondi fermo).
// Fix: invece di un DAMPING assoluto, RAGDOLL_MOTOR_DAMPING_RATIO e' un
// rapporto di smorzamento (1 = criticamente smorzato, quello che la fisica
// chiama zeta) -- useRagdoll.ts calcola sempre il damping REALE come
// 2*sqrt(stiffness)*RATIO per OGNI segmento, quindi resta coerente anche
// quando RAGDOLL_MOTOR_STIFFNESS_BY_SEGMENT cambia la stiffness di un
// singolo arto, invece di richiedere anche un damping-per-segmento
// separato tarato a mano.
export const RAGDOLL_MOTOR_DAMPING_RATIO = 1.0;
export const CORE_TENSION_STIFFNESS = 60; // Core tension to keep the character upright
export const CORE_TENSION_DAMPING_RATIO = 1.0;

// "quando il personaggio si ferma da piu' valore al ragdoll, voglio un
// mix perfetto tra il ragdoll e l'animazione, stile Euphoria" -- il
// layer PD attivo gia' simula fisicamente OGNI frame (i motori in
// useRagdollActive.ts inseguono la posa animata), ma finora il risultato
// finale mostrato a schermo era SEMPRE il 100% fisica (peso 1, vedi
// syncActiveBonesBlended in useRagdollActive.ts). Questi tre valori
// controllano quanto quel risultato fisico prevale sulla posa animata
// pura nel render finale, a seconda che il combattente sia fermo
// ("In guardia"/"Manichino") o in movimento/attacco:
// - da fermo: quasi tutta fisica (il corpo "vive" di suo, si nota il
//   respiro/oscillazione/assestamento della simulazione -- l'effetto
//   Euphoria che si vede quando un personaggio e' immobile in GTA IV).
// - in movimento/attacco: soprattutto animazione (i movimenti restano
//   puliti e leggibili, la fisica resta sotto come "rumore" secondario
//   invece di deformare lo swing di un pugno).
// Smussato frame a frame (ACTIVE_RAGDOLL_WEIGHT_SMOOTH_RATE) cosi' il
// cambio e' una dissolvenza, non uno scatto secco a ogni In guardia<->
// Si muove.
export const ACTIVE_RAGDOLL_WEIGHT_IDLE = 0.85;
export const ACTIVE_RAGDOLL_WEIGHT_MOVING = 0.35;
export const ACTIVE_RAGDOLL_WEIGHT_SMOOTH_RATE = 6; // piu' alto = transizione piu' rapida
// Alcune parti potrebbero aver bisogno di muscoli piu' forti (es. il busto)
// o piu' deboli (es. le braccia) -- stessa proporzione dei vecchi valori
// (2x per busto/bacino, 0.8x per la testa) applicata alla nuova scala.
export const RAGDOLL_MOTOR_STIFFNESS_BY_SEGMENT: Record<string, number> = {
  Torso: 120,
  Hips: 120,
  Head: 48,
  // Braccia/gambe TENTATE a 150 (live-tuning, sessione "clamp Torso +
  // per-arto") e SCARTATE: invece di convergere, window.__activeRagdollDebug
  // mostrava una divergenza crescente nel tempo (Hips 29d->47d, Torso
  // 29d->52d, Thigh_L angVelMag arrivato a 50+ rad/s dopo ~15s, non un
  // transitorio) -- un braccio/gamba piu' "forte" del Torso che lo governa
  // (120) finisce per strattonare il giunto invece di inseguire meglio la
  // posa, specialmente su questi corpi cosi' leggeri (inertiaScale ~1e-5).
  // Tornati alla base RAGDOLL_MOTOR_STIFFNESS=60 per questi segmenti finche'
  // non si trova un valore intermedio verificato stabile su piu' run dal
  // vivo (il baseline 60 non diverge, ma non chiude nemmeno l'errore delle
  // braccia in pochi secondi -- vedi changelog per il prossimo tentativo).
  //
  // "estendere il controllo fisico anche a clavicole/spine_02/03" -- nuovi
  // segmenti, partono VOLUTAMENTE conservativi (sotto il baseline 60):
  // sono suddivisioni piccole e leggere di un busto/spalla gia' guidati da
  // un genitore forte (Torso=120, e ora anche SpineMid/SpineHigh stessi si
  // fanno da genitore l'un l'altro), quindi rischiano lo stesso tipo di
  // "strattonamento" gia' visto e scartato sopra per braccia/gambe a 150 se
  // partissero troppo rigidi. Se il live test mostra che non chiudono
  // abbastanza l'errore, si alza gradualmente da qui -- MAI direttamente a
  // un valore alto non testato.
  SpineMid: 90,
  SpineHigh: 70,
  ClavicleL: 40,
  ClavicleR: 40,
};

// "questo mi sembra piu' sostenibile" -- Step 2 realizzato: layer SEMPRE
// attivo (non solo durante pulseHit), separato dal sistema esistente,
// che guida in continuo tutti gli 11 segmenti verso la posa animata di
// QUESTO frame con una coppia PD (RAGDOLL_MOTOR_STIFFNESS/_DAMPING sopra
// = "muscoli"), invece di limitarsi a un impulso + rientro a tempo fisso.
// Vedi useRagdoll.ts: ensureActiveRagdoll/syncActiveRagdollMotors.
//
// L'Hips (bacino, root del rig) e' l'unico segmento SENZA genitore --
// niente giunto lo tiene ancorato al resto -- quindi oltre alla molla
// rotazionale (RAGDOLL_MOTOR_STIFFNESS_BY_SEGMENT.Hips sopra) riceve
// anche una molla di POSIZIONE che lo richiama verso dove
// l'animazione/il movimento (WASD, sprint, schivata) dice che dovrebbe
// essere in questo istante -- "bacino a molla": un urto abbastanza forte
// PUO' farlo vacillare/scostarsi per un attimo, non e' incollato a
// scatto come farebbe un corpo kinematico. Costanti espresse come
// ACCELERAZIONE per metro/m/s di errore (moltiplicate per la massa reale
// del corpo in useRagdoll.ts) anziche' come forza pura, cosi' restano
// valide indipendentemente da quanto e' leggera la piccola capsula
// dell'Hips (stessa capsula minuscola per cui pulseHit deve gia' scalare
// il proprio impulso per massa -- vedi quel commento).
export const RAGDOLL_HIPS_POSITION_STIFFNESS = 400; // (1/s^2) accelerazione per metro di errore di posizione
export const RAGDOLL_HIPS_POSITION_DAMPING = 40; // (1/s) accelerazione per (m/s) di velocita' residua (~criticamente smorzato)

export const RAGDOLL_SEGMENT_FROZEN_BONES: Record<string, string[]> = {
  Torso: ['spine_02', 'spine_03'],
  UpperArm_L: ['clavicle_l'],
  UpperArm_R: ['clavicle_r'],
  ForeArm_L: ['hand_l'],
  ForeArm_R: ['hand_r'],
  Shin_L: ['foot_l', 'ball_l'],
  Shin_R: ['foot_r', 'ball_r'],
};

// "vorrei qualcosa di dinamico.. un contraccolpo su dove ho colpito" /
// "anche il braccio/gamba piu vicino per un effetto un po' piu ampio" --
// a live hit-reaction pulse (pulseHit, character still alive) makes
// physical ONLY the struck segment (Head or Torso -- see CombatSoldier.tsx/
// PlayerCombatSoldier.tsx's triggerHit branch) plus one nearby limb picked
// from here, chosen at random each hit since a hit's impulse direction
// today carries no real left/right information to pick a true "nearest"
// side from. Hips/legs are NEVER part of a live pulse when the primary hit
// is the Head -- and even when the primary is Torso, the OTHER leg and
// both arms stay fully animated -- so the character always keeps standing
// on its own two feet through a hit; only the struck area and its pick of
// neighbor actually go limp and recoil. (activateDeath -- the K.O./death
// ragdoll -- ignores this entirely and always builds the full 11-body rig,
// per "1. crollo totale": that one really is meant to fully collapse.)
export const RAGDOLL_PULSE_NEARBY: Record<string, [string, string][]> = {
  Head: [
    ['UpperArm_L', 'ForeArm_L'],
    ['UpperArm_R', 'ForeArm_R'],
  ],
  Torso: [
    ['Thigh_L', 'Shin_L'],
    ['Thigh_R', 'Shin_R'],
  ],
};

// ===========================================================================
// Ragdoll attivo v2 (useRagdollActive.ts riscritto) -- vedi il commento in
// cima ad activeRagdollFrames.ts.
//
// Limiti dei giunti in GRADI, per asse, rispetto alla POSA NEUTRA = il
// primo fotogramma di "Fighting Idle" (la guardia, vedi captureClipPose in
// activeRagdollFrames.ts -- NON la T-pose: con lo zero in T-pose il gancio
// portava la spalla vicino ai 180 gradi e il braccio esplodeva), nel frame
// del personaggio portato dal bacino: X = sinistra, Y = su, Z = avanti.
// Regola della mano destra, rotazione del FIGLIO rispetto al GENITORE.
// Un giunto non elencato usa +-ACTIVE_RAGDOLL_JOINT_LIMIT_FALLBACK_DEG.
//
// Valori = range MISURATO sulle clip di combattimento (pannello "Banco
// ragdoll" -> "Misura range animazioni": Fighting Idle, Walk/
// Walk_Backwards/Strafe, Sprint/Jog, Dodge_*, Defend, Victory, Punch_Jab/
// Cross, Melee_Hook, Fighting Left/Right Jab, Hit_Chest/Head, Idle_A)
// allargato di 20 gradi per lato (quanto un colpo puo' piegare oltre
// l'animazione), minimo +-25. Nessuna animazione del gioco arriva mai a un
// limite (altrimenti motore e limite si combatterebbero). Ginocchio verso
// l'iperestensione e gomito verso l'iperestensione: solo +8.
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
// Servo del bacino (1/s^2): posizione e orientamento mondo.
export const ACTIVE_RAGDOLL_HIPS_POS_STIFFNESS = 400;
export const ACTIVE_RAGDOLL_HIPS_ROT_STIFFNESS = 400;
// Tempo (s) in cui un segmento colpito torna da "molle" a motore pieno.
export const ACTIVE_RAGDOLL_HIT_RECOVERY_S = 0.8;
