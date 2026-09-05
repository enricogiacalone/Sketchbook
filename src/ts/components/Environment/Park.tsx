import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useCylinder } from '@react-three/cannon';
import { Tree } from '@dgreenheck/ez-tree';
import { getTerrainHeight } from './Terrain';
import { CollisionGroups } from '../../enums/CollisionGroups';

// The park replaces the central city block (i=0, j=0 in City.tsx's grid,
// blockX/blockZ = 30/30) instead of buildings -- see the matching
// `if (i === 0 && j === 0) continue;` in City.tsx's generation loop. The
// block spans world x/z in [0, 60]; roads run along its four edges (x/z = 0
// and 60), so everything here stays a few units inside that to avoid
// overlapping the road strips.
const BLOCK_MIN = 0;
const BLOCK_MAX = 60;
const MARGIN = 9;
const AREA_MIN = BLOCK_MIN + MARGIN; // 9
const AREA_MAX = BLOCK_MAX - MARGIN; // 51
const CENTER_X = 30;
const CENTER_Z = 30;
const OPEN_LAWN_RADIUS = 9; // keep a clear circle at the very center

// A couple of vehicles spawn close to this block (see Scene.tsx: car-1 at
// [10,5,0], car-3 at [0,5,60]) -- keep trees/lamps clear of those spots so
// nothing ends up spawned inside a static collider.
const KEEP_CLEAR: Array<[number, number, number]> = [
  [10, 0, 10],
  [0, 60, 10],
];

const isFreeSpot = (x: number, z: number, placed: Array<[number, number]>, minSpacing: number): boolean => {
  const dCenter = Math.hypot(x - CENTER_X, z - CENTER_Z);
  if (dCenter < OPEN_LAWN_RADIUS) return false;
  for (const [sx, sz, r] of KEEP_CLEAR) {
    if (Math.hypot(x - sx, z - sz) < r) return false;
  }
  for (const [px, pz] of placed) {
    if (Math.hypot(x - px, z - pz) < minSpacing) return false;
  }
  return true;
};

const _dummy = new THREE.Object3D();

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
          _dummy.position.set(x, y, z);
          _dummy.rotation.set(0, Math.random() * Math.PI, 0);
          _dummy.scale.setScalar(0.5 + Math.random() * 0.5);
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
// Real tree meshes generated with @dgreenheck/ez-tree (same library the
// orphaned Trees.tsx uses), not the simple procedural cones this started
// with. A handful of template variations are generated once and their
// geometry/material parts are reused (shared, not cloned) across every
// instance placed in the park -- cheap on both draw calls and memory.

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
          // ez-tree's default trunk (branch level 0) length is 20 units --
          // matches the raw geometry so the collider tracks the visible trunk
          // once TREE_SCALE below shrinks it down to park size.
          templates.push({ parts, trunkHeight: 20 });
        }
      } catch (e) {
        console.warn('Park: failed to generate ez-tree template:', e);
      }
    }

    return templates;
  }, []);
};

const ParkTree: React.FC<{ x: number; z: number; rotationY: number; scale: number; template: TreeTemplate }> = ({
  x,
  z,
  rotationY,
  scale,
  template,
}) => {
  const y = getTerrainHeight(x, z);
  const trunkHeight = template.trunkHeight * scale;
  const trunkRadius = 0.4 * scale;

  // Physics-only static trunk collider, deliberately NOT bound to the
  // visual meshes below (same decoupling the orphaned Trees.tsx uses) --
  // one hook call per tree instead of Trees.tsx's single array-based call
  // across all instances, which is what trips up its TS types (and, more
  // importantly, keeps each tree's body creation independent and simple).
  useCylinder(() => ({
    type: 'Static',
    args: [trunkRadius, trunkRadius, trunkHeight, 8],
    position: [x, y + trunkHeight / 2, z],
    collisionFilterGroup: CollisionGroups.Default,
    collisionFilterMask: -1,
  }));

  return (
    <group position={[x, y, z]} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {template.parts.map((part, i) => (
        <mesh key={i} geometry={part.geometry} material={part.material} castShadow receiveShadow />
      ))}
    </group>
  );
};

// --- Streetlamps -----------------------------------------------------------

const StreetLamp: React.FC<{ x: number; z: number }> = ({ x, z }) => {
  const y = getTerrainHeight(x, z);
  const poleHeight = 4.5;
  const poleRadius = 0.12;

  const [poleRef] = useCylinder<THREE.Mesh>(() => ({
    type: 'Static',
    args: [poleRadius, poleRadius, poleHeight, 8],
    position: [x, y + poleHeight / 2, z],
    collisionFilterGroup: CollisionGroups.Default,
    collisionFilterMask: -1,
  }));

  return (
    <group>
      <mesh ref={poleRef} castShadow receiveShadow>
        <cylinderGeometry args={[poleRadius, poleRadius, poleHeight, 8]} />
        <meshStandardMaterial color="#222222" roughness={0.6} metalness={0.6} />
      </mesh>
      <mesh position={[x, y + poleHeight + 0.15, z]}>
        <sphereGeometry args={[0.28, 10, 10]} />
        <meshStandardMaterial color="#ffe9b0" emissive="#ffcf70" emissiveIntensity={1.4} />
      </mesh>
      {/* No shadow casting: 8 of these is fine for the glow, but 8 shadow-casting
          lights would add real per-frame render cost -- the whole point of this
          feature request came alongside a stutter-hunting session. */}
      <pointLight
        position={[x, y + poleHeight + 0.15, z]}
        color="#ffcf70"
        intensity={1.2}
        distance={14}
        decay={2}
        castShadow={false}
      />
    </group>
  );
};

// --- Park --------------------------------------------------------------

const LAMP_POSITIONS: Array<[number, number]> = [
  [14, 14], [46, 14], [14, 46], [46, 46],
  [30, 14], [30, 46], [14, 30], [46, 30],
];

// ez-tree generates full real-world-scale trees (trunk alone defaults to
// 20 units long, 1.5 radius -- taller than most buildings). This brings a
// generated tree down to an appropriate park-sized tree (roughly 6-10
// units tall including the crown), the per-instance factor below just adds
// natural variation on top.
const TREE_SCALE = 0.22;

const Park: React.FC = () => {
  const treeTemplates = useParkTreeTemplates();

  const trees = useMemo(() => {
    const placed: Array<[number, number]> = [...LAMP_POSITIONS];
    const result: Array<{ x: number; z: number; rotationY: number; scale: number; templateIndex: number }> = [];
    if (treeTemplates.length === 0) return result;

    const treeCount = 16;
    for (let i = 0; i < treeCount; i++) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const x = AREA_MIN + Math.random() * (AREA_MAX - AREA_MIN);
        const z = AREA_MIN + Math.random() * (AREA_MAX - AREA_MIN);
        if (isFreeSpot(x, z, placed, 4)) {
          placed.push([x, z]);
          result.push({
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
    return result;
  }, [treeTemplates]);

  return (
    <group>
      <ParkGrass />
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
      {LAMP_POSITIONS.map(([x, z], i) => (
        <StreetLamp key={i} x={x} z={z} />
      ))}
    </group>
  );
};

export default Park;
