import React, { Suspense, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Physics, Debug } from "@react-three/cannon";
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
import Loader from "./components/UI/Loader"; // Helper to track loading
import Player from "./components/Player"; // Import Player directly to pass userName
import ThirdPersonCamera from "./components/ThirdPersonCamera";
import { useStore } from "./store";
import { useShallow } from "zustand/react/shallow";
import * as THREE from "three";

const App: React.FC = () => {
  const [isJoined, setIsJoined] = useState(false);
  const [userName, setUserName] = useState("");
  const { isLoading, setIsLoading } = useStore(
    useShallow((state) => ({ isLoading: state.isLoading, setIsLoading: state.setIsLoading }))
  );

  const handleJoin = (name: string, controlMethod: string) => {
    setUserName(name);
    setIsJoined(true);
    setIsLoading(true); // Start showing loader while Suspense does its thing
    console.log(`Joined as ${name} with ${controlMethod}`);
  };

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

            <Physics
              gravity={[0, -20, 0]}
              tolerance={0.0001}
              // Dynamic bodies (idle enemies, parked cars, spent bullets)
              // can now go to sleep instead of being solved every step even
              // at rest. Characters/vehicles set velocity directly every
              // frame, which still reads as "at rest" once that velocity is
              // ~0, so they sleep and wake normally with input.
              allowSleep={true}
              // Was 30 (3x cannon-es's own default of 10) -- brought down
              // to still be extra-stable versus the default without paying
              // 3x the per-step solver cost on every dynamic body.
              iterations={15}
              stepSize={1 / 120}
              // Was left at the library default (10). If a frame stalls for
              // any reason, the physics step "catches up" by running extra
              // sub-steps in the very next tick -- with the default of 10,
              // that could mean up to 10 full solver passes crammed into a
              // single JS tick, turning a small stall into a much bigger,
              // very visible one. Capping this bounds how bad that
              // amplification can get; physics just falls slightly behind
              // real time for a few frames instead of front-loading all the
              // catch-up work into one.
              maxSubSteps={4}
              defaultContactMaterial={{
                friction: 0.7,
                restitution: 0,
                contactEquationStiffness: 1e8,
                contactEquationRelaxation: 3,
              }}
              contactMaterials={[
                {
                  friction: 0, // Zero friction for the player on ground to avoid sticking to slopes
                  restitution: 0,
                  materialA: "slippery",
                  materialB: "ground",
                }
              ]}
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
        </div>
      )}
    </div>
  );
};

export default App;
