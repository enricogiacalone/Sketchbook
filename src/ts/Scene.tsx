import React, { Suspense } from "react";
import { useGLTF } from "@react-three/drei";
import { usePlane } from "@react-three/cannon";
import * as THREE from "three";
import Grass from "./components/Environment/Grass";
import Ocean from "./components/Environment/Ocean";
import Trees from "./components/Environment/Trees";
import Terrain from "./components/Environment/Terrain";
import Road from "./components/Environment/Road";
import Village from "./components/Environment/Village";
import Clouds from "./components/Environment/Clouds";
import UFO from "./components/Environment/UFO";
import MeteoriteSpawner from "./components/Environment/MeteoriteSpawner";
import EnemySpawner from "./components/EnemySpawner";
import Car from "./components/Vehicles/Car"; // Import Car
import Airplane from "./components/Vehicles/Airplane"; // Import Airplane
import Helicopter from "./components/Vehicles/Helicopter"; // Import Helicopter

// Pre-caricamento intensivo
useGLTF.preload("car.glb");
useGLTF.preload("airplane.glb");
useGLTF.preload("heli.glb");
useGLTF.preload("boxman.glb");

const Scene: React.FC = () => {
  return (
    <>
      <Terrain />
      <Road />
      <Clouds />
      <Ocean />
      <UFO initialPosition={[0, 150, 0]} />
      <MeteoriteSpawner />
      <EnemySpawner />

      {/* Carichiamo i modelli in blocchi separati per non bloccare la fisica */}
      <Suspense fallback={null}>
        <Car />
        <Airplane />
        <Helicopter />
      </Suspense>

      <Suspense fallback={null}>
        <Village />
      </Suspense>

      <Suspense fallback={null}>
        <Grass />
        <Trees />
      </Suspense>
    </>
  );
};

export default Scene;
