import React, { Suspense, useState, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import Scene from "./Scene";
import Sky from "./components/Environment/Sky";
import SunLight from "./components/Environment/SunLight";
import WorldFog from "./components/Environment/WorldFog";
import NightSky from "./components/Environment/NightSky";
import StreetLampGlow from "./components/Environment/StreetLampGlow";
import Ocean from "./components/Environment/Ocean";
import StatusBars from "./components/UI/StatusBars";
import CollectiblesCounter from "./components/UI/CollectiblesCounter";
import MissionHUD from "./components/UI/MissionHUD";
import Controls from "./components/UI/Controls";
import GithubCorner from "./components/UI/GithubCorner";
import WelcomeScreen from "./components/UI/WelcomeScreen";
import LoadingScreen from "./components/UI/LoadingScreen";
import ChatInput from "./components/UI/ChatInput";
import Minimap from "./components/UI/Minimap";
import Crosshair from "./components/UI/Crosshair";
import GamepadDebug from "./components/UI/GamepadDebug";
import ScenariosGUI from "./components/UI/ScenariosGUI";
import Loader from "./components/UI/Loader"; // Helper to track loading
import Player from "./components/Player"; // Import Player directly to pass userName
import ThirdPersonCamera from "./components/ThirdPersonCamera";
import { useStore } from "./store";
import { useShallow } from "zustand/react/shallow";
import * as THREE from "three";

const App: React.FC = () => {
  const [isJoined, setIsJoined] = useState(false);
  const [userName, setUserName] = useState("");
  const { isLoading, setIsLoading, isPaused, setPaused } = useStore(
    useShallow((state) => ({
      isLoading: state.isLoading,
      setIsLoading: state.setIsLoading,
      isPaused: state.isPaused,
      setPaused: state.setPaused,
    }))
  );

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
    if (!params.has("autojoin")) return null;
    return params.get("autojoin") || "Claude";
  }, []);

  const handleJoin = (name: string, controlMethod: string) => {
    setUserName(name);
    setIsJoined(true);
    setIsLoading(true); // Start showing loader while Suspense does its thing
    console.log(`Joined as ${name} with ${controlMethod}`);
    // Unlocks the shared Web Audio context (used by every billboard's
    // THREE.PositionalAudio, and its underlying <video> elements) from
    // inside this real, same-origin click -- browsers only need this ONE
    // gesture per page for same-origin audio/video autoplay-with-sound,
    // unlike a cross-origin embed which needs a gesture on that exact
    // element every time. See VideoBillboardScreen.tsx.
    // three's own .d.ts mistypes getContext()'s return as the wrapper
    // class instead of the native AudioContext (its own JSDoc says
    // Window.AudioContext) -- cast to reach the real .resume().
    (THREE.AudioContext.getContext() as unknown as globalThis.AudioContext)
      .resume()
      .catch(() => {});
  };

  useEffect(() => {
    if (!autoJoinName || isJoined) return;
    (window as any).__disableAutoPause = true;
    (window as any).__forceTimeOfDay = 12;
    handleJoin(autoJoinName, "keyboard");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoJoinName]);

  // Auto-pause when the tab is backgrounded. This isn't just a nicety: a
  // hidden tab gets requestAnimationFrame throttled by the browser (down to
  // a handful of frames a minute in the worst case), so whatever real
  // wall-clock time passed while away shows up as one huge catch-up
  // delta/physics burst the moment the tab comes back -- confirmed live as
  // the player appearing to "pop up out of the floor" right after
  // switching back to the tab (Rapier's fixed-timestep accumulator clamps
  // any single frame to 0.5s and then runs dozens of physics substeps back
  // to back to catch up, which is enough for the falling/landing sequence
  // to visibly glitch through the floor collider before it settles).
  // Pausing on hidden and requiring an explicit Start/Escape to resume
  // (rather than auto-resuming on visible) avoids that burst entirely and
  // matches how most games handle losing focus.
  //
  // Previously skipped in dev builds so switching to devtools/another app
  // while developing wouldn't pause the game every time -- but that's
  // exactly the gap that let real tab-switch testing hit this bug, so it
  // now applies in dev too. Our own browser-automation testing can resume
  // manually via `useStore.getState().setPaused(false)` if a background
  // tab switch pauses it mid-test.
  // TEMP DEBUG (Claude): browser-automation testing legitimately switches
  // desktop Spaces/windows mid-test (a real player tab-switch doesn't), and
  // this fires the exact same auto-pause every time, freezing the sim for
  // any script driving the page from outside. window.__disableAutoPause
  // lets a test session opt out from the console (`window.__disableAutoPause
  // = true`) without touching the real behavior real players get.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && !(window as any).__disableAutoPause)
        setPaused(true);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [setPaused]);

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#111" }}>
      {/* Show WelcomeScreen if not joined */}
      {!isJoined && !autoJoinName && <WelcomeScreen onJoin={handleJoin} />}

      {/* Show LoadingScreen if joined but still loading assets */}
      {isJoined && isLoading && <LoadingScreen />}

      {/* The game scene */}
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        camera={{ position: [5, 5, 5], fov: 50 }}
        // Cap the device pixel ratio -- with no dpr set, R3F defaults to
        // window.devicePixelRatio (2+ on Retina Macs), which is 4x the
        // fragment-shader work of dpr=1 on every single frame.
        dpr={[1, 2]}
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
            <Ocean />
            {/* Real sun-linked directional light + hemisphere ambient --
                "sistemiamo il cielo... sole vero collegato alla luce".
                Replaces the old fixed pointLight + flat ambientLight(0.5),
                neither of which ever changed even though the sky dome
                above them was already running a full day/night cycle.
                Also drops drei's <Environment preset="city"> -- that was
                a generic indoor-studio HDRI reflected on every metallic/
                glass surface (buildings, cars) with zero relation to this
                procedural sky, most noticeable on glass towers reflecting
                a "city" that isn't the one around them. */}
            <SunLight />
            <StreetLampGlow />

            {/*
              Migrated from @react-three/cannon to @react-three/rapier.
              Rapier's default (and what we use here) steps physics
              synchronously on the main thread inside a useFrame callback
              ("follow" updateLoop) -- no Web Worker, no postMessage
              serialization boundary. That boundary is what made cannon's
              RaycastVehicle (engine force, suspension, wheel transforms)
              a no-op in this app: verified live that the worker-side
              vehicle registers and steps every frame, but its effects
              never reliably reached the chassis body. See Car.tsx for the
              real vehicle controller this migration unlocks.

              Friction/restitution used to be set globally via
              defaultContactMaterial/contactMaterials (cannon). Rapier sets
              these per RigidBody/Collider instead -- see each body's own
              friction/restitution props (e.g. Player.tsx's capsule).
            */}
            <Physics
              gravity={[0, -20, 0]}
              // Matches cannon's old `iterations` (solver iterations/step).
              numSolverIterations={15}
              // Matches cannon's old `stepSize` (fixed physics tick rate).
              timeStep={1 / 120}
              // Stops the physics world from stepping at all -- see
              // isPaused's comment in store.ts for why Player.tsx/Car.tsx/
              // Airplane.tsx/Helicopter.tsx also each need their own
              // explicit pause check on top of this.
              paused={isPaused}
            >
              {/* Scene contains the world environment */}
              <Scene />
              {/* Player needs userName for network identification */}
              <Player userName={userName} />
            </Physics>

            <ThirdPersonCamera />
            <Loader />
          </Suspense>
        )}
      </Canvas>

      {/* UI Overlays */}
      {isJoined && !isLoading && (
        <div
          id="ui-layer"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              pointerEvents: "auto",
              position: "absolute",
              top: 20,
              left: 20,
              color: "white",
            }}
          >
            <h1 className="sb-font" style={{ fontSize: 32, margin: 0 }}>
              Sketchbook
            </h1>
            <div style={{ fontSize: 14 }}>Welcome, {userName}!</div>
          </div>
          <Controls />
          <StatusBars />
          <CollectiblesCounter />
          <MissionHUD />
          <ChatInput />
          <Minimap />
          <Crosshair />
          <GamepadDebug />
          <ScenariosGUI />
          {isPaused && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0,0,0,0.5)",
                color: "white",
                textAlign: "center",
              }}
            >
              <div>
                <h1 className="sb-font" style={{ fontSize: 48, margin: 0 }}>
                  Pausa
                </h1>
                <div style={{ fontSize: 16, opacity: 0.85 }}>
                  Premi Start (o Esc) per riprendere
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default App;
