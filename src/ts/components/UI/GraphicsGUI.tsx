import { useEffect } from 'react';
import { useStore } from '../../store';
import { acquireDebugGui, releaseDebugGui } from '../../lib/debugGui';
import { adaptiveResInfo } from '../Environment/AdaptiveResolution';

// Pannello "Grafica" (nel pannello Debug in alto a destra): le stesse due
// caselle del menu iniziale, per cambiarle durante la partita.
const GraphicsGUI: React.FC = () => {
  useEffect(() => {
    const gui = acquireDebugGui();
    const folder = gui.addFolder('Grafica');
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
    };
    folder.add(bind, 'toon').name('Stile toon').listen();
    folder.add(bind, 'giornata').name('Scorre la giornata (giorno/notte)').listen();
    folder.add(bind, 'adattiva').name('Risoluzione adattiva').listen();
    folder.add(adaptiveResInfo, 'dpr').name('  risoluzione (dpr)').listen().disable();
    folder.add(adaptiveResInfo, 'fps').name('  fps').listen().disable();
    return () => {
      folder.destroy();
      releaseDebugGui();
    };
  }, []);
  return null;
};

export default GraphicsGUI;
