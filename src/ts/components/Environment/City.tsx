import React, { useMemo } from 'react';
import * as THREE from 'three';
import { RigidBody, CuboidCollider } from '@react-three/rapier';
import { getTerrainHeight } from './Terrain';
import { getRoadOffset } from './Road';
import { CollisionGroups, groupsExcluding } from '../../enums/CollisionGroups';
import { useTreeTemplates, TreeInstance, TreeTemplate, Flowers } from './ParkTrees';
import { RealGrassPatch } from './RealGrass';

const _windowDummy = new THREE.Object3D();
const _windowColor = new THREE.Color();
const _slabDummy = new THREE.Object3D();
const _stairDummy = new THREE.Object3D();

const footprintOverlapsRoad = (x: number, z: number, width: number, depth: number): boolean => {
  const halfW = width / 2;
  const halfD = depth / 2;
  const samplePoints: [number, number][] = [
    [x, z],
    [x - halfW, z - halfD], [x + halfW, z - halfD],
    [x - halfW, z + halfD], [x + halfW, z + halfD],
    [x, z - halfD], [x, z + halfD], [x - halfW, z], [x + halfW, z],
  ];
  return samplePoints.some(([px, pz]) => getRoadOffset(px, pz) > 0);
};

// --- Explorable interiors --------------------------------------------------
// "rendi i palazzi esplorabili, piani e scale che portano fino al tetto".
//
// IMPORTANT architectural note (see git history / chat for the full
// investigation): Player.tsx does NOT get its vertical position from real
// Rapier contact response -- the character's ball collider excludes
// TrimeshColliders and its Y is entirely scripted every frame from
// `getTerrainHeight(x,z) + getRoadOffset(x,z)` (see Player.tsx's "2.
// Precise Ground & Slope Analysis"). So a physical floor-slab collider
// alone would NOT be walkable the way outdoor ground is -- the character
// would just hover/sink relative to whatever getTerrainHeight+getRoadOffset
// says, ignoring any collider underfoot. The only way to make building
// floors/stairs feel exactly as responsive as walking outside (immediate
// input response, working jump, no physics mushiness) is to teach that
// SAME ground-height system about buildings, exactly like getRoadOffset
// already extends it for roads/curbs.
//
// getBuildingHeightOffset(x, z, currentY) below is that extension: given
// the player's (x,z) and current Y (needed to disambiguate WHICH stacked
// floor applies, since a multi-story building has many valid Y values at
// the same x,z), it returns the walkable surface height at that point, or
// null if (x,z) isn't over a building (or is at ground-floor level, where
// deferring to normal terrain+road keeps outdoor behavior byte-identical).
// Player.tsx now calls this and prefers it over terrain+road when non-null.
//
// Only the WALLS get real Rapier colliders (to physically block walking
// through them, same as before -- just split into pieces with a door gap
// instead of one solid box). Floors/stairs/roof are pure height-field
// math, same mechanism as terrain, deliberately NOT physical colliders --
// consistent with the constraint above, and much cheaper (zero extra
// physics bodies for floors/stairs regardless of building height).
export const BUILDING_HOLE_SIZE = 2.4; // stairwell shaft footprint (square)
export const BUILDING_STAIR_WIDTH = 2.0; // < BUILDING_HOLE_SIZE, centered in it
export const BUILDING_DOOR_WIDTH = 2.4;
export const BUILDING_DOOR_HEIGHT = 3.2;
export const BUILDING_WALL_THICKNESS = 0.3;
export const BUILDING_SLAB_THICKNESS = 0.15;
const BUILDING_TARGET_FLOOR_HEIGHT = 4.2;

// Per-building floor count/spacing is derived (not a fixed 4.2 everywhere)
// so that floor numFloors always lands EXACTLY on the roof (height), with
// no leftover gap for a final "almost there" flight -- height/numFloors is
// usually very close to the 4.2 target anyway (buildings are 20-110 tall).
export const getBuildingNumFloors = (height: number): number =>
  Math.min(24, Math.max(1, Math.round(height / BUILDING_TARGET_FLOOR_HEIGHT)));

export interface CityBuildingRecord {
  x: number; z: number; w: number; d: number; h: number;
  color: string; style: 'modern' | 'glass' | 'brick';
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
// -- same trick Road.tsx uses for ROAD_OFFSETS. This is what lets
// getBuildingHeightOffset below be a plain, synchronous, hook-free function
// Player.tsx can import and call every frame, exactly like getRoadOffset:
// there's now one single canonical building layout, generated once,
// consumed both by <City>'s JSX and by this height function, instead of
// being trapped inside a React component's private render state.
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

  // "fai la citta piu piccola" -- 2 -> 1: a 3x3 block grid (8 built
  // blocks + the center park) instead of 5x5 (24 + park). Also directly
  // helps the ongoing perf work: roughly a third of the buildings, LED
  // trims/lights, parked cars and pedestrians as before.
  const gridRadius = 1;
  for (let i = -gridRadius; i <= gridRadius; i++) {
    for (let j = -gridRadius; j <= gridRadius; j++) {
      const blockX = i * gridSpacing + gridSpacing / 2;
      const blockZ = j * gridSpacing + gridSpacing / 2;

      if (i === 0 && j === 0) continue;

      // Plaza block coordinates must stay inside the (now smaller)
      // [-gridRadius, gridRadius] range -- these two are picked to sit on
      // opposite corners of the grid, same relative layout idea as before.
      if ((i === -1 && j === 1) || (i === 1 && j === -1)) {
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

        for (let attempt = 0; attempt < 12; attempt++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = 18 + Math.random() * 7;
          const x = blockX + Math.cos(angle) * dist;
          const z = blockZ + Math.sin(angle) * dist;

          if (!footprintOverlapsRoad(x, z, w, d)) {
            const numFloors = getBuildingNumFloors(h);
            bArr.push({
              x, z, w, d, h, color, style,
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

// Returns the walkable stairwell-hole bounds (LOCAL to the building, i.e.
// relative to its own x/z center) for a given corner index + footprint.
// Shared between the height function below and the Building component's
// own floor-slab/stair visuals -- both MUST agree exactly on this, or the
// stairs would be climbable in a spot that doesn't visually line up (or
// vice versa).
const getHoleBounds = (w: number, d: number, corner: number) => {
  const sx = corner % 2 === 0 ? -1 : 1;
  const sz = corner < 2 ? -1 : 1;
  const holeMinX = sx < 0 ? -w / 2 : w / 2 - BUILDING_HOLE_SIZE;
  const holeMinZ = sz < 0 ? -d / 2 : d / 2 - BUILDING_HOLE_SIZE;
  return {
    sx, sz,
    holeMinX, holeMaxX: holeMinX + BUILDING_HOLE_SIZE,
    holeMinZ, holeMaxZ: holeMinZ + BUILDING_HOLE_SIZE,
  };
};

// The extension to Player.tsx's ground-height system described in the big
// comment above. Deliberately mirrors getRoadOffset's shape (pure function
// of world position, no React/hooks) so Player.tsx can call it the exact
// same way. Returns null whenever the answer is "not applicable" (outside
// every building's footprint, OR standing at plain ground-floor level) so
// the caller falls back to its existing terrain+road logic unchanged.
export const getBuildingHeightOffset = (x: number, z: number, currentY: number): number | null => {
  for (const b of CITY_LAYOUT.buildings) {
    const halfW = b.w / 2;
    const halfD = b.d / 2;
    const lx = x - b.x;
    const lz = z - b.z;
    // Small margin so walls (0.3 thick, centered on the footprint edge)
    // don't create a dead band where neither "inside" nor "outside" logic
    // applies.
    if (lx < -halfW - 0.2 || lx > halfW + 0.2 || lz < -halfD - 0.2 || lz > halfD + 0.2) continue;

    const { holeMinX, holeMaxX, holeMinZ, holeMaxZ } = getHoleBounds(b.w, b.d, b.corner);
    const inHole = lx >= holeMinX && lx <= holeMaxX && lz >= holeMinZ && lz <= holeMaxZ;

    let best = b.by; // ground floor -- returning this unchanged signals "defer to terrain/road" below
    let bestDist = Math.abs(currentY - b.by);

    if (inHole) {
      // Continuous ramp: t=0 at the bottom of a flight (previous floor
      // level), t=1 at the top (next floor level) -- same mechanism
      // terrain slopes already use (a smooth function of position), so
      // Player.tsx's existing ground-snap climbs it exactly like a hill,
      // no dedicated "stair climbing" code needed.
      const t = THREE.MathUtils.clamp((lx - holeMinX) / BUILDING_HOLE_SIZE, 0, 1);
      for (let f = 0; f < b.numFloors; f++) {
        const candidate = b.by + (f + t) * b.floorHeight;
        const dist = Math.abs(currentY - candidate);
        if (dist < bestDist) { bestDist = dist; best = candidate; }
      }
    } else {
      for (let f = 1; f <= b.numFloors; f++) {
        const candidate = b.by + f * b.floorHeight;
        const dist = Math.abs(currentY - candidate);
        if (dist < bestDist) { bestDist = dist; best = candidate; }
      }
    }

    return best === b.by ? null : best;
  }
  return null;
};

const Building: React.FC<{ x: number, z: number, width: number, depth: number, height: number, color: string, style: 'modern' | 'glass' | 'brick', corner: number, numFloors: number, floorHeight: number }> = ({ x, z, width, depth, height, color, style, corner, numFloors, floorHeight }) => {
  const y = getTerrainHeight(x, z);
  const halfW = width / 2;
  const halfD = depth / 2;
  const doorHalf = BUILDING_DOOR_WIDTH / 2;

  // Stairwell hole + floor-slab piece geometry -- pure arithmetic (no
  // randomness), same formula as getHoleBounds/getBuildingHeightOffset
  // above, so what's rendered here always matches what's actually
  // walkable. Cheap enough to just recompute each render (no useMemo
  // needed, unlike the genuinely-random stuff below).
  const { holeMinX, holeMaxX, holeMinZ, holeMaxZ, sx, sz } = getHoleBounds(width, depth, corner);
  // Piece A: the big remainder of the floor plate, full depth, X range
  // excluding the hole's X band entirely.
  const pieceAMinX = sx < 0 ? holeMaxX : -halfW;
  const pieceAMaxX = sx < 0 ? halfW : holeMinX;
  const pieceAWidth = pieceAMaxX - pieceAMinX;
  const pieceACenterX = (pieceAMinX + pieceAMaxX) / 2;
  // Piece B: the strip alongside the hole (same X band as the hole, Z
  // range covering whatever the hole doesn't).
  const pieceBMinZ = sz < 0 ? holeMaxZ : -halfD;
  const pieceBMaxZ = sz < 0 ? halfD : holeMinZ;
  const pieceBDepth = pieceBMaxZ - pieceBMinZ;
  const pieceBCenterZ = (pieceBMinZ + pieceBMaxZ) / 2;
  const pieceBCenterX = (holeMinX + holeMaxX) / 2;
  const stairCenterX = (holeMinX + holeMaxX) / 2;
  const stairCenterZ = (holeMinZ + holeMaxZ) / 2;
  const hasLintel = height > BUILDING_DOOR_HEIGHT + 0.5;

  // Shared stair-flight geometry for this building -- identical for every
  // floor (only translated between floors), so ALL flights in this
  // building share one BoxGeometry via instancing. floorHeight varies
  // per-building (see getBuildingNumFloors), so this can't be shared
  // globally across buildings, only within one.
  const stairGeometry = useMemo(() => {
    const run = BUILDING_HOLE_SIZE;
    const rise = floorHeight;
    const length = Math.sqrt(run * run + rise * rise);
    const theta = Math.atan2(rise, run);
    const geo = new THREE.BoxGeometry(length, 0.2, BUILDING_STAIR_WIDTH);
    geo.rotateZ(theta);
    return geo;
  }, [floorHeight]);

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
  const details = useMemo(() => {
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
      const windowFloorCount = Math.max(0, numFloors - 1); // skip ground floor + roof
      const countW = Math.min(6, Math.max(1, Math.floor(width / spacing) - 1));
      const countD = Math.min(6, Math.max(1, Math.floor(depth / spacing) - 1));
      for (let f = 0; f < windowFloorCount; f++) {
        const wy = (f + 1) * floorHeight;
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

    return { hasGreenRoof, hasSetbackTier, hasRoofUnits, hasCanopy, annex, windowInstances };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { hasGreenRoof, hasSetbackTier, hasRoofUnits, hasCanopy, annex, windowInstances } = details;

  return (
    <group>
      {/* Structural walls -- used to be ONE solid CuboidCollider spanning
          the whole volume (fine when buildings were just static scenery).
          Now split into wall-only pieces (front-left/front-right around a
          real door gap, a lintel above it, back/left/right full) so the
          interior is actually walkable in -- floors/stairs/roof are NOT
          physical colliders at all (see the big comment above
          getBuildingHeightOffset for why), only these walls need to
          physically block horizontal movement, and they do that for every
          floor at once regardless of building height. */}
      <RigidBody
        type="fixed"
        colliders={false}
        position={[x, y, z]}
        collisionGroups={groupsExcluding(CollisionGroups.Default)}
      >
        <CuboidCollider
          args={[(halfW - doorHalf) / 2, height / 2, BUILDING_WALL_THICKNESS / 2]}
          position={[(-halfW - doorHalf) / 2, height / 2, -halfD]}
        />
        <CuboidCollider
          args={[(halfW - doorHalf) / 2, height / 2, BUILDING_WALL_THICKNESS / 2]}
          position={[(doorHalf + halfW) / 2, height / 2, -halfD]}
        />
        {hasLintel && (
          <CuboidCollider
            args={[doorHalf, (height - BUILDING_DOOR_HEIGHT) / 2, BUILDING_WALL_THICKNESS / 2]}
            position={[0, (BUILDING_DOOR_HEIGHT + height) / 2, -halfD]}
          />
        )}
        <CuboidCollider args={[halfW, height / 2, BUILDING_WALL_THICKNESS / 2]} position={[0, height / 2, halfD]} />
        <CuboidCollider args={[BUILDING_WALL_THICKNESS / 2, height / 2, halfD]} position={[-halfW, height / 2, 0]} />
        <CuboidCollider args={[BUILDING_WALL_THICKNESS / 2, height / 2, halfD]} position={[halfW, height / 2, 0]} />
      </RigidBody>

      {/* Main Structure -- same one solid box mesh as before (exterior
          look is unchanged), now DoubleSide so its INNER surface is also
          visible once you're standing inside the hollowed-out building --
          from in there this single box reads correctly as the surrounding
          shell (all 4 walls + ceiling/roof underside) without needing any
          separate interior lining geometry. */}
      <mesh castShadow receiveShadow position={[x, y + height / 2, z]}>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial
          color={color}
          roughness={style === 'glass' ? 0.1 : style === 'brick' ? 0.85 : 0.6}
          metalness={style === 'glass' ? 0.9 : style === 'brick' ? 0.05 : 0.25}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Real punched windows (modern/brick) -- one instanced mesh per
          building, lit (warm) vs unlit (dark) per-instance color, replaces
          the old flat random-wireframe-box fake. Positions are absolute
          world coords (x/z/y-from-ground) like every other sibling here,
          since this <group> carries no transform of its own. */}
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
          <meshBasicMaterial vertexColors toneMapped={false} />
        </instancedMesh>
      )}

      {/* Glass towers keep a subtle mullion/reflection grid instead of
          punched windows -- real curtain-wall glass reads as one
          continuous surface with thin frame lines, not individual holes. */}
      {style === 'glass' && (
        <mesh position={[x, y + height / 2, z]} scale={[1.005, 0.95, 1.005]}>
           <boxGeometry args={[width, height, depth]} />
           <meshStandardMaterial 
              color="#111" 
              emissive="#113344" 
              emissiveIntensity={0.35}
              wireframe 
           />
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
          <boxGeometry args={[(halfW + 0.15) - doorHalf, BUILDING_DOOR_HEIGHT, BUILDING_WALL_THICKNESS + 0.2]} />
          <meshStandardMaterial color={style === 'brick' ? '#3d2c24' : '#1c1f22'} roughness={0.6} metalness={style === 'glass' ? 0.4 : 0.15} />
        </mesh>
        <mesh position={[(doorHalf + halfW + 0.15) / 2, BUILDING_DOOR_HEIGHT / 2, -halfD - 0.15]} castShadow receiveShadow>
          <boxGeometry args={[(halfW + 0.15) - doorHalf, BUILDING_DOOR_HEIGHT, BUILDING_WALL_THICKNESS + 0.2]} />
          <meshStandardMaterial color={style === 'brick' ? '#3d2c24' : '#1c1f22'} roughness={0.6} metalness={style === 'glass' ? 0.4 : 0.15} />
        </mesh>
        <mesh position={[0, BUILDING_DOOR_HEIGHT / 2, halfD + 0.15]} castShadow receiveShadow>
          <boxGeometry args={[width + 0.3, BUILDING_DOOR_HEIGHT, BUILDING_WALL_THICKNESS + 0.2]} />
          <meshStandardMaterial color={style === 'brick' ? '#3d2c24' : '#1c1f22'} roughness={0.6} metalness={style === 'glass' ? 0.4 : 0.15} />
        </mesh>
        <mesh position={[-halfW - 0.15, BUILDING_DOOR_HEIGHT / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[BUILDING_WALL_THICKNESS + 0.2, BUILDING_DOOR_HEIGHT, depth + 0.3]} />
          <meshStandardMaterial color={style === 'brick' ? '#3d2c24' : '#1c1f22'} roughness={0.6} metalness={style === 'glass' ? 0.4 : 0.15} />
        </mesh>
        <mesh position={[halfW + 0.15, BUILDING_DOOR_HEIGHT / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[BUILDING_WALL_THICKNESS + 0.2, BUILDING_DOOR_HEIGHT, depth + 0.3]} />
          <meshStandardMaterial color={style === 'brick' ? '#3d2c24' : '#1c1f22'} roughness={0.6} metalness={style === 'glass' ? 0.4 : 0.15} />
        </mesh>
      </group>

      {/* Interior floor slabs -- visual only (see the big comment above
          getBuildingHeightOffset for why these carry no collider), an
          L-shaped pair of instanced boxes per floor level leaving the
          stairwell hole open, stacked for every intermediate floor (the
          ground floor is bare terrain, the top level is the roof -- both
          already otherwise represented). */}
      {numFloors > 1 && (
        <>
          <instancedMesh
            args={[null as any, null as any, numFloors - 1]}
            onUpdate={(self) => {
              for (let f = 1; f < numFloors; f++) {
                _slabDummy.position.set(x + pieceACenterX, y + f * floorHeight, z);
                _slabDummy.updateMatrix();
                self.setMatrixAt(f - 1, _slabDummy.matrix);
              }
              self.instanceMatrix.needsUpdate = true;
            }}
          >
            <boxGeometry args={[pieceAWidth, BUILDING_SLAB_THICKNESS, depth]} />
            <meshStandardMaterial color="#4a4a4a" roughness={0.85} />
          </instancedMesh>
          <instancedMesh
            args={[null as any, null as any, numFloors - 1]}
            onUpdate={(self) => {
              for (let f = 1; f < numFloors; f++) {
                _slabDummy.position.set(x + pieceBCenterX, y + f * floorHeight, z + pieceBCenterZ);
                _slabDummy.updateMatrix();
                self.setMatrixAt(f - 1, _slabDummy.matrix);
              }
              self.instanceMatrix.needsUpdate = true;
            }}
          >
            <boxGeometry args={[BUILDING_HOLE_SIZE, BUILDING_SLAB_THICKNESS, pieceBDepth]} />
            <meshStandardMaterial color="#4a4a4a" roughness={0.85} />
          </instancedMesh>
        </>
      )}

      {/* Interior stairs -- one straight flight per floor, stacked
          directly above each other inside the stairwell shaft (a
          simplification vs. a real switchback -- steeper than a real
          staircase, but this game's ground-snap movement climbs any
          continuous incline regardless of angle, so it's fully walkable).
          All flights in this building share one instanced geometry. */}
      <instancedMesh
        args={[null as any, null as any, numFloors]}
        onUpdate={(self) => {
          self.geometry = stairGeometry;
          for (let f = 0; f < numFloors; f++) {
            _stairDummy.position.set(x + stairCenterX, y + f * floorHeight + floorHeight / 2, z + stairCenterZ);
            _stairDummy.updateMatrix();
            self.setMatrixAt(f, _stairDummy.matrix);
          }
          self.instanceMatrix.needsUpdate = true;
        }}
      >
        <meshStandardMaterial color="#777" roughness={0.85} />
      </instancedMesh>

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
        <RigidBody
          type="fixed"
          colliders={false}
          position={[x + annex.ox, y + annex.h / 2, z + annex.oz]}
          collisionGroups={groupsExcluding(CollisionGroups.Default)}
        >
          <CuboidCollider args={[annex.w / 2, annex.h / 2, annex.d / 2]} />
          <mesh castShadow receiveShadow>
            <boxGeometry args={[annex.w, annex.h, annex.d]} />
            <meshStandardMaterial
              color={color}
              roughness={style === 'glass' ? 0.1 : style === 'brick' ? 0.85 : 0.6}
              metalness={style === 'glass' ? 0.9 : style === 'brick' ? 0.05 : 0.25}
            />
          </mesh>
        </RigidBody>
      )}

      {/* Green Roof */}
      {hasGreenRoof && (
        <group position={[x, y + height + 0.1, z]}>
            <mesh receiveShadow>
                <boxGeometry args={[width * 0.9, 0.2, depth * 0.9]} />
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
        <group position={[x, y + height, z]}>
            <mesh castShadow receiveShadow position={[0, height * 0.06, 0]}>
                <boxGeometry args={[width * 0.6, height * 0.12, depth * 0.6]} />
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
        <group position={[x, y + height + 0.1, z]}>
            <mesh position={[width * 0.25, height * 0.05, depth * 0.2]} castShadow>
                <cylinderGeometry args={[width * 0.12, width * 0.12, height * 0.1, 8]} />
                <meshStandardMaterial color="#6b6b6b" roughness={0.7} metalness={0.3} />
            </mesh>
            <mesh position={[-width * 0.22, height * 0.025, -depth * 0.18]} castShadow>
                <boxGeometry args={[width * 0.18, height * 0.05, depth * 0.18]} />
                <meshStandardMaterial color="#444" roughness={0.6} />
            </mesh>
        </group>
      )}
    </group>
  );
};

const GreenCourtyard: React.FC<{ x: number, z: number, treeTemplates: TreeTemplate[] }> = ({ x, z, treeTemplates }) => {
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
                <mesh receiveShadow rotation={[-Math.PI/2, 0, 0]}>
                    <planeGeometry args={[20, 20]} />
                    <meshStandardMaterial color="#2d4a1e" />
                </mesh>
                {/* Some bushes */}
                {[...Array(5)].map((_, i) => (
                    <mesh key={i} position={[Math.sin(i) * 6, 0.5, Math.cos(i) * 6]}>
                        <sphereGeometry args={[1, 8, 8]} />
                        <meshStandardMaterial color="#1d3a0e" />
                    </mesh>
                ))}
            </group>
            {/* Real grass (same pmndrs shader-ported blades as Park.tsx,
                see RealGrass.tsx/GrassMaterial.ts for attribution) +
                flowers, same deal as the trees above -- "le aree verdi
                devono avere la vegetazione del parco" (and "hai
                dimenticato l'erba e i fiori"), upgraded from the flat
                mock-shader GrassPatch to match the park ("mettilo al
                posto dell'altro grass"). Bounds match the 20x20 courtyard
                plane above; counts scaled down proportionally from Park's
                own 51x51 area. */}
            <RealGrassPatch
                minX={x - 10}
                maxX={x + 10}
                minZ={z - 10}
                maxZ={z + 10}
                instances={700}
            />
            <Flowers
                minX={x - 10}
                maxX={x + 10}
                minZ={z - 10}
                maxZ={z + 10}
                count={12}
            />
            {trees.map((t, i) => (
                <TreeInstance
                    key={i}
                    x={t.x}
                    z={t.z}
                    rotationY={t.rotationY}
                    scale={t.scale}
                    template={treeTemplates[t.templateIndex]}
                />
            ))}
        </>
    );
};

const City: React.FC = () => {
  // Generated ONCE here and reused across every courtyard/plaza below --
  // ez-tree generation is the expensive part, not placement.
  const treeTemplates = useTreeTemplates();

  // Buildings/courtyards/plazas now come from the shared module-level
  // CITY_LAYOUT (see above) instead of a component-local useMemo, so
  // getBuildingHeightOffset can read the exact same data Player.tsx needs.
  const { buildings, courtyards, plazas } = CITY_LAYOUT;

  return (
    <group>
      {courtyards.map((c, i) => (
        <GreenCourtyard key={`court-${i}`} x={c.x} z={c.z} treeTemplates={treeTemplates} />
      ))}
      {plazas.map((p, i) => (
        <React.Fragment key={`plaza-${i}`}>
          <group position={[p.x, getTerrainHeight(p.x, p.z), p.z]}>
              <mesh receiveShadow rotation={[-Math.PI/2, 0, 0]}>
                  <planeGeometry args={[45, 45]} />
                  <meshStandardMaterial color="#3a5a2a" />
              </mesh>
              {/* Plaza details */}
              <mesh position={[0, 1, 0]}>
                  <boxGeometry args={[4, 2, 4]} />
                  <meshStandardMaterial color="#555" />
              </mesh>
              {[...Array(8)].map((_, i) => (
                  <mesh key={i} position={[Math.sin(i * Math.PI/4) * 15, 2, Math.cos(i * Math.PI/4) * 15]}>
                      <sphereGeometry args={[2, 12, 12]} />
                      <meshStandardMaterial color="#2d4a1e" />
                  </mesh>
              ))}
          </group>
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
          <Flowers
              minX={p.x - 22}
              maxX={p.x + 22}
              minZ={p.z - 22}
              maxZ={p.z + 22}
              count={45}
              avoid={[{ x: p.x, z: p.z, radius: 4 }]}
          />
          {/* Real trees, same deal as GreenCourtyard above -- placed in
              absolute world coords (plaza center + offset), as siblings of
              the local group rather than nested inside it. */}
          {treeTemplates.length > 0 && [...Array(6)].map((_, i) => {
              const angle = (i / 6) * Math.PI * 2;
              const dist = 10 + (i % 2) * 4;
              return (
                  <TreeInstance
                      key={i}
                      x={p.x + Math.cos(angle) * dist}
                      z={p.z + Math.sin(angle) * dist}
                      rotationY={(angle * 3) % (Math.PI * 2)}
                      scale={0.22 * (0.8 + ((i * 37) % 10) / 10 * 0.5)}
                      template={treeTemplates[i % treeTemplates.length]}
                  />
              );
          })}
        </React.Fragment>
      ))}
      {buildings.map((b, i) => (
        <Building
          key={i}
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
      ))}
    </group>
  );
};

export default City;
