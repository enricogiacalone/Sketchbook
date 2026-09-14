import * as THREE from 'three';

// "il personaggio si trasforma nel drone ... ha le stesse funzioni di volo"
// (github.com/blaze33/droneWorld) -- a small, plain (non-React) bridge
// between Player.tsx (producer: drives the drone's own orientation and
// drains the raw mouse deltas every frame while store.isDrone) and
// useThirdPersonCamera.ts (consumer: chase-cams off this orientation
// instead of mouse-driven theta/phi while flying, see there). Neither hook
// has any other shared per-instance handle to pass a ref through (they're
// mounted independently, once each, by different parents), so this is the
// same "module-level mutable singleton for cross-cutting per-frame data"
// pattern already used by debug/simDebug.ts and Car.tsx's scratch
// vectors -- deliberately NOT in the Zustand store, since that re-renders
// subscribers on every set() and this changes every single mouse-move
// event and every physics frame.

// Accumulated raw pointer-lock mouse deltas since the last drain -- pushed
// to by useThirdPersonCamera.ts's own mousemove listener whenever
// store.isDrone is true (instead of updating its usual theta/phi camera-
// orbit angles), drained once per frame by Player.tsx's drone-flight
// update (see there for the actual pitch/yaw/roll integration, ported
// from droneWorld's src/modules/FlyControls.js).
export const droneMouseDelta = { x: 0, y: 0 };

// The drone's current world orientation, written once per frame by
// Player.tsx (copied from its own droneQuaternion ref, which is what
// actually drives the local->world velocity transform and the rendered
// drone mesh) and read by useThirdPersonCamera.ts to bank/pitch the chase
// camera along with it. Starts identity; only meaningful while
// store.isDrone is true.
export const droneOrientation = new THREE.Quaternion();

// "stessa ... sparatoria" (droneWorld's own gun uses
// x.camera.shake.start(5)/.stop() -- a pubsub-driven camera shake --
// while the trigger is held). This project's chase-cam has no such
// event bus, so it's the same module-singleton bridge as
// droneOrientation just above: Player.tsx bumps this up by a fixed
// amount on every gun shot (see the drone combat block), and
// useThirdPersonCamera.ts's drone camera branch reads+decays it every
// frame to jitter the camera position. A plain number in a mutable
// object (not a ref, not store state) since neither side is a React
// component that could hold a ref for the other to see.
export const droneShake = { current: 0 };

// TEMP DEBUG (Claude): browser-automation testing can't get a real
// pointer lock (verified live -- document.pointerLockElement stays null
// even after a trusted-looking synthetic click), so there's no way to
// feed mouse deltas into droneMouseDelta the normal way while testing.
// Exposing both module singletons directly lets a test script push
// deltas / read the live orientation in one line instead. Dev-only,
// same convention as window.__sim / window.__camera elsewhere.
if (import.meta.env.DEV) {
  (window as any).__droneFlight = { droneMouseDelta, droneOrientation, droneShake };
}
