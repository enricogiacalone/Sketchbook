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

// "mappa i comandi del joystick anche quando prendo il controllo del drone":
// levette e grilletti analogici del pad, scritti da useInput.ts a ogni frame
// (gia' con la zona morta) e letti da Drone.tsx mentre si pilota. Levetta
// sinistra: avanti/indietro e imbardata; destra: la cloche (come il mouse,
// ma torna al centro lasciandola); R2/L2 su e giu' (0..1); L1/R1 rollio.
export const dronePad = { lx: 0, ly: 0, rx: 0, ry: 0, up: 0, down: 0, rollL: false, rollR: false };

// TEMP DEBUG (Claude): browser-automation testing can't get a real
// pointer lock (verified live -- document.pointerLockElement stays null
// even after a trusted-looking synthetic click), so there's no way to
// feed mouse deltas into droneMouseDelta the normal way while testing.
// Exposing both module singletons directly lets a test script push
// deltas / read the live orientation in one line instead. Dev-only,
// same convention as window.__sim / window.__camera elsewhere.
// "quando vola deve comportarsi come in droneWorld": in droneWorld chi
// vola e' la CAMERA (FlyControls muove la camera, il drone e' disegnato
// 20 unita' davanti e 8 sotto di lei). Drone.tsx integra quel "telaio del
// pilota" e ne scrive qui la posa; useThirdPersonCamera.ts la copia tale e
// quale sulla camera mentre si pilota (piu' lo scuotimento della
// mitragliatrice).
export const droneCamPose = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
};

// Stato dell'interfaccia di volo (DroneHUD.tsx, copia di src/hud di
// droneWorld): scritto da Drone.tsx a ogni frame, letto dal HUD con il suo
// requestAnimationFrame -- niente React state a 60 Hz.
export interface DroneHudTarget {
  id: string;
  name: string;
  x: number; // posizione del marcatore (px, gia' limitata alla zona)
  y: number;
  scale: number;
  behind: boolean;
  inSight: boolean;
  distance: number; // m
  inRange: boolean; // entro la gittata della mitragliatrice
  life: number; // 0..1
  arrowDeg: number;
  arrowOpacity: number;
  // anticipo per la mitragliatrice (segmento dal bersaglio al punto dove
  // sara'), in px dal marcatore
  gunHud: boolean;
  hudX: number;
  hudY: number;
  leadDX: number;
  leadDY: number;
}
export const droneHud = {
  active: false,
  width: 0,
  height: 0,
  zone: 400, // raggio del "limitatore" (px)
  focal: 150, // raggio del cerchio focale (px)
  pointerX: 0, // puntatore virtuale (px dal centro)
  pointerY: 0,
  horizonY: 0, // px
  horizonDeg: 0,
  altitude: NaN, // m
  speed: 0, // m/s
  gunHeat: 0, // 0..1
  lockLevel: 0, // 0..1
  lock: false,
  gunTargetId: null as string | null,
  targets: [] as DroneHudTarget[],
};

if (import.meta.env.DEV) {
  (window as any).__droneFlight = { droneMouseDelta, droneOrientation, droneShake, droneCamPose, droneHud };
}
