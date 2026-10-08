import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';

// "pausa deve mettere tutto in pausa": prima la pausa fermava solo il mondo
// fisico (<Physics paused>) e i pochi componenti che controllavano
// isPaused a mano (auto, aerei, drone...); tutto il resto -- folla,
// animazioni, ragdoll, esplosioni, bandiere, nemici -- continuava a girare
// perche' i loro useFrame venivano chiamati lo stesso. Qui si ferma il
// ciclo dei frame di R3F per intero: nessun useFrame gira, il canvas resta
// sull'ultima immagine (sotto il velo "Pausa"), e anche l'audio si ferma.
// Alla ripresa il primo frame riparte con un delta piccolo, come se la
// pausa non ci fosse stata (niente salto di tempo nelle simulazioni).
const GameFreeze: React.FC = () => {
  const isPaused = useStore((s) => s.isPaused);
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);
  const size = useThree((s) => s.size);

  useEffect(() => {
    if (!isPaused) return;
    const st = get();
    st.internal.active = false;
    const ctx = THREE.AudioContext.getContext() as unknown as AudioContext;
    const wasRunning = ctx.state === 'running';
    if (wasRunning) ctx.suspend().catch(() => {});
    return () => {
      const s2 = get();
      // il tempo passato in pausa non conta
      (s2.clock as any).oldTime = performance.now();
      s2.internal.active = true;
      invalidate();
      if (wasRunning) ctx.resume().catch(() => {});
    };
  }, [isPaused, get, invalidate]);

  // finestra ridimensionata durante la pausa: il canvas si svuota, si
  // ridisegna l'ultima scena senza far girare nulla
  useEffect(() => {
    if (!isPaused) return;
    const id = requestAnimationFrame(() => {
      const st = get();
      st.gl.render(st.scene, st.camera);
    });
    return () => cancelAnimationFrame(id);
  }, [isPaused, size, get]);

  // Esc / Start del pad: fuori dal ciclo dei frame, se no a gioco fermo
  // non si potrebbe piu' riprendere
  useEffect(() => {
    const toggle = () => {
      const st = useStore.getState();
      st.setPaused(!st.isPaused);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && !e.repeat) toggle();
    };
    window.addEventListener('keydown', onKey);
    let wasDown = false;
    let raf = 0;
    const poll = () => {
      raf = requestAnimationFrame(poll);
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let down = false;
      for (const p of pads) if (p?.buttons[9]?.pressed) down = true;
      if (down && !wasDown) toggle();
      wasDown = down;
    };
    raf = requestAnimationFrame(poll);
    return () => {
      window.removeEventListener('keydown', onKey);
      cancelAnimationFrame(raf);
    };
  }, []);

  return null;
};

export default GameFreeze;
