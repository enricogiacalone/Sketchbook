import { useEffect } from 'react';
import { RUNWAY_CENTER, HELIPORT_CENTER } from '../Environment/Airport';
import { acquireDebugGui, releaseDebugGui } from '../../lib/debugGui';

// Debug-only teleport/test panel ("Scenari") built on the __teleportPlayer
// hook Player.tsx already exposes on window for manual testing (see the
// "TEMP DEBUG (Claude)" block there), plus window.__sim's startTest()/
// endTest() (debug/simDebug.ts) for the two clean flight-test scenarios.
// Gated the same way those are -- import.meta.env.DEV only -- so none of
// this ever ships to a real build.
const ScenariosGUI: React.FC = () => {
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    // "le colonne devono essere retratte e nn accavallarsi" -- shared
    // root panel (see lib/debugGui.ts's own big comment for why), this
    // component only ever owns its OWN folder inside it.
    const gui = acquireDebugGui();
    const scenari = gui.addFolder('Scenari');

    // A few meters off each vehicle's spawn point, not on top of it, so the
    // player doesn't land inside the fuselage/chassis and get stuck.
    const scenarios: Record<string, () => void> = {
      'Vai all\'aereo': () => {
        (window as any).__teleportPlayer?.(RUNWAY_CENTER[0] + 4, RUNWAY_CENTER[1]);
      },
      'Vai all\'elicottero': () => {
        (window as any).__teleportPlayer?.(HELIPORT_CENTER[0] + 4, HELIPORT_CENTER[1]);
      },
      // Clean, distraction-free test scenarios: strips the city/traffic/
      // collectibles/missions out of the world (see Scene.tsx's
      // `testScene`), drops the player straight into the cockpit (no
      // walk-up-and-press-F needed), and resets the vehicle to a known
      // pose above its pad. Same one-call setup a console/browser-
      // automation test session gets from window.__sim.startTest().
      'Test volo: Aereo (pulito)': () => {
        (window as any).__sim?.startTest('airplane');
      },
      'Test volo: Elicottero (pulito)': () => {
        (window as any).__sim?.startTest('helicopter');
      },
      'Test guida: Macchina (pulito)': () => {
        (window as any).__sim?.startTest('car');
      },
      // "una gara contro 3 poliziotti in un percorso con curve e dossi" --
      // RaceTrack.tsx's closed-loop circuit, player vs 3 AI police on a
      // starting grid (see Scene.tsx's isRaceTest / debug/simDebug.ts's
      // startRace()).
      'Gara: Auto vs Polizia (3)': () => {
        (window as any).__sim?.startRace();
      },
      'Torna al mondo normale': () => {
        (window as any).__sim?.endTest();
      },
    };

    scenari.add(scenarios, 'Vai all\'aereo');
    scenari.add(scenarios, 'Vai all\'elicottero');
    scenari.add(scenarios, 'Test volo: Aereo (pulito)');
    scenari.add(scenarios, 'Test volo: Elicottero (pulito)');
    scenari.add(scenarios, 'Test guida: Macchina (pulito)');
    scenari.add(scenarios, 'Gara: Auto vs Polizia (3)');
    scenari.add(scenarios, 'Torna al mondo normale');
    // "le colonne devono essere retratte" -- lil-gui folders actually
    // default to OPEN (verified live), so this needs an explicit
    // .close() to start collapsed instead of always springing open the
    // instant the game loads.
    scenari.close();

    return () => {
      scenari.destroy();
      releaseDebugGui();
    };
  }, []);

  return null;
};

export default ScenariosGUI;
