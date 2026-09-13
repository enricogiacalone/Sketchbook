// Generic console/testing API for driving and inspecting vehicle physics --
// built because testing "l'aereo non parte"-style bugs kept meaning
// hand-writing a fresh KeyboardEvent-dispatch + raw RigidBody-poking +
// setTimeout-sampling snippet from scratch in the browser console every
// single time, with each vehicle exposing its own ad hoc, differently-
// shaped window.__xDebug globals (or none at all, e.g. the helicopter had
// none). window.__sim centralizes all of that behind one small, consistent
// API so a test session (human or Claude driving the browser) can set up a
// clean scenario, read back everything about the sim in one call, and hold
// inputs/replay a sample series in one line instead of many.
//
// Only ever installed in dev builds (import.meta.env.DEV) -- absent/no-op
// in production, same convention as window.__gameStore/__r3fState/
// __playerFrameCount elsewhere in this codebase.
//
// See also ScenariosGUI.tsx's "Scenari" lil-gui panel, which wraps
// startTest()/endTest()/startRace() behind clickable buttons for manual
// (non-console) testing, and Scene.tsx's `testScene` gate, which is what
// actually strips the city/traffic/collectibles/etc. out of the world
// while a test is active.

import * as THREE from 'three';
import { useStore } from '../store';
import { RUNWAY_CENTER, HELIPORT_CENTER } from '../components/Environment/Airport';

export type VehicleKind = 'airplane' | 'helicopter' | 'car';

export interface VehicleTelemetry {
  id: string;
  kind: VehicleKind;
  active: boolean;
  paused: boolean;
  enginePower: number;
  input: Record<string, unknown>;
  pos: [number, number, number];
  quat: [number, number, number, number];
  // Euler angles in degrees, YXZ order: [yaw, pitch, roll].
  eulerDeg: [number, number, number];
  vel: [number, number, number];
  speed: number;
  localSpeed: number | null; // forward-axis component of vel, if provided
  angvel: [number, number, number];
  sleeping: boolean;
  friction: number | null;
  frictionCombineRule: number | null;
  numContacts: number;
  grounded: boolean;
  extra?: Record<string, unknown>;
}

// Keyed by each vehicle's own unique `id` (e.g. 'test-car-1', 'race-cop-2',
// 'airplane-1'), NOT by kind (Claude, fixing a real bug -- see below).
// registerVehicle() used to key both maps by `kind` alone
// (bodies[kind]/latest[kind]): harmless while at most one car ever existed
// at once (a clean single-vehicle test scenario), but the normal world
// mounts 8 Cars simultaneously (6 parked + 2 patrol), and every single one
// calls registerVehicle('car', ...) every frame -- each call silently
// clobbered the previous one's slot, so state().vehicles.car ended up
// showing whichever car's useFrame happened to run LAST that particular
// frame, jumping between up to 8 unrelated cars' positions/velocities from
// one poll to the next. Caught live while re-verifying the terrain
// boundary-wall fix: a page reload (Vite HMR) dropped the test back into
// the normal (non-clean) world mid-poll, and the "same car"'s telemetry
// suddenly teleported ~400 units and back across consecutive 0.5s samples
// -- impossible for a single body, and the tell that this was an ID
// collision, not a physics bug. Fixed by keying on the real per-vehicle
// `id` instead; `kind` is now just a field on the telemetry for filtering/
// grouping. This also happens to be exactly what a multi-car scenario
// (see startRace() below, player + 3 AI police racing at once) requires:
// each car's telemetry needs to stay independently readable.
const latest: Record<string, VehicleTelemetry> = {};
const bodies: Record<string, any> = {};
const heldKeys = new Set<string>();

function dispatchKey(kind: 'keydown' | 'keyup', code: string) {
  window.dispatchEvent(new KeyboardEvent(kind, { code, key: code, bubbles: true }));
}

const VEHICLE_IDS: Record<VehicleKind, string> = {
  airplane: 'airplane-1',
  helicopter: 'heli-1',
  // 'test-car-1' -- the dedicated, clean-scenario-only car Scene.tsx mounts
  // for testScene==='car' (see there) -- NOT 'car-1', one of the 6 ordinary
  // parked city cars, which don't exist at all in a clean test scenario.
  car: 'test-car-1',
};

// Race scenario car ids (Scene.tsx mounts exactly these four when
// testScene==='race' -- see there and RaceTrack.tsx).
export const RACE_PLAYER_ID = 'race-player';
export const RACE_COP_IDS: [string, string, string] = ['race-cop-1', 'race-cop-2', 'race-cop-3'];

// Clean, empty-pad spawn points for startTest() -- a couple of meters above
// the pad so the vehicle free-falls a short, controlled distance onto it.
// Pass an explicit opts.pos (e.g. exactly on the ground, zero fall) to
// reproduce a true "cold start already resting" scenario instead. The car's
// entry matches Scene.tsx's own test-car-1 spawn point exactly (a real
// raycast-suspension vehicle needs the same known-safe drop height city
// cars use -- see Scene.tsx's comment -- not an arbitrary "a bit above the
// pad" like the two bare-box air vehicles tolerate).
const TEST_SPAWN: Record<'airplane' | 'helicopter' | 'car', [number, number, number]> = {
  airplane: [RUNWAY_CENTER[0], 3, RUNWAY_CENTER[1]],
  helicopter: [HELIPORT_CENTER[0], 6, HELIPORT_CENTER[1]],
  car: [10, 1.2, 0],
};

export const simDebug = {
  // Called every frame by each vehicle's own useFrame with its live
  // RigidBody ref and a freshly-computed telemetry object (id already set
  // inside it), so window.__sim.state() always reads this frame's real
  // values instead of a stale snapshot -- and, since Claude, keyed by that
  // telemetry's own `id` rather than `kind`, so N simultaneous cars never
  // collide with each other (see the big comment on `latest` above).
  registerVehicle(kind: VehicleKind, body: any, telemetry: Omit<VehicleTelemetry, 'kind'>) {
    bodies[telemetry.id] = body;
    latest[telemetry.id] = { ...telemetry, kind };
  },
  unregisterVehicle(id: string) {
    delete bodies[id];
    delete latest[id];
  },

  state() {
    const s = useStore.getState();
    // Flat, id-keyed map -- e.g. state().vehicles['race-cop-2'] -- so every
    // simultaneously-mounted car (race scenario, or even the normal city
    // world) stays independently readable. `vehicle(kind)` below remains
    // the convenient single-vehicle accessor for the airplane/helicopter/
    // solo-car-test scenarios, where exactly one of that kind exists.
    const vehicles: Record<string, VehicleTelemetry> = { ...latest };
    return {
      t: +(performance.now() / 1000).toFixed(3),
      paused: s.isPaused,
      testScene: s.testScene,
      currentControllable: s.currentControllable,
      controlledEntityId: s.controlledEntityId,
      controlledSeatType: s.controlledSeatType,
      playerPos: s.playerPos,
      vehicles,
    };
  },

  // Convenience accessor for the single-vehicle scenarios (airplane/
  // helicopter/solo car test), where a `kind` unambiguously means one
  // specific known id (VEHICLE_IDS[kind]). For the race scenario, or
  // anywhere more than one car of the same kind can be mounted at once,
  // read state().vehicles[<id>] directly instead.
  vehicle(kind: VehicleKind) {
    return latest[VEHICLE_IDS[kind]] ?? null;
  },

  // Forces exactly this set of keys (by KeyboardEvent.code, e.g.
  // 'ShiftLeft'/'KeyW') held down, releasing any previously-held synthetic
  // key not in the list -- e.g. setKeys(['ShiftLeft']) holds throttle
  // indefinitely regardless of real OS key-repeat timing, setKeys([]) (or
  // clearKeys()) releases everything.
  setKeys(codes: string[]) {
    const want = new Set(codes);
    for (const code of Array.from(heldKeys)) {
      if (!want.has(code)) {
        dispatchKey('keyup', code);
        heldKeys.delete(code);
      }
    }
    for (const code of Array.from(want)) {
      if (!heldKeys.has(code)) {
        dispatchKey('keydown', code);
        heldKeys.add(code);
      }
    }
  },
  clearKeys() {
    this.setKeys([]);
  },

  possess(kind: VehicleKind, id?: string, seatType: 'driver' | 'passenger' = 'driver', seatName = 'seat_1') {
    useStore.getState().setCurrentControllable(kind, id ?? VEHICLE_IDS[kind], seatType, seatName);
  },

  // Resets a registered vehicle's RigidBody to a known, reproducible pose --
  // essential for testing, since re-running the same input sequence from
  // whatever position/velocity the LAST test happened to end at is not a
  // controlled experiment. Defaults to zero linear/angular velocity and
  // level (yaw-only) rotation. Also force-wakes the body: a resting body
  // Rapier put to sleep will not respond to setLinvel-driven thrust at all
  // until woken. Takes the vehicle's own `id` now (not `kind` -- see the
  // comment on `latest` above), e.g. resetBody('test-car-1', ...) or
  // resetBody('race-cop-2', ...).
  resetBody(
    id: string,
    opts: { pos?: [number, number, number]; rotYDeg?: number; linvel?: [number, number, number]; angvel?: [number, number, number] } = {}
  ) {
    const body = bodies[id];
    if (!body) return false;
    const { pos, rotYDeg = 0, linvel = [0, 0, 0], angvel = [0, 0, 0] } = opts;
    if (pos) body.setTranslation({ x: pos[0], y: pos[1], z: pos[2] }, true);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, THREE.MathUtils.degToRad(rotYDeg), 0, 'YXZ'));
    body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    body.setLinvel({ x: linvel[0], y: linvel[1], z: linvel[2] }, true);
    body.setAngvel({ x: angvel[0], y: angvel[1], z: angvel[2] }, true);
    if (typeof body.wakeUp === 'function') body.wakeUp();
    return true;
  },

  // One call to set up a fully isolated flight/drive test: switches the
  // world to that vehicle's clean scenario (no city/cars/collectibles --
  // see Scene.tsx), gives the player control of it directly (skipping the
  // walk-up-and-press-F entry animation, which is an input/UX concern
  // separate from flight physics), resets its body to a known pose, clears
  // any held synthetic keys from a previous test, and disables the
  // tab-visibility auto-pause (this is what a real player never has
  // to think about, but a browser-automation test session switching
  // desktop Spaces mid-test would otherwise trip every time).
  startTest(kind: 'airplane' | 'helicopter' | 'car', opts: { pos?: [number, number, number]; rotYDeg?: number } = {}) {
    useStore.getState().setTestScene(kind);
    this.possess(kind);
    this.clearKeys();
    (window as any).__disableAutoPause = true;
    // Airplane/helicopter are ALWAYS mounted (see Scene.tsx) -- switching
    // scenari just repositions the same standing body, so resetBody can run
    // immediately, synchronously, right here. The test car is different:
    // Scene.tsx only mounts <Car id="test-car-1"> once testScene==='car'
    // actually takes effect on the next render, so its RigidBody doesn't
    // exist yet at this exact point in the call -- resetBody would just
    // no-op (bodies['test-car-1'] not registered yet). It doesn't need to
    // anyway: a freshly-mounted car is already born at TEST_SPAWN.car via
    // its own JSX `position` prop. Call resetBody('test-car-1', ...)
    // yourself once it's up (state().vehicles['test-car-1'] is non-null)
    // to repeat a test without a remount.
    if (kind !== 'car') {
      const pos = opts.pos ?? TEST_SPAWN[kind];
      this.resetBody(VEHICLE_IDS[kind], { pos, rotYDeg: opts.rotYDeg ?? 0 });
    }
    return this.state();
  },

  // "una gara contro 3 poliziotti in un percorso con curve e dossi" -- sets
  // up the dedicated race scenario (testScene==='race', see Scene.tsx /
  // RaceTrack.tsx): a closed-loop track with curves and speed bumps, the
  // player's own car plus 3 AI police cars all lined up on a starting grid,
  // the 3 cops already driving the track (patrolRoute AI, same system the
  // city's patrol cars use) the instant they're mounted. Like startTest,
  // possessing + resetBody for the player's car happens once it actually
  // exists (see the comment on startTest above) -- call
  // resetBody('race-player', ...) yourself if you need to restart the race
  // from the grid without a full remount.
  startRace() {
    useStore.getState().setTestScene('race');
    this.possess('car', RACE_PLAYER_ID);
    this.clearKeys();
    (window as any).__disableAutoPause = true;
    return this.state();
  },

  endTest() {
    useStore.getState().setTestScene('none');
    this.clearKeys();
    useStore.getState().setCurrentControllable('player');
  },

  // Samples state() every intervalMs for durationMs and resolves with the
  // full time series in one awaited call, replacing a hand-written
  // for-loop-with-setTimeout in the console every time.
  async sample(durationMs: number, intervalMs = 250) {
    const samples: any[] = [];
    const steps = Math.max(1, Math.round(durationMs / intervalMs));
    for (let i = 0; i < steps; i++) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, intervalMs));
      samples.push(this.state());
    }
    return samples;
  },
};

if (import.meta.env.DEV) {
  (window as any).__sim = simDebug;
}
