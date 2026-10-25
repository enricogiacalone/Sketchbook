import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store';
import { fragmentPlanets } from '../../story/mainStory';

// Pannello della storia principale "Il Seme" (story/mainStory.ts): sotto i soldi, in alto a sinistra. Titolo, frammenti n/N,
// obiettivo, e (se c'e' un bersaglio nel pianeta) distanza e freccia verso di lui (la bussola, calcolata in Missions/MainStory.tsx).
const fmt = (d: number) => (d >= 1000 ? `${(d / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(d)} m`);

const MainStoryHUD: React.FC = () => {
  const { joined, scene, story, hint, dialogue } = useStore(
    useShallow((s) => ({ joined: s.gameJoined, scene: s.testScene, story: s.mainStory, hint: s.storyHint, dialogue: !!s.dialogueView }))
  );
  if (!joined || scene !== 'none' || !story.started || dialogue) return null;
  const total = fragmentPlanets(story).length;
  const shadow = '0 0 3px #000, 0 1px 4px #000';
  return (
    <div
      style={{
        position: 'absolute',
        top: 58,
        left: 20,
        maxWidth: 'min(340px, calc(100vw - 40px))',
        color: '#fff',
        fontFamily: 'Arial, sans-serif',
        textShadow: shadow,
        pointerEvents: 'none',
      }}
    >
      <div style={{ color: '#7cf0ff', fontWeight: 800, fontSize: 13, letterSpacing: 2 }}>
        IL SEME · {story.fragments.length}/{total} frammenti
      </div>
      {hint && <div style={{ fontSize: 15, lineHeight: 1.25, marginTop: 3 }}>{hint.text}</div>}
      {hint && hint.dist !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
          <svg width="26" height="26" viewBox="-13 -13 26 26" style={{ transform: `rotate(${((-(hint.arrow ?? 0) * 180) / Math.PI).toFixed(1)}deg)`, filter: 'drop-shadow(0 0 2px #000)' }}>
            <path d="M0 -11 L8 8 L0 4 L-8 8 Z" fill="#7cf0ff" stroke="#003" strokeWidth="1" />
          </svg>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{fmt(hint.dist)}</span>
        </div>
      )}
    </div>
  );
};

export default MainStoryHUD;
