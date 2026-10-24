import React, { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from '../../store';
import { getCurrentSite } from '../../lib/site';
import { spaceState } from '../../lib/space';
import { DAY_CYCLE_SECONDS, getTimeOfDay } from '../../lib/SunCycle';
import { updateWeather, weather } from '../../lib/weather';
import WeatherRain from './WeatherRain';

// Meteo dei pianeti (lib/weather.ts): aggiorna lo stato ogni frame, monta la pioggia alla prima perturbazione e fa il suono della
// pioggia e dei tuoni (stesso audio della modalita' zombi: public/sounds/light-rain.mp3 e thunderstorm.mp3). Nella modalita'
// zombi notturna c'e' gia' il suo temporale: qui il meteo si spegne.
const Weather: React.FC = () => {
  const on = useStore((s) => s.weatherOn && !s.zombieNight);
  const [rainMounted, setRainMounted] = useState(false);
  const audio = useRef<{ rain: HTMLAudioElement; thunder: HTMLAudioElement; next: number } | null>(null);

  useEffect(() => {
    const rain = new Audio('sounds/light-rain.mp3');
    rain.loop = true;
    rain.volume = 0;
    const thunder = new Audio('sounds/thunderstorm.mp3');
    thunder.volume = 0.5;
    audio.current = { rain, thunder, next: 0 };
    return () => {
      rain.pause();
      thunder.pause();
      audio.current = null;
    };
  }, []);

  useFrame((state, dt) => {
    const site = getCurrentSite();
    const t = state.clock.elapsedTime;
    const hour = getTimeOfDay(t);
    // l'aria bassa e umida (fondovalle, vicino al mare) tiene piu' nebbia
    const heightAboveSea = site.hN + state.camera.position.y;
    const low = 1 - Math.min(1, Math.max(0, (heightAboveSea - 30) / 90));
    updateWeather(site.planetSeed, hour, t, spaceState.alt, on, Math.min(dt, 0.1), 0.35 + 0.65 * low, Math.floor(t / DAY_CYCLE_SECONDS));
    if (!rainMounted && weather.rain > 0.05) setRainMounted(true);

    const a = audio.current;
    if (!a) return;
    const vol = on ? Math.min(0.5, weather.rain * 0.55) : 0;
    a.rain.volume = vol;
    if (vol > 0.01 && a.rain.paused) void a.rain.play().catch(() => {});
    else if (vol <= 0.005 && !a.rain.paused) a.rain.pause();
    // tuono: solo col temporale, ogni tanto
    if (weather.storm > 0.15 && t > a.next) {
      a.next = t + 14 + Math.random() * 24;
      window.setTimeout(() => {
        if (!audio.current) return;
        a.thunder.currentTime = Math.random() * 10;
        void a.thunder.play().catch(() => {});
        window.setTimeout(() => a.thunder.pause(), 5000);
      }, 400 + Math.random() * 1800);
    }
  });

  return rainMounted ? <WeatherRain /> : null;
};

export default Weather;
