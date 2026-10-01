import type { CityBuildingRecord } from './City';
import { getStairwell, getFloorFlights } from './buildingStairs';

// Waypoint path through one building's stairwell, ground floor to roof --
// used by Soldier.tsx's climbing mode ("i soldati [percorrono le scale]
// fino in cima e poi scendono ogni tanto"). All coordinates are WORLD
// space (already offset by the building's x/z/ground height), so callers
// can lerp between consecutive points exactly like the existing
// back-and-forth patrol does between two points.
export interface ClimbWaypoint {
  x: number;
  y: number;
  z: number;
}

// Percorso lungo la scala a due rampe (buildingStairs.ts): per ogni piano
// rampa A fino al pianerottolo, giro sul pianerottolo, rampa B fino al piano
// sopra, poi un passo di lato sul pavimento per l'attacco della rampa A
// successiva. In cima si esce sul tetto, lontano dal vano.
const ROOF_STAND_OFFSET = 1.5;

export function getBuildingClimbPath(building: CityBuildingRecord): ClimbWaypoint[] {
  const sw = getStairwell(building.w, building.d, building.corner);
  const local: { x: number; y: number; z: number }[] = [];
  const xMidLanding = sw.landingCX;
  const xFloor = sw.xIn - sw.sx * 0.6; // un passo dentro il piano, davanti al vano
  for (let f = 0; f < building.numFloors; f++) {
    const { y0, ym, y1 } = getFloorFlights(sw, f, building.numFloors, building.floorHeight);
    local.push({ x: sw.xIn, y: y0, z: sw.zOuter });
    local.push({ x: sw.xLanding, y: ym, z: sw.zOuter });
    local.push({ x: xMidLanding, y: ym, z: sw.zOuter });
    local.push({ x: xMidLanding, y: ym, z: sw.zInner });
    local.push({ x: sw.xLanding, y: ym, z: sw.zInner });
    local.push({ x: sw.xIn, y: y1, z: sw.zInner });
    if (f < building.numFloors - 1) {
      local.push({ x: xFloor, y: y1, z: sw.zInner });
      local.push({ x: xFloor, y: y1, z: sw.zOuter });
    } else {
      local.push({ x: sw.xIn - sw.sx * ROOF_STAND_OFFSET, y: y1, z: sw.zInner });
    }
  }
  return local.map((p) => ({ x: building.x + p.x, y: building.by + p.y, z: building.z + p.z }));
}

// Punto a terra appena davanti all'attacco della prima rampa (dentro
// l'edificio, sul pavimento libero).
export function getBuildingApproachPoint(building: CityBuildingRecord): ClimbWaypoint {
  const sw = getStairwell(building.w, building.d, building.corner);
  return { x: building.x + sw.xIn - sw.sx * 0.6, y: building.by, z: building.z + sw.zOuter };
}
