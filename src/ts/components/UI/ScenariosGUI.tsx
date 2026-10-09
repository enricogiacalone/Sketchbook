import { useEffect } from 'react';
import { RUNWAY_CENTER, HELIPORT_CENTER } from '../Environment/Airport';
import { acquireDebugGui, debugSection, releaseDebugGui } from '../../lib/debugGui';
import { useStore } from '../../store';

// Debug-only teleport/test panel built on window.__pcsDebug.teleport
// (PlayerCombatSoldier.tsx) and window.__sim's startTest()/startRace()/
// endTest() (debug/simDebug.ts). Gated the same way those are --
// import.meta.env.DEV only -- so none of this ever ships to a real build.
//
// Pannello Debug (lib/debugGui.ts): "Vai a / test" sta in Playground, il
// ritorno al mondo normale nella sezione "Scenario di test" (si vede solo
// dentro uno scenario pulito), i meteoriti nella loro sezione (citta',
// duello e gara: dove c'e' il cielo coi meteoriti).
const ScenariosGUI: React.FC = () => {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    acquireDebugGui();
    const sim = () => (window as any).__sim;

    // A few meters off each vehicle's spawn point, not on top of it, so the
    // player doesn't land inside the fuselage/chassis and get stuck.
    const go = debugSection('playground').addFolder('Vai a / test');
    go.add({ f: () => (window as any).__pcsDebug?.teleport(RUNWAY_CENTER[0] + 4, RUNWAY_CENTER[1]) }, 'f').name("Vai all'aereo");
    go.add({ f: () => (window as any).__pcsDebug?.teleport(HELIPORT_CENTER[0] + 4, HELIPORT_CENTER[1]) }, 'f').name("Vai all'elicottero");
    // Clean, distraction-free test scenarios: strips the city/traffic/
    // collectibles/missions out of the world (see Scene.tsx's `testScene`),
    // drops the player straight into the cockpit and resets the vehicle to
    // a known pose above its pad.
    go.add({ f: () => sim()?.startTest('airplane') }, 'f').name('Test volo: aereo (pulito)');
    go.add({ f: () => sim()?.startTest('helicopter') }, 'f').name('Test volo: elicottero (pulito)');
    go.add({ f: () => sim()?.startTest('car') }, 'f').name('Test guida: macchina (pulito)');
    // "una gara contro 3 poliziotti in un percorso con curve e dossi" --
    // RaceTrack.tsx (see Scene.tsx's isRaceTest / simDebug.ts's startRace()).
    go.add({ f: () => sim()?.startRace() }, 'f').name('Gara: auto vs polizia (3)');

    const back = debugSection('test')
      .add({ f: () => sim()?.endTest() }, 'f')
      .name('Torna al mondo normale');

    const meteo = debugSection('meteoriti');
    const meteoConfig = {
      attivi: useStore.getState().meteoritesEnabled,
      frequenza: useStore.getState().meteoriteFrequency,
      raggio: useStore.getState().explosionRadius,
      intensita: useStore.getState().explosionIntensity,
    };
    const meteoCtrls = [
      meteo
        .add(meteoConfig, 'attivi')
        .name('Attivi')
        .onChange((v: boolean) => useStore.getState().setMeteoritesEnabled(v)),
      meteo
        .add(meteoConfig, 'frequenza', 1, 20, 1)
        .name('Frequenza (s)')
        .onChange((v: number) => useStore.getState().setMeteoriteFrequency(v)),
      meteo
        .add(meteoConfig, 'raggio', 5, 50, 1)
        .name('Raggio esplosione')
        .onChange((v: number) => useStore.getState().setExplosionRadius(v)),
      meteo
        .add(meteoConfig, 'intensita', 0.2, 3.0, 0.1)
        .name('Intensità esplosione')
        .onChange((v: number) => useStore.getState().setExplosionIntensity(v)),
    ];

    return () => {
      meteoCtrls.forEach((c) => c.destroy());
      back.destroy();
      go.destroy();
      releaseDebugGui();
    };
  }, []);

  return null;
};

export default ScenariosGUI;
