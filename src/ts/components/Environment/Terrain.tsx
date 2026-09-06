import React, { useMemo } from "react";
import * as THREE from "three";
import { RigidBody, HeightfieldCollider } from "@react-three/rapier";
import { CollisionGroups, groupsExcluding } from "../../enums/CollisionGroups";

// Flattened (Claude): this used to default to a +/-0.5 sine wave over a
// 20-30 unit wavelength. On open ground that read as gentle rolling hills,
// but roads/sidewalks sample this same function to follow the ground (see
// Road.tsx) -- an 8-unit-wide road rising/falling 0.5 units every ~20-30
// units visibly undulates/curves along its length instead of reading as a
// flat, straight road, and at intersections two perpendicular road strips
// riding two different local slopes of the same wave no longer meet at a
// consistent angle, so their (now solid/extruded, see ROAD_THICKNESS)
// slabs visibly clash into each other instead of lying flush (see git
// history / chat: "perche il terrain e le strade sembrano curvarsi... si
// compenetrano"). maxHeight now defaults to 0 -- perfectly flat -- fixing
// both. The x/z/wave machinery is left in place (not deleted) in case
// gentle relief away from the road grid is wanted again later; just bump
// this default back up (and reconcile it with Road.tsx's flatness
// assumption above) if so.
export const getTerrainHeight = (
  x: number,
  z: number,
  maxHeight: number = 0
): number => {
  return Math.sin(x / 30) * Math.cos(z / 20) * maxHeight;
};

const Terrain: React.FC = () => {
  const size = 600;
  const segments = 40;
  const maxHeight = 0; // flat -- see getTerrainHeight's own comment above

  // Visual Mesh Data - Centered at [0,0,0]
  const { vertices, visualIndices } = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, getTerrainHeight(x, z, maxHeight));
    }
    geometry.computeVertexNormals();

    return {
      vertices: pos.array as Float32Array,
      visualIndices: geometry.index?.array as Uint32Array,
    };
  }, [size, segments, maxHeight]);

  // Physics Heightfield Data.
  //
  // Rapier's Heightfield shape is column-major, `heights[col * (nrows+1) +
  // row]`, and -- unlike cannon's heightfield, which lives in the local XY
  // plane and needs a -90deg X rotation to lay flat -- Rapier's already
  // uses the local X/Z plane with height along local Y, and is CENTERED on
  // the body's origin (cannon's was corner-anchored, hence the old
  // `position: [-size/2, 0, size/2]` offset). So this body sits at world
  // origin with identity rotation, matching the centered visual mesh above
  // directly. Row = local X, column = local Z (verified live against
  // getTerrainHeight with a raycast test while migrating off cannon).
  const heights = useMemo(() => {
    const nrows = segments;
    const ncols = segments;
    const flat = new Array<number>((nrows + 1) * (ncols + 1));
    const step = size / segments;

    for (let row = 0; row <= nrows; row++) {
      const worldX = -size / 2 + row * step;
      for (let col = 0; col <= ncols; col++) {
        const worldZ = -size / 2 + col * step;
        flat[col * (nrows + 1) + row] = getTerrainHeight(worldX, worldZ, maxHeight);
      }
    }
    return flat;
  }, [size, segments, maxHeight]);

  return (
    <>
      <RigidBody type="fixed" colliders={false} position={[0, 0, 0]} friction={0.7} restitution={0}>
        <HeightfieldCollider
          args={[segments, segments, heights, { x: size, y: 1, z: size }]}
          // Exclude other TrimeshColliders (the road sections): every road
          // strip and this heightfield are all static, fixed bodies, so
          // colliding them with each other can only ever be a costly no-op
          // -- there's no dynamic response to produce.
          collisionGroups={groupsExcluding(CollisionGroups.TrimeshColliders, CollisionGroups.TrimeshColliders)}
        />
      </RigidBody>
      <mesh receiveShadow position={[0, 0, 0]}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={vertices.length / 3}
            array={vertices}
            itemSize={3}
          />
          <bufferAttribute
            attach="index"
            count={visualIndices.length}
            array={visualIndices}
            itemSize={1}
          />
        </bufferGeometry>
        <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
      </mesh>
    </>
  );
};

export default Terrain;
