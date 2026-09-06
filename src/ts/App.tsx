import React, { Suspense, useState, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { Environment } from "@react-three/drei";
import Scene from "./Scene";
import Sky from "./components/Environment/Sky";
import Ocean from "./components/Environment/Ocean";
import StatusBars from "./components/UI/StatusBars";
import Controls from "./components/UI/Controls";
import GithubCorner from "./components/UI/GithubCorner";
import WelcomeScreen from "./components/UI/WelcomeScreen";
import LoadingScreen from "./components/UI/LoadingScreen";
import ChatInput from "./components/UI/ChatInput";
import Minimap from "./components/UI/Minimap";
import Crosshair from "./components/UI/Crosshair";
import GamepadDebug from "./components/UI/GamepadDebug";
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

  const handleJoin = (name: string, controlMethod: string) => {
    setUserName(name);
    setIsJoined(true);
    setIsLoading(true); // Start showing loader while Suspense does its thing
    console.log(`Joined as ${name} with ${controlMethod}`);
  };

  // Auto-pause when the tab is backgrounded. This isn't just a nicety: a
  // hidden tab gets requestAnimationFrame throttled by the browser (down to
  // a handful of frames a minute in the worst case, confirmed while
  // debugging this app's own automated test tooling), so whatever real
  // wall-clock time passed while away shows up as one huge catch-up
  // delta/physics burst the moment the tab comes back -- cars and the
  // player can end up flung across the map. Pausing on hidden and requiring
  // an explicit Start/Escape to resume (rather than auto-resuming on
  // visible) avoids that burst entirely and matches how most games handle
  // losing focus.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) setPaused(true);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [setPaused]);

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#111" }}>
      {/* Show WelcomeScreen if not joined */}
      {!isJoined && <WelcomeScreen onJoin={handleJoin} />}

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
            <Ocean />
            <Environment preset="city" />
            <ambientLight intensity={0.5} />
            <pointLight position={[10, 10, 10]} castShadow />

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
          <ChatInput />
          <Minimap />
          <Crosshair />
          <GamepadDebug />
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
