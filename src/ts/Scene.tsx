import React, { Suspense } from 'react';
import EnemySpawner from './components/EnemySpawner';
import Airport, { HELIPORT_CENTER, RUNWAY_CENTER } from './components/Environment/Airport';
import BuildingLedGlow from './components/Environment/BuildingLedGlow';
import BuildingLeds from './components/Environment/BuildingLeds';
import City from './components/Environment/City';
import CityDetails from './components/Environment/CityDetails';
import CityFlags from './components/Environment/CityFlags';
import Clouds from './components/Environment/Clouds';
import Collectibles from './components/Environment/Collectibles';
import DuelArena from './components/Environment/DuelArena';
import MeteoriteSpawner from './components/Environment/MeteoriteSpawner';
import Park from './components/Environment/Park';
import { TreeBatches } from './components/Environment/ParkTrees';
import Planets from './components/Environment/Planets';
import PoliceWalkers from './components/Environment/PoliceWalkers';
import RaceTrack, { RACE_GRID, RACE_START_ROTATION, RACE_TRACK } from './components/Environment/RaceTrack';
import Road from './components/Environment/Road';
import Terrain from './components/Environment/Terrain';
import UFO from './components/Environment/UFO';
import MissionManager from './components/Missions/MissionManager';
import SoldierSpawner from './components/SoldierSpawner';
import Airplane from './components/Vehicles/Airplane'; // Import Airplane
import Car from './components/Vehicles/Car'; // Import Car
import FarCars from './components/Vehicles/FarCars';
import Helicopter from './components/Vehicles/Helicopter'; // Import Helicopter
import { useGLTF } from './lib/gltf';
import { useStore } from './store';

// Pre-caricamento intensivo
useGLTF.preload('car.glb');
useGLTF.preload('airplane.glb');
useGLTF.preload('heli.glb');

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

// "crea la polizia che gira in auto per la citta" -- two closed loops of
// real road-grid intersections (Road.tsx's ROAD_OFFSETS: -120/-60/0/60/120,
// spacing 60), so a straight line between consecutive waypoints always
// runs exactly along an actual road instead of cutting through a block.
// POLICE_ROUTE_INNER patrols one central block; POLICE_ROUTE_OUTER patrols
// the whole city's outer perimeter road, so the two together read as
// actual coverage rather than one car looping the same corner forever.
const POLICE_ROUTE_INNER: [number, number][] = [
  [-60, -60],
  [60, -60],
  [60, 60],
  [-60, 60],
];
const POLICE_ROUTE_OUTER: [number, number][] = [
  [-120, -120],
  [120, -120],
  [120, 120],
  [-120, 120],
];
const POLICE_ROUTE_WIDE: [number, number][] = [
  [-180, -180],
  [180, -180],
  [180, 180],
  [-180, 180],
];
const POLICE_ROUTE_CROSS1: [number, number][] = [
  [-120, 0],
  [0, 120],
  [120, 0],
  [0, -120],
];
const POLICE_ROUTE_CROSS2: [number, number][] = [
  [-180, -60],
  [60, -180],
  [180, 60],
  [-60, 180],
];

const Scene: React.FC = () => {
  const testScene = useStore((state) => state.testScene);
  const isCleanTest = testScene !== 'none';
  const isCarTest = testScene === 'car';
  const isRaceTest = testScene === 'race';
  const isDuelTest = testScene === 'duel';
  const duelRound = useStore((state) => state.duelRound);
  const showSimCitta = useStore((state) => state.showSimCitta);
  const showSkyAtmosphere = !isCleanTest || isRaceTest || isDuelTest;

  return (
    <>
      <Terrain />
      {isRaceTest && <RaceTrack />}
      {!isCleanTest && <Road />}
      {!isCleanTest && <PoliceWalkers />}
      {!isCleanTest && <CityFlags />}
      {(!isCleanTest || isDuelTest) && <Clouds />}
      <Planets />
      {showSkyAtmosphere && <UFO initialPosition={[0, 150, 0]} />}
      {showSkyAtmosphere && <MeteoriteSpawner />}
      {!isCleanTest && !DEBUG_DISABLE_CARS_AND_ENEMIES && !DEBUG_DISABLE_ENEMIES && <EnemySpawner />}
      {!isCleanTest && showSimCitta && <SoldierSpawner />}
      {/* Carichiamo i modelli in blocchi separati per non bloccare la fisica */}
      <Suspense fallback={null}>
        {!isCleanTest && !DEBUG_DISABLE_CARS_AND_ENEMIES && (
          <>
            {/* Spawn Y lowered from 5 -> 1.2 (Claude): with the old cannon-worker
                setup this height didn't matter -- the car's position was
                snapped analytically every frame, it never actually free-fell.
                Now that Car.tsx uses a real Rapier DynamicRayCastVehicleController,
                a ~4.5-unit fall builds up enough speed (~9m/s) that the wheel
                suspension (rest length 0.35, travel 1) can't always catch it
                within one raycast before the chassis tunnels straight through
                the terrain heightfield -- reproduced live: 5 of 6 cars fell
                through and kept falling forever, 1 happened to land. Spawning
                just above the terrain's max height variation (+/-0.5) plus
                road offset (~0.15) means the suspension only ever has to
                absorb a small drop, matching how a real raycast vehicle
                controller is meant to be used (see git history / chat, "cade
                oltre il terrain e sparisce"). */}
            <FarCars />
            <Car id="car-1" position={[10, 1.6, 0]} />
            <Car id="car-2" position={[60, 1.6, 0]} />
            <Car id="car-3" position={[0, 1.6, 60]} />
            <Car id="car-4" position={[-60, 1.6, 60]} />
            <Car id="car-5" position={[60, 1.6, 60]} />
            <Car id="car-6" position={[-60, 1.6, -60]} />

            {/* Police patrol cars */}
            <Car
              id="police-1"
              position={[POLICE_ROUTE_INNER[0][0], 1.6, POLICE_ROUTE_INNER[0][1]]}
              rotation={[0, Math.PI / 2, 0]}
              patrolRoute={POLICE_ROUTE_INNER}
            />
            <Car
              id="police-2"
              position={[POLICE_ROUTE_OUTER[0][0], 1.6, POLICE_ROUTE_OUTER[0][1]]}
              rotation={[0, Math.PI / 2, 0]}
              patrolRoute={POLICE_ROUTE_OUTER}
            />
            <Car
              id="police-3"
              position={[POLICE_ROUTE_WIDE[0][0], 1.6, POLICE_ROUTE_WIDE[0][1]]}
              rotation={[0, Math.PI / 2, 0]}
              patrolRoute={POLICE_ROUTE_WIDE}
            />
            <Car
              id="police-4"
              position={[POLICE_ROUTE_CROSS1[0][0], 1.6, POLICE_ROUTE_CROSS1[0][1]]}
              rotation={[0, Math.PI / 2, 0]}
              patrolRoute={POLICE_ROUTE_CROSS1}
            />
            <Car
              id="police-5"
              position={[POLICE_ROUTE_CROSS2[0][0], 1.6, POLICE_ROUTE_CROSS2[0][1]]}
              rotation={[0, Math.PI / 2, 0]}
              patrolRoute={POLICE_ROUTE_CROSS2}
            />
          </>
        )}

        {/* Airplane/Helicopter stay mounted through their OWN clean test
            scenarios and in the normal world (unlike the city cars above) --
            both scenari ('Test Volo: Aereo' and 'Test Volo: Elicottero')
            need to be reachable without an unmount/remount, and their pads
            (see Airport.tsx) are already far enough apart that the other
            vehicle sitting idle at its own pad isn't the kind of
            "distrazione" being asked to go away here. Hidden specifically
            during the CAR test scenario, though -- that one's about testing
            the car in isolation, so it gets the same "just this vehicle"
            treatment. Spawn on their own pad instead of the old, somewhat
            arbitrary in-city coordinates -- same drop height as before (a
            short fall onto a plain CuboidCollider, proven safe for both,
            unlike the raycast-suspension cars). */}
        {!isCarTest && !isRaceTest && (isCleanTest || !DEBUG_DISABLE_CARS_AND_ENEMIES) && (
          <>
            <Airplane position={[RUNWAY_CENTER[0], 5, RUNWAY_CENTER[1]]} />
            <Helicopter position={[HELIPORT_CENTER[0], 20, HELIPORT_CENTER[1]]} />
          </>
        )}

        {/* "Test volo: Macchina (pulito)" scenario -- a single test car,
            spawned at car-1's own known-good coordinates (already proven
            safe: flat enough terrain for the raycast suspension to catch it
            on the first drop, see the comment above), with none of the
            other 7 city/police cars around to get in the way or confuse
            which one is actually being driven. */}
        {isCarTest && <Car id="test-car-1" position={[10, 1.6, 0]} />}

        {/* "una gara contro 3 poliziotti in un percorso con curve e dossi" --
            the player's own racer plus 3 AI police, all on RaceTrack.tsx's
            starting grid. The 3 cops reuse the existing patrolRoute AI
            (Car.tsx) unchanged -- same system as the city's 2 patrol cars --
            just given the race track's waypoints instead of a city block. */}
        {isRaceTest && (
          <>
            <Car id="race-player" position={RACE_GRID.player} rotation={RACE_START_ROTATION} />
            <Car id="race-cop-1" position={RACE_GRID.cop1} rotation={RACE_START_ROTATION} patrolRoute={RACE_TRACK} />
            <Car id="race-cop-2" position={RACE_GRID.cop2} rotation={RACE_START_ROTATION} patrolRoute={RACE_TRACK} />
            <Car id="race-cop-3" position={RACE_GRID.cop3} rotation={RACE_START_ROTATION} patrolRoute={RACE_TRACK} />
          </>
        )}

        {/* "siamo io che controllo un combat soldier contro un altro
            combat soldier" -- exactly two fighters, face to face, on
            their own quiet patch of terrain (see DuelArena.tsx). */}
        {/* key=duelRound: a fresh key on retry unmounts this whole
            fight (dead player, dead AI, ragdolls, everything) and mounts
            a brand new one -- the simplest correct way to "restart the
            match" given DuelArena.tsx builds its FighterData once via
            useMemo(..., []). */}
        {isDuelTest && <DuelArena key={duelRound} />}
      </Suspense>
      <Airport />
      {!isCleanTest && (
        <Suspense fallback={null}>
          <City />
          <BuildingLeds />
          <BuildingLedGlow />
          <Park />
          <TreeBatches />
          <CityDetails />
          <Collectibles />
          <MissionManager />
        </Suspense>
      )}
    </>
  );
};

export default Scene;
