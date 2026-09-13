import React from 'react';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { MISSIONS } from '../../missions/missionDefinitions';

// "crea una missione come in gta" -- small always-there panel, same visual
// language as StatusBars.tsx/CollectiblesCounter.tsx (monospace, bold,
// black text-shadow, pointer-events none), reporting whatever
// MissionManager.tsx (the actual state machine, mounted inside the
// Canvas/Physics tree so it can spawn Enemy.tsx instances) last wrote to
// the store.
const MissionHUD: React.FC = () => {
  const { stage, status, title, briefing, timeRemaining } = useStore(
    useShallow((state) => ({
      stage: state.missionStage,
      status: state.missionStatus,
      title: state.missionTitle,
      briefing: state.missionBriefing,
      timeRemaining: state.missionTimeRemaining,
    }))
  );

  if (status === 'allComplete') {
    return (
      <div style={panelStyle('#ffd54a')}>
        <div style={titleStyle}>🏁 Tutte le missioni completate!</div>
      </div>
    );
  }

  if (stage >= MISSIONS.length) return null;

  if (status === 'success') {
    return (
      <div style={panelStyle('#00ff66')}>
        <div style={titleStyle}>MISSIONE COMPLETATA</div>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div style={panelStyle('#ff3333')}>
        <div style={titleStyle}>MISSIONE FALLITA</div>
        <div style={briefingStyle}>Torna al segnale blu per riprovare.</div>
      </div>
    );
  }

  if (status === 'active') {
    return (
      <div style={panelStyle('#ffd54a')}>
        <div style={titleStyle}>{title}</div>
        <div style={briefingStyle}>{briefing}</div>
        <div style={timerStyle}>⏱ {Math.max(0, Math.ceil(timeRemaining))}s</div>
      </div>
    );
  }

  // inactive, still within range of missions -- point the player at the
  // beacon (a real marker exists in-world at MISSION_BEACON_POS too, this
  // is just the text-form nudge).
  return (
    <div style={panelStyle('#39c5ff')}>
      <div style={titleStyle}>{title || `Missione ${stage + 1}`}</div>
      <div style={briefingStyle}>Vai al segnale blu sulla mappa per iniziare.</div>
    </div>
  );
};

const panelStyle = (accent: string): React.CSSProperties => ({
  position: 'absolute',
  top: 70,
  left: '50%',
  transform: 'translateX(-50%)',
  pointerEvents: 'none',
  fontFamily: 'monospace',
  fontWeight: 'bold',
  textShadow: '2px 2px 0px #000',
  color: accent,
  textAlign: 'center',
  maxWidth: 360,
});

const titleStyle: React.CSSProperties = { fontSize: 18, letterSpacing: 1 };
const briefingStyle: React.CSSProperties = { fontSize: 13, fontWeight: 'normal', marginTop: 4, color: '#fff' };
const timerStyle: React.CSSProperties = { fontSize: 15, marginTop: 4 };

export default MissionHUD;
