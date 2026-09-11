import React, { useMemo } from "react";
import { RigidBody, CylinderCollider, CuboidCollider } from "@react-three/rapier";
import { useTreeTemplates, TreeInstance, GrassPatch, Flowers } from "./ParkTrees";
import { getTerrainHeight } from "./Terrain";
import { CollisionGroups, groupsExcluding } from "../../enums/CollisionGroups";

const BLOCK_MIN = 0;
const BLOCK_MAX = 60;
const MARGIN = 9;
const AREA_MIN = BLOCK_MIN + MARGIN;
const AREA_MAX = BLOCK_MAX - MARGIN;
const CENTER_X = 30;
const CENTER_Z = 30;
const FOUNTAIN_RADIUS = 4;
const PATH_WIDTH = 3;

const KEEP_CLEAR: Array<[number, number, number]> = [
  [10, 0, 10],
  [0, 60, 10],
];

const isFreeSpot = (
  x: number,
  z: number,
  placed: Array<[number, number]>,
  minSpacing: number
): boolean => {
  const dCenter = Math.hypot(x - CENTER_X, z - CENTER_Z);
  if (dCenter < FOUNTAIN_RADIUS + 4) return false; // Keep clear of fountain and inner path
  for (const [sx, sz, r] of KEEP_CLEAR) {
    if (Math.hypot(x - sx, z - sz) < r) return false;
  }
  for (const [px, pz] of placed) {
    if (Math.hypot(x - px, z - pz) < minSpacing) return false;
  }
  return true;
};

// --- Fountain -------------------------------------------------------------

const Fountain: React.FC = () => {
  const y = getTerrainHeight(CENTER_X, CENTER_Z);

  return (
    <group position={[CENTER_X, y, CENTER_Z]}>
      {/* Base -- migrated from cannon's useCylinder. IMPORTANT: cannon's
          body position is always literal WORLD coordinates (physics bodies
          there are entirely decoupled from the three.js scene graph, and
          the ref'd mesh's transform gets overwritten with that same
          absolute value via a matrixAutoUpdate=false trick that bypasses
          normal parent-child composition) -- that's why the old config used
          the absolute [CENTER_X, y+0.5, CENTER_Z] even though this mesh is
          nested inside a group already offset by [CENTER_X, y, CENTER_Z].
          Rapier's RigidBody instead reads the real ambient scene-graph
          transform (it calls object.updateWorldMatrix and factors in
          object.parent.matrixWorld), so it needs the LOCAL position here --
          [0, 0.5, 0], matching the Middle/Top Tier siblings' own
          position={[0, 1.2/2, 0]}-style local coords below -- or it would
          double-apply this group's offset. */}
      <RigidBody type="fixed" colliders={false} position={[0, 0.5, 0]} collisionGroups={groupsExcluding(CollisionGroups.Default)}>
        <CylinderCollider args={[0.5, FOUNTAIN_RADIUS]} />
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[FOUNTAIN_RADIUS, FOUNTAIN_RADIUS, 1, 16]} />
          <meshStandardMaterial color="#888" roughness={0.4} />
        </mesh>
      </RigidBody>
      {/* Middle Tier */}
      <mesh position={[0, 1.2, 0]} castShadow>
        <cylinderGeometry
          args={[FOUNTAIN_RADIUS * 0.6, FOUNTAIN_RADIUS * 0.6, 0.5, 12]}
        />
        <meshStandardMaterial color="#777" />
      </mesh>
      {/* Top Tier */}
      <mesh position={[0, 2, 0]} castShadow>
        <cylinderGeometry
          args={[FOUNTAIN_RADIUS * 0.3, FOUNTAIN_RADIUS * 0.3, 0.4, 8]}
        />
        <meshStandardMaterial color="#666" />
      </mesh>
      {/* Water Surface */}
      <mesh position={[0, 0.6, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[FOUNTAIN_RADIUS * 0.9, 16]} />
        <meshStandardMaterial
          color="#44aaff"
          emissive="#2288ff"
          emissiveIntensity={0.5}
          transparent
          opacity={0.7}
        />
      </mesh>
    </group>
  );
};

// --- Paths ----------------------------------------------------------------

const Paths: React.FC = () => {
  const yCenter = getTerrainHeight(CENTER_X, CENTER_Z) + 0.05;
  return (
    <group>
      {/* Circular path around fountain */}
      <mesh
        position={[CENTER_X, yCenter, CENTER_Z]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <ringGeometry
          args={[FOUNTAIN_RADIUS + 0.5, FOUNTAIN_RADIUS + PATH_WIDTH, 32]}
        />
        <meshStandardMaterial color="#a18c7c" roughness={1} />
      </mesh>
      {/* Radial paths to edges */}
      {[-1, 1].map((s) => (
        <React.Fragment key={s}>
          {/* X axis paths */}
          <mesh
            position={[
              CENTER_X + (s * (AREA_MAX - CENTER_X)) / 2 + s * 2,
              yCenter,
              CENTER_Z,
            ]}
            rotation={[-Math.PI / 2, 0, 0]}
            receiveShadow
          >
            <planeGeometry
              args={[AREA_MAX - CENTER_X - FOUNTAIN_RADIUS - 1, PATH_WIDTH]}
            />
            <meshStandardMaterial color="#a18c7c" roughness={1} />
          </mesh>
          {/* Z axis paths */}
          <mesh
            position={[
              CENTER_X,
              yCenter,
              CENTER_Z + (s * (AREA_MAX - CENTER_Z)) / 2 + s * 2,
            ]}
            rotation={[-Math.PI / 2, 0, 0]}
            receiveShadow
          >
            <planeGeometry
              args={[PATH_WIDTH, AREA_MAX - CENTER_Z - FOUNTAIN_RADIUS - 1]}
            />
            <meshStandardMaterial color="#a18c7c" roughness={1} />
          </mesh>
        </React.Fragment>
      ))}
    </group>
  );
};

// --- Benches --------------------------------------------------------------

const Bench: React.FC<{ x: number; z: number; rotationY: number }> = ({
  x,
  z,
  rotationY,
}) => {
  const y = getTerrainHeight(x, z);

  return (
    <group position={[x, y, z]} rotation={[0, rotationY, 0]}>
      {/* Migrated from cannon's useBox -- same local-vs-world-position
          reasoning as Fountain's Base above: this group already carries
          [x,y,z]/rotationY, so the RigidBody only needs [0, 0.5, 0] with no
          extra rotation (cannon's old config specified rotationY again
          itself only because it needed the true world orientation
          directly, being scene-graph-agnostic). The collision box (half-
          extents [1.25, 0.5, 0.5]) is intentionally bigger than the visible
          seat mesh below -- it's a simplified hull for the whole bench,
          backrest and legs included. */}
      <RigidBody type="fixed" colliders={false} position={[0, 0.5, 0]}>
        <CuboidCollider args={[1.25, 0.5, 0.5]} />
        <mesh castShadow receiveShadow>
          <boxGeometry args={[2.5, 0.2, 0.8]} />
          <meshStandardMaterial color="#5d4037" />
        </mesh>
      </RigidBody>
      <mesh
        position={[0, 0.6, -0.35]}
        rotation={[Math.PI / 2, 0, 0]}
        castShadow
      >
        <boxGeometry args={[2.5, 0.8, 0.2]} />
        <meshStandardMaterial color="#5d4037" />
      </mesh>
      {/* Legs */}
      <mesh position={[-1.1, 0.2, 0]} castShadow>
        <boxGeometry args={[0.2, 0.4, 0.8]} />
        <meshStandardMaterial color="#333" />
      </mesh>
      <mesh position={[1.1, 0.2, 0]} castShadow>
        <boxGeometry args={[0.2, 0.4, 0.8]} />
        <meshStandardMaterial color="#333" />
      </mesh>
    </group>
  );
};

// --- Grass -----------------------------------------------------------
// Real grass (instanced, wind-shader) now lives in ./ParkTrees as
// <GrassPatch> (shared with City.tsx's green courtyards/plazas -- see git
// history / chat: "hai dimenticato l'erba e i fiori"); this file just calls
// it below with Park's own bounds/avoid-fountain settings, same tuning as
// before.

// --- Trees ---------------------------------------------------------------
// Real ez-tree generation + rendering now lives in ./ParkTrees (shared with
// City.tsx's green courtyards/plazas -- see git history / chat: "le aree
// verdi devono avere la vegetazione del parco"); this file just calls
// useTreeTemplates()/<TreeInstance> below, same as before.

// --- Streetlamps -----------------------------------------------------------

const StreetLamp: React.FC<{ x: number; z: number }> = ({ x, z }) => {
  const y = getTerrainHeight(x, z);
  const poleHeight = 4.5;
  const poleRadius = 0.12;

  return (
    <group>
      {/* This wrapping <group> carries no position offset, so (unlike
          Fountain/Bench above) world coords and local coords coincide here
          -- no local-vs-world adjustment needed. */}
      <RigidBody
        type="fixed"
        colliders={false}
        position={[x, y + poleHeight / 2, z]}
        collisionGroups={groupsExcluding(CollisionGroups.Default)}
      >
        <CylinderCollider args={[poleHeight / 2, poleRadius]} />
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[poleRadius, poleRadius, poleHeight, 8]} />
          <meshStandardMaterial color="#222222" roughness={0.6} metalness={0.6} />
        </mesh>
      </RigidBody>
      <mesh position={[x, y + poleHeight + 0.15, z]}>
        <sphereGeometry args={[0.28, 10, 10]} />
        {/* Emissive glow reads as "lit" on its own -- no real pointLight
            needed (see the matching note in Road.tsx's StreetLight: every
            real light in the scene gets evaluated in the shader for every
            lit fragment on every mesh, so lamps add up fast). */}
        <meshStandardMaterial
          color="#ffe9b0"
          emissive="#ffcf70"
          emissiveIntensity={1.4}
        />
      </mesh>
    </group>
  );
};

// --- Park --------------------------------------------------------------

const LAMP_POSITIONS: Array<[number, number]> = [
  [14, 14],
  [46, 14],
  [14, 46],
  [46, 46],
  [30, 14],
  [30, 46],
  [14, 30],
  [46, 30],
];

const TREE_SCALE = 0.22;

const Park: React.FC = () => {
  const treeTemplates = useTreeTemplates();

  const trees = useMemo(() => {
    const placed: Array<[number, number]> = [...LAMP_POSITIONS];
    const treeResult: Array<{
      x: number;
      z: number;
      rotationY: number;
      scale: number;
      templateIndex: number;
    }> = [];

    if (treeTemplates.length > 0) {
      const treeCount = 16;
      for (let i = 0; i < treeCount; i++) {
        for (let attempt = 0; attempt < 6; attempt++) {
          const x = AREA_MIN + Math.random() * (AREA_MAX - AREA_MIN);
          const z = AREA_MIN + Math.random() * (AREA_MAX - AREA_MIN);
          if (isFreeSpot(x, z, placed, 4)) {
            placed.push([x, z]);
            treeResult.push({
              x,
              z,
              rotationY: Math.random() * Math.PI * 2,
              scale: TREE_SCALE * (0.8 + Math.random() * 0.5),
              templateIndex: Math.floor(Math.random() * treeTemplates.length),
            });
            break;
          }
        }
      }
    }

    return treeResult;
  }, [treeTemplates]);

  // Same bounds/avoid-fountain settings as the old inline ParkGrass/flower
  // generation -- just delegated to the shared components now.
  const grassAvoid = useMemo(
    () => [{ x: CENTER_X, z: CENTER_Z, radius: FOUNTAIN_RADIUS + PATH_WIDTH }],
    []
  );
  const flowerAvoid = useMemo(
    () => [
      { x: CENTER_X, z: CENTER_Z, radius: FOUNTAIN_RADIUS + PATH_WIDTH + 1 },
    ],
    []
  );

  return (
    <group>
      <GrassPatch
        minX={AREA_MIN}
        maxX={AREA_MAX}
        minZ={AREA_MIN}
        maxZ={AREA_MAX}
        avoid={grassAvoid}
      />
      <Fountain />
      <Paths />
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
      {/* Re-enabled along with Road.tsx's StreetLight -- see that file for
          why these were off (an unrelated bug, since fixed). */}
      {LAMP_POSITIONS.map(([x, z], i) => (
        <StreetLamp key={i} x={x} z={z} />
      ))}
      <Flowers
        minX={AREA_MIN}
        maxX={AREA_MAX}
        minZ={AREA_MIN}
        maxZ={AREA_MAX}
        avoid={flowerAvoid}
      />
      {/* Benches along the circular path */}
      {[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((angle, i) => (
        <Bench
          key={`bench-${i}`}
          x={
            CENTER_X +
            Math.cos(angle + 0.4) * (FOUNTAIN_RADIUS + PATH_WIDTH + 1.5)
          }
          z={
            CENTER_Z +
            Math.sin(angle + 0.4) * (FOUNTAIN_RADIUS + PATH_WIDTH + 1.5)
          }
          rotationY={-angle - 0.4 + Math.PI / 2}
        />
      ))}
    </group>
  );
};

export default Park;
