import React from 'react';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';

// "aggiungi oggetti da collezionare per tutta la citta" -- small HUD
// counter, same visual language as StatusBars.tsx (monospace, bold,
// black text-shadow, pointer-events none so it never blocks clicks).
const CollectiblesCounter: React.FC = () => {
  const { found, total } = useStore(
    useShallow((state) => ({ found: state.collectiblesFound, total: state.collectiblesTotal }))
  );

  if (total <= 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        pointerEvents: 'none',
        fontFamily: 'monospace',
        fontWeight: 'bold',
        fontSize: 20,
        color: '#ffd54a',
        textShadow: '2px 2px 0px #000',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <span>💎</span>
      <span>{found} / {total}</span>
    </div>
  );
};

export default CollectiblesCounter;
