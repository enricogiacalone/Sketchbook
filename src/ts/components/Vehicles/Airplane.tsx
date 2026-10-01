import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, CuboidCollider, RapierRigidBody, useRapier } from '@react-three/rapier';
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

const Airplane: React.FC<AirplaneProps> = ({ position = [-10, 5, -10], id = 'airplane-1' }) => {
  const { scene } = useGLTF('airplane.glb');
  const clonedScene = useMemo(() => scene.clone(), [scene]);
  // For window.__sim's `grounded`/`numContacts` telemetry -- see
  // debug/simDebug.ts. World.contactPairsWith needs the live Rapier
  // World + this body's own Collider handle, neither of which the
  // RigidBody ref alone exposes as conveniently.
  const { world } = useRapier();

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
  const chassisHalfExtents: [number, number, number] = [0.75, 0.5, 2];
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
      clonedScene.traverse((child) => {
        if (child.userData.data === 'rotor') rotorRef.current = child;
      });
    }
  }, [clonedScene]);

  useFrame((state, delta) => {
    const body = chassisRef.current;
    const isAirplaneActive = currentControllable === 'airplane' && controlledEntityId === id && !isVehicleTransitioning;

    if (!body) return;
    // Unlike Car.tsx, all of this vehicle's control logic (engine power,
    // forces, rotation) lives in this plain useFrame rather than
    // useBeforePhysicsStep, so <Physics paused> alone doesn't stop it --
    // needs its own explicit check, same as Player.tsx/Car.tsx.
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
      if (collider0) world.contactPairsWith(collider0, () => { numContacts += 1; });
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

    if (!isAirplaneActive) {
      if (enginePower.current > 0) enginePower.current = Math.max(0, enginePower.current - delta * 0.12);
      if (import.meta.env.DEV) reportTelemetry(false);
      return;
    }

    if (enginePower.current < 1) enginePower.current = Math.min(1, enginePower.current + delta * 0.4);

    if (rotorRef.current) {
        rotorRef.current.rotateX(enginePower.current * delta * 60);
    }

    const rot = body.rotation();
    _planeQuat.set(rot.x, rot.y, rot.z, rot.w);

    _planeForward.set(0, 0, 1).applyQuaternion(_planeQuat);
    const forward = _planeForward;
    _planeUp.set(0, 1, 0).applyQuaternion(_planeQuat);
    const up = _planeUp;
    _planeRight.set(1, 0, 0).applyQuaternion(_planeQuat);
    const right = _planeRight;

    _planeVelVec.set(velocity.current[0], velocity.current[1], velocity.current[2]);
    const velVec = _planeVelVec;
    const currentSpeed = velVec.dot(forward);
    const flightModeInfluence = THREE.MathUtils.clamp(currentSpeed / 10, 0, 1);

    // Legacy Airplane.ts (pre-React) drove the physics body directly every
    // ~60Hz substep -- `body.velocity +=`, `body.angularVelocity +=`/`=lerp`
    // -- entirely independent of the body's mass or inertia tensor. This
    // port instead used applyImpulse/applyTorqueImpulse for thrust and
    // pitch/roll/yaw, which divide by mass and by the (very uneven,
    // box-shaped) inertia tensor: the same numeric constant produced wildly
    // different actual responsiveness per axis (roll came out ~4x stronger
    // than pitch/yaw). On top of that, roll's left/right (A/D) sign was
    // flipped relative to legacy's rollLeft/rollRight -- backwards AND too
    // strong at once ("l'aereoplano funziona a cazzo"). Fixed by reading
    // the current linear/angular velocity once, accumulating every term
    // into it exactly like legacy did (restoring legacy's exact per-axis
    // constants, roll sign, and its rotation-self-leveling term), and
    // writing the result back with a single setLinvel/setAngvel --
    // mass/inertia-independent again.
    // dt60 renormalizes legacy's implicit-60fps-per-step constants to the
    // real frame delta (dt60 == 1 at exactly 60fps), clamped so a dropped/
    // backgrounded frame can't apply a single huge jump.
    const dt60 = Math.min(delta * 60, 3);

    // Legacy also self-leveled the nose toward the current velocity
    // direction, but only while the wheels-on-ground raycast said the plane
    // was airborne (otherwise it would fight the plane resting on its
    // landing gear). This port has no wheel/landing-gear collider -- the
    // chassis is a single CuboidCollider -- so that guard can't be
    // replicated; without it, the very first frames of gravity-fall before
    // real airspeed builds up get read as "velocity direction" and pitch
    // the nose straight into the ground (the plane never took off: "l'aereo
    // nn si muove piu, nn parte"). Left out entirely rather than risk that
    // again -- pitch/roll/yaw below are fully player-controlled instead.
    const av = body.angvel();
    let angX = av.x;
    let angY = av.y;
    let angZ = av.z;

    // Pitch (W/S) -- legacy: angularVelocity += right * 0.04 * flightModeInfluence * enginePower (pitchDown/W), -= (pitchUp/S)
    const pitchYawRollFactor = flightModeInfluence * enginePower.current * dt60;
    if (input.forward) { angX += right.x * 0.04 * pitchYawRollFactor; angY += right.y * 0.04 * pitchYawRollFactor; angZ += right.z * 0.04 * pitchYawRollFactor; }
    if (input.backward) { angX -= right.x * 0.04 * pitchYawRollFactor; angY -= right.y * 0.04 * pitchYawRollFactor; angZ -= right.z * 0.04 * pitchYawRollFactor; }

    // Yaw (Q/E) -- legacy: angularVelocity += up * 0.02 * flightModeInfluence * enginePower (yawLeft/Q), -= (yawRight/E)
    if (input.yawLeft) { angX += up.x * 0.02 * pitchYawRollFactor; angY += up.y * 0.02 * pitchYawRollFactor; angZ += up.z * 0.02 * pitchYawRollFactor; }
    if (input.yawRight) { angX -= up.x * 0.02 * pitchYawRollFactor; angY -= up.y * 0.02 * pitchYawRollFactor; angZ -= up.z * 0.02 * pitchYawRollFactor; }

    // Roll (A/D) -- legacy: angularVelocity -= forward * 0.055 * flightModeInfluence * enginePower (rollLeft/A), += (rollRight/D).
    // (Previously flipped here: A applied +forward and D applied -forward --
    // backwards relative to legacy, on top of being inertia-tensor-scaled
    // and 1.5x too strong.)
    if (input.left) { angX -= forward.x * 0.055 * pitchYawRollFactor; angY -= forward.y * 0.055 * pitchYawRollFactor; angZ -= forward.z * 0.055 * pitchYawRollFactor; }
    if (input.right) { angX += forward.x * 0.055 * pitchYawRollFactor; angY += forward.y * 0.055 * pitchYawRollFactor; angZ += forward.z * 0.055 * pitchYawRollFactor; }

    // Angular damping -- legacy: angularVelocity = lerp(angularVelocity, angularVelocity*0.98, flightModeInfluence),
    // applied AFTER the controls above. Math.pow(base, dt60) generalizes the
    // implicit-60fps 0.98 constant across frame rates.
    const angDampBase = Math.pow(0.98, dt60);
    angX = THREE.MathUtils.lerp(angX, angX * angDampBase, flightModeInfluence);
    angY = THREE.MathUtils.lerp(angY, angY * angDampBase, flightModeInfluence);
    angZ = THREE.MathUtils.lerp(angZ, angZ * angDampBase, flightModeInfluence);

    body.setAngvel({ x: angX, y: angY, z: angZ }, true);

    // Thrust -- legacy: speedModifier depends on throttle(Shift)/brake(Space)
    // (no wheel-on-ground case here, since this port has no wheel raycast);
    // velocity += forward * (velLength1*lastDrag + speedModifier) * enginePower
    let speedModifier = 0.02;
    if (input.shift && !input.jump) speedModifier = 0.06;
    else if (!input.shift && input.jump) speedModifier = -0.05;

    const curVel = body.linvel();
    const vel = { x: curVel.x, y: curVel.y, z: curVel.z };
    const velLength1 = velVec.length();
    const thrust = (velLength1 * lastDrag.current + speedModifier) * enginePower.current * dt60;
    vel.x += forward.x * thrust; vel.y += forward.y * thrust; vel.z += forward.z * thrust;

    // Drag -- legacy: drag = velLength2 * 0.003 * enginePower; velocity -= velocity*drag; lastDrag saved for next frame's thrust term above
    const velLength2 = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    const drag = velLength2 * 0.003 * enginePower.current * dt60;
    vel.x -= vel.x * drag; vel.y -= vel.y * drag; vel.z -= vel.z * drag;
    lastDrag.current = drag;

    // Lift -- legacy: lift = clamp(velLength2*0.005*enginePower, 0, 0.05); velocity += up*lift
    const lift = THREE.MathUtils.clamp(velLength2 * 0.005 * enginePower.current * dt60, 0, 0.05);
    vel.x += up.x * lift; vel.y += up.y * lift; vel.z += up.z * lift;

    body.setLinvel(vel, true);

    if (import.meta.env.DEV) {
      reportTelemetry(true, {
        speedModifier, velLength1, thrust, drag, lift, lastDrag: lastDrag.current,
        dt60, currentSpeed, flightModeInfluence, forward: [forward.x, forward.y, forward.z],
        velAfterSet: [vel.x, vel.y, vel.z],
      });
    }

    const t = body.translation();
    _planePos.set(t.x, t.y, t.z);
    const planePos = _planePos;
    _planeEuler.setFromQuaternion(_planeQuat, 'YXZ');
    const planeEuler = _planeEuler;

    // Update player info so camera/minimap follow the plane
    setPlayerInfo([planePos.x, planePos.y, planePos.z], planeEuler.y);

    // (Position/rotation for the store are now kept up to date
    // unconditionally above, active or parked -- no need to duplicate it
    // here.)
  });

  return (
    <RigidBody
      ref={chassisRef}
      name={id}
      type="dynamic"
      colliders={false}
      position={position}
      canSleep={false}
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
      <CuboidCollider args={chassisHalfExtents} mass={50} friction={0.05} restitution={0} frictionCombineRule={CoefficientCombineRule.Min} />
      {/* Chassis box half-height is 0.5; the glb's lowest point (the
          landing gear) sits 0.265 below the model's own origin, so
          -0.24 aligns the wheels with the box's bottom face. */}
      <primitive object={clonedScene} position={[0, -0.24, 0]} />
    </RigidBody>
  );
};

export default Airplane;
