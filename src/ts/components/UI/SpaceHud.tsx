import React, { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { planetSizeLabel } from '../../lib/planet';
import { spacePlanets, spaceState } from '../../lib/space';

// Navigazione nello spazio, col drone: i pianeti con distanza e direzione
// (verso il polo nord, dove sta la citta': la colonna di luce).
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

interface Row {
  name: string;
  size: string;
  km: number;
  rel: number; // rad, > 0 = a sinistra
  dy: number;
  here: boolean;
}

const SpaceHud: React.FC = () => {
  const isDrone = useStore((s) => s.isDrone);
  const [rows, setRows] = useState<Row[]>([]);
  const [alt, setAlt] = useState(0);

  useEffect(() => {
    if (!isDrone) {
      setRows([]);
      return;
    }
    const t = window.setInterval(() => {
      const st = useStore.getState();
      const p = st.playerPos;
      setAlt(spaceState.alt);
      if (spaceState.alt < 150) {
        setRows([]);
        return;
      }
      setRows(
        spacePlanets()
          .map((pl) => {
            const dx = pl.pole[0] - p[0], dy = pl.pole[1] - p[1], dz = pl.pole[2] - p[2];
            return {
              name: pl.profile.name,
              size: planetSizeLabel(pl.profile.gridRadius),
              km: Math.hypot(dx, dy, dz) / 1000,
              rel: wrap(Math.atan2(dx, dz) - st.playerYaw),
              dy,
              here: spaceState.resident?.seed === pl.profile.seed,
            };
          })
          .sort((a, b) => a.km - b.km)
      );
    }, 150);
    return () => window.clearInterval(t);
  }, [isDrone]);

  if (!isDrone || rows.length === 0) return null;
  return (
    <div style={{ position: 'fixed', top: 70, right: 28, zIndex: 9000, pointerEvents: 'none', color: '#dfeaf2', fontFamily: 'system-ui, sans-serif', fontSize: 12, letterSpacing: 1, background: 'rgba(8,14,20,0.7)', border: '1px solid rgba(79,195,247,0.35)', borderRadius: 4, padding: '8px 12px', minWidth: 230 }}>
      <div style={{ color: '#8aa', marginBottom: 4 }}>QUOTA {(alt / 1000).toFixed(1)} km - vola verso la colonna di luce</div>
      {rows.map((r) => (
        <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0', opacity: r.here ? 0.6 : 1 }}>
          <span style={{ display: 'inline-block', width: 16, textAlign: 'center', transform: `rotate(${-r.rel}rad)` }}>↑</span>
          <span style={{ flex: 1 }}>{r.name}</span>
          <span style={{ color: '#8aa' }}>{r.size}</span>
          <span>{r.km.toFixed(1)} km {r.dy > 150 ? '▲' : r.dy < -150 ? '▼' : ''}</span>
        </div>
      ))}
    </div>
  );
};

export default SpaceHud;
