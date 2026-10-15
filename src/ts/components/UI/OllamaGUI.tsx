import { useEffect } from 'react';
import { acquireDebugGui, debugSection, releaseDebugGui } from '../../lib/debugGui';
import { missionBus } from '../../lib/missionBus';
import { MISSION_1, MISSION_2, MISSION_TITLES } from '../../missions/storyMission';
import { MISSION_3, MISSION_3_TITLE } from '../../missions/heist';

// Pannello Debug: le missioni vere del gioco (storia di Vito e il colpo alla
// banca). Ognuna riparte da capo, con le precedenti segnate come fatte.
const OllamaGUI: React.FC = () => {
  useEffect(() => {
    acquireDebugGui();
    const folder = debugSection('playground').addFolder('Missioni');
    const obj = {
      m1: () => missionBus.jump?.(MISSION_1),
      m2: () => missionBus.jump?.(MISSION_2),
      m3: () => missionBus.jump?.(MISSION_3),
    };
    const ctrls = [
      folder.add(obj, 'm1').name(`▶ 1. ${MISSION_TITLES[MISSION_1]}`),
      folder.add(obj, 'm2').name(`▶ 2. ${MISSION_TITLES[MISSION_2]}`),
      folder.add(obj, 'm3').name(`▶ 3. ${MISSION_3_TITLE}`),
    ];
    return () => {
      ctrls.forEach((c) => c.destroy());
      folder.destroy();
      releaseDebugGui();
    };
  }, []);

  return null;
};

export default OllamaGUI;
