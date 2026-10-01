import React, { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RigidBody, CuboidCollider, interactionGroups } from '@react-three/rapier';
import { CollisionGroups } from '../../enums/CollisionGroups';
import { STAIR_RAMP_GROUPS } from './traversal/traversalWorld';
import {
  BUILDING_HOLE_LEN,
  BUILDING_SLAB_THICKNESS,
  BUILDING_STAIR_LANE,
  BUILDING_STAIR_RUN,
  BUILDING_WALL_THICKNESS,
  STAIR_RAMP_T,
  STAIR_STEP_RISE,
  floorTopY,
  getFloorFlights,
  getHoleBounds,
  getStairwell,
  rampTransform,
  type StairFlight,
} from './buildingStairs';

// Interni dei palazzi: solette dei piani, tetto, scala a due rampe con
// pianerottolo e parapetto -- grafica E collider (vedi buildingStairs.ts).
// Solette, rampe e pianerottoli sono "solo appoggio" (STAIR_RAMP_GROUPS: i
// piedi del manichino ci stanno sopra via supportHeight, le capsule del
// corpo non li prendono di fronte come muri); il parapetto invece blocca.

const ALL = Array.from({ length: 16 }, (_, i) => i);
const RAIL_GROUPS = interactionGroups(
  [CollisionGroups.Default, CollisionGroups.Characters, CollisionGroups.RagdollWorld],
  ALL
);
const RAIL_H = 1.0;
const RAIL_T = 0.06;
const STRINGER_T = 0.12;
const LANDING_T = 0.2;

const _o = new THREE.Object3D();

interface Props {
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  corner: number;
  numFloors: number;
  floorHeight: number;
  roofMaterial: { color: string; roughness: number; metalness: number };
}

export const BuildingStairwell: React.FC<Props> = ({ x, y, z, width, depth, height, corner, numFloors, floorHeight, roofMaterial }) => {
  const g = useMemo(() => {
    const halfW = width / 2;
    const halfD = depth / 2;
    const { sx, sz, holeMinX, holeMaxX, holeMinZ, holeMaxZ } = getHoleBounds(width, depth, corner);
    const sw = getStairwell(width, depth, corner);
    // soletta a L: pezzo A (tutta la profondita', fuori dalla fascia X del
    // vano) + pezzo B (fascia X del vano, fuori dal vano in Z)
    const aMinX = sx < 0 ? holeMaxX : -halfW;
    const aMaxX = sx < 0 ? halfW : holeMinX;
    const bMinZ = sz < 0 ? holeMaxZ : -halfD;
    const bMaxZ = sz < 0 ? halfD : holeMinZ;
    const pieceA = { cx: (aMinX + aMaxX) / 2, cz: 0, w: aMaxX - aMinX, d: depth };
    const pieceB = { cx: (holeMinX + holeMaxX) / 2, cz: (bMinZ + bMaxZ) / 2, w: BUILDING_HOLE_LEN, d: bMaxZ - bMinZ };

    const flights: StairFlight[] = [];
    const landings: { y: number }[] = [];
    for (let f = 0; f < numFloors; f++) {
      const ff = getFloorFlights(sw, f, numFloors, floorHeight);
      flights.push(ff.a, ff.b);
      landings.push({ y: ff.ym });
    }
    // gradini: stesso numero per ogni rampa (alzata ~18 cm)
    const steps = Math.max(6, Math.round(floorHeight / 2 / STAIR_STEP_RISE));
    // parapetto sul bordo del vano verso il pezzo B, a ogni piano e sul tetto
    const railLen = Math.abs(sw.xWall - sw.xIn);
    const railCX = (sw.xIn + sw.xWall) / 2;
    const railZ = sw.zEdge - sz * (RAIL_T / 2 + 0.01);
    const railYs: number[] = [];
    for (let f = 1; f <= numFloors; f++) railYs.push(floorTopY(f, numFloors, floorHeight));
    return { sw, pieceA, pieceB, flights, landings, steps, railLen, railCX, railZ, railYs };
  }, [width, depth, corner, numFloors, floorHeight]);

  const { sw, pieceA, pieceB, flights, landings, steps, railLen, railCX, railZ, railYs } = g;
  const roofY = height + BUILDING_WALL_THICKNESS / 2;
  const stepRun = (BUILDING_STAIR_RUN / steps) * 1.1; // leggera sovrapposizione, niente fessure
  const stepRise = floorHeight / 2 / steps;

  const slabARef = useRef<THREE.InstancedMesh>(null);
  const slabBRef = useRef<THREE.InstancedMesh>(null);
  const stepRef = useRef<THREE.InstancedMesh>(null);
  const stringerRef = useRef<THREE.InstancedMesh>(null);
  const landingRef = useRef<THREE.InstancedMesh>(null);
  const railRef = useRef<THREE.InstancedMesh>(null);

  // matrici delle istanze (coordinate del mondo: le mesh non stanno in un gruppo)
  useLayoutEffect(() => {
    const put = (m: THREE.InstancedMesh | null, i: number, px: number, py: number, pz: number, rz = 0) => {
      if (!m) return;
      _o.position.set(x + px, y + py, z + pz);
      _o.rotation.set(0, 0, rz);
      _o.updateMatrix();
      m.setMatrixAt(i, _o.matrix);
    };
    for (let f = 1; f < numFloors; f++) {
      put(slabARef.current, f - 1, pieceA.cx, f * floorHeight, pieceA.cz);
      put(slabBRef.current, f - 1, pieceB.cx, f * floorHeight, pieceB.cz);
    }
    flights.forEach((fl, k) => {
      for (let i = 0; i < steps; i++) {
        const t = (i + 0.5) / steps;
        // la cima di ogni gradino sta sulla rampa di collisione, al centro del gradino
        put(stepRef.current, k * steps + i, fl.xa + (fl.xb - fl.xa) * t, fl.ya + (fl.yb - fl.ya) * t - stepRise / 2, fl.z);
      }
      // soletta inclinata sotto i gradini
      const r = rampTransform({ ...fl, ya: fl.ya - stepRise, yb: fl.yb - stepRise }, STRINGER_T);
      put(stringerRef.current, k, r.x, r.y, r.z, r.rotZ);
    });
    landings.forEach((l, k) => put(landingRef.current, k, sw.landingCX, l.y - LANDING_T / 2, sw.landingCZ));
    railYs.forEach((ry, k) => put(railRef.current, k, railCX, ry + RAIL_H / 2, railZ));
    for (const m of [slabARef.current, slabBRef.current, stepRef.current, stringerRef.current, landingRef.current, railRef.current]) {
      if (!m) continue;
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }, [x, y, z, g, numFloors, floorHeight, steps, stepRise, sw, pieceA, pieceB, flights, landings, railYs, railCX, railZ]);

  const stringerLen = rampTransform(flights[0]).len;
  const key = `${numFloors}-${floorHeight.toFixed(4)}-${width.toFixed(3)}-${depth.toFixed(3)}-${corner}`;

  return (
    <group>
      <RigidBody type="fixed" colliders={false} position={[x, y, z]}>
        {flights.map((fl, i) => {
          const r = rampTransform(fl);
          return (
            <CuboidCollider
              key={`ramp-${i}`}
              args={[r.len / 2, STAIR_RAMP_T / 2, BUILDING_STAIR_LANE / 2]}
              position={[r.x, r.y, r.z]}
              rotation={[0, 0, r.rotZ]}
              collisionGroups={STAIR_RAMP_GROUPS}
            />
          );
        })}
        {landings.map((l, i) => (
          <CuboidCollider
            key={`landing-${i}`}
            args={[sw.landingHX, LANDING_T / 2, sw.landingHZ]}
            position={[sw.landingCX, l.y - LANDING_T / 2, sw.landingCZ]}
            collisionGroups={STAIR_RAMP_GROUPS}
          />
        ))}
        {Array.from({ length: Math.max(0, numFloors - 1) }, (_, k) => {
          const cy = (k + 1) * floorHeight;
          return (
            <React.Fragment key={`slab-${k}`}>
              <CuboidCollider args={[pieceA.w / 2, BUILDING_SLAB_THICKNESS / 2, pieceA.d / 2]} position={[pieceA.cx, cy, pieceA.cz]} collisionGroups={STAIR_RAMP_GROUPS} />
              <CuboidCollider args={[pieceB.w / 2, BUILDING_SLAB_THICKNESS / 2, pieceB.d / 2]} position={[pieceB.cx, cy, pieceB.cz]} collisionGroups={STAIR_RAMP_GROUPS} />
            </React.Fragment>
          );
        })}
        <CuboidCollider args={[pieceA.w / 2, BUILDING_WALL_THICKNESS / 2, pieceA.d / 2]} position={[pieceA.cx, roofY, pieceA.cz]} collisionGroups={STAIR_RAMP_GROUPS} />
        <CuboidCollider args={[pieceB.w / 2, BUILDING_WALL_THICKNESS / 2, pieceB.d / 2]} position={[pieceB.cx, roofY, pieceB.cz]} collisionGroups={STAIR_RAMP_GROUPS} />
        {railYs.map((ry, i) => (
          <CuboidCollider key={`rail-${i}`} args={[railLen / 2, RAIL_H / 2, RAIL_T / 2]} position={[railCX, ry + RAIL_H / 2, railZ]} collisionGroups={RAIL_GROUPS} />
        ))}
      </RigidBody>

      {/* tetto a L: il vano resta aperto, l'ultima rampa esce sul tetto */}
      <mesh position={[x + pieceA.cx, y + roofY, z + pieceA.cz]} castShadow receiveShadow>
        <boxGeometry args={[pieceA.w, BUILDING_WALL_THICKNESS, pieceA.d]} />
        <meshStandardMaterial {...roofMaterial} />
      </mesh>
      <mesh position={[x + pieceB.cx, y + roofY, z + pieceB.cz]} castShadow receiveShadow>
        <boxGeometry args={[pieceB.w, BUILDING_WALL_THICKNESS, pieceB.d]} />
        <meshStandardMaterial {...roofMaterial} />
      </mesh>

      {numFloors > 1 && (
        <>
          <instancedMesh key={`sa-${key}`} ref={slabARef} args={[undefined, undefined, numFloors - 1]} receiveShadow>
            <boxGeometry args={[pieceA.w, BUILDING_SLAB_THICKNESS, pieceA.d]} />
            <meshStandardMaterial color="#4a4a4a" roughness={0.85} />
          </instancedMesh>
          <instancedMesh key={`sb-${key}`} ref={slabBRef} args={[undefined, undefined, numFloors - 1]} receiveShadow>
            <boxGeometry args={[pieceB.w, BUILDING_SLAB_THICKNESS, pieceB.d]} />
            <meshStandardMaterial color="#4a4a4a" roughness={0.85} />
          </instancedMesh>
        </>
      )}

      {/* gradini (come l'arena) */}
      <instancedMesh key={`st-${key}`} ref={stepRef} args={[undefined, undefined, flights.length * steps]} castShadow receiveShadow>
        <boxGeometry args={[stepRun, stepRise, BUILDING_STAIR_LANE]} />
        <meshStandardMaterial color="#4f46e5" roughness={0.7} metalness={0.1} />
      </instancedMesh>
      {/* soletta inclinata sotto ogni rampa */}
      <instancedMesh key={`sg-${key}`} ref={stringerRef} args={[undefined, undefined, flights.length]} castShadow receiveShadow>
        <boxGeometry args={[stringerLen, STRINGER_T, BUILDING_STAIR_LANE]} />
        <meshStandardMaterial color="#5b5f66" roughness={0.85} />
      </instancedMesh>
      {/* pianerottoli intermedi */}
      <instancedMesh key={`ld-${key}`} ref={landingRef} args={[undefined, undefined, landings.length]} castShadow receiveShadow>
        <boxGeometry args={[sw.landingHX * 2, LANDING_T, sw.landingHZ * 2]} />
        <meshStandardMaterial color="#4a4a4a" roughness={0.85} />
      </instancedMesh>
      {/* parapetto sul bordo del vano */}
      <instancedMesh key={`rl-${key}`} ref={railRef} args={[undefined, undefined, railYs.length]} castShadow>
        <boxGeometry args={[railLen, RAIL_H, RAIL_T]} />
        <meshStandardMaterial color="#9aa3ad" roughness={0.4} metalness={0.6} />
      </instancedMesh>
    </group>
  );
};

export default BuildingStairwell;
