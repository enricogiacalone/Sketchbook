import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, CuboidCollider, RapierRigidBody, useRapier, useBeforePhysicsStep } from '@react-three/rapier';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useInput } from '../../hooks/useInput';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { CollisionGroups, groupsExcluding } from '../../enums/CollisionGroups';

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
  const { currentControllable, controlledEntityId, isVehicleTransitioning, transitioningEntityId, updateEntity, setPlayerInfo } = useStore(
    useShallow((state) => ({
      currentControllable: state.currentControllable,
      controlledEntityId: state.controlledEntityId,
      isVehicleTransitioning: state.isVehicleTransitioning,
      transitioningEntityId: state.transitioningEntityId,
      updateEntity: state.updateEntity,
      setPlayerInfo: state.setPlayerInfo,
    }))
  );

  // -- Door, mirroring the original's VehicleDoor: swings open for the
  // whole entering/exiting transition and closes the rest of the time
  // (parked or driving). Found and oriented once from the glb below.
  const doorRef = useRef<THREE.Object3D | undefined>(undefined);
  const doorSign = useRef(1);
  const doorOpenFactor = useRef(0);
  const DOOR_ROTATION_SPEED = 5; // rad/sec, matches the original's VehicleDoor.rotationSpeed
  const DOOR_MAX_ANGLE = 1; // radians (~57deg), matches the original's targetRotation of 1

  useEffect(() => {
    const entrance = clonedScene.getObjectByName('entrance_1');
    if (!entrance) return;
    const entrancePos = new THREE.Vector3();
    entrance.getWorldPosition(entrancePos);

    let nearestDoor: THREE.Object3D | null = null;
    let nearestDist = Infinity;
    clonedScene.traverse((child) => {
      if (child.name.toLowerCase().startsWith('door')) {
        const p = new THREE.Vector3();
        child.getWorldPosition(p);
        const d = p.distanceTo(entrancePos);
        if (d < nearestDist) {
          nearestDist = d;
          nearestDoor = child;
        }
      }
    });

    if (nearestDoor) {
      doorRef.current = nearestDoor;
      doorSign.current = -Math.sign((nearestDoor as THREE.Object3D).position.x) || 1;
    }
  }, [clonedScene]);

  // Chassis -- migrated from @react-three/cannon's useCompoundBody to
  // @react-three/rapier's <RigidBody>/<CuboidCollider>. Built from the car's
  // own collision geometry (CHASSIS_SHAPES) instead of a single guessed box,
  // so it still collides correctly sideways with buildings, curbs, other
  // cars, etc. Excludes TrimeshColliders (terrain + road) -- unlike
  // Player.tsx, this ISN'T standing in for a broken suspension anymore: with
  // Rapier's real DynamicRayCastVehicleController (below), the wheel
  // raycasts are what should be holding the chassis up off the terrain/road
  // trimesh. This exclusion just avoids the chassis's own (much coarser)
  // collision hull additionally resting on the ground mesh alongside the
  // wheel raycasts -- two independent vertical supports fighting each other,
  // the same reasoning as Player.tsx's sphere. If real suspension turns out
  // not to hold the chassis up on its own once this is live-tested, this is
  // the first place to revisit.
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
    const controller = vehicleController.current;
    const chassis = chassisRef.current;
    if (!controller || !chassis) return;

    const dt = world.timestep;
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
      for (let i = 0; i < 4; i++) controller.setWheelEngineForce(i, force);
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
        for (let i = 0; i < 4; i++) controller.setWheelEngineForce(i, -force);
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

    // Door animation runs whenever THIS car is the one being entered or
    // exited, regardless of whether driving control has actually handed
    // over yet -- controlledEntityId only updates once the transition
    // finishes, so during "entering" it still points at whatever was
    // controlled before (see transitioningEntityId in store.ts).
    if (doorRef.current) {
      const doorShouldBeOpen = isVehicleTransitioning && transitioningEntityId === id;
      const target = doorShouldBeOpen ? 1 : 0;
      const step = DOOR_ROTATION_SPEED * delta;
      const diff = target - doorOpenFactor.current;
      doorOpenFactor.current = Math.abs(diff) <= step ? target : doorOpenFactor.current + Math.sign(diff) * step;
      doorRef.current.rotation.y = doorSign.current * doorOpenFactor.current * DOOR_MAX_ANGLE;
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
      collisionGroups={groupsExcluding(CollisionGroups.Default, CollisionGroups.TrimeshColliders)}
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
