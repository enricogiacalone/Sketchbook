import { useEffect } from 'react';
import { useStore } from '../../store';
import { acquireDebugGui, debugSection, releaseDebugGui } from '../../lib/debugGui';
import { MISSIONS } from '../../missions/missionDefinitions';

const OllamaGUI: React.FC = () => {
  useEffect(() => {
    acquireDebugGui();
    const folder = debugSection('playground').addFolder('Missioni Ollama (IA)');
    const st = () => useStore.getState();

    const obj = {
      selectMission0: () => {
        st().setMissionStage(0);
        st().setMissionStatus('inactive');
        if (MISSIONS[0]) st().setMissionInfo(MISSIONS[0].title, MISSIONS[0].briefing);
      },
      selectMission1: () => {
        st().setMissionStage(1);
        st().setMissionStatus('inactive');
        if (MISSIONS[1]) st().setMissionInfo(MISSIONS[1].title, MISSIONS[1].briefing);
      },
      selectMission2: () => {
        st().setMissionStage(2);
        st().setMissionStatus('inactive');
        if (MISSIONS[2]) st().setMissionInfo(MISSIONS[2].title, MISSIONS[2].briefing);
      },
    };

    const ctrls = [
      folder.add(obj, 'selectMission0').name(MISSIONS[0] ? `▶ ${MISSIONS[0].title}` : '▶ Missione 1'),
      folder.add(obj, 'selectMission1').name(MISSIONS[1] ? `▶ ${MISSIONS[1].title}` : '▶ Missione 2'),
      folder.add(obj, 'selectMission2').name(MISSIONS[2] ? `▶ ${MISSIONS[2].title}` : '▶ Missione 3'),
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
