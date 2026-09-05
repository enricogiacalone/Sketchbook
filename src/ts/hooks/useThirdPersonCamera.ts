import { useRef, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';

// Ports the original's CameraOperator.ts "normal" (non-free-fly) orbit mode:
// spherical coordinates in degrees around a target, phi clamped to [-85, 85],
// radius eased toward a target radius, and NO lag on the target position
// itself -- the original hard-sets `target` from the followed entity every
// frame, there's no smoothing on it (only `radius` is lerped, same as here).
const PLAYER_RADIUS = 1.6;
const VEHICLE_RADIUS = 3;
const MIN_RADIUS = 1;
const MAX_RADIUS = 20;
const VEHICLE_TARGET_Y_OFFSET = 0.5;

export const useThirdPersonCamera = () => {
  const { camera, gl, scene } = useThree();
  const { currentControllable, controlledEntityId } = useStore(
    useShallow((state) => ({
      currentControllable: state.currentControllable,
      controlledEntityId: state.controlledEntityId,
    }))
  );

  const theta = useRef(0);
  const phi = useRef(0);
  const radius = useRef(PLAYER_RADIUS);
  const targetRadius = useRef(PLAYER_RADIUS);
  const target = useRef(new THREE.Vector3());
  const sensitivity = useRef(new THREE.Vector2(0.3, 0.24));

  const prevControllable = useRef<string | null>(null);

  // Caches the resolved target Object3D so the frame loop doesn't run a
  // full recursive scene.getObjectByName() traversal every single frame --
  // only re-looked-up when the target name changes or gets detached.
  const cachedTargetName = useRef<string | null>(null);
  const cachedTargetObj = useRef<THREE.Object3D | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement === gl.domElement) {
        theta.current -= e.movementX * (sensitivity.current.x / 2);
        theta.current %= 360;
        phi.current += e.movementY * (sensitivity.current.y / 2);
        phi.current = THREE.MathUtils.clamp(phi.current, -85, 85);
      }
    };

    const handleWheel = (e: WheelEvent) => {
      targetRadius.current = THREE.MathUtils.clamp(
        targetRadius.current + e.deltaY * 0.005,
        MIN_RADIUS,
        MAX_RADIUS
      );
    };

    const handleClick = () => {
      if (document.pointerLockElement !== gl.domElement) {
        gl.domElement.requestPointerLock();
      }
    };

    gl.domElement.addEventListener('mousemove', handleMouseMove);
    gl.domElement.addEventListener('wheel', handleWheel);
    gl.domElement.addEventListener('click', handleClick);

    return () => {
      gl.domElement.removeEventListener('mousemove', handleMouseMove);
      gl.domElement.removeEventListener('wheel', handleWheel);
      gl.domElement.removeEventListener('click', handleClick);
    };
  }, [gl]);

  useFrame(() => {
    const targetName = currentControllable === 'player' ? 'player' : controlledEntityId;
    if (!targetName) return;

    if (
      cachedTargetName.current !== targetName ||
      !cachedTargetObj.current ||
      !cachedTargetObj.current.parent
    ) {
      cachedTargetObj.current = scene.getObjectByName(targetName) ?? null;
      cachedTargetName.current = targetName;
    }
    const targetObj = cachedTargetObj.current;
    if (!targetObj) return;

    // Snap the radius instantly when switching what's controlled (getting
    // in/out of a vehicle), same as the original's setRadius(value, true).
    if (prevControllable.current !== currentControllable) {
      const snapped = currentControllable === 'player' ? PLAYER_RADIUS : VEHICLE_RADIUS;
      targetRadius.current = snapped;
      radius.current = snapped;
      prevControllable.current = currentControllable;
    }

    targetObj.getWorldPosition(target.current);
    if (currentControllable !== 'player') {
      target.current.y += VEHICLE_TARGET_Y_OFFSET;
    }

    radius.current = THREE.MathUtils.lerp(radius.current, targetRadius.current, 0.1);

    const thetaRad = (theta.current * Math.PI) / 180;
    const phiRad = (phi.current * Math.PI) / 180;

    camera.position.set(
      target.current.x + radius.current * Math.sin(thetaRad) * Math.cos(phiRad),
      target.current.y + radius.current * Math.sin(phiRad),
      target.current.z + radius.current * Math.cos(thetaRad) * Math.cos(phiRad)
    );
    camera.lookAt(target.current);
  });

  return { theta, phi, radius };
};
