import { ROAD_OFFSETS, ROAD_WIDTH, SIDEWALK_WIDTH, ROAD_SIZE } from '../components/Environment/Road';
import { CITY_LAYOUT, CITY_BLOCK_SIZE } from '../components/Environment/City';
import { RUNWAY_CENTER, RUNWAY_LENGTH, RUNWAY_WIDTH, HELIPORT_CENTER, HELIPORT_RADIUS } from '../components/Environment/Airport';

// La citta' disegnata dall'alto, una volta sola, su un canvas fuori schermo:
// la usano la minimappa (radar) e la mappa della pausa, ognuna coi suoi
// colori. Nord = -Z in alto, Est = +X a destra.

export interface CityMapPalette {
  water: string;
  land: string;
  block: string;
  building: string;
  buildingEdge: string;
  park: string;
  plaza: string;
  sidewalk: string;
  road: string;
  runway: string;
  runwayMark: string;
  heliport: string;
}

export const WORLD_HALF = ROAD_SIZE / 2 + 20; // un po' di mare attorno all'isola
export const TERRAIN_HALF = ROAD_SIZE / 2;

export function buildCityImage(pal: CityMapPalette, pxPerM: number): HTMLCanvasElement {
  const size = Math.ceil(WORLD_HALF * 2 * pxPerM);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  const k = pxPerM;
  const X = (x: number) => (x + WORLD_HALF) * k;
  const Z = (z: number) => (z + WORLD_HALF) * k;

  g.fillStyle = pal.water;
  g.fillRect(0, 0, size, size);
  g.fillStyle = pal.land;
  g.fillRect(X(-TERRAIN_HALF), Z(-TERRAIN_HALF), TERRAIN_HALF * 2 * k, TERRAIN_HALF * 2 * k);

  // isolati: parco (blocco 0,0), piazze, cortili
  const B = CITY_BLOCK_SIZE;
  const block = (cx: number, cz: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(X(cx - B / 2), Z(cz - B / 2), B * k, B * k);
  };
  block(B / 2, B / 2, pal.park);
  CITY_LAYOUT.plazas.forEach((p) => block(p.x, p.z, pal.plaza));
  CITY_LAYOUT.courtyards.forEach((p) => block(p.x, p.z, pal.block));

  // strade con marciapiedi
  const half = ROAD_WIDTH / 2;
  for (const o of ROAD_OFFSETS) {
    g.fillStyle = pal.sidewalk;
    g.fillRect(X(-TERRAIN_HALF), Z(o - half - SIDEWALK_WIDTH), TERRAIN_HALF * 2 * k, (ROAD_WIDTH + 2 * SIDEWALK_WIDTH) * k);
    g.fillRect(X(o - half - SIDEWALK_WIDTH), Z(-TERRAIN_HALF), (ROAD_WIDTH + 2 * SIDEWALK_WIDTH) * k, TERRAIN_HALF * 2 * k);
  }
  for (const o of ROAD_OFFSETS) {
    g.fillStyle = pal.road;
    g.fillRect(X(-TERRAIN_HALF), Z(o - half), TERRAIN_HALF * 2 * k, ROAD_WIDTH * k);
    g.fillRect(X(o - half), Z(-TERRAIN_HALF), ROAD_WIDTH * k, TERRAIN_HALF * 2 * k);
  }

  // palazzi
  g.lineWidth = 1;
  for (const b of CITY_LAYOUT.buildings) {
    g.fillStyle = pal.building;
    g.fillRect(X(b.x - b.w / 2), Z(b.z - b.d / 2), b.w * k, b.d * k);
    g.strokeStyle = pal.buildingEdge;
    g.strokeRect(X(b.x - b.w / 2) + 0.5, Z(b.z - b.d / 2) + 0.5, b.w * k - 1, b.d * k - 1);
  }

  // aeroporto: pista lungo X ed eliporto
  g.fillStyle = pal.runway;
  g.fillRect(X(RUNWAY_CENTER[0] - RUNWAY_LENGTH / 2), Z(RUNWAY_CENTER[1] - RUNWAY_WIDTH / 2), RUNWAY_LENGTH * k, RUNWAY_WIDTH * k);
  g.fillStyle = pal.runwayMark;
  for (let x = -RUNWAY_LENGTH / 2 + 8; x < RUNWAY_LENGTH / 2 - 8; x += 12) {
    g.fillRect(X(RUNWAY_CENTER[0] + x), Z(RUNWAY_CENTER[1]) - 1, 6 * k, 2);
  }
  g.fillStyle = pal.heliport;
  g.beginPath();
  g.arc(X(HELIPORT_CENTER[0]), Z(HELIPORT_CENTER[1]), HELIPORT_RADIUS * k, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = pal.runwayMark;
  g.font = `bold ${Math.round(HELIPORT_RADIUS * k)}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('H', X(HELIPORT_CENTER[0]), Z(HELIPORT_CENTER[1]));
  return c;
}
