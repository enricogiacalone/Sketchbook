import React, { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import { getTerrainHeight } from "./Terrain";
import { AvoidZone } from "./ParkTrees";
import {
  grassBladeVertexShader,
  grassBladeFragmentShader,
  GRASS_TIP_COLOR,
  GRASS_BOTTOM_COLOR,
} from "./GrassMaterial";

// "ruba il grass da qui https://pmndrs.github.io/examples/grass-shader/ e
// mettilo nel parco" -- real per-blade instanced grass (proper tapered
// blade geometry + simplex-noise wind sway + slerped bend), ported from
// that example (see GrassMaterial.ts for the full license/attribution
// chain: pmndrs/examples MIT, al-ro, Eddie Lee 2010, Ashima Arts
// webgl-noise, geeks3d.com, Wikipedia). This deliberately only replaces
// Park.tsx's own grass -- City.tsx's courtyards/plazas keep the cheaper
// flat-plane mock-shader GrassPatch from ParkTrees.tsx, since this one is
// meaningfully more expensive per-blade (tapered multi-joint geometry +
// per-instance quaternion attributes vs. a flat plane + instanceMatrix)
// and the user only asked for it "nel parco".
//
// Differences from the original example, deliberate:
//  - Ground height comes from this project's own getTerrainHeight(x,z)
//    (Terrain.tsx) instead of the example's own simplex-noise
//    getYPosition -- there's already real, walkable terrain here, we don't
//    want a second disconnected undulating ground plane under the park.
//  - No separate ground <mesh> is rendered (the example draws its own
//    height-displaced ground plane; here Terrain.tsx already owns the
//    ground).
//  - Exclusion zones (avoid) -- e.g. the fountain and paths -- are honored
//    by resampling a blade's spot a few times instead of placing it, same
//    idea as GrassPatch's own avoid handling.
//  - Instance count is tuned down from the example's 50,000 (over a
//    100-unit-wide open field with nothing else around) to fit a live
//    physics-heavy multiplayer scene alongside traffic/pedestrians/etc.

const _tmpQ0 = new THREE.Vector4();
const _tmpQ1 = new THREE.Vector4();

function multiplyQuaternions(q1: THREE.Vector4, q2: THREE.Vector4) {
  const x = q1.x * q2.w + q1.y * q2.z - q1.z * q2.y + q1.w * q2.x;
  const y = -q1.x * q2.z + q1.y * q2.w + q1.z * q2.x + q1.w * q2.y;
  const z = q1.x * q2.y - q1.y * q2.x + q1.z * q2.w + q1.w * q2.z;
  const w = -q1.x * q2.x - q1.y * q2.y - q1.z * q2.z + q1.w * q2.w;
  return new THREE.Vector4(x, y, z, w);
}

const TILT_MIN = -0.25;
const TILT_MAX = 0.25;

function isBlocked(x: number, z: number, avoid: AvoidZone[]): boolean {
  return avoid.some((a) => Math.hypot(x - a.x, z - a.z) < a.radius);
}

function buildAttributeData(
  instances: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  avoid: AvoidZone[]
) {
  const offsets = new Float32Array(instances * 3);
  const orientations = new Float32Array(instances * 4);
  const stretches = new Float32Array(instances);
  const halfRootAngleSin = new Float32Array(instances);
  const halfRootAngleCos = new Float32Array(instances);

  for (let i = 0; i < instances; i++) {
    let x = 0;
    let z = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      x = minX + Math.random() * (maxX - minX);
      z = minZ + Math.random() * (maxZ - minZ);
      if (!isBlocked(x, z, avoid)) break;
    }
    const y = getTerrainHeight(x, z);
    offsets[i * 3 + 0] = x;
    offsets[i * 3 + 1] = y;
    offsets[i * 3 + 2] = z;

    // Rotate around Y -- random growth-direction heading
    let angle = Math.PI - Math.random() * (2 * Math.PI);
    halfRootAngleSin[i] = Math.sin(0.5 * angle);
    halfRootAngleCos[i] = Math.cos(0.5 * angle);
    _tmpQ0.set(0, Math.sin(angle / 2), 0, Math.cos(angle / 2)).normalize();

    // Small random tilt around X
    angle = Math.random() * (TILT_MAX - TILT_MIN) + TILT_MIN;
    _tmpQ1.set(Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)).normalize();
    const q0 = multiplyQuaternions(_tmpQ0, _tmpQ1);

    // Small random tilt around Z
    angle = Math.random() * (TILT_MAX - TILT_MIN) + TILT_MIN;
    _tmpQ1.set(0, 0, Math.sin(angle / 2), Math.cos(angle / 2)).normalize();
    const q1 = multiplyQuaternions(q0, _tmpQ1);

    orientations[i * 4 + 0] = q1.x;
    orientations[i * 4 + 1] = q1.y;
    orientations[i * 4 + 2] = q1.z;
    orientations[i * 4 + 3] = q1.w;

    stretches[i] = i < instances / 3 ? Math.random() * 1.8 : Math.random();
  }

  return { offsets, orientations, stretches, halfRootAngleSin, halfRootAngleCos };
}

export const RealGrassPatch: React.FC<{
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  instances?: number;
  avoid?: AvoidZone[];
  bladeWidth?: number;
  bladeHeight?: number;
  joints?: number;
}> = ({
  minX,
  maxX,
  minZ,
  maxZ,
  instances = 8000,
  avoid = [],
  bladeWidth = 0.12,
  bladeHeight = 1,
  joints = 4,
}) => {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const [map, alphaMap] = useTexture([
    "textures/grass/blade_diffuse.jpg",
    "textures/grass/blade_alpha.jpg",
  ]);

  const attributeData = useMemo(
    () => buildAttributeData(instances, minX, maxX, minZ, maxZ, avoid),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [instances, minX, maxX, minZ, maxZ]
  );

  const baseGeom = useMemo(
    () =>
      new THREE.PlaneGeometry(bladeWidth, bladeHeight, 1, joints).translate(
        0,
        bladeHeight / 2,
        0
      ),
    [bladeWidth, bladeHeight, joints]
  );

  const boundingSphere = useMemo(() => {
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const radius = Math.hypot(maxX - minX, maxZ - minZ) / 2 + bladeHeight;
    return new THREE.Sphere(new THREE.Vector3(cx, 0, cz), radius);
  }, [minX, maxX, minZ, maxZ, bladeHeight]);

  const uniforms = useMemo(
    () => ({
      time: { value: 0 },
      bladeHeight: { value: bladeHeight },
      map: { value: map },
      alphaMap: { value: alphaMap },
      tipColor: { value: GRASS_TIP_COLOR },
      bottomColor: { value: GRASS_BOTTOM_COLOR },
    }),
    [bladeHeight, map, alphaMap]
  );

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.time.value = state.clock.elapsedTime / 4;
    }
  });

  return (
    <mesh>
      <instancedBufferGeometry
        index={baseGeom.index}
        attributes-position={baseGeom.attributes.position}
        attributes-uv={baseGeom.attributes.uv}
        boundingSphere={boundingSphere}
      >
        <instancedBufferAttribute attach="attributes-offset" args={[attributeData.offsets, 3]} />
        <instancedBufferAttribute attach="attributes-orientation" args={[attributeData.orientations, 4]} />
        <instancedBufferAttribute attach="attributes-stretch" args={[attributeData.stretches, 1]} />
        <instancedBufferAttribute attach="attributes-halfRootAngleSin" args={[attributeData.halfRootAngleSin, 1]} />
        <instancedBufferAttribute attach="attributes-halfRootAngleCos" args={[attributeData.halfRootAngleCos, 1]} />
      </instancedBufferGeometry>
      <shaderMaterial
        ref={materialRef}
        vertexShader={grassBladeVertexShader}
        fragmentShader={grassBladeFragmentShader}
        uniforms={uniforms}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </mesh>
  );
};

export default RealGrassPatch;
