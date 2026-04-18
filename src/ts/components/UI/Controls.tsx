import React from 'react';
import { useStore } from '../../store';

interface ControlRow {
  keys: string[];
  desc: string;
}

const Controls: React.FC = () => {
  const { currentControllable } = useStore();

  const getControls = (): ControlRow[] => {
    switch (currentControllable) {
      case 'car':
        return [
          { keys: ['W', 'S'], desc: 'Throttle / Brake' },
          { keys: ['A', 'D'], desc: 'Steering' },
          { keys: ['Space'], desc: 'Handbrake' },
          { keys: ['Enter'], desc: 'Exit Vehicle' },
        ];
      case 'airplane':
        return [
          { keys: ['Shift'], desc: 'Accelerate' },
          { keys: ['Space'], desc: 'Decelerate' },
          { keys: ['W', 'S'], desc: 'Pitch' },
          { keys: ['A', 'D'], desc: 'Roll' },
          { keys: ['Enter'], desc: 'Exit Vehicle' },
        ];
      case 'helicopter':
        return [
          { keys: ['Shift'], desc: 'Ascend' },
          { keys: ['Space'], desc: 'Descend' },
          { keys: ['W', 'S'], desc: 'Pitch' },
          { keys: ['A', 'D'], desc: 'Roll' },
          { keys: ['Enter'], desc: 'Exit Vehicle' },
        ];
      default:
        return [
          { keys: ['W', 'A', 'S', 'D'], desc: 'Movement' },
          { keys: ['Shift'], desc: 'Sprint' },
          { keys: ['Space'], desc: 'Jump' },
          { keys: ['Enter'], desc: 'Enter Vehicle' },
        ];
    }
  };

  const controls = getControls();

  return (
    <div style={{ 
        position: 'absolute', 
        left: 20, 
        top: '50%', 
        transform: 'translateY(-50%)', 
        color: 'white',
        fontFamily: 'Solway, serif',
        pointerEvents: 'none',
        textShadow: '2px 2px 4px rgba(0,0,0,0.5)'
    }}>
      <h2 style={{ fontSize: 18, marginBottom: 10 }}>Controls:</h2>
      {controls.map((row, i) => (
        <div key={i} style={{ marginBottom: 5, display: 'flex', alignItems: 'center' }}>
          {row.keys.map((key, j) => (
            <React.Fragment key={j}>
                <span style={{ 
                    background: 'rgba(255,255,255,0.2)', 
                    padding: '2px 6px', 
                    borderRadius: 4, 
                    marginRight: 5,
                    fontSize: 12,
                    border: '1px solid rgba(255,255,255,0.4)'
                }}>
                    {key}
                </span>
                {j < row.keys.length - 1 && <span style={{ marginRight: 5 }}>/</span>}
            </React.Fragment>
          ))}
          <span style={{ fontSize: 14, marginLeft: 5 }}>{row.desc}</span>
        </div>
      ))}
    </div>
  );
};

export default Controls;
