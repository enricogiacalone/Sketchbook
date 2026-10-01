// "il movimento che fa il personaggio non corrisponde ai passi che fa" --
// velocita' al suolo di ogni clip di locomozione del rig soldier-citizen
// (a timeScale 1), MISURATA sulle animazioni, non stimata: per ogni piede,
// nei frame in cui e' appoggiato (entro 1.5 cm dal suo punto piu' basso),
// la velocita' orizzontale con cui scorre all'indietro rispetto al corpo e'
// esattamente la velocita' a cui il corpo deve avanzare perche' il piede
// resti fermo a terra. Le clip sono "in place" (nessun root motion).
// Script: analysis/stride.mjs (FK sulle tracce dei GLB, three.js in node).
//
//   clip            durata   piede sx  piede dx   -> usata
//   Walk            1.667 s  0.73      0.73       0.73 m/s
//   Jog             1.167 s  4.71      4.70       4.70 m/s
//   Sprint          0.833 s  7.31      7.01       7.10 m/s
//   Walk_Backwards  1.000 s  0.56      0.64       0.60 m/s
//   Strafe_left     1.000 s  0.54      0.46       0.50 m/s
//   Strafe_right    1.000 s  0.50      0.49*      0.50 m/s  (*contatto breve)
//   Run_Female      0.833 s  --        --         3.83 m/s  (slittamento 0-3 cm
//                   a passo, misurato col personaggio isolato a 4.6 m/s)
//
// "la camminata e la corsa nn mi sembrano corrette.. isola il personaggio e
// misura" (settembre 2026): col personaggio isolato le clip non scivolano a
// nessuna velocita' (per costruzione), ma
//  - nel duello il corpo si BLOCCAVA il 20% dei frame di camminata: i piedi
//    appoggiati urtavano il pavimento nel test di collisione del corpo solido
//    (vedi useRagdollSolidBodies) -> 1.2 m/s reali invece di 1.5, a scatti, e
//    piedi che pattinavano 6-19 cm a passo. Corretto: ora 1.47 su 1.47, 1-4 cm.
//  - la cadenza era sbagliata: Walk a 1.6 m/s = 2.6 passi al secondo (passo
//    di 0.62 m: la clip e' una passeggiata), un trotterellare; Sprint a 5.5 m/s
//    = 1.9 passi/s con passi di 3 m, un saltellare al rallentatore (la clip ha
//    appoggi brevissimi e lunghe fasi di volo). Riferimento umano: camminata
//    1.8-2.0 passi/s, corsa 2.8-3.2 passi/s.
//  -> camminata 1.25 m/s (2.0 passi/s); corsa con Run_Female (corsa eretta,
//     passo 1.6 m) a 4.8 m/s (3.0 passi/s).
//
// ATTENZIONE ai nomi: Strafe_left sposta il corpo verso la SUA destra
// (piede appoggiato che scorre verso +X del modello, il cui lato destro e'
// -X: upperarm_r a x=-0.19) e Strafe_right verso la sua sinistra -- sono
// nominate dal punto di vista di chi guarda. Vedi strafeClipFor().
export const CLIP_GROUND_SPEED: Record<string, number> = {
  Walk: 0.73,
  Jog: 4.7,
  Sprint: 7.1,
  Walk_Backwards: 0.6,
  Strafe_left: 0.5,
  Strafe_right: 0.5,
  Run_Female: 3.83,
};

// Velocita' di gioco scelte, e il timeScale che ne deriva (= velocita' /
// velocita' della clip), cosi' i piedi non scivolano mai.
// "camminata naturale": tutte le camminate del rig sono passeggiate lente
// (0.6-0.9 m/s); accelerarle molto le rende a scatti, quindi Walk quasi
// alla sua velocita' (1.37x, ~1.6 passi/s).
export const WALK_SPEED = 1.0; // m/s (valore di partenza storico, vedi locomotionTuning)
// corsa: Sprint (appoggi rapidi, niente lunghe fasi di volo come la Jog
// che "saltellava") all'85% della sua velocita'
export const RUN_CLIP = 'Run_Female';
export const RUN_SPEED = 6.0; // m/s (valore di partenza storico, vedi locomotionTuning)

// "cursori nel pannello" -- velocita' regolabili dal vivo (pannello debug
// "Locomozione", CombatArenaGUI.tsx). Si sceglie la VELOCITA'; il
// timeScale della clip ne deriva (velocita' / velocita' della clip), cosi'
// i piedi seguono sempre lo spostamento. Letti ogni frame.
export const locomotionTuning = {
  walkSpeed: 1.25, // m/s -- Walk a 1.7x: 2.0 passi/s
  runSpeed: 4.8, // m/s -- Run_Female a 1.25x: 3.0 passi/s
  aimWalkSpeed: 1.0, // m/s -- camminata in mira con la pistola (avanti)
  aiChargeSpeed: 4.8, // m/s -- carica dell'IA
};

// timeScale per far avanzare la clip esattamente a `speed`
export function timeScaleFor(clip: string, speed: number): number {
  const base = CLIP_GROUND_SPEED[clip.replace(/__(legs|upper)$/, '')];
  return base ? speed / base : 1;
}

// velocita' di una clip a un dato timeScale
export function speedFor(clip: string, timeScale: number): number {
  return (CLIP_GROUND_SPEED[clip.replace(/__(legs|upper)$/, '')] ?? WALK_SPEED) * timeScale;
}

// clip laterale giusta per muoversi verso la propria destra (right=true) o sinistra
export function strafeClipFor(right: boolean): 'Strafe_left' | 'Strafe_right' {
  return right ? 'Strafe_left' : 'Strafe_right';
}
