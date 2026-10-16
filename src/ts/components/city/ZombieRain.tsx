import React, { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { createCollisionHeight, HEIGHT_MAP_FLIP } from '../Environment/weather/collisionHeight';
import { createCollisionRain } from '../Environment/weather/collisionRain';

// Pioggia della modalita' zombi notturna: la pioggia a collisione portata da
// threejs-conference (Environment/weather/): le gocce si fermano su tetti,
// auto, alberi e terreno, con schizzi sul suolo. Va montata solo quando la
// modalita' e' accesa.
const ZombieRain: React.FC = () => {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const sim = React.useRef<{ height: any; rain: any } | null>(null);

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
      created = { height, rain };
      sim.current = created;
      if (import.meta.env.DEV) (window as any).__rain = { height, rain, flip: HEIGHT_MAP_FLIP };
    })();
    return () => {
      dead = true;
      sim.current = null;
      if (created) {
        created.rain.dispose();
        created.height.dispose();
        camera.layers.disable(created.rain.layer);
      }
      if (import.meta.env.DEV) delete (window as any).__rain;
    };
  }, [gl, scene, camera]);

  // prima del render (ToonOutline: priorita' 1): mappa delle altezze, poi la simulazione
  useFrame((state, delta) => {
    const s = sim.current;
    if (!s) return;
    s.height.update({ camera: state.camera });
    s.rain.update(delta, state.camera);
  }, 0);

  return null;
};

export default ZombieRain;
