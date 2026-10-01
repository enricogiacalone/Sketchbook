import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { acquireAudioListener, releaseAudioListener } from '../../../lib/sharedAudioListener';
import {
  KNIFE_MODEL_URL,
  KNIFE_LENGTH_M,
  KNIFE_GRIP_FROM_REAR,
  KNIFE_GRIP_FROM_BOTTOM,
  KNIFE_TIP_FROM_BOTTOM,
} from './weaponConfig';

// Baionetta M9 (enari-engine, vedi weaponConfig) nella mano destra.
// Frame del coltello: origine al centro del manico, -Z = punta, +Y = filo.
// Punto di partenza per le pose Sword_* del personaggio, da ritoccare dal
// pannello "Coltello (presa)".
// Presa "in avanti" misurata dal vivo: nell'osso hand_r +Y va verso le dita
// e +Z esce dal lato del pollice (come l'impugnatura della pistola, che
// scende verso -Z) -> lama lungo +Z della mano, filo verso le dita.
export const knifeHoldTuning = {
  px: 0.0,
  py: 0.07,
  pz: 0.0,
  rx: 0,
  ry: 180,
  rz: 0,
};

export interface KnifeModelApi {
  setVisible: (v: boolean) => void;
  // punta e meta' lama in coordinate mondo: i due punti di contatto del colpo
  getTipWorld: (out: THREE.Vector3) => THREE.Vector3;
  getMidBladeWorld: (out: THREE.Vector3) => THREE.Vector3;
  playSwing: () => void;
  playHit: () => void;
  update: () => void;
}

// Suoni sintetizzati (nessun file): fruscio del fendente = rumore filtrato
// con un inviluppo a campana; colpo = tonfo grave + schiocco breve.
function makeSwingBuffer(ctx: BaseAudioContext): AudioBuffer {
  const dur = 0.28, n = Math.floor(ctx.sampleRate * dur);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const env = Math.sin(Math.PI * Math.pow(t, 0.7)) ** 2;
    // passa-basso che si apre e si chiude: "fsshh"
    const a = 0.08 + 0.35 * env;
    lp += a * ((Math.random() * 2 - 1) - lp);
    d[i] = lp * env * 1.6;
  }
  return b;
}
function makeHitBuffer(ctx: BaseAudioContext): AudioBuffer {
  const dur = 0.22, n = Math.floor(ctx.sampleRate * dur);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const t = i / ctx.sampleRate;
    const thump = Math.sin(2 * Math.PI * (95 - 40 * t / dur) * t) * Math.exp(-t * 22);
    const snap = (Math.random() * 2 - 1) * Math.exp(-t * 90) * 0.6;
    d[i] = (thump * 0.9 + snap) * 0.9;
  }
  return b;
}

export function useKnifeModel(modelRootRef: React.RefObject<THREE.Object3D | null>, handBoneName = 'hand_r'): KnifeModelApi {
  const { scene } = useGLTF(KNIFE_MODEL_URL);

  const parts = useMemo(() => {
    const inner = scene.clone(true);
    inner.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
      }
    });
    inner.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(inner);
    const size = box.getSize(new THREE.Vector3());
    const scale = KNIFE_LENGTH_M / Math.max(1e-6, size.z);
    const cx = (box.min.x + box.max.x) / 2;
    const grip = new THREE.Vector3(cx, box.min.y + KNIFE_GRIP_FROM_BOTTOM * size.y, box.max.z - KNIFE_GRIP_FROM_REAR * size.z);
    const frame = new THREE.Group();
    frame.name = 'knife-frame';
    inner.scale.setScalar(scale);
    inner.position.copy(grip).multiplyScalar(-scale);
    frame.add(inner);
    const tip = new THREE.Object3D();
    tip.position.set(cx, box.min.y + KNIFE_TIP_FROM_BOTTOM * size.y, box.min.z).sub(grip).multiplyScalar(scale);
    frame.add(tip);
    const mid = new THREE.Object3D();
    mid.position.copy(tip.position).multiplyScalar(0.5);
    frame.add(mid);
    const holder = new THREE.Group();
    holder.name = 'knife-holder';
    holder.add(frame);
    holder.visible = false;
    return { holder, tip, mid };
  }, [scene]);

  const { camera } = useThree();
  const soundRef = useRef<{ swing: THREE.PositionalAudio[]; hit: THREE.PositionalAudio; next: number } | null>(null);
  useEffect(() => {
    const listener = acquireAudioListener(camera);
    const mk = (vol: number, buf: AudioBuffer) => {
      const a = new THREE.PositionalAudio(listener);
      a.setRefDistance(2.5);
      a.setVolume(vol);
      a.setBuffer(buf);
      parts.tip.add(a);
      return a;
    };
    const swingBuf = makeSwingBuffer(listener.context);
    const hitBuf = makeHitBuffer(listener.context);
    const swing = [0, 1].map(() => mk(0.55, swingBuf));
    const hit = mk(0.9, hitBuf);
    soundRef.current = { swing, hit, next: 0 };
    return () => {
      for (const a of [...swing, hit]) {
        if (a.isPlaying) a.stop();
        a.parent?.remove(a);
      }
      soundRef.current = null;
      releaseAudioListener();
    };
  }, [camera, parts]);

  useEffect(() => {
    let raf = 0;
    const tryAttach = () => {
      const bone = modelRootRef.current?.getObjectByName(handBoneName);
      if (!bone) {
        raf = requestAnimationFrame(tryAttach);
        return;
      }
      bone.add(parts.holder);
    };
    tryAttach();
    return () => {
      cancelAnimationFrame(raf);
      parts.holder.parent?.remove(parts.holder);
    };
  }, [modelRootRef, handBoneName, parts]);

  const play = (a: THREE.PositionalAudio | undefined, detune: number) => {
    if (!a || !a.buffer) return;
    if (a.context.state !== 'running') a.context.resume().catch(() => {});
    if (a.isPlaying) a.stop();
    a.setDetune(detune);
    a.play();
  };

  return useMemo<KnifeModelApi>(
    () => ({
      setVisible: (v) => {
        parts.holder.visible = v;
      },
      getTipWorld: (out) => {
        parts.tip.updateWorldMatrix(true, false);
        return out.setFromMatrixPosition(parts.tip.matrixWorld);
      },
      getMidBladeWorld: (out) => {
        parts.mid.updateWorldMatrix(true, false);
        return out.setFromMatrixPosition(parts.mid.matrixWorld);
      },
      playSwing: () => {
        const s = soundRef.current;
        if (!s) return;
        play(s.swing[s.next], (Math.random() * 2 - 1) * 200);
        s.next = (s.next + 1) % s.swing.length;
      },
      playHit: () => play(soundRef.current?.hit, (Math.random() * 2 - 1) * 100),
      update: () => {
        const t = knifeHoldTuning;
        parts.holder.position.set(t.px, t.py, t.pz);
        parts.holder.rotation.set(THREE.MathUtils.degToRad(t.rx), THREE.MathUtils.degToRad(t.ry), THREE.MathUtils.degToRad(t.rz));
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parts]
  );
}

useGLTF.preload(KNIFE_MODEL_URL);
