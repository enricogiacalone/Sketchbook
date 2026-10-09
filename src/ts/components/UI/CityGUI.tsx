import { useEffect } from 'react';
import { useStore } from '../../store';
import { acquireDebugGui, debugSection, releaseDebugGui } from '../../lib/debugGui';
import { CROWD_MAX_SLOTS, crowdSlotCount, crowdSlots } from '../city/crowdSim';
import { realBuildingsInfo } from '../Environment/City';
import { getWorldSeed, reseedWorld } from '../../lib/worldSeed';
import { deleteSave, saveGame } from '../../lib/saveGame';

// Cartella "Citta'" (pannello Debug > Playground): "mettimi un hud
// con cui configurare il numero di corpi veri, e anche uno per aumentare i
// palazzi veri". Corpi veri = passanti con fisica, animazioni e ragdoll (gli
// altri sono sagome); palazzi veri = muri con le finestre bucate, interni,
// scale e collider (gli altri sono il modello semplice da lontano). Piu' ne
// metti, piu' costa: i numeri sotto dicono quanti ce ne sono davvero.
const CityGUI: React.FC = () => {
  useEffect(() => {
    // solo in Playground (sezione del pannello Debug, vedi lib/debugGui.ts)
    acquireDebugGui();
    const folder = debugSection('playground').addFolder('Città');
    const st = () => useStore.getState();
    const bind = {
      get corpi() {
        return st().crowdBodies;
      },
      set corpi(v: number) {
        st().setCrowdBodies(v);
      },
      get attiva() {
        return st().crowdActiveRagdoll;
      },
      set attiva(v: boolean) {
        st().setCrowdActiveRagdoll(v);
      },
      get palazzi() {
        return st().realBuildingDist;
      },
      set palazzi(v: number) {
        st().setRealBuildingDist(v);
      },
    };
    const info = {
      get corpiInfo() {
        let used = 0;
        let dead = 0;
        const n = crowdSlotCount();
        for (let s = 0; s < n; s++) {
          const a = crowdSlots[s];
          if (!a) continue;
          used++;
          if (a.gone) dead++;
        }
        return `${used} / ${n} in uso (${dead} a terra)`;
      },
      get palazziInfo() {
        return `${realBuildingsInfo.count} / ${realBuildingsInfo.total}`;
      },
    };
    folder.add(bind, 'corpi', 0, CROWD_MAX_SLOTS, 1).name('Passanti: corpi veri').listen();
    folder.add(info, 'corpiInfo').name('  corpi').listen().disable();
    folder.add(bind, 'attiva').name('Passanti: ragdoll attiva').listen();
    folder.add(bind, 'palazzi', 20, 250, 5).name('Palazzi veri entro (m)').listen();
    folder.add(info, 'palazziInfo').name('  palazzi veri').listen().disable();
    // la citta' e' sempre la stessa (seme nel database, lib/worldSeed.ts)
    folder
      .add({ seme: String(getWorldSeed()) }, 'seme')
      .name('Seme della città')
      .disable();
    folder.add({ f: () => reseedWorld() }, 'f').name('Nuova città (cambia seme)');
    // salvataggio (lib/saveGame.ts)
    folder.add({ f: () => saveGame() }, 'f').name('Salva adesso');
    folder.add({ f: () => deleteSave() }, 'f').name('Cancella salvataggio');
    return () => {
      folder.destroy();
      releaseDebugGui();
    };
  }, []);
  return null;
};

export default CityGUI;
