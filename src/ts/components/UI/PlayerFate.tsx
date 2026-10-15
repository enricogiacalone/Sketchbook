import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import { clearWanted, wanted } from '../../lib/wanted';
import { playerControl } from '../../lib/playerControl';
import { talkState } from '../../lib/dialogue';

// "Wasted" e "Busted" alla GTA.
// - Wasted: la vita arriva a zero; schermo in grigio con la scritta, a terra
//   per qualche secondo (PlayerCombatSoldier: si rialza dopo 5 s), poi nero e
//   ci si ritrova all'ospedale piu' vicino, con una spesa e senza stelle.
// - Busted: a 1-2 stelle, se un agente ti raggiunge e ti tiene (wanted.arrestT)
//   a piedi: si resta fermi, scritta, nero, e ci si ritrova alla stazione di
//   polizia piu' vicina, con una multa e senza stelle.

const HOSPITALS: Array<[number, number]> = [
  [-120, -60],
  [120, 60],
  [0, -120],
];
const STATIONS: Array<[number, number]> = [
  [60, 120],
  [-120, 60],
  [120, -120],
];
const ARREST_AT = 1.6;

type Kind = 'wasted' | 'busted';
const nearest = (list: Array<[number, number]>, x: number, z: number) =>
  list.reduce((b, p) => (Math.hypot(p[0] - x, p[1] - z) < Math.hypot(b[0] - x, b[1] - z) ? p : b), list[0]);

const PlayerFate: React.FC = () => {
  const [view, setView] = useState<{ kind: Kind; text: number; black: number; note: string } | null>(null);
  const fate = useRef<{ kind: Kind; t0: number; moved: boolean; note: string } | null>(null);

  useEffect(() => {
    const tick = () => {
      const st = useStore.getState();
      const now = performance.now() / 1000;
      let f = fate.current;
      if (!f) {
        if (st.isPaused || st.testScene !== 'none') return;
        if (st.health <= 0) f = fate.current = { kind: 'wasted', t0: now, moved: false, note: '' };
        else if (wanted.arrestT >= ARREST_AT && st.currentControllable === 'player') {
          f = fate.current = { kind: 'busted', t0: now, moved: false, note: '' };
          // niente piu' sparatorie: la polizia ti ha preso
          clearWanted();
          talkState.open = true; // fermo: niente input mentre ti ammanettano
        } else return;
      }
      const t = now - f.t0;
      const [fadeAt, moveAt, endAt] = f.kind === 'wasted' ? [4.0, 5.3, 7.2] : [2.6, 3.6, 5.6];
      if (!f.moved && t >= moveAt) {
        f.moved = true;
        const pp = st.playerPos;
        const [x, z] = nearest(f.kind === 'wasted' ? HOSPITALS : STATIONS, pp[0], pp[2]);
        // sulla strada, di fronte all'edificio piu' vicino non serve: e' un incrocio
        playerControl.teleport?.(x, z, 0);
        const fee = f.kind === 'wasted' ? Math.min(st.cash, Math.round(st.cash * 0.1 + 50)) : Math.min(st.cash, Math.round(st.cash * 0.05 + 25));
        st.addCash(-fee);
        f.note =
          f.kind === 'wasted' ? `Dimesso dall'ospedale. Spese mediche: $${fee}` : `Rilasciato dalla stazione di polizia. Cauzione: $${fee}`;
        clearWanted();
        talkState.open = false;
      }
      const textOpacity = Math.min(1, t / 0.6) * (t > fadeAt ? Math.max(0, 1 - (t - fadeAt) / 0.8) : 1);
      let black = 0;
      if (t >= fadeAt && t < moveAt + 0.5) black = Math.min(1, (t - fadeAt) / 0.8);
      else if (t >= moveAt + 0.5) black = Math.max(0, 1 - (t - moveAt - 0.5) / 1.1);
      setView({ kind: f.kind, text: textOpacity, black, note: f.moved && t > moveAt + 0.6 ? f.note : '' });
      if (t >= endAt) {
        fate.current = null;
        talkState.open = false;
        setView(null);
      }
    };
    const id = window.setInterval(tick, 50);
    return () => {
      window.clearInterval(id);
      talkState.open = false;
    };
  }, []);

  if (!view) return null;
  const wasted = view.kind === 'wasted';
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 60 }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: Math.min(1, view.text * 1.2),
          backdropFilter: wasted ? 'grayscale(1) contrast(1.15) brightness(0.8)' : 'saturate(0.5) brightness(0.85)',
          background: wasted ? 'rgba(20,0,0,0.25)' : 'rgba(10,20,60,0.3)',
        }}
      />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: view.text }}>
        <div
          style={{
            fontFamily: 'Impact, "Arial Black", sans-serif',
            fontSize: 'min(14vw, 150px)',
            letterSpacing: '0.08em',
            color: wasted ? '#c62828' : '#4a8cff',
            textShadow: '0 4px 24px rgba(0,0,0,0.8)',
            transform: `scale(${1 + (1 - view.text) * 0.15})`,
          }}
        >
          {wasted ? 'WASTED' : 'BUSTED'}
        </div>
      </div>
      <div style={{ position: 'absolute', inset: 0, background: '#000', opacity: view.black }} />
      {view.note && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: '18%',
            textAlign: 'center',
            color: '#fff',
            fontFamily: 'Arial, sans-serif',
            fontSize: 20,
            textShadow: '0 2px 6px #000',
          }}
        >
          {view.note}
        </div>
      )}
    </div>
  );
};

export default PlayerFate;
