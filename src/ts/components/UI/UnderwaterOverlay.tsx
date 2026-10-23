import React, { useEffect, useRef } from 'react';
import { spaceState } from '../../lib/space';

// Sott'acqua (come il passaggio subacqueo di droneWorld): velo azzurro-verde che scurisce ai bordi e una leggera
// ondulazione della luce. La foschia fitta la fa WorldFog; qui solo il colore sopra l'immagine.
const UnderwaterOverlay: React.FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = (t: number) => {
      const el = ref.current;
      if (el) {
        const k = spaceState.underwater;
        el.style.opacity = k > 0.01 ? String(Math.min(1, k)) : '0';
        // la luce che ondeggia: due gradienti che scorrono piano
        el.style.backgroundPosition = `${(t / 40) % 210}px 0, 0 0`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        opacity: 0,
        zIndex: 5,
        background:
          'repeating-linear-gradient(105deg, rgba(190,255,255,0.05) 0px, rgba(190,255,255,0) 70px, rgba(190,255,255,0.035) 130px, rgba(190,255,255,0) 210px), radial-gradient(ellipse at center, rgba(20,110,130,0.22) 0%, rgba(6,50,70,0.55) 100%)',
        backdropFilter: 'saturate(1.25) hue-rotate(-6deg)',
      }}
    />
  );
};

export default UnderwaterOverlay;
