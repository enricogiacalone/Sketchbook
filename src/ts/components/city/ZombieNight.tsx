import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from '../../store';
import { pickRoadSpawn, clearWanted } from '../../lib/wanted';
import ZombieRain from './ZombieRain';
import Zombie, { type ZombieKind } from './Zombie';

// Modalita' zombi notturna (casella nella schermata iniziale e in Debug >
// Grafica): notte fonda (lib/SunCycle.ts), pioggia a collisione
// (ZombieRain.tsx, portata da threejs-conference), temporale con lampi e
// tuoni, e un'orda di zombi che esce dalle strade attorno al giocatore.

const BASE_ZOMBIES = 14;
const MAX_ZOMBIES = 22;
const RAMP_S = 60; // uno zombi in piu' ogni minuto di partita
const SPAWN_DIST: [number, number] = [32, 62];
const SPAWN_EVERY_S = 0.8;
const MIN_APART = 6;

interface Z {
  id: string;
  kind: ZombieKind;
  x: number;
  z: number;
}

let nextId = 0;
const pickKind = (): ZombieKind => {
  const r = Math.random();
  return r < 0.6 ? 'slow' : r < 0.9 ? 'brisk' : 'runner';
};

// pioggia (loop) e temporale: audio + lampo bianco sullo schermo
function useStormAudio() {
  useEffect(() => {
    const rain = new Audio('sounds/light-rain.mp3');
    rain.loop = true;
    rain.volume = 0.35;
    const thunder = new Audio('sounds/thunderstorm.mp3');
    thunder.volume = 0.5;
    void rain.play().catch(() => {});
    const flash = document.createElement('div');
    Object.assign(flash.style, {
      position: 'fixed',
      inset: '0',
      background: '#e8f0ff',
      opacity: '0',
      pointerEvents: 'none',
      zIndex: '5',
      transition: 'opacity 0.12s ease-out',
    });
    document.body.appendChild(flash);
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));
    const strike = () => {
      const flashes = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < flashes; i++) {
        later(() => (flash.style.opacity = '0.55'), i * 260);
        later(() => (flash.style.opacity = '0'), i * 260 + 110);
      }
      // il tuono arriva dopo il lampo
      later(() => {
        thunder.currentTime = Math.random() * 10;
        void thunder.play().catch(() => {});
        later(() => thunder.pause(), 5500);
      }, 700 + Math.random() * 1800);
      later(strike, 16000 + Math.random() * 26000);
    };
    later(strike, 6000 + Math.random() * 6000);
    return () => {
      rain.pause();
      thunder.pause();
      timers.forEach((t) => window.clearTimeout(t));
      flash.remove();
    };
  }, []);
}

const ZombieDirector: React.FC = () => {
  const [zs, setZs] = useState<Z[]>([]);
  const elapsed = useRef(0);
  const acc = useRef(SPAWN_EVERY_S);
  const zsRef = useRef<Z[]>([]);
  zsRef.current = zs;

  const onGone = useCallback((id: string) => setZs((prev) => prev.filter((z) => z.id !== id)), []);

  useFrame((_s, dt) => {
    elapsed.current += dt;
    acc.current += dt;
    if (acc.current < SPAWN_EVERY_S) return;
    acc.current = 0;
    const want = Math.min(MAX_ZOMBIES, BASE_ZOMBIES + Math.floor(elapsed.current / RAMP_S));
    if (zsRef.current.length >= want) return;
    const pp = useStore.getState().playerPos;
    const d = SPAWN_DIST[0] + Math.random() * (SPAWN_DIST[1] - SPAWN_DIST[0]);
    const p = pickRoadSpawn(pp[0], pp[2], d);
    // non addosso al giocatore ne' agli altri zombi
    if (Math.hypot(p.x - pp[0], p.z - pp[2]) < 22) return;
    if (zsRef.current.some((z) => Math.hypot(z.x - p.x, z.z - p.z) < MIN_APART)) return;
    setZs((prev) => [...prev, { id: `zombie-${nextId++}`, kind: pickKind(), x: p.x, z: p.z }]);
  });

  return (
    <>
      {zs.map((z) => (
        <Zombie key={z.id} id={z.id} kind={z.kind} x={z.x} z={z.z} onGone={onGone} />
      ))}
    </>
  );
};

const ZombieNight: React.FC = () => {
  const on = useStore((s) => s.zombieNight);
  if (!on) return null;
  return <Storm />;
};

const Storm: React.FC = () => {
  useStormAudio();
  // niente polizia: niente ricercato
  useEffect(() => clearWanted(), []);
  return (
    <>
      <ZombieRain />
      <ZombieDirector />
    </>
  );
};

export default ZombieNight;
