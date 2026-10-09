import { useEffect } from 'react';
import { useStore } from '../store';
import { saveGame } from '../lib/saveGame';

// Salvataggio automatico (lib/saveGame.ts): ogni AUTOSAVE_S in gioco, subito
// quando cambiano soldi o missioni completate, e quando si chiude o si
// nasconde la pagina.
const AUTOSAVE_S = 10;

const SaveGameManager: React.FC = () => {
  useEffect(() => {
    const id = window.setInterval(() => {
      const st = useStore.getState();
      if (st.gameJoined && !st.isPaused) saveGame();
    }, AUTOSAVE_S * 1000);
    const unsub = useStore.subscribe((st, prev) => {
      if (st.gameJoined && (st.cash !== prev.cash || st.completedMissions !== prev.completedMissions)) saveGame();
    });
    const onHide = () => {
      if (document.visibilityState === 'hidden') saveGame({ beacon: true });
    };
    const onPageHide = () => saveGame({ beacon: true });
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.clearInterval(id);
      unsub();
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);
  return null;
};

export default SaveGameManager;
