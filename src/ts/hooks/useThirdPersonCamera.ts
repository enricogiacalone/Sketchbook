import { useRef, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { useInput } from './useInput';
import { droneMouseDelta, droneOrientation, droneShake } from '../lib/droneFlight';

// Ports the original's CameraOperator.ts "normal" (non-free-fly) orbit mode:
// spherical coordinates in degrees around a target, phi clamped to [-85, 85],
// radius eased toward a target radius, and NO lag on the target position
// itself -- the original hard-sets `target` from the followed entity every
// frame, there's no smoothing on it (only `radius` is lerped, same as here).
const PLAYER_RADIUS = 1.6;
const VEHICLE_RADIUS = 3;
// "siamo io che controllo un combat soldier" -- the 1v1 duel's player-
// controlled fighter (see PlayerCombatSoldier.tsx/DuelArena.tsx) is an
// on-foot human character, same silhouette/height as 'player', so it gets
// player-like framing too rather than the wider vehicle-style radius/Y
// offset below -- see isFootController's use further down.
const MIN_RADIUS = 1;
const MAX_RADIUS = 20;
const VEHICLE_TARGET_Y_OFFSET = 0.5;
// "sistema la camera dietro il player comandato che guarda verso
// l'avversario con il giusto zoom all'inizio del combattimento.. per ora
// quando comincio vedo le gambe del player comandato" -- root cause,
// found by reading the frame loop below: a foot controller's own orbit
// `target` was left at the character's literal ROOT position (feet
// height, ~0.15m off the ground here -- no Y offset at all, unlike
// vehicles' own VEHICLE_TARGET_Y_OFFSET just above) AND theta/phi both
// start at their module-level default of 0 with zero link to the
// character's own starting rotation.y (DuelArena.tsx already spawns the
// two fighters facing each other, via facingToward -- the MODEL turns to
// face the opponent correctly, the camera orbit just never follows). At
// theta=0/phi=0 the camera ends up at the exact same height as the
// character's feet, PLAYER_RADIUS meters directly behind wherever
// theta=0 happens to point in world space -- which has nothing to do
// with which way the fighter is actually facing -- hence "vedo le
// gambe" (a ground-level, off-angle close-up of the legs) the instant a
// duel starts. Fixed below in two places: this Y offset (elevates the
// orbit target to roughly chest height, same "chest/eye height above a
// foot-controller's ground-level root" convention DuelArena.tsx's own
// AIM_HEIGHT_OFFSET=1.5 already uses for the aim reticle), and the
// combatSoldier-specific theta/phi/radius snap in the frame loop below.
const FOOT_TARGET_Y_OFFSET = 1.3;
// Entering the duel specifically gets its own slightly wider starting
// radius than the base PLAYER_RADIUS (1.6) -- close enough to read as
// combat, but with enough room in frame to see the opponent too (spawn
// separation is DUEL_SEPARATION=4 in DuelArena.tsx), not just this
// fighter's own back filling the screen -- and a gentle default downward
// tilt (over-the-shoulder, not a flat eye-level stare).
const DUEL_START_RADIUS = 2.6;
const DUEL_START_PHI = 10; // degrees

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

// Chase-cam offset while piloting the drone (see the big branch in the
// frame loop below) -- behind and slightly above, in the DRONE'S OWN
// local frame (so it swings around and banks WITH the drone through a
// turn, unlike the normal player/vehicle orbit cam's fixed world-up
// spherical coordinates, which can't represent roll at all).
const DRONE_CAM_BACK = 6;
const DRONE_CAM_UP = 2;
const _droneCamOffset = new THREE.Vector3();
const _droneCamLookQuat = new THREE.Quaternion();
// The drone's own local +Z is "forward" (matches the thrust/offset math
// just above, and Player.tsx's bullet-direction convention -- at yaw 0,
// Math.sin/cos(yaw) gives (0,0,1)) -- but a three.js Camera looks down
// its OWN local -Z by convention. Setting camera.quaternion straight to
// droneOrientation would point the camera the wrong way down the track
// (verified live: the drone was never in frame, camera looked dead away
// from it) -- fixed by post-rotating 180 deg around Y so the camera's
// own -Z lines up with the drone's +Z instead of opposing it.
const _droneForwardFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const _droneCamTargetQuat = new THREE.Quaternion();
// "camera shake" for the drone's gun (droneWorld: x.camera.shake.start(5)
// while firing) -- a small random jitter added to the chase-cam position
// on top of its normal offset, decayed back to 0 every frame it isn't
// being topped up. See lib/droneFlight.ts's droneShake for the producer
// side (Player.tsx bumps it on every shot).
const _droneShakeOffset = new THREE.Vector3();
const DRONE_SHAKE_DECAY = 0.85; // per-frame-at-60fps retention, same "settle then hold" style as Player.tsx's own DRONE_DAMPING

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
        // TEMP DEBUG (Claude): live camera position/quaternion readout for
        // automated-browser testing (verifying the drone chase-cam
        // distance/orientation without a real screenshot-only guess).
        get camPos() { return camera.position.toArray(); },
        get camQuat() { return camera.quaternion.toArray(); },
        get target() { return target.current.toArray(); },
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
      if (document.pointerLockElement !== gl.domElement) return;
      // "faithful" mode (droneWorld) -- the mouse pilots the drone itself
      // while flying, not the camera orbit; Player.tsx's own drone-flight
      // update drains this every frame (see lib/droneFlight.ts).
      if (useStore.getState().isDrone) {
        droneMouseDelta.x += e.movementX;
        droneMouseDelta.y += e.movementY;
        return;
      }
      theta.current -= e.movementX * (sensitivity.current.x / 2);
      theta.current %= 360;
      phi.current += e.movementY * (sensitivity.current.y / 2);
      phi.current = THREE.MathUtils.clamp(phi.current, -85, 85);
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
    // "aggiungi la possibilita' di attivare la vista ortogonale" --
    // quando il debug ortho cam e' attivo (DebugOrthoCamera.tsx, che
    // diventa lui stesso state.camera via makeDefault) questo hook
    // smette del tutto di muoverlo -- altrimenti i due si contenderebbero
    // la stessa camera ogni frame (questo hook la insegue in terza
    // persona, l'altro la vuole ferma e ortogonale sul personaggio), e
    // vincerebbe uno a caso in base all'ordine di useFrame.
    if (useStore.getState().debugOrthoCamera) return;
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

    // Both 'player' and 'combatSoldier' are on-foot human characters --
    // only vehicles ('car'/'airplane'/'helicopter'/'drone') get the wider
    // vehicle-style framing below.
    const isFootController = currentControllable === 'player' || currentControllable === 'combatSoldier';
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
      const snapped = isFootController ? PLAYER_RADIUS : VEHICLE_RADIUS;
      targetRadius.current = snapped;
      radius.current = snapped;
      // "la camera dietro il player comandato che guarda verso
      // l'avversario ... all'inizio del combattimento" -- entering the
      // duel specifically (free-roam 'player' keeps whatever look
      // direction the person already had, unaffected) snaps theta to the
      // SAME angle as the fighter's own rotation.y -- see
      // FOOT_TARGET_Y_OFFSET's big comment above for why theta and
      // rotation.y are directly interchangeable (both use the identical
      // atan2(dx,dz)+PI convention) -- so the very first frame already
      // reads as "behind the player, looking at the opponent" instead of
      // a leftover angle from theta's module-level default (0) or
      // whatever the camera was last left at.
      if (currentControllable === 'combatSoldier') {
        theta.current = THREE.MathUtils.radToDeg(targetObj.rotation.y);
        phi.current = DUEL_START_PHI;
        targetRadius.current = DUEL_START_RADIUS;
        radius.current = DUEL_START_RADIUS;
      }
      prevControllable.current = currentControllable;
    }

    targetObj.getWorldPosition(target.current);
    // "vedo le gambe" -- see FOOT_TARGET_Y_OFFSET's own comment above:
    // orbiting around the literal root position (feet height) put the
    // camera at ankle height too whenever phi was ~0. Foot controllers
    // now get their own (smaller) chest-height offset here, same as
    // vehicles already got theirs.
    target.current.y += isFootController ? FOOT_TARGET_Y_OFFSET : VEHICLE_TARGET_Y_OFFSET;

    // "faithful" drone flight (droneWorld): the mouse pilots the drone's
    // own orientation (see handleMouseMove above / Player.tsx's per-frame
    // integration), so this camera can't ALSO drive independent theta/phi
    // orbit off the same mouse deltas -- instead it's a rigid chase-cam
    // offset in the drone's OWN local frame (droneOrientation, written by
    // Player.tsx every frame), which is what lets the camera bank/pitch
    // WITH the drone through a turn -- the normal spherical theta/phi math
    // below is anchored to world-up and has no way to represent that.
    if (useStore.getState().isDrone) {
      _droneCamOffset.set(0, DRONE_CAM_UP, -DRONE_CAM_BACK).applyQuaternion(droneOrientation);
      camera.position.copy(target.current).add(_droneCamOffset);
      // Gun-fire shake: a fresh random jitter each frame, scaled by the
      // current shake magnitude (topped up by Player.tsx on every shot,
      // decayed here every frame regardless of whether a shot landed this
      // particular frame so it fades out smoothly after the trigger is
      // released instead of cutting off instantly).
      if (droneShake.current > 0.0001) {
        _droneShakeOffset.set(
          (Math.random() - 0.5) * droneShake.current,
          (Math.random() - 0.5) * droneShake.current,
          (Math.random() - 0.5) * droneShake.current
        );
        camera.position.add(_droneShakeOffset);
      }
      droneShake.current *= Math.pow(DRONE_SHAKE_DECAY, delta * 60);
      // Slerp rather than a hard copy so a sudden hard bank doesn't snap
      // the view instantly -- same spirit as radius's own lerp just below.
      // _droneForwardFlip corrects the camera-vs-drone forward-axis
      // mismatch explained above the constant's declaration.
      _droneCamTargetQuat.copy(droneOrientation).multiply(_droneForwardFlip);
      _droneCamLookQuat.copy(camera.quaternion).slerp(_droneCamTargetQuat, 0.25);
      camera.quaternion.copy(_droneCamLookQuat);
      return;
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
