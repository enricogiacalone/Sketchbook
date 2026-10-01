import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, CuboidCollider, RapierRigidBody, useRapier, useBeforePhysicsStep, interactionGroups } from '@react-three/rapier';
import { SketchbookRaycastVehicle } from './sketchbookRaycastVehicle';
// CoefficientCombineRule isn't re-exported by @react-three/rapier's own
// types (only as a TS type, not the runtime enum) -- pulled directly from
// its underlying @dimforge/rapier3d-compat dependency instead (already in
// node_modules via @react-three/rapier, just not a direct package.json dep).
import { CoefficientCombineRule } from '@dimforge/rapier3d-compat';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useInput } from '../../hooks/useInput';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { CollisionGroups, groupsExcluding } from '../../enums/CollisionGroups';
import { simDebug } from '../../debug/simDebug';

interface AirplaneProps {
  position?: [number, number, number];
  id?: string;
}

const _planeForward = new THREE.Vector3();
const _planeUp = new THREE.Vector3();
const _planeRight = new THREE.Vector3();
const _planeVelVec = new THREE.Vector3();
const _planePos = new THREE.Vector3();
const _planeEuler = new THREE.Euler();
const _planeQuat = new THREE.Quaternion();
const _apQuat = new THREE.Quaternion();
const _apUp = new THREE.Vector3();
const _apRight = new THREE.Vector3();
const _apForward = new THREE.Vector3();
const _apVel = new THREE.Vector3();
const _apAng = new THREE.Vector3();
const _apLook = new THREE.Vector3();
const _apStabQuat = new THREE.Quaternion();
const _apStabEuler = new THREE.Euler();
const _apSteerQ = new THREE.Quaternion();
const _apSpinQ = new THREE.Quaternion();
const AP_UP_AXIS = new THREE.Vector3(0, 1, 0);
const AP_AXLE = new THREE.Vector3(-1, 0, 0);
const AP_DOWN = new THREE.Vector3(0, -1, 0);

// airplane.glb dell'originale: forme di collisione (box; le sfere
// dell'originale toccavano solo il terreno a triangoli), carrello (3 ruote
// a raggio, il ruotino anteriore sterza) e massa 50 kg con l'inerzia della
// scatola che contiene tutte le forme (come cannon).
const PLANE_BOXES: { pos: [number, number, number]; half: [number, number, number] }[] = [
  { pos: [0, 0.295, -0.272], half: [0.293, 0.27, 1.113] },
  { pos: [1.037, 0.276, 0.025], half: [0.744, 0.046, 0.243] },
  { pos: [-1.037, 0.276, 0.025], half: [0.744, 0.046, 0.243] },
  { pos: [0, 0.703, -1.015], half: [0.293, 0.138, 0.37] },
  { pos: [0, 1.104, -1.111], half: [0.03, 0.262, 0.275] },
  { pos: [0.521, 0.457, -1.123], half: [0.228, 0.024, 0.262] },
  { pos: [-0.521, 0.457, -1.123], half: [0.228, 0.024, 0.262] },
];
const PLANE_WHEELS: { node: string; pos: [number, number, number]; steering: boolean }[] = [
  { node: 'wheel_fl', pos: [0, -0.151, 0.492], steering: true },
  { node: 'wheel_fl.001', pos: [0.206, -0.152, -0.287], steering: false },
  { node: 'wheel_fl.002', pos: [-0.206, -0.152, -0.287], steering: false },
];
const PLANE_MASS = 50;
const PLANE_AABB_HALF = [1.781, 0.6705, 1.1135];
const PLANE_WHEEL_RAY_GROUPS = interactionGroups([CollisionGroups.Default], [CollisionGroups.Default, CollisionGroups.TrimeshColliders]);

// SpringSimulator dell'originale (fotogrammi fissi a 60 Hz, interpolati)
class FrameSpring {
  pos = 0;
  target = 0;
  private offset = 0;
  private a: [number, number] = [0, 0];
  private b: [number, number] = [0, 0];
  constructor(
    private mass: number,
    private damping: number
  ) {}
  simulate(dt: number) {
    const frame = 1 / 60;
    const total = this.offset + dt;
    const n = Math.floor(total / frame);
    this.offset = total % frame;
    for (let i = 0; i < n; i++) {
      let v = this.b[1] + (this.target - this.b[0]) / this.mass;
      v *= this.damping;
      this.a = this.b;
      this.b = [this.b[0] + v, v];
    }
    this.pos = THREE.MathUtils.lerp(this.a[0], this.b[0], this.offset / frame);
  }
}

const Airplane: React.FC<AirplaneProps> = ({ position = [-10, 5, -10], id = 'airplane-1' }) => {
  const { scene } = useGLTF('airplane.glb');
  const clonedScene = useMemo(() => scene.clone(), [scene]);
  // For window.__sim's `grounded`/`numContacts` telemetry -- see
  // debug/simDebug.ts. World.contactPairsWith needs the live Rapier
  // World + this body's own Collider handle, neither of which the
  // RigidBody ref alone exposes as conveniently.
  const { world, rapier } = useRapier();

  // car.glb's own "collision" helper meshes (boxes/spheres wrapping the
  // body, authored in Blender only to help build the physics hull, never
  // meant to be visible in-game) got hidden in Car.tsx a while back -- this
  // glb bakes in the exact same kind of helpers (Cube.NNN boxes + Sphere.NNN
  // spheres, all carrying userData.data === 'collision') and never got the
  // same treatment, so they rendered as real geometry floating on the plane
  // (see git history / chat: "l'aereo ha delle sfere visibili"). Purely
  // visual -- the actual physics collider below (chassisHalfExtents) is
  // unrelated to this hide.
  useEffect(() => {
    clonedScene.traverse((child) => {
      if (child.userData?.data === 'collision') child.visible = false;
    });
  }, [clonedScene]);
  const input = useInput();
  // Vehicle entry/exit (including the exit key) is orchestrated centrally
  // by Player.tsx (see vehicleTransition there).
  const { currentControllable, controlledEntityId, isVehicleTransitioning, updateEntity, setPlayerInfo, isPaused } = useStore(
    useShallow((state) => ({
      currentControllable: state.currentControllable,
      controlledEntityId: state.controlledEntityId,
      isVehicleTransitioning: state.isVehicleTransitioning,
      updateEntity: state.updateEntity,
      setPlayerInfo: state.setPlayerInfo,
      isPaused: state.isPaused,
    }))
  );

  // Migrated from @react-three/cannon's useBox to @react-three/rapier's
  // <RigidBody>/<CuboidCollider>. Rapier's CuboidCollider args are
  // half-extents (like raw cannon-es), whereas @react-three/cannon's useBox
  // took FULL dimensions -- so the old [1.5, 1, 4] full-size box becomes
  // [0.75, 0.5, 2] half-extents here. collisionGroups with no excluded
  // groups (groupsExcluding(CollisionGroups.Default)) matches the old
  // collisionFilterMask: -1 -- a member of Default that collides with
  // everything.
  const chassisRef = useRef<RapierRigidBody>(null);

  useEffect(() => {
    // Populate the store immediately instead of waiting for the first
    // render-rate updateEntity below, so this plane has a valid entry (for
    // e.g. Player.tsx's nearest-vehicle search) as soon as it spawns.
    if (!chassisRef.current) return;
    const t = chassisRef.current.translation();
    updateEntity(id, { type: 'airplane', position: [t.x, t.y, t.z] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const velocity = useRef([0, 0, 0]);
  const lastDrag = useRef(0);
  const activeRef = useRef(false);
  const isPausedRef = useRef(false);
  isPausedRef.current = isPaused;
  const lastTelemetry = useRef<Record<string, unknown>>({});
  const gear = useRef<SketchbookRaycastVehicle | null>(null);
  const springs = useMemo(
    () => ({
      steering: new FrameSpring(10, 0.6),
      aileron: new FrameSpring(5, 0.6),
      elevator: new FrameSpring(7, 0.6),
      rudder: new FrameSpring(10, 0.6),
    }),
    []
  );
  const partsRef = useRef<{
    aileronL?: THREE.Object3D;
    aileronR?: THREE.Object3D;
    elevators: THREE.Object3D[];
    rudder?: THREE.Object3D;
    wheels: (THREE.Object3D | undefined)[];
  }>({
    elevators: [],
    wheels: [],
  });

  // massa/inerzia/gravita' dell'originale e carrello a raggi
  useEffect(() => {
    const body = chassisRef.current;
    if (!body) return;
    const e = PLANE_AABB_HALF;
    const I = new THREE.Vector3(
      (PLANE_MASS / 12) * (4 * e[1] * e[1] + 4 * e[2] * e[2]),
      (PLANE_MASS / 12) * (4 * e[0] * e[0] + 4 * e[2] * e[2]),
      (PLANE_MASS / 12) * (4 * e[1] * e[1] + 4 * e[0] * e[0])
    );
    body.setAdditionalMassProperties(PLANE_MASS, { x: 0, y: 0, z: 0 }, { x: I.x, y: I.y, z: I.z }, { x: 0, y: 0, z: 0, w: 1 }, true);
    body.setGravityScale(9.81 / Math.max(0.1, Math.abs(world.gravity.y)), true);
    const v = new SketchbookRaycastVehicle(world, rapier, body, I);
    v.lagSeconds = 1 / 60;
    for (const w of PLANE_WHEELS) {
      v.addWheel({
        connectionLocal: new THREE.Vector3(w.pos[0], w.pos[1] + 0.2, w.pos[2]),
        directionLocal: AP_DOWN,
        axleLocal: AP_AXLE,
        radius: 0.12,
        suspensionRestLength: 0.25,
        maxSuspensionTravel: 1,
        suspensionStiffness: 150,
        dampingCompression: 5,
        dampingRelaxation: 5,
        frictionSlip: 1,
        rollInfluence: 1,
      });
    }
    gear.current = v;
    return () => {
      gear.current = null;
    };
  }, [world, rapier]);

  const enginePower = useRef(0);
  const rotorRef = useRef<THREE.Object3D | undefined>(undefined);

  useEffect(() => {
    // Bug (Claude): this used to traverse `scene` -- the shared, cached
    // GLTF scene useGLTF returns -- to find the propeller node, but what's
    // actually rendered below is `clonedScene` (a deep .clone(), see the
    // "collision" hide effect just above this one, which correctly
    // traverses clonedScene). .clone() creates ALL-NEW Object3D instances
    // for every child, so rotorRef.current ended up pointing at a node
    // that exists only in the invisible original scene -- rotating it
    // every frame did nothing observable ("le eliche dell'aereo dovrebbero
    // muoversi"). Fixed by traversing clonedScene, same as the sibling
    // effect above.
    if (clonedScene) {
      const parts = partsRef.current;
      parts.elevators = [];
      clonedScene.traverse((child) => {
        const d = child.userData.data;
        if (d === 'rotor') rotorRef.current = child;
        else if (d === 'aileron') {
          if (child.userData.side === 'left') parts.aileronL = child;
          else parts.aileronR = child;
        } else if (d === 'elevator') parts.elevators.push(child);
        else if (d === 'rudder') parts.rudder = child;
      });
      parts.wheels = PLANE_WHEELS.map((w) => clonedScene.getObjectByName(w.node));
    }
  }, [clonedScene]);

  useFrame((state, delta) => {
    const body = chassisRef.current;
    const isAirplaneActive = currentControllable === 'airplane' && controlledEntityId === id && !isVehicleTransitioning;

    if (!body) return;
    // (in pausa fermi anche motore, elica e superfici mobili)
    if (isPaused) return;

    // Synchronous Rapier read (no more worker-subscription lag -- see
    // Player.tsx's rigidBodyRef comment for the general explanation).
    const lv = body.linvel();
    velocity.current[0] = lv.x;
    velocity.current[1] = lv.y;
    velocity.current[2] = lv.z;

    // Keep the store's entities map accurate EVEN WHILE PARKED -- see
    // Helicopter.tsx for the full writeup (same latent bug, same fix): this
    // used to sit only in the isAirplaneActive branch below, so a
    // never-entered airplane's stored position was frozen at whatever
    // chassisRef.current.translation() happened to be at the very first
    // mount-time snapshot, forever outside Player.tsx's
    // VEHICLE_SEARCH_RADIUS. Throttled the same way (~10Hz) as the old
    // active-only call it replaces.
    if (state.clock.getElapsedTime() % 0.1 < 0.02) {
      const t0 = body.translation();
      const rot0 = body.rotation();
      _planeQuat.set(rot0.x, rot0.y, rot0.z, rot0.w);
      _planeEuler.setFromQuaternion(_planeQuat, 'YXZ');
      updateEntity(id, { type: 'airplane', position: [t0.x, t0.y, t0.z], rotation: _planeEuler.y });
    }

    // Unified telemetry for window.__sim (debug/simDebug.ts) -- one place
    // computing pos/rotation/velocity/contacts/friction fresh off the body
    // every frame, called from both the parked and the actively-flown path
    // below, instead of the two differently-shaped, airplane-only
    // window.__airplaneDebug/__airplaneDebug2 globals this replaces (the
    // helicopter had no equivalent at all). Grounded/numContacts comes from
    // Rapier's own contact graph (world.contactPairsWith), not a guess from
    // position/velocity -- this is what let us finally SEE, live, whether a
    // "won't move" airplane was actually still touching the ground.
    const reportTelemetry = (active: boolean, extra?: Record<string, unknown>) => {
      const rotT = body.rotation();
      _planeQuat.set(rotT.x, rotT.y, rotT.z, rotT.w);
      _planeEuler.setFromQuaternion(_planeQuat, 'YXZ');
      const posT = body.translation();
      const velT = body.linvel();
      const angvelT = body.angvel();
      const collider0 = body.collider(0);
      let numContacts = 0;
      if (collider0)
        world.contactPairsWith(collider0, () => {
          numContacts += 1;
        });
      simDebug.registerVehicle('airplane', body, {
        id,
        active,
        paused: isPaused,
        enginePower: enginePower.current,
        // Drop consumeJustPressed (a function, not a flag) so this is a
        // plain, JSON.stringify-able snapshot of the actual held keys.
        input: Object.fromEntries(Object.entries(input).filter(([, v]) => typeof v === 'boolean')),
        pos: [posT.x, posT.y, posT.z],
        quat: [rotT.x, rotT.y, rotT.z, rotT.w],
        eulerDeg: [
          THREE.MathUtils.radToDeg(_planeEuler.y),
          THREE.MathUtils.radToDeg(_planeEuler.x),
          THREE.MathUtils.radToDeg(_planeEuler.z),
        ],
        vel: [velT.x, velT.y, velT.z],
        speed: Math.hypot(velT.x, velT.y, velT.z),
        localSpeed: typeof extra?.currentSpeed === 'number' ? (extra.currentSpeed as number) : null,
        angvel: [angvelT.x, angvelT.y, angvelT.z],
        sleeping: body.isSleeping(),
        friction: collider0 ? collider0.friction() : null,
        frictionCombineRule: collider0 ? collider0.frictionCombineRule() : null,
        numContacts,
        grounded: numContacts > 0,
        extra,
      });
    };

    // motore (Airplane.update dell'originale): sale in 2.5 s ai comandi,
    // scende piano senza; elica, sterzo del ruotino e superfici mobili
    activeRef.current = isAirplaneActive;
    if (isAirplaneActive) enginePower.current = Math.min(1, enginePower.current + delta * 0.4);
    else enginePower.current = Math.max(0, enginePower.current - delta * 0.12);
    if (rotorRef.current) rotorRef.current.rotateX(enginePower.current * delta * 60);

    const on = isAirplaneActive;
    const v = gear.current;
    const grounded = !!v && v.numWheelsOnGround > 0;
    const leftish = on && (input.yawLeft || input.left) && !input.yawRight && !input.right;
    const rightish = on && (input.yawRight || input.right) && !input.yawLeft && !input.left;
    springs.steering.target = grounded ? (leftish ? 0.8 : rightish ? -0.8 : 0) : 0;
    springs.steering.simulate(delta);
    if (v) PLANE_WHEELS.forEach((w, i) => w.steering && v.setWheelSteering(i, springs.steering.pos));
    const PARTS = 0.7;
    springs.aileron.target = on && input.left && !input.right ? PARTS : on && input.right && !input.left ? -PARTS : 0;
    springs.elevator.target = on && input.backward && !input.forward ? PARTS : on && input.forward && !input.backward ? -PARTS : 0;
    springs.rudder.target = on && input.yawLeft && !input.yawRight ? PARTS : on && input.yawRight && !input.yawLeft ? -PARTS : 0;
    springs.aileron.simulate(delta);
    springs.elevator.simulate(delta);
    springs.rudder.simulate(delta);
    const parts = partsRef.current;
    if (parts.aileronL) parts.aileronL.rotation.y = springs.aileron.pos;
    if (parts.aileronR) parts.aileronR.rotation.y = -springs.aileron.pos;
    for (const e of parts.elevators) e.rotation.y = springs.elevator.pos;
    if (parts.rudder) parts.rudder.rotation.y = springs.rudder.pos;
    // ruote del carrello: dove le mette la sospensione, sterzo e rotazione
    if (v) {
      PLANE_WHEELS.forEach((w, i) => {
        const node = parts.wheels[i];
        if (!node) return;
        node.position.set(w.pos[0], w.pos[1] + 0.2 - v.wheelSuspensionLength(i), w.pos[2]);
        _apSteerQ.setFromAxisAngle(AP_UP_AXIS, v.wheelSteering(i));
        _apSpinQ.setFromAxisAngle(AP_AXLE, v.wheelRotation(i));
        node.quaternion.copy(_apSteerQ).multiply(_apSpinQ);
      });
    }

    if (import.meta.env.DEV) reportTelemetry(isAirplaneActive, isAirplaneActive ? { ...lastTelemetry.current } : undefined);
    if (!isAirplaneActive) return;

    const t = body.translation();
    _planePos.set(t.x, t.y, t.z);
    const r = body.rotation();
    _planeQuat.set(r.x, r.y, r.z, r.w);
    _planeEuler.setFromQuaternion(_planeQuat, 'YXZ');
    setPlayerInfo([_planePos.x, _planePos.y, _planePos.z], _planeEuler.y);
  });

  // "anche gli altri veicoli aereo e elicottero" -- Airplane.physicsPreStep
  // dell'originale a ogni passo di fisica (k = dt*60: incrementi per passo
  // dell'originale a 60 Hz riportati al passo vero), con quello che mancava:
  // stabilizzazione del muso verso la direzione di volo (senza, l'aereo
  // non "segue" la traiettoria), niente spinta a terra senza gas, carrello
  // vero (ruote a raggio, ruotino che sterza), gravita' 9.81 dell'originale.
  useBeforePhysicsStep((w) => {
    const body = chassisRef.current;
    if (!body || isPausedRef.current) return;
    const dt = w.timestep;
    const k = dt * 60;
    const ep = enginePower.current;
    const on = activeRef.current;
    const v = gear.current;
    const wheelsOnGround = v ? v.numWheelsOnGround : 0;

    const rot = body.rotation();
    _apQuat.set(rot.x, rot.y, rot.z, rot.w);
    _apRight.set(1, 0, 0).applyQuaternion(_apQuat);
    _apUp.set(0, 1, 0).applyQuaternion(_apQuat);
    _apForward.set(0, 0, 1).applyQuaternion(_apQuat);
    const lv = body.linvel();
    const vel = _apVel.set(lv.x, lv.y, lv.z);
    const velLength1 = vel.length();
    const currentSpeed = vel.dot(_apForward);

    const flightModeInfluence = THREE.MathUtils.clamp(currentSpeed / 10, 0, 1);
    // l'originale "alleggerisce" l'aereo con la velocita' (collision.mass):
    // cannon non ricalcola invMass, quindi lo sentono la gravita' (forza =
    // massa * g: fino al 40% a 10 m/s) e le sospensioni, non gli urti
    const lighter = 1 - THREE.MathUtils.clamp(currentSpeed / 10, 0, 1) * 0.6;
    if (v) v.suspensionMassScale = lighter;
    body.setGravityScale((9.81 / Math.max(0.1, Math.abs(w.gravity.y))) * lighter, false);

    const throttle = on && input.shift;
    const brake = on && input.jump;
    const av = body.angvel();
    const ang = _apAng.set(av.x, av.y, av.z);

    // stabilizzazione: il muso gira piano verso dove sta andando l'aereo
    if (velLength1 > 1e-4) {
      _apLook.copy(vel).divideScalar(velLength1);
      _apStabQuat.setFromUnitVectors(_apForward, _apLook);
      _apStabQuat.x *= 0.3;
      _apStabQuat.y *= 0.3;
      _apStabQuat.z *= 0.3;
      _apStabQuat.w *= 0.3;
      _apStabEuler.setFromQuaternion(_apStabQuat);
      let infl = THREE.MathUtils.clamp(velLength1 - 1, 0, 0.1);
      if (wheelsOnGround > 0 && currentSpeed < 0) infl = 0; // retromarcia
      const loopFix = throttle && currentSpeed > 0 ? 0 : 1;
      ang.x += _apStabEuler.x * infl * loopFix * k;
      ang.y += _apStabEuler.y * infl * k;
      ang.z += _apStabEuler.z * infl * loopFix * k;
    }

    if (on) {
      const f = flightModeInfluence * ep * k;
      if (input.backward) ang.addScaledVector(_apRight, -0.04 * f); // S: cabra
      if (input.forward) ang.addScaledVector(_apRight, 0.04 * f); // W: picchia
      if (input.yawLeft) ang.addScaledVector(_apUp, 0.02 * f);
      if (input.yawRight) ang.addScaledVector(_apUp, -0.02 * f);
      if (input.left) ang.addScaledVector(_apForward, -0.055 * f);
      if (input.right) ang.addScaledVector(_apForward, 0.055 * f);
    }

    // spinta: compensa la resistenza del passo prima piu' il gas
    let speedModifier = 0.02;
    if (throttle && !brake) speedModifier = 0.06;
    else if (!throttle && brake) speedModifier = -0.05;
    else if (wheelsOnGround > 0) speedModifier = 0;
    vel.addScaledVector(_apForward, (velLength1 * lastDrag.current + speedModifier * k) * ep);

    // resistenza e portanza
    const velLength2 = vel.length();
    const drag = velLength2 * 0.003 * ep * k;
    vel.addScaledVector(vel, -drag);
    lastDrag.current = drag;
    const lift = THREE.MathUtils.clamp(velLength2 * 0.005 * ep, 0, 0.05) * k;
    vel.addScaledVector(_apUp, lift);
    body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);

    // smorzamento angolare (solo in volo)
    const damp = Math.pow(0.98, k);
    ang.x = THREE.MathUtils.lerp(ang.x, ang.x * damp, flightModeInfluence);
    ang.y = THREE.MathUtils.lerp(ang.y, ang.y * damp, flightModeInfluence);
    ang.z = THREE.MathUtils.lerp(ang.z, ang.z * damp, flightModeInfluence);
    body.setAngvel({ x: ang.x, y: ang.y, z: ang.z }, true);

    // carrello (dopo le velocita' impostate sopra)
    if (v) v.updateVehicle(dt, rapier.QueryFilterFlags.EXCLUDE_SENSORS, PLANE_WHEEL_RAY_GROUPS);

    if (import.meta.env.DEV) {
      lastTelemetry.current = { speedModifier, velLength1, drag, lift, currentSpeed, flightModeInfluence, wheelsOnGround, k };
    }
  });

  return (
    <RigidBody
      ref={chassisRef}
      name={id}
      type="dynamic"
      colliders={false}
      position={position}
      canSleep={false}
      linearDamping={0.01}
      angularDamping={0.01}
      collisionGroups={groupsExcluding(CollisionGroups.Default)}
    >
      {/* Unlike Car.tsx (which has a real RayCastVehicleController doing
          traction on the wheels), this chassis is a single bare box resting
          directly on the ground -- Rapier's default collider friction
          (~0.5, combined with the terrain/road's 0.7-0.8) was never
          overridden, so the box was effectively glued to the runway.
          Restoring legacy's much weaker (but authentic) direct-velocity
          thrust made this obvious: it could no longer out-muscle that
          friction at all ("l'aereo nn parte"). Low friction here mimics
          low-rolling-resistance landing gear, same spirit as Car.tsx's
          friction={0.3} on its own chassis. */}
      {PLANE_BOXES.map((b, i) => (
        <CuboidCollider
          key={i}
          args={b.half}
          position={b.pos}
          density={0}
          friction={0.05}
          restitution={0}
          frictionCombineRule={CoefficientCombineRule.Min}
        />
      ))}
      {/* Chassis box half-height is 0.5; the glb's lowest point (the
          landing gear) sits 0.265 below the model's own origin, so
          -0.24 aligns the wheels with the box's bottom face. */}
      <primitive object={clonedScene} />
    </RigidBody>
  );
};

export default Airplane;
