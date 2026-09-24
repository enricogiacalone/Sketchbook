import React, { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { PISTOL_MAG_SIZE } from '../Environment/weapons/weaponConfig';

// HUD della pistola nel duello: mirino al centro dello schermo (la camera
// sopra la spalla guarda esattamente li', vedi useThirdPersonCamera.ts),
// che si stringe in mira, hit marker quando un colpo va a segno, e il
// contatore del caricatore in basso a destra. A mani nude mostra solo
// l'indicatore dell'arma (1 Pugni / 2 Pistola).
const HIT_MARKER_MS = 260;

const WeaponHUD: React.FC = () => {
  const { weapon, aiming, ammo, reloading, hitAt, hitKill, hitHead } = useStore(
    useShallow((s) => ({
      weapon: s.playerWeapon,
      aiming: s.playerAiming,
      ammo: s.pistolAmmo,
      reloading: s.pistolReloading,
      hitAt: s.pistolHitAt,
      hitKill: s.pistolHitKill,
      hitHead: s.pistolHitHead,
    }))
  );
  // ridisegna finche' l'hit marker e' visibile, poi si spegne da solo
  const [, setTick] = useState(0);
  const markerAge = performance.now() - hitAt;
  const markerOn = hitAt > 0 && markerAge < HIT_MARKER_MS;
  useEffect(() => {
    if (!markerOn) return;
    const id = window.setTimeout(() => setTick((t) => t + 1), HIT_MARKER_MS - markerAge + 5);
    return () => window.clearTimeout(id);
  }, [hitAt, markerOn, markerAge]);

  const pistol = weapon === 'pistol';
  const gap = aiming ? 4 : 10;
  const len = aiming ? 5 : 7;
  const color = reloading ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.9)';
  const tick: React.CSSProperties = {
    position: 'absolute',
    background: color,
    boxShadow: '0 0 2px rgba(0,0,0,0.9)',
    transition: 'all 0.1s ease-out',
  };
  const markerColor = hitKill ? '#ef4444' : hitHead ? '#facc15' : '#ffffff';

  return (
    <>
      {pistol && (
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, pointerEvents: 'none' }}>
          <div style={{ ...tick, left: -1, top: -gap - len, width: 2, height: len }} />
          <div style={{ ...tick, left: -1, top: gap, width: 2, height: len }} />
          <div style={{ ...tick, top: -1, left: -gap - len, width: len, height: 2 }} />
          <div style={{ ...tick, top: -1, left: gap, width: len, height: 2 }} />
          <div style={{ ...tick, left: -1, top: -1, width: 2, height: 2 }} />
          {markerOn &&
            [45, 135, 225, 315].map((a) => (
              <div
                key={a}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: 9,
                  height: 2,
                  background: markerColor,
                  boxShadow: '0 0 3px rgba(0,0,0,0.9)',
                  transformOrigin: '0 50%',
                  transform: `rotate(${a}deg) translateX(7px)`,
                  opacity: 1 - markerAge / HIT_MARKER_MS,
                }}
              />
            ))}
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          right: 24,
          bottom: 24,
          padding: '8px 14px',
          borderRadius: 8,
          background: 'rgba(0,0,0,0.55)',
          color: '#fff',
          fontFamily: 'monospace',
          textAlign: 'right',
          pointerEvents: 'none',
          minWidth: 120,
        }}
      >
        <div style={{ fontSize: 11, opacity: 0.75 }}>
          <span style={{ opacity: pistol ? 0.5 : 1, fontWeight: pistol ? 400 : 700 }}>1 Pugni</span>
          {'  '}
          <span style={{ opacity: pistol ? 1 : 0.5, fontWeight: pistol ? 700 : 400 }}>2 Pistola</span>
        </div>
        {pistol && (
          <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1, color: ammo === 0 && !reloading ? '#ef4444' : '#fff' }}>
            {reloading ? <span style={{ fontSize: 16 }}>Ricarica…</span> : ammo}
            <span style={{ fontSize: 14, opacity: 0.6 }}> / {PISTOL_MAG_SIZE}</span>
          </div>
        )}
        {pistol && (
          <div style={{ fontSize: 10, opacity: 0.6 }}>LMB spara · RMB mira · R ricarica</div>
        )}
      </div>
    </>
  );
};

export default WeaponHUD;
