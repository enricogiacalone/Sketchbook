import React from 'react';
import { Html } from '@react-three/drei';

interface SpeechBubbleProps {
  message: string;
  position?: [number, number, number];
}

const SpeechBubble: React.FC<SpeechBubbleProps> = ({ message, position = [0, 2, 0] }) => {
  if (!message) return null;

  return (
    <group position={position}>
      <Html center distanceFactor={10}>
        <div style={{
          background: 'white',
          color: 'black',
          padding: '8px 12px',
          borderRadius: '12px',
          border: '2px solid #555',
          fontFamily: 'Arial, sans-serif',
          fontSize: '14px',
          fontWeight: 'bold',
          whiteSpace: 'nowrap',
          boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
          position: 'relative',
        }}>
          {message}
          {/* Tail */}
          <div style={{
            position: 'absolute',
            bottom: '-10px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '0',
            height: '0',
            borderLeft: '10px solid transparent',
            borderRight: '10px solid transparent',
            borderTop: '10px solid white',
          }} />
        </div>
      </Html>
    </group>
  );
};

export default SpeechBubble;
