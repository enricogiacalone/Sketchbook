import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from '../../store';

// "WebGPU e' piu' performante?" -- misurato sul gioco (M4, schermo a 60 Hz):
// il processore lavora ~3.5 ms a frame (render 1.8 + fisica 0.9) e le
// chiamate di disegno sono poche (225), quindi il vantaggio di WebGPU (meno
// costo per chiamata) qui non serve. Il carico vero e' la scheda video, che
// cresce con i pixel: la leva e' la risoluzione, come in
// ektogamat/threejs-conference (platform/adaptiveDpr.js), che pero' scende
// una volta sola e non risale piu'. Qui scende a gradini quando si perdono
// davvero dei frame e riprova a salire dopo un po' (attese sempre piu'
// lunghe se il tentativo fallisce).
//
// Perche' gli fps e non il tempo della scheda video (timer query): provato,
// sui Mac la GPU abbassa la frequenza quando ha poco da fare e il tempo
// misurato "si allarga" (11 ms sia a dpr 2 sia a 1.5): abbassava la
// risoluzione senza motivo.

const SLOW_MS = 18.5; // frame medio oltre questo (sotto ~54 fps) = lento
const WINDOW_S = 1; // finestra di misura
const WARMUP_S = 3; // all'avvio (compilazione shader, caricamenti) non si misura
const SLOW_WINDOWS = 2; // finestre lente di fila prima di scendere
const STEP = 0.25;
const MIN_DPR = 0.75;
const RAISE_WAIT_S = 10; // secondi buoni prima di riprovare a salire...
const RAISE_WAIT_MAX_S = 160; // ...raddoppiati a ogni tentativo fallito
const RAISE_PROBATION_S = 5; // se entro questo torna lento, la salita era sbagliata

const maxDpr = () => Math.min(window.devicePixelRatio || 1, 2);

// letto dal pannello Grafica (solo da mostrare)
export const adaptiveResInfo = { dpr: 0, fps: 0 };

const AdaptiveResolution: React.FC = () => {
  const enabled = useStore((s) => s.adaptiveResolution);
  const setRenderDpr = useStore((s) => s.setRenderDpr);

  const st = useRef({
    lastNow: 0,
    t: 0,
    windowStart: 0,
    frameSum: 0,
    frameN: 0,
    slowWindows: 0,
    goodSince: 0,
    raiseWait: RAISE_WAIT_S,
    lastRaise: null as null | { from: number; at: number },
    lastDrop: null as null | { from: number; at: number; frameMs: number },
    // abbassare non aveva aiutato: il freno e' il processore, non i pixel
    cpuBound: false,
    dpr: 2,
  });

  useEffect(() => {
    const s = st.current;
    s.dpr = maxDpr();
    s.t = s.windowStart = s.goodSince = 0;
    s.frameSum = s.frameN = s.slowWindows = 0;
    s.raiseWait = RAISE_WAIT_S;
    s.lastRaise = s.lastDrop = null;
    s.cpuBound = false;
    adaptiveResInfo.dpr = s.dpr;
    setRenderDpr(enabled ? s.dpr : null);
    if (import.meta.env.DEV) (window as any).__adaptiveRes = adaptiveResInfo;
    return () => setRenderDpr(null);
  }, [enabled, setRenderDpr]);

  const apply = (next: number) => {
    const s = st.current;
    s.dpr = Math.min(maxDpr(), Math.max(MIN_DPR, next));
    adaptiveResInfo.dpr = s.dpr;
    setRenderDpr(s.dpr);
    // la finestra dopo un cambio non conta (ridimensionamento dei buffer)
    s.windowStart = s.t + WINDOW_S;
    s.frameSum = s.frameN = s.slowWindows = 0;
    s.goodSince = s.t + WINDOW_S;
  };

  useFrame(() => {
    if (!enabled) return;
    const s = st.current;
    // tempo vero tra i frame: il delta di R3F qui non lo e' (misurato: 12-15
    // ms a frame con lo schermo fermo a 16.7)
    const now = performance.now() / 1000;
    const delta = s.lastNow ? now - s.lastNow : 0;
    s.lastNow = now;
    s.t += delta;
    // finestra nascosta, pausa lunga o caricamento: si ricomincia da capo
    if (document.hidden || delta > 0.25 || s.t < WARMUP_S) {
      s.windowStart = s.goodSince = s.t;
      s.frameSum = s.frameN = 0;
      return;
    }
    if (s.t < s.windowStart) return;
    s.frameSum += Math.min(delta, 0.05) * 1000;
    s.frameN++;
    if (s.t - s.windowStart < WINDOW_S) return;

    const frameMs = s.frameSum / s.frameN;
    s.windowStart = s.t;
    s.frameSum = s.frameN = 0;
    adaptiveResInfo.fps = Math.round(1000 / frameMs);

    if (frameMs > SLOW_MS) {
      s.goodSince = s.t;
      if (++s.slowWindows < SLOW_WINDOWS) return;
      const lr = s.lastRaise;
      const ld = s.lastDrop;
      if (lr && s.t - lr.at < RAISE_PROBATION_S + SLOW_WINDOWS * WINDOW_S) {
        // la salita appena fatta non regge: si torna giu' e si aspetta di piu'
        s.raiseWait = Math.min(RAISE_WAIT_MAX_S, s.raiseWait * 2);
        s.lastRaise = null;
        apply(lr.from);
      } else if (ld && s.t - ld.at < SLOW_WINDOWS * WINDOW_S + 0.5 && frameMs > ld.frameMs * 0.95) {
        // meno pixel e niente di meglio: la colpa non e' della scheda video,
        // si rimette la nitidezza di prima e non si scende piu' finche' non
        // torna fluido
        s.lastDrop = null;
        s.cpuBound = true;
        apply(ld.from);
      } else if (!s.cpuBound && s.dpr > MIN_DPR + 1e-3) {
        s.lastRaise = null;
        s.lastDrop = { from: s.dpr, at: s.t + WINDOW_S, frameMs };
        apply(s.dpr - STEP);
      }
      return;
    }
    s.slowWindows = 0;
    s.cpuBound = false;
    s.lastDrop = null;
    if (s.lastRaise && s.t - s.lastRaise.at > RAISE_PROBATION_S + SLOW_WINDOWS * WINDOW_S) {
      s.lastRaise = null; // salita riuscita
      s.raiseWait = RAISE_WAIT_S;
    }
    if (s.dpr < maxDpr() - 1e-3 && s.t - s.goodSince >= s.raiseWait) {
      s.lastRaise = { from: s.dpr, at: s.t + WINDOW_S };
      apply(s.dpr + STEP);
    }
  });

  return null;
};

export default AdaptiveResolution;
