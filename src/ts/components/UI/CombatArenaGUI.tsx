import { useEffect } from 'react';
import GUI from 'lil-gui';
import { useStore } from '../../store';
import type { GameMode } from '../Environment/SquadArenaTypes';

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

    const gui = new GUI({ title: 'Arena' });
    const folder = gui.addFolder('Combattimento');

    // lil-gui needs a plain object + property name to bind a control to;
    // this one's sole job is to forward onChange into the store (read back
    // via getState() so this effect doesn't need to re-subscribe/rebuild
    // the panel every time either value changes elsewhere).
    const settings: { modalita: GameMode; combattenti: number } = {
      modalita: useStore.getState().arenaGameMode,
      combattenti: useStore.getState().arenaFighterCount,
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

    folder.open();

    return () => gui.destroy();
  }, []);

  return null;
};

export default CombatArenaGUI;
