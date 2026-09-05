import React, { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useCompoundBody, useCylinder, useRaycastVehicle } from '@react-three/cannon';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useInput } from '../../hooks/useInput';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { CollisionGroups } from '../../enums/CollisionGroups';

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
const ROLL_INFLUENCE = 0.4;
const AXLE_LOCAL: [number, number, number] = [-1, 0, 0];
const DIRECTION_LOCAL: [number, number, number] = [0, -1, 0];

// Engine/transmission/steering tuning, straight from the original's Car.ts.
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
  position: [number, number, number];
  steering: boolean;
  rwd: boolean;
}
const FALLBACK_WHEEL: WheelDef = { position: [0, 0, 0], steering: false, rwd: true };

// Chassis compound shape, built from the two "collision" boxes baked into
// car.glb (Cube.006 = lower body, Cube.002 = cabin) -- read directly from
// the glb's accessor data. CANNON.Box already takes half-extents, and the
// original passes the glb node's `scale` straight into `new CANNON.Box(...)`,
// so these are half-extents; useCompoundBody's Box args are full dimensions,
// hence the *2 below.
const CHASSIS_SHAPES = [
  { type: 'Box' as const, args: [1.2233487367630005, 0.4973112344741821, 2.420389175415039] as [number, number, number], position: [0, 0.09126596, 0.03799713] as [number, number, number] },
  { type: 'Box' as const, args: [1.0837020874023438, 0.5600574016571045, 1.071435809135437] as [number, number, number], position: [0, 0.6199502944946289, -0.2552129924297333] as [number, number, number] },
];

// Module-level scratch objects, reused across every Car instance's useFrame
// call instead of allocating fresh THREE.Vector3/Euler objects every frame
// (safe because R3F runs each registered useFrame callback to completion,
// one after another, in the same tick -- nothing here is read after this
// component's own callback returns). With up to 6 cars on screen, avoiding
// ~10 allocations/frame/car here is what removed the periodic GC-driven
// stutter.
const _forward = new THREE.Vector3();
const _velVec = new THREE.Vector3();
const _normalizedVel = new THREE.Vector3();
const _cross = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _carPos = new THREE.Vector3();
const _carEuler = new THREE.Euler();

const Car: React.FC<CarProps> = ({ position = [10, 5, 0], id = 'car-1' }) => {
  const { scene } = useGLTF('car.glb');
  const clonedScene = useMemo(() => scene.clone(), [scene]);

  const wheelDefs = useMemo<WheelDef[]>(() => {
    const defs: WheelDef[] = [];
    clonedScene.traverse((child) => {
      // Hide all wheel (and, per the name heuristic, steering-wheel) models,
      // as requested previously -- purely visual, doesn't affect the defs
      // collected below, which key off the precise userData.data === 'wheel'
      // flag the original itself keys off.
      if (child.userData?.data === 'wheel' || child.name.toLowerCase().includes('wheel')) {
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
      if (child.userData?.data === 'wheel') {
        defs.push({
          position: [child.position.x, child.position.y, child.position.z],
          steering: child.userData.steering === 'true',
          rwd: child.userData.drive !== 'fwd',
        });
      }
    });
    if (defs.length !== 4) {
      console.warn(`Car ${id}: expected 4 wheel nodes in car.glb, found ${defs.length}. Falling back to a stub wheel for any missing slot.`);
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
  const [isReady, setIsReady] = useState(false);

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

  // Chassis -- a compound body built from the car's own collision geometry
  // (see CHASSIS_SHAPES above) instead of a single guessed box, so the real
  // wheel raycasts (added below via useRaycastVehicle) line up with a hull
  // that actually matches the model.
  //
  // IMPORTANT: this used to also carry `collisionFilterMask:
  // ~CollisionGroups.TrimeshColliders` to exclude the terrain/road trimesh
  // from the chassis's own narrow-phase collision, on the theory that the
  // wheel raycasts below were the only thing that should hold the car up
  // (cheaper: skips a full box-vs-trimesh test every step on top of the
  // raycasts already doing that job). Verified live in the browser
  // (window.__gameStore) that with that exclusion in place, every car's Y
  // position free-falls forever from its spawn height straight through
  // the ground -- the raycast-based suspension isn't actually holding
  // them up (root cause not yet fully isolated: likely something in how
  // @react-three/cannon's useRaycastVehicle wires up the worker-side
  // vehicle, since the raycast itself checks out fine against cannon-es's
  // own source). Until that's root-caused, the chassis collides with
  // terrain/road normally (default mask, -1) so the car has *some* way to
  // rest on the ground -- confirmed live that this actually stops the
  // fall. Only 6 cars, so the extra narrow-phase cost is not a real
  // concern.
  const [chassisRef, chassisApi] = useCompoundBody<THREE.Group>(() => ({
    allowSleep: false,
    mass: 50, // matches the original's `new CANNON.Body({ mass: 50 })`
    position,
    linearDamping: 0.01,
    angularDamping: 0.01,
    material: { friction: 0.3 }, // matches the original's Mat.friction = 0.3
    collisionFilterGroup: CollisionGroups.Default,
    shapes: CHASSIS_SHAPES,
  }), undefined, []);

  // Four invisible, non-colliding proxy bodies -- @react-three/cannon's
  // RaycastVehicle implementation writes each wheel's raycast-computed
  // transform into one of these every physics step (see cannon-worker-api's
  // addRaycastVehicle), the same way the original writes into its
  // `wheel.wheelObject` each frame. We don't render or show them (the real
  // wheel meshes stay hidden, per the existing behavior above); we only need
  // their refs to identify each wheel slot to the vehicle.
  const [wheel0] = useCylinder(() => ({ collisionFilterGroup: 0, collisionFilterMask: 0, args: [WHEEL_RADIUS, WHEEL_RADIUS, 0.3, 16] }), undefined, []);
  const [wheel1] = useCylinder(() => ({ collisionFilterGroup: 0, collisionFilterMask: 0, args: [WHEEL_RADIUS, WHEEL_RADIUS, 0.3, 16] }), undefined, []);
  const [wheel2] = useCylinder(() => ({ collisionFilterGroup: 0, collisionFilterMask: 0, args: [WHEEL_RADIUS, WHEEL_RADIUS, 0.3, 16] }), undefined, []);
  const [wheel3] = useCylinder(() => ({ collisionFilterGroup: 0, collisionFilterMask: 0, args: [WHEEL_RADIUS, WHEEL_RADIUS, 0.3, 16] }), undefined, []);
  const wheelRefs = [wheel0, wheel1, wheel2, wheel3];

  const [, vehicleApi] = useRaycastVehicle(() => {
    const defs = [0, 1, 2, 3].map((i) => wheelDefs[i] ?? FALLBACK_WHEEL);
    return {
      chassisBody: chassisRef,
      wheels: wheelRefs,
      wheelInfos: defs.map((def) => ({
        radius: WHEEL_RADIUS,
        suspensionStiffness: SUSPENSION_STIFFNESS,
        suspensionRestLength: SUSPENSION_REST_LENGTH,
        maxSuspensionTravel: MAX_SUSPENSION_TRAVEL,
        frictionSlip: FRICTION_SLIP,
        dampingRelaxation: DAMPING_RELAXATION,
        dampingCompression: DAMPING_COMPRESSION,
        rollInfluence: ROLL_INFLUENCE,
        axleLocal: AXLE_LOCAL,
        directionLocal: DIRECTION_LOCAL,
        chassisConnectionPointLocal: [def.position[0], def.position[1] + 0.2, def.position[2]] as [number, number, number],
      })),
      indexForwardAxis: 2,
      indexRightAxis: 0,
      indexUpAxis: 1,
    };
  }, undefined, []);

  const steeringIndices = useMemo(() => [0, 1, 2, 3].filter((i) => (wheelDefs[i] ?? FALLBACK_WHEEL).steering), [wheelDefs]);
  const rwdIndices = useMemo(() => [0, 1, 2, 3].filter((i) => (wheelDefs[i] ?? FALLBACK_WHEEL).rwd), [wheelDefs]);
  const steeringSpring = useRef(new FixedTickSpring(10, 0.6, 60));

  // Transmission state -- persists across renders like the original's
  // instance fields.
  const gear = useRef(1);
  const shiftTimer = useRef(0);

  const velocity = useRef([0, 0, 0]);
  useEffect(() => {
    const unsubVel = chassisApi.velocity.subscribe(v => velocity.current = v);
    const unsubPos = chassisApi.position.subscribe((p) => {
      if (p) {
        updateEntity(id, {
          type: 'car',
          position: p as [number, number, number]
        });
        setIsReady(true);
      }
    });
    return () => { unsubVel(); unsubPos(); };
  }, [chassisApi, updateEntity, id]);

  const wasActive = useRef(false);

  useFrame((state, delta) => {
    if (!isReady || !chassisRef.current) return;

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

    // While a vehicle-entry/exit animation is playing, the character
    // hasn't actually taken (or given up) the wheel yet -- ignore input
    // so the car can't still be steered mid-exit.
    const isCarActive = currentControllable === 'car' && controlledEntityId === id && !isVehicleTransitioning;

    if (!isCarActive) {
      // Zero out any lingering engine force/steering/brake exactly once on
      // the active -> inactive edge, so a parked or just-exited car doesn't
      // keep driving itself -- applyEngineForce/setSteeringValue set
      // *persistent* worker-side state (that's the whole point: the
      // physics worker's own RaycastVehicle re-applies it every physics
      // step on its own, independent of our render rate), so it has to be
      // explicitly told to stop.
      if (wasActive.current) {
        for (let i = 0; i < 4; i++) {
          vehicleApi.applyEngineForce(0, i);
          vehicleApi.setBrake(0, i);
        }
        for (let j = 0; j < steeringIndices.length; j++) vehicleApi.setSteeringValue(0, steeringIndices[j]);
        steeringSpring.current.position = 0;
        steeringSpring.current.velocity = 0;
        steeringSpring.current.target = 0;
        gear.current = 1;
        shiftTimer.current = 0;
        wasActive.current = false;
      }

      chassisRef.current.getWorldPosition(_carPos);
      if (state.clock.getElapsedTime() % 0.1 < 0.02) {
        updateEntity(id, { type: 'car', position: [_carPos.x, _carPos.y, _carPos.z] });
      }
      return;
    }
    wasActive.current = true;

    const quat = chassisRef.current.quaternion;
    _forward.set(0, 0, 1).applyQuaternion(quat);

    _velVec.set(velocity.current[0], velocity.current[1], velocity.current[2]);
    const speed = _velVec.dot(_forward);

    // -- Transmission (straight port of Car.ts's engine/gear logic; this
    // runs every render frame, but all it's doing is deciding the current
    // engine-force NUMBER to hand to the RaycastVehicle -- the actual
    // per-physics-step force integration is done by the worker's own
    // RaycastVehicle, not by us, so how often we recompute this number
    // doesn't change the effective acceleration the way repeatedly calling
    // applyImpulse used to.)
    // (Plain `for` loops rather than `[0,1,2,3].forEach(...)` throughout
    // this callback on purpose -- with 6 cars in the scene this runs every
    // rendered frame, and an array literal + a fresh arrow-function closure
    // per wheel per branch adds up to real garbage-collector pressure,
    // which is what was behind the periodic stutter: V8 has to pause
    // everything for a sweep every few seconds once enough of that piles
    // up. Same reasoning behind the module-level scratch vectors below
    // instead of a fresh `new THREE.Vector3()`/`new THREE.Euler()` per car
    // per frame.)
    if (shiftTimer.current > 0) {
      shiftTimer.current = Math.max(0, shiftTimer.current - delta);
    } else if (input.backward) {
      const powerFactor = (GEARS_MAX_SPEEDS['R'] - speed) / Math.abs(GEARS_MAX_SPEEDS['R']);
      const force = (ENGINE_FORCE / gear.current) * Math.abs(powerFactor);
      for (let i = 0; i < 4; i++) vehicleApi.applyEngineForce(force, i);
    } else {
      const top = GEARS_MAX_SPEEDS[String(gear.current)];
      const bottom = GEARS_MAX_SPEEDS[String(gear.current - 1)];
      const powerFactor = (top - speed) / (top - bottom);

      if (powerFactor < 0.1 && gear.current < MAX_GEARS) {
        gear.current += 1;
        shiftTimer.current = TIME_TO_SHIFT;
        for (let i = 0; i < 4; i++) vehicleApi.applyEngineForce(0, i);
      } else if (gear.current > 1 && powerFactor > 1.2) {
        gear.current -= 1;
        shiftTimer.current = TIME_TO_SHIFT;
        for (let i = 0; i < 4; i++) vehicleApi.applyEngineForce(0, i);
      } else if (input.forward) {
        const force = (ENGINE_FORCE / gear.current) * powerFactor;
        for (let i = 0; i < 4; i++) vehicleApi.applyEngineForce(-force, i);
      } else {
        for (let i = 0; i < 4; i++) vehicleApi.applyEngineForce(0, i);
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
    steeringSpring.current.simulate(delta);
    for (let j = 0; j < steeringIndices.length; j++) vehicleApi.setSteeringValue(steeringSpring.current.position, steeringIndices[j]);

    // -- Handbrake (Space), rear wheels only, matching the original.
    const brakeForce = input.jump ? BRAKE_FORCE : 0;
    for (let j = 0; j < rwdIndices.length; j++) vehicleApi.setBrake(brakeForce, rwdIndices[j]);

    chassisRef.current.getWorldPosition(_carPos);
    _carEuler.setFromQuaternion(quat, 'YXZ');

    // Update player info so camera/minimap follow the car
    setPlayerInfo([_carPos.x, _carPos.y, _carPos.z], _carEuler.y);

    if (state.clock.getElapsedTime() % 0.1 < 0.02) {
      updateEntity(id, {
        type: 'car',
        position: [_carPos.x, _carPos.y, _carPos.z],
        rotation: _carEuler.y
      });
    }
  });

  return (
    <group ref={chassisRef} name={id}>
      <primitive object={clonedScene} />
    </group>
  );
};

export default Car;
