import React, { useEffect, useState } from 'react';

// Temporary calibration readout for non-standard controllers (a PS3
// DualShock 3 in particular). Browsers frequently report DS3 pads with
// `mapping: ""` instead of `"standard"` -- meaning the Xbox-style button/axis
// indices useInput.ts's poller assumes (0=A/Cross, 1=B/Circle, 2=X/Square,
// 3=Y/Triangle, axes 0/1=left stick, ...) don't necessarily line up with the
// physical buttons at all. This panel just prints whatever useInput.ts's
// useFrame last wrote to window.__gamepadDebug, so whoever's holding the
// pad can read back real indices while pressing things -- lives outside the
// R3F <Canvas> tree (mounted in App.tsx's #ui-layer div alongside Controls/
// StatusBars), so it polls via its own rAF loop instead of useFrame.
interface GamepadDebugInfo {
  id: string;
  mapping: string;
  axes: number[];
  buttons: number[];
}

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: 8,
  right: 8,
  background: 'rgba(0,0,0,0.65)',
  color: '#4f8',
  font: '11px monospace',
  padding: '8px 10px',
  borderRadius: 6,
  zIndex: 9999,
  pointerEvents: 'none',
  maxWidth: 380,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
};

const GamepadDebug: React.FC = () => {
  const [info, setInfo] = useState<GamepadDebugInfo | null>(null);

  useEffect(() => {
    let raf: number;
    const tick = () => {
      setInfo((window as any).__gamepadDebug ?? null);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!import.meta.env.DEV) return null;

  if (!info) {
    return <div style={panelStyle}>Gamepad: nessun controller rilevato</div>;
  }

  return (
    <div style={panelStyle}>
      {`Pad: ${info.id}\nMapping: ${info.mapping}\nAxes: [${info.axes.join(', ')}]\nPressed buttons: [${info.buttons.join(', ')}]`}
    </div>
  );
};

export default GamepadDebug;
