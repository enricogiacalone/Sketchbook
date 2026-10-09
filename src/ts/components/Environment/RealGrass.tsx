import React, { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import { getTerrainHeight } from "./Terrain";
import { AvoidZone } from "./ParkTrees";
import { GRASS_TIP_COLOR, GRASS_BOTTOM_COLOR } from "./GrassMaterial";
import {
  uv,
  Fn,
  vec3,
  vec4,
  float,
  uniform,
  texture,
  attribute,
  mix,
  cross,
  normalize,
  positionLocal,
  cameraProjectionMatrix,
  modelViewMatrix,
} from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";

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
  avoid: AvoidZone[],
  baseY?: number
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
    const y = baseY !== undefined ? baseY : getTerrainHeight(x, z);
    offsets[i * 3 + 0] = x;
    offsets[i * 3 + 1] = y;
    offsets[i * 3 + 2] = z;

    let angle = Math.PI - Math.random() * (2 * Math.PI);
    halfRootAngleSin[i] = Math.sin(0.5 * angle);
    halfRootAngleCos[i] = Math.cos(0.5 * angle);
    _tmpQ0.set(0, Math.sin(angle / 2), 0, Math.cos(angle / 2)).normalize();

    angle = Math.random() * (TILT_MAX - TILT_MIN) + TILT_MIN;
    _tmpQ1.set(Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)).normalize();
    const q0 = multiplyQuaternions(_tmpQ0, _tmpQ1);

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
  baseY?: number;
}> = ({
  minX,
  maxX,
  minZ,
  maxZ,
  instances = 8000,
  avoid = [],
  bladeWidth = 0.075,
  bladeHeight = 0.55,
  joints = 4,
  baseY,
}) => {
  const [map, alphaMap] = useTexture([
    "textures/grass/blade_diffuse.jpg",
    "textures/grass/blade_alpha.jpg",
  ]);

  const attributeData = useMemo(
    () => buildAttributeData(instances, minX, maxX, minZ, maxZ, avoid, baseY),
    [instances, minX, maxX, minZ, maxZ, avoid, baseY]
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

  const timeUniform = useMemo(() => uniform(0), []);

  useFrame((state) => {
    timeUniform.value = state.clock.elapsedTime / 4;
  });

  const material = useMemo(() => {
    const mat = new MeshBasicNodeMaterial() as any;
    mat.side = THREE.DoubleSide;
    mat.toneMapped = false;

    const uBladeHeight = float(bladeHeight);

    const rotateVectorByQuaternion = Fn(([v, q]: any) => {
      const qxyz = q.xyz;
      const term1 = v.mul(q.w).add(cross(qxyz, v));
      const crossTerm = cross(qxyz, term1);
      return crossTerm.mul(2.0).add(v);
    });

    const slerp = Fn(([v0, v1, t]: any) => {
      const res = mix(v0, v1, t);
      return normalize(res);
    });

    mat.vertexNode = Fn(() => {
      const offset = attribute('offset', 'vec3');
      const orientation = attribute('orientation', 'vec4');
      const halfRootAngleSin = attribute('halfRootAngleSin', 'float');
      const halfRootAngleCos = attribute('halfRootAngleCos', 'float');
      const stretch = attribute('stretch', 'float');

      const pos = positionLocal as any;
      const frc = pos.y.div(uBladeHeight);

      const direction = vec4(0.0, halfRootAngleSin, 0.0, halfRootAngleCos);
      const interpolatedDir = slerp(direction, orientation, frc);

      const vPosition = vec3(pos.x, pos.y.add(pos.y.mul(stretch)), pos.z);
      const rotated = rotateVectorByQuaternion(vPosition, interpolatedDir);

      // Wind sway using timeUniform and offset
      const windAngle = timeUniform.sub(offset.x.div(20.0)).sin().mul(frc.mul(0.3));
      const halfAngle = windAngle.mul(0.5);
      const windRot = normalize(vec4(halfAngle.sin(), 0.0, halfAngle.negate().sin(), halfAngle.cos()));
      const windRotated = rotateVectorByQuaternion(rotated, windRot);

      const finalPos = offset.add(windRotated);
      return cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(finalPos, 1.0));
    })();

    mat.colorNode = Fn(() => {
      const uvCoord = uv();
      const alpha = texture(alphaMap, uvCoord).r;
      alpha.lessThan(0.15).discard();

      const col = texture(map, uvCoord);
      const pos = positionLocal as any;
      const frc = pos.y.div(uBladeHeight);
      const colWithTip = mix(vec4(GRASS_TIP_COLOR, 1.0), col, frc);
      const finalCol = mix(vec4(GRASS_BOTTOM_COLOR, 1.0), colWithTip, frc);

      return finalCol;
    })();

    return mat;
  }, [map, alphaMap, bladeHeight]);

  return (
    <mesh material={material as any} frustumCulled={false}>
      <instancedBufferGeometry
        ref={(geom) => {
          if (geom) geom.instanceCount = instances;
        }}
        boundingSphere={boundingSphere}
      >
        <bufferAttribute attach="index" args={[baseGeom.index!.array, 1]} />
        <bufferAttribute attach="attributes-position" args={[baseGeom.attributes.position.array, 3]} />
        <bufferAttribute attach="attributes-uv" args={[baseGeom.attributes.uv.array, 2]} />
        <instancedBufferAttribute attach="attributes-offset" args={[attributeData.offsets, 3]} />
        <instancedBufferAttribute attach="attributes-orientation" args={[attributeData.orientations, 4]} />
        <instancedBufferAttribute attach="attributes-stretch" args={[attributeData.stretches, 1]} />
        <instancedBufferAttribute attach="attributes-halfRootAngleSin" args={[attributeData.halfRootAngleSin, 1]} />
        <instancedBufferAttribute attach="attributes-halfRootAngleCos" args={[attributeData.halfRootAngleCos, 1]} />
      </instancedBufferGeometry>
    </mesh>
  );
};

export default RealGrassPatch;
