import { Canvas } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import React, { Suspense, useEffect, useState } from 'react';
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { useShallow } from 'zustand/react/shallow';
import Scene from './Scene';
import CityPlayer from './components/CityPlayer';
import Drone from './components/Drone';
import AdaptiveResolution from './components/Environment/AdaptiveResolution';
import { DUEL_PLAYER_ID } from './components/Environment/DuelArena';
import NightSky from './components/Environment/NightSky';
import RagdollPhysicsDebugBridge from './components/Environment/RagdollPhysicsDebugBridge';
import Sky from './components/Environment/Sky';
import StreetLampGlow from './components/Environment/StreetLampGlow';
import SunLight from './components/Environment/SunLight';
import ToonStyle from './components/Environment/ToonStyle';
import WorldFog from './components/Environment/WorldFog';
import ThirdPersonCamera from './components/ThirdPersonCamera';
import ChatInput from './components/UI/ChatInput';
import CollectiblesCounter from './components/UI/CollectiblesCounter';
import CombatArenaGUI from './components/UI/CombatArenaGUI';
import Controls from './components/UI/Controls';
import Crosshair from './components/UI/Crosshair';
import DroneHUD from './components/UI/DroneHUD';
import DuelHUD from './components/UI/DuelHUD';
import GamepadDebug from './components/UI/GamepadDebug';
import GraphicsGUI from './components/UI/GraphicsGUI';
import Loader from './components/UI/Loader'; // Helper to track loading
import LoadingScreen from './components/UI/LoadingScreen';
import MissionHUD from './components/UI/MissionHUD';
import RagdollBenchGUI from './components/UI/RagdollBenchGUI';
import RagdollBenchOverlay from './components/UI/RagdollBenchOverlay';
import ScenariosGUI from './components/UI/ScenariosGUI';
import StatusBars from './components/UI/StatusBars';
import WeaponHUD from './components/UI/WeaponHUD';
import WeaponWheel from './components/UI/WeaponWheel';
import WelcomeScreen from './components/UI/WelcomeScreen';
import { useStore } from './store';
import Ocean from './components/Environment/Ocean';
import { motionBricksManager } from './lib/motionBricksRuntime';
import MotionBricksHUD from './components/UI/MotionBricksHUD';
const FlyLab = React.lazy(() => import('./flyLab/FlyLab'));

const App: React.FC = () => {
  const [isJoined, setIsJoined] = useState(false);
  // "Laboratorio cervello mosca" (WelcomeScreen): scena a parte, vedi src/ts/flyLab
  const [labMode, setLabMode] = useState(false);
  const [userName, setUserName] = useState('');
  const { isLoading, setIsLoading, isPaused, setPaused, testScene, showGameplayHud } = useStore(
    useShallow((state) => ({
      isLoading: state.isLoading,
      setIsLoading: state.setIsLoading,
      isPaused: state.isPaused,
      setPaused: state.setPaused,
      testScene: state.testScene,
      showGameplayHud: state.showGameplayHud,
    }))
  );
  const renderDpr = useStore((state) => state.renderDpr);

  // TEMP DEBUG (Claude) turned permanent test convenience: joining used to
  // mean clicking through WelcomeScreen (type a name, click "Enter
  // Playground") by hand for every single browser-automation test session
  // -- "sistemati la login in modo da nn doverla fare per ogni test che
  // fai". Visiting with ?autojoin (optionally ?autojoin=SomeName) skips
  // straight past WelcomeScreen and also pre-arms the two other things
  // every test session was manually setting via the console right after
  // joining anyway (window.__disableAutoPause, window.__forceTimeOfDay --
  // see App.tsx's visibilitychange handler / lib/SunCycle.ts). Dev-only
  // (import.meta.env.DEV): a real deployed build ignores this query param
  // entirely and always shows WelcomeScreen normally.
  const autoJoinName = React.useMemo(() => {
    if (!import.meta.env.DEV) return null;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('autojoin')) return null;
    return params.get('autojoin') || 'Claude';
  }, []);

  const handleJoin = (name: string, controlMethod: string, mode: 'world' | 'duel' | 'flylab' = 'world') => {
    if (mode === 'flylab') {
      // laboratorio: niente mondo di gioco, niente caricamento del gioco
      setUserName(name);
      setLabMode(true);
      return;
    }
    setUserName(name);
    setIsJoined(true);
    setIsLoading(true); // Start showing loader while Suspense does its thing
    console.log(`Joined as ${name} with ${controlMethod} (${mode})`);
    // "crea una sezione dedicata nel menu di avvio del gioco che mi fa
    // entrare in un'arena, siamo io che controllo un combat soldier
    // contro un altro combat soldier" -- WelcomeScreen's "Duello 1v1"
    // button routes here. Same store calls DuelArena.tsx's own mount
    // effect makes (belt-and-suspenders, in case a future entry point
    // skips WelcomeScreen entirely): testScene='duel' makes Scene.tsx
    // mount DuelArena.tsx instead of the normal city, and
    // setCurrentControllable hands the camera/input over to the duel's
    // player fighter (see useThirdPersonCamera.ts's isFootController).
    if (mode === 'duel') {
      useStore.getState().setTestScene('duel');
      useStore.getState().setCurrentControllable('combatSoldier', DUEL_PLAYER_ID);
    }
    // Unlocks the shared Web Audio context (used by every billboard's
    // THREE.PositionalAudio, and its underlying <video> elements) from
    // inside this real, same-origin click -- browsers only need this ONE
    // gesture per page for same-origin audio/video autoplay-with-sound,
    // unlike a cross-origin embed which needs a gesture on that exact
    // element every time. See VideoBillboardScreen.tsx.
    // three's own .d.ts mistypes getContext()'s return as the wrapper
    // class instead of the native AudioContext (its own JSDoc says
    // Window.AudioContext) -- cast to reach the real .resume().
    (THREE.AudioContext.getContext() as unknown as globalThis.AudioContext).resume().catch(() => {});
  };

  useEffect(() => {
    if (!autoJoinName || isJoined) return;
    (window as any).__disableAutoPause = true;
    (window as any).__forceTimeOfDay = 12;
    handleJoin(autoJoinName, 'keyboard');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoJoinName]);

  useEffect(() => {
    motionBricksManager.initialize().then(() => {
      motionBricksManager.setStyle('victory');
      const testFrame = motionBricksManager.planMotion({
        style: 'victory',
        movementDirection: [0, 0, 1],
        facingDirection: [0, 0, 1],
        targetSpeed: 1.0,
      });
      console.log('[MotionBricks Test] Live test plan result:', testFrame);
    });
    return () => {
      motionBricksManager.dispose();
    };
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && !(window as any).__disableAutoPause) setPaused(true);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [setPaused]);

  if (labMode) {
    return (
      <Suspense fallback={<div style={{ color: '#aaa', padding: 20 }}>carico il laboratorio...</div>}>
        <FlyLab onExit={() => setLabMode(false)} />
      </Suspense>
    );
  }

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#111' }}>
      {/* Show WelcomeScreen if not joined */}
      {!isJoined && !autoJoinName && <WelcomeScreen onJoin={handleJoin} />}

      {/* Show LoadingScreen if joined but still loading assets */}
      {isJoined && isLoading && <LoadingScreen />}

      {/* The game scene */}
      <Canvas
        gl={(props: any) => {
          const canvasElement =
            props.canvas instanceof HTMLCanvasElement
              ? props.canvas
              : props instanceof HTMLCanvasElement
                ? props
                : props.canvas || props.domElement || (props.getState && props.getState().gl?.domElement);

          const renderer = new WebGPURenderer({ canvas: canvasElement, antialias: true }) as any;
          renderer.init().catch((err: any) => {
            console.warn('WebGPU renderer initialization skipped (headless/unsupported environment):', err);
          });
          const origRender = renderer.render.bind(renderer);
          renderer.render = function (scene: any, camera: any) {
            if (this._initialized) {
              origRender(scene, camera);
            }
          };
          return renderer;
        }}
        shadows={{ type: THREE.PCFShadowMap }}
        camera={{ position: [5, 5, 5], fov: 50 }}
        // Cap the device pixel ratio -- with no dpr set, R3F defaults to
        // window.devicePixelRatio (2+ on Retina Macs), which is 4x the
        // fragment-shader work of dpr=1 on every single frame.
        // (con la risoluzione adattiva la sceglie AdaptiveResolution)
        dpr={renderDpr ?? [1, 2]}
        // TEMP DEBUG (Claude): expose the r3f root state (gl/scene/camera)
        // for live console profiling while chasing the perf complaints.
        // Dev-only, no-op in production builds.
        onCreated={(state) => {
          if (import.meta.env.DEV) {
            (window as any).__r3fState = state;
          }
        }}
      >
        {isJoined && (
          <Suspense fallback={null}>
            <Sky />
            <NightSky />
            <WorldFog />
            {/* <Ocean /> */}
            <SunLight />
            <ToonStyle />
            <AdaptiveResolution />
            <StreetLampGlow />
            <Physics gravity={[0, -9.81, 0]}>
              <Scene />
              <RagdollPhysicsDebugBridge />
              <CityPlayer userName={userName} />
              <Drone />
            </Physics>
            <ThirdPersonCamera />
          </Suspense>
        )}
      </Canvas>

      <CombatArenaGUI />
      <Crosshair />
      <DroneHUD />
      <DuelHUD />
      <GraphicsGUI />
      <ScenariosGUI />
      <WeaponWheel />
      <RagdollBenchGUI />
      <WeaponHUD />
      <RagdollBenchOverlay />
      {isJoined && <MotionBricksHUD />}

      {/* UI overlays */}
      {isJoined && showGameplayHud && (
        <>
          <CollectiblesCounter />
          <Controls />
          <ChatInput />
          <GamepadDebug />
          <MissionHUD />
          <StatusBars />
        </>
      )}

      {/* Dev helper to track loading progress */}
      <Loader />
    </div>
  );
};

export default App;
