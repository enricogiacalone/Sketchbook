import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { getTerrainHeight } from './Terrain';
import { getRoadOffset } from './Road';
import { CityBuildingRecord } from './City';
import { getBuildingClimbPath, ClimbWaypoint } from './BuildingClimb';

// Ported from simulation-citta's "AgentSoldier" (Simulation 2: Hide and
// Seek). Two modes now:
// - No `building` prop: the original simplification -- back-and-forth
//   ground patrol like Pedestrian.tsx's ambient crowd (x1/z1/x2/z2).
// - `building` prop set: "i soldati [percorrono] le scale ... fino in
//   cima e poi scendono ogni tanto" -- climbs that building's actual
//   stairwell (City.tsx's real floors/stairs, see BuildingClimb.ts for the
//   waypoint path through it) up to the roof, pauses, comes back down,
//   pauses, repeats. This is the closer match to AgentSoldier's original
//   floor-to-floor waypoint routes (ROUTES: "ground->floor1" etc.), just
//   walking this city's own procedurally-generated buildings instead of
//   the original's one hardcoded demo building.
//
// Purely decorative either way, like Pedestrian -- no RigidBody/collider.
//
// Uses three.js's own official example asset (not bundled locally -- the
// original component fetched it from the same CDN URL, so this keeps that
// behavior rather than requiring a new local copy). useGLTF caches it after
// the first load like any other model here.
const SOLDIER_MODEL_URL = 'https://threejs.org/examples/models/gltf/Soldier.glb';

interface SoldierProps {
  id: string;
  x1?: number;
  z1?: number;
  x2?: number;
  z2?: number;
  speed?: number;
  phase?: number;
  building?: CityBuildingRecord;
}

const Soldier: React.FC<SoldierProps> = ({ x1 = 0, z1 = 0, x2 = 0, z2 = 0, speed = 1.4, phase = 0, building }) => {
  const { scene, animations } = useGLTF(SOLDIER_MODEL_URL);
  // Same reason as every other skinned NPC in this project (Pedestrian.tsx,
  // Player.tsx, Enemy.tsx): a plain Object3D clone doesn't rebind the
  // skeleton, so SkeletonUtils.clone is required for a second instance of
  // this GLB to animate/render correctly.
  const clonedScene = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { actions } = useAnimations(animations, clonedScene);
  const groupRef = useRef<THREE.Group>(null);

  // --- Ground-patrol mode state (building not set) ------------------
  const start = useMemo(() => new THREE.Vector3(x1, 0, z1), [x1, z1]);
  const end = useMemo(() => new THREE.Vector3(x2, 0, z2), [x2, z2]);
  const segmentLength = useMemo(() => start.distanceTo(end), [start, end]);
  const patrolInitialPos = useMemo(() => {
    const p = new THREE.Vector3().lerpVectors(start, end, phase);
    const y = getTerrainHeight(p.x, p.z) + getRoadOffset(p.x, p.z);
    return [p.x, y, p.z] as [number, number, number];
  }, [start, end, phase]);
  const t = useRef(phase);
  const dir = useRef(1);

  // --- Building-climb mode state (building set) ----------------------
  const climbPathUp = useMemo(() => (building ? getBuildingClimbPath(building) : null), [building]);
  const climbPathDown = useMemo(() => (climbPathUp ? [...climbPathUp].reverse() : null), [climbPathUp]);
  const climbMode = useRef<'up' | 'pauseTop' | 'down' | 'pauseBottom'>('up');
  const climbIndex = useRef(0);
  const climbPos = useRef(
    new THREE.Vector3(climbPathUp?.[0]?.x ?? 0, climbPathUp?.[0]?.y ?? 0, climbPathUp?.[0]?.z ?? 0)
  );
  const pauseTimer = useRef(2 + Math.random() * 2);

  const climbInitialPos = useMemo((): [number, number, number] => {
    const p = climbPathUp?.[0];
    return p ? [p.x, p.y, p.z] : [0, 0, 0];
  }, [climbPathUp]);

  const currentAnim = useRef<string | null>(null);
  const pauseTimerPatrol = useRef(0);
  const scratchPos = useRef(new THREE.Vector3());
  // Facing uses the SAME lookAt+quaternion-slerp approach the original
  // AgentSoldier used (rather than the atan2(dx,dz) rotation.y trick
  // Pedestrian.tsx uses for boxman.glb) -- the official three.js
  // Soldier.glb model's own default-facing axis doesn't agree with that
  // formula, which is what made this walk backwards. Scratch objects
  // reused every frame to avoid per-frame allocation.
  const lookTarget = useRef(new THREE.Vector3());
  const upVector = useRef(new THREE.Vector3(0, 1, 0));
  const lookMatrix = useRef(new THREE.Matrix4());
  const lookQuaternion = useRef(new THREE.Quaternion());

  const playAnim = (name: string) => {
    const target = actions[name];
    if (!target || currentAnim.current === name) return;
    currentAnim.current = name;
    Object.values(actions).forEach((a) => a?.fadeOut(0.2));
    target.reset().fadeIn(0.2).play();
  };

  const faceToward = (target: THREE.Vector3, delta: number) => {
    if (!groupRef.current) return;
    lookTarget.current.set(target.x, groupRef.current.position.y, target.z);
    if (!groupRef.current.position.equals(lookTarget.current)) {
      lookMatrix.current.lookAt(groupRef.current.position, lookTarget.current, upVector.current);
      lookQuaternion.current.setFromRotationMatrix(lookMatrix.current);
      groupRef.current.quaternion.slerp(lookQuaternion.current, delta * 15);
    }
  };

  useFrame((_state, delta) => {
    if (!groupRef.current) return;

    if (building && climbPathUp && climbPathDown) {
      if (climbMode.current === 'pauseTop' || climbMode.current === 'pauseBottom') {
        pauseTimer.current -= delta;
        playAnim('Idle');
        if (pauseTimer.current <= 0) {
          climbMode.current = climbMode.current === 'pauseTop' ? 'down' : 'up';
          climbIndex.current = 0;
          pauseTimer.current = 4 + Math.random() * 3;
        }
        return;
      }

      const path: ClimbWaypoint[] = climbMode.current === 'up' ? climbPathUp : climbPathDown;
      const targetWp = path[Math.min(climbIndex.current, path.length - 1)];
      const targetVec = scratchPos.current.set(targetWp.x, targetWp.y, targetWp.z);
      const toTarget = new THREE.Vector3().subVectors(targetVec, climbPos.current);
      const dist = toTarget.length();

      if (dist < 0.08) {
        climbIndex.current += 1;
        if (climbIndex.current >= path.length) {
          climbMode.current = climbMode.current === 'up' ? 'pauseTop' : 'pauseBottom';
          pauseTimer.current = 4 + Math.random() * 3;
        }
      } else {
        toTarget.normalize();
        // Climbing pace -- a touch slower than the street patrol's run, a
        // staircase isn't sprinted.
        climbPos.current.addScaledVector(toTarget, Math.min(dist, speed * 0.8 * delta));
        playAnim(actions['Walk'] ? 'Walk' : 'Run');
        groupRef.current.position.copy(climbPos.current);
        faceToward(targetVec, delta);
        return;
      }

      groupRef.current.position.copy(climbPos.current);
      return;
    }

    // --- Ground-patrol mode (unchanged from the original simplification) --
    if (segmentLength < 0.01) return;

    if (pauseTimerPatrol.current > 0) {
      pauseTimerPatrol.current -= delta;
      playAnim('Idle');
    } else {
      t.current += (dir.current * speed * delta) / segmentLength;
      if (t.current >= 1) {
        t.current = 1;
        dir.current = -1;
        pauseTimerPatrol.current = 1 + Math.random() * 1.5;
      } else if (t.current <= 0) {
        t.current = 0;
        dir.current = 1;
        pauseTimerPatrol.current = 1 + Math.random() * 1.5;
      }
      // AgentSoldier preferred "Run" over "Walk" when both existed; kept
      // as-is since Soldier.glb does ship both.
      playAnim(actions['Run'] ? 'Run' : 'Walk');
    }

    const pos = scratchPos.current.lerpVectors(start, end, t.current);
    const y = getTerrainHeight(pos.x, pos.z) + getRoadOffset(pos.x, pos.z);
    groupRef.current.position.set(pos.x, y, pos.z);

    const facing = dir.current >= 0 ? end : start;
    faceToward(facing, delta);
  });

  return (
    <group ref={groupRef} position={building ? climbInitialPos : patrolInitialPos}>
      <primitive object={clonedScene} />
    </group>
  );
};

export default Soldier;

useGLTF.preload(SOLDIER_MODEL_URL);
