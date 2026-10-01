import GUI from 'lil-gui';

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
  }
  refCount += 1;
  return sharedGui;
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
    sharedGui.destroy();
    sharedGui = null;
    refCount = 0;
  }
}
