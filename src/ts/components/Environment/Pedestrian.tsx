import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { getTerrainHeight } from './Terrain';
import { getRoadOffset } from './Road';

interface PedestrianProps {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  speed?: number;
  phase?: number;
}

// Background crowd filler -- same boxman.glb as the player, walking back
// and forth along a short fixed sidewalk segment. Purely decorative: no
// RigidBody/collider at all (unlike the street furniture in CityDetails.tsx),
// so the player can walk straight through one. Good enough for ambient city
// life without adding ~20 more physics bodies for something nobody is meant
// to actually bump into meaningfully.
//
// boxman.glb has no separate "walk" clip (checked its animation list
// directly: idle/run/sprint/jump*/sit*/stand*/etc, no walk) -- using 'run'
// at a slow linear speed reads a little brisk up close, but at the
// distances these are actually seen from around the city it's a fine
// stand-in, and matches the run cycle Player.tsx itself already uses.
const Pedestrian: React.FC<PedestrianProps> = ({ x1, z1, x2, z2, speed = 1.2, phase = 0 }) => {
  const { scene, animations } = useGLTF('boxman.glb');
  // Plain scene.clone() (Object3D.clone) does NOT re-bind skinned-mesh
  // skeletons -- every clone's SkinnedMesh would keep pointing at the
  // ORIGINAL scene's bones, which are never part of any rendered tree here
  // (only clones get mounted via <primitive>) and so never get their
  // matrixWorld updated. Net effect: the mesh renders frozen at its bind
  // pose with a stale/identity world matrix -- effectively invisible.
  // Player.tsx hits the same GLB the same way and already uses
  // SkeletonUtils.clone for exactly this reason; match it here.
  const clonedScene = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { actions } = useAnimations(animations, clonedScene);
  const groupRef = useRef<THREE.Group>(null);

  const start = useMemo(() => new THREE.Vector3(x1, 0, z1), [x1, z1]);
  const end = useMemo(() => new THREE.Vector3(x2, 0, z2), [x2, z2]);
  const segmentLength = useMemo(() => start.distanceTo(end), [start, end]);

  const t = useRef(phase);
  const dir = useRef(1);
  const currentAnim = useRef<string | null>(null);
  const pauseTimer = useRef(0);
  const scratchPos = useRef(new THREE.Vector3());

  const playAnim = (name: string) => {
    if (currentAnim.current === name || !actions[name]) return;
    currentAnim.current = name;
    Object.values(actions).forEach((a) => a?.fadeOut(0.2));
    actions[name]!.reset().fadeIn(0.2).play();
  };

  useFrame((_state, delta) => {
    if (!groupRef.current || segmentLength < 0.01) return;

    if (pauseTimer.current > 0) {
      pauseTimer.current -= delta;
      playAnim('idle');
    } else {
      t.current += (dir.current * speed * delta) / segmentLength;
      if (t.current >= 1) {
        t.current = 1;
        dir.current = -1;
        pauseTimer.current = 1 + Math.random() * 1.5;
      } else if (t.current <= 0) {
        t.current = 0;
        dir.current = 1;
        pauseTimer.current = 1 + Math.random() * 1.5;
      }
      playAnim('run');
    }

    const pos = scratchPos.current.lerpVectors(start, end, t.current);
    const y = getTerrainHeight(pos.x, pos.z) + getRoadOffset(pos.x, pos.z);
    groupRef.current.position.set(pos.x, y, pos.z);

    const facing = dir.current >= 0 ? end : start;
    const dx = facing.x - pos.x;
    const dz = facing.z - pos.z;
    if (Math.hypot(dx, dz) > 0.01) {
      groupRef.current.rotation.y = Math.atan2(dx, dz);
    }
  });

  return (
    <group ref={groupRef}>
      <primitive object={clonedScene} />
    </group>
  );
};

export default Pedestrian;
