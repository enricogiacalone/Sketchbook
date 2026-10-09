import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import { dialogueInput } from '../../lib/dialogue';

// Il dialogo aperto (Missions/StoryMission.tsx): chi parla, la battuta che
// si scrive da sola e le risposte. Tastiera: 1-4 sceglie, Invio / Spazio / T
// va avanti, frecce su/giu' spostano la scelta, Backspace chiude. Pad: croce
// su/giu' sceglie, X conferma, Cerchio chiude. Col mouse si clicca.
const CHARS_PER_S = 70;

const DialogueBox: React.FC = () => {
  const view = useStore((s) => s.dialogueView);
  const [shown, setShown] = useState(0);
  const [sel, setSel] = useState(0);
  const typing = !!view && shown < view.text.length;
  const ref = useRef({ view, shown, sel, typing });
  ref.current = { view, shown, sel, typing };

  // battuta nuova: si riscrive da capo, scelta sulla prima disponibile
  useEffect(() => {
    setShown(0);
    const first = view?.options.findIndex((o) => !o.disabled) ?? 0;
    setSel(Math.max(0, first));
  }, [view]);
  useEffect(() => {
    if (!view || shown >= view.text.length) return;
    const id = window.setTimeout(() => setShown((n) => Math.min(view.text.length, n + 2)), 2000 / CHARS_PER_S);
    return () => window.clearTimeout(id);
  }, [view, shown]);

  // conferma: prima finisce di scrivere, poi avanza o sceglie
  const confirm = () => {
    const r = ref.current;
    if (!r.view) return;
    if (r.typing) {
      setShown(r.view.text.length);
      return;
    }
    if (r.view.options.length) dialogueInput.choose(r.sel);
    else dialogueInput.advance();
  };
  const move = (dir: number) => {
    const opts = ref.current.view?.options ?? [];
    if (!opts.length) return;
    let i = ref.current.sel;
    for (let k = 0; k < opts.length; k++) {
      i = (i + dir + opts.length) % opts.length;
      if (!opts[i].disabled) break;
    }
    setSel(i);
  };

  // tastiera (prima del gioco: i tasti non arrivano a useInput)
  useEffect(() => {
    if (!view) return;
    const onKey = (e: KeyboardEvent) => {
      const m = /^Digit([1-4])$/.exec(e.code);
      let used = true;
      if (m) {
        const i = Number(m[1]) - 1;
        const r = ref.current;
        if (r.typing) setShown(r.view!.text.length);
        else if (r.view!.options[i] && !r.view!.options[i].disabled) dialogueInput.choose(i);
      } else if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyT') confirm();
      else if (e.code === 'ArrowUp') move(-1);
      else if (e.code === 'ArrowDown') move(1);
      else if (e.code === 'Backspace') dialogueInput.close();
      else used = false;
      if (used) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!view]);

  // pad: croce, X, Cerchio (fronti di salita)
  useEffect(() => {
    if (!view) return;
    let raf = 0;
    let prev: boolean[] = [];
    let first = true;
    const poll = () => {
      const pad = [...(navigator.getGamepads?.() ?? [])].find(Boolean);
      if (pad) {
        const now = pad.buttons.map((b) => b.pressed);
        // al primo giro solo lo stato (il tasto che ha aperto il dialogo non conta)
        if (!first) {
          const hit = (i: number) => now[i] && !prev[i];
          if (hit(0)) confirm();
          if (hit(1)) dialogueInput.close();
          if (hit(12)) move(-1);
          if (hit(13)) move(1);
        }
        prev = now;
        first = false;
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!view]);

  if (!view) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 36,
        transform: 'translateX(-50%)',
        width: 'min(680px, calc(100vw - 32px))',
        background: 'rgba(10,10,12,0.86)',
        border: `2px solid ${view.color}`,
        borderRadius: 10,
        padding: '14px 18px 12px',
        color: '#fff',
        fontFamily: 'Arial, sans-serif',
        boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
        zIndex: 20,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) confirm();
      }}
    >
      {view.speaker && (
        <div style={{ color: view.color, fontWeight: 800, fontSize: 15, marginBottom: 6, letterSpacing: 0.5 }}>{view.speaker}</div>
      )}
      <div style={{ fontSize: 17, lineHeight: 1.4, minHeight: 48, fontStyle: view.speaker ? 'normal' : 'italic' }}>
        {view.text.slice(0, shown)}
      </div>
      {!typing && view.options.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {view.options.map((o, i) => (
            <button
              key={i}
              type="button"
              disabled={o.disabled}
              onMouseEnter={() => !o.disabled && setSel(i)}
              onClick={() => !o.disabled && dialogueInput.choose(i)}
              style={{
                textAlign: 'left',
                background: i === sel && !o.disabled ? 'rgba(255,213,74,0.18)' : 'transparent',
                border: 'none',
                borderLeft: `3px solid ${i === sel && !o.disabled ? '#ffd54a' : 'transparent'}`,
                color: o.disabled ? '#777' : '#fff',
                fontSize: 16,
                padding: '5px 10px',
                cursor: o.disabled ? 'default' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <span style={{ color: '#ffd54a', fontWeight: 700, marginRight: 8 }}>{i + 1}</span>
              {o.label}
            </button>
          ))}
        </div>
      )}
      <div style={{ marginTop: 8, fontSize: 11, opacity: 0.55, textAlign: 'right' }}>
        {typing ? 'Invio / X: salta' : view.options.length ? '1-4 o croce + X: scegli · Backspace / O: chiudi' : 'Invio / X: continua'}
      </div>
    </div>
  );
};

export default DialogueBox;
