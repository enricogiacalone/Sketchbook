import React, { useLayoutEffect } from 'react';
import { useStore } from '../../store';
import { setToonShading } from '../../lib/toonStyle';
import ToonOutline from './ToonOutline';

// Stile toon acceso/spento (casella nel menu iniziale e nel pannello
// Grafica): luce a gradini nei materiali + contorni e colori sull'immagine.
const ToonStyle: React.FC = () => {
  const on = useStore((s) => s.toonStyle);
  useLayoutEffect(() => {
    setToonShading(on);
  }, [on]);
  return on ? <ToonOutline /> : null;
};

export default ToonStyle;
