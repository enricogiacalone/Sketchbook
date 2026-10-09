import React, { useMemo, useState, useCallback, useEffect } from 'react';
import * as THREE from 'three';
import { RigidBody, CuboidCollider, CylinderCollider } from '@react-three/rapier';
import { StaticInstances, type InstanceXform } from './StaticInstances';
import { useStaticBoxes, type StaticBox } from './staticColliders';
import { getTerrainHeight } from './Terrain';
import { getRoadOffset, ROAD_WIDTH, SIDEWALK_WIDTH } from './Road';
import { CollisionGroups, groupsExcluding } from '../../enums/CollisionGroups';
import Crowd from '../city/CityCrowd';
import VideoBillboardScreen from './VideoBillboardScreen';
import Car from '../Vehicles/Car';
import { worldRng } from '../../lib/worldSeed';

// Street-level detail pass -- benches/trash cans/hydrants/signs along the
// sidewalks, plus a few statically-parked cars tucked against the curb.
// Reuses City.tsx's own block grid (same gridSpacing/gridRadius/skip rules)
// so this stuff only shows up where there's actually a city block to
// belong to, not scattered across the empty outer ring of the road grid.
const GRID_SPACING = 60;
const GRID_RADIUS = 2; // matches City.tsx's gridRadius
const BLOCK_HALF = GRID_SPACING / 2;
// Distance from a road's centerline to the middle of its sidewalk band --
// mirrors the sidewalkOuter/SIDEWALK_HEIGHT math in Road.tsx's
// getRoadOffset, just centered on the band instead of its outer edge.
const SIDEWALK_CENTER_OFFSET = ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2;
// How far items sit along a block edge from its center, and how close to a
// corner (crosswalk territory -- see Road.tsx's Crosswalk, stripes reach
// ROAD_WIDTH/2 + 2 + 4 out from the intersection) anything is allowed to get.
const EDGE_SLOT_OFFSET = 12;

const isSkippedBlock = (i: number, j: number): boolean =>
  (i === 0 && j === 0) || // park
  (i === -2 && j === 2) || // plaza -- matches City.tsx's CITY_LAYOUT.plazas
  (i === 2 && j === -2); // plaza

// --- Small street props -----------------------------------------------

// Arredo dei marciapiedi disegnato in blocco: idranti, cestini, cartelli e
// panchine di tutta la citta' in una draw call per parte e per zona
// (StaticInstances) invece di 3-4 mesh a testa; i collider tutti in un corpo
// solo, creati in blocco (staticColliders). Stesse forme, colori e quote di
// prima.
type Furniture = { kind: 'bench' | 'trash' | 'hydrant' | 'sign'; x: number; z: number; rotationY: number; color?: string };

const FURN_GROUPS = groupsExcluding(CollisionGroups.Default);
const G = {
  hydrantBody: new THREE.CylinderGeometry(0.13, 0.16, 0.5, 8),
  hydrantTop: new THREE.SphereGeometry(0.14, 8, 8),
  hydrantNozzle: new THREE.CylinderGeometry(0.05, 0.05, 0.16, 6),
  trashBody: new THREE.CylinderGeometry(0.24, 0.2, 0.7, 10),
  trashLid: new THREE.CylinderGeometry(0.25, 0.25, 0.04, 10),
  signPole: new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6),
  signPanel: new THREE.BoxGeometry(0.6, 0.5, 0.04),
  benchSeat: new THREE.BoxGeometry(2, 0.15, 0.6),
  benchBack: new THREE.BoxGeometry(2, 0.6, 0.15),
  benchLeg: new THREE.BoxGeometry(0.15, 0.3, 0.6),
};
const M = {
  hydrant: new THREE.MeshStandardMaterial({ color: '#c62828', roughness: 0.5, metalness: 0.2 }),
  hydrantNozzle: new THREE.MeshStandardMaterial({ color: '#8e0000' }),
  trash: new THREE.MeshStandardMaterial({ color: '#3a4a3a', roughness: 0.8, metalness: 0.1 }),
  dark: new THREE.MeshStandardMaterial({ color: '#222' }),
  signPole: new THREE.MeshStandardMaterial({ color: '#999', metalness: 0.5, roughness: 0.4 }),
  signPanel: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4 }),
  wood: new THREE.MeshStandardMaterial({ color: '#5d4037', roughness: 0.9 }),
  benchLeg: new THREE.MeshStandardMaterial({ color: '#333' }),
};

const _base = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
// matrice del pezzo: posa dell'oggetto (x, y, z, rotazione Y) * posa locale del pezzo
const part = (
  x: number,
  y: number,
  z: number,
  ry: number,
  lx: number,
  ly: number,
  lz: number,
  lrx = 0,
  lrz = 0,
  color?: string
): InstanceXform => {
  _base.makeRotationY(ry).setPosition(x, y, z);
  _local.makeRotationFromEuler(_e.set(lrx, 0, lrz)).setPosition(lx, ly, lz);
  return { x, y, z, m: new THREE.Matrix4().multiplyMatrices(_base, _local), color };
};

const StreetFurniture: React.FC<{ furniture: Furniture[] }> = ({ furniture }) => {
  const d = useMemo(() => {
    const L: Record<string, InstanceXform[]> = {
      hydrantBody: [],
      hydrantTop: [],
      hydrantNozzle: [],
      trashBody: [],
      trashLid: [],
      signPole: [],
      signPanel: [],
      benchSeat: [],
      benchBack: [],
      benchLeg: [],
    };
    const boxes: StaticBox[] = [];
    for (const f of furniture) {
      const y = getTerrainHeight(f.x, f.z) + getRoadOffset(f.x, f.z);
      if (f.kind === 'hydrant') {
        L.hydrantBody.push(part(f.x, y, f.z, 0, 0, 0.25, 0));
        L.hydrantTop.push(part(f.x, y, f.z, 0, 0, 0.53, 0));
        L.hydrantNozzle.push(part(f.x, y, f.z, 0, 0.16, 0.3, 0, 0, Math.PI / 2));
        boxes.push({ shape: 'cylinder', half: [0.25, 0.15, 0], pos: [f.x, y + 0.25, f.z], groups: FURN_GROUPS });
      } else if (f.kind === 'trash') {
        L.trashBody.push(part(f.x, y, f.z, 0, 0, 0.35, 0));
        L.trashLid.push(part(f.x, y, f.z, 0, 0, 0.71, 0));
        boxes.push({ shape: 'cylinder', half: [0.35, 0.22, 0], pos: [f.x, y + 0.35, f.z], groups: FURN_GROUPS });
      } else if (f.kind === 'sign') {
        L.signPole.push(part(f.x, y, f.z, f.rotationY, 0, 1.1, 0));
        L.signPanel.push(part(f.x, y, f.z, f.rotationY, 0, 2.45, 0, 0, 0, f.color ?? '#1565c0'));
        boxes.push({ shape: 'cylinder', half: [1.1, 0.05, 0], pos: [f.x, y + 1.1, f.z], groups: FURN_GROUPS });
      } else {
        L.benchSeat.push(part(f.x, y, f.z, f.rotationY, 0, 0.4, 0));
        L.benchBack.push(part(f.x, y, f.z, f.rotationY, 0, 0.5, -0.26, Math.PI / 2));
        L.benchLeg.push(part(f.x, y, f.z, f.rotationY, -0.85, 0.15, 0));
        L.benchLeg.push(part(f.x, y, f.z, f.rotationY, 0.85, 0.15, 0));
        _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.rotationY);
        boxes.push({ half: [1, 0.4, 0.4], pos: [f.x, y + 0.4, f.z], rot: [_q.x, _q.y, _q.z, _q.w], groups: FURN_GROUPS });
      }
    }
    return { L, boxes };
  }, [furniture]);
  useStaticBoxes([0, 0, 0], d.boxes);
  const { L } = d;
  return (
    <>
      <StaticInstances name="hydrants" geometry={G.hydrantBody} material={M.hydrant} items={L.hydrantBody} castShadow receiveShadow />
      <StaticInstances geometry={G.hydrantTop} material={M.hydrant} items={L.hydrantTop} castShadow />
      <StaticInstances geometry={G.hydrantNozzle} material={M.hydrantNozzle} items={L.hydrantNozzle} castShadow />
      <StaticInstances name="trash" geometry={G.trashBody} material={M.trash} items={L.trashBody} castShadow receiveShadow />
      <StaticInstances geometry={G.trashLid} material={M.dark} items={L.trashLid} />
      <StaticInstances name="signs" geometry={G.signPole} material={M.signPole} items={L.signPole} castShadow receiveShadow />
      <StaticInstances geometry={G.signPanel} material={M.signPanel} items={L.signPanel} castShadow />
      <StaticInstances name="benches" geometry={G.benchSeat} material={M.wood} items={L.benchSeat} castShadow receiveShadow />
      <StaticInstances geometry={G.benchBack} material={M.wood} items={L.benchBack} castShadow />
      <StaticInstances geometry={G.benchLeg} material={M.benchLeg} items={L.benchLeg} castShadow />
    </>
  );
};

// --- Billboard -------------------------------------------------------------

const BILLBOARD_SCHEMES = [
  { bg: '#e53935', accent: '#ffffff' },
  { bg: '#1e88e5', accent: '#ffeb3b' },
  { bg: '#43a047', accent: '#ffffff' },
  { bg: '#fdd835', accent: '#212121' },
];

// Local mp4 files under public/videos/ -- same-origin, so they get real
// positional audio (Web Audio PannerNode, via VideoBillboardScreen.tsx)
// and play automatically with no click, neither of which a cross-origin
// YouTube embed could ever fully offer (see the comment at the top of
// VideoBillboardScreen.tsx for the full story). Drop your own files at
// these exact paths -- any that's missing just shows as a blank/black
// screen until it's added, everything else keeps working.
const BILLBOARD_VIDEO_SRCS = ['/videos/billboard-1.mp4', '/videos/billboard-2.mp4', '/videos/billboard-3.mp4', '/videos/billboard-4.mp4'];

// Freestanding ad panel on two poles, tall enough to read from down the
// street/while driving. Purely decorative -- schemeIndex just picks a
// color pair, there's no actual ad content/text (a canvas-texture label
// would be a nice follow-up, kept out of scope for this pass).
const Billboard: React.FC<{ x: number; z: number; rotationY: number; schemeIndex: number }> = ({ x, z, rotationY, schemeIndex }) => {
  const y = getTerrainHeight(x, z) + getRoadOffset(x, z);
  const scheme = BILLBOARD_SCHEMES[schemeIndex % BILLBOARD_SCHEMES.length];
  const panelWidth = 6;
  const panelHeight = 3;
  const poleHeight = 9;

  const videoSrc = BILLBOARD_VIDEO_SRCS[schemeIndex % BILLBOARD_VIDEO_SRCS.length];
  // The video screen's real-world footprint -- inset a bit from the full
  // panel so a border of the panel's own color still shows as a bezel.
  const screenWidth = panelWidth * 0.88;
  const screenHeight = panelHeight * 0.78;

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as any).__videoBillboards = (window as any).__videoBillboards || [];
    (window as any).__videoBillboards.push({ videoSrc, worldX: x, worldZ: z });
  }, []);

  return (
    <group position={[x, y, z]} rotation={[0, rotationY, 0]}>
      {[-panelWidth / 2 + 0.4, panelWidth / 2 - 0.4].map((px, i) => (
        <RigidBody
          key={i}
          type="fixed"
          colliders={false}
          position={[px, poleHeight / 2, 0]}
          collisionGroups={groupsExcluding(CollisionGroups.Default)}
        >
          <CylinderCollider args={[poleHeight / 2, 0.15]} />
          <mesh castShadow receiveShadow>
            <cylinderGeometry args={[0.15, 0.15, poleHeight, 8]} />
            <meshStandardMaterial color="#444" metalness={0.5} roughness={0.6} />
          </mesh>
        </RigidBody>
      ))}
      {/* Bezel -- the panel itself, now just a colored frame behind/around
          the actual video screen instead of being the "ad" itself. */}
      <mesh position={[0, poleHeight + panelHeight / 2, 0]} castShadow>
        <boxGeometry args={[panelWidth, panelHeight, 0.2]} />
        <meshStandardMaterial color={scheme.bg} emissive={scheme.bg} emissiveIntensity={0.3} roughness={0.5} />
      </mesh>
      {/* Back face keeps the old accent stripe -- a real second synced
          video player per billboard (for true both-sides readability)
          isn't worth doubling the YouTube API instances/network load for
          what's mostly seen from the road side anyway. */}
      <mesh position={[0, poleHeight + panelHeight / 2, -0.11]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[panelWidth * 0.8, panelHeight * 0.25]} />
        <meshStandardMaterial color={scheme.accent} emissive={scheme.accent} emissiveIntensity={0.8} />
      </mesh>
      <VideoBillboardScreen
        src={videoSrc}
        localPosition={[0, poleHeight + panelHeight / 2, 0.11]}
        width={screenWidth}
        height={screenHeight}
      />
    </group>
  );
};

// --- Layout ----------------------------------------------------------------

const SIGN_COLORS = ['#1565c0', '#2e7d32', '#f9a825', '#ef6c00'];

const CityDetails: React.FC = () => {
  const { furniture, parkedCars, billboards } = useMemo(() => {
    const furnitureArr: Array<{ kind: 'bench' | 'trash' | 'hydrant' | 'sign'; x: number; z: number; rotationY: number; color?: string }> =
      [];
    const carsArr: Array<{ x: number; z: number; rotationY: number }> = [];
    const billboardsArr: Array<{ x: number; z: number; rotationY: number; schemeIndex: number }> = [];
    let schemeCounter = 0;
    // sempre gli stessi a parita' di seme della citta' (lib/worldSeed.ts)
    const rnd = worldRng('city-details');

    for (let i = -GRID_RADIUS; i <= GRID_RADIUS; i++) {
      for (let j = -GRID_RADIUS; j <= GRID_RADIUS; j++) {
        if (isSkippedBlock(i, j)) continue;

        const blockX = i * GRID_SPACING + GRID_SPACING / 2;
        const blockZ = j * GRID_SPACING + GRID_SPACING / 2;

        // North edge (block-facing side of the road at blockZ-BLOCK_HALF):
        // a bench + trash can pair.
        {
          const edgeZ = blockZ - BLOCK_HALF + SIDEWALK_CENTER_OFFSET;
          const benchX = blockX - EDGE_SLOT_OFFSET + rnd() * 4;
          furnitureArr.push({ kind: 'bench', x: benchX, z: edgeZ, rotationY: Math.PI });
          furnitureArr.push({ kind: 'trash', x: benchX + 2.2, z: edgeZ, rotationY: 0 });
        }

        // South edge: a hydrant + street sign pair.
        {
          const edgeZ = blockZ + BLOCK_HALF - SIDEWALK_CENTER_OFFSET;
          const hydrantX = blockX + EDGE_SLOT_OFFSET - rnd() * 4;
          furnitureArr.push({ kind: 'hydrant', x: hydrantX, z: edgeZ, rotationY: 0 });
          furnitureArr.push({
            kind: 'sign',
            x: hydrantX - 2.5,
            z: edgeZ,
            rotationY: Math.PI / 2,
            color: SIGN_COLORS[Math.floor(rnd() * SIGN_COLORS.length)],
          });
        }

        // West/East edges: each has a chance of one parked car tucked
        // against the curb, oriented along the road (length along Z).
        if (rnd() < 0.6) {
          const edgeX = blockX - BLOCK_HALF + (ROAD_WIDTH / 2 - 0.9);
          const carZ = blockZ - EDGE_SLOT_OFFSET + rnd() * (EDGE_SLOT_OFFSET * 2);
          carsArr.push({ x: edgeX, z: carZ, rotationY: Math.PI / 2 });
        }
        if (rnd() < 0.6) {
          const edgeX = blockX + BLOCK_HALF - (ROAD_WIDTH / 2 - 0.9);
          const carZ = blockZ - EDGE_SLOT_OFFSET + rnd() * (EDGE_SLOT_OFFSET * 2);
          carsArr.push({ x: edgeX, z: carZ, rotationY: -Math.PI / 2 });
        }

        // Outer ring of the grid: a billboard on whichever edge faces
        // outward, so it's visible approaching the city from a distance.
        const isOuterI = Math.abs(i) === GRID_RADIUS;
        const isOuterJ = Math.abs(j) === GRID_RADIUS;
        if ((isOuterI || isOuterJ) && rnd() < 0.5) {
          let bx = blockX,
            bz = blockZ,
            rotationY = 0;
          if (isOuterI && i < 0) {
            bx = blockX - BLOCK_HALF + 3;
            rotationY = -Math.PI / 2;
          } else if (isOuterI && i > 0) {
            bx = blockX + BLOCK_HALF - 3;
            rotationY = Math.PI / 2;
          } else if (isOuterJ && j < 0) {
            bz = blockZ - BLOCK_HALF + 3;
            rotationY = Math.PI;
          } else {
            bz = blockZ + BLOCK_HALF - 3;
            rotationY = 0;
          }
          billboardsArr.push({ x: bx, z: bz, rotationY, schemeIndex: schemeCounter++ });
        }
      }
    }

    return { furniture: furnitureArr, parkedCars: carsArr, billboards: billboardsArr };
  }, []);

  return (
    <group>
      <StreetFurniture furniture={furniture} />
      {parkedCars.map((c, i) => (
        <Car
          key={`city-car-${i}`}
          id={`city-car-${i}`}
          // Spawned a bit above the curb/sidewalk surface, same convention
          // as Scene.tsx's own named cars (flat ground + clearance) --
          // real physics settle it the rest of the way, unlike the old
          // fixed ParkedCar this replaces which had to precompute its own
          // resting height by hand.
          position={[c.x, getTerrainHeight(c.x, c.z) + getRoadOffset(c.x, c.z) + 1.6, c.z]}
          rotation={[0, c.rotationY, 0]}
        />
      ))}
      {/* passanti: la folla (agenti leggeri + pool di corpi veri + sagome
          instanziate), vedi components/city/crowd.ts */}
      <Crowd />
      {billboards.map((b, i) => (
        <Billboard key={`bb-${i}`} x={b.x} z={b.z} rotationY={b.rotationY} schemeIndex={b.schemeIndex} />
      ))}
    </group>
  );
};

export default CityDetails;
