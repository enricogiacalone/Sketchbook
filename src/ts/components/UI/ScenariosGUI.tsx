import { useEffect } from 'react';
import GUI from 'lil-gui';
import { RUNWAY_CENTER, HELIPORT_CENTER } from '../Environment/Airport';

// Debug-only teleport panel ("Scenari") built on the __teleportPlayer hook
// Player.tsx already exposes on window for exactly this kind of manual
// testing (see the "TEMP DEBUG (Claude)" block there). Gated the same way
// that hook is -- import.meta.env.DEV only -- so it never ships to a real
// build, matching the rest of this file's debug-only precedent.
const ScenariosGUI: React.FC = () => {
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const gui = new GUI({ title: 'Debug' });
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
    };

    scenari.add(scenarios, 'Vai all\'aereo');
    scenari.add(scenarios, 'Vai all\'elicottero');
    scenari.open();

    return () => gui.destroy();
  }, []);

  return null;
};

export default ScenariosGUI;
