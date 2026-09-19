import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../../store';
import type { SolidBodySegmentDebug } from './ragdoll/useRagdoll';

// "fai riferimenti visivi per ragdoll e fisica dei solidi" -- draws a
// live wireframe capsule over EVERY one of a fighter's real 11 solid-body
// colliders (useRagdoll.ts's resolveBodyMovement), so what's actually
// colliding is something you can SEE, not just trust from numbers --
// toggled from CombatArenaGUI.tsx's debug panel ("Mostra collider
// fisici"), off by default so it never clutters ordinary play.
//
// A fixed pool of 11 meshes (RAGDOLL_SEGMENTS' own count), reused frame
// to frame rather than creating/destroying React elements as segments
// come and go -- getSegments() can return fewer than 11 for a frame or
// two right after mount (bones not resolved yet), any unused slot is
// just hidden. Each segment's radius/halfHeight is fixed for the whole
// life of a fighter (only position/rotation change frame to frame -- see
// useRagdoll.ts's own comment on why), so the geometry for a given
// segment NAME is built once and cached rather than rebuilt every frame.
const MAX_SOLID_SEGMENTS = 15; // 11 RAGDOLL_SEGMENTS + 4 SOLID_BODY_EXTRA_SEGMENTS (hands/feet) -- see ragdollConfig.ts
const DEBUG_COLOR = '#00e5ff';

interface SolidBodyDebugViewProps {
  // Pull-based rather than push-based (no props re-render every frame) --
  // matches how the rest of this codebase already reads live physics
  // state from inside useFrame (e.g. DuelArena.tsx's own duelDebug).
  getSegments: () => SolidBodySegmentDebug[];
}

const SolidBodyDebugView: React.FC<SolidBodyDebugViewProps> = ({ getSegments }) => {
  const meshRefs = useRef<(THREE.Mesh | null)[]>([]);
  // Keyed by segment NAME (e.g. "Torso", "UpperArm_L") -- see the file
  // comment above for why this only ever needs to build each one once.
  const geomCache = useRef<Record<string, THREE.CapsuleGeometry>>({});
  const geomKeyPerSlot = useRef<(string | null)[]>(new Array(MAX_SOLID_SEGMENTS).fill(null));

  useFrame(() => {
    const show = useStore.getState().showPhysicsDebug;
    if (!show) {
      for (const mesh of meshRefs.current) {
        if (mesh && mesh.visible) mesh.visible = false;
      }
      return;
    }

    const segments = getSegments();
    for (let i = 0; i < MAX_SOLID_SEGMENTS; i++) {
      const mesh = meshRefs.current[i];
      if (!mesh) continue;
      const seg = segments[i];
      if (!seg) {
        mesh.visible = false;
        continue;
      }

      mesh.visible = true;
      mesh.position.set(seg.x, seg.y, seg.z);
      mesh.quaternion.set(seg.qx, seg.qy, seg.qz, seg.qw);

      // Rapier's capsule(halfHeight, radius) straight section is
      // 2*halfHeight long -- THREE.CapsuleGeometry's own `length` param
      // is exactly that same straight-section length, so this lines up
      // 1:1 with the real collider shape, not an approximation.
      if (geomKeyPerSlot.current[i] !== seg.name) {
        let geom = geomCache.current[seg.name];
        if (!geom) {
          geom = new THREE.CapsuleGeometry(seg.radius, seg.halfHeight * 2, 4, 8);
          geomCache.current[seg.name] = geom;
        }
        mesh.geometry = geom;
        geomKeyPerSlot.current[i] = seg.name;
      }
    }
  });

  return (
    <group>
      {Array.from({ length: MAX_SOLID_SEGMENTS }).map((_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            meshRefs.current[i] = m;
          }}
          visible={false}
        >
          <meshBasicMaterial color={DEBUG_COLOR} wireframe transparent opacity={0.9} depthTest={false} />
        </mesh>
      ))}
    </group>
  );
};

export default SolidBodyDebugView;
