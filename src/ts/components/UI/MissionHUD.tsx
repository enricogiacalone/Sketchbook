import React from 'react';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { MISSIONS } from '../../missions/missionDefinitions';

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

  return (
    <div style={{ position: 'absolute', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 100, textAlign: 'center', pointerEvents: 'none' }}>
      {status === 'allComplete' && (
        <div style={panelStyle('#ffd54a')}>
          <div style={titleStyle}>🏁 Tutte le missioni completate!</div>
        </div>
      )}

      {status === 'success' && (
        <div style={panelStyle('#00ff66')}>
          <div style={titleStyle}>MISSIONE COMPLETATA</div>
        </div>
      )}

      {status === 'failed' && (
        <div style={panelStyle('#ff3333')}>
          <div style={titleStyle}>MISSIONE FALLITA</div>
          <div style={briefingStyle}>Torna al segnale blu o seleziona un'altra missione dal pannello Debug.</div>
        </div>
      )}

      {status === 'active' && (
        <div style={panelStyle('#ffd54a')}>
          <div style={titleStyle}>{title}</div>
          <div style={briefingStyle}>{briefing}</div>
          <div style={timerStyle}>⏱ {Math.max(0, Math.ceil(timeRemaining))}s</div>
        </div>
      )}

      {status === 'inactive' && stage < MISSIONS.length && (
        <div style={panelStyle('#39c5ff')}>
          <div style={titleStyle}>{title || `Missione ${stage + 1}`}</div>
          <div style={briefingStyle}>Vai al segnale blu sulla mappa o seleziona la missione dal pannello Debug.</div>
        </div>
      )}
    </div>
  );
};

const panelStyle = (accent: string): React.CSSProperties => ({
  fontFamily: 'monospace',
  fontWeight: 'bold',
  textShadow: '2px 2px 0px #000',
  color: accent,
  textAlign: 'center',
  maxWidth: 360,
  margin: '0 auto',
});

const titleStyle: React.CSSProperties = { fontSize: 18, letterSpacing: 1 };
const briefingStyle: React.CSSProperties = { fontSize: 13, fontWeight: 'normal', marginTop: 4, color: '#fff' };
const timerStyle: React.CSSProperties = { fontSize: 15, marginTop: 4 };

export default MissionHUD;
