import React, { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store';

// Interfaccia della missione (Missions/StoryMission.tsx), alla GTA: soldi in
// alto a sinistra, obiettivo in basso al centro, tempo in alto al centro,
// tasto per parlare / prendere, banner di missione compiuta o fallita.
const StoryHUD: React.FC = () => {
  const { joined, scene, cash, objective, time, prompt, banner, dialogue, controllable } = useStore(
    useShallow((s) => ({
      joined: s.gameJoined,
      scene: s.testScene,
      cash: s.cash,
      objective: s.missionBriefing,
      time: s.missionTimeRemaining,
      prompt: s.talkPrompt,
      banner: s.storyBanner,
      dialogue: !!s.dialogueView,
      controllable: s.currentControllable,
    }))
  );
  // il banner sparisce da solo
  const [, tick] = useState(0);
  useEffect(() => {
    if (!banner) return;
    const left = banner.until - performance.now();
    if (left <= 0) return;
    const id = window.setTimeout(() => tick((n) => n + 1), left + 20);
    return () => window.clearTimeout(id);
  }, [banner]);
  if (!joined || scene !== 'none') return null;
  const bannerOn = banner && banner.until > performance.now();
  const shadow = '0 0 3px #000, 0 2px 4px #000';
  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 20,
          color: '#7cfc7c',
          fontFamily: 'Georgia, serif',
          fontWeight: 800,
          fontSize: 28,
          textShadow: shadow,
          pointerEvents: 'none',
        }}
      >
        ${cash}
      </div>
      {time > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            color: time < 30 ? '#ff5252' : '#fff',
            fontFamily: 'monospace',
            fontWeight: 800,
            fontSize: 26,
            textShadow: shadow,
            pointerEvents: 'none',
          }}
        >
          {Math.floor(Math.ceil(time) / 60)}:{String(Math.ceil(time) % 60).padStart(2, '0')}
        </div>
      )}
      {objective && !dialogue && !bannerOn && (
        <div
          style={{
            position: 'absolute',
            bottom: 70,
            left: '50%',
            transform: 'translateX(-50%)',
            maxWidth: 'min(640px, calc(100vw - 32px))',
            textAlign: 'center',
            color: '#fff',
            fontFamily: 'Arial, sans-serif',
            fontSize: 17,
            fontWeight: 600,
            textShadow: shadow,
            pointerEvents: 'none',
          }}
        >
          {objective}
        </div>
      )}
      {prompt && !dialogue && controllable === 'player' && (
        <div
          style={{
            position: 'absolute',
            top: '58%',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.65)',
            color: '#fff',
            borderRadius: 6,
            padding: '6px 12px',
            fontFamily: 'Arial, sans-serif',
            fontSize: 15,
            pointerEvents: 'none',
          }}
        >
          <b style={{ color: '#ffd54a' }}>T</b> / <b style={{ color: '#ffd54a' }}>△</b> {prompt}
        </div>
      )}
      {bannerOn && banner && (
        <div
          style={{
            position: 'absolute',
            top: '30%',
            left: '50%',
            transform: 'translateX(-50%)',
            textAlign: 'center',
            pointerEvents: 'none',
            textShadow: shadow,
          }}
        >
          <div style={{ color: banner.color, fontFamily: 'Georgia, serif', fontWeight: 900, fontSize: 48, letterSpacing: 2 }}>
            {banner.title}
          </div>
          <div style={{ color: '#fff', fontFamily: 'Arial, sans-serif', fontSize: 18, marginTop: 6 }}>{banner.subtitle}</div>
        </div>
      )}
    </>
  );
};

export default StoryHUD;
