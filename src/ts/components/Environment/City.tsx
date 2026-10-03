import React, { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from '../../store';
import { FarBuildings, type FarBuildingItem } from './FarBuildings';
import * as THREE from 'three';
import { getTerrainHeight } from './Terrain';
import { getRoadOffset } from './Road';
import { CollisionGroups, groupsExcluding } from '../../enums/CollisionGroups';
import { BuildingStairwell } from './BuildingStairwell';
import { useStaticBoxes, type StaticBox } from './staticColliders';
import {
  BUILDING_HOLE_LEN,
  BUILDING_HOLE_SIZE,
  BUILDING_SLAB_THICKNESS,
  BUILDING_WALL_THICKNESS,
  getHoleBounds,
  getStairwell,
} from './buildingStairs';
import { useTreeTemplates, TreeInstance, TreeTemplate, Flowers } from './ParkTrees';
import { RealGrassPatch } from './RealGrass';
import { StaticInstances } from './StaticInstances';

const _windowDummy = new THREE.Object3D();
const _windowColor = new THREE.Color();

// "le finestre devono essere veri buchi" -- the old windows were a flat
// colored plane glued ~4cm in front of an otherwise UNBROKEN wall
// surface: fine when buildings were just static exterior scenery, but
// once the interior became walkable (see "Explorable interiors" below)
// that reads as wrong from inside -- a solid
// wall with no opening at all, since the decal plane is single-sided and
// faces outward only. This builds an actual wall panel with rectangular
// holes really cut through it (a 2D THREE.Shape with hole Paths, given
// real thickness via ExtrudeGeometry), so light/sightlines genuinely pass
// through where a window or the entrance door is. The colored plane from
// before is kept too (now semi-transparent) sitting inside the opening as
// the "glass", but the wall itself now actually has a gap behind it.
interface WallHole {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
}

function buildWallGeometry(span: number, wallHeight: number, thickness: number, holes: WallHole[]): THREE.ExtrudeGeometry {
  const halfSpan = span / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-halfSpan, 0);
  shape.lineTo(halfSpan, 0);
  shape.lineTo(halfSpan, wallHeight);
  shape.lineTo(-halfSpan, wallHeight);
  shape.lineTo(-halfSpan, 0);

  for (const h of holes) {
    const hole = new THREE.Path();
    hole.moveTo(h.cx - h.hw, h.cy - h.hh);
    hole.lineTo(h.cx + h.hw, h.cy - h.hh);
    hole.lineTo(h.cx + h.hw, h.cy + h.hh);
    hole.lineTo(h.cx - h.hw, h.cy + h.hh);
    hole.lineTo(h.cx - h.hw, h.cy - h.hh);
    shape.holes.push(hole);
  }

  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 1 });
  geo.translate(0, 0, -thickness / 2);
  geo.computeVertexNormals();
  return geo;
}

interface WallColliderBox {
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
}

// "nn riesco a passarci attraverso" -- the walls above got real holes for
// windows/the door, but the RigidBody underneath was still the old
// hardcoded 6-CuboidCollider box (solid back/left/right, a door gap only
// on the front, nothing accounting for any window) -- so every opening
// looked open but was still physically solid. This decomposes the SAME
// hole list used to build a wall's visual geometry (buildWallGeometry
// above) into a tiling of solid CuboidCollider rectangles that leaves a
// real gap at every hole instead: holes are first grouped into
// horizontal bands by their exact vertical span (each floor's window row
// shares one band; the door -- a different height entirely -- is its own
// band), full-span solid strips fill the wall above/below/between bands,
// and within each band solid pillars fill whatever's left/right/between
// that band's holes. Kept span-only (2D, in the wall's own local
// width/height plane) since every caller below just maps the result onto
// whichever world axis that wall panel actually spans.
function buildWallColliderBoxes(span: number, wallHeight: number, holes: WallHole[]): WallColliderBox[] {
  const halfSpan = span / 2;
  if (holes.length === 0) {
    return [{ cx: 0, cy: wallHeight / 2, halfW: halfSpan, halfH: wallHeight / 2 }];
  }

  const EPS = 0.01;
  type Band = { yLow: number; yHigh: number; holes: { xLow: number; xHigh: number }[] };
  const bands: Band[] = [];
  for (const h of holes) {
    const yLow = h.cy - h.hh;
    const yHigh = h.cy + h.hh;
    let band = bands.find((b) => Math.abs(b.yLow - yLow) < EPS && Math.abs(b.yHigh - yHigh) < EPS);
    if (!band) {
      band = { yLow, yHigh, holes: [] };
      bands.push(band);
    }
    band.holes.push({ xLow: h.cx - h.hw, xHigh: h.cx + h.hw });
  }
  bands.sort((a, b) => a.yLow - b.yLow);

  const boxes: WallColliderBox[] = [];

  // Full-span solid strips: below the first band, between consecutive
  // bands, and above the last band up to the roofline.
  let cursorY = 0;
  for (const band of bands) {
    if (band.yLow > cursorY + EPS) {
      const h = band.yLow - cursorY;
      boxes.push({ cx: 0, cy: cursorY + h / 2, halfW: halfSpan, halfH: h / 2 });
    }
    cursorY = Math.max(cursorY, band.yHigh);
  }
  if (wallHeight > cursorY + EPS) {
    const h = wallHeight - cursorY;
    boxes.push({ cx: 0, cy: cursorY + h / 2, halfW: halfSpan, halfH: h / 2 });
  }

  // Within each band: solid pillars filling everything that isn't a hole.
  // Le finestre sono in colonna da un piano all'altro: lo stesso pilastro
  // in fasce consecutive diventa UN solo collider alto (attraversa anche le
  // fasce piene tra un piano e l'altro, che sono comunque muro) -- da ~8
  // collider per piano per muro a ~1 (caricamento a zone: un palazzo vicino
  // si crea in pochi millisecondi invece di decine).
  type Pillar = { xLow: number; xHigh: number; yLow: number; yHigh: number; band: number };
  const open: Pillar[] = [];
  const done: Pillar[] = [];
  bands.forEach((band, bi) => {
    const sortedHoles = [...band.holes].sort((a, b) => a.xLow - b.xLow);
    const spans: { xLow: number; xHigh: number }[] = [];
    let cursorX = -halfSpan;
    for (const hole of sortedHoles) {
      if (hole.xLow > cursorX + EPS) spans.push({ xLow: cursorX, xHigh: hole.xLow });
      cursorX = Math.max(cursorX, hole.xHigh);
    }
    if (halfSpan > cursorX + EPS) spans.push({ xLow: cursorX, xHigh: halfSpan });
    for (const sp of spans) {
      const prev = open.find((p) => p.band === bi - 1 && Math.abs(p.xLow - sp.xLow) < EPS && Math.abs(p.xHigh - sp.xHigh) < EPS);
      if (prev) {
        prev.yHigh = band.yHigh;
        prev.band = bi;
      } else {
        open.push({ ...sp, yLow: band.yLow, yHigh: band.yHigh, band: bi });
      }
    }
    // chi non e' continuato in questa fascia e' finito
    for (let k = open.length - 1; k >= 0; k--) {
      if (open[k].band < bi) done.push(...open.splice(k, 1));
    }
  });
  done.push(...open);
  for (const p of done) {
    boxes.push({ cx: (p.xLow + p.xHigh) / 2, cy: (p.yLow + p.yHigh) / 2, halfW: (p.xHigh - p.xLow) / 2, halfH: (p.yHigh - p.yLow) / 2 });
  }

  return boxes;
}

const BUILDING_GAP = 1.5; // spazio minimo tra due palazzi

const footprintOverlapsRoad = (x: number, z: number, width: number, depth: number): boolean => {
  const halfW = width / 2;
  const halfD = depth / 2;
  const samplePoints: [number, number][] = [
    [x, z],
    [x - halfW, z - halfD],
    [x + halfW, z - halfD],
    [x - halfW, z + halfD],
    [x + halfW, z + halfD],
    [x, z - halfD],
    [x, z + halfD],
    [x - halfW, z],
    [x + halfW, z],
  ];
  return samplePoints.some(([px, pz]) => getRoadOffset(px, pz) > 0);
};

// --- Explorable interiors --------------------------------------------------
// "rendi i palazzi esplorabili, piani e scale che portano fino al tetto".
//
// Pavimenti, scale e tetto sono collider Rapier veri (BuildingStairwell.tsx,
// geometria in buildingStairs.ts): scala a due rampe con pianerottolo, come
// nei palazzi veri, con rampe di collisione come la scala dell'arena. Il
// manichino ci sale coi piedi (supportHeight); i MURI lo bloccano (gruppo
// Characters, vedi BUILDING_WALL_GROUPS).
export { BUILDING_HOLE_LEN, BUILDING_HOLE_SIZE, BUILDING_SLAB_THICKNESS, BUILDING_WALL_THICKNESS, getHoleBounds, getStairwell };
export const BUILDING_DOOR_WIDTH = 2.4;
export const BUILDING_DOOR_HEIGHT = 3.2;
// Muri (e annessi) dei palazzi: mondo (Default: proiettili, auto), corpi
// dei combattenti (Characters: le capsule solide del manichino) e ragdoll
// (RagdollWorld). Prima erano solo Default: il manichino ci passava dentro.
const BUILDING_WALL_GROUPS = groupsExcluding([CollisionGroups.Default, CollisionGroups.Characters, CollisionGroups.RagdollWorld]);
const BUILDING_TARGET_FLOOR_HEIGHT = 4.2;

// Per-building floor count/spacing is derived (not a fixed 4.2 everywhere)
// so that floor numFloors always lands EXACTLY on the roof (height), with
// no leftover gap for a final "almost there" flight -- height/numFloors is
// usually very close to the 4.2 target anyway (buildings are 20-110 tall).
export const getBuildingNumFloors = (height: number): number =>
  Math.min(24, Math.max(1, Math.round(height / BUILDING_TARGET_FLOOR_HEIGHT)));

export interface CityBuildingRecord {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  color: string;
  style: 'modern' | 'glass' | 'brick';
  corner: number; // 0-3, which footprint corner the stairwell shaft sits in
  numFloors: number;
  floorHeight: number;
  by: number; // ground height at (x,z), precomputed once
  // "fai illuminare i palazzi come se avessero decorazioni led la notte" --
  // a per-building accent color + phase for the roofline LED trim
  // (BuildingLeds.tsx), picked once here alongside the building's own
  // color/style instead of re-randomizing in the lighting component.
  ledColor: string;
  ledPhase: number;
}

export interface CityLayout {
  buildings: CityBuildingRecord[];
  courtyards: Array<{ x: number; z: number }>;
  plazas: Array<{ x: number; z: number }>;
}

// Moved out of the City component (used to be a component-local useMemo)
// into a module-level constant computed once when this module first loads
// -- same trick Road.tsx uses for ROAD_OFFSETS: one single canonical
// building layout, generated once, readable outside the component.
// Exported: Collectibles.tsx ("aggiungi oggetti da collezionare per
// tutta la citta") needs the real building/courtyard/plaza layout to
// scatter pickups through the streets, park-less blocks and building
// roofs, instead of duplicating this generation logic.
// Exported so Minimap.tsx can draw the same block grid the city was
// actually generated on ("sistema la minimappa come in gta 5") instead
// of guessing/duplicating the 60-unit spacing.
export const CITY_BLOCK_SIZE = 60;

export const CITY_LAYOUT: CityLayout = (() => {
  const bArr: CityBuildingRecord[] = [];
  const cArr: Array<{ x: number; z: number }> = [];
  const pArr: Array<{ x: number; z: number }> = [];
  const gridSpacing = CITY_BLOCK_SIZE;
  const buildingColorsByStyle: Record<'modern' | 'glass' | 'brick', string[]> = {
    modern: ['#c9c9c9', '#a3b1bf', '#8fa0ad', '#5a6b7a', '#3d4f5c', '#d9cdbb', '#8a8a8a'],
    glass: ['#88ccff', '#7fd8d8', '#a0e0ff', '#6fb8d9', '#9fc9e8'],
    brick: ['#8b3a2c', '#a0522d', '#7a4a3a', '#9c5b45', '#6b3f36', '#b06040'],
  };
  const styles: ('modern' | 'glass' | 'brick')[] = ['modern', 'glass', 'brick'];
  // Vivid architectural-accent-light palette -- unrelated to the
  // day/lit building color above, this is purely the roofline LED trim's
  // own color (BuildingLeds.tsx), same idea as real cities where a
  // building's facade material and its night accent lighting are picked
  // independently.
  const LED_PALETTE = ['#00eaff', '#ff2fd0', '#7cff3a', '#ffb300', '#8a6bff', '#ff3b5c'];

  // Citta estesa a 5x5 blocchi (gridRadius = 2)
  const gridRadius = 2;
  for (let i = -gridRadius; i <= gridRadius; i++) {
    for (let j = -gridRadius; j <= gridRadius; j++) {
      const blockX = i * gridSpacing + gridSpacing / 2;
      const blockZ = j * gridSpacing + gridSpacing / 2;

      if (i === 0 && j === 0) continue;

      // Plaza block coordinates on opposite corners of the 5x5 grid
      if ((i === -2 && j === 2) || (i === 2 && j === -2)) {
        pArr.push({ x: blockX, z: blockZ });
        continue;
      }

      cArr.push({ x: blockX, z: blockZ });

      const count = 3 + Math.floor(Math.random() * 2);
      for (let k = 0; k < count; k++) {
        const w = 10 + Math.random() * 12;
        const d = 10 + Math.random() * 12;
        const h = 20 + Math.random() * 90;
        const style = styles[Math.floor(Math.random() * styles.length)];
        const palette = buildingColorsByStyle[style];
        const color = palette[Math.floor(Math.random() * palette.length)];

        for (let attempt = 0; attempt < 30; attempt++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = 18 + Math.random() * 7;
          const x = blockX + Math.cos(angle) * dist;
          const z = blockZ + Math.sin(angle) * dist;

          // niente palazzi compenetrati: i muri di uno finivano dentro
          // l'altro e le sue solette coprivano il vano scala dell'altro
          const overlapsBuilding = bArr.some(
            (o) => Math.abs(o.x - x) < (o.w + w) / 2 + BUILDING_GAP && Math.abs(o.z - z) < (o.d + d) / 2 + BUILDING_GAP
          );
          if (!overlapsBuilding && !footprintOverlapsRoad(x, z, w, d)) {
            const numFloors = getBuildingNumFloors(h);
            bArr.push({
              x,
              z,
              w,
              d,
              h,
              color,
              style,
              corner: Math.floor(Math.random() * 4),
              numFloors,
              floorHeight: h / numFloors,
              ledColor: LED_PALETTE[Math.floor(Math.random() * LED_PALETTE.length)],
              ledPhase: Math.random() * Math.PI * 2,
              by: getTerrainHeight(x, z),
            });
            break;
          }
        }
      }
    }
  }
  return { buildings: bArr, courtyards: cArr, plazas: pArr };
})();

// geometrie pesanti (muri estrusi coi buchi) e collider dei muri: calcolati
// una volta per palazzo, riusati a ogni rimontaggio
const wallGeoCache = new Map<number, unknown>();
const colliderBoxCache = new Map<number, unknown>();
function cached<T>(cache: Map<number, unknown>, key: number, make: () => T): T {
  if (cache.has(key)) return cache.get(key) as T;
  const v = make();
  cache.set(key, v);
  return v;
}

// Le scelte casuali di ogni palazzo (dettagli sul tetto, annesso,
// pensilina, finestre accese) fatte UNA volta per palazzo e ricordate: il
// palazzo dettagliato si monta e smonta quando ci si avvicina/allontana
// (caricamento a zone, BuildingsStreamer) e deve tornare identico; il
// modello semplificato da lontano (FarBuildings) usa lo stesso annesso.
export interface BuildingDetails {
  hasGreenRoof: boolean;
  hasSetbackTier: boolean;
  hasRoofUnits: boolean;
  hasCanopy: boolean;
  annex: { w: number; d: number; h: number; ox: number; oz: number } | null;
  windowInstances: Array<{ x: number; y: number; z: number; rotationY: number; lit: boolean }>;
}
const detailsCache = new Map<number, BuildingDetails>();
export function getBuildingDetails(index: number): BuildingDetails {
  const hit = detailsCache.get(index);
  if (hit) return hit;
  const b = CITY_LAYOUT.buildings[index];
  const width = b.w,
    depth = b.d,
    height = b.h,
    style = b.style,
    numFloors = b.numFloors,
    floorHeight = b.floorHeight;
  const hasGreenRoof = height > 40 && Math.random() > 0.5;
  const hasSetbackTier = !hasGreenRoof && height > 70 && Math.random() > 0.4;
  const hasRoofUnits = !hasGreenRoof && !hasSetbackTier && height > 25 && Math.random() > 0.55;
  const hasCanopy = style !== 'glass' && width >= 14 && Math.random() > 0.4;
  const hasAnnex = width >= 14 && depth >= 14 && height > 25 && Math.random() > 0.7;

  let annex: { w: number; d: number; h: number; ox: number; oz: number } | null = null;
  if (hasAnnex) {
    const annexW = width * (0.35 + Math.random() * 0.15);
    const annexD = depth * (0.35 + Math.random() * 0.15);
    const annexH = height * (0.3 + Math.random() * 0.3);
    const annexCorner = Math.floor(Math.random() * 4);
    const asx = annexCorner % 2 === 0 ? 1 : -1;
    const asz = annexCorner < 2 ? 1 : -1;
    annex = {
      w: annexW,
      d: annexD,
      h: annexH,
      ox: asx * (width / 2 + annexW / 2 - 0.5),
      oz: asz * (depth / 2 + annexD / 2 - 0.5),
    };
  }

  // Real per-floor windows, punched into the two long faces (+/-Z) and
  // two short faces (+/-X). Skipped for 'glass' towers -- a full glass
  // curtain wall doesn't have individual punched windows, it gets a
  // subtle mullion overlay instead (see the emissive wireframe below).
  // Uses the SAME per-building floorHeight/numFloors as the real
  // interior floors now, so window rows visually line up with them.
  const windowInstances: Array<{ x: number; y: number; z: number; rotationY: number; lit: boolean }> = [];
  if (style !== 'glass') {
    const spacing = 3.4;
    const countW = Math.min(6, Math.max(1, Math.floor(width / spacing) - 1));
    const countD = Math.min(6, Math.max(1, Math.floor(depth / spacing) - 1));
    // Same room-centered fix as wallGeometries above -- f+0.5 puts the
    // window in the middle of room f's own floor-to-ceiling span rather
    // than on the slab between room f-1 and room f. f=0 (ground floor)
    // still skipped by starting at f=1.
    for (let f = 1; f < numFloors; f++) {
      const wy = (f + 0.5) * floorHeight;
      for (let c = 0; c < countW; c++) {
        const wx = (c - (countW - 1) / 2) * spacing;
        windowInstances.push({ x: wx, y: wy, z: depth / 2 + 0.04, rotationY: 0, lit: Math.random() > 0.65 });
        windowInstances.push({ x: wx, y: wy, z: -depth / 2 - 0.04, rotationY: Math.PI, lit: Math.random() > 0.65 });
      }
      for (let r = 0; r < countD; r++) {
        const wz = (r - (countD - 1) / 2) * spacing;
        windowInstances.push({ x: width / 2 + 0.04, y: wy, z: wz, rotationY: Math.PI / 2, lit: Math.random() > 0.65 });
        windowInstances.push({ x: -width / 2 - 0.04, y: wy, z: wz, rotationY: -Math.PI / 2, lit: Math.random() > 0.65 });
      }
    }
  }

  const out = { hasGreenRoof, hasSetbackTier, hasRoofUnits, hasCanopy, annex, windowInstances };
  detailsCache.set(index, out);
  return out;
}

const Building: React.FC<{
  cacheKey: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  color: string;
  style: 'modern' | 'glass' | 'brick';
  corner: number;
  numFloors: number;
  floorHeight: number;
}> = ({ cacheKey, x, z, width, depth, height, color, style, corner, numFloors, floorHeight }) => {
  const y = getTerrainHeight(x, z);
  const halfW = width / 2;
  const halfD = depth / 2;
  const doorHalf = BUILDING_DOOR_WIDTH / 2;

  // Pezzo A della soletta (il grosso del piano, fuori dalla fascia X del
  // vano scala): i dettagli sul tetto ci stanno sopra, lontano dal vano.
  const { holeMinX, holeMaxX, sx } = getHoleBounds(width, depth, corner);
  const pieceAMinX = sx < 0 ? holeMaxX : -halfW;
  const pieceAMaxX = sx < 0 ? halfW : holeMinX;
  const pieceAWidth = pieceAMaxX - pieceAMinX;
  const pieceACenterX = (pieceAMinX + pieceAMaxX) / 2;
  const hasLintel = height > BUILDING_DOOR_HEIGHT + 0.5;

  // Torre di vetro: scatola unica come prima ma senza la faccia di sopra
  // (il tetto e' il coperchio a L sotto, col vano aperto).
  const glassMaterials = useMemo(() => {
    if (style !== 'glass') return null;
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.1, metalness: 0.9, side: THREE.DoubleSide });
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    // ordine facce BoxGeometry: +x, -x, +y, -y, +z, -z
    return [m, m, hidden, m, m, m];
  }, [style, color]);

  // Real punched-hole wall panels (front/back/left/right) replacing the
  // single solid box for anything that isn't a glass curtain-wall tower
  // (glass towers keep the old clean box + mullion overlay below -- see
  // that comment for why). Window hole positions/sizes mirror the
  // windowInstances computed in `details` below exactly (same
  // spacing/countW/countD/floor math) so the glass-pane decals line up
  // with the actual openings; kept as a small separate computation here
  // rather than threading it back out of `details` to avoid touching that
  // memo's existing shape. WALL_HOLE_MARGIN shrinks each hole slightly
  // versus its 1.3x1.9 glass pane so the pane's edge overlaps the
  // punched opening instead of leaving a sliver of daylight-colored gap.
  // Hole list shared by both the visual wall panels (wallGeometries) and
  // their physics colliders (colliderBoxes) below -- computed once here so
  // the two truly can't drift apart (they used to be two separate spacing/
  // countW/countD/floor computations that just had to be kept in sync by
  // hand; see git history for why that comment existed).
  // "le finestre devono essere coerenti con i piani" -- f*floorHeight is
  // a SLAB's height (see the slab instancedMesh below, f=1..numFloors-1),
  // so a window centered there straddled the floor between two rooms
  // instead of sitting inside either one. f+0.5 centers it in the middle
  // of room f's own vertical span instead, room f=0 (ground) skipped
  // same as before by starting at f=1.
  const wallHoles = useMemo(() => {
    if (style === 'glass') return null;
    const spacing = 3.4;
    const countW = Math.min(6, Math.max(1, Math.floor(width / spacing) - 1));
    const countD = Math.min(6, Math.max(1, Math.floor(depth / spacing) - 1));
    const WALL_HOLE_MARGIN = 0.05;
    const holeHalfW = 1.3 / 2 - WALL_HOLE_MARGIN;
    const holeHalfH = 1.9 / 2 - WALL_HOLE_MARGIN;

    const holesW: WallHole[] = [];
    const holesD: WallHole[] = [];
    for (let f = 1; f < numFloors; f++) {
      const wy = (f + 0.5) * floorHeight;
      for (let cc = 0; cc < countW; cc++) {
        const wx = (cc - (countW - 1) / 2) * spacing;
        holesW.push({ cx: wx, cy: wy, hw: holeHalfW, hh: holeHalfH });
      }
      for (let rr = 0; rr < countD; rr++) {
        const wz = (rr - (countD - 1) / 2) * spacing;
        holesD.push({ cx: wz, cy: wy, hw: holeHalfW, hh: holeHalfH });
      }
    }

    const doorHole: WallHole = { cx: 0, cy: BUILDING_DOOR_HEIGHT / 2, hw: BUILDING_DOOR_WIDTH / 2, hh: BUILDING_DOOR_HEIGHT / 2 };

    return { holesW, holesD, doorHole };
  }, [style, width, depth, height, floorHeight, numFloors]);

  // Real punched-hole wall panels (front/back/left/right) replacing the
  // single solid box for anything that isn't a glass curtain-wall tower
  // (glass towers keep the old clean box + mullion overlay below -- see
  // that comment for why). Window hole positions/sizes mirror the
  // windowInstances computed in `details` below exactly (same
  // spacing/countW/countD/floor math) so the glass-pane decals line up
  // with the actual openings. WALL_HOLE_MARGIN (baked into wallHoles
  // above) shrinks each hole slightly versus its 1.3x1.9 glass pane so
  // the pane's edge overlaps the punched opening instead of leaving a
  // sliver of daylight-colored gap.
  const wallGeometries = useMemo(
    () =>
      cached(wallGeoCache, cacheKey, () => {
        if (!wallHoles) return null;
        const { holesW, holesD, doorHole } = wallHoles;
        return {
          // Front (-Z) is the door face -- windows AND the entrance opening.
          front: buildWallGeometry(width, height, BUILDING_WALL_THICKNESS, [...holesW, doorHole]),
          back: buildWallGeometry(width, height, BUILDING_WALL_THICKNESS, holesW),
          // Left and right share one geometry -- identical window layout,
          // just mirrored/repositioned via rotation below.
          side: buildWallGeometry(depth, height, BUILDING_WALL_THICKNESS, holesD),
        };
      }),
    [cacheKey, wallHoles, width, depth, height]
  );

  // "nn riesco a passarci attraverso" -- the physics counterpart of
  // wallGeometries above, built from the exact same wallHoles so a window
  // (or the door) is a real gap to WALK through, not just to see through.
  // null for glass towers, which fall back to the old simple door-only
  // collider set in the RigidBody below (see that block's comment for why).
  const colliderBoxes = useMemo(
    () =>
      cached(colliderBoxCache, cacheKey, () => {
        if (!wallHoles) return null;
        const { holesW, holesD, doorHole } = wallHoles;
        return {
          front: buildWallColliderBoxes(width, height, [...holesW, doorHole]),
          back: buildWallColliderBoxes(width, height, holesW),
          side: buildWallColliderBoxes(depth, height, holesD),
        };
      }),
    [cacheKey, wallHoles, width, depth, height]
  );

  const wallMaterialProps = useMemo(
    () => ({
      color,
      roughness: style === 'brick' ? 0.85 : 0.6,
      metalness: style === 'brick' ? 0.05 : 0.25,
      side: THREE.DoubleSide as THREE.Side,
    }),
    [color, style]
  );

  // All the randomized "detail" decisions for this building are picked
  // ONCE per mount instead of directly in the render body (the roof-detail
  // flags used to call Math.random() straight in render, which would
  // silently reshuffle on every re-render -- fine for a flag no one
  // noticed, not fine now that windowInstances below computes a whole
  // array of transforms per re-render otherwise). "aggiungi dettagli,
  // rendilo più reale":
  //  - real punched windows (instanced, lit/unlit) on modern/brick towers
  //  - glass towers stay clean/reflective with only a subtle mullion grid
  //  - a darker ground-floor plinth band (retail/lobby facade)
  //  - an entrance canopy on wider, non-glass buildings
  //  - an occasional smaller side annex so not every building is one pure box
  const details = getBuildingDetails(cacheKey);

  const { hasGreenRoof, hasSetbackTier, hasRoofUnits, hasCanopy, annex, windowInstances } = details;

  // Muri (e annesso) come collider fissi creati in blocco (staticColliders.ts):
  // pezzi attorno a porta e finestre, oppure per le torri di vetro le pareti
  // piene con solo la porta.
  const wallBoxes = useMemo(() => {
    const g = BUILDING_WALL_GROUPS;
    const T = BUILDING_WALL_THICKNESS / 2;
    const out: StaticBox[] = [];
    if (colliderBoxes) {
      for (const b of colliderBoxes.front) out.push({ half: [b.halfW, b.halfH, T], pos: [b.cx, b.cy, -halfD], groups: g });
      for (const b of colliderBoxes.back) out.push({ half: [b.halfW, b.halfH, T], pos: [b.cx, b.cy, halfD], groups: g });
      for (const b of colliderBoxes.side) {
        out.push({ half: [T, b.halfH, b.halfW], pos: [-halfW, b.cy, b.cx], groups: g });
        out.push({ half: [T, b.halfH, b.halfW], pos: [halfW, b.cy, b.cx], groups: g });
      }
    } else {
      out.push({ half: [(halfW - doorHalf) / 2, height / 2, T], pos: [(-halfW - doorHalf) / 2, height / 2, -halfD], groups: g });
      out.push({ half: [(halfW - doorHalf) / 2, height / 2, T], pos: [(doorHalf + halfW) / 2, height / 2, -halfD], groups: g });
      if (hasLintel)
        out.push({
          half: [doorHalf, (height - BUILDING_DOOR_HEIGHT) / 2, T],
          pos: [0, (BUILDING_DOOR_HEIGHT + height) / 2, -halfD],
          groups: g,
        });
      out.push({ half: [halfW, height / 2, T], pos: [0, height / 2, halfD], groups: g });
      out.push({ half: [T, height / 2, halfD], pos: [-halfW, height / 2, 0], groups: g });
      out.push({ half: [T, height / 2, halfD], pos: [halfW, height / 2, 0], groups: g });
    }
    if (annex) out.push({ half: [annex.w / 2, annex.h / 2, annex.d / 2], pos: [annex.ox, annex.h / 2, annex.oz], groups: g });
    return out;
  }, [colliderBoxes, halfW, halfD, doorHalf, height, hasLintel, annex]);
  useStaticBoxes([x, y, z], wallBoxes);

  return (
    <group>
      {/* Structural walls -- used to be ONE solid CuboidCollider spanning
          the whole volume (fine when buildings were just static scenery).
          Now split into wall-only pieces (front-left/front-right around a
          real door gap, a lintel above it, back/left/right full) so the
          interior is actually walkable in. Floors/stairs/roof: see
          BuildingStairwell. */}

      {/* Main Structure. Glass curtain-wall towers keep the original
          single solid box (no punched windows -- see the mullion-overlay
          comment below for why); everything else ('modern'/'brick') now
          gets real punched-hole wall panels instead of one unbroken box,
          so a window (or the front door) is an actual gap through the
          wall, not a decal glued in front of solid geometry -- see
          buildWallGeometry's comment up top. DoubleSide throughout so the
          inner surface is visible once you're standing inside. */}
      {style === 'glass' || !wallGeometries ? (
        <mesh castShadow receiveShadow position={[x, y + height / 2, z]} material={glassMaterials ?? undefined}>
          <boxGeometry args={[width, height, depth]} />
          {!glassMaterials && <meshStandardMaterial color={color} roughness={0.1} metalness={0.9} side={THREE.DoubleSide} />}
        </mesh>
      ) : (
        <>
          <mesh geometry={wallGeometries.back} position={[x, y, z + halfD]} castShadow receiveShadow>
            <meshStandardMaterial {...wallMaterialProps} />
          </mesh>
          <mesh geometry={wallGeometries.front} position={[x, y, z - halfD]} castShadow receiveShadow>
            <meshStandardMaterial {...wallMaterialProps} />
          </mesh>
          <mesh geometry={wallGeometries.side} position={[x - halfW, y, z]} rotation={[0, Math.PI / 2, 0]} castShadow receiveShadow>
            <meshStandardMaterial {...wallMaterialProps} />
          </mesh>
          <mesh geometry={wallGeometries.side} position={[x + halfW, y, z]} rotation={[0, -Math.PI / 2, 0]} castShadow receiveShadow>
            <meshStandardMaterial {...wallMaterialProps} />
          </mesh>
        </>
      )}

      {/* Solette, tetto a L, scala a due rampe con pianerottolo, parapetto:
          grafica e collider (BuildingStairwell.tsx). */}
      <BuildingStairwell
        x={x}
        y={y}
        z={z}
        width={width}
        depth={depth}
        height={height}
        corner={corner}
        numFloors={numFloors}
        floorHeight={floorHeight}
        roofMaterial={{ color: wallMaterialProps.color, roughness: wallMaterialProps.roughness, metalness: wallMaterialProps.metalness }}
      />

      {/* Windows (modern/brick) -- one instanced mesh per building, lit
          (warm) vs unlit (dark) per-instance color. This is the "glass"
          sitting inside each real punched opening above: semi-transparent
          now (rather than fully opaque) since the wall behind it is
          genuinely gone, not just covered. Positions are absolute world
          coords (x/z/y-from-ground) like every other sibling here, since
          this <group> carries no transform of its own. */}
      {windowInstances.length > 0 && (
        <instancedMesh
          args={[null as any, null as any, windowInstances.length]}
          onUpdate={(self) => {
            for (let i = 0; i < windowInstances.length; i++) {
              const w = windowInstances[i];
              _windowDummy.position.set(x + w.x, y + w.y, z + w.z);
              _windowDummy.rotation.set(0, w.rotationY, 0);
              _windowDummy.updateMatrix();
              self.setMatrixAt(i, _windowDummy.matrix);
              _windowColor.set(w.lit ? (Math.random() > 0.5 ? '#ffdb8c' : '#ffb37a') : '#131b24');
              self.setColorAt(i, _windowColor);
            }
            self.instanceMatrix.needsUpdate = true;
            if (self.instanceColor) self.instanceColor.needsUpdate = true;
          }}
        >
          <planeGeometry args={[1.3, 1.9]} />
          <meshBasicMaterial vertexColors toneMapped={false} transparent opacity={0.55} depthWrite={false} side={THREE.DoubleSide} />
        </instancedMesh>
      )}

      {/* Glass towers keep a subtle mullion/reflection grid instead of
          punched windows -- real curtain-wall glass reads as one
          continuous surface with thin frame lines, not individual holes. */}
      {style === 'glass' && (
        <mesh position={[x, y + height / 2, z]} scale={[1.005, 0.95, 1.005]}>
          <boxGeometry args={[width, height, depth]} />
          <meshStandardMaterial color="#111" emissive="#113344" emissiveIntensity={0.35} wireframe />
        </mesh>
      )}

      {/* Ground-floor plinth -- a darker, slightly wider band at street
          level standing in for a stone base / storefront glazing, so
          buildings don't look like they're extruded uniformly all the way
          down to the sidewalk. Split into the same front-left/front-right/
          back/left/right pieces as the wall colliders (door-height tall,
          not full height) so it doesn't visually paper back over the real
          entrance gap. */}
      <group position={[x, y, z]}>
        <mesh position={[(-halfW - 0.15 - doorHalf) / 2, BUILDING_DOOR_HEIGHT / 2, -halfD - 0.15]} castShadow receiveShadow>
          <boxGeometry args={[halfW + 0.15 - doorHalf, BUILDING_DOOR_HEIGHT, BUILDING_WALL_THICKNESS + 0.2]} />
          <meshStandardMaterial
            color={style === 'brick' ? '#3d2c24' : '#1c1f22'}
            roughness={0.6}
            metalness={style === 'glass' ? 0.4 : 0.15}
          />
        </mesh>
        <mesh position={[(doorHalf + halfW + 0.15) / 2, BUILDING_DOOR_HEIGHT / 2, -halfD - 0.15]} castShadow receiveShadow>
          <boxGeometry args={[halfW + 0.15 - doorHalf, BUILDING_DOOR_HEIGHT, BUILDING_WALL_THICKNESS + 0.2]} />
          <meshStandardMaterial
            color={style === 'brick' ? '#3d2c24' : '#1c1f22'}
            roughness={0.6}
            metalness={style === 'glass' ? 0.4 : 0.15}
          />
        </mesh>
        <mesh position={[0, BUILDING_DOOR_HEIGHT / 2, halfD + 0.15]} castShadow receiveShadow>
          <boxGeometry args={[width + 0.3, BUILDING_DOOR_HEIGHT, BUILDING_WALL_THICKNESS + 0.2]} />
          <meshStandardMaterial
            color={style === 'brick' ? '#3d2c24' : '#1c1f22'}
            roughness={0.6}
            metalness={style === 'glass' ? 0.4 : 0.15}
          />
        </mesh>
        <mesh position={[-halfW - 0.15, BUILDING_DOOR_HEIGHT / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[BUILDING_WALL_THICKNESS + 0.2, BUILDING_DOOR_HEIGHT, depth + 0.3]} />
          <meshStandardMaterial
            color={style === 'brick' ? '#3d2c24' : '#1c1f22'}
            roughness={0.6}
            metalness={style === 'glass' ? 0.4 : 0.15}
          />
        </mesh>
        <mesh position={[halfW + 0.15, BUILDING_DOOR_HEIGHT / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[BUILDING_WALL_THICKNESS + 0.2, BUILDING_DOOR_HEIGHT, depth + 0.3]} />
          <meshStandardMaterial
            color={style === 'brick' ? '#3d2c24' : '#1c1f22'}
            roughness={0.6}
            metalness={style === 'glass' ? 0.4 : 0.15}
          />
        </mesh>
      </group>

      {/* Entrance canopy -- thin overhang + two support posts over the
          main doors, only on wider non-glass buildings. */}
      {hasCanopy && (
        <group position={[x, y + 3.4, z - depth / 2 - 1.1]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[Math.min(width * 0.5, 8), 0.2, 2.2]} />
            <meshStandardMaterial color="#2a2a2a" roughness={0.5} metalness={0.4} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * Math.min(width * 0.5, 8) * 0.4, -1.6, 0.9]} castShadow>
              <cylinderGeometry args={[0.06, 0.06, 3.2, 6]} />
              <meshStandardMaterial color="#333" metalness={0.6} roughness={0.4} />
            </mesh>
          ))}
        </group>
      )}

      {/* Attached side annex/wing -- keeps every building from reading as
          one perfect extruded box. Purely exterior/decorative -- not part
          of the navigable interior above. */}
      {annex && (
        <group position={[x + annex.ox, y + annex.h / 2, z + annex.oz]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[annex.w, annex.h, annex.d]} />
            <meshStandardMaterial
              color={color}
              roughness={style === 'glass' ? 0.1 : style === 'brick' ? 0.85 : 0.6}
              metalness={style === 'glass' ? 0.9 : style === 'brick' ? 0.05 : 0.25}
            />
          </mesh>
        </group>
      )}

      {/* Green Roof */}
      {hasGreenRoof && (
        <group position={[x + pieceACenterX, y + height + BUILDING_WALL_THICKNESS, z]}>
          <mesh receiveShadow position={[0, 0.05, 0]}>
            <boxGeometry args={[pieceAWidth * 0.9, 0.1, depth * 0.9]} />
            <meshStandardMaterial color="#3a5a2a" />
          </mesh>
          {/* Small trees on roof */}
          <mesh position={[0, 1, 0]}>
            <cylinderGeometry args={[0, 1.5, 3, 4]} />
            <meshStandardMaterial color="#2d4a1e" />
          </mesh>
        </group>
      )}

      {/* Tiered setback + spire -- breaks up the silhouette of the tallest
          towers instead of every skyscraper being one plain extruded box. */}
      {hasSetbackTier && (
        <group position={[x + pieceACenterX, y + height, z]}>
          <mesh castShadow receiveShadow position={[0, height * 0.06, 0]}>
            <boxGeometry args={[pieceAWidth * 0.8, height * 0.12, depth * 0.6]} />
            <meshStandardMaterial color={color} roughness={0.5} metalness={0.3} />
          </mesh>
          <mesh position={[0, height * 0.12 + height * 0.08, 0]}>
            <cylinderGeometry args={[0.15, 0.3, height * 0.16, 6]} />
            <meshStandardMaterial color="#999" roughness={0.4} metalness={0.6} />
          </mesh>
          <mesh position={[0, height * 0.12 + height * 0.16 + 0.4, 0]}>
            <sphereGeometry args={[0.25, 8, 8]} />
            <meshStandardMaterial color="#ff3333" emissive="#ff2222" emissiveIntensity={1.2} />
          </mesh>
        </group>
      )}

      {/* Rooftop water tank / AC units -- cheap variety for mid-height
          buildings that get neither the green roof nor the setback tier. */}
      {hasRoofUnits && (
        <group position={[x + pieceACenterX, y + height + 0.1, z]}>
          <mesh position={[pieceAWidth * 0.2, height * 0.05, depth * 0.2]} castShadow>
            <cylinderGeometry args={[pieceAWidth * 0.15, pieceAWidth * 0.15, height * 0.1, 8]} />
            <meshStandardMaterial color="#6b6b6b" roughness={0.7} metalness={0.3} />
          </mesh>
          <mesh position={[-pieceAWidth * 0.2, height * 0.025, -depth * 0.18]} castShadow>
            <boxGeometry args={[pieceAWidth * 0.25, height * 0.05, depth * 0.18]} />
            <meshStandardMaterial color="#444" roughness={0.6} />
          </mesh>
        </group>
      )}
    </group>
  );
};

// cespugli di cortili e piazze (sfere instanziate, raggio 1 scalato)
const _bushGeo = new THREE.SphereGeometry(1, 10, 8);
const _bushMat = new THREE.MeshStandardMaterial({ color: '#1d3a0e' });
const _plazaBushMat = new THREE.MeshStandardMaterial({ color: '#2d4a1e' });

const GreenCourtyard: React.FC<{ x: number; z: number; treeTemplates: TreeTemplate[] }> = ({ x, z, treeTemplates }) => {
  const y = getTerrainHeight(x, z);
  // Real ez-tree trees, same as Park.tsx's own -- "le aree verdi devono
  // avere la vegetazione del parco". Placed here (world x/z = courtyard
  // center + a small random offset) rather than nested inside the local
  // <group> below, since TreeInstance looks its own ground height up by
  // absolute world position (see ParkTrees.tsx). Stable per courtyard
  // (keyed on x/z) so trees don't reshuffle every re-render.
  const trees = useMemo(() => {
    if (treeTemplates.length === 0) return [];
    const count = 3 + Math.floor(Math.random() * 2); // 3-4 per courtyard
    const result: Array<{ x: number; z: number; rotationY: number; scale: number; templateIndex: number }> = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.6;
      const dist = 5 + Math.random() * 2.5;
      result.push({
        x: x + Math.cos(angle) * dist,
        z: z + Math.sin(angle) * dist,
        rotationY: Math.random() * Math.PI * 2,
        scale: 0.22 * (0.8 + Math.random() * 0.5),
        templateIndex: Math.floor(Math.random() * treeTemplates.length),
      });
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, z, treeTemplates.length]);

  return (
    <>
      <group position={[x, y, z]}>
        <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[20, 20]} />
          <meshStandardMaterial color="#2d4a1e" />
        </mesh>
      </group>
      {/* cespugli, in blocco */}
      <StaticInstances
        name="bushes"
        geometry={_bushGeo}
        material={_bushMat}
        items={[...Array(5)].map((_, i) => ({ x: x + Math.sin(i) * 6, y: y + 0.5, z: z + Math.cos(i) * 6 }))}
      />
      {/* Real grass (same pmndrs shader-ported blades as Park.tsx,
                see RealGrass.tsx/GrassMaterial.ts for attribution) +
                flowers, same deal as the trees above -- "le aree verdi
                devono avere la vegetazione del parco" (and "hai
                dimenticato l'erba e i fiori"), upgraded from the flat
                mock-shader GrassPatch to match the park ("mettilo al
                posto dell'altro grass"). Bounds match the 20x20 courtyard
                plane above; counts scaled down proportionally from Park's
                own 51x51 area. */}
      <RealGrassPatch minX={x - 10} maxX={x + 10} minZ={z - 10} maxZ={z + 10} instances={700} />
      <Flowers minX={x - 10} maxX={x + 10} minZ={z - 10} maxZ={z + 10} count={12} />
      {trees.map((t, i) => (
        <TreeInstance key={i} x={t.x} z={t.z} rotationY={t.rotationY} scale={t.scale} template={treeTemplates[t.templateIndex]} />
      ))}
    </>
  );
};

// --- Caricamento a zone dei palazzi ---------------------------------------
// Solo i palazzi vicini (al giocatore o alla telecamera) sono "veri":
// muri coi buchi delle finestre, interni, scale, collider dettagliati. Gli
// altri sono il modello semplificato instanziato (FarBuildings). Isteresi
// tra le due distanze per non montare/smontare avanti e indietro sul
// confine; al massimo un palazzo caricato per controllo (4 al secondo) per
// spalmare il costo di creazione su piu' frame.
const BUILDING_LOAD_DIST = 55;
const BUILDING_UNLOAD_DIST = 75;
const BUILDING_CHECK_S = 0.25;

const footprintDist = (b: CityBuildingRecord, px: number, pz: number) => {
  const dx = Math.max(0, Math.abs(px - b.x) - b.w / 2);
  const dz = Math.max(0, Math.abs(pz - b.z) - b.d / 2);
  return Math.hypot(dx, dz);
};

// modello da lontano di ogni palazzo: corpo + annesso + terrazzo in cima
const farItemsFor = (b: CityBuildingRecord, i: number): FarBuildingItem[] => {
  const det = getBuildingDetails(i);
  const roughness = b.style === 'glass' ? 0.1 : b.style === 'brick' ? 0.85 : 0.6;
  const metalness = b.style === 'glass' ? 0.9 : b.style === 'brick' ? 0.05 : 0.25;
  const spacing = 3.4;
  const base: Omit<FarBuildingItem, 'key' | 'x' | 'y' | 'z' | 'w' | 'h' | 'd' | 'kind' | 'collider'> = {
    color: b.color,
    countW: Math.min(6, Math.max(1, Math.floor(b.w / spacing) - 1)),
    countD: Math.min(6, Math.max(1, Math.floor(b.d / spacing) - 1)),
    floorHeight: b.floorHeight,
    numFloors: b.numFloors,
    roughness,
    metalness,
    plinth: b.style === 'brick' ? '#3d2c24' : '#1c1f22',
    seed: i * 7.31,
  };
  const out: FarBuildingItem[] = [
    {
      ...base,
      key: `b${i}`,
      x: b.x,
      y: b.by,
      z: b.z,
      w: b.w,
      h: b.h + BUILDING_WALL_THICKNESS,
      d: b.d,
      kind: b.style === 'glass' ? 1 : 0,
      collider: true,
    },
  ];
  if (det.annex) {
    const a = det.annex;
    out.push({ ...base, key: `a${i}`, x: b.x + a.ox, y: b.by, z: b.z + a.oz, w: a.w, h: a.h, d: a.d, kind: 2, collider: true });
  }
  if (det.hasSetbackTier) {
    const { holeMinX, holeMaxX, sx } = getHoleBounds(b.w, b.d, b.corner);
    const aMin = sx < 0 ? holeMaxX : -b.w / 2;
    const aMax = sx < 0 ? b.w / 2 : holeMinX;
    out.push({
      ...base,
      key: `s${i}`,
      x: b.x + (aMin + aMax) / 2,
      y: b.by + b.h,
      z: b.z,
      w: (aMax - aMin) * 0.8,
      h: b.h * 0.12,
      d: b.d * 0.6,
      kind: 2,
      roughness: 0.5,
      metalness: 0.3,
      collider: false,
    });
  }
  return out;
};

const MemoBuilding = React.memo(Building);

const BuildingsStreamer: React.FC = () => {
  const { buildings } = CITY_LAYOUT;
  const allFar = useMemo(() => buildings.map((b, i) => farItemsFor(b, i)), [buildings]);
  const nearest = (px: number, pz: number, qx: number, qz: number, b: CityBuildingRecord) =>
    Math.min(footprintDist(b, px, pz), footprintDist(b, qx, qz));
  const [near, setNear] = useState<number[]>(() => {
    const pp = useStore.getState().playerPos;
    return buildings.map((b, i) => (footprintDist(b, pp[0], pp[2]) < BUILDING_LOAD_DIST ? i : -1)).filter((i) => i >= 0);
  });
  const nearRef = useRef(new Set(near));
  const acc = useRef(0);

  useFrame((state, dt) => {
    acc.current += dt;
    if (acc.current < BUILDING_CHECK_S) return;
    acc.current = 0;
    const cam = state.camera.position;
    const pp = useStore.getState().playerPos;
    const cur = nearRef.current;
    let changed = false;
    for (const i of [...cur]) {
      if (nearest(pp[0], pp[2], cam.x, cam.z, buildings[i]) > BUILDING_UNLOAD_DIST) {
        cur.delete(i);
        changed = true;
      }
    }
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < buildings.length; i++) {
      if (cur.has(i)) continue;
      const d = nearest(pp[0], pp[2], cam.x, cam.z, buildings[i]);
      // dentro o quasi (teletrasporto, spawn): subito, senza aspettare il turno
      if (d < 8) {
        cur.add(i);
        changed = true;
        continue;
      }
      if (d < BUILDING_LOAD_DIST && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      cur.add(best);
      changed = true;
    }
    if (changed) setNear([...cur].sort((a, b) => a - b));
  });

  if (import.meta.env.DEV) (window as any).__buildingsNear = near;

  const nearSet = useMemo(() => new Set(near), [near]);
  const farItems = useMemo(() => allFar.filter((_, i) => !nearSet.has(i)).flat(), [allFar, nearSet]);

  return (
    <>
      <FarBuildings items={farItems} colliderGroups={BUILDING_WALL_GROUPS} />
      {near.map((i) => {
        const b = buildings[i];
        return (
          <MemoBuilding
            key={i}
            cacheKey={i}
            x={b.x}
            z={b.z}
            width={b.w}
            depth={b.d}
            height={b.h}
            color={b.color}
            style={b.style}
            corner={b.corner}
            numFloors={b.numFloors}
            floorHeight={b.floorHeight}
          />
        );
      })}
    </>
  );
};

const City: React.FC = () => {
  // Generated ONCE here and reused across every courtyard/plaza below --
  // ez-tree generation is the expensive part, not placement.
  const treeTemplates = useTreeTemplates();

  // Buildings/courtyards/plazas now come from the shared module-level
  // CITY_LAYOUT (see above) instead of a component-local useMemo.
  const { buildings, courtyards, plazas } = CITY_LAYOUT;

  return (
    <group>
      {courtyards.map((c, i) => (
        <GreenCourtyard key={`court-${i}`} x={c.x} z={c.z} treeTemplates={treeTemplates} />
      ))}
      {plazas.map((p, i) => (
        <React.Fragment key={`plaza-${i}`}>
          <group position={[p.x, getTerrainHeight(p.x, p.z), p.z]}>
            <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[45, 45]} />
              <meshStandardMaterial color="#3a5a2a" />
            </mesh>
            {/* Plaza details */}
            <mesh position={[0, 1, 0]}>
              <boxGeometry args={[4, 2, 4]} />
              <meshStandardMaterial color="#555" />
            </mesh>
          </group>
          <StaticInstances
            name="plaza-bushes"
            geometry={_bushGeo}
            material={_plazaBushMat}
            items={[...Array(8)].map((_, i) => ({
              x: p.x + Math.sin((i * Math.PI) / 4) * 15,
              y: getTerrainHeight(p.x, p.z) + 2,
              z: p.z + Math.cos((i * Math.PI) / 4) * 15,
              s: 2,
            }))}
          />
          {/* Same real pmndrs-ported grass as the courtyards above +
              flowers -- bounds match the 45x45 plaza plane, avoiding the
              central monument box. Density closer to Park's own (51x51 /
              8000 grass / 60 flowers) since plazas are nearly as big. */}
          <RealGrassPatch
            minX={p.x - 22}
            maxX={p.x + 22}
            minZ={p.z - 22}
            maxZ={p.z + 22}
            instances={3200}
            avoid={[{ x: p.x, z: p.z, radius: 4 }]}
          />
          <Flowers minX={p.x - 22} maxX={p.x + 22} minZ={p.z - 22} maxZ={p.z + 22} count={45} avoid={[{ x: p.x, z: p.z, radius: 4 }]} />
          {/* Real trees, same deal as GreenCourtyard above -- placed in
              absolute world coords (plaza center + offset), as siblings of
              the local group rather than nested inside it. */}
          {treeTemplates.length > 0 &&
            [...Array(6)].map((_, i) => {
              const angle = (i / 6) * Math.PI * 2;
              const dist = 10 + (i % 2) * 4;
              return (
                <TreeInstance
                  key={i}
                  x={p.x + Math.cos(angle) * dist}
                  z={p.z + Math.sin(angle) * dist}
                  rotationY={(angle * 3) % (Math.PI * 2)}
                  scale={0.22 * (0.8 + (((i * 37) % 10) / 10) * 0.5)}
                  template={treeTemplates[i % treeTemplates.length]}
                />
              );
            })}
        </React.Fragment>
      ))}
      <BuildingsStreamer />
    </group>
  );
};

export default City;
