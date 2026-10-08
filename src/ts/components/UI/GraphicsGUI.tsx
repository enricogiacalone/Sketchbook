import { useEffect } from 'react';
import { useStore } from '../../store';
import { acquireDebugGui, debugSection, releaseDebugGui } from '../../lib/debugGui';
import { adaptiveResInfo } from '../Environment/AdaptiveResolution';

// Sezione "Grafica" del pannello Debug (comune a tutte le scene): le stesse
// caselle del menu iniziale, per cambiarle durante la partita, e l'HUD di
// gioco (prima stava nella cartella "Arena").
const GraphicsGUI: React.FC = () => {
  useEffect(() => {
    acquireDebugGui();
    const folder = debugSection('grafica');
    const st = () => useStore.getState();
    const bind = {
      get toon() {
        return st().toonStyle;
      },
      set toon(v: boolean) {
        st().setToonStyle(v);
      },
      get giornata() {
        return st().dayCycle;
      },
      set giornata(v: boolean) {
        st().setDayCycle(v);
      },
      get adattiva() {
        return st().adaptiveResolution;
      },
      set adattiva(v: boolean) {
        st().setAdaptiveResolution(v);
      },
      // "togli tutta la merda ui in piu' che nn c'entra con questo test..
      // mettila disabilitata di default ma abilitabile tramite checkbox":
      // Controls/StatusBars/MissionHUD/Minimap (App.tsx)
      get hud() {
        return st().showGameplayHud;
      },
      set hud(v: boolean) {
        st().setShowGameplayHud(v);
      },
    };
    const ctrls = [
      folder.add(bind, 'toon').name('Stile toon').listen(),
      folder.add(bind, 'giornata').name('Scorre la giornata (giorno/notte)').listen(),
      folder.add(bind, 'adattiva').name('Risoluzione adattiva').listen(),
      folder.add(adaptiveResInfo, 'dpr').name('  risoluzione (dpr)').listen().disable(),
      folder.add(adaptiveResInfo, 'fps').name('  fps').listen().disable(),
      folder.add(bind, 'hud').name('Mostra HUD di gioco').listen(),
    ];
    return () => {
      ctrls.forEach((c) => c.destroy());
      releaseDebugGui();
    };
  }, []);
  return null;
};

export default GraphicsGUI;
