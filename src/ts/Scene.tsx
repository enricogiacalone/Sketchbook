import React, { Suspense } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import Grass from "./components/Environment/Grass";
import Ocean from "./components/Environment/Ocean";
import Trees from "./components/Environment/Trees";
import Terrain from "./components/Environment/Terrain";
import Road from "./components/Environment/Road";
import City from "./components/Environment/City";
import Park from "./components/Environment/Park";
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

// DEBUG: temporarily stripped cars/vehicles/enemies out of the scene to
// isolate the periodic stutter -- it turned out to be MeteoriteSpawner's
// Explosion effect (huge per-frame allocation burst + needless per-frame
// React state, see Explosion.tsx), unrelated to any of these. Back to false
// now that the real cause is fixed; flip true again only if the stutter
// reappears and needs re-isolating.
const DEBUG_DISABLE_CARS_AND_ENEMIES = false;
// Enemies off for now (asked separately from the cars/vehicles toggle
// above) while testing movement/ground feel without them getting in the
// way. Flip back to true to bring them back.
const DEBUG_DISABLE_ENEMIES = true;

const Scene: React.FC = () => {
  return (
    <>
      <Terrain />
      <Road />
      <Clouds />
      <Ocean />
      <UFO initialPosition={[0, 150, 0]} />
      <MeteoriteSpawner />
      {!DEBUG_DISABLE_CARS_AND_ENEMIES && !DEBUG_DISABLE_ENEMIES && <EnemySpawner />}

      {/* Carichiamo i modelli in blocchi separati per non bloccare la fisica */}
      <Suspense fallback={null}>
        {!DEBUG_DISABLE_CARS_AND_ENEMIES && (
          <>
            <Car id="car-1" position={[10, 5, 0]} />
            <Car id="car-2" position={[60, 5, 0]} />
            <Car id="car-3" position={[0, 5, 60]} />
            <Car id="car-4" position={[-60, 5, 60]} />
            <Car id="car-5" position={[60, 5, 60]} />
            <Car id="car-6" position={[-60, 5, -60]} />
          </>
        )}

        {!DEBUG_DISABLE_CARS_AND_ENEMIES && (
          <>
            <Airplane />
            <Helicopter />
          </>
        )}
      </Suspense>

      <Suspense fallback={null}>
        <City />
        <Park />
      </Suspense>
    </>
  );
};

export default Scene;
