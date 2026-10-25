import React, { Suspense } from 'react';
import EnemySpawner from './components/EnemySpawner';
import Airport, { HELIPORT_CENTER, RUNWAY_CENTER } from './components/Environment/Airport';
import BuildingLedGlow from './components/Environment/BuildingLedGlow';
import BuildingLeds from './components/Environment/BuildingLeds';
import NeonSigns from './components/Environment/NeonSigns';
import City from './components/Environment/City';
import CityDetails from './components/Environment/CityDetails';
import CityFlags from './components/Environment/CityFlags';
import Collectibles from './components/Environment/Collectibles';
import DuelArena from './components/Environment/DuelArena';
import MeteoriteSpawner from './components/Environment/MeteoriteSpawner';
import Park from './components/Environment/Park';
import { TreeBatches } from './components/Environment/ParkTrees';
import PoliceDirector from './components/city/PoliceDirector';
import ZombieNight from './components/city/ZombieNight';
import Traffic, { policeDriver } from './components/city/Traffic';
import RaceTrack, { RACE_GRID, RACE_START_ROTATION, RACE_TRACK } from './components/Environment/RaceTrack';
import Road from './components/Environment/Road';
import Terrain from './components/Environment/Terrain';
import Wilderness from './components/Environment/Wilderness';
import { getCurrentSite } from './lib/site';
import { useStaggered } from './lib/useStaggered';
import UFO from './components/Environment/UFO';
// (la vecchia catena di 3 missioni, MissionManager.tsx, e' sostituita dalla
// missione con i personaggi: Missions/StoryMission.tsx)
import StoryMission from './components/Missions/StoryMission';
import MainStory from './components/Missions/MainStory';
import HeistMission from './components/Missions/HeistMission';
import SoldierSpawner from './components/SoldierSpawner';
import VillageFolk from './components/Environment/VillageFolk';
import Airplane from './components/Vehicles/Airplane'; // Import Airplane
import Car from './components/Vehicles/Car'; // Import Car
import Motorcycle from './components/Vehicles/Motorcycle';
import { getTerrainHeight } from './components/Environment/Terrain';
import { getRoadOffset } from './components/Environment/Road';
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

// stadi di montaggio: 0 subito, poi uno ogni STAGE_MS
const STAGE_MS = 300;
const STAGES = 16; // a piu' passi piccoli invece di pochi grandi: ogni montaggio dura meno e non congela il gioco
const useMountStages = (): number => {
  const [stage, setStage] = React.useState(0);
  React.useEffect(() => {
    const ids = Array.from({ length: STAGES }, (_, k) => k + 1).map((k) =>
      window.setTimeout(() => {
        if (import.meta.env.DEV) ((window as any).__stageT ??= {})[k] = performance.now();
        setStage(k);
      }, k * STAGE_MS)
    );
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, []);
  return stage;
};

const Scene: React.FC = () => {
  const testScene = useStore((state) => state.testScene);
  const isCleanTest = testScene !== 'none';
  const isCarTest = testScene === 'car';
  const isRaceTest = testScene === 'race';
  const isDuelTest = testScene === 'duel';
  const duelRound = useStore((state) => state.duelRound);
  const showSimCitta = useStore((state) => state.showSimCitta);
  // modalita' zombi notturna: niente traffico, polizia e passanti
  const zombieNight = useStore((state) => state.zombieNight);
  const showSkyAtmosphere = !isCleanTest || isRaceTest || isDuelTest;
  // il mondo si monta a pezzi, uno ogni ~0.5 s (terreno, strade, palazzi, parco e arredo, traffico e missioni):
  // montarlo tutto insieme congelava il gioco per piu' di un secondo all'arrivo su un pianeta
  const stage = useMountStages();
  // sito selvaggio (atterrato fuori dalla citta'): solo terreno, natura e cielo
  const wild = getCurrentSite().kind === 'wild';
  // le auto, le moto, il traffico e le pattuglie si montano a poco a poco (non tutte insieme)
  const vstep = useStaggered(11, 250, stage >= 9 && !isCleanTest && !wild);

  return (
    <>
      <Terrain />
      {isRaceTest && <RaceTrack />}
      {!isCleanTest && !wild && stage >= 1 && <Road />}
      {!isCleanTest && !wild && stage >= 10 && !zombieNight && <PoliceDirector />}
      {!isCleanTest && !wild && stage >= 11 && <ZombieNight />}
      {!isCleanTest && !wild && stage >= 2 && <CityFlags />}
      {!isCleanTest && stage >= 2 && <Wilderness />}
      {/* storia principale "Il Seme": anziani dei villaggi, frammento nelle rovine, bussola (Missions/MainStory.tsx) */}
      {!isCleanTest && stage >= 5 && <Suspense fallback={null}><MainStory /></Suspense>}
      {/* abitanti dei villaggi vicini (solo nei siti selvaggi: i villaggi stanno fuori dalla citta') */}
      {!isCleanTest && wild && stage >= 4 && <Suspense fallback={null}><VillageFolk /></Suspense>}
      {showSkyAtmosphere && <UFO initialPosition={[0, 150, 0]} />}
      {showSkyAtmosphere && <MeteoriteSpawner />}
      {!isCleanTest && !wild && stage >= 12 && !DEBUG_DISABLE_CARS_AND_ENEMIES && !DEBUG_DISABLE_ENEMIES && <EnemySpawner />}
      {!isCleanTest && !wild && stage >= 13 && showSimCitta && <SoldierSpawner />}
      {/* Carichiamo i modelli in blocchi separati per non bloccare la fisica */}
      <Suspense fallback={null}>
        {!isCleanTest && !wild && stage >= 9 && !DEBUG_DISABLE_CARS_AND_ENEMIES && (
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
            {vstep >= 1 && <FarCars />}
            {/* la moto (Motorcycle.tsx): vicino al punto di partenza, F alla sella a sinistra per salire */}
            {[
              ['moto-1', 4, 5, 0.6],
              ['moto-2', -8, 9, 2.4],
              ['moto-3', 10, -7, -0.9],
            ].map(([id, x, z, yaw], mi) => (vstep >= 2 + mi ? (
              <Motorcycle key={id as string} id={id as string} position={[x as number, getTerrainHeight(x as number, z as number) + getRoadOffset(x as number, z as number) + 0.5, z as number]} yaw={yaw as number} />
            ) : null))}
            {vstep >= 5 && !zombieNight && <Traffic />}
            {/* (le auto ferme stanno nei parcheggi: components/Environment/ParkingLots.tsx) */}

            {/* Police patrol cars (non nella modalita' zombi) */}
            {!zombieNight && (
              <>
            {vstep >= 6 && (
            <Car
              id="police-1"
              driver={policeDriver('police-1')}
              position={[POLICE_ROUTE_INNER[0][0], 1.6, POLICE_ROUTE_INNER[0][1]]}
              rotation={[0, Math.PI / 2, 0]}
              patrolRoute={POLICE_ROUTE_INNER}
            />
            )}
            {vstep >= 7 && (
            <Car
              id="police-2"
              driver={policeDriver('police-2')}
              position={[POLICE_ROUTE_OUTER[0][0], 1.6, POLICE_ROUTE_OUTER[0][1]]}
              rotation={[0, Math.PI / 2, 0]}
              patrolRoute={POLICE_ROUTE_OUTER}
            />
            )}
            {vstep >= 8 && (
            <Car
              id="police-3"
              driver={policeDriver('police-3')}
              position={[POLICE_ROUTE_WIDE[0][0], 1.6, POLICE_ROUTE_WIDE[0][1]]}
              rotation={[0, Math.PI / 2, 0]}
              patrolRoute={POLICE_ROUTE_WIDE}
            />
            )}
            {vstep >= 9 && (
            <Car
              id="police-4"
              driver={policeDriver('police-4')}
              position={[POLICE_ROUTE_CROSS1[0][0], 1.6, POLICE_ROUTE_CROSS1[0][1]]}
              rotation={[0, Math.PI / 2, 0]}
              patrolRoute={POLICE_ROUTE_CROSS1}
            />
            )}
            {vstep >= 10 && (
            <Car
              id="police-5"
              driver={policeDriver('police-5')}
              position={[POLICE_ROUTE_CROSS2[0][0], 1.6, POLICE_ROUTE_CROSS2[0][1]]}
              rotation={[0, Math.PI / 2, 0]}
              patrolRoute={POLICE_ROUTE_CROSS2}
            />
            )}
              </>
            )}
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
        {!isCarTest && !isRaceTest && !wild && stage >= 8 && (isCleanTest || !DEBUG_DISABLE_CARS_AND_ENEMIES) && (
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
      {!wild && <Airport />}
      {!isCleanTest && !wild && (
        <Suspense fallback={null}>
          {stage >= 3 && <City />}
          {stage >= 4 && <BuildingLeds />}
          {stage >= 4 && <NeonSigns />}
          {stage >= 5 && <BuildingLedGlow />}
          {stage >= 6 && <Park />}
          {stage >= 6 && <TreeBatches />}
          {stage >= 7 && <CityDetails />}
          {stage >= 14 && <Collectibles />}
          {stage >= 15 && <StoryMission />}
          {stage >= 16 && <HeistMission />}
        </Suspense>
      )}
    </>
  );
};

export default Scene;
