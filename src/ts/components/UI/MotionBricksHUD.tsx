import React, { useEffect, useState } from 'react';
import { motionBricksManager } from '../../lib/motionBricksRuntime';

export const MotionBricksHUD: React.FC = () => {
  const [activeStyle, setActiveStyle] = useState('victory');
  const [frameCount, setFrameCount] = useState(0);
  const [rootPos, setRootPos] = useState<[number, number, number]>([0, 0, 0]);

  useEffect(() => {
    const interval = setInterval(() => {
      const frame = motionBricksManager.planMotion({
        style: activeStyle,
        movementDirection: [0, 0, 1],
        facingDirection: [0, 0, 1],
        targetSpeed: 1.0,
      });
      if (frame) {
        setFrameCount((c) => c + 1);
        setRootPos(frame.rootPosition);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [activeStyle]);

  return (
    <div
      style={{
        position: 'absolute',
        top: 20,
        right: 20,
        background: 'rgba(0, 0, 0, 0.75)',
        color: '#0ff',
        padding: '12px 18px',
        borderRadius: '8px',
        fontFamily: 'monospace',
        fontSize: '13px',
        zIndex: 1000,
        border: '1px solid #0ff3',
        boxShadow: '0 0 15px rgba(0,255,255,0.2)',
        pointerEvents: 'none',
      }}
    >
      <div style={{ fontWeight: 'bold', marginBottom: '6px', color: '#fff', borderBottom: '1px solid #0ff3', paddingBottom: '4px' }}>
        🚀 MotionBricks Neural Engine
      </div>
      <div>Status: <span style={{ color: '#0f0' }}>● Active (34 Joints)</span></div>
      <div>Style: <span style={{ color: '#ff0' }}>{activeStyle}</span></div>
      <div>Frames Planned: {frameCount}</div>
      <div>Root Pos: [{rootPos.map((n) => n.toFixed(2)).join(', ')}]</div>
    </div>
  );
};

export default MotionBricksHUD;
