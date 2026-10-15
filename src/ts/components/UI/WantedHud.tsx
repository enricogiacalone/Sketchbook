import React, { useEffect, useState } from 'react';
import { useStore } from '../../store';

// Le stelle del ricercato (alla GTA): fisse mentre la polizia ti vede,
// lampeggianti mentre ti cerca.

const STAR = 'M12 2l2.9 6.6 7.1.6-5.4 4.7 1.7 7-6.3-3.8-6.3 3.8 1.7-7L2 9.2l7.1-.6z';

const WantedHud: React.FC = () => {
  const level = useStore((s) => s.wantedLevel);
  const searching = useStore((s) => s.wantedSearching);
  const [on, setOn] = useState(true);

  useEffect(() => {
    if (!searching) {
      setOn(true);
      return;
    }
    const t = setInterval(() => setOn((v) => !v), 380);
    return () => clearInterval(t);
  }, [searching]);

  if (level <= 0) return null;
  return (
    <div
      style={{
        position: 'absolute',
        top: 24,
        right: 24,
        display: 'flex',
        gap: 4,
        pointerEvents: 'none',
        filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.8))',
      }}
    >
      {[1, 2, 3, 4, 5].map((i) => {
        const lit = i <= level;
        const color = lit ? (searching ? (on ? '#ffffff' : '#5a5a5a') : '#ffffff') : '#3a3a3a';
        return (
          <svg key={i} width={30} height={30} viewBox="0 0 24 24" style={{ opacity: lit ? 1 : 0.55 }}>
            <path d={STAR} fill={color} stroke="#000" strokeWidth={1} strokeLinejoin="round" />
          </svg>
        );
      })}
    </div>
  );
};

export default WantedHud;
