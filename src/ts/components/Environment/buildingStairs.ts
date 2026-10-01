// Geometria del vano scala dei palazzi (pura: niente React, niente Rapier),
// condivisa da BuildingStairwell.tsx (grafica + collider), City.tsx (solette,
// tetto, dettagli sul tetto) e BuildingClimb.ts (percorso dei soldati).
//
// Scala a due rampe con pianerottolo intermedio ("a U"), come nei palazzi
// veri: dal piano f si sale lungo il muro posteriore verso il muro laterale
// (rampa A), si gira sul pianerottolo a meta' piano, e si torna verso
// l'interno (rampa B) fino al piano f+1. L'attacco di ogni rampa A e
// l'arrivo di ogni rampa B sono sul bordo interno del vano, affacciati sul
// pavimento libero -- niente scale che partono contro un muro. Le rampe
// sono rampe di collisione come quella dell'arena (ParkourCourse.tsx), con
// sopra i gradini visivi.
//
// Coordinate LOCALI all'edificio (centro della pianta), y dalla base.

export const BUILDING_WALL_THICKNESS = 0.3;
export const BUILDING_SLAB_THICKNESS = 0.15;
export const BUILDING_STAIR_LANE = 1.3; // larghezza di ogni rampa
export const BUILDING_STAIR_GAP = 0.1; // fessura tra le due rampe
export const BUILDING_STAIR_LANDING = 1.4; // profondita' del pianerottolo intermedio
export const BUILDING_STAIR_RUN = 2.7; // corsa orizzontale di ogni rampa (mezzo piano: ~38-41 gradi)
const HALF_WALL = BUILDING_WALL_THICKNESS / 2;
// vano: lungo X (pianerottolo + rampa), largo Z (due rampe + fessura)
export const BUILDING_HOLE_LEN = HALF_WALL + BUILDING_STAIR_LANDING + BUILDING_STAIR_RUN;
export const BUILDING_HOLE_SIZE = HALF_WALL + 2 * BUILDING_STAIR_LANE + BUILDING_STAIR_GAP;
export const STAIR_RAMP_T = 0.3; // spessore della rampa di collisione (come l'arena)
export const STAIR_STEP_RISE = 0.18; // alzata dei gradini visivi

// Il vano sta in un angolo, sempre contro il muro POSTERIORE (+Z): sul
// davanti (-Z) c'e' la porta e una scala li' le passerebbe davanti.
// `corner` sceglie solo il lato (sinistra/destra).
export const getHoleBounds = (w: number, d: number, corner: number) => {
  const sx = corner % 2 === 0 ? -1 : 1;
  const sz = 1;
  const holeMinX = sx < 0 ? -w / 2 : w / 2 - BUILDING_HOLE_LEN;
  const holeMinZ = d / 2 - BUILDING_HOLE_SIZE;
  return {
    sx, sz,
    holeMinX, holeMaxX: holeMinX + BUILDING_HOLE_LEN,
    holeMinZ, holeMaxZ: holeMinZ + BUILDING_HOLE_SIZE,
  };
};

export interface Stairwell {
  sx: number;
  sz: number;
  xWall: number; // filo interno del muro laterale
  xLanding: number; // dove il pianerottolo incontra le rampe
  xIn: number; // bordo interno del vano (attacco A / arrivo B)
  zOuter: number; // asse della rampa A (lungo il muro posteriore)
  zInner: number; // asse della rampa B
  zEdge: number; // bordo del vano verso il resto del piano (lato Z)
  landingCX: number;
  landingCZ: number;
  landingHX: number;
  landingHZ: number;
}

export function getStairwell(w: number, d: number, corner: number): Stairwell {
  const { sx, sz } = getHoleBounds(w, d, corner);
  const xWall = sx * (w / 2 - HALF_WALL);
  const xLanding = xWall - sx * BUILDING_STAIR_LANDING;
  const xIn = xLanding - sx * BUILDING_STAIR_RUN;
  const zWall = sz * (d / 2 - HALF_WALL);
  const zOuter = zWall - sz * (BUILDING_STAIR_LANE / 2);
  const zInner = zWall - sz * (BUILDING_STAIR_LANE + BUILDING_STAIR_GAP + BUILDING_STAIR_LANE / 2);
  const zEdge = zWall - sz * (2 * BUILDING_STAIR_LANE + BUILDING_STAIR_GAP);
  return {
    sx, sz, xWall, xLanding, xIn, zOuter, zInner, zEdge,
    landingCX: (xWall + xLanding) / 2,
    landingCZ: (zWall + zEdge) / 2,
    landingHX: BUILDING_STAIR_LANDING / 2,
    landingHZ: Math.abs(zWall - zEdge) / 2,
  };
}

// Quota calpestabile del piano f: 0 = terreno, numFloors = tetto.
export const floorTopY = (f: number, numFloors: number, floorHeight: number) =>
  f <= 0 ? 0 : f >= numFloors ? numFloors * floorHeight + BUILDING_WALL_THICKNESS : f * floorHeight + BUILDING_SLAB_THICKNESS / 2;

export interface StairFlight {
  xa: number; ya: number; // attacco (in basso)
  xb: number; yb: number; // arrivo (in alto)
  z: number;
}

// Le due rampe del piano f (A: verso il muro laterale, B: di ritorno) e la
// quota del pianerottolo.
export function getFloorFlights(sw: Stairwell, f: number, numFloors: number, floorHeight: number) {
  const y0 = floorTopY(f, numFloors, floorHeight);
  const y1 = floorTopY(f + 1, numFloors, floorHeight);
  const ym = (y0 + y1) / 2;
  const a: StairFlight = { xa: sw.xIn, ya: y0, xb: sw.xLanding, yb: ym, z: sw.zOuter };
  const b: StairFlight = { xa: sw.xLanding, ya: ym, xb: sw.xIn, yb: y1, z: sw.zInner };
  return { y0, y1, ym, a, b };
}

// Rampa di collisione la cui faccia superiore va da (xa, ya) a (xb, yb):
// centro, rotazione attorno a Z e lunghezza (come la scala dell'arena).
export function rampTransform(fl: StairFlight, thickness = STAIR_RAMP_T) {
  const dx = fl.xb - fl.xa;
  const rise = fl.yb - fl.ya;
  const angle = Math.atan2(rise, Math.abs(dx)) * Math.sign(dx);
  return {
    x: (fl.xa + fl.xb) / 2 + Math.sin(angle) * (thickness / 2),
    y: (fl.ya + fl.yb) / 2 - Math.cos(angle) * (thickness / 2),
    z: fl.z,
    rotZ: angle,
    len: Math.hypot(rise, dx),
  };
}
