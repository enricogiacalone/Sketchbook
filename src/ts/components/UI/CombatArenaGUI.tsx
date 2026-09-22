import { useEffect } from 'react';
import { useStore } from '../../store';
import type { GameMode } from '../Environment/SquadArenaTypes';
import { acquireDebugGui, releaseDebugGui } from '../../lib/debugGui';

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
    const settings: { modalita: GameMode; combattenti: number; manichino: boolean; colliderFisici: boolean; ragdollAttivo: boolean; hudGioco: boolean } = {
      modalita: useStore.getState().arenaGameMode,
      combattenti: useStore.getState().arenaFighterCount,
      manichino: useStore.getState().duelDummyMode,
      colliderFisici: useStore.getState().showPhysicsDebug,
      ragdollAttivo: useStore.getState().euphoriaRagdollEnabled,
      hudGioco: useStore.getState().showGameplayHud,
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

    // "fai riferimenti visivi per ragdoll e fisica dei solidi" -- see
    // store.ts's own showPhysicsDebug comment.
    folder
      .add(settings, 'colliderFisici')
      .name('Mostra collider fisici')
      .onChange((active: boolean) => useStore.getState().setShowPhysicsDebug(active));

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

    // "le colonne devono essere retratte" -- lil-gui folders actually
    // default to OPEN (verified live -- omitting .open() was NOT enough
    // on its own), so this needs an explicit .close() to start
    // collapsed, rather than taking up half the screen the instant the
    // game loads.
    folder.close();

    return () => {
      folder.destroy();
      releaseDebugGui();
    };
  }, []);

  return null;
};

export default CombatArenaGUI;
