import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useStore } from '../../store';

// Real, always-on, genuinely positional video+audio for a billboard -- see
// the git history on YouTubeBillboardScreen.tsx for why a cross-origin
// YouTube iframe can never fully deliver this (no panning in the API at
// all, and YouTube's own player refuses a scripted unmute without a click
// directly on it). A LOCAL mp4 file has none of those restrictions:
//   - Its audio is routed through THREE.PositionalAudio via
//     `setMediaElementSource`, a genuine Web Audio PannerNode -- real
//     stereo panning as you walk around the screen, not just a fade.
//   - Same-origin autoplay-with-sound only needs the ONE standard
//     browser-wide gesture unlock (the "Enter Playground" click already
//     provides that -- see App.tsx's handleJoin).
//   - Play/pause syncs trivially with the game's pause state.
//
// The video's own frames go straight into the 3D scene via a
// THREE.VideoTexture on a plane -- no drei <Html>/iframe layer at all.

let sharedListener: THREE.AudioListener | null = null;
function getSharedListener(camera: THREE.Camera): THREE.AudioListener {
  if (!sharedListener) sharedListener = new THREE.AudioListener();
  if (!camera.children.includes(sharedListener)) camera.add(sharedListener);
  return sharedListener;
}

interface VideoBillboardScreenProps {
  // Path under /public, e.g. "/videos/billboard-1.mp4".
  src: string;
  localPosition: [number, number, number];
  width: number;
  height: number;
}

const VideoBillboardScreen: React.FC<VideoBillboardScreenProps> = ({ src, localPosition, width, height }) => {
  const { camera } = useThree();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const textureRef = useRef<THREE.VideoTexture | null>(null);
  const soundRef = useRef<THREE.PositionalAudio | null>(null);

  // Lazy, ref-backed initializers -- created exactly ONCE per component
  // instance, immune to React 18 StrictMode's dev-only double-invoke of
  // effects (mount -> cleanup -> mount again). This runs during render,
  // not inside an effect, so the second render after a double-invoke sees
  // `ref.current` already set and skips creating a new object.
  //
  // Getting this wrong (creating the video/texture inside a useEffect
  // instead) is exactly what caused "the video shows but is frozen on the
  // first frame": StrictMode mounts the creating effect, tears it down,
  // then mounts it again -- ending up with the on-screen texture still
  // reading from the FIRST (now-paused, discarded) video element while a
  // second, live one plays invisibly underneath it, never advancing what
  // you actually see.
  if (!videoRef.current) {
    const video = document.createElement('video');
    video.src = src;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    // NOT muted -- its real audio is what we want, routed through the Web
    // Audio graph below (setMediaElementSource takes over the element's
    // audio output by design, so this is safe even though it's unmuted).
    video.muted = false;
    videoRef.current = video;

    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    textureRef.current = texture;
  }

  if (!soundRef.current) {
    const listener = getSharedListener(camera);
    const sound = new THREE.PositionalAudio(listener);
    sound.setRefDistance(8);
    sound.setRolloffFactor(1.5);
    sound.setDistanceModel('inverse');
    sound.setMaxDistance(45);
    soundRef.current = sound;
  }

  const boundRef = useRef(false);
  useEffect(() => {
    const video = videoRef.current!;
    const sound = soundRef.current!;
    // createMediaElementSource can only ever be called ONCE per element --
    // the boundRef guard keeps StrictMode's double-invoke from calling it
    // twice on the same (persisted) video, which throws InvalidStateError.
    if (!boundRef.current) {
      sound.setMediaElementSource(video);
      boundRef.current = true;
    }

    const tryPlay = () => {
      if (useStore.getState().isPaused) return;
      video.play().catch(() => {
        // Autoplay-with-sound got refused (e.g. mounted before the player
        // ever interacted with the page) -- retry on the next real
        // gesture anywhere on the page.
        const retry = () => {
          video.play().catch(() => {});
          window.removeEventListener('pointerdown', retry);
          window.removeEventListener('keydown', retry);
        };
        window.addEventListener('pointerdown', retry, { once: true });
        window.addEventListener('keydown', retry, { once: true });
      });
    };
    tryPlay();

    return () => {
      video.pause();
      sound.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Solo se metto pausa metto tutto in pausa anche i video e la musica" --
  // native <video> play()/pause() is trivial and always available for
  // same-origin content, no gesture games needed.
  const isPaused = useStore((state) => state.isPaused);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isPaused) video.pause();
    else video.play().catch(() => {});
  }, [isPaused]);

  return (
    <>
      <mesh position={localPosition}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={textureRef.current ?? undefined} toneMapped={false} />
      </mesh>
      <primitive object={soundRef.current} position={localPosition} />
    </>
  );
};

export default VideoBillboardScreen;
