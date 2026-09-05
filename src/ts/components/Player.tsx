import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useSphere } from "@react-three/cannon";
import { useGLTF, useAnimations } from "@react-three/drei";
import * as THREE from "three";
import { SkeletonUtils } from "three-stdlib";
import { useInput } from "../hooks/useInput";
import { useNetwork } from "../hooks/useNetwork";
import { useStore } from "../store";
import { useShallow } from "zustand/react/shallow";
import { getTerrainHeight } from "./Environment/Terrain";
import { getRoadOffset } from "./Environment/Road";
import { CollisionGroups } from "../enums/CollisionGroups";
import NetworkPlayer from "./NetworkPlayer";
import SpeechBubble from "./UI/SpeechBubble";
import Bullet from "./Bullet";

// -- Vehicle seat/entrance lookup -------------------------------------------
// Every vehicle glb (car/airplane/heli) ships the same authored empties the
// original (non-React) Sketchbook used for its VehicleSeat/entry points --
// "seat_1", "entrance_1", etc. -- as real named nodes. We only support one
// (driver) seat per vehicle here, so we always use the "_1" pair; falling
// back to the vehicle's own root transform keeps this from silently
// breaking if a model is ever missing them.
interface VehicleParts {
  root: THREE.Object3D;
  seat: THREE.Object3D;
  entrance: THREE.Object3D;
}

const getVehicleParts = (scene: THREE.Object3D, vehicleId: string): VehicleParts | null => {
  const root = scene.getObjectByName(vehicleId);
  if (!root) return null;
  const seat = root.getObjectByName("seat_1") ?? root;
  const entrance = root.getObjectByName("entrance_1") ?? seat;
  return { root, seat, entrance };
};

// Mirrors the original's FunctionLibrary.detectRelativeSide(): which side of
// `fromPos`/`fromQuat` the point `toPos` is on, using its local right axis.
// Used to pick the left/right sit-down, stand-up and door animations.
const sideOf = (fromPos: THREE.Vector3, fromQuat: THREE.Quaternion, toPos: THREE.Vector3): "left" | "right" => {
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(fromQuat);
  const view = toPos.clone().sub(fromPos).normalize();
  return right.dot(view) > 0 ? "left" : "right";
};

const _networkYAxis = new THREE.Vector3(0, 1, 0);
const _networkQuat = new THREE.Quaternion();

type VehicleType = "car" | "airplane" | "helicopter";

interface VehicleTransition {
  mode: "entering" | "exiting";
  vehicleId: string;
  vehicleType: VehicleType;
  t: number;
  duration: number;
  startPos: THREE.Vector3;
  startQuat: THREE.Quaternion;
  anim: string;
  // Only set for "exiting": the estimated velocity to hand back to the
  // player's body on completion, same idea as the original copying the
  // vehicle's chassis velocity onto the character when it detaches.
  exitVelocity: THREE.Vector3;
}

const Player: React.FC<{ userName: string }> = ({ userName }) => {
  const input = useInput();
  const { scene, animations } = useGLTF("boxman.glb");
  const clonedScene = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { actions } = useAnimations(animations, clonedScene);
  const {
    currentControllable,
    controlledEntityId,
    setCurrentControllable,
    isVehicleTransitioning,
    setIsVehicleTransitioning,
    setPlayerInfo,
    playerMessage,
    entities,
    setIsLoading,
  } = useStore(
    useShallow((state) => ({
      currentControllable: state.currentControllable,
      controlledEntityId: state.controlledEntityId,
      setCurrentControllable: state.setCurrentControllable,
      isVehicleTransitioning: state.isVehicleTransitioning,
      setIsVehicleTransitioning: state.setIsVehicleTransitioning,
      setPlayerInfo: state.setPlayerInfo,
      playerMessage: state.playerMessage,
      entities: state.entities,
      setIsLoading: state.setIsLoading,
    }))
  );

  useEffect(() => {
    if (scene) setIsLoading(false);
  }, [scene, setIsLoading]);

  const [posState, setPosState] = useState<[number, number, number]>([0, 5, 0]);
  const [quatState, setQuatState] = useState<number[]>([0, 0, 0, 1]);
  const [currentAnim, setCurrentAnim] = useState("idle");
  const currentAnimRef = useRef("idle");

  const [bullets, setBullets] = useState<{ id: string, pos: [number, number, number], vel: [number, number, number] }[]>([]);
  const lastFireTime = useRef(0);

  const { remotePlayers, sendChatMessage } = useNetwork(userName, posState, quatState, currentAnim);

  // Professional Constants
  const RUN_SPEED = 8;
  const SPRINT_SPEED = RUN_SPEED * 1.8;
  const JUMP_FORCE = 8.5;
  // How long (seconds) isGrounded is forced false right after a jump, to
  // outlast the ~1-frame latency of the @react-three/cannon worker (see
  // jumpLockout below for why this exists).
  const JUMP_LOCKOUT_TIME = 0.15;
  const RADIUS = 0.5; // Slightly larger for smoother stepping

  // Fallback clip lengths, only used for a frame or two if the GLTF
  // animations haven't finished loading yet when these are first read.
  const FALLBACK_JUMP_ANIM_DURATION = 0.35;
  const FALLBACK_LANDING_ANIM_DURATION = 0.3;

  // Vertical ground-snapping gains. These are the sole authority over the
  // character's Y position while grounded (see collisionFilterMask below),
  // so they can stay gentle: there is no physics contact response fighting
  // them anymore. MAX_SNAP_SPEED clamps a single frame's correction so a
  // large one-off height error (e.g. right after landing) can't overshoot
  // and ring across the ~1-frame latency of the @react-three/cannon worker.
  const GROUND_SNAP_FORCE_IDLE = 12;
  const GROUND_SNAP_FORCE_MOVING = 16;
  // Kept well below JUMP_FORCE: a fast landing can momentarily read a
  // sizeable heightError (the sphere can sink a bit past the ground before
  // the next physics report catches up), and clamping it too high let that
  // one-frame correction rebound the character upward almost as hard as an
  // actual jump -- i.e. what looked like "another jump" right on landing.
  const MAX_SNAP_SPEED = 6;

  // Vehicle entry/exit. VEHICLE_SEARCH_RADIUS mirrors the original's
  // ClosestObjectFinder(this.position, 10) for picking the nearest vehicle;
  // VEHICLE_ENTRANCE_RANGE additionally requires being close to its actual
  // door (the original instead auto-walks the character to the door, which
  // this port doesn't do, so we ask the player to walk up themselves).
  const VEHICLE_SEARCH_RADIUS = 10;
  const VEHICLE_ENTRANCE_RANGE = 3.5;
  const VEHICLE_ENTER_DURATION = 0.45;
  const VEHICLE_EXIT_DURATION = 0.4;

  const [ref, api] = useSphere<THREE.Group>(() => ({
    mass: 1,
    position: [0, 15, 0],
    args: [RADIUS],
    fixedRotation: true,
    linearDamping: 0,
    material: "slippery",
    collisionFilterGroup: CollisionGroups.Characters,
    // Everything except TrimeshColliders (terrain + roads): the character's
    // vertical position on the ground is driven entirely by the analytic
    // getTerrainHeight/getRoadOffset functions below, not by physics contact.
    // Letting the sphere also collide with the (much coarser) terrain
    // heightfield/road trimesh made the contact solver fight the manual
    // ground-snap every frame -- two independent, disagreeing corrections
    // to the same Y coordinate -- which is what caused the jitter/bouncing
    // on the ground after the React port. Collision with characters,
    // vehicles and buildings (all other groups) is unaffected.
    collisionFilterMask: ~CollisionGroups.TrimeshColliders,
  }));

  const velocity = useRef([0, 0, 0]);
  useEffect(() => api.velocity.subscribe((v) => (velocity.current = v)), [api.velocity]);

  const position = useRef([0, 0, 0]);
  useEffect(() => api.position.subscribe((p) => (position.current = p)), [api.position]);

  const modelRotation = useRef(0);
  const isGrounded = useRef(true);
  // Counts down after a jump. While > 0, isGrounded is forced false so the
  // ground-snap branch below (step 3) cannot immediately reassert itself
  // and cancel the jump before the body has visibly left the ground.
  const jumpLockout = useRef(0);

  // -- Flight-phase state machine, modeled on the original (non-React)
  // Sketchbook's character states: Idle/Walk -> JumpIdle/JumpRunning or
  // Falling -> DropIdle/DropRunning/DropRolling (see character_states/).
  // That version changes animation on discrete EVENTS (jumped, landed, a
  // clip finished playing) rather than by re-classifying a raw, one-frame-
  // lagged velocity every frame. The latter is what produced two bugs here:
  // grounded/airborne fighting itself, and a gap between the "rising" and
  // "falling" velocity bands that made the character drop back into its
  // ground pose mid-arc (looked like a second jump).
  const wasGrounded = useRef(true);
  const airPhase = useRef<"grounded" | "jumping" | "falling">("grounded");
  const airPhaseTimer = useRef(0);
  const airJumpClip = useRef<"jump_idle" | "jump_running">("jump_idle");
  // Landing-recovery pose, picked from the impact speed the same way the
  // original's setAppropriateDropState() does; plays once, then clears.
  const landingAnim = useRef<string | null>(null);
  const landingAnimTimer = useRef(0);

  // -- Vehicle entry/exit. vehicleTransition drives the walk-to-seat /
  // stand-up-and-leave lerp (see the original's EnteringVehicle/
  // ExitingVehicle character states); transitionMode is the same
  // information mirrored into React state purely so the player mesh's
  // `visible` prop (below) re-renders at the right moments -- refs alone
  // don't trigger a render, and we want the character to stay visible
  // through the "exiting" animation instead of popping in only at the end.
  const vehicleTransition = useRef<VehicleTransition | null>(null);
  const [transitionMode, setTransitionMode] = useState<"entering" | "exiting" | null>(null);
  // While parked in a vehicle (not transitioning), tracks the seat's world
  // position frame to frame so we can estimate the vehicle's velocity and
  // hand it to the player's body on exit -- same idea as the original
  // copying vehicle.chassisBody.velocity onto the character when it
  // detaches, so hopping out of a moving car keeps your momentum.
  const lastSeatPos = useRef<THREE.Vector3 | null>(null);
  const seatVelocityEstimate = useRef(new THREE.Vector3());


  const playAnim = (name: string) => {
    if (currentAnimRef.current === name) return;
    currentAnimRef.current = name;
    setCurrentAnim(name);
    Object.values(actions).forEach((action) => action?.fadeOut(0.1));
    if (actions[name]) actions[name].reset().fadeIn(0.1).play();
  };

  // Real clip length when it's loaded, otherwise a sane fallback -- mirrors
  // animationEnded()/this.animationLength in the original character states.
  const clipDuration = (name: string, fallback: number): number => {
    const clip = actions[name]?.getClip();
    return clip ? clip.duration : fallback;
  };

  const removeBullet = useCallback((id: string) => {
    setBullets(prev => prev.filter(b => b.id !== id));
  }, []);

  useFrame((state, delta) => {
    if (!ref.current || !clonedScene) return;

    const isPlayerActive = currentControllable === "player";

    // -- Vehicle entering/exiting transition. Runs regardless of who
    // nominally "has control": during "entering" that's still the player
    // (control only hands over to the vehicle once the character has sat
    // down); during "exiting" it's still the vehicle (control only hands
    // back once the character has stood up and stepped out).
    const transition = vehicleTransition.current;
    if (transition) {
      transition.t += delta;
      const factor = THREE.MathUtils.clamp(transition.t / transition.duration, 0, 1);
      const eased = -(Math.cos(Math.PI * factor) - 1) / 2; // easeInOutSine, same as the original

      const parts = getVehicleParts(state.scene, transition.vehicleId);
      const targetPos = new THREE.Vector3();
      const targetQuat = new THREE.Quaternion();
      if (parts) {
        const targetObj = transition.mode === "entering" ? parts.seat : parts.entrance;
        targetObj.getWorldPosition(targetPos);
        targetObj.getWorldQuaternion(targetQuat);
      }

      const lerpPos = new THREE.Vector3().lerpVectors(transition.startPos, targetPos, eased);
      api.position.set(lerpPos.x, lerpPos.y, lerpPos.z);
      api.velocity.set(0, 0, 0);

      const lerpQuat = new THREE.Quaternion().slerpQuaternions(transition.startQuat, targetQuat, eased);
      modelRotation.current = new THREE.Euler().setFromQuaternion(lerpQuat, "YXZ").y;

      playAnim(transition.anim);
      setPlayerInfo([lerpPos.x, lerpPos.y, lerpPos.z], modelRotation.current);

      if (factor >= 1) {
        if (transition.mode === "entering") {
          setCurrentControllable(transition.vehicleType, transition.vehicleId);
        } else {
          api.velocity.set(transition.exitVelocity.x, transition.exitVelocity.y, transition.exitVelocity.z);
          setCurrentControllable("player");
          // Force the next real ground check to treat this as a fresh
          // landing (see the airPhase machine below) instead of leaving
          // the character stuck in "falling" forever, or skipping the
          // landing-recovery pose it would otherwise be entitled to.
          wasGrounded.current = false;
          airPhase.current = "falling";
          airPhaseTimer.current = 0;
        }
        vehicleTransition.current = null;
        setIsVehicleTransitioning(false);
        setTransitionMode(null);
      }
      return;
    }

    if (!isPlayerActive) {
      // Parked inside a vehicle: follow the seat every frame so the
      // invisible body doesn't get left behind wherever it was boarded --
      // and, since it no longer collides with the ground (see
      // collisionFilterMask above), doesn't just fall forever either. This
      // is a pragmatic stand-in for the original literally attaching the
      // character to the vehicle's transform while seated.
      if (controlledEntityId) {
        const parts = getVehicleParts(state.scene, controlledEntityId);
        if (parts) {
          const seatPos = new THREE.Vector3();
          parts.seat.getWorldPosition(seatPos);
          api.position.set(seatPos.x, seatPos.y, seatPos.z);

          if (lastSeatPos.current && delta > 0) {
            seatVelocityEstimate.current
              .copy(seatPos)
              .sub(lastSeatPos.current)
              .divideScalar(delta);
          }
          lastSeatPos.current = seatPos;
        }
      }
      api.velocity.set(0, 0, 0);

      if (input.consumeJustPressed("enter") && controlledEntityId) {
        const parts = getVehicleParts(state.scene, controlledEntityId);
        if (parts) {
          const startPos = new THREE.Vector3();
          parts.seat.getWorldPosition(startPos);
          const startQuat = new THREE.Quaternion();
          parts.seat.getWorldQuaternion(startQuat);
          const entrancePos = new THREE.Vector3();
          parts.entrance.getWorldPosition(entrancePos);
          const side = sideOf(startPos, startQuat, entrancePos);

          vehicleTransition.current = {
            mode: "exiting",
            vehicleId: controlledEntityId,
            vehicleType: currentControllable as VehicleType,
            t: 0,
            duration: VEHICLE_EXIT_DURATION,
            startPos,
            startQuat,
            anim: side === "left" ? "stand_up_left" : "stand_up_right",
            exitVelocity: seatVelocityEstimate.current.clone(),
          };
          setIsVehicleTransitioning(true, controlledEntityId);
          setTransitionMode("exiting");
        }
      }
      return;
    }

    lastSeatPos.current = null;

    // Vehicle entry: find the nearest vehicle within reach of its door.
    // Two-stage search mirrors the original's findVehicleToEnter() --
    // nearest vehicle overall, then nearest entry point on it -- except the
    // original then auto-walks the character to the door; this port
    // requires the player to already be standing next to it.
    if (input.consumeJustPressed("enter")) {
      const playerPos = new THREE.Vector3(position.current[0], position.current[1], position.current[2]);
      let closestId: string | null = null;
      let closestType: VehicleType | null = null;
      let closestDist = VEHICLE_SEARCH_RADIUS;
      entities.forEach((e) => {
        if (e.type !== "car" && e.type !== "airplane" && e.type !== "helicopter") return;
        const d = playerPos.distanceTo(new THREE.Vector3(...e.position));
        if (d < closestDist) {
          closestDist = d;
          closestId = e.id;
          closestType = e.type as VehicleType;
        }
      });

      if (closestId && closestType) {
        const parts = getVehicleParts(state.scene, closestId);
        if (parts) {
          const entrancePos = new THREE.Vector3();
          parts.entrance.getWorldPosition(entrancePos);
          if (playerPos.distanceTo(entrancePos) < VEHICLE_ENTRANCE_RANGE) {
            const entranceQuat = new THREE.Quaternion();
            parts.entrance.getWorldQuaternion(entranceQuat);
            const seatPos = new THREE.Vector3();
            parts.seat.getWorldPosition(seatPos);
            const side = sideOf(entrancePos, entranceQuat, seatPos);

            vehicleTransition.current = {
              mode: "entering",
              vehicleId: closestId,
              vehicleType: closestType,
              t: 0,
              duration: VEHICLE_ENTER_DURATION,
              startPos: playerPos.clone(),
              startQuat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), modelRotation.current),
              anim: side === "left" ? "sit_down_left" : "sit_down_right",
              exitVelocity: new THREE.Vector3(),
            };
            setIsVehicleTransitioning(true, closestId);
            setTransitionMode("entering");
            return;
          }
        }
      }
    }

    // 1. Camera-Relative Input. Computed before the ground analysis below
    // because the landing-recovery pick needs to know whether a movement
    // key is held, exactly like the original's setAppropriateDropState().
    const forward = new THREE.Vector3();
    state.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), forward).normalize();

    const moveDir = new THREE.Vector3(0, 0, 0);
    if (input.forward) moveDir.add(forward);
    if (input.backward) moveDir.add(forward.clone().negate());
    if (input.left) moveDir.add(right.clone().negate());
    if (input.right) moveDir.add(right);

    const isMoving = moveDir.lengthSq() > 0.001;
    let finalVel = new THREE.Vector3(0, 0, 0);

    if (isMoving) {
      moveDir.normalize();
      const speed = input.shift ? SPRINT_SPEED : RUN_SPEED;
      finalVel.copy(moveDir).multiplyScalar(speed);

      const targetRotation = Math.atan2(moveDir.x, moveDir.z);
      let diff = targetRotation - modelRotation.current;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      modelRotation.current += diff * 0.2;
    }

    // 2. Precise Ground & Slope Analysis
    if (jumpLockout.current > 0) jumpLockout.current = Math.max(0, jumpLockout.current - delta);

    const wasGroundedPrev = wasGrounded.current;
    // Vertical speed as last reported, i.e. right before landing -- used
    // below to pick the landing-recovery pose.
    const impactVelocity = velocity.current[1];

    // groundY includes the road surface offset, so walking over a road tile
    // doesn't leave the character sunk into the (slightly lower) bare terrain.
    const terrainY = getTerrainHeight(position.current[0], position.current[2]);
    const groundY = terrainY + getRoadOffset(position.current[0], position.current[2]);
    const distToGround = position.current[1] - (groundY + RADIUS);
    // jumpLockout keeps this false for a short window after a jump: position
    // and velocity here come from an async worker subscription (see the
    // api.velocity / api.position subscriptions above) that lags by roughly
    // a frame, so right after commanding the jump this can still read as
    // "grounded" for a frame or two and fall straight back into the step-3
    // ground-snap branch, which would zero the jump out before it ever left
    // the ground.
    isGrounded.current = jumpLockout.current <= 0 && distToGround < 0.3 && velocity.current[1] < 2.0;
    wasGrounded.current = isGrounded.current;

    if (wasGroundedPrev && !isGrounded.current && airPhase.current === "grounded") {
        // Left the ground without a jump this frame -- walked off a ledge.
        // Go straight to the falling pose, same as fallInAir() originally.
        airPhase.current = "falling";
        airPhaseTimer.current = 0;
    }
    if (!wasGroundedPrev && isGrounded.current) {
        // Just landed. Pick a recovery pose from the impact speed, same
        // thresholds as the original's setAppropriateDropState().
        airPhase.current = "grounded";
        if (impactVelocity < -6) {
            landingAnim.current = "drop_running_roll";
        } else if (isMoving) {
            landingAnim.current = impactVelocity < -2 ? "drop_running" : null;
        } else {
            landingAnim.current = "drop_idle";
        }
        landingAnimTimer.current = landingAnim.current
            ? clipDuration(landingAnim.current, FALLBACK_LANDING_ANIM_DURATION)
            : 0;
    }

    // Estimate slope normal
    const eps = 0.15;
    const hX = getTerrainHeight(position.current[0] + eps, position.current[2]) - getTerrainHeight(position.current[0] - eps, position.current[2]);
    const hZ = getTerrainHeight(position.current[0], position.current[2] + eps) - getTerrainHeight(position.current[0], position.current[2] - eps);
    const terrainNormal = new THREE.Vector3(-hX, 2 * eps, -hZ).normalize();

    // 3. Ground movement: slope-projected horizontal velocity + vertical snap.
    // The sphere no longer receives contact response from the ground (see
    // collisionFilterMask above), so this snap is the only thing placing the
    // character vertically while grounded -- nothing else contests it.
    let yVel = velocity.current[1];

    if (isGrounded.current) {
        // PROJECT movement onto slope normal to maintain speed uphill
        const dot = finalVel.dot(terrainNormal);
        finalVel.sub(terrainNormal.clone().multiplyScalar(dot));

        if (input.consumeJustPressed('jump')) {
            yVel = JUMP_FORCE;
            jumpLockout.current = JUMP_LOCKOUT_TIME;
            airPhase.current = "jumping";
            airPhaseTimer.current = 0;
            airJumpClip.current = isMoving ? "jump_running" : "jump_idle";
        } else {
            const targetY = groundY + RADIUS;
            const currentY = position.current[1];
            const heightError = targetY - currentY;
            const snapForce = isMoving ? GROUND_SNAP_FORCE_MOVING : GROUND_SNAP_FORCE_IDLE;
            yVel = THREE.MathUtils.clamp(heightError * snapForce, -MAX_SNAP_SPEED, MAX_SNAP_SPEED);
        }
    } else {
        // Air control
        finalVel.x = THREE.MathUtils.lerp(velocity.current[0], finalVel.x, 0.05);
        finalVel.z = THREE.MathUtils.lerp(velocity.current[2], finalVel.z, 0.05);
    }

    // Apply Physics
    api.velocity.set(finalVel.x, yVel, finalVel.z);

    // 4. Combat logic
    if (input.primary && state.clock.elapsedTime * 1000 - lastFireTime.current > 200) {
        const bulletId = `bullet-${Date.now()}`;
        const bDir = new THREE.Vector3(Math.sin(modelRotation.current), 0, Math.cos(modelRotation.current));
        setBullets(prev => [...prev, {
            id: bulletId,
            pos: [position.current[0] + bDir.x * 0.5, position.current[1] + 0.2, position.current[2] + bDir.z * 0.5],
            vel: [bDir.x * 50, 0, bDir.z * 50]
        }]);
        lastFireTime.current = state.clock.elapsedTime * 1000;
    }

    // 5. Animation selection, driven by the flight-phase state machine
    // above instead of re-classifying raw velocity every frame.
    let nextAnim = "idle";
    const hSpeed = new THREE.Vector2(velocity.current[0], velocity.current[2]).length();

    if (airPhase.current === "jumping") {
        airPhaseTimer.current += delta;
        nextAnim = airJumpClip.current;
        // Hand off to the falling pose once the takeoff clip has played out,
        // exactly like JumpIdle/JumpRunning transitioning to Falling when
        // their animation ends -- not once velocity crosses some threshold.
        if (airPhaseTimer.current >= clipDuration(airJumpClip.current, FALLBACK_JUMP_ANIM_DURATION)) {
            airPhase.current = "falling";
            airPhaseTimer.current = 0;
        }
    } else if (airPhase.current === "falling") {
        nextAnim = "falling";
    } else if (landingAnim.current && landingAnimTimer.current > 0) {
        landingAnimTimer.current -= delta;
        nextAnim = landingAnim.current;
        if (landingAnimTimer.current <= 0) landingAnim.current = null;
    } else if (hSpeed > 0.5) {
        nextAnim = hSpeed > RUN_SPEED * 1.3 ? "sprint" : "run";
    }
    playAnim(nextAnim);

    // 6. Network & Store
    setPlayerInfo([position.current[0], position.current[1], position.current[2]], modelRotation.current);

    if (state.clock.getElapsedTime() % 0.05 < 0.02) {
        setPosState([position.current[0], position.current[1], position.current[2]]);
        _networkQuat.setFromAxisAngle(_networkYAxis, modelRotation.current);
        setQuatState([_networkQuat.x, _networkQuat.y, _networkQuat.z, _networkQuat.w]);
    }
  });

  return (
    <>
      <group
        ref={ref}
        name="player"
        visible={currentControllable === "player" || transitionMode === "exiting"}
      >
        <group rotation={[0, modelRotation.current, 0]}>
          <primitive object={clonedScene} position={[0, -RADIUS, 0]} />
        </group>
        <SpeechBubble message={playerMessage} position={[0, 1.2, 0]} />
      </group>
      {Array.from(remotePlayers.values()).map((p) => (
        <NetworkPlayer key={p.id} data={p} />
      ))}
      {bullets.map(b => (
        <Bullet key={b.id} id={b.id} position={b.pos} velocity={b.vel} onKill={removeBullet} />
      ))}
    </>
  );
};

export default Player;
