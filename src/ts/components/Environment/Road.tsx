import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RigidBody, TrimeshCollider, CylinderCollider } from '@react-three/rapier';
import { getTerrainHeight } from './Terrain';
import { CollisionGroups, groupsExcluding } from '../../enums/CollisionGroups';

// Shared road-grid layout, also consumed by Player.tsx (getRoadOffset) so the
// character's manual ground-snapping agrees with the actual road geometry
// instead of relying on physics contact response (see Player.tsx for why).
export const ROAD_SIZE = 600;
export const ROAD_GRID_SPACING = 60;
export const ROAD_WIDTH = 8;
export const ROAD_Y_OFFSET = 0.15;
export const SIDEWALK_WIDTH = 1.5;
export const SIDEWALK_HEIGHT = 0.15;

const ROAD_OFFSETS: number[] = (() => {
  const arr: number[] = [];
  for (let i = -3; i <= 3; i++) {
    arr.push(i * ROAD_GRID_SPACING);
  }
  return arr;
})();

// Returns the ground surface's extra elevation above the raw terrain height
// at (x, z) -- road, sidewalk, or 0 if the point isn't over either. Mirrors
// the road/sidewalk grid built by <Road />, so this must stay in sync with
// it: Player.tsx's character controller never gets a real physics contact
// response from these trimeshes (see Player.tsx's collisionGroups), it
// snaps its own Y purely from this function, so any patch of ground this
// misses is a patch the character will sink into or hover above instead of
// standing on properly.
export const getRoadOffset = (x: number, z: number): number => {
  const half = ROAD_WIDTH / 2;
  const sidewalkOuter = half + SIDEWALK_WIDTH;

  // Roads first, in a full pass -- a road strip and its own sidewalk can
  // never overlap, so this only matters at intersections, where we want
  // the (flatter, lower) road surface to win over a perpendicular road's
  // sidewalk band.
  for (const offset of ROAD_OFFSETS) {
    // Horizontal strip (axis="x"): runs along world X, centered at z = offset
    if (Math.abs(z - offset) <= half) return ROAD_Y_OFFSET;
    // Vertical strip (axis="z"): runs along world Z, centered at x = offset
    if (Math.abs(x - offset) <= half) return ROAD_Y_OFFSET;
  }
  // Then sidewalks -- the band just outside each road strip, both sides.
  for (const offset of ROAD_OFFSETS) {
    const dz = Math.abs(z - offset);
    if (dz > half && dz <= sidewalkOuter) return ROAD_Y_OFFSET + SIDEWALK_HEIGHT;
    const dx = Math.abs(x - offset);
    if (dx > half && dx <= sidewalkOuter) return ROAD_Y_OFFSET + SIDEWALK_HEIGHT;
  }
  return 0;
};

interface RoadSectionProps {
  axis: 'x' | 'z';
  size: number;
}

const RoadSection: React.FC<RoadSectionProps> = ({ axis, size }) => {
  const roadWidth = ROAD_WIDTH;
  const segmentsAlong = 80;
  const segmentsAcross = 10;
  const yOffset = ROAD_Y_OFFSET;

  const { vertices, indices } = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(
        axis === 'x' ? size : roadWidth,
        axis === 'z' ? size : roadWidth,
        axis === 'x' ? segmentsAlong : segmentsAcross,
        axis === 'z' ? segmentsAlong : segmentsAcross
    );

    geometry.rotateX(-Math.PI / 2);
    
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        pos.setY(i, getTerrainHeight(x, z) + yOffset);
    }
    geometry.computeVertexNormals();

    const rawIndices = geometry.index?.array || new Uint32Array();

    return {
        vertices: pos.array as Float32Array,
        indices: new Uint32Array(rawIndices),
    };
  }, [axis, size]);

  // Dashed lane markings
  const dashCount = Math.floor(size / 6);
  const dashMeshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Sidewalks
  const { sidewalkVertices, sidewalkIndices } = useMemo(() => {
    // We'll create two strips, one on each side. For simplicity, we just use a plane
    // and elevate it more than the road.
    const swWidth = SIDEWALK_WIDTH;
    const swY = yOffset + SIDEWALK_HEIGHT;
    
    // Left sidewalk
    const geoLeft = new THREE.PlaneGeometry(
        axis === 'x' ? size : swWidth,
        axis === 'z' ? size : swWidth,
        axis === 'x' ? segmentsAlong : 2,
        axis === 'z' ? segmentsAlong : 2
    );
    geoLeft.rotateX(-Math.PI / 2);
    const posL = geoLeft.attributes.position;
    const offsetL = (roadWidth / 2 + swWidth / 2);
    for (let i = 0; i < posL.count; i++) {
        const x = posL.getX(i) + (axis === 'z' ? -offsetL : 0);
        const z = posL.getZ(i) + (axis === 'x' ? -offsetL : 0);
        posL.setX(i, x);
        posL.setZ(i, z);
        posL.setY(i, getTerrainHeight(x, z) + swY);
    }

    // Right sidewalk
    const geoRight = new THREE.PlaneGeometry(
        axis === 'x' ? size : swWidth,
        axis === 'z' ? size : swWidth,
        axis === 'x' ? segmentsAlong : 2,
        axis === 'z' ? segmentsAlong : 2
    );
    geoRight.rotateX(-Math.PI / 2);
    const posR = geoRight.attributes.position;
    const offsetR = (roadWidth / 2 + swWidth / 2);
    for (let i = 0; i < posR.count; i++) {
        const x = posR.getX(i) + (axis === 'z' ? offsetR : 0);
        const z = posR.getZ(i) + (axis === 'x' ? offsetR : 0);
        posR.setX(i, x);
        posR.setZ(i, z);
        posR.setY(i, getTerrainHeight(x, z) + swY);
    }

    const merged = new THREE.BufferGeometry();
    const combinedPos = new Float32Array(posL.array.length + posR.array.length);
    combinedPos.set(posL.array);
    combinedPos.set(posR.array, posL.array.length);
    merged.setAttribute('position', new THREE.BufferAttribute(combinedPos, 3));
    
    const indicesL = geoLeft.index?.array || new Uint32Array();
    const indicesR = (geoRight.index?.array || new Uint32Array()).map(idx => idx + posL.count);
    const combinedIndices = new Uint32Array(indicesL.length + indicesR.length);
    combinedIndices.set(indicesL);
    combinedIndices.set(indicesR, indicesL.length);
    merged.setIndex(new THREE.BufferAttribute(combinedIndices, 1));
    merged.computeVertexNormals();

    return {
        sidewalkVertices: merged.attributes.position.array as Float32Array,
        sidewalkIndices: merged.index?.array as Uint32Array
    };
  }, [axis, size]);

  // Both trimeshes are static/fixed, tagged TrimeshColliders and excluded
  // from colliding with each other (asphalt vs sidewalk vs terrain
  // heightfield) -- all mass-0 bodies, so any contact between them would be
  // a costly no-op with no dynamic response to produce.
  const roadGroups = useMemo(
    () => groupsExcluding(CollisionGroups.TrimeshColliders, CollisionGroups.TrimeshColliders),
    []
  );

  return (
    <group>
      {/* Asphalt */}
      <RigidBody type="fixed" colliders={false} friction={0.8} restitution={0}>
        <TrimeshCollider args={[vertices, indices]} collisionGroups={roadGroups} />
        <mesh receiveShadow>
            <bufferGeometry>
                <bufferAttribute
                    attach="attributes-position"
                    count={vertices.length / 3}
                    array={vertices}
                    itemSize={3}
                />
                <bufferAttribute
                    attach="index"
                    count={indices.length}
                    array={indices}
                    itemSize={1}
                />
            </bufferGeometry>
            <meshStandardMaterial color="#222" roughness={0.8} />
        </mesh>
      </RigidBody>

      {/* Sidewalks */}
      <RigidBody type="fixed" colliders={false} friction={0.8} restitution={0}>
        <TrimeshCollider args={[sidewalkVertices, sidewalkIndices]} collisionGroups={roadGroups} />
        <mesh receiveShadow>
          <bufferGeometry>
              <bufferAttribute
                  attach="attributes-position"
                  count={sidewalkVertices.length / 3}
                  array={sidewalkVertices}
                  itemSize={3}
              />
              <bufferAttribute
                  attach="index"
                  count={sidewalkIndices.length}
                  array={sidewalkIndices}
                  itemSize={1}
              />
          </bufferGeometry>
          <meshStandardMaterial color="#777" roughness={0.9} />
        </mesh>
      </RigidBody>

      {/* Dashes */}
      <instancedMesh
        ref={dashMeshRef}
        args={[null as any, null as any, dashCount]}
        onUpdate={(self) => {
          for (let i = 0; i < dashCount; i++) {
            const step = size / dashCount;
            const posAlong = -size / 2 + i * step + step / 2;
            const x = axis === 'x' ? posAlong : 0;
            const z = axis === 'z' ? posAlong : 0;
            const y = getTerrainHeight(x, z) + yOffset + 0.01;

            dummy.position.set(x, y, z);
            dummy.rotation.set(-Math.PI / 2, 0, axis === 'x' ? 0 : Math.PI / 2);
            dummy.scale.set(axis === 'x' ? 2 : 0.2, axis === 'z' ? 2 : 0.2, 1);
            dummy.updateMatrix();
            self.setMatrixAt(i, dummy.matrix);
          }
          self.instanceMatrix.needsUpdate = true;
        }}
      >
        <planeGeometry args={[1, 1]} />
        <meshStandardMaterial color="#fff" />
      </instancedMesh>
    </group>
  );
};

const Crosswalk: React.FC<{ x: number, z: number }> = ({ x, z }) => {
    const stripeCount = 6;
    const stripeWidth = 0.5;
    const stripeLength = 4;
    const yOffset = ROAD_Y_OFFSET + 0.01;

    return (
        <group position={[x, 0, z]}>
            {/* North arm */}
            <group position={[0, 0, -ROAD_WIDTH/2 - 2]}>
                {Array.from({ length: stripeCount }).map((_, i) => (
                    <mesh key={`n-${i}`} position={[(i - (stripeCount-1)/2) * 1.2, getTerrainHeight(x + (i - (stripeCount-1)/2) * 1.2, z - ROAD_WIDTH/2 - 2) + yOffset, 0]} rotation={[-Math.PI/2, 0, 0]}>
                        <planeGeometry args={[stripeWidth, stripeLength]} />
                        <meshStandardMaterial color="#fff" />
                    </mesh>
                ))}
            </group>
            {/* South arm */}
            <group position={[0, 0, ROAD_WIDTH/2 + 2]}>
                {Array.from({ length: stripeCount }).map((_, i) => (
                    <mesh key={`s-${i}`} position={[(i - (stripeCount-1)/2) * 1.2, getTerrainHeight(x + (i - (stripeCount-1)/2) * 1.2, z + ROAD_WIDTH/2 + 2) + yOffset, 0]} rotation={[-Math.PI/2, 0, 0]}>
                        <planeGeometry args={[stripeWidth, stripeLength]} />
                        <meshStandardMaterial color="#fff" />
                    </mesh>
                ))}
            </group>
            {/* East arm */}
            <group position={[ROAD_WIDTH/2 + 2, 0, 0]}>
                {Array.from({ length: stripeCount }).map((_, i) => (
                    <mesh key={`e-${i}`} position={[0, getTerrainHeight(x + ROAD_WIDTH/2 + 2, z + (i - (stripeCount-1)/2) * 1.2) + yOffset, (i - (stripeCount-1)/2) * 1.2]} rotation={[-Math.PI/2, 0, Math.PI/2]}>
                        <planeGeometry args={[stripeWidth, stripeLength]} />
                        <meshStandardMaterial color="#fff" />
                    </mesh>
                ))}
            </group>
            {/* West arm */}
            <group position={[-ROAD_WIDTH/2 - 2, 0, 0]}>
                {Array.from({ length: stripeCount }).map((_, i) => (
                    <mesh key={`w-${i}`} position={[0, getTerrainHeight(x - ROAD_WIDTH/2 - 2, z + (i - (stripeCount-1)/2) * 1.2) + yOffset, (i - (stripeCount-1)/2) * 1.2]} rotation={[-Math.PI/2, 0, Math.PI/2]}>
                        <planeGeometry args={[stripeWidth, stripeLength]} />
                        <meshStandardMaterial color="#fff" />
                    </mesh>
                ))}
            </group>
        </group>
    );
};

const StreetLight: React.FC<{ x: number, z: number }> = ({ x, z }) => {
    const y = getTerrainHeight(x, z);
    const poleHeight = 6;
    const poleRadius = 0.15;

    return (
        <group>
            <RigidBody type="fixed" colliders={false} position={[x, y + poleHeight / 2, z]}>
                <CylinderCollider
                    args={[poleHeight / 2, poleRadius]}
                    // Exclude Characters: found live (on the old cannon setup)
                    // that falling/spawning directly above a lamp let the
                    // player's sphere land on TOP of the pole/bulb via a real
                    // physics contact, and the character's ground-snap
                    // (Player.tsx) only knows about the analytic
                    // terrain/road height, not other physics bodies, so it
                    // never became grounded up there. Lamp posts are thin
                    // decoration, not a surface anyone is meant to stand on;
                    // vehicles/bullets/etc. still collide normally.
                    collisionGroups={groupsExcluding(CollisionGroups.Default, CollisionGroups.Characters)}
                />
                <mesh castShadow receiveShadow>
                    <cylinderGeometry args={[poleRadius, poleRadius, poleHeight, 8]} />
                    <meshStandardMaterial color="#333" />
                </mesh>
            </RigidBody>
            <mesh position={[x, y + poleHeight, z]}>
                <sphereGeometry args={[0.4, 8, 8]} />
                {/* High emissiveIntensity gives the bulb its glow -- this
                    alone reads as "lit" without needing a real light. */}
                <meshStandardMaterial color="#fff" emissive="#ffffcc" emissiveIntensity={2} />
            </mesh>
            {/* Removed the real <pointLight> that used to be here. There's
                one of these per street lamp -- ~100+ across the road grid --
                and three.js recompiles/re-runs its lighting shader loop over
                EVERY light in the scene for EVERY lit fragment, on every
                mesh, not just ones near a given lamp. 100+ real point lights
                was almost certainly the single biggest cost in the whole
                scene (confirmed live: window.__r3fState showed 107
                PointLights). The emissive bulb above keeps the visual, this
                just drops the actual light contribution. */}
        </group>
    );
};

const Road: React.FC = () => {
  const offsets = ROAD_OFFSETS;

  return (
    <group>
      {offsets.map((offset, i) => (
        <React.Fragment key={`road-grid-${i}`}>
          <group position={[0, 0, offset]}>
            <RoadSection axis="x" size={ROAD_SIZE} />
          </group>
          <group position={[offset, 0, 0]}>
            <RoadSection axis="z" size={ROAD_SIZE} />
          </group>
        </React.Fragment>
      ))}
      {/* Intersections Details */}
      {offsets.map((ox) => 
        offsets.map((oz) => (
            <React.Fragment key={`inter-${ox}-${oz}`}>
                <Crosswalk x={ox} z={oz} />
                {/* Streetlights disabled for now -- asked to take them out
                    of the picture while testing sidewalk movement (they
                    were a red herring for the "moon gravity"/friction bug,
                    see the sidewalk trimesh fix above for the real cause). */}
                {false && <StreetLight x={ox - ROAD_WIDTH/2 - 1} z={oz - ROAD_WIDTH/2 - 1} />}
                {false && <StreetLight x={ox + ROAD_WIDTH/2 + 1} z={oz + ROAD_WIDTH/2 + 1} />}
            </React.Fragment>
        ))
      )}
    </group>
  );
};

export default Road;
