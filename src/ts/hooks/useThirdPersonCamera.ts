import { useRef, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { useInput } from './useInput';

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

// Right-stick camera look. useInput.ts's poller only ever reads the LEFT
// stick (axes[0]/[1], for movement) -- despite a comment further down in
// this file claiming the right stick was "handled separately" here, nothing
// here ever actually read axes[2]/[3] either. Net effect: a gamepad could
// move the character but never turn the camera at all. STICK_DEADZONE
// matches useInput.ts's movement deadzone; the two *_SPEED constants are
// in degrees/second since, unlike the mouse's per-event movementX/Y deltas,
// a held stick has to be scaled by frame time to stay frame-rate independent.
const CAMERA_STICK_DEADZONE = 0.2;
const CAMERA_STICK_YAW_SPEED = 140;
const CAMERA_STICK_PITCH_SPEED = 110;

// 4 selectable third-person zoom presets, cycled with Select/Back on the
// gamepad (or C on the keyboard -- both drive the same 'camera' action,
// which previously existed but had nothing reading it). Mouse wheel still
// free-zooms continuously on top of whichever preset is active; cycling
// again just jumps targetRadius to the next fixed value.
const ZOOM_LEVELS = [1.6, 4, 8, 14];

export const useThirdPersonCamera = () => {
  const { camera, gl, scene } = useThree();
  const { currentControllable, controlledEntityId, togglePause } = useStore(
    useShallow((state) => ({
      currentControllable: state.currentControllable,
      controlledEntityId: state.controlledEntityId,
      togglePause: state.togglePause,
    }))
  );
  // This hook is mounted exactly once (via the always-present
  // <ThirdPersonCamera /> in App.tsx), unlike Player/Car/Airplane/Helicopter
  // which each get their own useInput() instance -- that makes it the one
  // safe place to consume a global, one-shot action like pause or zoom-cycle:
  // checking consumeJustPressed('pause') from, say, Player AND Car at once
  // (while driving, both are mounted) would double-fire it from the same
  // physical press, since each useInput() call tracks justPressed
  // independently.
  const input = useInput();

  const theta = useRef(0);
  const phi = useRef(0);
  const radius = useRef(PLAYER_RADIUS);
  const targetRadius = useRef(PLAYER_RADIUS);
  const target = useRef(new THREE.Vector3());
  const sensitivity = useRef(new THREE.Vector2(0.3, 0.24));
  const zoomIndex = useRef(0);

  const prevControllable = useRef<string | null>(null);

  // TEMP DEBUG (Claude): pointer lock never actually engages in the
  // automated browser pane used to test this (verified: document.
  // pointerLockElement stays null even after a trusted-looking click), so
  // there's no way to steer the camera by mouse while testing live --
  // theta/phi just sit at whatever they were left at. Exposing direct
  // setters here lets a test script aim the camera at/away from a point
  // before walking, to see a proper forward-facing view while moving
  // instead of whatever fixed angle the camera happened to start at.
  // Dev-only, no-op in production builds.
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as any).__camera = {
        get theta() { return theta.current; },
        get phi() { return phi.current; },
        setTheta: (deg: number) => { theta.current = deg; },
        setPhi: (deg: number) => { phi.current = THREE.MathUtils.clamp(deg, -85, 85); },
        // Point the camera so "forward" (W) walks from (fromX,fromZ)
        // toward (toX,toZ).
        lookTowards: (fromX: number, fromZ: number, toX: number, toZ: number) => {
          const dx = toX - fromX;
          const dz = toZ - fromZ;
          const len = Math.hypot(dx, dz) || 1;
          theta.current = (Math.atan2(-dx / len, -dz / len) * 180) / Math.PI;
        },
      };
    }
  }, []);

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

  useFrame((_state, delta) => {
    // Pause toggle (Start / Escape) and zoom-preset cycle (Select / C) --
    // both global, one-shot actions, handled here for the reason in the
    // comment above `input = useInput()`.
    if (input.consumeJustPressed('pause')) {
      togglePause();
    }
    if (input.consumeJustPressed('camera')) {
      zoomIndex.current = (zoomIndex.current + 1) % ZOOM_LEVELS.length;
      targetRadius.current = ZOOM_LEVELS[zoomIndex.current];
    }

    // Right-stick look (see CAMERA_STICK_* comment above) -- runs
    // regardless of what's currently controlled, same as mouse-look, so you
    // can still look around a vehicle you're riding in.
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (let i = 0; i < pads.length; i++) {
      if (pads[i]) { pad = pads[i] as Gamepad; break; }
    }
    if (pad) {
      const rx = pad.axes[2] ?? 0;
      const ry = pad.axes[3] ?? 0;
      if (Math.abs(rx) > CAMERA_STICK_DEADZONE) {
        theta.current -= rx * CAMERA_STICK_YAW_SPEED * delta;
        theta.current %= 360;
      }
      if (Math.abs(ry) > CAMERA_STICK_DEADZONE) {
        phi.current = THREE.MathUtils.clamp(
          phi.current + ry * CAMERA_STICK_PITCH_SPEED * delta,
          -85,
          85
        );
      }
    }

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
