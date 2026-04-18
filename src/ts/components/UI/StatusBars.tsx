import React from 'react';
import { useStore } from '../../store';

const StatusBars: React.FC = () => {
  const { health, armor } = useStore();

  return (
    <div style={{ position: 'absolute', bottom: 20, left: 20, pointerEvents: 'none' }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ width: 200, height: 20, background: '#333', border: '2px solid white' }}>
          <div style={{ width: `${health}%`, height: '100%', background: '#ff4444', transition: 'width 0.3s' }} />
        </div>
        <div style={{ color: 'white', fontSize: 12, marginTop: 4 }}>HEALTH: {health}</div>
      </div>
      
      <div>
        <div style={{ width: 200, height: 20, background: '#333', border: '2px solid white' }}>
          <div style={{ width: `${armor}%`, height: '100%', background: '#4444ff', transition: 'width 0.3s' }} />
        </div>
        <div style={{ color: 'white', fontSize: 12, marginTop: 4 }}>ARMOR: {armor}</div>
      </div>
    </div>
  );
};

export default StatusBars;
