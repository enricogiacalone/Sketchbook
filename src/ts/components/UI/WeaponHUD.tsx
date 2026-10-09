import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { PISTOL_MAG_SIZE, RIFLE_MAG_SIZE } from '../Environment/weapons/weaponConfig';

// HUD delle armi del personaggio: mirino al centro dello schermo (la camera
// sopra la spalla guarda esattamente li', vedi useThirdPersonCamera.ts),
// hit marker quando un colpo va a segno e contatore del caricatore.
const HIT_MARKER_MS = 260;
// "il mirino deve comparire solo quando miro": come in GTA il mirino c'e'
// solo mirando, o per un attimo dopo un colpo sparato dal fianco (la
// munizione scesa = un colpo partito); l'hit marker si vede comunque
const SHOT_RETICLE_MS = 900;

const WeaponHUD: React.FC = () => {
  const { weapon, aiming, ammo, reloading, hitAt, hitKill, hitHead, currentControllable, isDrone, testScene, duelResult, locked } =
    useStore(
      useShallow((s) => ({
        weapon: s.playerWeapon,
        aiming: s.playerAiming,
        ammo: s.pistolAmmo,
        reloading: s.pistolReloading,
        hitAt: s.pistolHitAt,
        hitKill: s.pistolHitKill,
        hitHead: s.pistolHitHead,
        currentControllable: s.currentControllable,
        isDrone: s.isDrone,
        testScene: s.testScene,
        duelResult: s.duelResult,
        locked: s.aimLocked,
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
  const [shotAt, setShotAt] = useState(0);
  const lastAmmo = useRef(ammo);
  useEffect(() => {
    if (ammo < lastAmmo.current) setShotAt(performance.now());
    lastAmmo.current = ammo;
  }, [ammo]);
  const shotAge = performance.now() - shotAt;
  const shotOn = shotAt > 0 && shotAge < SHOT_RETICLE_MS;
  useEffect(() => {
    if (!shotOn) return;
    const id = window.setTimeout(() => setTick((t) => t + 1), SHOT_RETICLE_MS - shotAge + 5);
    return () => window.clearTimeout(id);
  }, [shotAt, shotOn, shotAge]);
  const reticleOn = aiming || shotOn;

  // "pistol" qui = un'arma da fuoco in mano (pistola o fucile)
  const pistol = weapon === 'pistol' || weapon === 'rifle';
  const magSize = weapon === 'rifle' ? RIFLE_MAG_SIZE : PISTOL_MAG_SIZE;
  const slots: [string, string, string][] = [
    ['fists', '1', 'Pugni'],
    ['pistol', '2', 'Pistola'],
    ['rifle', '3', 'Fucile'],
    ['knife', '4', 'Coltello'],
  ];
  const onFoot = currentControllable === 'player' || currentControllable === 'combatSoldier';
  const gap = aiming ? 5 : 10;
  const len = aiming ? 4 : 7;
  // agganciato a un bersaglio (mira col pad): rosso, come in GTA
  const color = reloading ? 'rgba(255,255,255,0.35)' : locked && aiming ? 'rgba(239,68,68,0.95)' : 'rgba(255,255,255,0.9)';
  const tick: React.CSSProperties = {
    position: 'absolute',
    background: color,
    boxShadow: '0 0 2px #000, 0 0 4px rgba(0,0,0,0.8)',
    transition: 'all 0.1s ease-out',
  };
  const markerColor = hitKill ? '#ef4444' : hitHead ? '#facc15' : '#ffffff';

  if (!onFoot || isDrone || (testScene === 'duel' && duelResult !== 'none')) return null;

  return (
    <>
      {pistol && (
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, pointerEvents: 'none' }}>
          {aiming && (
            <div
              style={{
                position: 'absolute',
                left: -3,
                top: -3,
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: locked ? 'rgba(239,68,68,0.95)' : 'rgba(255,255,255,0.95)',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.9), 0 0 5px rgba(0,0,0,0.9)',
              }}
            />
          )}
          {reticleOn && (
            <>
              <div style={{ ...tick, left: -1, top: -gap - len, width: 2, height: len }} />
              <div style={{ ...tick, left: -1, top: gap, width: 2, height: len }} />
              <div style={{ ...tick, top: -1, left: -gap - len, width: len, height: 2 }} />
              <div style={{ ...tick, top: -1, left: gap, width: len, height: 2 }} />
              <div style={{ ...tick, left: -1, top: -1, width: 2, height: 2 }} />
            </>
          )}
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
          {slots.map(([id, key, label]) => (
            <span key={id} style={{ opacity: weapon === id ? 1 : 0.5, fontWeight: weapon === id ? 700 : 400, marginLeft: 8 }}>
              {key} {label}
            </span>
          ))}
        </div>
        {pistol && (
          <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1, color: ammo === 0 && !reloading ? '#ef4444' : '#fff' }}>
            {reloading ? <span style={{ fontSize: 16 }}>Ricarica…</span> : ammo}
            <span style={{ fontSize: 14, opacity: 0.6 }}> / {magSize}</span>
          </div>
        )}
        {pistol && (
          <div style={{ fontSize: 10, opacity: 0.6 }}>
            {weapon === 'rifle' ? 'LMB (tieni) raffica' : 'LMB spara'} · RMB mira · R ricarica
          </div>
        )}
        {weapon === 'knife' && <div style={{ fontSize: 10, opacity: 0.6 }}>LMB fendente · Q fendente · E affondo · RMB para</div>}
      </div>
    </>
  );
};

export default WeaponHUD;
