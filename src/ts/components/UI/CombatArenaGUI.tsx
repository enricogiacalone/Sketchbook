import { useEffect } from 'react';
import { useStore } from '../../store';
import type { GameMode } from '../Environment/SquadArenaTypes';
import { acquireDebugGui, releaseDebugGui } from '../../lib/debugGui';
import { pistolHoldTuning } from '../Environment/weapons/usePistolModel';

// "fammi scegliere come su simulation citta le modalita di scontro dei
// manichini che si combattono" -- simulation-citta's CombatArenaSimulation
// had an on-page "Modalita Scontro" <select> plus a "Combattenti" count
// slider (2-120) that both recreated the fighters whenever they changed.
// This is that same pair of controls, ported as a lil-gui panel -- same
// debug-panel mechanism ScenariosGUI.tsx already uses here -- writing into
// the store (`arenaGameMode` / `arenaFighterCount`) instead of local
// component state, since a lil-gui panel lives outside the R3F scene tree
// and can't reach CombatArena.tsx's props directly.
//
// CombatArena.tsx reads both from the store and rebuilds its fighters
// (team assignments, HP, positions, and now count) whenever either
// changes -- the same "changing a setting restarts the match" behavior
// the original had.
//
// lil-gui's dropdown-options object is {label: value}, so this maps the
// same labels the original <select> used to their GameMode value (the
// inverse of what you'd want for just *displaying* the current mode).
const MODE_OPTIONS: Record<string, GameMode> = {
  '🏰 Controllo Territorio (Torri)': 'TERRITORY_CONTROL',
  '⚔️ Squadra Blu vs Rossa': 'TEAMS',
  '🔥 Tutti contro Tutti': 'FFA',
};

const CombatArenaGUI: React.FC = () => {
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    // "le colonne devono essere retratte e nn accavallarsi" -- shared
    // root panel (see lib/debugGui.ts's own big comment for why), this
    // component only ever owns its OWN folder inside it.
    const gui = acquireDebugGui();
    const folder = gui.addFolder('Arena');

    // lil-gui needs a plain object + property name to bind a control to;
    // this one's sole job is to forward onChange into the store (read back
    // via getState() so this effect doesn't need to re-subscribe/rebuild
    // the panel every time either value changes elsewhere).
    const settings: { modalita: GameMode; combattenti: number; manichino: boolean; colliderFisici: boolean; colliderRagdollAttivo: boolean; ragdollAttivo: boolean; hudGioco: boolean; ragdollPassivo: boolean; fisicaInPausa: boolean; tPose: boolean; cameraOrtogonale: boolean } = {
      modalita: useStore.getState().arenaGameMode,
      combattenti: useStore.getState().arenaFighterCount,
      manichino: useStore.getState().duelDummyMode,
      colliderFisici: useStore.getState().showPhysicsDebug,
      colliderRagdollAttivo: useStore.getState().showActiveRagdollDebug,
      ragdollAttivo: useStore.getState().euphoriaRagdollEnabled,
      hudGioco: useStore.getState().showGameplayHud,
      ragdollPassivo: useStore.getState().ragdollPassive,
      fisicaInPausa: useStore.getState().isPaused,
      tPose: useStore.getState().tPoseDebug,
      cameraOrtogonale: useStore.getState().debugOrthoCamera,
    };

    folder
      .add(settings, 'modalita', MODE_OPTIONS)
      .name('Modalita Scontro')
      .onChange((mode: GameMode) => useStore.getState().setArenaGameMode(mode));

    // "da un minimo di 0 a 120 combattenti" -- 0 lets the whole arena be
    // switched off, unlike the original's 2-120 range.
    folder
      .add(settings, 'combattenti', 0, 120, 1)
      .name('Combattenti (0-120)')
      .onChange((count: number) => useStore.getState().setArenaFighterCount(count));

    // "il comando per rendere passivo l'avversario deve stare dentro la
    // sezione arena" -- moved here from DuelHUD.tsx's own standalone
    // floating button (same store field/effect, duelDummyMode -- see
    // DuelArena.tsx's own mirror of it onto the AI fighter's
    // isPassive -- just one control living in the debug panel instead of
    // a second one duplicated as an HTML overlay button).
    folder
      .add(settings, 'manichino')
      .name('Manichino (avversario passivo)')
      .onChange((active: boolean) => useStore.getState().setDuelDummyMode(active));

    // "crea un tasto aggiungi nemico invece di aggiungerlo subito" -- il
    // duello parte senza avversari. "il bottone aggiungi nemico deve
    // aggiungere un nemico nuovo tutte le volte che lo premo" -- ogni
    // pressione ne aggiunge UNO in piu' (store.ts's duelEnemyCount, vedi
    // DuelArena.tsx); "Rimuovi nemici" li toglie tutti.
    folder
      .add({ aggiungiNemico: () => useStore.getState().addDuelEnemy() }, 'aggiungiNemico')
      .name('Aggiungi nemico');
    folder
      .add({ rimuoviNemici: () => useStore.getState().clearDuelEnemies() }, 'rimuoviNemici')
      .name('Rimuovi nemici');

    // "fai riferimenti visivi per ragdoll e fisica dei solidi" -- see
    // store.ts's own showPhysicsDebug comment.
    folder
      .add(settings, 'colliderFisici')
      .name('Mostra collider fisici')
      .onChange((active: boolean) => useStore.getState().setShowPhysicsDebug(active));

    // "ma secondo me c sn doppi corpi solidi" -- flag separato da
    // "Mostra collider fisici" sopra (quello e' il layer solid-body,
    // questo e' il layer fisico ATTIVO -- 17 corpi, vedi
    // ActiveRagdollDebugView.tsx) apposta cosi' si possono accendere UNO
    // ALLA VOLTA e confrontare, invece di vederli sempre sovrapposti
    // senza modo di distinguerli.
    folder
      .add(settings, 'colliderRagdollAttivo')
      .name('Mostra collider ragdoll attivo')
      .onChange((active: boolean) => useStore.getState().setShowActiveRagdollDebug(active));

    // "questo mi sembra piu' sostenibile" -- toggle live del layer PD
    // sempre attivo (ragdollConfig.ts's RAGDOLL_MOTOR_STIFFNESS/
    // RAGDOLL_HIPS_POSITION_STIFFNESS), per poterlo tarare/confrontare
    // A/B senza dover ricaricare la pagina ogni volta.
    folder
      .add(settings, 'ragdollAttivo')
      .name('Ragdoll attivo (PD)')
      .onChange((active: boolean) => useStore.getState().setEuphoriaRagdollEnabled(active));

    // "togli tutta la merda ui in piu' che nn c'entra con questo test..
    // mettila disabilitata di default ma abilitabile tramite checkbox in
    // lil gui" -- Controls/StatusBars/MissionHUD/Minimap/benvenuto
    // (App.tsx) spenti di default durante i test del ragdoll, riaccendibili
    // da qui.
    folder
      .add(settings, 'hudGioco')
      .name('Mostra HUD di gioco')
      .onChange((active: boolean) => useStore.getState().setShowGameplayHud(active));

    // "fai un checkbox in cui il ragdoll diventa passivo e cade
    // stramazzato" -- spegne i motori PD del layer attivo (vedi
    // store.ts's own ragdollPassive comment): il corpo crolla a terra
    // sorretto solo da gravita' e giunti, niente muscoli che lo
    // riportano verso l'animazione.
    folder
      .add(settings, 'ragdollPassivo')
      .name('Ragdoll passivo (cade stramazzato)')
      .onChange((active: boolean) => useStore.getState().setRagdollPassive(active));

    // "impostare la vista in modo da avere dei test empirici.. sia per
    // te che per me.. cosi' almeno capiamo cosa nn va" -- un crollo vero
    // dura meno di un secondo, troppo in fretta per seguirlo a occhio.
    // Pausa la fisica (App.tsx's <Physics paused={isPaused}>) e poi
    // avanza UN singolo tick alla volta (RagdollPhysicsDebugBridge.tsx's
    // window.__physicsDebug.step, esposto solo in dev) -- vedi anche i
    // collider colorati di ActiveRagdollDebugView.tsx (rosso = fuori dal
    // cono) per capire A COLPO D'OCCHIO quale giunto sta sforando in
    // quel preciso istante, invece di doverlo dedurre da numeri presi a
    // campione ogni tot millisecondi.
    folder
      .add(settings, 'fisicaInPausa')
      .name('Pausa fisica')
      .onChange((active: boolean) => useStore.getState().setPaused(active));

    folder
      .add({ passoSingolo: () => (window as any).__physicsDebug?.step() }, 'passoSingolo')
      .name('Passo singolo fisica (1/120s)');

    // "cazzo metti il personaggio a T osservalo" -- ferma l'animazione e
    // forza lo skeleton alla bind pose (PlayerCombatSoldier.tsx's
    // useFrame) cosi' i collider si ispezionano contro una posa statica
    // nota invece che contro un'animazione in movimento. Spegne ANCHE il
    // layer PD sempre-attivo (altrimenti i motori continuerebbero a
    // inseguire l'animazione normale e tirerebbero le ossa via dalla
    // T-pose ogni frame, vanificandola) -- si puo' sempre riaccendere a
    // mano dal checkbox sopra una volta finita l'ispezione statica.
    folder
      .add(settings, 'tPose')
      .name('T-pose (ferma animazione)')
      .onChange((active: boolean) => {
        // Il ragdoll attivo NON viene piu' spento: la T-pose e' il suo
        // bersaglio (vedi PlayerCombatSoldier.tsx / pannello "Banco
        // ragdoll").
        useStore.getState().setTPoseDebug(active);
      });

    // "aggiungi la possibilita' di attivare la vista ortogonale.. analizza
    // i vari scheletri ad uno ad uno" -- vedi DebugOrthoCamera.tsx.
    folder
      .add(settings, 'cameraOrtogonale')
      .name('Camera ortogonale (debug)')
      .onChange((active: boolean) => useStore.getState().setDebugOrthoCamera(active));

    folder
      .add({
        ruotaVista: () => {
          const cur = useStore.getState().debugOrthoCameraAngleDeg;
          useStore.getState().setDebugOrthoCameraAngleDeg((cur + 90) % 360);
        },
      }, 'ruotaVista')
      .name("Ruota vista 90' (ortogonale)");

    // "le colonne devono essere retratte" -- lil-gui folders actually
    // default to OPEN (verified live -- omitting .open() was NOT enough
    // on its own), so this needs an explicit .close() to start
    // collapsed, rather than taking up half the screen the instant the
    // game loads.
    folder.close();

    // Presa della pistola nella mano destra (vedi usePistolModel.ts):
    // letta ogni frame, quindi i cursori agiscono dal vivo.
    const pistolFolder = gui.addFolder('Pistola (presa)');
    pistolFolder.add(pistolHoldTuning, 'px', -0.2, 0.2, 0.005).name('pos X');
    pistolFolder.add(pistolHoldTuning, 'py', -0.2, 0.3, 0.005).name('pos Y');
    pistolFolder.add(pistolHoldTuning, 'pz', -0.2, 0.2, 0.005).name('pos Z');
    pistolFolder.add(pistolHoldTuning, 'rx', -180, 180, 1).name('rot X');
    pistolFolder.add(pistolHoldTuning, 'ry', -180, 180, 1).name('rot Y');
    pistolFolder.add(pistolHoldTuning, 'rz', -180, 180, 1).name('rot Z');
    pistolFolder.close();

    return () => {
      pistolFolder.destroy();
      folder.destroy();
      releaseDebugGui();
    };
  }, []);

  return null;
};

export default CombatArenaGUI;
