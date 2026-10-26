import React, { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../../store';
import { getCurrentSite, wildInfo } from '../../lib/site';
import { spaceState } from '../../lib/space';
import { acquireAudioListener, releaseAudioListener } from '../../lib/sharedAudioListener';
import { audioCtx, loopNoise, makeEmitter, playBellStroke, playStep } from '../../lib/proceduralAudio';
import { weather } from '../../lib/weather';
import { DAY_CYCLE_SECONDS, getTimeOfDay } from '../../lib/SunCycle';
import { devTime } from '../../lib/devTime';
import { villagesOf } from '../../lib/planetSurface';
import { VK, cultureOfKind, kindOf, siteFrameOf, villageItemSitePos, villageItems } from '../../lib/village';

// Suoni ambientali dei pianeti, tutti sintetizzati (lib/proceduralAudio.ts) e collegati all'ascoltatore condiviso:
// - vento: rumore filtrato con raffiche, piu' forte in quota, in campagna e con la pioggia (in citta' e' ovattato);
// - acqua: fiumi, laghi e mare vicini (entro ~100 m) con una sorgente posizionale sul punto d'acqua piu' vicino;
// - campane: la chiesa di ogni villaggio vicino suona a ore (ogni 3 ore di gioco; con la giornata ferma ogni 150 s), da
//   lontano si sente piano (sorgente posizionale in cima al campanile);
// - passi sull'erba del giocatore a piedi (nei siti selvaggi).
// Galline, cani e uccelli suonano da soli in VillageFolk.tsx. Il contesto audio parte al primo tocco/tasto (regola dei browser).
const BELL_RANGE = 420; // m dal sito: chiese da considerare
const WATER_RINGS = [8, 16, 28, 45, 70, 100];
const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface Bell { emitter: ReturnType<typeof makeEmitter>; pos: THREE.Vector3; next: number }

const AmbientSounds: React.FC = () => {
  const { camera, scene } = useThree();
  const S = useRef<{
    listener: THREE.AudioListener;
    wind: ReturnType<typeof loopNoise>;
    water: ReturnType<typeof makeEmitter>;
    waterNoise: ReturnType<typeof loopNoise>;
    waterObj: THREE.Object3D;
    bells: Bell[];
    siteId: string;
    waterT: number;
    waterFound: number;
    lastPos: THREE.Vector3 | null;
    stride: number;
    lastHour: number;
  } | null>(null);

  useEffect(() => {
    const listener = acquireAudioListener(camera);
    const ctx = audioCtx();
    const resume = () => {
      if (ctx.state === 'suspended') void ctx.resume();
    };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
    const wind = loopNoise(ctx, listener.getInput(), 'bandpass', 420, 0.7);
    const waterObj = new THREE.Object3D();
    scene.add(waterObj);
    const water = makeEmitter(listener, waterObj, 9, 1.3, 110);
    const waterNoise = loopNoise(ctx, water.bus, 'lowpass', 1300, 0.4);
    S.current = { listener, wind, water, waterNoise, waterObj, bells: [], siteId: '', waterT: 0, waterFound: 0, lastPos: null, stride: 0, lastHour: -1 };
    if (import.meta.env.DEV) (window as any).__ambient = S.current;
    return () => {
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
      const s = S.current;
      if (s) {
        s.wind.stop();
        s.waterNoise.stop();
        s.water.dispose();
        scene.remove(s.waterObj);
        s.bells.forEach((b) => { b.emitter.dispose(); scene.remove(b.emitter.audio); });
      }
      S.current = null;
      releaseAudioListener();
      if (import.meta.env.DEV) delete (window as any).__ambient;
    };
  }, [camera, scene]);

  const buildBells = (s: NonNullable<typeof S.current>, t: number) => devTime('buildBells', () => {
    s.bells.forEach((b) => b.emitter.dispose());
    s.bells = [];
    const site = getCurrentSite();
    for (const v of villagesOf(site.planetSeed)) {
      const fc = siteFrameOf(v, site.planetSeed);
      if (Math.hypot(fc.cx, fc.cz) > BELL_RANGE + v.radius + 60) continue; // (non si generano gli abitati lontani)
      for (const it of villageItems(site.planetSeed, v)) {
        if (kindOf(it.kind) !== VK.Temple || cultureOfKind(it.kind) === 2) continue; // (la moschea non ha campane)
        const pos = villageItemSitePos(site.planetSeed, v, it, site, 10.5, new THREE.Vector3());
        if (Math.hypot(pos.x, pos.z) > BELL_RANGE) continue;
        const holder = new THREE.Object3D();
        holder.position.copy(pos);
        scene.add(holder);
        const emitter = makeEmitter(s.listener, holder, 28, 0.9, 700);
        // (il supporto resta nella scena; si toglie con l'emettitore)
        const dispose = emitter.dispose;
        emitter.dispose = () => { dispose(); scene.remove(holder); };
        s.bells.push({ emitter, pos, next: t + 8 });
      }
    }
    s.siteId = site.id;
  });

  useFrame((state, dt) => {
    const s = S.current;
    if (!s) return;
    const ctx = audioCtx();
    const now = ctx.currentTime;
    const t = state.clock.elapsedTime;
    const site = getCurrentSite();
    const cam = state.camera.position;
    const st = useStore.getState();
    const space = 1 - Math.min(1, spaceState.t * 1.6); // nello spazio niente suoni d'aria

    // vento
    const gust = 0.65 + 0.35 * Math.sin(t * 0.37) * Math.sin(t * 0.11 + 1);
    const muffled = site.kind === 'city' && spaceState.alt < 120 ? 0.45 : 1;
    const level = (0.08 + 0.3 * smooth(0, 700, spaceState.alt) + 0.25 * weather.rain) * gust * muffled * space;
    s.wind.gain.gain.setTargetAtTime(level, now, 0.4);
    s.wind.filter.frequency.setTargetAtTime(280 + 520 * gust + 200 * weather.rain, now, 0.4);

    // acqua vicina (ogni ~0.7 s)
    s.waterT -= dt;
    if (s.waterT <= 0) {
      s.waterT = 0.7;
      let best = Infinity, bx = 0, bz = 0;
      if (spaceState.alt < 250) {
        for (const r of WATER_RINGS) {
          if (r >= best) break;
          for (let k = 0; k < 14; k++) {
            const a = (k / 14) * Math.PI * 2 + r * 0.3;
            const x = cam.x + Math.cos(a) * r, z = cam.z + Math.sin(a) * r;
            if (wildInfo(x, z, site).h < -0.3) {
              best = r;
              bx = x;
              bz = z;
              break;
            }
          }
        }
        if (best === Infinity && wildInfo(cam.x, cam.z, site).h < -0.3) { best = 0; bx = cam.x; bz = cam.z; } // (dentro l'acqua)
      }
      s.waterFound = best === Infinity ? 0 : 1;
      if (best !== Infinity) s.waterObj.position.set(bx, cam.y - 1, bz);
    }
    s.waterNoise.gain.gain.setTargetAtTime(s.waterFound * 0.5 * space, now, 0.5);

    // campane
    if (s.siteId !== site.id) buildBells(s, t);
    const hour = getTimeOfDay(t);
    const hourIdx = Math.floor(hour);
    const dayCycle = st.dayCycle;
    for (const b of s.bells) {
      let ring = false;
      if (dayCycle) {
        if (s.lastHour >= 0 && hourIdx !== s.lastHour && hourIdx % 3 === 0) ring = true;
      } else if (t >= b.next) ring = true;
      if (b.next > t && !dayCycle) ring = false;
      if (!ring) continue;
      b.next = t + 150;
      const near = Math.hypot(b.pos.x - cam.x, b.pos.z - cam.z) < 520;
      if (!near || space < 0.5) continue;
      const strokes = Math.min(6, hourIdx % 12 || 12);
      for (let i = 0; i < strokes; i++) playBellStroke(ctx, b.emitter.bus, 0.9, 392 + (b.pos.x % 7) * 4, i * 2.4);
    }
    s.lastHour = hourIdx;

    // passi sull'erba (giocatore a piedi, siti selvaggi)
    if (site.kind === 'wild' && !st.isDrone && st.isPlayerGrounded) {
      const pp = st.playerPos;
      if (s.lastPos) {
        const d = Math.hypot(pp[0] - s.lastPos.x, pp[2] - s.lastPos.z);
        if (d < 3) {
          s.stride += d;
          const step = 1.25;
          if (s.stride >= step) {
            s.stride -= step;
            const wet = weather.rain > 0.2 ? 1.25 : 1;
            playStep(ctx, s.listener.getInput(), (0.2 + Math.random() * 0.05) * wet, (0.85 + Math.random() * 0.3) * wet);
          }
        } else s.stride = 0;
      }
      (s.lastPos ??= new THREE.Vector3()).set(pp[0], pp[1], pp[2]);
    } else s.lastPos = null;
  });

  return null;
};

export default AmbientSounds;
