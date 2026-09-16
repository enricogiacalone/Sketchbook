import React, { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RigidBody, CylinderCollider } from "@react-three/rapier";
import { Tree } from "@dgreenheck/ez-tree";
import * as THREE from "three";
import { getTerrainHeight } from "./Terrain";
import { CollisionGroups, groupsExcluding } from "../../enums/CollisionGroups";

// Shared ez-tree template generation + a single tree instance renderer --
// factored out of Park.tsx (where this used to be Park-only, as
// useParkTreeTemplates/ParkTree) so City.tsx's green courtyards/plazas can
// place the SAME real trees instead of the placeholder sphere "bushes"
// they had before (see git history / chat: "le aree verdi devono avere la
// vegetazione del parco"). Behavior/tuning is unchanged from the original
// Park-only version -- Park.tsx now just imports this instead of defining
// its own copy.
export interface TreeTemplatePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

export interface TreeTemplate {
  parts: TreeTemplatePart[];
  trunkHeight: number;
}

// Generating an ez-tree procedurally is the expensive part -- always call
// this ONCE per component that needs trees (e.g. once in Park, once in
// City) and pass the resulting templates down, rather than once per tree
// or once per placement site.
export const useTreeTemplates = (variationCount: number = 3): TreeTemplate[] => {
  return useMemo(() => {
    const templates: TreeTemplate[] = [];

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
        console.warn("useTreeTemplates: failed to generate ez-tree template:", e);
      }
    }

    return templates;
  }, [variationCount]);
};

// One tree, placed at absolute WORLD x/z (ground height looked up
// internally via getTerrainHeight, same convention as everything else in
// Environment/) -- not meant to be nested inside another positioned
// <group>, so callers on a locally-offset block (a courtyard/plaza center)
// should add their own block offset into x/z themselves before passing
// them in, same as Park.tsx's own trees already do relative to the park's
// fixed block coordinates.
export const TreeInstance: React.FC<{
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
  // transform to account for).
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


// --- Shared Vegetation: Grass + Flowers -----------------------------------
// Same generalization deal as the trees above: this used to be Park-only
// (ParkGrass + an inline flower useMemo/JSX block in Park.tsx). Factored out
// here, parameterized by bounds + an "avoid" list of circular exclusion
// zones (fountain/paths in Park, the monument box in a plaza, etc.), so
// City.tsx's green courtyards/plazas get the same real grass/flowers
// instead of nothing -- see git history / chat: "hai dimenticato l'erba e
// i fiori". Park.tsx now imports these instead of defining its own copies;
// behavior/tuning at Park's own call site is unchanged.

export interface AvoidZone {
  x: number;
  z: number;
  radius: number;
}

// The flat mock-shader instanced grass that used to live here
// (GrassPatch: plane geometry + a one-line sine-wave vertex shader) has
// been replaced everywhere by the real pmndrs-ported grass -- see
// ./RealGrass's RealGrassPatch (used by Park.tsx and, for the courtyards/
// plazas above, City.tsx) and ./GrassMaterial for the shader + full
// attribution chain ("ruba il grass da qui
// https://pmndrs.github.io/examples/grass-shader/ e mettilo nel parco...
// mettilo al posto dell'altro grass"). Flowers below are unchanged.

const DEFAULT_FLOWER_COLORS = ["#ff4444", "#ffff44", "#ff44ff", "#ffffff"];

export const Flowers: React.FC<{
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  count?: number;
  colors?: string[];
  avoid?: AvoidZone[];
}> = ({
  minX,
  maxX,
  minZ,
  maxZ,
  count = 60,
  colors = DEFAULT_FLOWER_COLORS,
  avoid = [],
}) => {
  const flowers = useMemo(() => {
    const result: Array<{ x: number; z: number; color: string }> = [];
    for (let i = 0; i < count; i++) {
      const x = minX + Math.random() * (maxX - minX);
      const z = minZ + Math.random() * (maxZ - minZ);
      const blocked = avoid.some(
        (a) => Math.hypot(x - a.x, z - a.z) < a.radius
      );
      if (!blocked) {
        result.push({
          x,
          z,
          color: colors[Math.floor(Math.random() * colors.length)],
        });
      }
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minX, maxX, minZ, maxZ, count, colors, avoid]);

  return (
    <>
      {flowers.map((f, i) => (
        <mesh
          key={i}
          position={[f.x, getTerrainHeight(f.x, f.z) + 0.2, f.z]}
        >
          <sphereGeometry args={[0.15, 6, 6]} />
          <meshStandardMaterial color={f.color} />
        </mesh>
      ))}
    </>
  );
};
