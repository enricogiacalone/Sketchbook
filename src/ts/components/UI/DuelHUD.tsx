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
// Reads duelPlayerHp/duelEnemyHp/duelResult/duelInRange from the store --
// written every frame by DuelArena.tsx's own useFrame from the two
// FighterData objects PlayerCombatSoldier.tsx/CombatSoldier.tsx mutate in
// place; this component itself never touches those refs directly, it's
// plain DOM outside the R3F tree (same reasoning as StatusBars.tsx).
const DuelHUD: React.FC = () => {
  const {
    testScene,
    duelPlayerHp,
    duelEnemyHp,
    duelResult,
    duelInRange,
    duelReticleX,
    duelReticleY,
    bagHitCount,
    bagLastHitRadialOffset,
    bagLastHitHeightOffset,
    bagLastHitHand,
    hideUiClean,
  } = useStore(
    useShallow((state) => ({
      testScene: state.testScene,
      hideUiClean: state.hideUiClean,
      duelPlayerHp: state.duelPlayerHp,
      duelEnemyHp: state.duelEnemyHp,
      duelResult: state.duelResult,
      duelInRange: state.duelInRange,
      duelReticleX: state.duelReticleX,
      duelReticleY: state.duelReticleY,
      bagHitCount: state.bagHitCount,
      bagLastHitRadialOffset: state.bagLastHitRadialOffset,
      bagLastHitHeightOffset: state.bagLastHitHeightOffset,
      bagLastHitHand: state.bagLastHitHand,
    }))
  );

  if (testScene !== 'duel') return null;

  const exitDuel = () => {
    useStore.getState().setTestScene('none');
    useStore.getState().setCurrentControllable('player');
  };

  return (
    <>
      {/* "il mirino deve essere come quelli che si usano per sparare..
          non si accavalla al personaggio" -- a real FPS-style reticle:
          four short separate ticks around an empty center, NOT a closed
          shape (the first version was a solid circle, which visually
          wrapped around/over the character standing right behind it at
          screen-center in third person -- a shooter crosshair never
          draws a continuous outline over the target for exactly that
          reason, it's always a few disconnected marks with a gap in the
          middle). Separate from the pre-existing global #crosshair
          (Crosshair.tsx, currently unused/dormant elsewhere) since this
          one needs its own per-mode color logic. Dim/neutral while out of
          ATTACK_RANGE (see DuelArena.tsx's useFrame), lights up in the
          same green as your own HP bar the instant a swing would actually
          land. Hidden once the fight ends (duelResult !== 'none'), same
          as the HP bars/exit button below would read as pointless
          clutter over the win/lose banner. */}
      {duelResult === 'none' &&
        (() => {
          const color = duelInRange ? '#22c55e' : 'rgba(255,255,255,0.7)';
          const glow = duelInRange ? '0 0 6px 1px rgba(34,197,94,0.8)' : 'none';
          const GAP = 7; // px from dead-center to the near edge of each tick
          const LEN = 6; // px, each tick's own length
          const THICK = 2; // px
          const tickBase: React.CSSProperties = {
            position: 'absolute',
            background: color,
            boxShadow: glow,
            transition: 'background 0.12s ease-out, box-shadow 0.12s ease-out',
          };
          return (
            <div
              style={{
                position: 'absolute',
                // "il mirino e' ai piedi del giocatore.. deve stare piu'
                // in alto" -- driven by DuelArena.tsx's own per-frame
                // camera projection now, instead of a hardcoded 50%/50%
                // (which always landed exactly on the player's ground-
                // level root, since that's what the third-person camera
                // itself looks at for on-foot controllers).
                top: `${duelReticleY}%`,
                left: `${duelReticleX}%`,
                width: 0,
                height: 0,
                pointerEvents: 'none',
              }}
            >
              {/* top */}
              <div style={{ ...tickBase, left: -THICK / 2, top: -GAP - LEN, width: THICK, height: LEN }} />
              {/* bottom */}
              <div style={{ ...tickBase, left: -THICK / 2, top: GAP, width: THICK, height: LEN }} />
              {/* left */}
              <div style={{ ...tickBase, top: -THICK / 2, left: -GAP - LEN, width: LEN, height: THICK }} />
              {/* right */}
              <div style={{ ...tickBase, top: -THICK / 2, left: GAP, width: LEN, height: THICK }} />
            </div>
          );
        })()}

      {/* "togli ... la vita ... per pulire la ui" -- store.ts's
          hideUiClean, flippato da CombatArenaGUI.tsx ("Pulisci UI"). Solo
          le barre HP qui sotto -- reticolo, pulsante "Esci dal Duello" e
          banner vittoria/sconfitta restano SEMPRE visibili, non erano
          nella richiesta. */}
      {!hideUiClean && (
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
      )}

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

      {/* "il comando per rendere passivo l'avversario deve stare dentro
          la sezione arena" -- this used to be its own floating button
          here (top:60/right:20), duplicating the exact same
          duelDummyMode toggle CombatArenaGUI.tsx's lil-gui panel now
          also exposes, inside its "Arena" folder -- removed in favor of
          that single control living in one place. */}

      {/* "mi serve per capire la precisione delle collisioni" -- live
          readout for PunchingBag.tsx's own hit counter/last-hit offsets
          (see store.ts's registerBagHit). Always visible while in the
          duel (not gated on duelResult -- same reasoning as the Manichino
          toggle above, you might keep testing the bag after the fight
          ends), bottom-left so it never competes with the HP bars/reticle
          up top. Offsets shown in cm (the store keeps meters) since a few
          centimeters is the actual precision resolution someone testing
          hurtbox accuracy cares about. */}
      <div
        style={{
          position: 'absolute',
          bottom: 20,
          left: 20,
          pointerEvents: 'none',
          fontFamily: 'monospace',
          fontSize: 12,
          color: '#fff',
          textShadow: '2px 2px 0px #000',
          background: 'rgba(0,0,0,0.5)',
          border: '1px solid rgba(255,221,85,0.5)',
          borderRadius: 6,
          padding: '8px 10px',
          minWidth: 190,
        }}
      >
        <div style={{ fontWeight: 'bold', marginBottom: 4, color: '#ffdd55' }}>🥊 Sacco: {bagHitCount} colpi</div>
        {bagLastHitRadialOffset !== null && bagLastHitHeightOffset !== null ? (
          <div style={{ opacity: 0.9 }}>
            ultimo: mano {bagLastHitHand === 'hand_l' ? 'sx' : 'dx'}, {Math.round(bagLastHitRadialOffset * 100)}cm dal centro
            ({bagLastHitHeightOffset >= 0 ? '+' : ''}
            {Math.round(bagLastHitHeightOffset * 100)}cm vert.)
          </div>
        ) : (
          <div style={{ opacity: 0.6 }}>colpisci il sacco per iniziare</div>
        )}
      </div>

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
