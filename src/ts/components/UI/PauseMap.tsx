import React, { useEffect, useRef } from 'react';
import { useStore } from '../../store';
import { buildCityImage, TERRAIN_HALF, WORLD_HALF, type CityMapPalette } from '../../lib/cityMapImage';
import { gps, routeEta, setWaypoint, type P2 } from '../../lib/gps';
import { BAR, BAR_FRONT_Z, MARKET, YARD } from '../../missions/storyPlaces';
import { RUNWAY_CENTER, HELIPORT_CENTER } from '../Environment/Airport';
import { CITY_BLOCK_SIZE } from '../Environment/City';

// Mappa della pausa, alla GTA: "Mappa in pausa: si apre con Esc o Start e
// mostra strade, luoghi delle missioni e la tua posizione, con zoom e
// spostamento. Waypoint: lo metti con un clic sulla mappa (con il pad,
// cursore e X)." Il tragitto lo calcola lib/gps.ts; qui si disegna e basta.
//
// Tutto su un canvas, con un suo requestAnimationFrame: in pausa il ciclo
// dei frame di R3F e' fermo (GameFreeze.tsx), questo no.
//
// Comandi
//   mouse: trascina = sposta, rotella = zoom, clic = waypoint (clic sul
//          waypoint o tasto destro = toglierlo), clic su un luogo = waypoint li'
//   tastiera: WASD/frecce = sposta, E/+ e Q/- = zoom, C = centra,
//             Invio = waypoint al centro, Backspace = togli, Esc = riprendi
//   pad: levetta sinistra = cursore, levetta destra = sposta, L2/R2 = zoom,
//        X = waypoint, Triangolo = centra, Cerchio o Start = riprendi

const PX_PER_M = 4; // risoluzione dell'immagine della citta'
const MAX_SCALE = 9; // px per metro con lo zoom al massimo

const PAL: CityMapPalette = {
  water: '#0f2233',
  land: '#1b2128',
  block: '#20272f',
  building: '#2b333d',
  buildingEdge: '#3d4754',
  park: '#1f3a2a',
  plaza: '#2d2b27',
  sidewalk: '#323a44',
  road: '#5d6875',
  runway: '#2a3038',
  runwayMark: '#9aa4b0',
  heliport: '#2a3038',
};

const C = {
  bg: '#0a1017',
  you: '#ffffff',
  waypoint: '#c45ce0',
  mission: '#f0c419',
  enemy: '#e0352b',
  place: '#4fc3f7',
  text: '#e8edf3',
  dim: 'rgba(232,237,243,0.55)',
  panel: 'rgba(8,13,20,0.82)',
  line: 'rgba(255,255,255,0.12)',
};

interface Place {
  name: string;
  hint: string;
  x: number;
  z: number;
  icon: string;
}

const PLACES: Place[] = [
  { name: 'Bar Da Vito', hint: 'Vito, il boss del quartiere', x: BAR.x, z: BAR_FRONT_Z - 1, icon: 'B' },
  { name: 'Mercato', hint: 'Bancarelle e il chiosco di Lucky', x: MARKET.x, z: MARKET.z, icon: 'M' },
  { name: 'Deposito', hint: 'Il cortile dei Serpenti', x: YARD.x, z: YARD.z, icon: 'D' },
  { name: 'Aeroporto', hint: 'Pista e aerei', x: RUNWAY_CENTER[0], z: RUNWAY_CENTER[1], icon: '✈' },
  { name: 'Eliporto', hint: 'Elicottero', x: HELIPORT_CENTER[0], z: HELIPORT_CENTER[1], icon: 'H' },
  { name: 'Parco', hint: 'Il parco in centro', x: CITY_BLOCK_SIZE / 2, z: CITY_BLOCK_SIZE / 2, icon: 'P' },
];

// la vista resta com'era tra una pausa e l'altra (come in GTA)
const view = { x: 0, z: 0, scale: 0, init: false };

const fmtDist = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const fmtEta = (s: number) => (s < 45 ? '<1 min' : `~${Math.round(s / 60)} min`);

const PauseMap: React.FC = () => {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const routeLabelRef = useRef<HTMLDivElement>(null);
  const routeValueRef = useRef<HTMLDivElement>(null);
  const clearBtnRef = useRef<HTMLButtonElement>(null);
  const coordsRef = useRef<HTMLDivElement>(null);
  const scaleBarRef = useRef<HTMLDivElement>(null);
  const scaleTextRef = useRef<HTMLSpanElement>(null);
  const api = useRef<{ zoom: (k: number) => void; center: () => void } | null>(null);

  useEffect(() => {
    const root = rootRef.current!;
    const canvas = canvasRef.current!;
    const g = canvas.getContext('2d')!;
    const city = buildCityImage(PAL, PX_PER_M);
    let W = 1;
    let H = 1;
    let dpr = 1;

    const fitScale = () => (0.92 * Math.min(W, H)) / (2 * WORLD_HALF);
    const clampView = () => {
      view.scale = Math.max(fitScale(), Math.min(MAX_SCALE, view.scale));
      view.x = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, view.x));
      view.z = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, view.z));
    };
    const toScreen = (x: number, z: number): [number, number] => [(x - view.x) * view.scale + W / 2, (z - view.z) * view.scale + H / 2];
    const toWorld = (sx: number, sy: number): P2 => [(sx - W / 2) / view.scale + view.x, (sy - H / 2) / view.scale + view.z];
    const zoomAt = (k: number, sx = W / 2, sy = H / 2) => {
      const [wx, wz] = toWorld(sx, sy);
      view.scale *= k;
      clampView();
      view.x = wx - (sx - W / 2) / view.scale;
      view.z = wz - (sy - H / 2) / view.scale;
      clampView();
    };
    const center = () => {
      const [px, , pz] = useStore.getState().playerPos;
      view.x = px;
      view.z = pz;
      clampView();
    };
    api.current = { zoom: (k) => zoomAt(k), center };

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = root.clientWidth || window.innerWidth;
      H = root.clientHeight || window.innerHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      clampView();
    };
    resize();
    if (!view.init) {
      view.init = true;
      view.scale = 2.2;
    }
    // si apre sempre centrata su di te
    center();
    window.addEventListener('resize', resize);

    // --- cursore (mouse o pad) ---
    const cursor = { x: W / 2, y: H / 2, on: false, pad: false };

    // cosa c'e' sotto il cursore: un luogo, l'obiettivo, il waypoint
    type Hit = { kind: 'place' | 'mission' | 'waypoint'; x: number; z: number; title: string; sub: string };
    const hitAt = (sx: number, sy: number): Hit | null => {
      let best: Hit | null = null;
      let bd = 18;
      const test = (x: number, z: number, h: Omit<Hit, 'x' | 'z'>) => {
        const [qx, qy] = toScreen(x, z);
        const d = Math.hypot(qx - sx, qy - sy);
        if (d < bd) {
          bd = d;
          best = { ...h, x, z };
        }
      };
      const st = useStore.getState();
      for (const p of PLACES) test(p.x, p.z, { kind: 'place', title: p.name, sub: p.hint });
      const mt = st.missionTargetPos;
      if (mt) test(mt[0], mt[1], { kind: 'mission', title: st.missionTitle || 'Obiettivo', sub: st.missionBriefing || '' });
      const wp = gps.waypoint;
      if (wp) test(wp[0], wp[1], { kind: 'waypoint', title: 'Waypoint', sub: 'Clic per toglierlo' });
      return best;
    };

    const placeWaypoint = (sx: number, sy: number) => {
      const h = hitAt(sx, sy);
      if (h?.kind === 'waypoint') {
        setWaypoint(null);
        return;
      }
      if (h) {
        setWaypoint([h.x, h.z]);
        return;
      }
      const [wx, wz] = toWorld(sx, sy);
      const lim = TERRAIN_HALF - 2;
      setWaypoint([Math.max(-lim, Math.min(lim, wx)), Math.max(-lim, Math.min(lim, wz))]);
    };

    // --- mouse ---
    let drag: { x: number; y: number; vx: number; vz: number; moved: boolean; id: number } | null = null;
    const local = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const onDown = (e: PointerEvent) => {
      const [x, y] = local(e);
      cursor.pad = false;
      if (e.button === 2) {
        setWaypoint(null);
        return;
      }
      if (e.button !== 0) return;
      drag = { x, y, vx: view.x, vz: view.z, moved: false, id: e.pointerId };
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const [x, y] = local(e);
      cursor.x = x;
      cursor.y = y;
      cursor.on = true;
      cursor.pad = false;
      if (!drag) return;
      if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) > 5) drag.moved = true;
      if (drag.moved) {
        view.x = drag.vx - (x - drag.x) / view.scale;
        view.z = drag.vz - (y - drag.y) / view.scale;
        clampView();
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const [x, y] = local(e);
      if (!drag.moved) placeWaypoint(x, y);
      drag = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [x, y] = local(e);
      zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), x, y);
    };
    const onLeave = () => {
      if (!cursor.pad) cursor.on = false;
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // i clic sulla mappa non arrivano al gioco (useInput li conterebbe come
    // colpi: il canvas della mappa e' un canvas anche lui)
    const swallowMouse = (e: MouseEvent) => {
      if (root.contains(e.target as Node)) e.stopImmediatePropagation();
    };
    window.addEventListener('mousedown', swallowMouse, true);
    window.addEventListener('mouseup', swallowMouse, true);

    // --- tastiera: la mappa si prende tutti i tasti tranne Esc (che riprende,
    // GameFreeze.tsx). I keyup passano: un tasto tenuto premuto prima della
    // pausa deve potersi rilasciare.
    const held = new Set<string>();
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.metaKey || e.ctrlKey || /^F\d+$/.test(e.code)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      held.add(e.code);
      if (e.repeat) return;
      switch (e.code) {
        case 'KeyE':
        case 'Equal':
        case 'NumpadAdd':
          zoomAt(1.3);
          break;
        case 'KeyQ':
        case 'Minus':
        case 'NumpadSubtract':
          zoomAt(1 / 1.3);
          break;
        case 'KeyC':
        case 'Home':
          center();
          break;
        case 'Enter':
        case 'Space':
          placeWaypoint(cursor.on ? cursor.x : W / 2, cursor.on ? cursor.y : H / 2);
          break;
        case 'Backspace':
        case 'Delete':
          setWaypoint(null);
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      held.delete(e.code);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);

    // --- pad ---
    const padPrev: boolean[] = [];
    const DEAD = 0.18;
    const axis = (v: number) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));
    const pollPad = (dt: number) => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const p = Array.from(pads).find((q) => q && q.connected);
      if (!p) return;
      const btn = (i: number) => !!p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5);
      const edge = (i: number) => btn(i) && !padPrev[i];
      const released = (i: number) => !btn(i) && padPrev[i];
      const lx = axis(p.axes[0] ?? 0);
      const ly = axis(p.axes[1] ?? 0);
      const rx = axis(p.axes[2] ?? 0);
      const ry = axis(p.axes[3] ?? 0);
      if (lx || ly) {
        if (!cursor.pad) {
          cursor.pad = true;
          cursor.on = true;
          cursor.x = W / 2;
          cursor.y = H / 2;
        }
        const sp = 650 * dt;
        cursor.x += lx * Math.abs(lx) * sp * 1.4;
        cursor.y += ly * Math.abs(ly) * sp * 1.4;
        // sul bordo il cursore trascina la mappa
        const m = 70;
        const ex = cursor.x < m ? cursor.x - m : cursor.x > W - m ? cursor.x - (W - m) : 0;
        const ey = cursor.y < m ? cursor.y - m : cursor.y > H - m ? cursor.y - (H - m) : 0;
        if (ex || ey) {
          view.x += (ex * 8 * dt) / view.scale;
          view.z += (ey * 8 * dt) / view.scale;
          clampView();
        }
        cursor.x = Math.max(16, Math.min(W - 16, cursor.x));
        cursor.y = Math.max(16, Math.min(H - 16, cursor.y));
      }
      if (rx || ry) {
        view.x += (rx * 700 * dt) / view.scale;
        view.z += (ry * 700 * dt) / view.scale;
        clampView();
      }
      const l2 = p.buttons[6]?.value ?? 0;
      const r2 = p.buttons[7]?.value ?? 0;
      if (r2 > 0.05 || l2 > 0.05) {
        const sx = cursor.pad ? cursor.x : W / 2;
        const sy = cursor.pad ? cursor.y : H / 2;
        zoomAt(Math.exp((r2 - l2) * 2.2 * dt), sx, sy);
      }
      if (edge(0)) placeWaypoint(cursor.pad ? cursor.x : W / 2, cursor.pad ? cursor.y : H / 2);
      if (edge(2)) setWaypoint(null);
      if (edge(3)) center();
      // Cerchio: riprende al rilascio (se no il gioco, ripartendo, lo
      // leggerebbe ancora premuto)
      if (released(1)) useStore.getState().setPaused(false);
      for (let i = 0; i < p.buttons.length; i++) padPrev[i] = btn(i);
    };

    // --- disegno ---
    const diamond = (x: number, y: number, r: number, fill: string) => {
      g.save();
      g.translate(x, y);
      g.rotate(Math.PI / 4);
      g.fillStyle = fill;
      g.fillRect(-r, -r, r * 2, r * 2);
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(0,0,0,0.85)';
      g.strokeRect(-r, -r, r * 2, r * 2);
      g.restore();
    };
    const pulse = (x: number, y: number, color: string, t: number, r0: number, r1: number) => {
      const k = (t * 0.0011) % 1;
      g.globalAlpha = 0.85 * (1 - k);
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, r0 + k * (r1 - r0), 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    };
    const arrow = (x: number, y: number, ang: number, size: number) => {
      g.save();
      g.translate(x, y);
      g.rotate(ang);
      g.beginPath();
      g.moveTo(0, -size);
      g.lineTo(size * 0.72, size * 0.78);
      g.lineTo(0, size * 0.35);
      g.lineTo(-size * 0.72, size * 0.78);
      g.closePath();
      g.fillStyle = C.you;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(0,0,0,0.9)';
      g.stroke();
      g.restore();
    };

    let raf = 0;
    let last = performance.now();
    let lastHud = '';
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      pollPad(dt);
      // WASD / frecce
      const pan = (650 * dt) / view.scale;
      if (held.has('KeyA') || held.has('ArrowLeft')) view.x -= pan;
      if (held.has('KeyD') || held.has('ArrowRight')) view.x += pan;
      if (held.has('KeyW') || held.has('ArrowUp')) view.z -= pan;
      if (held.has('KeyS') || held.has('ArrowDown')) view.z += pan;
      clampView();

      const st = useStore.getState();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = C.bg;
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);

      // citta'
      const [ox, oy] = toScreen(-WORLD_HALF, -WORLD_HALF);
      const k = view.scale / PX_PER_M;
      g.imageSmoothingEnabled = true;
      g.drawImage(city, ox, oy, city.width * k, city.height * k);

      // reticolo leggero ogni 60 m (aiuta a leggere le distanze)
      g.strokeStyle = 'rgba(79,195,247,0.05)';
      g.lineWidth = 1;
      g.beginPath();
      for (let v = -300; v <= 300; v += 60) {
        const [x0, y0] = toScreen(v, -WORLD_HALF);
        const [, y1] = toScreen(v, WORLD_HALF);
        g.moveTo(Math.round(x0) + 0.5, y0);
        g.lineTo(Math.round(x0) + 0.5, y1);
        const [x2, y2] = toScreen(-WORLD_HALF, v);
        const [x3] = toScreen(WORLD_HALF, v);
        g.moveTo(x2, Math.round(y2) + 0.5);
        g.lineTo(x3, Math.round(y2) + 0.5);
      }
      g.stroke();

      // tragitto del GPS
      const route = gps.route;
      const routeColor = gps.kind === 'waypoint' ? C.waypoint : C.mission;
      if (route && route.points.length > 1) {
        g.beginPath();
        route.points.forEach((p, i) => {
          const [x, y] = toScreen(p[0], p[1]);
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        });
        g.lineJoin = 'round';
        g.lineCap = 'round';
        g.globalAlpha = 0.3;
        g.strokeStyle = routeColor;
        g.lineWidth = 12;
        g.stroke();
        g.globalAlpha = 1;
        g.lineWidth = 4.5;
        g.stroke();
        // trattini che scorrono verso l'arrivo
        g.setLineDash([2, 13]);
        g.lineDashOffset = -now * 0.03;
        g.strokeStyle = 'rgba(255,255,255,0.95)';
        g.lineWidth = 2;
        g.stroke();
        g.setLineDash([]);
      }

      // luoghi
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const p of PLACES) {
        const [x, y] = toScreen(p.x, p.z);
        if (x < -60 || y < -60 || x > W + 60 || y > H + 60) continue;
        g.beginPath();
        g.arc(x, y, 11, 0, Math.PI * 2);
        g.fillStyle = 'rgba(8,13,20,0.9)';
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = C.place;
        g.stroke();
        g.fillStyle = C.place;
        g.font = '700 11px system-ui, sans-serif';
        g.fillText(p.icon, x, y + 0.5);
        if (view.scale > 1.1) {
          g.font = '600 11px system-ui, sans-serif';
          g.fillStyle = 'rgba(0,0,0,0.75)';
          g.fillText(p.name.toUpperCase(), x + 1, y + 22);
          g.fillStyle = C.text;
          g.fillText(p.name.toUpperCase(), x, y + 21);
        }
      }

      // nemici
      st.entities.forEach((e) => {
        if (e.type !== 'enemy') return;
        const [x, y] = toScreen(e.position[0], e.position[2]);
        g.beginPath();
        g.arc(x, y, 4, 0, Math.PI * 2);
        g.fillStyle = C.enemy;
        g.fill();
        g.lineWidth = 1.5;
        g.strokeStyle = 'rgba(0,0,0,0.8)';
        g.stroke();
      });

      // obiettivo della missione
      const mt = st.missionTargetPos;
      if (mt) {
        const [x, y] = toScreen(mt[0], mt[1]);
        pulse(x, y, C.mission, now + 400, 8, 30);
        g.beginPath();
        g.arc(x, y, 7, 0, Math.PI * 2);
        g.fillStyle = C.mission;
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = 'rgba(0,0,0,0.85)';
        g.stroke();
      }

      // waypoint
      const wp = gps.waypoint;
      if (wp) {
        const [x, y] = toScreen(wp[0], wp[1]);
        pulse(x, y, C.waypoint, now, 9, 30);
        diamond(x, y, 7, C.waypoint);
        g.fillStyle = 'rgba(0,0,0,0.85)';
        g.fillRect(x - 2, y - 2, 4, 4);
      }

      // tu
      {
        const [px, , pz] = st.playerPos;
        const [x, y] = toScreen(px, pz);
        const yaw = st.playerYaw; // avanti = (sin yaw, cos yaw)
        pulse(x, y, 'rgba(255,255,255,0.6)', now + 700, 10, 26);
        arrow(x, y, Math.atan2(Math.sin(yaw), -Math.cos(yaw)), 10);
      }

      // cursore e cosa c'e' sotto
      if (cursor.on) {
        const { x, y } = cursor;
        g.strokeStyle = cursor.pad ? 'rgba(255,255,255,0.9)' : 'rgba(79,195,247,0.6)';
        g.lineWidth = cursor.pad ? 2 : 1;
        g.beginPath();
        g.moveTo(x - 15, y);
        g.lineTo(x - 5, y);
        g.moveTo(x + 5, y);
        g.lineTo(x + 15, y);
        g.moveTo(x, y - 15);
        g.lineTo(x, y - 5);
        g.moveTo(x, y + 5);
        g.lineTo(x, y + 15);
        g.stroke();
        const h = hitAt(x, y);
        if (h) {
          g.font = '700 12px system-ui, sans-serif';
          const sub = h.sub.length > 60 ? `${h.sub.slice(0, 57)}...` : h.sub;
          const w = Math.max(g.measureText(h.title).width, g.measureText(sub).width * 0.9) + 24;
          const bx = Math.min(W - w - 8, Math.max(8, x - w / 2));
          const by = Math.max(8, y - 64);
          g.fillStyle = C.panel;
          g.fillRect(bx, by, w, 42);
          g.fillStyle = h.kind === 'mission' ? C.mission : h.kind === 'waypoint' ? C.waypoint : C.place;
          g.fillRect(bx, by, 3, 42);
          g.textAlign = 'left';
          g.fillStyle = C.text;
          g.fillText(h.title, bx + 12, by + 14);
          g.font = '500 11px system-ui, sans-serif';
          g.fillStyle = C.dim;
          g.fillText(sub, bx + 12, by + 30);
          g.textAlign = 'center';
        }
      }

      // --- testi HTML (solo quando cambiano) ---
      const [cwx, cwz] = toWorld(cursor.on ? cursor.x : W / 2, cursor.on ? cursor.y : H / 2);
      const inVehicle = st.currentControllable !== 'player' && st.currentControllable !== 'combatSoldier';
      let label = 'NESSUN WAYPOINT';
      let value = 'Clic sulla mappa per metterne uno';
      if (gps.target && route) {
        label = gps.kind === 'waypoint' ? 'WAYPOINT' : 'OBIETTIVO MISSIONE';
        value = `${fmtDist(route.length)} · ${fmtEta(routeEta(route.length, inVehicle))}`;
      }
      // scala: un segmento tondo tra 70 e 160 px
      let sm = 10;
      for (const c of [10, 20, 25, 50, 100, 200, 250, 500]) if (c * view.scale <= 160) sm = c;
      const hud = `${label}|${value}|${Math.round(cwx)}|${Math.round(cwz)}|${sm}|${Math.round(sm * view.scale)}|${!!gps.waypoint}`;
      if (hud !== lastHud) {
        lastHud = hud;
        if (routeLabelRef.current) {
          routeLabelRef.current.textContent = label;
          routeLabelRef.current.style.color = gps.kind === 'mission' ? C.mission : C.waypoint;
        }
        if (routeValueRef.current) routeValueRef.current.textContent = value;
        if (clearBtnRef.current) clearBtnRef.current.style.display = gps.waypoint ? 'inline-block' : 'none';
        if (coordsRef.current) coordsRef.current.textContent = `X ${Math.round(cwx)} · Z ${Math.round(cwz)}`;
        if (scaleBarRef.current) scaleBarRef.current.style.width = `${Math.round(sm * view.scale)}px`;
        if (scaleTextRef.current) scaleTextRef.current.textContent = `${sm} m`;
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      api.current = null;
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('mousedown', swallowMouse, true);
      window.removeEventListener('mouseup', swallowMouse, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, []);

  const panel: React.CSSProperties = {
    position: 'absolute',
    background: C.panel,
    border: `1px solid ${C.line}`,
    borderRadius: 4,
    color: C.text,
    backdropFilter: 'blur(3px)',
  };
  const kbd: React.CSSProperties = {
    display: 'inline-block',
    padding: '1px 6px',
    marginRight: 6,
    border: `1px solid rgba(255,255,255,0.35)`,
    borderRadius: 3,
    fontSize: 10,
    fontWeight: 700,
    color: C.text,
  };
  const btn: React.CSSProperties = {
    width: 38,
    height: 38,
    background: C.panel,
    border: `1px solid ${C.line}`,
    borderRadius: 4,
    color: C.text,
    fontSize: 18,
    cursor: 'pointer',
    pointerEvents: 'auto',
  };
  const swatch = (color: string, shape: 'arrow' | 'diamond' | 'dot' | 'line' | 'ring'): React.ReactNode => {
    const base: React.CSSProperties = { display: 'inline-block', width: 12, height: 12, marginRight: 10, verticalAlign: 'middle' };
    if (shape === 'diamond') return <i style={{ ...base, width: 10, height: 10, background: color, transform: 'rotate(45deg)' }} />;
    if (shape === 'dot') return <i style={{ ...base, background: color, borderRadius: '50%' }} />;
    if (shape === 'ring') return <i style={{ ...base, border: `2px solid ${color}`, borderRadius: '50%', boxSizing: 'border-box' }} />;
    if (shape === 'line') return <i style={{ ...base, height: 4, background: color, borderRadius: 2 }} />;
    return <i style={{ ...base, background: color, clipPath: 'polygon(50% 0, 100% 100%, 50% 72%, 0 100%)' }} />;
  };

  return (
    <div
      ref={rootRef}
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: 'absolute', inset: 0, zIndex: 60, background: C.bg, userSelect: 'none', fontFamily: 'system-ui, sans-serif' }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, cursor: 'crosshair', touchAction: 'none' }} />

      {/* titolo e riprendi */}
      <div style={{ position: 'absolute', top: 22, left: 28, color: C.text, pointerEvents: 'none' }}>
        <div className="sb-font" style={{ fontSize: 34, letterSpacing: 2, lineHeight: 1 }}>
          Mappa
        </div>
        <div ref={coordsRef} style={{ fontSize: 11, letterSpacing: 1.5, color: C.dim, marginTop: 6 }} />
      </div>
      <button
        type="button"
        onClick={() => useStore.getState().setPaused(false)}
        style={{ ...panel, top: 22, right: 28, padding: '9px 14px', fontSize: 12, fontWeight: 700, letterSpacing: 1.5, cursor: 'pointer' }}
      >
        RIPRENDI <span style={{ ...kbd, marginLeft: 8, marginRight: 0 }}>ESC</span>
      </button>

      {/* percorso */}
      <div style={{ ...panel, top: 74, right: 28, padding: '12px 16px', minWidth: 220, textAlign: 'right' }}>
        <div ref={routeLabelRef} style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: C.waypoint }}>
          NESSUN WAYPOINT
        </div>
        <div ref={routeValueRef} style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }} />
        <button
          ref={clearBtnRef}
          type="button"
          onClick={() => setWaypoint(null)}
          style={{
            display: 'none',
            marginTop: 8,
            background: 'none',
            border: `1px solid ${C.line}`,
            borderRadius: 3,
            color: C.dim,
            fontSize: 11,
            padding: '3px 8px',
            cursor: 'pointer',
          }}
        >
          Togli waypoint
        </button>
      </div>

      {/* legenda */}
      <div style={{ ...panel, top: 110, left: 28, padding: '12px 16px', fontSize: 12, lineHeight: '24px', pointerEvents: 'none' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>LEGENDA</div>
        <div>{swatch(C.you, 'arrow')}Tu</div>
        <div>{swatch(C.waypoint, 'diamond')}Waypoint</div>
        <div>{swatch(C.waypoint, 'line')}Percorso GPS</div>
        <div>{swatch(C.mission, 'dot')}Obiettivo missione</div>
        <div>{swatch(C.mission, 'line')}Percorso missione</div>
        <div>{swatch(C.place, 'ring')}Luoghi</div>
        <div>{swatch(C.enemy, 'dot')}Nemici</div>
      </div>

      {/* zoom */}
      <div style={{ position: 'absolute', right: 28, bottom: 74, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button type="button" style={btn} aria-label="Zoom avanti" onClick={() => api.current?.zoom(1.5)}>
          +
        </button>
        <button type="button" style={btn} aria-label="Zoom indietro" onClick={() => api.current?.zoom(1 / 1.5)}>
          −
        </button>
        <button type="button" style={btn} aria-label="Centra su di me" onClick={() => api.current?.center()}>
          ◎
        </button>
      </div>

      {/* scala */}
      <div style={{ position: 'absolute', left: 28, bottom: 74, color: C.dim, fontSize: 11, pointerEvents: 'none' }}>
        <div
          ref={scaleBarRef}
          style={{ height: 6, borderLeft: `1px solid ${C.dim}`, borderRight: `1px solid ${C.dim}`, borderBottom: `1px solid ${C.dim}` }}
        />
        <span ref={scaleTextRef} style={{ display: 'block', marginTop: 4 }} />
      </div>

      {/* comandi */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 22,
          display: 'flex',
          justifyContent: 'center',
          flexWrap: 'wrap',
          gap: '6px 20px',
          fontSize: 11,
          letterSpacing: 1,
          color: C.dim,
          pointerEvents: 'none',
          padding: '0 16px',
        }}
      >
        <span>
          <span style={kbd}>TRASCINA</span>SPOSTA
        </span>
        <span>
          <span style={kbd}>ROTELLA</span>ZOOM
        </span>
        <span>
          <span style={kbd}>CLIC</span>WAYPOINT
        </span>
        <span>
          <span style={kbd}>DESTRO</span>TOGLI
        </span>
        <span>
          <span style={kbd}>C</span>CENTRA
        </span>
        <span>
          <span style={kbd}>✕</span>WAYPOINT <span style={{ ...kbd, marginLeft: 6 }}>L2 R2</span>ZOOM{' '}
          <span style={{ ...kbd, marginLeft: 6 }}>△</span>
          CENTRA
        </span>
        <span>
          <span style={kbd}>ESC</span>
          <span style={kbd}>START</span>RIPRENDI
        </span>
      </div>
    </div>
  );
};

export default PauseMap;
