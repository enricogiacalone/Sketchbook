import { useEffect } from 'react';
import type GUI from 'lil-gui';
import { useStore } from '../../store';
import type { GameMode } from '../Environment/SquadArenaTypes';
import { acquireDebugGui, debugSection, releaseDebugGui } from '../../lib/debugGui';
import { pistolHoldTuning, rifleHoldTuning } from '../Environment/weapons/usePistolModel';
import { knifeHoldTuning } from '../Environment/weapons/useKnifeModel';
import { locomotionTuning, CLIP_GROUND_SPEED, RUN_CLIP } from '../Environment/locomotion';
import { flyBrainSettings } from '../../flyBrain/flyBrainSettings';

// Cartelle del pannello Debug (vedi lib/debugGui.ts per le sezioni):
//  - Arena (solo nel duello): avversari, oggetti in scena, cervello mosca
//  - Playground (solo in citta'): simulation-citta (soldati decorativi e
//    arena rossi contro blu di SoldierSpawner.tsx, con modalita' e numero
//    di combattenti -- CombatArena.tsx le legge dallo store e ricrea i
//    combattenti quando cambiano)
//  - Personaggio e camera (comune): locomozione e presa delle armi
// I controlli di fisica e ragdoll (prima qui, doppi col banco ragdoll)
// stanno in "Fisica e ragdoll" (RagdollBenchGUI.tsx), l'HUD di gioco in
// "Grafica" (GraphicsGUI.tsx).
const MODE_OPTIONS: Record<string, GameMode> = {
  '🏰 Controllo Territorio (Torri)': 'TERRITORY_CONTROL',
  '⚔️ Squadra Blu vs Rossa': 'TEAMS',
  '🔥 Tutti contro Tutti': 'FFA',
};

const CombatArenaGUI: React.FC = () => {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    acquireDebugGui();
    const st = () => useStore.getState();
    const own: GUI[] = [];
    const bind = {
      get modalita() {
        return st().arenaGameMode;
      },
      set modalita(v: GameMode) {
        st().setArenaGameMode(v);
      },
      get combattenti() {
        return st().arenaFighterCount;
      },
      set combattenti(v: number) {
        st().setArenaFighterCount(v);
      },
      get simCitta() {
        return st().showSimCitta;
      },
      set simCitta(v: boolean) {
        st().setShowSimCitta(v);
      },
      get manichino() {
        return st().duelDummyMode;
      },
      set manichino(v: boolean) {
        st().setDuelDummyMode(v);
      },
    };

    // --- Arena (duello) ---
    const arena = debugSection('arena');
    const enemies = arena.addFolder('Avversari');
    own.push(enemies);
    // "crea un tasto aggiungi nemico": ogni pressione ne aggiunge UNO in piu'
    // (store.duelEnemyCount, vedi DuelArena.tsx); "Rimuovi nemici" li toglie tutti
    enemies.add({ f: () => st().addDuelEnemy() }, 'f').name('Aggiungi nemico');
    enemies.add({ f: () => st().clearDuelEnemies() }, 'f').name('Rimuovi nemici');
    enemies.add(bind, 'manichino').name('Manichino (avversario passivo)').listen();

    // "una gui per togliere gli ostacoli, le mura, il pavimento, le casse"
    const sceneFolder = arena.addFolder('Oggetti in scena');
    own.push(sceneFolder);
    const sceneState = { ...st().arenaScene };
    const sceneToggle = (key: keyof typeof sceneState, label: string) =>
      sceneFolder
        .add(sceneState, key)
        .name(label)
        .onChange((v: boolean) => st().setArenaScene({ [key]: v }));
    sceneToggle('obstacles', 'Ostacoli (pendoli, pistoni, pale)');
    sceneToggle('walls', 'Mura');
    sceneToggle('floor', 'Pavimento');
    sceneToggle('speakers', 'Casse');
    sceneToggle('course', 'Percorso parkour');
    sceneToggle('car', 'Auto');

    // "la mosca si crede un umano" (FlyBrainFighter.tsx, montato da DuelArena)
    const fly = arena.addFolder('Cervello mosca');
    own.push(fly);
    fly.add(flyBrainSettings, 'show').name('Mostra la mosca-umano');
    fly.add(flyBrainSettings, 'task', { 'Stare in piedi': 'stand', Camminare: 'walk', 'Alzarsi da terra': 'getup' }).name('Compito');
    fly.add(flyBrainSettings, 'brainOff').name('Cervello spento (confronto)');
    fly.add({ f: () => flyBrainSettings.resetNonce++ }, 'f').name('Riparti');
    fly.add({ f: () => flyBrainSettings.reloadNonce++ }, 'f').name('Ricarica pesi addestrati');
    fly.add(flyBrainSettings, 'info').name('Stato').listen().disable();

    // --- Playground (citta') ---
    // "di default nn si deve vedere la roba di simulation citta"
    const simCitta = debugSection('playground').addFolder('Simulation-città');
    own.push(simCitta);
    simCitta.add(bind, 'simCitta').name('Mostra simulation-città').listen();
    simCitta.add(bind, 'modalita', MODE_OPTIONS).name('Modalità scontro').listen();
    // "da un minimo di 0 a 120 combattenti"
    simCitta.add(bind, 'combattenti', 0, 120, 1).name('Combattenti (0-120)').listen();

    // --- Personaggio e camera (comune) ---
    const pers = debugSection('personaggio');
    // Velocita' di camminata/corsa: la clip si adatta da sola (locomotion.ts)
    const loco = pers.addFolder('Locomozione');
    own.push(loco);
    loco.add(locomotionTuning, 'walkSpeed', 0.5, 3, 0.05).name('Camminata (m/s)');
    loco.add(locomotionTuning, 'jogSpeed', 1.5, 6, 0.1).name('Corsa X/Shift tenuto (m/s)');
    loco.add(locomotionTuning, 'runSpeed', 2.5, 8, 0.1).name('Scatto X/Shift ripetuto (m/s)');
    loco.add(locomotionTuning, 'aimWalkSpeed', 0.4, 2, 0.05).name('Camminata in mira (m/s)');
    loco.add(locomotionTuning, 'aiChargeSpeed', 1, 8, 0.1).name('Carica nemici (m/s)');
    loco
      .add(
        {
          f: () =>
            console.log(
              `[locomozione] Walk x${(locomotionTuning.walkSpeed / CLIP_GROUND_SPEED.Walk).toFixed(2)}, ${RUN_CLIP} x${(locomotionTuning.runSpeed / CLIP_GROUND_SPEED[RUN_CLIP]).toFixed(2)}`
            ),
        },
        'f'
      )
      .name('Scrivi timeScale in console');

    // "metti dentro la stessa cartella fucile pistola coltello (presa)":
    // presa nella mano destra, letta ogni frame (i cursori agiscono dal vivo)
    const weapons = pers.addFolder('Armi (presa)');
    own.push(weapons);
    for (const [title, t, r] of [
      ['Pistola', pistolHoldTuning, 0.2],
      ['Fucile', rifleHoldTuning, 0.3],
      ['Coltello', knifeHoldTuning, 0.3],
    ] as const) {
      const f = weapons.addFolder(title);
      f.add(t, 'px', -r, r, 0.005).name('pos X');
      f.add(t, 'py', -r, 0.3, 0.005).name('pos Y');
      f.add(t, 'pz', -r, r, 0.005).name('pos Z');
      f.add(t, 'rx', -180, 180, 1).name('rot X');
      f.add(t, 'ry', -180, 180, 1).name('rot Y');
      f.add(t, 'rz', -180, 180, 1).name('rot Z');
    }

    return () => {
      own.forEach((f) => f.destroy());
      releaseDebugGui();
    };
  }, []);

  return null;
};

export default CombatArenaGUI;
