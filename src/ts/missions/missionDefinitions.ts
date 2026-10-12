// "crea una missione come in gta" -- a short chain of 3 objectives, each a
// different GTA-staple mission shape, reusing systems that already exist
// rather than building new ones: driving (Vehicles/Car.tsx etc. + the
// entities map already tracking their position for the minimap), combat
// (Enemy.tsx, spawned standalone the same way EnemySpawner.tsx already
// does), and survival (a small wave of the same Enemy.tsx).
//
// MissionManager.tsx is the state machine that reads this array; this
// file is just data, kept separate so the mission list can grow without
// touching the machine that runs it.
import { RUNWAY_CENTER } from "../components/Environment/Airport";
import { CITY_BLOCK_SIZE } from "../components/Environment/City";

export type MissionType = "drive" | "eliminate" | "survive";

export interface MissionDef {
  id: string;
  title: string;
  // Shown on the HUD while waiting at the beacon (status 'inactive').
  briefing: string;
  type: MissionType;
  timeLimit: number; // seconds
  // World [x, z] -- the drive destination, or the elimination target's
  // spawn point. Unused (undefined) for 'survive'.
  targetPos?: [number, number];
  // 'drive' only: how close the vehicle needs to get to targetPos.
  arriveRadius?: number;
  // 'survive' only: how many enemies spawn around the player at start.
  waveCount?: number;
}

// Where the player walks to (on foot, near spawn) to start mission 1, and
// to retry/pick up whichever mission is current after finishing or
// failing the previous one -- one persistent "mission giver" spot rather
// than a different beacon per stage, GTA-style ("torna dal boss").
export const MISSION_BEACON_POS: [number, number] = [6, 0];

// A point in the park block (see City.tsx's CITY_BLOCK_SIZE -- the park
// itself is the (0,0) block, centered at half that) well clear of the
// beacon/spawn, so mission 2's target doesn't just spawn on top of you.
const PARK_CENTER: [number, number] = [CITY_BLOCK_SIZE / 2, CITY_BLOCK_SIZE / 2];

export const MISSIONS: MissionDef[] = [
  {
    "id": "mission1",
    "title": "Missione 1: Raccogli il Tesoro",
    "briefing": "Porta il tesoro dal centro della città alla base principale.",
    "type": "drive",
    "timeLimit": 90,
    "targetPos": [
      100,
      100
    ],
    "arriveRadius": 20
  },
  {
    "id": "mission2",
    "title": "Missione 2: Distruggi il Nemico",
    "briefing": "Elimina tutti gli ostacoli e i nemici per aprire il passaggio.",
    "type": "eliminate",
    "timeLimit": 60,
    "targetPos": [
      200,
      200
    ]
  },
  {
    "id": "mission3",
    "title": "Missione 3: Sopravvivi al Tornado",
    "briefing": "Sopravvivi a quattro onde di rovine cadenti per raggiungere la zona sicura.",
    "type": "survive",
    "timeLimit": 30,
    "waveCount": 4
  }
];
