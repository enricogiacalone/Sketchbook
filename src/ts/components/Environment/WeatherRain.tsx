import React, { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { createCollisionHeight } from './weather/collisionHeight';
import { createCollisionRain } from './weather/collisionRain';
import { weather } from '../../lib/weather';

// La pioggia del meteo dei pianeti: la stessa pioggia a collisione della modalita' zombi (ZombieRain.tsx, gocce che si fermano su
// tetti, alberi e suolo) ma con intensita' e quantita' di gocce che seguono `weather.rain`. Si crea una volta (la prima pioggia)
// e poi si spegne/riaccende senza ricostruire: da spenta non costa niente (niente mappa delle altezze, niente calcolo).
const WeatherRain: React.FC = () => {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const sim = React.useRef<{ height: any; rain: any } | null>(null);
  const enabled = React.useRef(false);
  const frame = React.useRef(0);

  useEffect(() => {
    let dead = false;
    let created: { height: any; rain: any } | null = null;
    (async () => {
      const height = (createCollisionHeight as any)({ scene, renderer: gl });
      const rain = await (createCollisionRain as any)({ scene, renderer: gl, collisionHeight: height, camera });
      if (dead) {
        rain.dispose();
        height.dispose();
        return;
      }
      rain.setEnabled(false);
      created = { height, rain };
      sim.current = created;
      if (import.meta.env.DEV) (window as any).__weatherRain = created;
    })();
    return () => {
      dead = true;
      sim.current = null;
      if (created) {
        created.rain.dispose();
        created.height.dispose();
        camera.layers.disable(created.rain.layer);
      }
      if (import.meta.env.DEV) delete (window as any).__weatherRain;
    };
  }, [gl, scene, camera]);

  // prima del render (ToonOutline: priorita' 1)
  useFrame((state, delta) => {
    const s = sim.current;
    if (!s) return;
    const on = weather.rain > 0.04;
    if (on !== enabled.current) {
      enabled.current = on;
      s.rain.setEnabled(on);
    }
    if (!on) return;
    // pioggerella: poche gocce chiare; temporale: tante e piu' visibili
    s.rain.setIntensity(0.25 + 0.55 * weather.rain);
    s.rain.setDropCount(900 + 3100 * weather.rain);
    // la mappa delle altezze (rifa' la scena dall'alto) a frame alterni: la pioggia non se ne accorge e costa la meta'
    if ((frame.current++ & 1) === 0) s.height.update({ camera: state.camera });
    s.rain.update(delta, state.camera);
  }, 0);

  return null;
};

export default WeatherRain;
