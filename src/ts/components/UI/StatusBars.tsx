import React from 'react';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';

const StatusBars: React.FC = () => {
  const { health, armor } = useStore(useShallow((state) => ({ health: state.health, armor: state.armor })));

  return (
    <div style={{ 
      position: 'absolute', 
      top: 20, 
      right: 20, 
      pointerEvents: 'none',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      fontFamily: 'monospace',
      fontWeight: 'bold',
      textShadow: '2px 2px 0px #000'
    }}>
      <div style={{ marginBottom: 5 }}>
        <div style={{ width: 150, height: 10, background: 'rgba(0,0,0,0.5)', border: '1px solid #fff' }}>
          <div style={{ width: `${health}%`, height: '100%', background: '#ff1111' }} />
        </div>
        <div style={{ color: '#ff1111', fontSize: 16, textAlign: 'right' }}>$1,337,420</div>
      </div>
      
      <div>
        <div style={{ width: 150, height: 10, background: 'rgba(0,0,0,0.5)', border: '1px solid #fff' }}>
          <div style={{ width: `${armor}%`, height: '100%', background: '#11ff11' }} />
        </div>
      </div>
    </div>
  );
};

export default StatusBars;
