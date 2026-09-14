import React, { useRef, useState, useCallback, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, BallCollider, RapierRigidBody } from '@react-three/rapier';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useInput } from '../hooks/useInput';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { CollisionGroups, groupsExcluding } from '../enums/CollisionGroups';
import { droneMouseDelta, droneOrientation, droneShake } from '../lib/droneFlight';
import Bullet from './Bullet';
import Missile from './Missile';

// "voglio che il drone in realta' e' il compagno del player e gli
// fluttua attorno quando premo b ne prendo il controllo" -- this used to
// be Player.tsx literally turning INTO the drone (swapping its own mesh
// in place on the same rigid body). Now the drone is its OWN persistent
// entity, always present, mounted once alongside <Player> (see App.tsx):
// it hovers/floats near the player on its own (see the "companion
// follow" branch below) until 'fly' (B) hands control to it -- exactly
// the same currentControllable/controlledEntityId pattern Car.tsx/
// Airplane.tsx/Helicopter.tsx already use for entering a vehicle, just
// with no seats/doors/proximity check since it's already right there.
// Player.tsx orchestrates the actual handoff (setCurrentControllable),
// same as it does for every other controllable -- this component only
// reacts to that state, like every other vehicle does.
export const DRONE_ID = 'companion-drone';

const _droneEuler = new THREE.Euler();
const _droneRight = new THREE.Vector3();
const _droneDeltaQuat = new THREE.Quaternion();
const _droneWorldVel = new THREE.Vector3();
const _droneForward = new THREE.Vector3();
const _dronePos = new THREE.Vector3();
const _missileToTarget = new THREE.Vector3();

// -- Companion-follow (not being piloted) --------------------------------
// Hovers at a fixed offset from whichever entity the store's playerPos/
// playerYaw currently track (the player on foot, OR whatever vehicle
// they're driving -- setPlayerInfo is called by all of them, see
// store.ts), rotated by that entity's yaw so it always sits "off to the
// right and slightly behind", plus a gentle vertical bob so it doesn't
// look frozen in place. A simple clamped proportional controller (seek
// velocity proportional to how far off-station it is) rather than a real
// spring -- good enough for a companion that's meant to visibly catch up
// rather than teleport, and dead simple to reason about.
const FOLLOW_OFFSET = new THREE.Vector3(1.8, 1.7, -1.6);
const FOLLOW_GAIN = 3.2;
const FOLLOW_MAX_SPEED = 14;
const FOLLOW_BOB_AMPLITUDE = 0.15;
const FOLLOW_BOB_SPEED = 1.6;
const FOLLOW_LEVEL_SLERP = 0.05; // per-frame-at-60fps turn rate back toward level+playerYaw while idling

// -- Piloted flight (droneWorld, github.com/blaze33/droneWorld) -- ported
// unchanged from where this used to live in Player.tsx (see git history):
// mouse pitches/yaws the drone directly (pointer-lock deltas drained from
// lib/droneFlight.ts, pushed there by useThirdPersonCamera.ts while
// store.isDrone), Q/E add extra roll, W/S and Space/Shift are accelerated
// thrust on the forward/vertical local axes, and a proportional auto-
// level term pulls bank back toward level as the mouse eases off yaw.
const DRONE_ACCEL = 14;
const DRONE_MAX_SPEED = 16;
const DRONE_DAMPING = 0.94;
const DRONE_MOUSE_ZONE = 300;
const DRONE_ROT_SPEED = 2.2;
const DRONE_KEY_ROLL_SPEED = 1.6;
const DRONE_AUTO_LEVEL_GAIN = 5;
// drone.glb's raw mesh is authored in units ~90 across -- DRONE_MODEL_SCALE
// brings that down to a personal-drone size. DRONE_MODEL_ROTATION is the
// fixed axis correction (determined via offline geometric analysis of the
// raw vertex data, see git history) so the model's own nose lines up with
// droneQuaternion's local +Z ("forward" everywhere in this file: thrust,
// camera offset, gun/missile spawn all agree on that axis).
const DRONE_MODEL_SCALE = 0.016;
const DRONE_MODEL_ROTATION: [number, number, number] = [-Math.PI / 2, 0, 0];

// -- Combat while piloted (see the firing block in useFrame below) -- gun
// fires much faster than the on-foot 200ms cooldown for a "machine gun"
// feel, missile has its own long cooldown so it reads as a deliberate
// secondary weapon.
const DRONE_GUN_INTERVAL = 90; // ms between shots (~11/s)
const DRONE_GUN_SPEED = 60; // units/s
const DRONE_GUN_SHAKE = 0.06;
const DRONE_GUN_SHAKE_MAX = 0.35;
const DRONE_MISSILE_COOLDOWN = 1500; // ms
const DRONE_MISSILE_RANGE = 60;
const DRONE_MISSILE_CONE_COS = Math.cos(THREE.MathUtils.degToRad(35));

// Same simplified stand-in for droneWorld's selectNearestTargetInSight()
// this project already used when the drone lived in Player.tsx -- nearest
// 'enemy' store entity inside a forward-facing cone.
const findMissileTarget = (originPos: THREE.Vector3, forward: THREE.Vector3): string | null => {
  let bestId: string | null = null;
  let bestDot = DRONE_MISSILE_CONE_COS;
  useStore.getState().entities.forEach((e) => {
    if (e.type !== 'enemy') return;
    _missileToTarget.set(e.position[0] - originPos.x, e.position[1] - originPos.y, e.position[2] - originPos.z);
    const dist = _missileToTarget.length();
    if (dist < 0.05 || dist > DRONE_MISSILE_RANGE) return;
    _missileToTarget.normalize();
    const dot = _missileToTarget.dot(forward);
    if (dot > bestDot) {
      bestDot = dot;
      bestId = e.id;
    }
  });
  return bestId;
};

const Drone: React.FC = () => {
  const { scene } = useGLTF('drone.glb');
  const clonedScene = useMemo(() => scene.clone(), [scene]);
  const input = useInput();
  const { currentControllable, controlledEntityId, isPaused, playerPos, playerYaw, setIsDrone } = useStore(
    useShallow((state) => ({
      currentControllable: state.currentControllable,
      controlledEntityId: state.controlledEntityId,
      isPaused: state.isPaused,
      playerPos: state.playerPos,
      playerYaw: state.playerYaw,
      setIsDrone: state.setIsDrone,
    }))
  );

  const ref = useRef<RapierRigidBody>(null);
  const meshGroupRef = useRef<THREE.Group>(null);
  const droneQuaternion = useRef(new THREE.Quaternion());
  const droneLocalVelocity = useRef(new THREE.Vector3());
  const droneRollAngle = useRef(0);
  const wasActive = useRef(false);
  const lastFireTime = useRef(0);
  const lastMissileTime = useRef(0);

  const [bullets, setBullets] = useState<{ id: string, pos: [number, number, number], vel: [number, number, number] }[]>([]);
  const [missiles, setMissiles] = useState<{ id: string, pos: [number, number, number], vel: [number, number, number], targetId: string | null }[]>([]);
  const removeBullet = useCallback((id: string) => setBullets(prev => prev.filter(b => b.id !== id)), []);
  const removeMissile = useCallback((id: string) => setMissiles(prev => prev.filter(m => m.id !== id)), []);

  // Spawn already hovering roughly where the companion-follow logic below
  // will want to hold station, so it doesn't visibly fall/fly in from
  // some arbitrary origin the moment the world loads.
  const initialPos = useMemo<[number, number, number]>(() => [
    playerPos[0] + FOLLOW_OFFSET.x,
    playerPos[1] + FOLLOW_OFFSET.y,
    playerPos[2] + FOLLOW_OFFSET.z,
  ], []); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((state, delta) => {
    const body = ref.current;
    if (!body || isPaused) return;

    // Drained every single frame, active or not, regardless of what it's
    // used for below -- this component's own useInput() tracks "just
    // pressed" independently of Player.tsx's (see useInput.ts's per-hook
    // `justPressed` ref). The press that HANDS this drone control (B, on
    // foot) fires while isActive is still false this same frame (state
    // updates from Player.tsx's setCurrentControllable land next render,
    // not synchronously mid-frame), so if this weren't drained here it
    // would sit unconsumed and get misread as a fresh press the instant
    // isActive turns true -- immediately toggling back off again one
    // frame after turning on ("funziona per un attimo ma poi torna al
    // player").
    const flyPressed = input.consumeJustPressed('fly');

    const isActive = currentControllable === 'drone' && controlledEntityId === DRONE_ID;

    if (isActive && !wasActive.current) {
      // Just took control -- zero the integrator so leftover companion-
      // follow drift doesn't read as unexpected thrust the instant you're
      // piloting, but deliberately keep whatever orientation it already
      // had (it was already roughly facing the same way you were, via
      // the level-toward-playerYaw behavior below) -- no jarring snap.
      droneLocalVelocity.current.set(0, 0, 0);
      droneRollAngle.current = 0;
      droneMouseDelta.x = 0;
      droneMouseDelta.y = 0;
    }
    wasActive.current = isActive;

    if (!isActive) {
      // -- Companion float: seek a station-keeping point near whoever's
      // currently being controlled (player on foot, or a vehicle -- both
      // publish playerPos/playerYaw via setPlayerInfo), rotated by their
      // facing, plus a gentle bob. A clamped P-controller on velocity
      // rather than teleporting keeps it feeling like a real object
      // that's catching up, not a UI element glued to the screen.
      const t = body.translation();
      _dronePos.set(t.x, t.y, t.z);

      _droneForward.copy(FOLLOW_OFFSET).applyAxisAngle(new THREE.Vector3(0, 1, 0), playerYaw);
      const targetX = playerPos[0] + _droneForward.x;
      const targetY = playerPos[1] + _droneForward.y + Math.sin(state.clock.elapsedTime * FOLLOW_BOB_SPEED) * FOLLOW_BOB_AMPLITUDE;
      const targetZ = playerPos[2] + _droneForward.z;

      const ex = targetX - _dronePos.x;
      const ey = targetY - _dronePos.y;
      const ez = targetZ - _dronePos.z;
      const dist = Math.hypot(ex, ey, ez) || 1;
      const speed = Math.min(dist * FOLLOW_GAIN, FOLLOW_MAX_SPEED);
      body.setLinvel({ x: (ex / dist) * speed, y: (ey / dist) * speed, z: (ez / dist) * speed }, true);

      // Level out and face the same way as whoever it's following --
      // slerp, not a snap, so it banks gently into the turn like a real
      // little escort rather than swivelling instantly.
      _droneEuler.set(0, playerYaw, 0, 'YXZ');
      const levelQuat = new THREE.Quaternion().setFromEuler(_droneEuler);
      droneQuaternion.current.slerp(levelQuat, 1 - Math.pow(1 - FOLLOW_LEVEL_SLERP, delta * 60));
      body.setRotation({ x: droneQuaternion.current.x, y: droneQuaternion.current.y, z: droneQuaternion.current.z, w: droneQuaternion.current.w }, true);
      if (meshGroupRef.current) meshGroupRef.current.quaternion.copy(droneQuaternion.current);
      return;
    }

    // -- Piloted flight -- identical math to when this lived in Player.tsx.
    const dx = droneMouseDelta.x;
    const dy = droneMouseDelta.y;
    droneMouseDelta.x = 0;
    droneMouseDelta.y = 0;

    _droneRight.set(1, 0, 0).applyQuaternion(droneQuaternion.current);
    droneRollAngle.current = Math.asin(THREE.MathUtils.clamp(_droneRight.y, -1, 1));

    const yawInput = -dx / DRONE_MOUSE_ZONE;
    const pitchInput = dy / DRONE_MOUSE_ZONE;
    let rollInput = yawInput * 0.5 - droneRollAngle.current / DRONE_AUTO_LEVEL_GAIN;
    if (input.yawLeft) rollInput -= DRONE_KEY_ROLL_SPEED / DRONE_ROT_SPEED;
    if (input.yawRight) rollInput += DRONE_KEY_ROLL_SPEED / DRONE_ROT_SPEED;

    const rot = DRONE_ROT_SPEED * delta;
    _droneDeltaQuat.set(pitchInput * rot, yawInput * rot, rollInput * rot, 1).normalize();
    droneQuaternion.current.multiply(_droneDeltaQuat);

    const thrust = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
    const vertical = (input.jump ? 1 : 0) - (input.shift ? 1 : 0);
    const lv = droneLocalVelocity.current;
    lv.z += thrust * DRONE_ACCEL * delta;
    lv.y += vertical * DRONE_ACCEL * delta;
    const decay = Math.pow(DRONE_DAMPING, delta * 60);
    if (thrust === 0) lv.z *= decay;
    if (vertical === 0) lv.y *= decay;
    lv.z = THREE.MathUtils.clamp(lv.z, -DRONE_MAX_SPEED, DRONE_MAX_SPEED);
    lv.y = THREE.MathUtils.clamp(lv.y, -DRONE_MAX_SPEED, DRONE_MAX_SPEED);

    _droneWorldVel.copy(lv).applyQuaternion(droneQuaternion.current);
    body.setLinvel({ x: _droneWorldVel.x, y: _droneWorldVel.y, z: _droneWorldVel.z }, true);
    body.setRotation({ x: droneQuaternion.current.x, y: droneQuaternion.current.y, z: droneQuaternion.current.z, w: droneQuaternion.current.w }, true);
    if (meshGroupRef.current) meshGroupRef.current.quaternion.copy(droneQuaternion.current);

    // Published for useThirdPersonCamera.ts's chase-cam.
    droneOrientation.copy(droneQuaternion.current);

    const t = body.translation();
    _dronePos.set(t.x, t.y, t.z);
    _droneEuler.setFromQuaternion(droneQuaternion.current, 'YXZ');
    useStore.getState().setPlayerInfo([_dronePos.x, _dronePos.y, _dronePos.z], _droneEuler.y);

    // -- "stesse funzioni di ... sparatoria" -- droneWorld's own two
    // weapons (src/controls/index.js): left-click continuous "gun" (with
    // a camera shake while held), right-click a single homing "missile".
    _droneForward.set(0, 0, 1).applyQuaternion(droneQuaternion.current);

    if (input.primary && state.clock.elapsedTime * 1000 - lastFireTime.current > DRONE_GUN_INTERVAL) {
      const bulletId = `drone-bullet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setBullets(prev => [...prev, {
        id: bulletId,
        pos: [_dronePos.x + _droneForward.x * 1.2, _dronePos.y + _droneForward.y * 1.2, _dronePos.z + _droneForward.z * 1.2],
        vel: [_droneForward.x * DRONE_GUN_SPEED, _droneForward.y * DRONE_GUN_SPEED, _droneForward.z * DRONE_GUN_SPEED],
      }]);
      droneShake.current = Math.min(droneShake.current + DRONE_GUN_SHAKE, DRONE_GUN_SHAKE_MAX);
      lastFireTime.current = state.clock.elapsedTime * 1000;
    }

    if (input.consumeJustPressed('secondary') && state.clock.elapsedTime * 1000 - lastMissileTime.current > DRONE_MISSILE_COOLDOWN) {
      const targetId = findMissileTarget(_dronePos, _droneForward);
      const missileId = `drone-missile-${Date.now()}`;
      setMissiles(prev => [...prev, {
        id: missileId,
        pos: [_dronePos.x + _droneForward.x * 1.4, _dronePos.y + _droneForward.y * 1.4, _dronePos.z + _droneForward.z * 1.4],
        vel: [_droneForward.x * 8, _droneForward.y * 8, _droneForward.z * 8],
        targetId,
      }]);
      lastMissileTime.current = state.clock.elapsedTime * 1000;
    }

    // 'fly' (B) hands control back to the player -- Player.tsx's own
    // parked (!isPlayerActive) branch is what actually calls
    // setCurrentControllable('player') for the symmetric "take control"
    // side, but that branch returns immediately for the drone case (no
    // seats/doors to walk through), so it can't ALSO read input here --
    // handled directly in this component instead, same idea as Car.tsx's
    // exit being driven from Player.tsx: whichever component is the one
    // actually running its own useInput() for the currently-active seat
    // is the one that reads the toggle.
    if (flyPressed) {
      setIsDrone(false);
      useStore.getState().setCurrentControllable('player');
    }
  });

  return (
    <RigidBody
      ref={ref}
      name={DRONE_ID}
      type="dynamic"
      colliders={false}
      position={initialPos}
      gravityScale={0}
      linearDamping={0}
      angularDamping={0}
      collisionGroups={groupsExcluding(CollisionGroups.Default, CollisionGroups.Characters)}
    >
      <BallCollider args={[0.6]} mass={2} friction={0.2} restitution={0} />
      <group ref={meshGroupRef}>
        <group rotation={DRONE_MODEL_ROTATION} scale={DRONE_MODEL_SCALE}>
          <primitive object={clonedScene} />
        </group>
      </group>
      {bullets.map(b => (
        <Bullet key={b.id} id={b.id} position={b.pos} velocity={b.vel} owner="player" onKill={removeBullet} />
      ))}
      {missiles.map(m => (
        <Missile key={m.id} id={m.id} position={m.pos} initialVelocity={m.vel} targetId={m.targetId} onKill={removeMissile} />
      ))}
    </RigidBody>
  );
};

export default Drone;
