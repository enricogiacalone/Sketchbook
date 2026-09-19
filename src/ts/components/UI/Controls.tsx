import React, { useEffect, useState } from 'react';
import { useStore } from '../../store';

interface ControlRow {
  keys: string[];
  // Gamepad button(s) for this same action, PlayStation-style naming (the
  // user plays with a PS3/DualShock 3 pad). One row can have multiple
  // alternatives (e.g. "R1" OR "L2"), each rendered as its own pill.
  // Omitted where useInput.ts has no gamepad binding for that action yet
  // (e.g. helicopter yaw).
  pad?: string[];
  desc: string;
}

// Mirrors useInput.ts's gamepad section 1:1 (Standard Gamepad API button
// layout -- see the comment there re: DS3 pads often reporting
// mapping:"" instead of "standard", in which case these physical PS
// button names may not actually line up with what the browser reads).
const PAD_LEFT_STICK = ['Left Stick'];
const PAD_JUMP = ['✕ Cross']; // button 0
const PAD_SHIFT = ['R1', 'L2']; // buttons 5 or 6
const PAD_PRIMARY = ['R2']; // button 7
const PAD_SECONDARY = ['○ Circle']; // button 1
const PAD_ENTER = ['□ Square', '△ Triangle']; // buttons 2 or 3
// Square and Triangle individually -- combatSoldier's Jab/Hook attacks
// (see useInput.ts's gamepad section, where they ALSO still drive
// PAD_ENTER's combined reading for vehicles; the two never overlap since
// only one controllable is ever active at once).
const PAD_TRIANGLE = ['△ Triangle']; // button 3
// "con l2 usa il braccio sinistro" -- Square and L2 both throw the same
// left-handed Jab (see useInput.ts's 'attackLeft' action).
const PAD_JAB = ['□ Square', 'L2']; // button 2, or button 6
// "guardare l'avversario se tengo premuto l1" -- held lock-on modifier
// (see useInput.ts's 'lockOn' action).
const PAD_LOCK_ON = ['L1']; // button 4

const Controls: React.FC = () => {
  const currentControllable = useStore((state) => state.currentControllable);

  // "se ho un gamepad fammi vedere i tasti corrispondenti" -- only show
  // gamepad button pills once a pad is actually detected, so keyboard-only
  // players don't see clutter they can't use. navigator.getGamepads() has
  // to be polled (connect/disconnect events alone can miss a pad that was
  // already on before the page loaded on some browsers), so this re-checks
  // on a light interval rather than depending solely on the events.
  const [pad, setPad] = useState<Gamepad | null>(null);

  useEffect(() => {
    const pollPad = () => {
      const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
      for (let i = 0; i < pads.length; i++) {
        if (pads[i]) {
          setPad(pads[i] as Gamepad);
          return;
        }
      }
      setPad(null);
    };
    pollPad();
    const interval = setInterval(pollPad, 500);
    window.addEventListener('gamepadconnected', pollPad);
    window.addEventListener('gamepaddisconnected', pollPad);
    return () => {
      clearInterval(interval);
      window.removeEventListener('gamepadconnected', pollPad);
      window.removeEventListener('gamepaddisconnected', pollPad);
    };
  }, []);

  const gamepadConnected = !!pad;
  const gamepadIsStandard = pad?.mapping === 'standard';

  const getControls = (): ControlRow[] => {
    switch (currentControllable) {
      case 'combatSoldier':
        return [
          { keys: ['W', 'A', 'S', 'D'], pad: PAD_LEFT_STICK, desc: 'Move' },
          { keys: ['Shift'], pad: PAD_SHIFT, desc: 'Sprint' },
          { keys: ['Left Click'], pad: PAD_PRIMARY, desc: 'Cross (R)' },
          { keys: ['Q'], pad: PAD_JAB, desc: 'Jab (L)' },
          { keys: ['E'], pad: PAD_TRIANGLE, desc: 'Hook' },
          { keys: ['Right Click', '(hold)'], pad: PAD_SECONDARY, desc: 'Block' },
          { keys: ['Space'], pad: PAD_JUMP, desc: 'Dodge' },
          { keys: ['Ctrl', '(hold)'], pad: PAD_LOCK_ON, desc: 'Lock-on Avversario' },
        ];
      case 'car':
        return [
          { keys: ['W', 'S'], pad: PAD_LEFT_STICK, desc: 'Throttle / Brake' },
          { keys: ['A', 'D'], pad: PAD_LEFT_STICK, desc: 'Steering' },
          { keys: ['Space'], pad: PAD_JUMP, desc: 'Handbrake' },
          { keys: ['F'], pad: PAD_ENTER, desc: 'Exit Vehicle' },
        ];
      case 'airplane':
        return [
          { keys: ['Shift'], pad: PAD_SHIFT, desc: 'Accelerate' },
          { keys: ['Space'], pad: PAD_JUMP, desc: 'Decelerate' },
          { keys: ['W', 'S'], pad: PAD_LEFT_STICK, desc: 'Pitch' },
          { keys: ['A', 'D'], pad: PAD_LEFT_STICK, desc: 'Roll' },
          { keys: ['F'], pad: PAD_ENTER, desc: 'Exit Vehicle' },
        ];
      case 'helicopter':
        return [
          { keys: ['Shift'], pad: PAD_SHIFT, desc: 'Ascend' },
          { keys: ['Space'], pad: PAD_JUMP, desc: 'Descend' },
          { keys: ['W', 'S'], pad: PAD_LEFT_STICK, desc: 'Pitch' },
          { keys: ['A', 'D'], pad: PAD_LEFT_STICK, desc: 'Roll' },
          // No gamepad binding exists for yaw yet (useInput.ts's gamepad
          // section never sets g.yawLeft/g.yawRight) -- left without a
          // `pad` entry rather than guessing at one.
          { keys: ['Q', 'E'], desc: 'Yaw (Turn)' },
          { keys: ['F'], pad: PAD_ENTER, desc: 'Exit Vehicle' },
        ];
      default:
        return [
          { keys: ['W', 'A', 'S', 'D'], pad: PAD_LEFT_STICK, desc: 'Movement' },
          { keys: ['Shift'], pad: PAD_SHIFT, desc: 'Sprint' },
          { keys: ['Space'], pad: PAD_JUMP, desc: 'Jump' },
          { keys: ['F'], pad: PAD_ENTER, desc: 'Enter Vehicle' },
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
        <div key={i} style={{ marginBottom: 5, display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
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
          {gamepadConnected && row.pad && row.pad.map((padKey, j) => (
            <span key={`pad-${j}`} style={{
                background: 'rgba(88,145,255,0.25)',
                padding: '2px 6px',
                borderRadius: 4,
                marginRight: 5,
                fontSize: 12,
                border: '1px solid rgba(120,170,255,0.6)',
            }}>
                {padKey}
            </span>
          ))}
          <span style={{ fontSize: 14, marginLeft: 5 }}>{row.desc}</span>
        </div>
      ))}
      {gamepadConnected && !gamepadIsStandard && (
        <div style={{ fontSize: 11, marginTop: 8, maxWidth: 220, opacity: 0.85 }}>
          ⚠ Gamepad rilevato ma non riconosciuto come "standard" dal browser
          (tipico con i pad PS3/DualShock 3 via cavo): i tasti sopra
          potrebbero non corrispondere esattamente ai pulsanti fisici.
        </div>
      )}
    </div>
  );
};

export default Controls;
