import React, { useMemo, useState, useCallback, useEffect } from 'react';
import * as THREE from 'three';
import { RigidBody, CuboidCollider, CylinderCollider } from '@react-three/rapier';
import { useGLTF } from '@react-three/drei';
import { getTerrainHeight } from './Terrain';
import { getRoadOffset, ROAD_WIDTH, SIDEWALK_WIDTH } from './Road';
import { CollisionGroups, groupsExcluding } from '../../enums/CollisionGroups';
import Pedestrian from './Pedestrian';
import Enemy from '../Enemy';
import VideoBillboardScreen from './VideoBillboardScreen';

// Street-level detail pass -- benches/trash cans/hydrants/signs along the
// sidewalks, plus a few statically-parked cars tucked against the curb.
// Reuses City.tsx's own block grid (same gridSpacing/gridRadius/skip rules)
// so this stuff only shows up where there's actually a city block to
// belong to, not scattered across the empty outer ring of the road grid.
const GRID_SPACING = 60;
const GRID_RADIUS = 2;
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
  (i === -2 && j === 1) || // plaza
  (i === 2 && j === -2); // plaza

// --- Small street props -----------------------------------------------

const FireHydrant: React.FC<{ x: number; z: number }> = ({ x, z }) => {
  const y = getTerrainHeight(x, z) + getRoadOffset(x, z);
  return (
    <RigidBody type="fixed" colliders={false} position={[x, y + 0.25, z]} collisionGroups={groupsExcluding(CollisionGroups.Default)}>
      <CylinderCollider args={[0.25, 0.15]} />
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[0.13, 0.16, 0.5, 8]} />
        <meshStandardMaterial color="#c62828" roughness={0.5} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.28, 0]} castShadow>
        <sphereGeometry args={[0.14, 8, 8]} />
        <meshStandardMaterial color="#c62828" roughness={0.5} />
      </mesh>
      <mesh position={[0.16, 0.05, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 0.16, 6]} />
        <meshStandardMaterial color="#8e0000" />
      </mesh>
    </RigidBody>
  );
};

const TrashCan: React.FC<{ x: number; z: number }> = ({ x, z }) => {
  const y = getTerrainHeight(x, z) + getRoadOffset(x, z);
  return (
    <RigidBody type="fixed" colliders={false} position={[x, y + 0.35, z]} collisionGroups={groupsExcluding(CollisionGroups.Default)}>
      <CylinderCollider args={[0.35, 0.22]} />
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[0.24, 0.2, 0.7, 10]} />
        <meshStandardMaterial color="#3a4a3a" roughness={0.8} metalness={0.1} />
      </mesh>
      <mesh position={[0, 0.36, 0]}>
        <cylinderGeometry args={[0.25, 0.25, 0.04, 10]} />
        <meshStandardMaterial color="#222" />
      </mesh>
    </RigidBody>
  );
};

const StreetSign: React.FC<{ x: number; z: number; rotationY: number; color: string }> = ({ x, z, rotationY, color }) => {
  const y = getTerrainHeight(x, z) + getRoadOffset(x, z);
  const poleHeight = 2.2;
  return (
    <group position={[x, y, z]} rotation={[0, rotationY, 0]}>
      <RigidBody type="fixed" colliders={false} position={[0, poleHeight / 2, 0]} collisionGroups={groupsExcluding(CollisionGroups.Default)}>
        <CylinderCollider args={[poleHeight / 2, 0.05]} />
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.05, 0.05, poleHeight, 6]} />
          <meshStandardMaterial color="#999" metalness={0.5} roughness={0.4} />
        </mesh>
      </RigidBody>
      <mesh position={[0, poleHeight + 0.25, 0]} castShadow>
        <boxGeometry args={[0.6, 0.5, 0.04]} />
        <meshStandardMaterial color={color} roughness={0.4} />
      </mesh>
    </group>
  );
};

// Compact bench -- a simpler cousin of Park.tsx's Bench (not exported from
// there), scaled down slightly so a pair fits comfortably in a sidewalk slot.
const SidewalkBench: React.FC<{ x: number; z: number; rotationY: number }> = ({ x, z, rotationY }) => {
  const y = getTerrainHeight(x, z) + getRoadOffset(x, z);
  return (
    <group position={[x, y, z]} rotation={[0, rotationY, 0]}>
      <RigidBody type="fixed" colliders={false} position={[0, 0.4, 0]} collisionGroups={groupsExcluding(CollisionGroups.Default)}>
        <CuboidCollider args={[1, 0.4, 0.4]} />
        <mesh castShadow receiveShadow>
          <boxGeometry args={[2, 0.15, 0.6]} />
          <meshStandardMaterial color="#5d4037" roughness={0.9} />
        </mesh>
      </RigidBody>
      <mesh position={[0, 0.5, -0.26]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <boxGeometry args={[2, 0.6, 0.15]} />
        <meshStandardMaterial color="#5d4037" roughness={0.9} />
      </mesh>
      <mesh position={[-0.85, 0.15, 0]} castShadow>
        <boxGeometry args={[0.15, 0.3, 0.6]} />
        <meshStandardMaterial color="#333" />
      </mesh>
      <mesh position={[0.85, 0.15, 0]} castShadow>
        <boxGeometry args={[0.15, 0.3, 0.6]} />
        <meshStandardMaterial color="#333" />
      </mesh>
    </group>
  );
};

// --- Parked car ----------------------------------------------------------

// Statically-parked decoration -- same car.glb as the real drivable Car
// (Vehicles/Car.tsx), but a plain fixed body with one simplified collision
// box instead of the compound chassis/wheel-controller setup: nothing here
// ever needs to drive, so none of that machinery is worth paying for.
const ParkedCar: React.FC<{ x: number; z: number; rotationY: number }> = ({ x, z, rotationY }) => {
  const { scene } = useGLTF('car.glb');
  const clonedScene = useMemo(() => {
    const clone = scene.clone();
    clone.traverse((child) => {
      // Same authoring-only helper meshes Car.tsx hides (collision hulls,
      // the separate non-tire "wheel"-named interior steering wheel prop).
      if (child.userData?.data === 'collision') child.visible = false;
      if (child.userData?.data !== 'wheel' && child.name.toLowerCase().includes('wheel')) {
        child.visible = false;
      }
    });
    return clone;
  }, [scene]);
  const y = getTerrainHeight(x, z) + getRoadOffset(x, z);
  // Matches the resting height a real (dynamic, wheel-suspended) Car.tsx
  // instance settles to above flat ground -- measured live (~0.43) rather
  // than guessed, since car.glb's own origin sits near the underside of the
  // chassis, not at wheel-contact/ground level. The old value (mesh offset
  // -0.35 cancelling a +0.35 RigidBody offset, netting the mesh origin
  // right on the ground) buried the wheels in the terrain/road mesh.
  const REST_HEIGHT = 0.43;

  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[x, y + REST_HEIGHT, z]}
      rotation={[0, rotationY, 0]}
      collisionGroups={groupsExcluding(CollisionGroups.Default)}
    >
      {/* Approximates Car.tsx's real two-box CHASSIS_SHAPES hull (lower
          body + cabin) as one simplified box, recentered around the car's
          actual vertical midpoint now that the mesh has no artificial
          offset. */}
      <CuboidCollider args={[0.65, 0.55, 1.25]} position={[0, 0.37, 0]} />
      <primitive object={clonedScene} />
    </RigidBody>
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
const BILLBOARD_VIDEO_SRCS = [
  '/videos/billboard-1.mp4',
  '/videos/billboard-2.mp4',
  '/videos/billboard-3.mp4',
  '/videos/billboard-4.mp4',
];

// Freestanding ad panel on two poles, tall enough to read from down the
// street/while driving. Purely decorative -- schemeIndex just picks a
// color pair, there's no actual ad content/text (a canvas-texture label
// would be a nice follow-up, kept out of scope for this pass).
const Billboard: React.FC<{ x: number; z: number; rotationY: number; schemeIndex: number }> = ({
  x,
  z,
  rotationY,
  schemeIndex,
}) => {
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
  // Pedestrians that got hit and turned hostile -- each one spawns a real
  // Enemy.tsx (chase AI, health, bullet hits, the works) at the spot it
  // was standing. Kept as local state here rather than in the global store
  // since nothing outside this tree needs to know about it.
  const [pedestrianEnemies, setPedestrianEnemies] = useState<
    Array<{ id: string; position: [number, number, number] }>
  >([]);
  const handlePedestrianHit = useCallback((id: string, position: [number, number, number]) => {
    setPedestrianEnemies((prev) => (prev.some((e) => e.id === id) ? prev : [...prev, { id, position }]));
  }, []);

  const { furniture, parkedCars, pedestrians, billboards } = useMemo(() => {
    const furnitureArr: Array<{ kind: 'bench' | 'trash' | 'hydrant' | 'sign'; x: number; z: number; rotationY: number; color?: string }> = [];
    const carsArr: Array<{ x: number; z: number; rotationY: number }> = [];
    const pedestriansArr: Array<{ x1: number; z1: number; x2: number; z2: number; speed: number; phase: number }> = [];
    const billboardsArr: Array<{ x: number; z: number; rotationY: number; schemeIndex: number }> = [];
    let schemeCounter = 0;

    for (let i = -GRID_RADIUS; i <= GRID_RADIUS; i++) {
      for (let j = -GRID_RADIUS; j <= GRID_RADIUS; j++) {
        if (isSkippedBlock(i, j)) continue;

        const blockX = i * GRID_SPACING + GRID_SPACING / 2;
        const blockZ = j * GRID_SPACING + GRID_SPACING / 2;

        // North edge (block-facing side of the road at blockZ-BLOCK_HALF):
        // a bench + trash can pair.
        {
          const edgeZ = blockZ - BLOCK_HALF + SIDEWALK_CENTER_OFFSET;
          const benchX = blockX - EDGE_SLOT_OFFSET + Math.random() * 4;
          furnitureArr.push({ kind: 'bench', x: benchX, z: edgeZ, rotationY: Math.PI });
          furnitureArr.push({ kind: 'trash', x: benchX + 2.2, z: edgeZ, rotationY: 0 });
        }

        // South edge: a hydrant + street sign pair.
        {
          const edgeZ = blockZ + BLOCK_HALF - SIDEWALK_CENTER_OFFSET;
          const hydrantX = blockX + EDGE_SLOT_OFFSET - Math.random() * 4;
          furnitureArr.push({ kind: 'hydrant', x: hydrantX, z: edgeZ, rotationY: 0 });
          furnitureArr.push({
            kind: 'sign',
            x: hydrantX - 2.5,
            z: edgeZ,
            rotationY: Math.PI / 2,
            color: SIGN_COLORS[Math.floor(Math.random() * SIGN_COLORS.length)],
          });
        }

        // West/East edges: each has a chance of one parked car tucked
        // against the curb, oriented along the road (length along Z).
        if (Math.random() < 0.6) {
          const edgeX = blockX - BLOCK_HALF + (ROAD_WIDTH / 2 - 0.9);
          const carZ = blockZ - EDGE_SLOT_OFFSET + Math.random() * (EDGE_SLOT_OFFSET * 2);
          carsArr.push({ x: edgeX, z: carZ, rotationY: Math.PI / 2 });
        }
        if (Math.random() < 0.6) {
          const edgeX = blockX + BLOCK_HALF - (ROAD_WIDTH / 2 - 0.9);
          const carZ = blockZ - EDGE_SLOT_OFFSET + Math.random() * (EDGE_SLOT_OFFSET * 2);
          carsArr.push({ x: edgeX, z: carZ, rotationY: -Math.PI / 2 });
        }

        // West sidewalk: one pedestrian pacing a short stretch of it (kept
        // off the North/South sidewalks above so it doesn't walk straight
        // through the bench/hydrant clusters there).
        if (Math.random() < 0.7) {
          const walkX = blockX - BLOCK_HALF + SIDEWALK_CENTER_OFFSET;
          const z1 = blockZ - EDGE_SLOT_OFFSET;
          const z2 = blockZ + EDGE_SLOT_OFFSET;
          pedestriansArr.push({
            x1: walkX, z1, x2: walkX, z2,
            speed: 1 + Math.random() * 0.6,
            phase: Math.random(),
          });
        }

        // Outer ring of the grid: a billboard on whichever edge faces
        // outward, so it's visible approaching the city from a distance.
        const isOuterI = Math.abs(i) === GRID_RADIUS;
        const isOuterJ = Math.abs(j) === GRID_RADIUS;
        if ((isOuterI || isOuterJ) && Math.random() < 0.5) {
          let bx = blockX, bz = blockZ, rotationY = 0;
          if (isOuterI && i < 0) { bx = blockX - BLOCK_HALF + 3; rotationY = -Math.PI / 2; }
          else if (isOuterI && i > 0) { bx = blockX + BLOCK_HALF - 3; rotationY = Math.PI / 2; }
          else if (isOuterJ && j < 0) { bz = blockZ - BLOCK_HALF + 3; rotationY = Math.PI; }
          else { bz = blockZ + BLOCK_HALF - 3; rotationY = 0; }
          billboardsArr.push({ x: bx, z: bz, rotationY, schemeIndex: schemeCounter++ });
        }
      }
    }

    return { furniture: furnitureArr, parkedCars: carsArr, pedestrians: pedestriansArr, billboards: billboardsArr };
  }, []);

  return (
    <group>
      {furniture.map((f, i) => {
        if (f.kind === 'bench') return <SidewalkBench key={`f-${i}`} x={f.x} z={f.z} rotationY={f.rotationY} />;
        if (f.kind === 'trash') return <TrashCan key={`f-${i}`} x={f.x} z={f.z} />;
        if (f.kind === 'hydrant') return <FireHydrant key={`f-${i}`} x={f.x} z={f.z} />;
        return <StreetSign key={`f-${i}`} x={f.x} z={f.z} rotationY={f.rotationY} color={f.color ?? '#1565c0'} />;
      })}
      {parkedCars.map((c, i) => (
        <ParkedCar key={`car-${i}`} x={c.x} z={c.z} rotationY={c.rotationY} />
      ))}
      {pedestrians.map((p, i) => (
        <Pedestrian
          key={`ped-${i}`}
          id={`enemy-ped-${i}`}
          x1={p.x1}
          z1={p.z1}
          x2={p.x2}
          z2={p.z2}
          speed={p.speed}
          phase={p.phase}
          onBecomeEnemy={handlePedestrianHit}
        />
      ))}
      {pedestrianEnemies.map((e) => (
        <Enemy key={e.id} id={e.id} initialPosition={e.position} />
      ))}
      {billboards.map((b, i) => (
        <Billboard key={`bb-${i}`} x={b.x} z={b.z} rotationY={b.rotationY} schemeIndex={b.schemeIndex} />
      ))}
    </group>
  );
};

export default CityDetails;
