import React from 'react';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';

// "fai che... il combattimento sembri vero" -- the 1v1 duel's own HUD:
// two facing HP bars (yours on the left, the AI's on the right, same
// "who's winning at a glance" framing a real fighting game uses) plus a
// win/lose banner and a way back to the main city once the fight's over
// (or if you just want out). Only ever visible while testScene === 'duel'
// (see Scene.tsx/DuelArena.tsx) -- a plain early-return rather than the
// parent conditionally mounting this, so it can keep listening for
// duelResult flipping back to 'none' on the next duel without remounting.
//
// Reads duelPlayerHp/duelEnemyHp/duelResult from the store -- written
// every frame by DuelArena.tsx's own useFrame from the two FighterData
// objects PlayerCombatSoldier.tsx/CombatSoldier.tsx mutate in place; this
// component itself never touches those refs directly, it's plain DOM
// outside the R3F tree (same reasoning as StatusBars.tsx).
const DuelHUD: React.FC = () => {
  const { testScene, duelPlayerHp, duelEnemyHp, duelResult } = useStore(
    useShallow((state) => ({
      testScene: state.testScene,
      duelPlayerHp: state.duelPlayerHp,
      duelEnemyHp: state.duelEnemyHp,
      duelResult: state.duelResult,
    }))
  );

  if (testScene !== 'duel') return null;

  const exitDuel = () => {
    useStore.getState().setTestScene('none');
    useStore.getState().setCurrentControllable('player');
  };

  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 24,
          fontFamily: 'monospace',
          fontWeight: 'bold',
          textShadow: '2px 2px 0px #000',
          color: '#fff',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
          <div style={{ fontSize: 12, marginBottom: 2 }}>TU</div>
          <div style={{ width: 180, height: 14, background: 'rgba(0,0,0,0.5)', border: '1px solid #fff' }}>
            <div
              style={{
                width: `${Math.max(0, duelPlayerHp)}%`,
                height: '100%',
                background: '#22c55e',
                transition: 'width 0.15s ease-out',
              }}
            />
          </div>
        </div>
        <div style={{ fontSize: 20, alignSelf: 'center', opacity: 0.8 }}>VS</div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <div style={{ fontSize: 12, marginBottom: 2 }}>AVVERSARIO</div>
          <div style={{ width: 180, height: 14, background: 'rgba(0,0,0,0.5)', border: '1px solid #fff' }}>
            <div
              style={{
                width: `${Math.max(0, duelEnemyHp)}%`,
                height: '100%',
                background: '#ef4444',
                marginLeft: `${100 - Math.max(0, duelEnemyHp)}%`,
                transition: 'width 0.15s ease-out, margin-left 0.15s ease-out',
              }}
            />
          </div>
        </div>
      </div>

      <button
        onClick={exitDuel}
        style={{
          position: 'absolute',
          top: 20,
          right: 20,
          pointerEvents: 'auto',
          fontFamily: 'monospace',
          fontWeight: 'bold',
          fontSize: 12,
          color: '#fff',
          background: 'rgba(0,0,0,0.5)',
          border: '1px solid rgba(255,255,255,0.4)',
          borderRadius: 6,
          padding: '6px 10px',
          cursor: 'pointer',
        }}
      >
        ✕ Esci dal Duello
      </button>

      {duelResult !== 'none' && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 20,
            pointerEvents: 'none',
          }}
        >
          <h1
            className="sb-font"
            style={{
              fontSize: 56,
              margin: 0,
              color: duelResult === 'win' ? '#22c55e' : '#ef4444',
              textShadow: '3px 3px 0px #000',
            }}
          >
            {duelResult === 'win' ? 'HAI VINTO!' : 'SCONFITTA'}
          </h1>
          <div style={{ display: 'flex', gap: 14, pointerEvents: 'auto' }}>
            {/* "aggiungi il tasto retry" -- bumps store.ts's duelRound,
                which Scene.tsx uses as DuelArena's own React key, so this
                remounts a brand new fight (fresh hp/position/ragdoll
                state) without leaving the arena or touching the menu. */}
            <button
              onClick={() => useStore.getState().retryDuel()}
              style={{
                pointerEvents: 'auto',
                fontFamily: 'monospace',
                fontWeight: 'bold',
                fontSize: 16,
                color: '#fff',
                background: 'linear-gradient(135deg, #22c55e 0%, #15803d 100%)',
                border: '1px solid rgba(255,255,255,0.5)',
                borderRadius: 10,
                padding: '10px 20px',
                cursor: 'pointer',
              }}
            >
              🔄 Riprova
            </button>
            <button
              onClick={exitDuel}
              style={{
                pointerEvents: 'auto',
                fontFamily: 'monospace',
                fontWeight: 'bold',
                fontSize: 16,
                color: '#fff',
                background: 'rgba(0,0,0,0.7)',
                border: '1px solid rgba(255,255,255,0.5)',
                borderRadius: 10,
                padding: '10px 20px',
                cursor: 'pointer',
              }}
            >
              Torna in città
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default DuelHUD;
