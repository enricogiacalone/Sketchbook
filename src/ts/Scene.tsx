import React, { Suspense } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import Ocean from "./components/Environment/Ocean";
import Trees from "./components/Environment/Trees";
import Terrain from "./components/Environment/Terrain";
import Road from "./components/Environment/Road";
import City from "./components/Environment/City";
import Park from "./components/Environment/Park";
import CityDetails from "./components/Environment/CityDetails";
import Collectibles from "./components/Environment/Collectibles";
import BuildingLeds from "./components/Environment/BuildingLeds";
import BuildingLedGlow from "./components/Environment/BuildingLedGlow";
import Airport, { RUNWAY_CENTER, HELIPORT_CENTER } from "./components/Environment/Airport";
import RaceTrack, { RACE_GRID, RACE_START_ROTATION, RACE_TRACK } from "./components/Environment/RaceTrack";
import DuelArena from "./components/Environment/DuelArena";
import Planets from "./components/Environment/Planets";
import Clouds from "./components/Environment/Clouds";
import UFO from "./components/Environment/UFO";
import MeteoriteSpawner from "./components/Environment/MeteoriteSpawner";
import EnemySpawner from "./components/EnemySpawner";
import SoldierSpawner from "./components/SoldierSpawner";
import MissionManager from "./components/Missions/MissionManager";
import Car from "./components/Vehicles/Car"; // Import Car
import Airplane from "./components/Vehicles/Airplane"; // Import Airplane
import Helicopter from "./components/Vehicles/Helicopter"; // Import Helicopter
import { useStore } from "./store";


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

const Scene: React.FC = () => {
  // TEMP DEBUG (Claude): 'airplane'/'helicopter'/'car' test scenarios strip
  // everything below that isn't the ground, the airport pads, or the
  // vehicle actually being tested -- "senza citta e distrazioni" -- so a
  // physics test isn't sharing frame budget or collision volume with 30
  // parked cars, pedestrians, a UFO, meteorites, missions, etc. See
  // store.ts's testScene and window.__sim.startTest()/endTest()
  // (debug/simDebug.ts).
  const testScene = useStore((state) => state.testScene);
  const isCleanTest = testScene !== 'none';
  const isCarTest = testScene === 'car';
  const isRaceTest = testScene === 'race';
  // "crea una sezione dedicata nel menu di avvio del gioco che mi fa
  // entrare in un'arena" -- the 1v1 duel scenario, same isCleanTest
  // family as the flight/car/race tests above (SoldierSpawner/City/
  // Road/etc. are already stripped for ANY testScene !== 'none' -- see
  // isCleanTest below); this just additionally mounts DuelArena.tsx.
  const isDuelTest = testScene === 'duel';
  // "togli la mappa in modalita arena.. analizza la mesh e la ragdoll e
  // vedi se combaciano bene" -- quando il toggle debug T-pose e' attivo
  // (store.ts's debugTPoseJoints, vedi CombatArenaGUI.tsx), ripulisce
  // ulteriormente la vista del duello per l'ispezione ragdoll: nasconde
  // la PARTE VISIVA del Terrain (il piano scuro sempre presente, vedi
  // Terrain.tsx's nuovo prop hideVisual -- i suoi collider/muri restano
  // SEMPRE montati, altrimenti i personaggi cadrebbero nel vuoto) oltre
  // a Ocean/Planets/Airport/Airplane/Helicopter sotto, tutti elementi
  // che isCleanTest da solo non nascondeva perche' condivisi con le
  // altre modalita' test (volo/macchina/gara).
  const debugTPoseJoints = useStore((state) => state.debugTPoseJoints);
  // "metti un comando su lilgui per togliere la mappa ... per pulire la
  // ui" -- flag INDIPENDENTE da debugTPoseJoints sopra (vedi store.ts's
  // proprio commento), ma con lo STESSO effetto sull'ambiente qui sotto:
  // hideMap e' vero se l'uno o l'altro e' attivo, cosi' l'ambiente resta
  // nascosto sia durante l'ispezione T-pose sia con "Pulisci UI" da solo
  // (es. per uno screenshot/video puliti senza congelare nessuno).
  const hideUiClean = useStore((state) => state.hideUiClean);
  const hideMap = debugTPoseJoints || hideUiClean;
  // "aggiungi il tasto retry" -- read fresh each render so a change
  // (see store.ts's retryDuel) flows straight into the key below.
  const duelRound = useStore((state) => state.duelRound);
  // "aggiungi ... gli ufo e [le meteoriti]" -- the race scenario wants
  // some sci-fi atmosphere/spectacle overhead (it's a "gara", not a
  // precision physics test), so UFO + MeteoriteSpawner get an exception to
  // the clean-scenario strip-down specifically for testScene==='race'.
  // The airplane/helicopter/car test scenarios stay exactly as
  // distraction-free as before -- this doesn't touch those.
  const showSkyAtmosphere = !isCleanTest || isRaceTest;
  return (
    <>
      <Terrain hideVisual={hideMap} />
      {isRaceTest && <RaceTrack />}
      {!isCleanTest && <Road />}
      {!isCleanTest && <Clouds />}
      {!hideMap && <Ocean />}
      {!hideMap && <Planets />}
      {showSkyAtmosphere && <UFO initialPosition={[0, 150, 0]} />}
      {showSkyAtmosphere && <MeteoriteSpawner />}
      {!isCleanTest && !DEBUG_DISABLE_CARS_AND_ENEMIES && !DEBUG_DISABLE_ENEMIES && <EnemySpawner />}
      {/* Soldati portati da simulation-citta (AgentSoldier + RiggedCitizen), decorativi come i pedoni */}
      {!isCleanTest && <SoldierSpawner />}

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
            <Car id="car-1" position={[10, 1.2, 0]} />
            <Car id="car-2" position={[60, 1.2, 0]} />
            <Car id="car-3" position={[0, 1.2, 60]} />
            <Car id="car-4" position={[-60, 1.2, 60]} />
            <Car id="car-5" position={[60, 1.2, 60]} />
            <Car id="car-6" position={[-60, 1.2, -60]} />

            {/* Police patrol cars -- rotation Math.PI/2 faces +X, matching
                each route's first leg (see POLICE_ROUTE_INNER/OUTER above:
                first waypoint -> second waypoint both run along +X). */}
            <Car id="police-1" position={[POLICE_ROUTE_INNER[0][0], 1.2, POLICE_ROUTE_INNER[0][1]]} rotation={[0, Math.PI / 2, 0]} patrolRoute={POLICE_ROUTE_INNER} />
            <Car id="police-2" position={[POLICE_ROUTE_OUTER[0][0], 1.2, POLICE_ROUTE_OUTER[0][1]]} rotation={[0, Math.PI / 2, 0]} patrolRoute={POLICE_ROUTE_OUTER} />
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
        {!isCarTest && !isRaceTest && !hideMap && (isCleanTest || !DEBUG_DISABLE_CARS_AND_ENEMIES) && (
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
        {isCarTest && <Car id="test-car-1" position={[10, 1.2, 0]} />}

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

      {/* Airport (runway/heliport pads + markings) stays in every scenario --
          it's the ground truth the vehicles actually sit on/take off from,
          not a "distrazione". Everything else here (city, park, LEDs,
          collectibles, missions) is exactly the clutter the clean test
          scenarios are meant to remove. */}
      {!hideMap && <Airport />}
      {!isCleanTest && (
        <Suspense fallback={null}>
          <City />
          <BuildingLeds />
          <BuildingLedGlow />
          <Park />
          <CityDetails />
          <Collectibles />
          <MissionManager />
        </Suspense>
      )}
    </>
  );
};

export default Scene;
