import React from 'react';
import { getPlanet, planetSizeLabel } from '../../lib/planet';
import { spacePlanets } from '../../lib/space';

// Nella pausa: dove sei e quali pianeti ci sono. Ci si va col drone (B),
// volando nello spazio fino alla colonna di luce di un pianeta
// (components/SpaceController.tsx, UI/SpaceHud.tsx).
const PlanetMenu: React.FC = () => {
  const here = getPlanet();
  return (
    <div style={{ position: 'absolute', left: 28, bottom: 64, zIndex: 61, fontFamily: 'system-ui, sans-serif', color: '#dfeaf2', background: 'rgba(8,14,20,0.92)', border: '1px solid rgba(79,195,247,0.4)', borderRadius: 4, padding: '9px 14px', fontSize: 12, letterSpacing: 1 }}>
      <div style={{ fontWeight: 700, letterSpacing: 1.5 }}>
        PIANETA: {here.name.toUpperCase()} ({planetSizeLabel(here.gridRadius)})
      </div>
      <div style={{ color: '#8aa', marginTop: 6 }}>Altri pianeti (col drone, sali e segui la colonna di luce):</div>
      {spacePlanets()
        .filter((p) => !p.isCurrent)
        .map((p) => (
          <div key={p.profile.seed}>
            {p.profile.name} - {planetSizeLabel(p.profile.gridRadius)} - {(Math.hypot(...p.pole) / 1000).toFixed(1)} km
          </div>
        ))}
    </div>
  );
};

export default PlanetMenu;
