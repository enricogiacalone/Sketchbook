import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import { droneHud, DroneHudTarget } from '../../lib/droneFlight';

// "uguale con la stessa ui di mira" -- l'HUD di droneWorld (src/hud,
// src/index.css, github.com/blaze33/droneWorld, MIT) mentre si pilota il
// drone:
// - #limiter: cerchio tratteggiato, il campo della cloche;
// - #pointer: la X verde del puntatore virtuale (dove hai lasciato il mouse);
// - #focal: cerchio focale; un bersaglio dentro per 2 s = aggancio (alone);
// - #horizon: linea dell'orizzonte (beccheggio e rollio);
// - mirino verde al centro; a sinistra l'arco dell'aggancio (verde), a
//   destra il calore della mitragliatrice (arancio);
// - bersagli: cerchietto con vita, freccia verso il centro, distanza (verde
//   se a tiro), nome; per quelli vicini al centro la linea d'anticipo e,
//   sul bersaglio della mitragliatrice, un mirino pieno;
// - altitudine e velocita' in basso.
// Legge lib/droneFlight.ts (scritto da Drone.tsx) con il suo rAF: niente
// React state a 60 Hz, solo stile diretto sugli elementi.

const GREEN = '#0f0';

const CROSSHAIR_PATHS = [
  'M83.807,49.322L50.87,4.891c-9.519-9.527-30.71-3.78-40.236,5.747S-4.64,41.347,4.887,50.874l44.431,32.937c9.519,9.519,24.963,9.527,34.49,0C93.334,74.284,93.326,58.84,83.807,49.322z',
  'M393.823,10.638c-9.527-9.527-30.71-15.274-40.236-5.747l-32.937,44.431c-9.527,9.527-9.527,24.963,0,34.49c9.527,9.527,24.963,9.519,34.49,0l44.431-32.937C409.096,41.347,403.349,20.164,393.823,10.638z',
  'M355.139,320.645c-9.527-9.527-24.963-9.527-34.49,0c-9.527,9.527-9.527,24.963,0,34.49l32.937,44.431c9.527,9.519,30.71,3.78,40.236-5.747s15.274-30.71,5.747-40.236L355.139,320.645z',
  'M49.318,320.645L4.887,353.582c-9.527,9.527-3.78,30.71,5.747,40.236s30.71,15.274,40.236,5.747l32.937-44.431c9.527-9.519,9.527-24.963,0-34.49C74.28,311.127,58.844,311.127,49.318,320.645z',
];

// il mirino di hud/crosshair.js (SVG 415x415 ridotto a `size`)
const CrosshairSvg: React.FC<{ size: number; fill?: string; fillOpacity?: number; gRef?: React.Ref<SVGSVGElement> }> = ({
  size,
  fill = 'transparent',
  fillOpacity,
  gRef,
}) => (
  <svg ref={gRef} viewBox="-10 -10 415 415" width={size} height={size} style={{ position: 'fixed', overflow: 'visible', pointerEvents: 'none' }}>
    <g fill={fill} fillOpacity={fillOpacity} stroke={GREEN} strokeWidth={17} opacity={0.8}>
      <circle cx="202.224" cy="202.228" r="26.686" />
      {CROSSHAIR_PATHS.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </g>
  </svg>
);

const TargetMarker: React.FC<{ t: DroneHudTarget; register: (id: string, el: HTMLDivElement | null) => void }> = ({ t, register }) => (
  <div
    ref={(el) => register(t.id, el)}
    style={{
      position: 'fixed',
      left: -12,
      top: -12,
      width: 20,
      height: 20,
      border: `2px solid ${GREEN}`,
      borderRadius: 20,
      color: GREEN,
      pointerEvents: 'none',
    }}
  >
    <div data-k="life" style={{ position: 'relative', top: 22, backgroundColor: GREEN, width: 20, height: 2 }} />
    <div
      data-k="arrow"
      style={{
        width: 0,
        height: 0,
        borderLeft: '10px solid transparent',
        borderRight: '10px solid transparent',
        borderBottom: '10px solid #f00',
      }}
    />
    <div
      data-k="distance"
      style={{
        position: 'absolute',
        top: '1.9em',
        left: '50%',
        width: 50,
        fontSize: '1em',
        fontFamily: 'monospace',
        fontWeight: 'bold',
        textAlign: 'center',
        transform: 'translateX(-50%)',
      }}
    />
    <div
      style={{
        position: 'absolute',
        top: '-1.1em',
        left: '50%',
        width: 250,
        color: GREEN,
        fontSize: '1em',
        fontFamily: 'monospace',
        fontWeight: 'bold',
        textAlign: 'center',
        transform: 'translateX(-50%)',
      }}
    >
      {t.name}
    </div>
  </div>
);

const DroneHUD: React.FC = () => {
  const isDrone = useStore((s) => s.isDrone);
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const targetsRef = useRef<Record<string, DroneHudTarget>>({});
  const markerEls = useRef(new Map<string, HTMLDivElement>());
  const register = (id: string, el: HTMLDivElement | null) => {
    if (el) markerEls.current.set(id, el);
    else markerEls.current.delete(id);
  };

  const limiterRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<HTMLDivElement>(null);
  const focalRef = useRef<HTMLDivElement>(null);
  const horizonRef = useRef<HTMLDivElement>(null);
  const altRef = useRef<HTMLDivElement>(null);
  const speedRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const centerCrossRef = useRef<SVGSVGElement>(null);
  const lockBgRef = useRef<SVGCircleElement>(null);
  const lockRef = useRef<SVGCircleElement>(null);
  const heatBgRef = useRef<SVGCircleElement>(null);
  const heatRef = useRef<SVGCircleElement>(null);
  const leadGroupRef = useRef<SVGGElement>(null);
  const gunCrossRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!isDrone) return;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const h = droneHud;
      if (!h.active) return;
      const cx = h.width / 2;
      const cy = h.height / 2;
      const zone = h.zone;
      const focal = h.focal;

      // bersagli entrati/usciti -> React (raro); il resto va diretto al DOM
      const ids = h.targets.map((t) => t.id);
      const map: Record<string, DroneHudTarget> = {};
      for (const t of h.targets) map[t.id] = t;
      targetsRef.current = map;
      setTargetIds((prev) => (prev.length === ids.length && prev.every((v, i) => v === ids[i]) ? prev : ids));

      if (limiterRef.current) {
        const s = limiterRef.current.style;
        s.width = s.height = `${zone * 2}px`;
        s.borderRadius = `${zone * 2}px`;
      }
      if (pointerRef.current) {
        pointerRef.current.style.left = `${cx}px`;
        pointerRef.current.style.top = `${cy}px`;
        pointerRef.current.style.transform = `translateX(${h.pointerX - 16}px) translateY(${h.pointerY - 16}px)`;
      }
      if (focalRef.current) {
        const s = focalRef.current.style;
        s.width = s.height = `${focal * 2}px`;
        s.borderRadius = `${focal * 2}px`;
        s.boxShadow = h.lock ? '0 0 75px #0f0' : '';
      }
      if (horizonRef.current) {
        horizonRef.current.style.transform = `translateX(-50%) translateY(${h.horizonY}px) rotate(${h.horizonDeg}deg)`;
      }
      if (altRef.current) altRef.current.textContent = Number.isFinite(h.altitude) ? `${h.altitude.toFixed(0)} m` : '— m';
      if (speedRef.current) speedRef.current.textContent = `${h.speed.toFixed(0)} m/s`;

      if (centerCrossRef.current) {
        centerCrossRef.current.style.left = `${cx - 15}px`;
        centerCrossRef.current.style.top = `${cy - 15}px`;
      }
      // archi: aggancio (sinistra, verde) e calore (destra, arancio), r = 160
      const r = zone * (160 / 400);
      const dash = r * (140 / 160);
      const arcs: [SVGCircleElement | null, number, string, boolean][] = [
        [lockBgRef.current, 1, '#666', false],
        [lockRef.current, h.lockLevel, GREEN, false],
        [heatBgRef.current, 1, '#666', true],
        [heatRef.current, h.gunHeat, 'orange', true],
      ];
      for (const [el, k, , mirror] of arcs) {
        if (!el) continue;
        el.setAttribute('cx', `${cx}`);
        el.setAttribute('cy', `${cy}`);
        el.setAttribute('r', `${r}`);
        el.setAttribute('stroke-dasharray', `${Math.max(0, k) * dash} 10000`);
        el.style.display = k > 0 ? '' : 'none';
        el.setAttribute(
          'transform',
          mirror ? `rotate(205 ${cx} ${cy}) translate(${cx * 2}, 0) scale(-1, 1)` : `rotate(155 ${cx} ${cy})`
        );
      }

      // marcatori
      for (const [id, el] of markerEls.current) {
        const t = map[id];
        if (!t) continue;
        const border = t.behind ? 'red' : 'orange';
        el.style.borderColor = border;
        el.style.transform = `translateX(${t.x}px) translateY(${t.y}px) scale(${t.scale})`;
        const life = el.querySelector('[data-k="life"]') as HTMLDivElement | null;
        if (life) life.style.width = `${t.life * 20}px`;
        const arrow = el.querySelector('[data-k="arrow"]') as HTMLDivElement | null;
        if (arrow) {
          arrow.style.borderBottomColor = t.inSight ? GREEN : border;
          arrow.style.opacity = `${t.arrowOpacity}`;
          arrow.style.transform = `translateY(2px) rotate(${t.arrowDeg}deg)`;
        }
        const dist = el.querySelector('[data-k="distance"]') as HTMLDivElement | null;
        if (dist) {
          dist.textContent = t.distance.toFixed(0);
          dist.style.color = t.inRange ? GREEN : 'orange';
        }
      }

      // linee d'anticipo + mirino pieno sul bersaglio della mitragliatrice
      const g = leadGroupRef.current;
      if (g) {
        let html = '';
        let gunX = -1000, gunY = -1000;
        for (const t of h.targets) {
          if (!t.gunHud) continue;
          const isGun = t.id === h.gunTargetId;
          html += `<path d="M ${t.x} ${t.y} l ${t.leadDX} ${t.leadDY}" stroke-width="1" stroke="${isGun ? GREEN : 'orange'}" fill="transparent"/>`;
          if (isGun) {
            gunX = t.x + t.leadDX;
            gunY = t.y + t.leadDY;
          }
        }
        g.innerHTML = html;
        if (gunCrossRef.current) {
          gunCrossRef.current.style.left = `${gunX - 15}px`;
          gunCrossRef.current.style.top = `${gunY - 15}px`;
          gunCrossRef.current.style.display = h.gunTargetId ? '' : 'none';
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [isDrone]);

  if (!isDrone) return null;

  const fixedCenter: React.CSSProperties = {
    position: 'fixed',
    left: '50%',
    top: '50%',
    transform: 'translateX(-50%) translateY(-50%)',
    pointerEvents: 'none',
  };

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 5 }}>
      <div ref={limiterRef} style={{ ...fixedCenter, width: 800, height: 800, borderRadius: 800, border: `1px dashed ${GREEN}`, opacity: 0.8 }} />
      <div ref={pointerRef} style={{ position: 'fixed', height: 32, width: 32, opacity: 0.8, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', left: 15, height: 33, width: 2, backgroundColor: GREEN, transform: 'rotate(45deg)' }} />
        <div style={{ position: 'absolute', left: 15, height: 33, width: 2, backgroundColor: GREEN, transform: 'rotate(-45deg)' }} />
      </div>
      <div ref={focalRef} style={{ ...fixedCenter, width: 300, height: 300, borderRadius: 300, border: `2px solid ${GREEN}`, opacity: 0.8 }} />
      <div
        ref={horizonRef}
        style={{ position: 'fixed', left: '50%', top: '50%', width: 300, height: 2, backgroundColor: GREEN, opacity: 0.8, transform: 'translateX(-50%)' }}
      />
      <div
        style={{
          position: 'fixed',
          left: '50%',
          top: '100%',
          width: '100%',
          transform: 'translateX(-50%) translateY(-300%)',
          textAlign: 'center',
          color: GREEN,
          fontFamily: 'sans-serif',
        }}
      >
        <div ref={altRef} style={{ display: 'inline-block', minWidth: '5em' }} />
        <div ref={speedRef} style={{ display: 'inline-block', minWidth: '5em' }} />
      </div>
      <svg ref={svgRef} style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
        <circle ref={lockBgRef} stroke="#666" opacity={0.8} strokeWidth={10} fill="transparent" strokeLinecap="round" />
        <circle ref={lockRef} stroke={GREEN} opacity={0.8} strokeWidth={10} fill="transparent" strokeLinecap="round" />
        <circle ref={heatBgRef} stroke="#666" opacity={0.8} strokeWidth={10} fill="transparent" strokeLinecap="round" />
        <circle ref={heatRef} stroke="orange" opacity={0.8} strokeWidth={10} fill="transparent" strokeLinecap="round" />
        <g ref={leadGroupRef} />
      </svg>
      <CrosshairSvg size={30} gRef={centerCrossRef} />
      <CrosshairSvg size={30} fill={GREEN} fillOpacity={0.6} gRef={gunCrossRef} />
      <div>
        {targetIds.map((id) => {
          const t = targetsRef.current[id];
          return t ? <TargetMarker key={id} t={t} register={register} /> : null;
        })}
      </div>
    </div>
  );
};

export default DroneHUD;
