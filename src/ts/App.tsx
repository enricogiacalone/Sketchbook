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
import { useStore } from "./store";
import * as THREE from "three";

const App: React.FC = () => {
  const [isJoined, setIsJoined] = useState(false);
  const [userName, setUserName] = useState("");
  const { isLoading, setIsLoading } = useStore();

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
      >
        {isJoined && (
          <Suspense fallback={null}>
            <Sky />
            <Ocean />
            <Environment preset="city" />
            <ambientLight intensity={0.5} />
            <pointLight position={[10, 10, 10]} castShadow />

            <Physics
              gravity={[0, -9.81, 0]}
              tolerance={0.0001}
              allowSleep={false}
              iterations={30}
              stepSize={1 / 120}
              defaultContactMaterial={{
                friction: 0.1,
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
