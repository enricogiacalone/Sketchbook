import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CITY_LAYOUT } from './City';
import { getSunDirection, getDayFactor } from '../../lib/SunCycle';

// "fai illuminare i palazzi come se avessero decorazioni led la notte" --
// a thin glowing trim running around each building's roofline, in the
// per-building accent color CITY_LAYOUT already picked (ledColor/ledPhase,
// see City.tsx). Dark/invisible by day, fades up into a lively colored
// skyline at night, each building's trim gently pulsing out of phase with
// its neighbors instead of one flat static glow.
//
// Same "ONE instancedMesh, ONE useFrame" shape as Collectibles.tsx and the
// windows/floor-slabs in City.tsx -- 4 thin box segments per building (a
// rectangle outline at roof height), colored via setColorAt on a single
// MeshBasicMaterial (vertexColors + toneMapped=false, exactly like City.tsx's
// window instances, so each segment reads as fully self-lit regardless of
// the actual scene lighting -- no real light source, no per-building
// useFrame, costs nothing like the point-light-per-lamp mistake this
// codebase already paid for once with the streetlamps).
const TRIM_THICKNESS = 0.22; // vertical band height
const TRIM_PROTRUSION = 0.14; // how far it sticks out from the facade
const TRIM_INSET = 0.08; // gap between the facade surface and the trim
const PULSE_SPEED = 1.4;
const PULSE_DEPTH = 0.18; // +/- fraction of brightness

interface LedSegment {
  x: number;
  y: number;
  z: number;
  sx: number; // scale (segment is a unit box scaled per-axis)
  sy: number;
  sz: number;
  color: THREE.Color;
  phase: number;
}

// Computed ONCE at import time, same module-level trick as everywhere else
// in Environment/ -- 4 roofline segments (front/back/left/right) per
// building, straight from CITY_LAYOUT so this always matches the actual
// generated buildings without redoing any placement logic.
const ALL_SEGMENTS: LedSegment[] = (() => {
  const segments: LedSegment[] = [];
  for (const b of CITY_LAYOUT.buildings) {
    const halfW = b.w / 2;
    const halfD = b.d / 2;
    const roofY = b.by + b.h - TRIM_THICKNESS / 2 - 0.05;
    const color = new THREE.Color(b.ledColor);
    const out = halfW + TRIM_INSET; // for left/right edges
    const outD = halfD + TRIM_INSET; // for front/back edges

    segments.push(
      // front / back (run along X, offset along Z)
      { x: b.x, y: roofY, z: b.z + outD, sx: b.w + TRIM_PROTRUSION, sy: TRIM_THICKNESS, sz: TRIM_PROTRUSION, color, phase: b.ledPhase },
      { x: b.x, y: roofY, z: b.z - outD, sx: b.w + TRIM_PROTRUSION, sy: TRIM_THICKNESS, sz: TRIM_PROTRUSION, color, phase: b.ledPhase + Math.PI / 2 },
      // left / right (run along Z, offset along X)
      { x: b.x + out, y: roofY, z: b.z, sx: TRIM_PROTRUSION, sy: TRIM_THICKNESS, sz: b.d + TRIM_PROTRUSION, color, phase: b.ledPhase + Math.PI },
      { x: b.x - out, y: roofY, z: b.z, sx: TRIM_PROTRUSION, sy: TRIM_THICKNESS, sz: b.d + TRIM_PROTRUSION, color, phase: b.ledPhase + (Math.PI * 3) / 2 }
    );
  }
  return segments;
})();

const _dummy = new THREE.Object3D();
const _liveColor = new THREE.Color();

const BuildingLeds: React.FC = () => {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const t = state.clock.elapsedTime;
    const dir = getSunDirection(t);
    const nightFactor = 1 - getDayFactor(dir.y);

    // Fully off by day -- skip the per-instance loop entirely rather than
    // computing 0*color for every segment every frame.
    if (nightFactor <= 0.01) {
      if (mesh.instanceColor && (mesh.userData.wasLit as boolean | undefined)) {
        for (let i = 0; i < ALL_SEGMENTS.length; i++) {
          mesh.setColorAt(i, _liveColor.setScalar(0));
        }
        mesh.instanceColor.needsUpdate = true;
        mesh.userData.wasLit = false;
      }
      return;
    }

    mesh.userData.wasLit = true;
    for (let i = 0; i < ALL_SEGMENTS.length; i++) {
      const seg = ALL_SEGMENTS[i];
      const pulse = 1 + Math.sin(t * PULSE_SPEED + seg.phase) * PULSE_DEPTH;
      _liveColor.copy(seg.color).multiplyScalar(nightFactor * pulse);
      mesh.setColorAt(i, _liveColor);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined as any, undefined as any, ALL_SEGMENTS.length]}
      frustumCulled={false}
      onUpdate={(self) => {
        // Positions/scales are static -- set once here, only color animates
        // (in useFrame above) after this.
        for (let i = 0; i < ALL_SEGMENTS.length; i++) {
          const seg = ALL_SEGMENTS[i];
          _dummy.position.set(seg.x, seg.y, seg.z);
          _dummy.rotation.set(0, 0, 0);
          _dummy.scale.set(seg.sx, seg.sy, seg.sz);
          _dummy.updateMatrix();
          self.setMatrixAt(i, _dummy.matrix);
          self.setColorAt(i, _liveColor.setScalar(0));
        }
        self.instanceMatrix.needsUpdate = true;
        if (self.instanceColor) self.instanceColor.needsUpdate = true;
      }}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial vertexColors toneMapped={false} />
    </instancedMesh>
  );
};

export default BuildingLeds;
