// Meteo dei pianeti: pioggia e nebbia mattutina. Stato condiviso (`weather`), aggiornato ogni frame da
// components/Environment/Weather.tsx; lo leggono la nebbia (WorldFog), il sole (SunLight), la pioggia (WeatherRain), l'audio
// (AmbientSounds) e gli abitanti dei villaggi (VillageFolk: con la pioggia forte stanno in casa).
//
// - Pioggia: una "perturbazione" ogni ~7 min di gioco, con inizio e durata dal seme del pianeta (rumore a gradini morbidi):
//   circa un terzo del tempo piove, con intensita' diverse (pioggerella .. temporale).
// - Nebbia mattutina: tra le 5 e le 10 (picco 6-8), piu' fitta dove l'aria e' bassa e umida (quota < 60 m, vicino all'acqua),
//   e piu' o meno forte da un mattino all'altro.
// - Tutto sfuma con la quota (niente meteo nello spazio) e si spegne con la casella spenta (store.weatherOn).
import { hashKey } from './globalGrid';

export const weather = {
  rain: 0, // 0..1 intensita' della pioggia (smussata)
  storm: 0, // 0..1 quanto e' temporale (tuoni)
  morningFog: 0, // 0..1 nebbia mattutina
  // moltiplicatori per chi disegna: densita' della nebbia, luce del sole, quanto il cielo/nebbia vira al grigio
  fogMul: 1,
  sunMul: 1,
  grey: 0,
};

const PERIOD_S = 420; // secondi di gioco tra l'inizio di una perturbazione e la successiva
const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// pioggia "bersaglio" al tempo t (s) per il pianeta `seed`: 0 asciutto .. 1 temporale
export function rainTarget(seed: number, t: number): number {
  const k = Math.floor(t / PERIOD_S);
  const f = (t - k * PERIOD_S) / PERIOD_S; // 0..1 nel periodo
  const start = 0.1 + hashKey(k, 1, seed) * 0.5;
  const len = 0.18 + hashKey(k, 2, seed) * 0.3; // 18-48% del periodo
  const power = hashKey(k, 3, seed);
  const happens = hashKey(k, 4, seed) < 0.72; // non tutti i periodi hanno pioggia
  if (!happens) return 0;
  const rise = smooth(start, start + 0.05, f), fall = 1 - smooth(start + len - 0.06, start + len, f);
  return Math.min(rise, fall) * (0.25 + 0.75 * power);
}

// nebbia del mattino per ora del giorno (0..24) e giorno (per la forza)
export function morningFogAt(seed: number, hour: number, day: number): number {
  const bump = smooth(4.8, 6.4, hour) * (1 - smooth(8.2, 10.2, hour));
  const strength = 0.35 + 0.65 * hashKey(day, 5, seed);
  return bump * strength;
}

let rainSmooth = 0;
// aggiorna `weather`: seed, ora (SunCycle), tempo di gioco, quota (m sulla superficie), acceso/spento, dt
export function updateWeather(seed: number, hour: number, t: number, alt: number, on: boolean, dt: number, lowGround: number, day = 0) {
  const air = on ? 1 - smooth(300, 1800, alt) : 0; // sfuma salendo
  let target = on ? rainTarget(seed, t) * air : 0;
  // prove dal vivo (solo dev): window.__forceRain = 0..1, window.__forceFog = 0..1
  const w = typeof window !== 'undefined' ? (window as any) : null;
  if (import.meta.env.DEV && w && on && typeof w.__forceRain === 'number') target = w.__forceRain * air;
  rainSmooth += (target - rainSmooth) * Math.min(1, dt * 0.25); // ~4 s per cambiare
  weather.rain = rainSmooth < 0.01 ? 0 : rainSmooth;
  weather.storm = Math.max(0, (weather.rain - 0.62) / 0.38);
  weather.morningFog = on ? morningFogAt(seed, hour, day) * air * lowGround : 0;
  if (import.meta.env.DEV && w && on && typeof w.__forceFog === 'number') weather.morningFog = w.__forceFog * air;
  const r = weather.rain, m = weather.morningFog;
  weather.fogMul = 1 + 2.2 * r + 4.5 * m;
  weather.sunMul = 1 - 0.55 * r - 0.25 * m;
  weather.grey = Math.min(1, 0.7 * r + 0.45 * m);
}
