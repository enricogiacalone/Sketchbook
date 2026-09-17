import { CityBuildingRecord, getHoleBounds, BUILDING_HOLE_SIZE } from './City';

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

// City.tsx's own comment on the real stairs explains why this needs more
// than "walk from t=0 to t=1": every flight's ramp occupies the SAME local
// X range within the hole (getBuildingHeightOffset only reads local X, not
// which floor), so after topping out a flight you're standing on the next
// floor's slab, not already lined up for the next flight -- you have to
// walk around the stairwell opening back to its low-X side before the next
// flight will read as "climbing" rather than sliding back down the one you
// just took. MARGIN keeps the path a bit inside the hole/floor edges so it
// doesn't clip the walls.
const MARGIN = 0.3;
const ROOF_STAND_OFFSET = 1.4; // how far onto the roof the top waypoint sits, clear of the stairwell opening

export function getBuildingClimbPath(building: CityBuildingRecord): ClimbWaypoint[] {
  const { holeMinX, holeMaxX, holeMinZ, holeMaxZ, sz } = getHoleBounds(building.w, building.d, building.corner);
  const halfD = building.d / 2;
  const zEntry = (holeMinZ + holeMaxZ) / 2;
  const xLow = holeMinX + MARGIN;
  const xHigh = holeMaxX - MARGIN;
  // Whichever side of the hole the floor slab actually has room on --
  // mirrors getHoleBounds' own sz convention (the hole sits flush against
  // one Z edge of the footprint, so the OTHER side is where a piece of
  // floor plate to walk around on actually exists).
  const zSideRaw = sz < 0 ? holeMaxZ + ROOF_STAND_OFFSET : holeMinZ - ROOF_STAND_OFFSET;
  const zSide = Math.max(-halfD + MARGIN, Math.min(halfD - MARGIN, zSideRaw));

  const local: { x: number; y: number; z: number }[] = [];
  const pushLocal = (x: number, y: number, z: number) => {
    const last = local[local.length - 1];
    if (last && Math.abs(last.x - x) < 0.001 && Math.abs(last.y - y) < 0.001 && Math.abs(last.z - z) < 0.001) return;
    local.push({ x, y, z });
  };

  for (let f = 0; f < building.numFloors; f++) {
    const yLow = f * building.floorHeight;
    const yHigh = (f + 1) * building.floorHeight;
    pushLocal(xLow, yLow, zEntry); // flight entry, low side of the hole
    pushLocal(xHigh, yHigh, zEntry); // flight exit, top of the ramp
    if (f < building.numFloors - 1) {
      // Loop around the stairwell opening, on the flat floor slab, back to
      // this same low-X side ready for the next flight up.
      pushLocal(xHigh, yHigh, zSide);
      pushLocal(xLow, yHigh, zSide);
      pushLocal(xLow, yHigh, zEntry);
    } else {
      // Top floor -- stand out on the roof clear of the opening instead of
      // right at its edge.
      pushLocal(xHigh, yHigh, zSide);
    }
  }

  return local.map((p) => ({ x: building.x + p.x, y: building.by + p.y, z: building.z + p.z }));
}

// A ground-level point just outside the building, roughly toward the
// stairwell's low-X entry -- where a soldier heading to climb this
// building walks toward first, before joining the actual climb path.
// Deliberately simple (Soldier.tsx has no collider -- see its own
// comments -- so briefly clipping a wall corner on approach is an
// acceptable simplification for a decorative "sometimes climbs a
// building" flourish, not a real navmesh).
export function getBuildingApproachPoint(building: CityBuildingRecord): ClimbWaypoint {
  const { holeMinX } = getHoleBounds(building.w, building.d, building.corner);
  return { x: building.x + holeMinX + MARGIN, y: building.by, z: building.z };
}
