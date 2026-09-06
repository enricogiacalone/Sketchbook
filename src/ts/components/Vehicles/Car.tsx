import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, CuboidCollider, RapierRigidBody, useRapier, useBeforePhysicsStep } from '@react-three/rapier';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useInput } from '../../hooks/useInput';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { CollisionGroups, groupsExcluding } from '../../enums/CollisionGroups';
import { getTerrainHeight } from '../Environment/Terrain';
import { getRoadOffset } from '../Environment/Road';

interface CarProps {
  position?: [number, number, number];
  id?: string;
}

// ---------------------------------------------------------------------------
// Faithful port of the original's SpringSimulator/SimulatorBase
// (src/ts/physics/spring_simulation), used there to smooth steering input.
// It advances the underlying spring in fixed 1/60s ticks, carrying over any
// leftover time from one call to the next (the same accumulator pattern the
// physics engine itself uses for its own stepping) instead of scaling a
// single update by the render `delta`. That's what makes it genuinely
// framerate independent: a slow frame just runs more ticks in one go, a fast
// one may run zero, but the number of ticks per *second* of real time is
// always the same, so the steering doesn't feel twitchier or floatier on a
// high-refresh display. Matches the original's `new SpringSimulator(60, 10,
// 0.6)` (fps, mass, damping) used for Car's steeringSimulator.
// ---------------------------------------------------------------------------
class FixedTickSpring {
  public position = 0;
  public velocity = 0;
  public target = 0;
  private offset = 0;
  private readonly tickTime: number;

  constructor(private mass: number, private damping: number, fps: number = 60) {
    this.tickTime = 1 / fps;
  }

  public simulate(timeStep: number): void {
    const total = this.offset + timeStep;
    const ticks = Math.floor(total / this.tickTime);
    this.offset = total - ticks * this.tickTime;
    for (let i = 0; i < ticks; i++) {
      const acceleration = (this.target - this.position) / this.mass;
      this.velocity += acceleration;
      this.velocity *= this.damping;
      this.position += this.velocity;
    }
  }
}

// Handling setup, straight from the original's Car constructor
// (`super(gltf, { radius: 0.25, suspensionStiffness: 20, ... })`).
const WHEEL_RADIUS = 0.25;
const SUSPENSION_STIFFNESS = 20;
const SUSPENSION_REST_LENGTH = 0.35;
const MAX_SUSPENSION_TRAVEL = 1;
const FRICTION_SLIP = 1.0;
const DAMPING_RELAXATION = 2;
const DAMPING_COMPRESSION = 2;
// The original's rollInfluence (0.4, a Bullet/cannon-only knob that damps
// how much of a tire's side-friction torque gets transferred to the chassis,
// specifically to fight flip-overs) has no equivalent on Rapier's
// DynamicRayCastVehicleController -- it exposes per-wheel friction slip and
// side-friction-stiffness, but nothing that damps roll torque transfer
// directly. Left undocumented-but-omitted rather than approximated; if real
// suspension + a low-enough center of mass isn't enough to keep cars upright
// through hard turns/impacts once this is live-tested, revisit here.
const AXLE_LOCAL: [number, number, number] = [-1, 0, 0];
const DIRECTION_LOCAL: [number, number, number] = [0, -1, 0];
// Module-level, reused for every car's per-wheel visual-transform math (see
// the wheel sync loop in useFrame below) -- both are unit axes in CHASSIS
// LOCAL space, matching AXLE_LOCAL/DIRECTION_LOCAL above exactly, so wheel
// meshes (children of the chassis RigidBody) only ever need a LOCAL
// rotation/position; three.js composes that with the chassis's own world
// transform automatically via the scene graph.
const WHEEL_UP_AXIS = new THREE.Vector3(-DIRECTION_LOCAL[0], -DIRECTION_LOCAL[1], -DIRECTION_LOCAL[2]).normalize();
const WHEEL_AXLE_AXIS = new THREE.Vector3(...AXLE_LOCAL).normalize();
const WHEEL_DIRECTION_AXIS = new THREE.Vector3(...DIRECTION_LOCAL).normalize();

// Engine/transmission/steering tuning, straight from the original's Car.ts
// -- and, unlike the cannon-worker era, this is no longer just "the closest
// approximation we can test": Rapier's DynamicRayCastVehicleController is,
// like cannon-es's own RaycastVehicle, a straight port of Bullet's
// btRaycastVehicle, so these Newton-scale force/brake values (tuned against
// the ORIGINAL, non-React Sketchbook running a real, working cannon-es
// RaycastVehicle -- see git history) should carry over directly. Still,
// this hasn't been live-tested yet post-migration -- see the dev-only
// __carDebug hook below for tuning once it has.
const ENGINE_FORCE = 700;
const MAX_GEARS = 5;
const TIME_TO_SHIFT = 0.2;
const GEARS_MAX_SPEEDS: Record<string, number> = { R: -4, '0': 0, '1': 5, '2': 9, '3': 13, '4': 17, '5': 22 };
const BRAKE_FORCE = 500000;
const MAX_STEER_VAL = 0.8;

// -- Flip recovery tuning. A car counts as "flipped" once its own local up
// axis has tilted more than ~60 degrees from world up (dot product below
// 0.5) -- on its side or roof, not just leaned into a hard turn -- and
// "stationary" once both its linear and angular speed drop under a small
// threshold (still settling from the crash doesn't count). Only once BOTH
// hold for FLIP_RESPAWN_DELAY seconds straight does it get set back
// upright -- see the useBeforePhysicsStep flip-recovery block below.
const FLIP_UP_DOT_THRESHOLD = 0.5;
const FLIP_STATIONARY_LINVEL_SQ = 0.15 * 0.15;
const FLIP_STATIONARY_ANGVEL_SQ = 0.15 * 0.15;
const FLIP_RESPAWN_DELAY = 2;

// Wheel layout read from car.glb's node "extras" (steering/drive flags baked
// into the model, surfaced by three's GLTFLoader as userData) -- the exact
// same data the original's readVehicleData()/Wheel.ts read off these nodes.
// Traversal order: wheel_fl (steer, fwd), Cylinder.001 (rwd), wheel_fr
// (steer, fwd), wheel (rwd) -- verified against the glb's node list.
interface WheelDef {
  node: THREE.Object3D | null;
  position: [number, number, number];
  steering: boolean;
  rwd: boolean;
}
const FALLBACK_WHEEL: WheelDef = { node: null, position: [0, 0, 0], steering: false, rwd: true };

// Chassis compound shape, built from the two "collision" boxes baked into
// car.glb (Cube.006 = lower body, Cube.002 = cabin) -- read directly from
// the glb's accessor data. These are stored here as FULL dimensions (the
// values car.glb's authoring tool wrote out, doubled from the original
// vanilla Car.ts's CANNON.Box half-extents -- see git history); Rapier's
// CuboidCollider args are half-extents like raw cannon-es, so they're halved
// again at the call site below.
const CHASSIS_SHAPES = [
  { fullDimensions: [1.2233487367630005, 0.4973112344741821, 2.420389175415039] as [number, number, number], position: [0, 0.09126596, 0.03799713] as [number, number, number] },
  { fullDimensions: [1.0837020874023438, 0.5600574016571045, 1.071435809135437] as [number, number, number], position: [0, 0.6199502944946289, -0.2552129924297333] as [number, number, number] },
];

// Module-level scratch objects, reused across every Car instance's useFrame/
// useBeforePhysicsStep calls instead of allocating fresh THREE.Vector3/
// Quaternion objects every frame (safe because R3F/rapier run each
// registered callback to completion, one after another, in the same tick --
// nothing here is read after this component's own callback returns). With
// up to 6 cars on screen, avoiding a pile of allocations/frame/car here is
// what removed the periodic GC-driven stutter in the cannon-worker version.
const _forward = new THREE.Vector3();
const _velVec = new THREE.Vector3();
const _normalizedVel = new THREE.Vector3();
const _cross = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _carPos = new THREE.Vector3();
const _carEuler = new THREE.Euler();
const _chassisQuat = new THREE.Quaternion();
const _steerQuat = new THREE.Quaternion();
const _spinQuat = new THREE.Quaternion();
const _chassisUp = new THREE.Vector3();
const _uprightQuat = new THREE.Quaternion();
const _uprightEuler = new THREE.Euler();

const Car: React.FC<CarProps> = ({ position = [10, 5, 0], id = 'car-1' }) => {
  const { scene } = useGLTF('car.glb');
  const clonedScene = useMemo(() => scene.clone(), [scene]);
  const { world } = useRapier();

  const wheelDefs = useMemo<WheelDef[]>(() => {
    const defs: WheelDef[] = [];
    clonedScene.traverse((child) => {
      const isTireWheel = child.userData?.data === 'wheel';
      // The name heuristic alone (no userData.data==='wheel') catches things
      // like the interior steering-wheel prop -- unrelated to the car's real
      // tires, stays hidden as before. Real tire meshes (isTireWheel) are no
      // longer hidden: they're now driven live by the vehicle controller
      // below instead of being invisible stand-ins, which is the whole
      // point of this migration (see the user-facing "dove sono le ruote"
      // discussion in git history / chat).
      if (!isTireWheel && child.name.toLowerCase().includes('wheel')) {
        child.visible = false;
      }
      // car.glb also bakes in a set of "collision" helper meshes (2 boxes +
      // 12 spheres wrapping the fenders/bumpers) used only for authoring in
      // Blender -- these were never meant to be visible in-game, but nothing
      // was hiding them, so they rendered as real geometry (visible as
      // spheres/boxes floating on the car). Purely visual -- the physics
      // hull below (CHASSIS_SHAPES) is unrelated to this hide.
      if (child.userData?.data === 'collision') {
        child.visible = false;
      }
      if (isTireWheel) {
        child.visible = true;
        defs.push({
          node: child,
          position: [child.position.x, child.position.y, child.position.z],
          steering: child.userData.steering === 'true',
          rwd: child.userData.drive !== 'fwd',
        });
      }
    });
    if (defs.length !== 4) {
      console.warn(`Car ${id}: expected 4 wheel nodes in car.glb, found ${defs.length}. Falling back to a stub wheel (physics only, no visual) for any missing slot.`);
    }
    return defs;
  }, [clonedScene]);

  const input = useInput();
  const { currentControllable, controlledEntityId, isVehicleTransitioning, transitioningEntityId, transitioningDoorName, updateEntity, setPlayerInfo, isPaused } = useStore(
    useShallow((state) => ({
      currentControllable: state.currentControllable,
      controlledEntityId: state.controlledEntityId,
      isVehicleTransitioning: state.isVehicleTransitioning,
      transitioningEntityId: state.transitioningEntityId,
      transitioningDoorName: state.transitioningDoorName,
      updateEntity: state.updateEntity,
      setPlayerInfo: state.setPlayerInfo,
      isPaused: state.isPaused,
    }))
  );

  // -- Doors, mirroring the original's VehicleDoor: whichever door the
  // player is actually walking through swings open for the whole
  // entering/exiting transition and closes the rest of the time (parked or
  // driving). All 4 doors on the glb are tracked (not just the one nearest
  // the driver's entrance) so getting in via a closer door -- e.g. a rear
  // one -- opens THAT door instead of always animating the front one
  // regardless of which side was actually used (see git history / chat:
  // "deve poter salire anche dietro se la portiera e' piu' vicina"; the
  // matching Player.tsx-side change is getVehicleEntrances). Which one is
  // "active" for the current transition comes from the store's
  // transitioningDoorName, set by whichever entrance Player.tsx picked.
  const doorsRef = useRef<Record<string, { node: THREE.Object3D; sign: number }>>({});
  const doorOpenFactors = useRef<Record<string, number>>({});
  const DOOR_ROTATION_SPEED = 5; // rad/sec, matches the original's VehicleDoor.rotationSpeed
  const DOOR_MAX_ANGLE = 1; // radians (~57deg), matches the original's targetRotation of 1

  useEffect(() => {
    const doors: Record<string, { node: THREE.Object3D; sign: number }> = {};
    clonedScene.traverse((child) => {
      if (child.name.toLowerCase().startsWith('door')) {
        doors[child.name] = { node: child, sign: -Math.sign(child.position.x) || 1 };
      }
    });
    doorsRef.current = doors;
  }, [clonedScene]);

  // Chassis -- migrated from @react-three/cannon's useCompoundBody to
  // @react-three/rapier's <RigidBody>/<CuboidCollider>. Built from the car's
  // own collision geometry (CHASSIS_SHAPES) instead of a single guessed box,
  // so it still collides correctly sideways with buildings, curbs, other
  // cars, etc.
  //
  // DOES collide with TrimeshColliders (terrain + road), unlike Player.tsx's
  // sphere -- originally this excluded them on the theory that the wheel
  // raycasts (below) are what should hold the chassis up, and letting the
  // chassis's own coarser hull rest on the ground too would just be two
  // vertical supports fighting each other. Live-testing proved that wrong in
  // a worse way: the vehicle controller's wheel raycasts fire in chassis-
  // LOCAL "down", so the moment a car rolls/flips (a hard turn, a crash),
  // those raycasts point sideways or up instead of at the ground -- with
  // TrimeshColliders excluded, NOTHING was left to catch the chassis, so a
  // flipped car just fell through the terrain forever (see git history /
  // chat: "appena si ribalta cade all'infinito"). Colliding normally with
  // the ground gives the chassis a hard backstop for exactly that case (a
  // flipped/crashed car now rests on its roof/side instead of falling
  // through), at the cost of the chassis's coarse hull also lightly
  // resting on the ground alongside the suspension while upright -- in
  // practice not noticeable since the suspension keeps normal ride height
  // well clear of it.
  const chassisRef = useRef<RapierRigidBody>(null);

  // Real vehicle controller (see useEffect below) -- replaces BOTH
  // useRaycastVehicle (never actually propelled or suspended the chassis in
  // the old cannon-worker-api setup, see git history) and the kinematic
  // driveSpeed/analytic-ground-snap/quaternion-rotateTowards self-righting
  // hack that was built as a workaround for it. This is a REAL raycast
  // vehicle: engine force/brake/steering genuinely act on the chassis via
  // its own suspension physics, and rollover recovery (or lack thereof) is
  // now a real physical consequence of chassis mass/CoM/suspension tuning,
  // not something hand-simulated.
  // Typed via ReturnType rather than importing DynamicRayCastVehicleController
  // directly from @dimforge/rapier3d-compat: @react-three/rapier bundles its
  // own nested copy of that package (a different version than whatever else
  // may be installed at the top level), and world.createVehicleController()
  // below returns THAT copy's type -- importing the type from the top-level
  // package name would silently resolve to a structurally-different (if
  // near-identical) class and fail to typecheck.
  const vehicleController = useRef<ReturnType<typeof world.createVehicleController> | null>(null);

  // Per-wheel chassis-local connection point (top of the suspension strut).
  // The +0.2 Y offset is inherited, unchanged, from the old cannon setup's
  // chassisConnectionPointLocal -- it's how far above the wheel's authored
  // resting position the strut's mount point sits, before suspension travel
  // (SUSPENSION_REST_LENGTH) brings the wheel back down to about the right
  // spot. Computed once and shared between vehicleController.addWheel below
  // and the visual wheel-sync loop in useFrame, so the rendered wheel mesh
  // always matches exactly what the controller is actually simulating.
  const wheelConnectionPoints = useMemo(
    () => [0, 1, 2, 3].map((i) => {
      const def = wheelDefs[i] ?? FALLBACK_WHEEL;
      return new THREE.Vector3(def.position[0], def.position[1] + 0.2, def.position[2]);
    }),
    [wheelDefs]
  );

  useEffect(() => {
    const chassis = chassisRef.current;
    if (!chassis) return;

    const controller = world.createVehicleController(chassis);
    // Matches the original's indexForwardAxis: 2, indexRightAxis: 0,
    // indexUpAxis: 1 (Z-forward, X-right, Y-up). Rapier's controller only
    // exposes up/forward directly (right is implicit); note the setter for
    // forward is genuinely named `setIndexForwardAxis` (not a typo here --
    // see @dimforge/rapier3d-compat's own ray_cast_vehicle_controller.d.ts).
    controller.indexUpAxis = 1;
    controller.setIndexForwardAxis = 2;

    for (let i = 0; i < 4; i++) {
      controller.addWheel(wheelConnectionPoints[i], WHEEL_DIRECTION_AXIS, WHEEL_AXLE_AXIS, SUSPENSION_REST_LENGTH, WHEEL_RADIUS);
      controller.setWheelSuspensionStiffness(i, SUSPENSION_STIFFNESS);
      controller.setWheelMaxSuspensionTravel(i, MAX_SUSPENSION_TRAVEL);
      controller.setWheelFrictionSlip(i, FRICTION_SLIP);
      controller.setWheelSuspensionRelaxation(i, DAMPING_RELAXATION);
      controller.setWheelSuspensionCompression(i, DAMPING_COMPRESSION);
    }

    vehicleController.current = controller;
    // Populate the store immediately instead of waiting for the first
    // throttled updateEntity below, so e.g. Player.tsx's nearest-vehicle
    // search doesn't have a stale/missing entry for this car right after it
    // spawns.
    const t = chassis.translation();
    updateEntity(id, { type: 'car', position: [t.x, t.y, t.z] });

    return () => {
      world.removeVehicleController(controller);
      vehicleController.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, wheelConnectionPoints]);

  const steeringIndices = useMemo(() => [0, 1, 2, 3].filter((i) => (wheelDefs[i] ?? FALLBACK_WHEEL).steering), [wheelDefs]);
  const rwdIndices = useMemo(() => [0, 1, 2, 3].filter((i) => (wheelDefs[i] ?? FALLBACK_WHEEL).rwd), [wheelDefs]);
  const steeringSpring = useRef(new FixedTickSpring(10, 0.6, 60));

  // Transmission state -- persists across renders like the original's
  // instance fields.
  const gear = useRef(1);
  const shiftTimer = useRef(0);
  const flipTimer = useRef(0);

  // -- Physics-step driving logic: engine force / brake / steering per
  // wheel, then controller.updateVehicle() to actually integrate them into
  // the chassis's velocity. This has to run once per PHYSICS tick (not once
  // per render frame) since updateVehicle() both consumes and re-derives
  // per-wheel state (wheelRotation, suspension length) tied to Rapier's own
  // fixed timestep (see App.tsx's <Physics timeStep={1/120}>) -- using
  // world.timestep here instead of the render `delta` also makes the
  // steering spring and gear-shift timer tick at a consistent real-time
  // rate regardless of render framerate, same spirit as FixedTickSpring
  // itself. useBeforePhysicsStep can fire more than once per rendered frame
  // (whenever physics needs to catch up); that's fine here since everything
  // below re-reads the CURRENT chassis state fresh each call.
  useBeforePhysicsStep((world) => {
    // Belt-and-suspenders: <Physics paused> (App.tsx) should already stop
    // this from firing at all, but this doesn't cost anything to check and
    // means driving/flip-recovery definitely can't sneak a force in while
    // paused even if that assumption ever turns out wrong.
    if (isPaused) return;

    const controller = vehicleController.current;
    const chassis = chassisRef.current;
    if (!controller || !chassis) return;

    const dt = world.timestep;

    // -- Flip recovery: runs unconditionally (driven or parked), since a
    // parked car can just as easily get knocked over by another car or the
    // player. See the constants above for what counts as "flipped" and
    // "stationary" (see git history / chat: "se l'auto si ribalta di lato
    // o sottosopra ed e' ferma, respawnalla dritta dopo 2 secondi").
    {
      const flipRot = chassis.rotation();
      _chassisQuat.set(flipRot.x, flipRot.y, flipRot.z, flipRot.w);
      _chassisUp.set(0, 1, 0).applyQuaternion(_chassisQuat);
      const flipLinvel = chassis.linvel();
      const flipAngvel = chassis.angvel();
      const linSpeedSq = flipLinvel.x * flipLinvel.x + flipLinvel.y * flipLinvel.y + flipLinvel.z * flipLinvel.z;
      const angSpeedSq = flipAngvel.x * flipAngvel.x + flipAngvel.y * flipAngvel.y + flipAngvel.z * flipAngvel.z;
      const isFlipped = _chassisUp.y < FLIP_UP_DOT_THRESHOLD;
      const isStationary = linSpeedSq < FLIP_STATIONARY_LINVEL_SQ && angSpeedSq < FLIP_STATIONARY_ANGVEL_SQ;

      if (isFlipped && isStationary) {
        flipTimer.current += dt;
        if (flipTimer.current >= FLIP_RESPAWN_DELAY) {
          const flipPos = chassis.translation();
          const groundY = getTerrainHeight(flipPos.x, flipPos.z) + getRoadOffset(flipPos.x, flipPos.z);
          // Keep the car's current heading (yaw) -- only roll/pitch get
          // zeroed -- so this reads as "set back on its wheels facing the
          // same way", not a random teleport.
          const yaw = _uprightEuler.setFromQuaternion(_chassisQuat, 'YXZ').y;
          _uprightQuat.setFromEuler(_uprightEuler.set(0, yaw, 0));
          chassis.setTranslation({ x: flipPos.x, y: groundY + 1.2, z: flipPos.z }, true);
          chassis.setRotation({ x: _uprightQuat.x, y: _uprightQuat.y, z: _uprightQuat.z, w: _uprightQuat.w }, true);
          chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
          chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
          flipTimer.current = 0;
        }
      } else {
        flipTimer.current = 0;
      }
    }

    const isCarActive = currentControllable === 'car' && controlledEntityId === id && !isVehicleTransitioning;

    if (!isCarActive) {
      // Parked/undriven: no self-propulsion, no brake, wheels centered --
      // but the suspension (updateVehicle below) still has to run every
      // tick for every car, driven or not, or an unattended car would just
      // free-fall the instant nothing else is holding it up.
      for (let i = 0; i < 4; i++) {
        controller.setWheelEngineForce(i, 0);
        controller.setWheelBrake(i, 0);
        controller.setWheelSteering(i, 0);
      }
      steeringSpring.current.position = 0;
      steeringSpring.current.velocity = 0;
      steeringSpring.current.target = 0;
      gear.current = 1;
      shiftTimer.current = 0;
      controller.updateVehicle(dt);
      return;
    }

    const rot = chassis.rotation();
    _chassisQuat.set(rot.x, rot.y, rot.z, rot.w);
    _forward.set(0, 0, 1).applyQuaternion(_chassisQuat);

    const linvel = chassis.linvel();
    _velVec.set(linvel.x, linvel.y, linvel.z);
    const speed = _velVec.dot(_forward);

    // TEMP DEBUG (Claude): per-car live telemetry for tuning ENGINE_FORCE/
    // BRAKE_FORCE/etc. now that they're driving a real Rapier vehicle
    // controller instead of the old dead-in-the-water cannon one.
    if (import.meta.env.DEV) {
      (window as any).__carDebug = (window as any).__carDebug || {};
      (window as any).__carDebug[id] = {
        velocity: [linvel.x, linvel.y, linvel.z],
        speed,
        gear: gear.current,
        inputForward: input.forward,
        inputBackward: input.backward,
        steeringIndices: [...steeringIndices],
        rwdIndices: [...rwdIndices],
        steeringPos: steeringSpring.current.position,
        steeringTarget: steeringSpring.current.target,
        wheelsInContact: [0, 1, 2, 3].map((i) => controller.wheelIsInContact(i)),
        wheelSuspensionLength: [0, 1, 2, 3].map((i) => controller.wheelSuspensionLength(i)),
      };
    }

    // -- Transmission (straight port of Car.ts's engine/gear logic).
    // (Plain `for` loops rather than `[0,1,2,3].forEach(...)` throughout
    // this callback on purpose -- with 6 cars in the scene this can run
    // more than once per rendered frame, and an array literal + a fresh
    // arrow-function closure per wheel per branch adds up to real
    // garbage-collector pressure, which is what was behind the periodic
    // stutter in the old version: V8 has to pause everything for a sweep
    // every few seconds once enough of that piles up. Same reasoning behind
    // the module-level scratch vectors above instead of a fresh
    // `new THREE.Vector3()`/`new THREE.Quaternion()` per car per call.)
    if (shiftTimer.current > 0) {
      shiftTimer.current = Math.max(0, shiftTimer.current - dt);
    } else if (input.backward) {
      const powerFactor = (GEARS_MAX_SPEEDS['R'] - speed) / Math.abs(GEARS_MAX_SPEEDS['R']);
      const force = (ENGINE_FORCE / gear.current) * Math.abs(powerFactor);
      // Sign flipped (Claude) -- see the "forward" branch below, same fix,
      // opposite direction: this was applying its force with the wrong
      // sign relative to Rapier's DynamicRayCastVehicleController
      // convention, so accelerator and reverse were swapped end to end
      // (see git history / chat: "l'acceleratore e la retromarcia sn
      // invertite").
      for (let i = 0; i < 4; i++) controller.setWheelEngineForce(i, -force);
    } else {
      const top = GEARS_MAX_SPEEDS[String(gear.current)];
      const bottom = GEARS_MAX_SPEEDS[String(gear.current - 1)];
      const powerFactor = (top - speed) / (top - bottom);

      if (powerFactor < 0.1 && gear.current < MAX_GEARS) {
        gear.current += 1;
        shiftTimer.current = TIME_TO_SHIFT;
        for (let i = 0; i < 4; i++) controller.setWheelEngineForce(i, 0);
      } else if (gear.current > 1 && powerFactor > 1.2) {
        gear.current -= 1;
        shiftTimer.current = TIME_TO_SHIFT;
        for (let i = 0; i < 4; i++) controller.setWheelEngineForce(i, 0);
      } else if (input.forward) {
        const force = (ENGINE_FORCE / gear.current) * powerFactor;
        // Sign flipped (Claude) -- was `-force`. Rapier's vehicle
        // controller's positive wheel engine force turned out to drive
        // this chassis in its local -Z (the same direction `_forward`/
        // `speed` above call "backward"), the opposite of what this code
        // assumed when it was ported from the cannon-es version. Flipping
        // just these two signs (this branch and the `input.backward`
        // branch above) realigns accelerator/reverse with W/S without
        // touching the speed/gear logic, which was already measuring
        // "forward" consistently via the `_forward` vector -- only the
        // force applied to actually go there was inverted.
        for (let i = 0; i < 4; i++) controller.setWheelEngineForce(i, force);
      } else {
        for (let i = 0; i < 4; i++) controller.setWheelEngineForce(i, 0);
      }
    }

    // -- Steering, with the same speed-sensitive progressive limit and
    // drift correction as the original.
    if (_velVec.lengthSq() > 0.0001) {
      _normalizedVel.copy(_velVec).normalize();
    } else {
      _normalizedVel.copy(_forward);
    }
    const angleTo = _normalizedVel.angleTo(_forward);
    _cross.crossVectors(_normalizedVel, _forward);
    const driftCorrection = _up.dot(_cross) < 0 ? -angleTo : angleTo;

    const speedFactor = THREE.MathUtils.clamp(speed * 0.3, 1, Number.MAX_VALUE);
    if (input.right) {
      const steering = Math.min(-MAX_STEER_VAL / speedFactor, -driftCorrection);
      steeringSpring.current.target = THREE.MathUtils.clamp(steering, -MAX_STEER_VAL, MAX_STEER_VAL);
    } else if (input.left) {
      const steering = Math.max(MAX_STEER_VAL / speedFactor, -driftCorrection);
      steeringSpring.current.target = THREE.MathUtils.clamp(steering, -MAX_STEER_VAL, MAX_STEER_VAL);
    } else {
      steeringSpring.current.target = 0;
    }
    steeringSpring.current.simulate(dt);
    for (let j = 0; j < steeringIndices.length; j++) controller.setWheelSteering(steeringIndices[j], steeringSpring.current.position);

    // -- Handbrake (Space), rear wheels only, matching the original.
    const brakeForce = input.jump ? BRAKE_FORCE : 0;
    for (let j = 0; j < rwdIndices.length; j++) controller.setWheelBrake(rwdIndices[j], brakeForce);

    controller.updateVehicle(dt);
  });

  useFrame((state, delta) => {
    if (!chassisRef.current) return;
    // Freezes door-swing animation and the debug/entity-sync writes below
    // while paused -- this plain useFrame isn't stopped by <Physics
    // paused>, only the useBeforePhysicsStep block above is.
    if (isPaused) return;

    if (import.meta.env.DEV) {
      const t0 = chassisRef.current.translation();
      const controller0 = vehicleController.current;
      (window as any).__carsPosDebug = (window as any).__carsPosDebug || {};
      (window as any).__carsPosDebug[id] = {
        pos: [t0.x, t0.y, t0.z],
        hasController: !!controller0,
        wheelDefsCount: wheelDefs.filter((d) => !!d?.node).length,
        wheelsInContact: controller0 ? [0,1,2,3].map((i) => controller0.wheelIsInContact(i)) : null,
      };
    }

    if (import.meta.env.DEV && !(window as any).__seatDebug?.[id]) {
      (window as any).__seatDebug = (window as any).__seatDebug || {};
      const dump: any = {};
      for (let i = 1; i <= 4; i++) {
        const seat = clonedScene.getObjectByName(`seat_${i}`);
        const entrance = clonedScene.getObjectByName(`entrance_${i}`);
        const door = clonedScene.getObjectByName(`door_${i}`);
        const wp = new THREE.Vector3();
        dump[`seat_${i}`] = seat ? (seat.getWorldPosition(wp), [wp.x, wp.y, wp.z]) : null;
        dump[`entrance_${i}`] = entrance ? (entrance.getWorldPosition(wp), [wp.x, wp.y, wp.z]) : null;
        dump[`door_${i}`] = door ? (door.getWorldPosition(wp), [wp.x, wp.y, wp.z]) : null;
        dump[`seat_${i}_userData`] = seat ? seat.userData : null;
      }
      (window as any).__seatDebug[id] = dump;
    }

    // Door animation runs whenever THIS car is the one being entered or
    // exited, regardless of whether driving control has actually handed
    // over yet -- controlledEntityId only updates once the transition
    // finishes, so during "entering" it still points at whatever was
    // controlled before (see transitioningEntityId in store.ts).
    {
      // Only the door named by transitioningDoorName opens; every other
      // door on this car animates back toward closed, same as before this
      // was multi-door (see the doorsRef comment above).
      const activeDoorName = isVehicleTransitioning && transitioningEntityId === id
        ? (transitioningDoorName ?? 'door_1')
        : null;
      const step = DOOR_ROTATION_SPEED * delta;
      for (const doorName in doorsRef.current) {
        const door = doorsRef.current[doorName];
        const target = doorName === activeDoorName ? 1 : 0;
        const current = doorOpenFactors.current[doorName] ?? 0;
        const diff = target - current;
        const next = Math.abs(diff) <= step ? target : current + Math.sign(diff) * step;
        doorOpenFactors.current[doorName] = next;
        door.node.rotation.y = door.sign * next * DOOR_MAX_ANGLE;
      }
    }

    const t = chassisRef.current.translation();
    const rot = chassisRef.current.rotation();
    _carPos.set(t.x, t.y, t.z);
    _chassisQuat.set(rot.x, rot.y, rot.z, rot.w);
    _carEuler.setFromQuaternion(_chassisQuat, 'YXZ');

    // -- Wheel visual sync. Rapier's vehicle controller (see
    // useBeforePhysicsStep above) never touches these meshes itself -- it
    // only tracks the underlying suspension/steering/spin state
    // (wheelSuspensionLength/wheelSteering/wheelRotation), the same way the
    // original (non-React) Sketchbook's Vehicle.ts calls
    // rayCastVehicle.updateWheelTransform(i) and copies the result onto
    // wheel.wheelObject every frame. Ported directly from cannon-es's own
    // RaycastVehicle.updateWheelTransform (decoded from this app's
    // previously-bundled @react-three/cannon worker, see git history) since
    // Rapier's controller is a from-scratch reimplementation of the same
    // underlying (Bullet) algorithm and exposes the same per-wheel
    // quantities: local wheel orientation = steering-angle rotation around
    // the wheel's local "up" axis, composed with spin rotation (wheelRotation)
    // around its local axle axis; local wheel position = this wheel's
    // connection point plus its (already-normalized) direction axis scaled
    // by the CURRENT (compressed/extended) suspension length. Both are
    // expressed in chassis-local space and applied directly to each wheel
    // node's own position/quaternion -- since those nodes are children of
    // this chassis's own object hierarchy, three.js composes them with the
    // chassis's world transform automatically, so there's no manual
    // world-space math needed here (unlike the original, which had to do
    // that composition itself because its wheelObjects were separate
    // world-space objects, not parented under the chassis).
    const controller = vehicleController.current;
    if (controller) {
      for (let i = 0; i < 4; i++) {
        const def = wheelDefs[i];
        if (!def?.node) continue;
        const suspLen = controller.wheelSuspensionLength(i) ?? SUSPENSION_REST_LENGTH;
        const steerAngle = controller.wheelSteering(i) ?? 0;
        const spinAngle = controller.wheelRotation(i) ?? 0;

        const conn = wheelConnectionPoints[i];
        def.node.position.set(
          conn.x + WHEEL_DIRECTION_AXIS.x * suspLen,
          conn.y + WHEEL_DIRECTION_AXIS.y * suspLen,
          conn.z + WHEEL_DIRECTION_AXIS.z * suspLen
        );

        _steerQuat.setFromAxisAngle(WHEEL_UP_AXIS, steerAngle);
        _spinQuat.setFromAxisAngle(WHEEL_AXLE_AXIS, spinAngle);
        def.node.quaternion.copy(_steerQuat).multiply(_spinQuat);
      }
    }

    setPlayerInfo([_carPos.x, _carPos.y, _carPos.z], _carEuler.y);

    if (state.clock.getElapsedTime() % 0.1 < 0.02) {
      updateEntity(id, {
        type: 'car',
        position: [_carPos.x, _carPos.y, _carPos.z],
        rotation: _carEuler.y,
      });
    }
  });

  return (
    <RigidBody
      ref={chassisRef}
      name={id}
      type="dynamic"
      colliders={false}
      position={position}
      linearDamping={0.01}
      angularDamping={0.01}
      canSleep={false}
      collisionGroups={groupsExcluding(CollisionGroups.Default)}
    >
      {CHASSIS_SHAPES.map((shape, i) => (
        <CuboidCollider
          key={i}
          args={[shape.fullDimensions[0] / 2, shape.fullDimensions[1] / 2, shape.fullDimensions[2] / 2]}
          position={shape.position}
          friction={0.3}
          restitution={0}
        />
      ))}
      <primitive object={clonedScene} />
    </RigidBody>
  );
};

export default Car;
