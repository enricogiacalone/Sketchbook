import React, { useEffect, useRef } from 'react';
import { useStore } from '../../store';
import { ROAD_OFFSETS, ROAD_WIDTH, SIDEWALK_WIDTH, ROAD_SIZE } from '../Environment/Road';
import { CITY_LAYOUT, CITY_BLOCK_SIZE } from '../Environment/City';
import { RUNWAY_CENTER, RUNWAY_LENGTH, RUNWAY_WIDTH, HELIPORT_CENTER, HELIPORT_RADIUS } from '../Environment/Airport';
import { radarState } from '../../lib/radarState';
import { cityOpponents } from '../city/cityActors';

// "sistema la minimappa, deve essere visibile solo in playground. uguale a
// gta" -- il radar di GTA V:
// - rettangolo in basso a sinistra, sotto la barra della vita (verde, meta'
//   sinistra) e dell'armatura (blu, meta' destra); vita bassa lampeggia;
// - ruota con la CAMERA (in alto c'e' dove guardi), il giocatore e' la
//   freccia un po' sotto il centro (si vede di piu' davanti) e punta dove
//   e' girato lui;
// - mappa vera della citta': strade chiare, isolati, palazzi, parco, piazze,
//   aeroporto, mare oltre il bordo dell'isola;
// - "N" sul bordo verso nord; nemici rossi; altri giocatori; obiettivo della
//   missione giallo che resta sul bordo quando e' lontano;
// - si allarga con la velocita' (in auto, col drone).
// Disegnata su canvas: la citta' una volta sola (immagine fuori schermo),
// poi a ogni frame solo la trasformazione e i blip -- niente React a 60 Hz.

// --- dimensioni (px a 1080p; scalate con l'altezza della finestra) ---------
const BASE_W = 280;
const BASE_H = 180;
const BAR_H = 9;
const BAR_GAP = 3;
const MARGIN_LEFT = 28;
const MARGIN_BOTTOM = 28;
const PLAYER_Y = 0.62; // il giocatore sta al 62% dell'altezza
// metri visibili in verticale: a piedi, e al massimo in velocita'
const SPAN_FOOT = 85;
const SPAN_FAST = 210;
const SPEED_FOR_MAX_ZOOM = 30; // m/s

// --- colori (radar di GTA V) -------------------------------------------------
const COL = {
  water: '#29435c',
  land: '#3b3f3a',
  block: '#454943',
  building: '#2e312d',
  buildingEdge: '#575c55',
  park: '#43603a',
  plaza: '#5a554a',
  sidewalk: '#6b6f69',
  road: '#a9adae',
  runway: '#5a5d60',
  runwayMark: '#d8d8d8',
  heliport: '#5a5d60',
  frame: 'rgba(0,0,0,0.85)',
  health: '#56a54b',
  healthBg: '#244a21',
  healthLow: '#c8322b',
  armor: '#4c8bd6',
  armorBg: '#1f3a5c',
  enemy: '#e0352b',
  mission: '#f0c419',
  player: '#e9e9e9',
};

// --- citta' pre-disegnata -----------------------------------------------------
const WORLD_HALF = ROAD_SIZE / 2 + 20; // un po' di mare attorno all'isola
const TERRAIN_HALF = ROAD_SIZE / 2;
const MAP_PX_PER_M = 3;

function buildCityImage(): HTMLCanvasElement {
  const size = Math.ceil(WORLD_HALF * 2 * MAP_PX_PER_M);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  const k = MAP_PX_PER_M;
  const X = (x: number) => (x + WORLD_HALF) * k;
  const Z = (z: number) => (z + WORLD_HALF) * k;

  g.fillStyle = COL.water;
  g.fillRect(0, 0, size, size);
  g.fillStyle = COL.land;
  g.fillRect(X(-TERRAIN_HALF), Z(-TERRAIN_HALF), TERRAIN_HALF * 2 * k, TERRAIN_HALF * 2 * k);

  // isolati: parco (blocco 0,0), piazze, cortili
  const B = CITY_BLOCK_SIZE;
  const block = (cx: number, cz: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(X(cx - B / 2), Z(cz - B / 2), B * k, B * k);
  };
  block(B / 2, B / 2, COL.park);
  CITY_LAYOUT.plazas.forEach((p) => block(p.x, p.z, COL.plaza));
  CITY_LAYOUT.courtyards.forEach((p) => block(p.x, p.z, COL.block));

  // strade con marciapiedi
  const half = ROAD_WIDTH / 2;
  for (const o of ROAD_OFFSETS) {
    g.fillStyle = COL.sidewalk;
    g.fillRect(X(-TERRAIN_HALF), Z(o - half - SIDEWALK_WIDTH), TERRAIN_HALF * 2 * k, (ROAD_WIDTH + 2 * SIDEWALK_WIDTH) * k);
    g.fillRect(X(o - half - SIDEWALK_WIDTH), Z(-TERRAIN_HALF), (ROAD_WIDTH + 2 * SIDEWALK_WIDTH) * k, TERRAIN_HALF * 2 * k);
  }
  for (const o of ROAD_OFFSETS) {
    g.fillStyle = COL.road;
    g.fillRect(X(-TERRAIN_HALF), Z(o - half), TERRAIN_HALF * 2 * k, ROAD_WIDTH * k);
    g.fillRect(X(o - half), Z(-TERRAIN_HALF), ROAD_WIDTH * k, TERRAIN_HALF * 2 * k);
  }

  // palazzi
  g.lineWidth = 1;
  for (const b of CITY_LAYOUT.buildings) {
    g.fillStyle = COL.building;
    g.fillRect(X(b.x - b.w / 2), Z(b.z - b.d / 2), b.w * k, b.d * k);
    g.strokeStyle = COL.buildingEdge;
    g.strokeRect(X(b.x - b.w / 2) + 0.5, Z(b.z - b.d / 2) + 0.5, b.w * k - 1, b.d * k - 1);
  }

  // aeroporto: pista lungo X ed eliporto
  g.fillStyle = COL.runway;
  g.fillRect(X(RUNWAY_CENTER[0] - RUNWAY_LENGTH / 2), Z(RUNWAY_CENTER[1] - RUNWAY_WIDTH / 2), RUNWAY_LENGTH * k, RUNWAY_WIDTH * k);
  g.fillStyle = COL.runwayMark;
  for (let x = -RUNWAY_LENGTH / 2 + 8; x < RUNWAY_LENGTH / 2 - 8; x += 12) {
    g.fillRect(X(RUNWAY_CENTER[0] + x), Z(RUNWAY_CENTER[1]) - 1, 6 * k, 2);
  }
  g.fillStyle = COL.heliport;
  g.beginPath();
  g.arc(X(HELIPORT_CENTER[0]), Z(HELIPORT_CENTER[1]), HELIPORT_RADIUS * k, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = COL.runwayMark;
  g.font = `bold ${Math.round(HELIPORT_RADIUS * k)}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('H', X(HELIPORT_CENTER[0]), Z(HELIPORT_CENTER[1]));
  return c;
}

// punto sul bordo del rettangolo (inset) lungo la semiretta dal giocatore
function clampToRect(px: number, py: number, x: number, y: number, w: number, h: number, inset: number) {
  const minX = inset, maxX = w - inset, minY = inset, maxY = h - inset;
  if (x >= minX && x <= maxX && y >= minY && y <= maxY) return { x, y, clamped: false };
  const dx = x - px, dy = y - py;
  let t = 1;
  if (dx > 0) t = Math.min(t, (maxX - px) / dx);
  if (dx < 0) t = Math.min(t, (minX - px) / dx);
  if (dy > 0) t = Math.min(t, (maxY - py) / dy);
  if (dy < 0) t = Math.min(t, (minY - py) / dy);
  return { x: px + dx * t, y: py + dy * t, clamped: true };
}

const Minimap: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const healthRef = useRef<HTMLDivElement>(null);
  const armorRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const city = buildCityImage();
    let raf = 0;
    let span = SPAN_FOOT;
    let last: { x: number; z: number; t: number } | null = null;
    let speed = 0;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;
      const st = useStore.getState();

      // dimensioni: come GTA, proporzionate all'altezza della finestra
      const scale = Math.min(1.25, Math.max(0.65, window.innerHeight / 1080 * 1.15));
      const W = Math.round(BASE_W * scale);
      const H = Math.round(BASE_H * scale);
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        canvas.style.width = `${W}px`;
        canvas.style.height = `${H}px`;
        wrap.style.width = `${W}px`;
      }
      const g = canvas.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);

      const [px, py, pz] = st.playerPos;
      // velocita' (zoom)
      if (last) {
        const dt = Math.max(1e-3, (now - last.t) / 1000);
        const v = Math.hypot(px - last.x, pz - last.z) / dt;
        if (v < 200) speed += (v - speed) * Math.min(1, dt * 3);
      }
      last = { x: px, z: pz, t: now };
      const onFoot = st.currentControllable === 'player' || st.currentControllable === 'combatSoldier';
      const zoomK = onFoot ? Math.min(1, speed / 12) * 0.2 : Math.min(1, speed / SPEED_FOR_MAX_ZOOM);
      const wantSpan = SPAN_FOOT + (SPAN_FAST - SPAN_FOOT) * zoomK;
      span += (wantSpan - span) * 0.05;
      const pxPerM = H / span;

      const heading = radarState.valid ? radarState.camHeading : 0;
      const a = -heading; // rotazione della mappa: dove guardi va in alto
      const cos = Math.cos(a), sin = Math.sin(a);
      const cx = W / 2;
      const cy = H * PLAYER_Y;
      const toScreen = (x: number, z: number) => {
        const dx = (x - px) * pxPerM, dz = (z - pz) * pxPerM;
        return { x: cx + dx * cos - dz * sin, y: cy + dx * sin + dz * cos };
      };

      // --- mappa ---
      g.clearRect(0, 0, W, H);
      g.save();
      g.beginPath();
      g.rect(0, 0, W, H);
      g.clip();
      g.fillStyle = COL.water;
      g.fillRect(0, 0, W, H);
      g.save();
      g.translate(cx, cy);
      g.rotate(a);
      const s = pxPerM / MAP_PX_PER_M;
      g.scale(s, s);
      g.translate(-(px + WORLD_HALF) * MAP_PX_PER_M, -(pz + WORLD_HALF) * MAP_PX_PER_M);
      g.imageSmoothingEnabled = true;
      g.drawImage(city, 0, 0);
      g.restore();

      // --- blip ---
      const dot = (x: number, y: number, r: number, fill: string, stroke = 'rgba(0,0,0,0.8)') => {
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fillStyle = fill;
        g.fill();
        g.lineWidth = 1.5;
        g.strokeStyle = stroke;
        g.stroke();
      };
      // nemici (rossi), solo dentro il radar
      st.entities.forEach((e) => {
        if (e.type !== 'enemy') return;
        const p = toScreen(e.position[0], e.position[2]);
        if (p.x < -4 || p.y < -4 || p.x > W + 4 || p.y > H + 4) return;
        dot(p.x, p.y, 4 * scale, COL.enemy);
      });
      // altri giocatori: freccia nel loro colore
      for (const o of cityOpponents) {
        if (!o.team.startsWith('REMOTE_') || o.isDead) continue;
        const p = toScreen(o.position.x, o.position.z);
        if (p.x < -6 || p.y < -6 || p.x > W + 6 || p.y > H + 6) continue;
        // FighterData: avanti = (-sin r, -cos r) -> rotta dal nord
        const hdg = Math.atan2(-Math.sin(o.rotation), Math.cos(o.rotation));
        drawArrow(g, p.x, p.y, hdg - heading, 6 * scale, '#5ab4ff');
      }
      // obiettivo della missione: giallo, resta sul bordo se lontano
      const mt = st.missionTargetPos;
      if (mt) {
        const p0 = toScreen(mt[0], mt[1]);
        const p = clampToRect(cx, cy, p0.x, p0.y, W, H, 8 * scale);
        dot(p.x, p.y, (p.clamped ? 4.5 : 5.5) * scale, COL.mission);
      }
      // nord: "N" sul bordo
      {
        const far = toScreen(px, pz - 10000);
        const p = clampToRect(cx, cy, far.x, far.y, W, H, 10 * scale);
        dot(p.x, p.y, 8 * scale, 'rgba(20,20,20,0.85)', 'rgba(255,255,255,0.25)');
        g.fillStyle = '#fff';
        g.font = `bold ${Math.round(10 * scale)}px sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('N', p.x, p.y + 0.5);
      }
      // giocatore: freccia verso dove e' girato lui (rispetto alla camera)
      {
        const yaw = st.playerYaw; // avanti = (sin yaw, cos yaw)
        const hdg = Math.atan2(Math.sin(yaw), -Math.cos(yaw));
        drawArrow(g, cx, cy, hdg - heading, 8 * scale, COL.player);
      }
      g.restore();

      // cornice
      g.lineWidth = 2;
      g.strokeStyle = COL.frame;
      g.strokeRect(1, 1, W - 2, H - 2);

      // --- vita e armatura (sotto il radar) ---
      const hp = Math.max(0, Math.min(1, st.health / (st.maxHealth || 100)));
      const ar = Math.max(0, Math.min(1, st.armor / 100));
      if (healthRef.current) {
        const low = hp < 0.25;
        const blink = low && Math.floor(now / 350) % 2 === 0;
        healthRef.current.style.width = `${hp * 100}%`;
        healthRef.current.style.background = low ? (blink ? COL.healthLow : '#7a1f1a') : COL.health;
      }
      if (armorRef.current) armorRef.current.style.width = `${ar * 100}%`;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const bar = (bg: string): React.CSSProperties => ({
    flex: 1,
    height: BAR_H,
    background: bg,
    border: '1px solid rgba(0,0,0,0.85)',
    overflow: 'hidden',
  });

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'absolute',
        left: MARGIN_LEFT,
        bottom: MARGIN_BOTTOM,
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: BAR_GAP,
        filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.6))',
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block' }} />
      <div style={{ display: 'flex', gap: BAR_GAP }}>
        <div style={bar(COL.healthBg)}>
          <div ref={healthRef} style={{ height: '100%', width: '100%', background: COL.health }} />
        </div>
        <div style={bar(COL.armorBg)}>
          <div ref={armorRef} style={{ height: '100%', width: '0%', background: COL.armor }} />
        </div>
      </div>
    </div>
  );
};

// freccia (punta in avanti), ruotata di `angle` in senso orario dall'alto
function drawArrow(g: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number, fill: string) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.beginPath();
  g.moveTo(0, -size);
  g.lineTo(size * 0.72, size * 0.75);
  g.lineTo(0, size * 0.35);
  g.lineTo(-size * 0.72, size * 0.75);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.stroke();
  g.restore();
}

export default Minimap;
