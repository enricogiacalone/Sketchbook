import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useSphere } from "@react-three/cannon";
import { useGLTF, useAnimations } from "@react-three/drei";
import * as THREE from "three";
import { SkeletonUtils } from "three-stdlib";
import { useInput } from "../hooks/useInput";
import { useNetwork } from "../hooks/useNetwork";
import { useStore } from "../store";
import { getTerrainHeight } from "./Environment/Terrain";
import { getRoadOffset } from "./Environment/Road";
import { CollisionGroups } from "../enums/CollisionGroups";
import NetworkPlayer from "./NetworkPlayer";
import SpeechBubble from "./UI/SpeechBubble";
import Bullet from "./Bullet";

const Player: React.FC<{ userName: string }> = ({ userName }) => {
  const input = useInput();
  const { scene, animations } = useGLTF("boxman.glb");
  const clonedScene = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { actions } = useAnimations(animations, clonedScene);
  const { currentControllable, setCurrentControllable, setPlayerInfo, playerMessage, entities, setIsLoading } = useStore();

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

  const prevControllable = useRef(currentControllable);

  useFrame((state, delta) => {
    const isPlayerActive = currentControllable === "player";
    const wasPlayerActive = prevControllable.current === "player";
    prevControllable.current = currentControllable;

    if (!ref.current || !clonedScene || !isPlayerActive) {
      api.velocity.set(0, velocity.current[1], 0);
      return;
    }

    // Vehicle Entry Logic - Only if we were already the player
    if (wasPlayerActive && input.consumeJustPressed('enter')) {
        const pPos = new THREE.Vector3(position.current[0], 0, position.current[2]);
        entities.forEach((e) => {
          if (['car', 'airplane', 'helicopter'].includes(e.type)) {
            // Check 2D distance for easier entry
            if (pPos.distanceTo(new THREE.Vector3(e.position[0], 0, e.position[2])) < 8) {
              setCurrentControllable(e.type as any, e.id);
            }
          }
        });
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
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), modelRotation.current);
        setQuatState([q.x, q.y, q.z, q.w]);
    }
  });

  return (
    <>
      <group ref={ref} name="player" visible={currentControllable === "player"}>
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
