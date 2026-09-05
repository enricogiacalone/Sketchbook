import React, { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { RigidBody, CylinderCollider, CuboidCollider } from "@react-three/rapier";
import { Tree } from "@dgreenheck/ez-tree";
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

const _dummy = new THREE.Object3D();

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

// --- Grass -------------------------------------------------------------

const grassVertexShader = `
  varying vec2 vUv;
  uniform float uTime;
  void main() {
    vUv = uv;
    vec3 pos = position;
    float wave = sin(uTime + instanceMatrix[3][0] * 0.5) * 0.08 * (1.0 - uv.y);
    pos.x += wave;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
  }
`;

const grassFragmentShader = `
  varying vec2 vUv;
  void main() {
    vec3 color = mix(vec3(0.12, 0.42, 0.12), vec3(0.45, 0.72, 0.25), vUv.y);
    gl_FragColor = vec4(color, 1.0);
  }
`;

const ParkGrass: React.FC = () => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = 4000;

  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[null as any, null as any, count]}
      onUpdate={(self) => {
        for (let i = 0; i < count; i++) {
          const x = AREA_MIN + Math.random() * (AREA_MAX - AREA_MIN);
          const z = AREA_MIN + Math.random() * (AREA_MAX - AREA_MIN);
          const y = getTerrainHeight(x, z);
          // Don't spawn grass on fountain or paths (rough check)
          const dCenter = Math.hypot(x - CENTER_X, z - CENTER_Z);
          if (dCenter < FOUNTAIN_RADIUS + PATH_WIDTH) {
            _dummy.scale.setScalar(0);
          } else {
            _dummy.position.set(x, y, z);
            _dummy.rotation.set(0, Math.random() * Math.PI, 0);
            _dummy.scale.setScalar(0.5 + Math.random() * 0.5);
          }
          _dummy.updateMatrix();
          self.setMatrixAt(i, _dummy.matrix);
        }
        self.instanceMatrix.needsUpdate = true;
      }}
    >
      <planeGeometry args={[0.2, 1, 1, 4]} />
      <shaderMaterial
        vertexShader={grassVertexShader}
        fragmentShader={grassFragmentShader}
        uniforms={uniforms}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  );
};

// --- Trees ---------------------------------------------------------------

interface TreeTemplatePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

interface TreeTemplate {
  parts: TreeTemplatePart[];
  trunkHeight: number;
}

const useParkTreeTemplates = (): TreeTemplate[] => {
  return useMemo(() => {
    const templates: TreeTemplate[] = [];
    const variationCount = 3;

    for (let i = 0; i < variationCount; i++) {
      try {
        const t = new Tree();
        t.generate();

        const parts: TreeTemplatePart[] = [];
        t.traverse((child: THREE.Object3D) => {
          if (child instanceof THREE.Mesh && child.geometry && child.material) {
            parts.push({
              geometry: child.geometry.clone(),
              material: (child.material as THREE.Material).clone(),
            });
          }
        });

        if (parts.length > 0) {
          templates.push({ parts, trunkHeight: 20 });
        }
      } catch (e) {
        console.warn("Park: failed to generate ez-tree template:", e);
      }
    }

    return templates;
  }, []);
};

const ParkTree: React.FC<{
  x: number;
  z: number;
  rotationY: number;
  scale: number;
  template: TreeTemplate;
}> = ({ x, z, rotationY, scale, template }) => {
  const y = getTerrainHeight(x, z);
  const trunkHeight = template.trunkHeight * scale;
  const trunkRadius = 0.4 * scale;

  // Collision-only, no visual mesh attached (the real tree geometry is
  // rendered separately below, unrelated to this invisible trunk collider)
  // -- this RigidBody is a SIBLING of the visual group, not nested inside
  // it, so [x, y+trunkHeight/2, z] is already correct as-is (no ancestor
  // transform to account for, unlike Fountain/Bench above).
  return (
    <>
      <RigidBody
        type="fixed"
        colliders={false}
        position={[x, y + trunkHeight / 2, z]}
        collisionGroups={groupsExcluding(CollisionGroups.Default)}
      >
        <CylinderCollider args={[trunkHeight / 2, trunkRadius]} />
      </RigidBody>
      <group
        position={[x, y, z]}
        rotation={[0, rotationY, 0]}
        scale={[scale, scale, scale]}
      >
        {template.parts.map((part, i) => (
          <mesh
            key={i}
            geometry={part.geometry}
            material={part.material}
            castShadow
            receiveShadow
          />
        ))}
      </group>
    </>
  );
};

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
  const treeTemplates = useParkTreeTemplates();

  const { trees, flowers } = useMemo(() => {
    const placed: Array<[number, number]> = [...LAMP_POSITIONS];
    const treeResult: Array<{
      x: number;
      z: number;
      rotationY: number;
      scale: number;
      templateIndex: number;
    }> = [];
    const flowerResult: Array<{ x: number; z: number; color: string }> = [];
    const flowerColors = ["#ff4444", "#ffff44", "#ff44ff", "#ffffff"];

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

    const flowerCount = 60;
    for (let i = 0; i < flowerCount; i++) {
      const x = AREA_MIN + Math.random() * (AREA_MAX - AREA_MIN);
      const z = AREA_MIN + Math.random() * (AREA_MAX - AREA_MIN);
      const dCenter = Math.hypot(x - CENTER_X, z - CENTER_Z);
      if (dCenter > FOUNTAIN_RADIUS + PATH_WIDTH + 1) {
        flowerResult.push({
          x,
          z,
          color: flowerColors[Math.floor(Math.random() * flowerColors.length)],
        });
      }
    }

    return { trees: treeResult, flowers: flowerResult };
  }, [treeTemplates]);

  return (
    <group>
      <ParkGrass />
      <Fountain />
      <Paths />
      {trees.map((t, i) => (
        <ParkTree
          key={i}
          x={t.x}
          z={t.z}
          rotationY={t.rotationY}
          scale={t.scale}
          template={treeTemplates[t.templateIndex]}
        />
      ))}
      {/* Disabled along with Road.tsx's StreetLight while testing ground
          movement (see that file for why). */}
      {false && LAMP_POSITIONS.map(([x, z], i) => (
        <StreetLamp key={i} x={x} z={z} />
      ))}
      {flowers.map((f, i) => (
        <mesh
          key={`flower-${i}`}
          position={[f.x, getTerrainHeight(f.x, f.z) + 0.2, f.z]}
        >
          <sphereGeometry args={[0.15, 6, 6]} />
          <meshStandardMaterial color={f.color} />
        </mesh>
      ))}
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
