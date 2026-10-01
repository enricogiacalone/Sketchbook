// "sistema l'ambiente per fare i test come si deve" -- parametri del
// banco di prova del ragdoll attivo, tutti modificabili dal vivo dal
// pannello lil-gui "Banco ragdoll" (CombatArenaGUI.tsx) e letti ogni
// frame da useRagdollActive.ts. Raggruppati in un solo oggetto dello
// store (ragdollBench/setRagdollBench) invece di un campo per ciascuno,
// cosi' aggiungere un parametro di test non richiede di toccare tre
// punti diversi di store.ts.
export interface RagdollBenchSettings {
  // Disegna, oltre alle capsule FISICHE (colorate per segmento), anche
  // le capsule BERSAGLIO (dove l'animazione vorrebbe ogni corpo) in
  // bianco trasparente -- se il ragdoll segue bene l'animazione le due
  // si sovrappongono esattamente.
  showTargets: boolean;
  // Tabella a schermo con errore di posizione/angolo per segmento e gli
  // angoli di ogni giunto rispetto ai suoi limiti.
  showOverlay: boolean;
  // Bacino cinematico (incollato all'animazione) invece che guidato da
  // molle -- isola gli errori dei giunti degli arti da quelli
  // dell'equilibrio del bacino.
  pinHips: boolean;
  // Scala di gravita' dei corpi del ragdoll VIVO (motori accesi). 0 =
  // nessuna gravita' (il corpo segue l'animazione e reagisce solo ai
  // colpi -- tipico approccio "active ragdoll"), 1 = gravita' piena
  // (i motori devono anche reggere il peso). In modalita' passiva/KO la
  // gravita' e' sempre piena.
  aliveGravityScale: number;
  // Moltiplicatori globali dei motori dei giunti (rigidita' e
  // smorzamento relativo) sopra i valori per segmento di ragdollConfig.ts.
  stiffnessMul: number;
  dampingRatio: number;
  // Feed-forward della velocita' dei giunti chiesta dall'animazione (i
  // motori inseguono anche la velocita', non solo l'angolo -> meno
  // ritardo nei movimenti veloci).
  motorFeedForward: boolean;
  // Pulsazione (rad/s) del servo d'orientamento MONDO applicato a ogni
  // segmento oltre ai motori dei giunti (0 = spento) -- vedi
  // useRagdollActive.ts.
  worldDriveFreq: number;
  // Forza il peso di render fisica->ossa a 1 (il modello mostra SOLO la
  // fisica) invece del blend automatico fermo/in movimento.
  physicsOnlyRender: boolean;
  // Nome di una clip da riprodurre in loop al posto della macchina a
  // stati del giocatore (null = gioco normale).
  benchClip: string | null;
  // Forza del colpo di prova (m/s di variazione di velocita' impressa al
  // segmento colpito).
  testHitSpeed: number;
  // Incrementato per chiedere la ricostruzione del rig (dopo aver
  // cambiato parametri che valgono solo al build).
  rebuildNonce: number;
  // --- KO "alla GTA IV" (pannello "Laboratorio KO", useRagdollActive.ts) ---
  // Tono muscolare all'istante del colpo (frazione della rigidita' da
  // vivo): il corpo tiene la sua forma invece di afflosciarsi di colpo.
  koTone: number;
  // Costante di tempo (s) con cui il tono cala dopo il colpo.
  koRelaxS: number;
  // Tono minimo che resta finche' non e' del tutto molle (svenuto, non
  // morto: gli arti non ciondolano come stracci).
  koFloor: number;
  // Al massimo dopo quanti secondi i muscoli si fermano al tono minimo
  // (di solito succede prima: mezzo secondo dopo che e' atterrato).
  koLimpS: number;
  // Riflesso di parata: forza (frazione della rigidita' da vivo) con cui
  // le braccia vanno verso il suolo nella direzione della caduta...
  koReflex: number;
  // ...e per quanti secondi dopo il colpo.
  koReflexS: number;
}

export const DEFAULT_RAGDOLL_BENCH: RagdollBenchSettings = {
  showTargets: true,
  showOverlay: false,
  pinHips: false,
  aliveGravityScale: 0,
  stiffnessMul: 1,
  dampingRatio: 1,
  motorFeedForward: true,
  worldDriveFreq: 20,
  physicsOnlyRender: false,
  benchClip: null,
  testHitSpeed: 12,
  rebuildNonce: 0,
  koTone: 0.45,
  koRelaxS: 0.7,
  koFloor: 0.12,
  koLimpS: 2.5,
  koReflex: 0.55,
  koReflexS: 0.9,
};

// campi del "Laboratorio KO" (per "Copia valori")
export const KO_BENCH_KEYS = ['koTone', 'koRelaxS', 'koFloor', 'koLimpS', 'koReflex', 'koReflexS'] as const;
