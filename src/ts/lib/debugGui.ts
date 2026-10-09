import GUI from 'lil-gui';
import { useStore } from '../store';

// "sistema lil gui.. le colonne devono essere retratte e nn accavallarsi
// (per ora mi sembrano staccate)" -- root cause, confirmed live in the
// browser: ScenariosGUI.tsx and CombatArenaGUI.tsx each used to build
// their OWN independent `new GUI()` root panel. lil-gui's default
// `position: fixed` anchor is IDENTICAL for every root instance (top-
// right corner) -- two separate roots landed exactly on top of each
// other, pixel-for-pixel (getBoundingClientRect() on both `.lil-root`
// elements returned the same top/left/right). Whichever mounted LATER in
// React's render order (CombatArenaGUI, after ScenariosGUI in App.tsx)
// painted over the other's title bar and first rows entirely -- that's
// the "staccate" look: the still-visible tail end of ScenariosGUI's own
// button list just hanging below CombatArenaGUI's shorter panel with no
// header of its own, while its OWN title and first two buttons were
// completely hidden and unclickable underneath.
//
// Fix: a single shared root GUI, created lazily by whichever debug panel
// component mounts first; every panel adds its own FOLDER to this ONE
// root instead of its own root -- lil-gui stacks folders inside one root
// vertically and automatically, so there's no manual overlap/position
// math to get wrong, ever. Ref-counted so one panel unmounting (Vite
// HMR, React StrictMode's mount/unmount/remount) doesn't destroy the
// shared root out from under a still-mounted sibling.
let sharedGui: GUI | null = null;
let refCount = 0;

export function acquireDebugGui(): GUI {
  if (!sharedGui) {
    // "fai partire l'arena con le gui tutte chiuse": pannello chiuso e
    // cartelle chiuse di default (si aprono cliccando il titolo)
    sharedGui = new GUI({ title: 'Debug', closeFolders: true });
    sharedGui.close();
    createSections(sharedGui);
  }
  refCount += 1;
  return sharedGui;
}

// --- Sezioni -------------------------------------------------------------
// "organizza meglio le cartelle hud, al momento e' tutto sparso e con
// duplicati. dividi quello che si vede solo in arena da quello che si vede
// in playground: quando entro in scena devo vedere solo i relativi a
// playground o arena, o se comuni in entrambe". Il pannello ha sezioni
// fisse, sempre in quest'ordine; ogni pannello mette le sue cartelle nella
// sua sezione (debugSection) e ogni sezione si vede solo nella scena a cui
// appartiene (e solo se ha qualcosa dentro).
type TestScene = ReturnType<typeof useStore.getState>['testScene'];
export type DebugSectionId = 'arena' | 'playground' | 'test' | 'personaggio' | 'fisica' | 'meteoriti' | 'grafica';
const SECTIONS: Array<{ id: DebugSectionId; title: string; visible: (scene: TestScene, joined: boolean) => boolean }> = [
  // solo nel duello (Duello 1v1)
  { id: 'arena', title: 'Arena', visible: (scene, joined) => joined && scene === 'duel' },
  // solo nella citta' (Enter Playground)
  { id: 'playground', title: 'Playground', visible: (scene, joined) => joined && scene === 'none' },
  // scenari di test puliti (volo, guida, gara)
  { id: 'test', title: 'Scenario di test', visible: (scene, joined) => joined && scene !== 'none' && scene !== 'duel' },
  // comuni
  { id: 'personaggio', title: 'Personaggio e camera', visible: () => true },
  { id: 'fisica', title: 'Fisica e ragdoll', visible: () => true },
  // il cielo con i meteoriti c'e' in citta', nel duello e nella gara (Scene.tsx)
  { id: 'meteoriti', title: 'Meteoriti', visible: (scene, joined) => joined && (scene === 'none' || scene === 'duel' || scene === 'race') },
  { id: 'grafica', title: 'Grafica', visible: () => true },
];
let sections: Partial<Record<DebugSectionId, GUI>> = {};
let unsubscribe: (() => void) | null = null;
let refreshQueued = false;

function createSections(root: GUI) {
  sections = {};
  for (const s of SECTIONS) {
    const f = root.addFolder(s.title);
    f.close();
    sections[s.id] = f;
  }
  unsubscribe = useStore.subscribe((st, prev) => {
    if (st.testScene !== prev.testScene || st.gameJoined !== prev.gameJoined) refreshDebugSections();
  });
  refreshDebugSections();
}

// mostra/nasconde le sezioni per la scena attuale (e quelle vuote)
export function refreshDebugSections() {
  if (refreshQueued) return;
  refreshQueued = true;
  queueMicrotask(() => {
    refreshQueued = false;
    const { testScene, gameJoined } = useStore.getState();
    for (const s of SECTIONS) {
      const f = sections[s.id];
      if (!f) continue;
      f.show(f.children.length > 0 && s.visible(testScene, gameJoined));
    }
  });
}

// la cartella della sezione (il pannello va preso con acquireDebugGui prima
// e rilasciato con releaseDebugGui dopo, come sempre)
export function debugSection(id: DebugSectionId): GUI {
  if (!sharedGui) acquireDebugGui();
  refreshDebugSections();
  return sections[id]!;
}

// Call once per acquireDebugGui() call, from the SAME component's own
// cleanup -- decrements the ref count and only actually tears down the
// shared root once every consumer is gone. Destroy your own folder(s)
// BEFORE calling this (see ScenariosGUI.tsx/CombatArenaGUI.tsx), so a
// sibling that's still mounted never briefly sees a torn-down folder
// sitting in an otherwise-live panel.
export function releaseDebugGui(): void {
  refCount -= 1;
  if (refCount <= 0 && sharedGui) {
    unsubscribe?.();
    unsubscribe = null;
    sections = {};
    sharedGui.destroy();
    sharedGui = null;
    refCount = 0;
    return;
  }
  refreshDebugSections();
}
