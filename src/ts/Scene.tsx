import React, { Suspense } from "react";
import { useGLTF } from "@react-three/drei";
import { usePlane } from "@react-three/cannon";
import * as THREE from "three";
import Grass from "./components/Environment/Grass";
import Ocean from "./components/Environment/Ocean";
import Trees from "./components/Environment/Trees";
import Terrain from "./components/Environment/Terrain";
import Road from "./components/Environment/Road";
import City from "./components/Environment/City";
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
        <Car id="car-1" position={[10, 5, 0]} />
        <Car id="car-2" position={[60, 5, 0]} />
        <Car id="car-3" position={[0, 5, 60]} />
        <Car id="car-4" position={[-60, 5, 60]} />
        <Car id="car-5" position={[60, 5, 60]} />
        <Car id="car-6" position={[-60, 5, -60]} />
        
        <Airplane />
        <Helicopter />
      </Suspense>

      <Suspense fallback={null}>
        <City />
      </Suspense>
    </>
  );
};

export default Scene;
