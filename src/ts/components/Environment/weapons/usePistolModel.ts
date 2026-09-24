import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { acquireAudioListener, releaseAudioListener } from '../../../lib/sharedAudioListener';
import { SkeletonUtils } from 'three-stdlib';
import {
  PISTOL_MODEL_URL,
  PISTOL_LENGTH_M,
  PISTOL_GRIP_FROM_REAR,
  PISTOL_GRIP_FROM_BOTTOM,
  PISTOL_BORE_FROM_TOP,
  PISTOL_SLIDE_KICK_M,
  PISTOL_SLIDE_RETURN_S,
  PISTOL_SHOT_SOUND_URL,
  PISTOL_RELOAD_SOUND_URL,
  PISTOL_RELOAD_SOUND_OFFSET_S,
  PISTOL_SOUND_REF_DISTANCE,
  PISTOL_SHOT_VOLUME,
  PISTOL_RELOAD_VOLUME,
  RELOAD_MAG_OUT_END,
  RELOAD_MAG_IN_START,
  RELOAD_MAG_IN_END,
  RELOAD_SLIDE_START,
  RELOAD_SLIDE_END,
} from './weaponConfig';

// Come la pistola sta nella mano destra (osso hand_r): posizione (m) e
// rotazione (gradi, XYZ) del "frame arma" (origine = impugnatura, -Z =
// canna, +Y = sopra) nel frame dell'osso. Tarata dal vivo sulle pose
// Pistol_* del personaggio; modificabile dal pannello "Pistola".
export const pistolHoldTuning = {
  // misurati dal vivo: canna parallela alla linea di mira in
  // Pistol_Aim_Neutral, impugnatura a ~60% tra polso e nocche
  px: 0.0,
  py: 0.071,
  pz: 0.012,
  rx: 78,
  ry: -21.9,
  rz: 10.6,
};

export interface PistolModelApi {
  setVisible: (v: boolean) => void;
  getMuzzleWorld: (out: THREE.Vector3) => THREE.Vector3;
  getBoreDirWorld: (out: THREE.Vector3) => THREE.Vector3;
  kick: () => void;
  // 0..1 durante la ricarica (caricatore giu' e su), null altrimenti
  setReloadProgress: (p: number | null) => void;
  // suoni posizionali 3D (dalla canna / dall'arma)
  playShot: () => void;
  playReload: () => void;
  stopReload: () => void;
  update: (delta: number) => void;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export function usePistolModel(
  modelRootRef: React.RefObject<THREE.Object3D | null>,
  handBoneName = 'hand_r'
): PistolModelApi {
  const { scene } = useGLTF(PISTOL_MODEL_URL);

  const parts = useMemo(() => {
    const inner = SkeletonUtils.clone(scene) as THREE.Object3D;
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
    const scale = PISTOL_LENGTH_M / Math.max(1e-6, size.z);
    const grip = new THREE.Vector3(
      (box.min.x + box.max.x) / 2,
      box.min.y + PISTOL_GRIP_FROM_BOTTOM * size.y,
      box.max.z - PISTOL_GRIP_FROM_REAR * size.z
    );
    const muzzleLocal = new THREE.Vector3(
      (box.min.x + box.max.x) / 2,
      box.max.y - PISTOL_BORE_FROM_TOP * size.y,
      box.min.z
    );
    // frame arma: origine all'impugnatura, stesse direzioni del modello
    const gunFrame = new THREE.Group();
    gunFrame.name = 'pistol-frame';
    inner.scale.setScalar(scale);
    inner.position.copy(grip).multiplyScalar(-scale);
    gunFrame.add(inner);
    const muzzle = new THREE.Object3D();
    muzzle.name = 'pistol-muzzle';
    muzzle.position.copy(muzzleLocal).sub(grip).multiplyScalar(scale);
    gunFrame.add(muzzle);
    const holder = new THREE.Group();
    holder.name = 'pistol-holder';
    holder.add(gunFrame);
    holder.visible = false;
    let slide: THREE.Object3D | null = null;
    let mag: THREE.Object3D | null = null;
    inner.traverse((o) => {
      if (o.name === 'UP') slide = o;
      if (o.name === 'MAG') mag = o;
    });
    return {
      holder,
      gunFrame,
      muzzle,
      slide: slide as THREE.Object3D | null,
      mag: mag as THREE.Object3D | null,
      slideRest: (slide as THREE.Object3D | null)?.position.clone() ?? new THREE.Vector3(),
      magRest: (mag as THREE.Object3D | null)?.position.clone() ?? new THREE.Vector3(),
    };
  }, [scene]);

  const slideOffsetRef = useRef(0); // m, verso il retro

  // --- suoni -------------------------------------------------------------
  // 4 voci per lo sparo (colpi ravvicinati si sovrappongono invece di
  // tagliarsi), 1 per la ricarica. Buffer caricati una volta; se i file
  // mancano (non sono in git, vedi public/weapon-sounds/PROVENIENZA.txt)
  // l'arma resta semplicemente muta.
  const { camera } = useThree();
  const soundRef = useRef<{ shots: THREE.PositionalAudio[]; next: number; reload: THREE.PositionalAudio } | null>(null);
  useEffect(() => {
    const listener = acquireAudioListener(camera);
    const mk = (parent: THREE.Object3D, vol: number) => {
      const a = new THREE.PositionalAudio(listener);
      a.setRefDistance(PISTOL_SOUND_REF_DISTANCE);
      a.setRolloffFactor(1);
      a.setVolume(vol);
      parent.add(a);
      return a;
    };
    const shots = [0, 1, 2, 3].map(() => mk(parts.muzzle, PISTOL_SHOT_VOLUME));
    const reload = mk(parts.gunFrame, PISTOL_RELOAD_VOLUME);
    soundRef.current = { shots, next: 0, reload };
    let alive = true;
    const loader = new THREE.AudioLoader();
    loader.load(
      PISTOL_SHOT_SOUND_URL,
      (buf) => alive && shots.forEach((a) => a.setBuffer(buf)),
      undefined,
      () => console.warn('[pistola] suono di sparo non trovato:', PISTOL_SHOT_SOUND_URL)
    );
    loader.load(
      PISTOL_RELOAD_SOUND_URL,
      (buf) => alive && reload.setBuffer(buf),
      undefined,
      () => console.warn('[pistola] suono di ricarica non trovato:', PISTOL_RELOAD_SOUND_URL)
    );
    return () => {
      alive = false;
      for (const a of [...shots, reload]) {
        if (a.isPlaying) a.stop();
        a.parent?.remove(a);
      }
      soundRef.current = null;
      releaseAudioListener();
    };
  }, [camera, parts]);
  const reloadRef = useRef<number | null>(null);

  // Aggancio all'osso della mano (appena il modello del personaggio c'e').
  useEffect(() => {
    let raf = 0;
    const tryAttach = () => {
      const root = modelRootRef.current;
      const bone = root?.getObjectByName(handBoneName);
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

  // Sposta un nodo del modello di `meters` lungo un asse del frame arma
  // (in coordinate mondo), convertendo nello spazio del suo genitore.
  const offsetAlongGunAxis = (node: THREE.Object3D, rest: THREE.Vector3, axis: THREE.Vector3, meters: number) => {
    node.position.copy(rest);
    if (Math.abs(meters) < 1e-6 || !node.parent) return;
    node.parent.updateWorldMatrix(true, false);
    parts.gunFrame.updateWorldMatrix(true, false);
    _a.set(0, 0, 0).applyMatrix4(parts.gunFrame.matrixWorld);
    _b.copy(axis).multiplyScalar(meters).applyMatrix4(parts.gunFrame.matrixWorld);
    node.parent.worldToLocal(_a);
    node.parent.worldToLocal(_b);
    node.position.add(_b.sub(_a));
  };
  const BACK = new THREE.Vector3(0, 0, 1);
  const DOWN = new THREE.Vector3(0, -1, 0);

  return useMemo<PistolModelApi>(
    () => ({
      setVisible: (v) => {
        parts.holder.visible = v;
      },
      getMuzzleWorld: (out) => {
        parts.muzzle.updateWorldMatrix(true, false);
        return out.setFromMatrixPosition(parts.muzzle.matrixWorld);
      },
      getBoreDirWorld: (out) => {
        parts.gunFrame.updateWorldMatrix(true, false);
        return out.set(0, 0, -1).transformDirection(parts.gunFrame.matrixWorld);
      },
      kick: () => {
        slideOffsetRef.current = PISTOL_SLIDE_KICK_M;
      },
      setReloadProgress: (p) => {
        reloadRef.current = p;
      },
      playShot: () => {
        const snd = soundRef.current;
        if (!snd) return;
        const a = snd.shots[snd.next];
        snd.next = (snd.next + 1) % snd.shots.length;
        if (!a.buffer) return;
        if (a.context.state !== 'running') a.context.resume().catch(() => {});
        if (a.isPlaying) a.stop();
        // piccola variazione di tono a ogni colpo
        a.setDetune((Math.random() * 2 - 1) * 60);
        a.play();
      },
      playReload: () => {
        const a = soundRef.current?.reload;
        if (!a || !a.buffer) return;
        if (a.isPlaying) a.stop();
        a.offset = PISTOL_RELOAD_SOUND_OFFSET_S;
        a.play();
      },
      stopReload: () => {
        const a = soundRef.current?.reload;
        if (a?.isPlaying) a.stop();
      },
      update: (delta) => {
        const t = pistolHoldTuning;
        parts.holder.position.set(t.px, t.py, t.pz);
        parts.holder.rotation.set(
          THREE.MathUtils.degToRad(t.rx),
          THREE.MathUtils.degToRad(t.ry),
          THREE.MathUtils.degToRad(t.rz)
        );
        if (!parts.holder.visible) return;
        slideOffsetRef.current = Math.max(0, slideOffsetRef.current - (PISTOL_SLIDE_KICK_M / PISTOL_SLIDE_RETURN_S) * delta);
        const p = reloadRef.current;
        // ricarica a tempo col suono (fasi in weaponConfig): caricatore
        // fuori -> dentro, poi carrello tirato indietro e rilasciato
        let rack = 0;
        if (p !== null && p >= RELOAD_SLIDE_START && p < RELOAD_SLIDE_END) {
          const k = (p - RELOAD_SLIDE_START) / (RELOAD_SLIDE_END - RELOAD_SLIDE_START);
          rack = (k < 0.6 ? k / 0.6 : 1 - (k - 0.6) / 0.4) * PISTOL_SLIDE_KICK_M * 1.5;
        }
        if (parts.slide) offsetAlongGunAxis(parts.slide, parts.slideRest, BACK, Math.max(slideOffsetRef.current, rack));
        if (parts.mag) {
          let drop = 0;
          if (p !== null) {
            if (p < RELOAD_MAG_OUT_END) drop = p / RELOAD_MAG_OUT_END;
            else if (p < RELOAD_MAG_IN_START) drop = 1;
            else if (p < RELOAD_MAG_IN_END) drop = 1 - (p - RELOAD_MAG_IN_START) / (RELOAD_MAG_IN_END - RELOAD_MAG_IN_START);
          }
          offsetAlongGunAxis(parts.mag, parts.magRest, DOWN, drop * 0.14);
        }
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parts]
  );
}

useGLTF.preload(PISTOL_MODEL_URL);
