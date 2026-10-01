import React, { useRef, useEffect, useMemo } from 'react';
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

interface HelicopterProps {
  position?: [number, number, number];
  id?: string;
}

const _heliUp = new THREE.Vector3();
const _heliGlobalUp = new THREE.Vector3(0, 1, 0);
const _heliRight = new THREE.Vector3();
const _heliForward = new THREE.Vector3();
const _heliRotStabQuat = new THREE.Quaternion();
const _heliRotStabEuler = new THREE.Euler();
const _heliVertStab = new THREE.Vector3();
const _heliPos = new THREE.Vector3();
const _heliEuler = new THREE.Euler();
const _heliQuat = new THREE.Quaternion();

const Helicopter: React.FC<HelicopterProps> = ({ position = [-15, 20, 15], id = 'heli-1' }) => {
  const { scene } = useGLTF('heli.glb');
  const clonedScene = useMemo(() => scene.clone(), [scene]);
  // For window.__sim's `grounded`/`numContacts` telemetry -- see
  // Airplane.tsx / debug/simDebug.ts for the full explanation.
  const { world } = useRapier();

  // Same fix as Airplane.tsx / Car.tsx: heli.glb bakes in its own
  // "collision" helper meshes (Cube.NNN boxes + Sphere.NNN spheres, all
  // carrying userData.data === 'collision') authored only to help build the
  // physics hull in Blender, never meant to be visible in-game -- nothing
  // was hiding them here, so they rendered as real geometry (see git
  // history / chat: "l'elicottero ha delle sfere visibili").
  useEffect(() => {
    clonedScene.traverse((child) => {
      if (child.userData?.data === 'collision') child.visible = false;
    });
  }, [clonedScene]);
  const input = useInput();
  // Vehicle entry/exit (including the exit key) is orchestrated centrally
  // by Player.tsx (see vehicleTransition there).
  const { currentControllable, controlledEntityId, controlledSeatType, isVehicleTransitioning, updateEntity, setPlayerInfo, isPaused } = useStore(
    useShallow((state) => ({
      currentControllable: state.currentControllable,
      controlledEntityId: state.controlledEntityId,
      // Only the occupant of the driver seat (seat_1) actually flies the
      // helicopter -- a passenger in seat_2 just rides along. See
      // Player.tsx's getSeatInfo()/seat-switching and Car.tsx's identical
      // isCarActive gate.
      controlledSeatType: state.controlledSeatType,
      isVehicleTransitioning: state.isVehicleTransitioning,
      updateEntity: state.updateEntity,
      setPlayerInfo: state.setPlayerInfo,
      isPaused: state.isPaused,
    }))
  );

  // Migrated from @react-three/cannon's useBox to @react-three/rapier's
  // <RigidBody>/<CuboidCollider> -- see Airplane.tsx for the general
  // reasoning (half-extents conversion, collisionGroups). Old full-size box
  // [1.2, 1.5, 4] -> half-extents [0.6, 0.75, 2].
  const chassisHalfExtents: [number, number, number] = [0.6, 0.75, 2];
  const ref = useRef<RapierRigidBody>(null);

  useEffect(() => {
    // Populate the store immediately -- see Airplane.tsx/Car.tsx for why.
    if (!ref.current) return;
    const t = ref.current.translation();
    updateEntity(id, { type: 'helicopter', position: [t.x, t.y, t.z] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const velocity = useRef([0, 0, 0]);
  const angularVelocity = useRef([0, 0, 0]);

  const enginePower = useRef(0);
  const rotorsRef = useRef<THREE.Object3D[]>([]);

  useEffect(() => {
    // Same bug/fix as Airplane.tsx: this traversed `scene` (the shared,
    // cached, never-rendered GLTF scene) instead of `clonedScene` (what
    // the <primitive> below actually renders) -- rotating the found
    // "rotor" nodes every frame had no visible effect since they belonged
    // to a completely different, invisible clone of the object graph.
    if (clonedScene) {
      const rotors: THREE.Object3D[] = [];
      clonedScene.traverse((child) => {
        if (child.userData.data === 'rotor') rotors.push(child);
      });
      rotorsRef.current = rotors;
    }
  }, [clonedScene]);

  useFrame((state, delta) => {
    const body = ref.current;
    const isHeliActive = currentControllable === 'helicopter' && controlledEntityId === id && !isVehicleTransitioning && controlledSeatType === 'driver';

    if (!body) return;
    // Same reasoning as Airplane.tsx: this vehicle's control logic lives in
    // a plain useFrame, not useBeforePhysicsStep, so <Physics paused> alone
    // doesn't stop it.
    if (isPaused) return;

    // Synchronous Rapier reads (no more worker-subscription lag -- see
    // Player.tsx's rigidBodyRef comment for the general explanation).
    const lv = body.linvel();
    velocity.current[0] = lv.x;
    velocity.current[1] = lv.y;
    velocity.current[2] = lv.z;
    const av = body.angvel();
    angularVelocity.current[0] = av.x;
    angularVelocity.current[1] = av.y;
    angularVelocity.current[2] = av.z;

    // Keep the store's entities map accurate EVEN WHILE PARKED (nobody
    // driving it yet) -- this used to sit only in the isHeliActive branch
    // below, so a never-entered helicopter's stored position was frozen at
    // whatever ref.current.translation() happened to be at the very first
    // mount-time snapshot (still up near its spawn height, e.g. y=20),
    // forever outside Player.tsx's VEHICLE_SEARCH_RADIUS -- explaining "F
    // nn fa nulla vicino l'elicottero" (F does nothing near the
    // helicopter): Player.tsx's nearest-vehicle search never found it in
    // the first place, regardless of how close the player actually stood.
    // Throttled the same way (~10Hz) as the old active-only call it
    // replaces.
    if (state.clock.getElapsedTime() % 0.1 < 0.02) {
      const t0 = body.translation();
      const rot0 = body.rotation();
      _heliQuat.set(rot0.x, rot0.y, rot0.z, rot0.w);
      _heliEuler.setFromQuaternion(_heliQuat, 'YXZ');
      updateEntity(id, { type: 'helicopter', position: [t0.x, t0.y, t0.z], rotation: _heliEuler.y });
    }

    // Unified telemetry for window.__sim (debug/simDebug.ts) -- see
    // Airplane.tsx for the full writeup; the helicopter previously had NO
    // debug hooks at all, unlike the airplane's ad hoc ones.
    const reportTelemetry = (active: boolean, extra?: Record<string, unknown>) => {
      const rotT = body.rotation();
      _heliQuat.set(rotT.x, rotT.y, rotT.z, rotT.w);
      _heliEuler.setFromQuaternion(_heliQuat, 'YXZ');
      const posT = body.translation();
      const velT = body.linvel();
      const angvelT = body.angvel();
      const collider0 = body.collider(0);
      let numContacts = 0;
      if (collider0) world.contactPairsWith(collider0, () => { numContacts += 1; });
      simDebug.registerVehicle('helicopter', body, {
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
          THREE.MathUtils.radToDeg(_heliEuler.y),
          THREE.MathUtils.radToDeg(_heliEuler.x),
          THREE.MathUtils.radToDeg(_heliEuler.z),
        ],
        vel: [velT.x, velT.y, velT.z],
        speed: Math.hypot(velT.x, velT.y, velT.z),
        localSpeed: null,
        angvel: [angvelT.x, angvelT.y, angvelT.z],
        sleeping: body.isSleeping(),
        friction: collider0 ? collider0.friction() : null,
        frictionCombineRule: collider0 ? collider0.frictionCombineRule() : null,
        numContacts,
        grounded: numContacts > 0,
        extra,
      });
    };

    if (!isHeliActive) {
      if (enginePower.current > 0) enginePower.current = Math.max(0, enginePower.current - delta * 0.06);
      if (import.meta.env.DEV) reportTelemetry(false);
      return;
    }

    if (enginePower.current < 1) enginePower.current = Math.min(1, enginePower.current + delta * 0.2);

    for (let i = 0; i < rotorsRef.current.length; i++) {
      rotorsRef.current[i].rotateX(enginePower.current * delta * 30);
    }

    const rot = body.rotation();
    _heliQuat.set(rot.x, rot.y, rot.z, rot.w);
    const quat = _heliQuat;
    _heliUp.set(0, 1, 0).applyQuaternion(quat);
    const up = _heliUp;
    const globalUp = _heliGlobalUp;
    _heliRight.set(1, 0, 0).applyQuaternion(quat);
    const right = _heliRight;
    _heliForward.set(0, 0, 1).applyQuaternion(quat);
    const forward = _heliForward;

    // Legacy Helicopter.ts (pre-React) drove the physics body directly every
    // ~60Hz substep -- `body.velocity +=`, `body.angularVelocity +=`, and
    // `*=`/lerp for damping -- entirely independent of the body's mass or
    // inertia tensor. This port instead used applyImpulse/applyTorqueImpulse
    // for throttle and pitch/roll, which divide by mass and by the (very
    // uneven, box-shaped) inertia tensor: the exact same numeric constant
    // ended up producing wildly different actual responsiveness per axis
    // (roll came out ~3x stronger than pitch). On top of that, roll's
    // left/right (A/D) sign was flipped relative to legacy's rollLeft/
    // rollRight -- so rolling was both backwards AND disproportionately
    // strong ("l'elicottero funziona a cazzo"). Fixed by reading the
    // current linear/angular velocity once, accumulating every term into it
    // exactly like legacy did (restoring legacy's exact per-axis constants
    // and roll sign), and writing the result back with a single
    // setLinvel/setAngvel -- mass/inertia-independent again.
    // dt60 renormalizes legacy's implicit-60fps-per-step constants to the
    // real frame delta (dt60 == 1 at exactly 60fps), clamped so a dropped/
    // backgrounded frame can't apply a single huge jump.
    const dt60 = Math.min(delta * 60, 3);

    // 1. Throttle (Ascend/Descend) -- legacy: body.velocity += up * 0.15 * enginePower
    const curVel = body.linvel();
    const vel = { x: curVel.x, y: curVel.y, z: curVel.z };
    const throttleFactor = 0.15 * enginePower.current * dt60;
    if (input.shift) {
        vel.x += up.x * throttleFactor; vel.y += up.y * throttleFactor; vel.z += up.z * throttleFactor;
    }
    if (input.jump) {
        vel.x -= up.x * throttleFactor; vel.y -= up.y * throttleFactor; vel.z -= up.z * throttleFactor;
    }

    // 2. Vertical Stabilization (Gravity compensation) -- legacy:
    // gravityCompensation = |gravity| * physicsFrameTime * 0.98 * sqrt(clamp(dot(globalUp,up),0,1))
    // vertDamping = (0, vel.y, 0) * -0.01; vertStab = (up*gravityCompensation + vertDamping) * enginePower
    const gravity = 20;
    let gravityCompensation = gravity * delta * 0.98;
    const dot = globalUp.dot(up);
    gravityCompensation *= Math.sqrt(THREE.MathUtils.clamp(dot, 0, 1));
    const vertDampY = vel.y * -0.01;
    _heliVertStab.set(up.x * gravityCompensation, up.y * gravityCompensation + vertDampY, up.z * gravityCompensation);
    _heliVertStab.multiplyScalar(enginePower.current);
    vel.x += _heliVertStab.x; vel.y += _heliVertStab.y; vel.z += _heliVertStab.z;

    // 3. Positional Damping (horizontal drag only -- legacy's Helicopter.ts
    // never touches Y here, only x/z: `body.velocity.x *= lerp(1, 0.995,
    // enginePower); body.velocity.z *= ...`). Math.pow(base, dt60) instead
    // of a flat multiply so this multiplicative damping also generalizes
    // across frame rates instead of only being correct at 60fps.
    const damping = Math.pow(THREE.MathUtils.lerp(1, 0.995, enginePower.current), dt60);
    vel.x *= damping;
    vel.z *= damping;

    body.setLinvel(vel, true);

    // 4. Rotation Stabilization, Yaw, Pitch & Roll (Controls) -- legacy
    // applied every rotation term directly onto angularVelocity each step,
    // then did one `angularVelocity *= 0.97` damping pass at the end;
    // ported 1:1 here into a single accumulate-then-setAngvel, instead of
    // the previous split of "setAngvel for stabilization+yaw" followed by
    // a separate applyTorqueImpulse (inertia-tensor-divided) for pitch/roll.
    _heliRotStabQuat.setFromUnitVectors(up, globalUp);
    _heliRotStabEuler.setFromQuaternion(_heliRotStabQuat);

    const angDamping = Math.pow(0.97, dt60);
    let angX = angularVelocity.current[0] * angDamping;
    let angY = angularVelocity.current[1] * angDamping;
    let angZ = angularVelocity.current[2] * angDamping;

    // Self-leveling -- legacy: angularVelocity += rotStabEuler * enginePower
    angX += _heliRotStabEuler.x * enginePower.current * 2.0;
    angZ += _heliRotStabEuler.z * enginePower.current * 2.0;

    // Yaw (Q/E) -- legacy: angularVelocity += up * 0.07 * enginePower (yawLeft/Q), -= (yawRight/E)
    const rotFactor = 0.07 * enginePower.current * dt60;
    if (input.yawLeft) { angX += up.x * rotFactor; angY += up.y * rotFactor; angZ += up.z * rotFactor; }
    if (input.yawRight) { angX -= up.x * rotFactor; angY -= up.y * rotFactor; angZ -= up.z * rotFactor; }

    // Pitch (W/S) -- legacy: angularVelocity += right * 0.07 * enginePower (pitchDown/W), -= (pitchUp/S)
    if (input.forward) { angX += right.x * rotFactor; angY += right.y * rotFactor; angZ += right.z * rotFactor; }
    if (input.backward) { angX -= right.x * rotFactor; angY -= right.y * rotFactor; angZ -= right.z * rotFactor; }

    // Roll (A/D) -- legacy: angularVelocity -= forward * 0.07 * enginePower (rollLeft/A), += (rollRight/D).
    // (Previously flipped here: A applied +forward and D applied -forward --
    // backwards relative to legacy, on top of being inertia-tensor-scaled.)
    if (input.left) { angX -= forward.x * rotFactor; angY -= forward.y * rotFactor; angZ -= forward.z * rotFactor; }
    if (input.right) { angX += forward.x * rotFactor; angY += forward.y * rotFactor; angZ += forward.z * rotFactor; }

    body.setAngvel({ x: angX, y: angY, z: angZ }, true);

    if (import.meta.env.DEV) {
      reportTelemetry(true, {
        throttleFactor, gravityCompensation, vertDampY, damping, dt60,
        vertStab: [_heliVertStab.x, _heliVertStab.y, _heliVertStab.z],
        velAfterSet: [vel.x, vel.y, vel.z],
      });
    }

    const t = body.translation();
    _heliPos.set(t.x, t.y, t.z);
    const heliPos = _heliPos;
    _heliEuler.setFromQuaternion(quat, 'YXZ');
    const heliEuler = _heliEuler;

    // Update player info so camera/minimap follow the helicopter
    setPlayerInfo([heliPos.x, heliPos.y, heliPos.z], heliEuler.y);

    // (Position/rotation for the store are now kept up to date
    // unconditionally above, active or parked -- no need to duplicate it
    // here.)
  });

  return (
    <RigidBody
      ref={ref}
      name={id}
      type="dynamic"
      colliders={false}
      position={position}
      collisionGroups={groupsExcluding(CollisionGroups.Default)}
    >
      {/* Same fix as Airplane.tsx: a bare box chassis with no wheel/
          traction model was resting on Rapier's default friction
          (~0.5) -- low friction here so it doesn't get glued down or
          snag while sliding/tipping on the ground. */}
      <CuboidCollider args={chassisHalfExtents} mass={50} friction={0.05} restitution={0} frictionCombineRule={CoefficientCombineRule.Min} />
      {/* Chassis box half-height is 0.75; the glb's lowest point sits
          0.673 below the model's own origin, so -0.08 aligns it with
          the box's bottom face. */}
      <primitive object={clonedScene} position={[0, -0.08, 0]} />
    </RigidBody>
  );
};

export default Helicopter;
