import React, { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { weaponWheel, WHEEL_SLOTS, WEAPON_NAMES, WheelWeapon, wheelWeaponAt } from '../../lib/weaponWheel';

// "aggiungi la ruota di selezione delle armi come in gta": l'overlay.
// Otto settori scuri e trasparenti attorno al centro, quello evidenziato
// chiaro; in ogni settore l'icona dell'arma scelta (i vuoti mostrano solo
// la categoria, spenti); al centro nome dell'arma, munizioni se e' quella
// in mano, e le frecce se nel settore ce n'e' piu' d'una. I comandi sono in
// WeaponWheelController.tsx.

const R_OUT = 230;
const R_IN = 92;
const GAP_DEG = 1.6;

const polar = (r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [r * Math.cos(a), r * Math.sin(a)];
};
const wedgePath = (i: number) => {
  const a0 = i * 45 - 22.5 + GAP_DEG / 2;
  const a1 = i * 45 + 22.5 - GAP_DEG / 2;
  const [x0, y0] = polar(R_OUT, a0);
  const [x1, y1] = polar(R_OUT, a1);
  const [x2, y2] = polar(R_IN, a1);
  const [x3, y3] = polar(R_IN, a0);
  return `M ${x0} ${y0} A ${R_OUT} ${R_OUT} 0 0 1 ${x1} ${y1} L ${x2} ${y2} A ${R_IN} ${R_IN} 0 0 0 ${x3} ${y3} Z`;
};

// icone semplici (sagome bianche), centrate in 0,0, ~60 px
const WeaponIcon: React.FC<{ w: WheelWeapon; color: string }> = ({ w, color }) => {
  switch (w) {
    case 'pistol':
      return (
        <g fill={color}>
          <path d="M -28 -12 L 26 -12 L 26 0 L -4 0 L -6 4 L -10 22 L -24 22 L -18 0 L -28 0 Z" />
          <rect x={-2} y={0} width={10} height={6} rx={2} fill="none" stroke={color} strokeWidth={3} />
        </g>
      );
    case 'rifle':
      return (
        <g fill={color}>
          <path d="M -40 -6 L -14 -9 L 30 -9 L 30 -3 L 40 -3 L 40 1 L 30 1 L 30 3 L 4 3 L 4 16 L -4 16 L -6 3 L -14 3 L -18 12 L -28 12 L -24 2 L -40 2 Z" />
          <rect x={-10} y={3} width={7} height={14} rx={2} transform="rotate(12 -6 10)" />
        </g>
      );
    case 'knife':
      return (
        <g fill={color}>
          <path d="M -6 -4 L 30 -4 C 30 2 24 6 16 6 L -6 6 Z" />
          <rect x={-12} y={-7} width={5} height={16} rx={1} />
          <rect x={-32} y={-4} width={20} height={10} rx={3} />
        </g>
      );
    case 'fists':
    default:
      return (
        <g fill="none" stroke={color} strokeWidth={4} strokeLinejoin="round">
          <path d="M -16 -14 L 14 -14 C 20 -14 22 -10 22 -4 L 22 10 C 22 18 16 22 8 22 L -10 22 C -18 22 -22 16 -22 8 L -22 -8 C -22 -12 -20 -14 -16 -14 Z" />
          <path d="M -8 -14 L -8 -2 M 2 -14 L 2 -2 M 12 -14 L 12 -2 M -22 -2 L 22 -2" />
        </g>
      );
  }
};

const WeaponWheel: React.FC = () => {
  const open = useStore((s) => s.weaponWheelOpen);
  const playerWeapon = useStore((s) => s.playerWeapon);
  const ammo = useStore((s) => s.pistolAmmo);
  // ridisegno solo quando cambia la scelta
  const [sel, setSel] = useState({ slot: 0, pick: weaponWheel.pick.join(','), aimDeg: 0, aiming: false });

  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const aiming = Math.hypot(weaponWheel.aimX, weaponWheel.aimY) > 28;
      const aimDeg = (Math.atan2(weaponWheel.aimX, -weaponWheel.aimY) * 180) / Math.PI;
      const next = { slot: weaponWheel.slot, pick: weaponWheel.pick.join(','), aimDeg: Math.round(aimDeg), aiming };
      setSel((prev) =>
        prev.slot === next.slot && prev.pick === next.pick && prev.aimDeg === next.aimDeg && prev.aiming === next.aiming ? prev : next
      );
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  if (!open) return null;

  const scale = Math.max(0.55, Math.min(1, Math.min(window.innerWidth, window.innerHeight) / 620));
  const current = wheelWeaponAt(sel.slot);
  const slot = WHEEL_SLOTS[sel.slot];
  const isGun = current === 'pistol' || current === 'rifle';

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 20, background: 'rgba(0,0,0,0.25)' }}>
      <svg
        viewBox={`${-R_OUT - 20} ${-R_OUT - 20} ${(R_OUT + 20) * 2} ${(R_OUT + 20) * 2}`}
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: (R_OUT + 20) * 2 * scale,
          height: (R_OUT + 20) * 2 * scale,
          transform: 'translate(-50%, -50%)',
          fontFamily: 'sans-serif',
        }}
      >
        {WHEEL_SLOTS.map((s, i) => {
          const selected = i === sel.slot;
          const empty = s.weapons.length === 0;
          const w = wheelWeaponAt(i);
          const [ix, iy] = polar((R_OUT + R_IN) / 2, i * 45);
          return (
            <g key={i}>
              <path
                d={wedgePath(i)}
                fill={selected ? 'rgba(235,235,235,0.88)' : empty ? 'rgba(10,10,10,0.45)' : 'rgba(10,10,10,0.68)'}
                stroke={selected ? '#ffffff' : 'rgba(255,255,255,0.18)'}
                strokeWidth={selected ? 3 : 1.5}
              />
              {w ? (
                <g transform={`translate(${ix} ${iy - 6})`}>
                  <WeaponIcon w={w} color={selected ? '#111' : '#f2f2f2'} />
                </g>
              ) : (
                <text x={ix} y={iy} fill="rgba(255,255,255,0.28)" fontSize={12} fontWeight={700} textAnchor="middle">
                  {/* etichette lunghe su due righe, dentro il settore */}
                  {s.label
                    .toUpperCase()
                    .split(' ')
                    .reduce<string[]>((lines, word) => {
                      const last = lines[lines.length - 1];
                      if (last !== undefined && (last + ' ' + word).length <= 11) lines[lines.length - 1] = last + ' ' + word;
                      else lines.push(word);
                      return lines;
                    }, [])
                    .map((line, k, arr) => (
                      <tspan key={k} x={ix} dy={k === 0 ? (-(arr.length - 1) * 14) / 2 + 4 : 14}>
                        {line}
                      </tspan>
                    ))}
                </text>
              )}
              {/* piu' armi nel settore: un pallino per ognuna */}
              {s.weapons.length > 1 &&
                s.weapons.map((_, k) => (
                  <circle
                    key={k}
                    cx={ix + (k - (s.weapons.length - 1) / 2) * 12}
                    cy={iy + 34}
                    r={3.5}
                    fill={k === weaponWheel.pick[i] ? (selected ? '#111' : '#fff') : selected ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.3)'}
                  />
                ))}
            </g>
          );
        })}
        {/* lancetta verso il settore puntato */}
        {sel.aiming && (
          <g transform={`rotate(${sel.aimDeg})`}>
            <path d={`M -9 ${-R_IN + 4} L 0 ${-R_IN - 10} L 9 ${-R_IN + 4} Z`} fill="#ffffff" />
          </g>
        )}
        {/* centro */}
        <circle r={R_IN - 8} fill="rgba(10,10,10,0.75)" stroke="rgba(255,255,255,0.15)" strokeWidth={1.5} />
        <text y={-22} fill="rgba(255,255,255,0.55)" fontSize={13} fontWeight={700} textAnchor="middle">
          {slot?.label.toUpperCase()}
        </text>
        <text y={4} fill="#ffffff" fontSize={19} fontWeight={800} textAnchor="middle">
          {current ? WEAPON_NAMES[current] : ''}
        </text>
        {isGun && current === playerWeapon && (
          <text y={28} fill="#f0c419" fontSize={15} fontWeight={700} textAnchor="middle">
            {ammo} colpi
          </text>
        )}
        {slot && slot.weapons.length > 1 && (
          <text y={50} fill="rgba(255,255,255,0.55)" fontSize={12} textAnchor="middle">
            ◄ rotella / croce ►
          </text>
        )}
      </svg>
    </div>
  );
};

export default WeaponWheel;
