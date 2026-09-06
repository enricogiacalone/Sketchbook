import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useStore } from '../../store';

// Real, always-on, genuinely positional video+audio for a billboard --
// this is what a cross-origin YouTube iframe can never fully deliver (see
// the git history on YouTubeBillboardScreen.tsx for the long, thoroughly
// tested list of reasons: no panning control in the YouTube API at all,
// and YouTube's own player refuses to honor a scripted unmute without a
// direct click on it, confirmed even with Chrome's autoplay restrictions
// fully disabled). A LOCAL mp4 file has none of those restrictions,
// because it's the same origin as the page itself:
//   - Its audio is routed through THREE.PositionalAudio via
//     `setMediaElementSource`, which is a genuine Web Audio PannerNode --
//     real stereo panning as you walk around the screen, not just a
//     volume fade.
//   - Same-origin autoplay-with-sound only needs the ONE standard
//     browser-wide gesture unlock (the "Enter Playground" click already
//     provides that -- see App.tsx's handleJoin), not a click on this
//     exact element.
//   - Play/pause syncs trivially with the game's pause state.
//
// The video's own frames are drawn straight into the 3D scene via a
// THREE.VideoTexture on a plane -- no drei <Html>/iframe/CSS-transform
// layer at all, so none of that sizing math applies here either.

let sharedListener: THREE.AudioListener | null = null;
function getSharedListener(camera: THREE.Camera): THREE.AudioListener {
  if (!sharedListener) sharedListener = new THREE.AudioListener();
  if (!camera.children.includes(sharedListener)) camera.add(sharedListener);
  return sharedListener;
}

interface VideoBillboardScreenProps {
  // Path under /public, e.g. "/videos/billboard-1.mp4".
  src: string;
  // Local position/size within the parent <group> -- same convention the
  // old YouTubeScreen used for localPosition, just a plane's width/height
  // now instead of a pxWidth/pxHeight + drei Html scale.
  localPosition: [number, number, number];
  width: number;
  height: number;
}

const VideoBillboardScreen: React.FC<VideoBillboardScreenProps> = ({ src, localPosition, width, height }) => {
  const { camera } = useThree();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const textureRef = useRef<THREE.VideoTexture | null>(null);
  const soundRef = useRef<THREE.PositionalAudio | null>(null);

  if (!videoRef.current) {
    const video = document.createElement('video');
    video.src = src;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    // NOT muted -- its actual audio is what we want, routed through the
    // Web Audio graph below rather than straight to the speakers, which
    // is what setMediaElementSource does to a media element by design
    // (it takes over the element's audio output).
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
    // createMediaElementSource can only ever be called ONCE for a given
    // <video> element, for the lifetime of that element -- calling it
    // again throws InvalidStateError, even to "reconnect" the exact same
    // pair, and there's no way to undo the binding. React 18 StrictMode's
    // dev-mode double-invoke (mount -> cleanup -> mount again) runs this
    // effect twice against the SAME video/sound instances (they're
    // created once, lazily, in the refs above -- StrictMode replays the
    // effect, not the component's initial render), which without this
    // guard threw on the second mount and crashed the whole <Canvas>
    // (confirmed live). Skipping the call when already bound makes both
    // the StrictMode replay and a real single mount safe.
    if (!boundRef.current) {
      sound.setMediaElementSource(video);
      boundRef.current = true;
    }
    if (!useStore.getState().isPaused) {
      video.play().catch(() => {
        // Autoplay-with-sound got refused (e.g. this mounted before the
        // player ever interacted with the page at all) -- fall back to
        // the standard one-time-unlock pattern: try again on the next
        // real gesture anywhere on the page.
        const retry = () => {
          video.play().catch(() => {});
          window.removeEventListener('pointerdown', retry);
          window.removeEventListener('keydown', retry);
        };
        window.addEventListener('pointerdown', retry, { once: true });
        window.addEventListener('keydown', retry, { once: true });
      });
    }
    return () => {
      video.pause();
      // Deliberately NOT clearing video.src or trying to unbind the
      // MediaElementSource here -- see the comment above; on a StrictMode
      // replay that would break the second mount, and on a real unmount
      // the whole video/sound pair just gets garbage-collected once the
      // refs are dropped. sound.disconnect() is fine to call any number
      // of times, unlike setMediaElementSource -- it just detaches this
      // node from the audio graph, it doesn't touch the one-time binding.
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
