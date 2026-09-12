import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { useFrame, useThree, createPortal } from "@react-three/fiber";
import { RigidBody, BallCollider, RapierRigidBody } from "@react-three/rapier";
import { useGLTF, useAnimations } from "@react-three/drei";
import * as THREE from "three";
import { SkeletonUtils } from "three-stdlib";
import { useInput } from "../hooks/useInput";
import { useNetwork } from "../hooks/useNetwork";
import { useStore } from "../store";
import { useShallow } from "zustand/react/shallow";
import { getTerrainHeight } from "./Environment/Terrain";
import { getRoadOffset } from "./Environment/Road";
import { getBuildingHeightOffset } from "./Environment/City";
import { CollisionGroups, groupsExcluding } from "../enums/CollisionGroups";
import NetworkPlayer from "./NetworkPlayer";
import SpeechBubble from "./UI/SpeechBubble";
import Bullet from "./Bullet";

// -- Vehicle seat/entrance lookup -------------------------------------------
// Every vehicle glb (car/airplane/heli) ships the same authored empties the
// original (non-React) Sketchbook used for its VehicleSeat/entry points --
// "seat_1", "entrance_1", etc. -- as real named nodes. This always resolves
// the driver's own "_1" pair specifically (used for e.g. the default enter
// door-search below and the vehicle-velocity estimate, which is fine off
// any point on a rigid body); OTHER seats (passenger seat_2/3/4, their own
// entry/exit points, doors, connected_seats for X-switching) are looked up
// separately, by name, via getSeatInfo() further down -- falling back to
// the vehicle's own root transform here keeps this from silently breaking
// if a model is ever missing seat_1/entrance_1 specifically.
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

// -- Seat metadata straight off the glb's own authored data (see
// VehicleSeat.ts in the legacy source this ports from): userData.seat_type
// ("driver"/"passenger"), .door_object (this seat's own door, if it has
// one), .connected_seats (the seat X-switches to -- see the seat_switch
// handling in Player) and .entry_points (the point this seat's occupant
// walks out through when exiting, which may differ from the entrance they
// walked IN through). Confirmed straight from car.glb/heli.glb's own node
// extras -- airplane.glb only has a single driver seat, no passengers/
// connected_seats/door, matching its own distinct entry/exit handling
// elsewhere in this file.
type OccupantSeatKind = "driver" | "passenger";

interface VehicleSeatInfo {
  name: string;
  node: THREE.Object3D;
  kind: OccupantSeatKind;
  doorName: string | null;
  connectedSeatName: string | null;
  entryPointName: string | null;
}

const getSeatInfo = (root: THREE.Object3D, seatName: string): VehicleSeatInfo | null => {
  const node = root.getObjectByName(seatName);
  if (!node) return null;
  const ud = (node.userData ?? {}) as Record<string, string | undefined>;
  const kind: OccupantSeatKind = ud.seat_type === "driver" ? "driver" : "passenger";
  const doorName = ud.door_object ?? null;
  const connectedSeatName = ud.connected_seats ? (ud.connected_seats.split(/[;,]/)[0]?.trim() || null) : null;
  const entryPointName = ud.entry_points ? (ud.entry_points.split(/[;,]/)[0]?.trim() || null) : null;
  return { name: seatName, node, kind, doorName, connectedSeatName, entryPointName };
};

// Faithful port of the legacy Character.ts's findVehicleToEnter(wantsToDrive)
// -- given ONE already-chosen vehicle (the closest one overall, picked by
// the caller) and the player's intent, finds the best SEAT for it, then the
// nearest of THAT seat's own entry points (a seat can have more than one,
// e.g. the airplane's "entrance_1;entrance_2"):
//  - wantsToDrive: only driver seats, OR a passenger seat whose
//    connected_seats points at a driver seat -- e.g. car.glb's seat_2 (a
//    passenger seat you can X-switch to the driver's seat_1 from), but NOT
//    seat_3/seat_4 (only connected to each other). Walking in from the
//    passenger side while wanting to drive is still valid, faithfully --
//    see autoSwitchToDriverOnArrival below, which then auto-slides you
//    into the driver's seat the instant you've sat down, exactly like
//    Sitting.ts's own continuous wantsToDrive check.
//  - !wantsToDrive: any passenger seat, no connection requirement.
// Deliberately reverted from an earlier, simpler "every door makes you
// drive" divergence -- confirmed with the user that the original's real
// per-seat logic (rear doors NOT reachable for driving-intent unless
// connected to the driver's seat) is what's wanted here, not the shortcut.
const findSeatAndEntry = (
  root: THREE.Object3D,
  playerPos: THREE.Vector3,
  wantsToDrive: boolean
): { seat: VehicleSeatInfo; entry: THREE.Object3D } | null => {
  // Legacy picks the best SEAT first (by seat position) and only then its
  // own nearest entry point -- fine there, since the character then
  // auto-walks the whole way to it. This port has no auto-walk (the player
  // must already be standing next to the door), so picking by seat
  // proximity first can pick the WRONG entry point whenever two qualifying
  // seats sit close together but their doors are on opposite sides (e.g.
  // heli.glb's side-by-side seat_1/seat_2 cockpit) -- the player ends up
  // standing right next to a perfectly valid door that this rejects anyway,
  // because the "closer" seat's own (far away) door is what actually got
  // checked (see git history / chat: "non riesco ad entrare
  // nell'elicottero"). So instead: gather every entry point of every
  // QUALIFYING seat (same qualification rule as legacy) and pick whichever
  // single entry point is nearest to the player -- still only lets
  // wantsToDrive land in the driver's seat or one connected to it, just
  // decided by which door you're actually standing at, not by seat
  // geometry the player never sees.
  let bestSeat: VehicleSeatInfo | null = null;
  let bestEntry: THREE.Object3D | null = null;
  let bestEntryDist = Infinity;

  for (let i = 1; i <= 4; i++) {
    const seat = getSeatInfo(root, `seat_${i}`);
    if (!seat) continue;

    let qualifies: boolean;
    if (wantsToDrive) {
      if (seat.kind === "driver") {
        qualifies = true;
      } else {
        const connected = seat.connectedSeatName ? getSeatInfo(root, seat.connectedSeatName) : null;
        qualifies = connected?.kind === "driver";
      }
    } else {
      qualifies = seat.kind === "passenger";
    }
    if (!qualifies) continue;

    // All of this seat's own entry point names -- getSeatInfo only keeps
    // the first (the common single-entry case), so re-read the raw list
    // here (a seat can have more than one, e.g. the airplane's
    // "entrance_1;entrance_2").
    const ud = (seat.node.userData ?? {}) as Record<string, string | undefined>;
    const entryNames = ud.entry_points ? ud.entry_points.split(/[;,]/).map((n) => n.trim()).filter(Boolean) : [];
    for (const name of entryNames) {
      const node = root.getObjectByName(name);
      if (!node) continue;
      const p = new THREE.Vector3();
      node.getWorldPosition(p);
      const d = playerPos.distanceTo(p);
      if (d < bestEntryDist) {
        bestEntryDist = d;
        bestEntry = node;
        bestSeat = seat;
      }
    }
  }
  if (!bestSeat || !bestEntry) return null;
  return { seat: bestSeat, entry: bestEntry };
};

const _networkYAxis = new THREE.Vector3(0, 1, 0);
const _networkQuat = new THREE.Quaternion();

type VehicleType = "car" | "airplane" | "helicopter";

interface VehicleTransition {
  mode: "entering" | "exiting" | "switching";
  vehicleId: string;
  vehicleType: VehicleType;
  // Name of the glb node the body lerps TO: a seat_N for "entering"/
  // "switching", an entrance_N for "exiting" (see the per-frame block
  // below, which resolves this against the vehicle's own root each frame
  // rather than caching a possibly-stale Object3D reference).
  targetNodeName: string;
  // Driver vs passenger of targetNodeName, read once at setup time (see
  // getSeatInfo) so the completion branch doesn't need to re-look it up,
  // and so it can pick "driving" vs "sitting" as the held pose.
  seatKind: OccupantSeatKind;
  t: number;
  duration: number;
  startPos: THREE.Vector3;
  startQuat: THREE.Quaternion;
  anim: string;
  // Only set for "exiting": the estimated velocity to hand back to the
  // player's body on completion, same idea as the original copying the
  // vehicle's chassis velocity onto the character when it detaches.
  exitVelocity: THREE.Vector3;
  // Only set for "exiting": the seat being vacated and its own door (if
  // any) -- used on completion to decide whether to play the
  // close-door-from-outside animation (see closingDoorOutside below),
  // mirroring the legacy ExitingVehicle.ts handing off to
  // CloseVehicleDoorOutside.
  originSeatName?: string;
  exitDoorName?: string | null;
  // Only set for "entering": true when this entry landed in a passenger
  // seat while wantsToDrive was true (see findSeatAndEntry) -- on arrival,
  // instead of settling into "sitting", immediately queues a "switching"
  // transition into the connected driver seat, mirroring Sitting.ts's own
  // continuous wantsToDrive check auto-triggering SwitchingSeats.
  autoSwitchToDriverOnArrival?: boolean;
}

const Player: React.FC<{ userName: string }> = ({ userName }) => {
  const input = useInput();
  // Named worldScene, not scene -- useGLTF below already claims `scene`
  // for the boxman model's own root object; this is the whole R3F canvas
  // graph, needed at render time (not just inside useFrame, where the
  // callback's own `state.scene` argument already covers it) to find the
  // vehicle's seat node for the seated-passenger portal further down.
  const { scene: worldScene } = useThree();
  const { scene, animations } = useGLTF("boxman.glb");
  const clonedScene = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { actions, mixer, clips } = useAnimations(animations, clonedScene);

  // Upper/lower body split -- "dividiamo il busto dalle gambe... quando
  // corro e sparo deve continuare a correre". The rig's own body_lower/
  // body_upper spine boundary is the natural split point. Two mixer-level
  // problems had to be solved, not just "make two clips":
  //
  // 1. GLTFLoader builds track names via THREE.PropertyBinding.
  //    sanitizeNodeName(boneName), which STRIPS reserved characters --
  //    including the literal "." in Blender's ".L"/".R" suffix convention
  //    (e.g. "arm_upper.L" -> "arm_upperL"). Filtering by the raw bone
  //    names matched nothing for any arm bone (only "head"/"body_upper"
  //    have no dot to strip) -- sanitize the same way before comparing.
  // 2. Simply layering a full-body locomotion action (run/idle/...) UNDER
  //    a separate upper-body-only "shoot" action at weight 1 does NOT
  //    override the arms the way a single playAnim() crossfade does --
  //    three.js's PropertyMixer normalizes by the SUM of all active
  //    weights touching a property (see accumulate()'s `mix = weight /
  //    currentWeight`), so two weight=1 actions on the same bone blend
  //    ~50/50 instead of one winning. That's why the arms sagged toward a
  //    half-idle, half-aim pose ("tiene le mani basse") instead of
  //    reaching the full aim height. The fix: while firing, ALSO swap the
  //    base locomotion action for a LOWER-BODY-only filtered version of
  //    the same clip, so at any moment exactly one action owns the legs
  //    (whichever locomotion clip, lower-filtered) and exactly one owns
  //    the arms/torso/head (the shoot overlay) -- no bone is ever driven
  //    by two weight=1 actions at once.
  const UPPER_BODY_BONES = ["body_upper", "head", "arm_upper.L", "arm_lower.L", "arm_upper.R", "arm_lower.R"];
  const LOWER_BODY_BONES = ["root", "butt_bone", "body_lower", "leg_upper.L", "leg_lower.L", "leg_upper.R", "leg_lower.R"];
  // Every clip name that can appear as `nextAnim` below -- these are the
  // only ones that ever need a lower-body-only stand-in for the
  // while-firing case.
  const LOCOMOTION_CLIP_NAMES = ["idle", "run", "sprint", "jump_idle", "jump_running", "falling", "drop_idle", "drop_running", "drop_running_roll"];
  const ONE_SHOT_LOCOMOTION_NAMES = ["jump_idle", "jump_running", "drop_idle", "drop_running", "drop_running_roll"];

  const shootUpperActionRef = useRef<THREE.AnimationAction | null>(null);
  const lowerActionsRef = useRef<Record<string, THREE.AnimationAction>>({});
  const wasFiringRef = useRef(false);
  const currentPoolRef = useRef<"full" | "lower">("full");

  const filterTracksByBones = (clip: THREE.AnimationClip, bones: string[]) => {
    const sanitized = bones.map((bone) => THREE.PropertyBinding.sanitizeNodeName(bone));
    return clip.tracks.filter((t) => sanitized.some((bone) => t.name.startsWith(bone + ".")));
  };

  useEffect(() => {
    const createdActions: THREE.AnimationAction[] = [];

    const baseShootClip = clips.find((c) => c.name === "shoot");
    let shootAction: THREE.AnimationAction | null = null;
    if (baseShootClip) {
      const upperClip = new THREE.AnimationClip("shoot_upper", baseShootClip.duration, filterTracksByBones(baseShootClip, UPPER_BODY_BONES));
      shootAction = mixer.clipAction(upperClip, clonedScene);
      shootAction.setLoop(THREE.LoopRepeat, Infinity);
      createdActions.push(shootAction);
    }
    shootUpperActionRef.current = shootAction;

    const lowerActions: Record<string, THREE.AnimationAction> = {};
    for (const name of LOCOMOTION_CLIP_NAMES) {
      const base = clips.find((c) => c.name === name);
      if (!base) continue;
      const lowerClip = new THREE.AnimationClip(name + "_lower", base.duration, filterTracksByBones(base, LOWER_BODY_BONES));
      const action = mixer.clipAction(lowerClip, clonedScene);
      if (ONE_SHOT_LOCOMOTION_NAMES.includes(name)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      lowerActions[name] = action;
      createdActions.push(action);
    }
    lowerActionsRef.current = lowerActions;

    return () => {
      createdActions.forEach((action) => {
        action.stop();
        mixer.uncacheClip(action.getClip());
      });
      shootUpperActionRef.current = null;
      lowerActionsRef.current = {};
    };
  }, [clips, mixer, clonedScene]);

  // One-shot transition/action clips need LoopOnce + clampWhenFinished --
  // three.js's AnimationAction defaults to LoopRepeat, which nothing here
  // ever overrode. For clips whose OWN duration is what gates switching
  // away from them (jump/landing, via clipDuration() + a timer below) that
  // mostly went unnoticed since the switch usually happens before the clip
  // would even loop back around. sit_down/stand_up are different: nothing
  // ever calls playAnim() again for as long as you're parked/driving (the
  // seated pose is just supposed to be held), so with no clamp the sit-down
  // motion itself just kept restarting from frame 0 in an endless loop the
  // whole time you were in the car (see git history / chat: "sembra che
  // vada in loop nel sedersit"). Clamping holds the last frame -- the
  // seated/landed pose -- instead of jumping back to frame 0.
  useEffect(() => {
    const oneShotClips = [
      "sit_down_left", "sit_down_right", "stand_up_left", "stand_up_right",
      "enter_airplane_left", "enter_airplane_right",
      "sitting_shift_left", "sitting_shift_right",
      "close_door_sitting_left", "close_door_sitting_right",
      "close_door_standing_left", "close_door_standing_right",
      "jump_idle", "jump_running", "drop_idle", "drop_running", "drop_running_roll",
    ];
    oneShotClips.forEach((name) => {
      const action = actions[name];
      if (!action) return;
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    });
  }, [actions]);
  const {
    currentControllable,
    controlledEntityId,
    controlledSeatName,
    setCurrentControllable,
    isVehicleTransitioning,
    setIsVehicleTransitioning,
    openVehicleDoors,
    setDoorOpen,
    setPlayerInfo,
    playerMessage,
    entities,
    setIsLoading,
    isPaused,
  } = useStore(
    useShallow((state) => ({
      currentControllable: state.currentControllable,
      controlledEntityId: state.controlledEntityId,
      // Which seat (by glb node name) this player currently occupies --
      // null while on foot. Used for seat-switching and the
      // door-close-from-inside logic in the parked block below.
      controlledSeatName: state.controlledSeatName,
      setCurrentControllable: state.setCurrentControllable,
      isVehicleTransitioning: state.isVehicleTransitioning,
      setIsVehicleTransitioning: state.setIsVehicleTransitioning,
      openVehicleDoors: state.openVehicleDoors,
      setDoorOpen: state.setDoorOpen,
      setPlayerInfo: state.setPlayerInfo,
      isPaused: state.isPaused,
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
  // How long (seconds) isGrounded is forced false right after a jump. Kept
  // from the cannon-worker era as a small, harmless safety margin -- with
  // Rapier stepping synchronously on the main thread (see rigidBodyRef
  // below) there's no longer a worker-latency frame to outlast, but a short
  // lockout still protects against the ground-snap branch reasserting
  // itself the instant setLinvel's upward jump velocity is applied, before
  // the body has visibly left the ground.
  const JUMP_LOCKOUT_TIME = 0.15;
  const RADIUS = 0.5; // Slightly larger for smoother stepping

  // Fallback clip lengths, only used for a frame or two if the GLTF
  // animations haven't finished loading yet when these are first read.
  const FALLBACK_JUMP_ANIM_DURATION = 0.35;
  const FALLBACK_LANDING_ANIM_DURATION = 0.3;

  // Vertical ground-snapping gains. These are the sole authority over the
  // character's Y position while grounded (see collisionGroups below), so
  // they can stay gentle: there is no physics contact response fighting
  // them anymore. MAX_SNAP_SPEED clamps a single frame's correction so a
  // large one-off height error (e.g. right after landing) can't overshoot.
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

  // Migrated from @react-three/cannon's useSphere to @react-three/rapier's
  // <RigidBody>/<BallCollider> (see App.tsx for why). lockRotations mirrors
  // cannon's fixedRotation: true (keeps the capsule from tipping over);
  // canSleep={false} mirrors allowSleep: false -- with cannon a sleeping
  // body silently dropped every velocity write, which is exactly what made
  // movement stop working after standing still (see git history); Rapier's
  // setLinvel/setTranslation both take an explicit wakeUp argument (passed
  // true everywhere below) so this would no longer strictly be needed, but
  // it's kept for parity/safety at zero cost. friction/restitution 0 on the
  // collider matches the original's "slippery" cannon Material (see
  // PhysicsManager.ts's characterTrimeshContactMaterial). collisionGroups
  // excludes TrimeshColliders (terrain + roads) for the same reason as
  // before: the character's vertical position on the ground is driven
  // entirely by the analytic getTerrainHeight/getRoadOffset functions
  // below, not by physics contact -- letting the sphere also collide with
  // the (much coarser) terrain heightfield/road trimesh made the contact
  // solver fight the manual ground-snap every frame. Collision with
  // characters, vehicles and buildings (all other groups) is unaffected.
  const rigidBodyRef = useRef<RapierRigidBody>(null);

  // Rapier steps synchronously on the main thread inside useFrame (see
  // App.tsx's <Physics updateLoop="follow">, the default) -- no Web Worker,
  // no postMessage boundary -- so translation()/linvel() are read directly
  // off the rigid body at the top of useFrame below instead of through the
  // ~1-frame-lagged subscription cannon-worker-api needed. position/velocity
  // stay as plain refs purely so the rest of this file (written against
  // that older shape) doesn't need to change.
  const velocity = useRef([0, 0, 0]);
  const position = useRef([0, 0, 0]);

  // TEMP DEBUG (Claude): teleport + live status for testing ground snapping
  // without relying on slow/unreliable simulated key input.
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as any).__teleportPlayer = (x: number, z: number) => {
        rigidBodyRef.current?.setTranslation({ x, y: 20, z }, true);
        rigidBodyRef.current?.setLinvel({ x: 0, y: 0, z: 0 }, true);
      };
      // TEMP DEBUG (Claude): same idea but keeps the given Y instead of
      // always dropping from height -- for quickly repositioning right next
      // to a moving car's live entrance point without waiting out a fall.
      (window as any).__setPlayerPos = (x: number, y: number, z: number) => {
        rigidBodyRef.current?.setTranslation({ x, y, z }, true);
        rigidBodyRef.current?.setLinvel({ x: 0, y: 0, z: 0 }, true);
      };
    }
  }, []);

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
  const [transitionMode, setTransitionMode] = useState<"entering" | "exiting" | "switching" | null>(null);
  // Legacy CloseVehicleDoorInside port: plays while seated/driving, once
  // this seat's own door is open and nobody's pressing a direction (see the
  // parked block below). Purely cosmetic -- doesn't move the body, just
  // switches the held animation for its duration.
  const doorCloseTransition = useRef<{ vehicleId: string; doorName: string; anim: string; t: number; duration: number } | null>(null);
  // Legacy CloseVehicleDoorOutside port: set up at the tail of an
  // "exiting" transition's completion (see the transition block below),
  // plays once back on foot, freezing movement for its duration.
  const closingDoorOutside = useRef<{ vehicleId: string; doorName: string; anim: string; t: number; duration: number } | null>(null);
  // While parked in a vehicle (not transitioning), tracks the seat's world
  // position frame to frame so we can estimate the vehicle's velocity and
  // hand it to the player's body on exit -- same idea as the original
  // copying vehicle.chassisBody.velocity onto the character when it
  // detaches, so hopping out of a moving car keeps your momentum.
  const lastSeatPos = useRef<THREE.Vector3 | null>(null);
  const seatVelocityEstimate = useRef(new THREE.Vector3());


  // `lowerOnly` picks which pool drives this clip: false (normal) plays
  // the full-body clip exactly as authored (natural arm swing during
  // run/idle/jump/...); true plays the LOWER-BODY-only filtered stand-in
  // instead, freeing the arms/torso/head to be driven entirely by the
  // "shoot" overlay with no other action fighting it for those bones (see
  // the big comment above the mixer-building effect for why that fight
  // otherwise happens). Both the name AND the pool have to match the
  // currently-playing one for this to no-op -- switching pools for the
  // SAME clip name (e.g. "run" full -> "run" lower, when firing starts)
  // must still cross-fade.
  const playAnim = (name: string, lowerOnly: boolean = false) => {
    const pool: "full" | "lower" = lowerOnly ? "lower" : "full";
    if (currentAnimRef.current === name && currentPoolRef.current === pool) return;
    currentAnimRef.current = name;
    currentPoolRef.current = pool;
    setCurrentAnim(name);
    Object.values(actions).forEach((action) => action?.fadeOut(0.1));
    Object.values(lowerActionsRef.current).forEach((action) => action?.fadeOut(0.1));
    const targetAction = lowerOnly ? lowerActionsRef.current[name] : actions[name];
    if (targetAction) targetAction.reset().fadeIn(0.1).play();
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
    const body = rigidBodyRef.current;
    if (!body || !clonedScene) return;

    if (import.meta.env.DEV) {
      (window as any).__playerBody = body;
      (window as any).__playerScene = state.scene;
      (window as any).__playerFrameCount = ((window as any).__playerFrameCount || 0) + 1;
      (window as any).__playerInput = { ...input, delta };
      (window as any).__playerModelRotation = modelRotation.current;
    }

    // Synchronous Rapier read (see rigidBodyRef comment above) -- refreshes
    // the position/velocity refs every frame before anything below uses them.
    const t = body.translation();
    const v = body.linvel();
    position.current[0] = t.x;
    position.current[1] = t.y;
    position.current[2] = t.z;
    velocity.current[0] = v.x;
    velocity.current[1] = v.y;
    velocity.current[2] = v.z;

    // Paused: freeze here. Physics's own `paused` prop (App.tsx) already
    // stops the world stepping, but RigidBody setters like setTranslation/
    // setLinvel used below (e.g. the vehicle entry/exit lerp, and the
    // "parked in a vehicle" seat-follow) apply immediately regardless of
    // whether the world is stepping -- so without this, pausing mid-lerp or
    // mid-drive would still let the body keep moving every frame.
    if (isPaused) return;

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
        // "entering"/"switching" lerp to a seat_N; "exiting" lerps to an
        // entrance_N -- both authored at the surface the character's base
        // should rest on (see the RADIUS comment below), so a single named
        // lookup against the vehicle's own root covers all three modes.
        const targetObj = parts.root.getObjectByName(transition.targetNodeName)
          ?? (transition.mode === "exiting" ? parts.entrance : parts.seat);
        targetObj.getWorldPosition(targetPos);
        targetObj.getWorldQuaternion(targetQuat);
        // The RigidBody's origin is the BallCollider's center, but the
        // model is drawn RADIUS below it (see the <primitive> below --
        // same convention as standing on the ground at groundY + RADIUS).
        // seat_1/entrance_1 are authored at the surface the character's
        // base should rest on, so without this the body (and therefore
        // the visible model) ends up RADIUS too low, clipping into the
        // vehicle's floor/seat mesh.
        targetPos.y += RADIUS;
      }

      const lerpPos = new THREE.Vector3().lerpVectors(transition.startPos, targetPos, eased);
      body.setTranslation({ x: lerpPos.x, y: lerpPos.y, z: lerpPos.z }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);

      const lerpQuat = new THREE.Quaternion().slerpQuaternions(transition.startQuat, targetQuat, eased);
      modelRotation.current = new THREE.Euler().setFromQuaternion(lerpQuat, "YXZ").y;

      playAnim(transition.anim);
      setPlayerInfo([lerpPos.x, lerpPos.y, lerpPos.z], modelRotation.current);

      if (factor >= 1) {
        if (
          transition.mode === "entering" &&
          transition.autoSwitchToDriverOnArrival &&
          transition.seatKind === "passenger"
        ) {
          // Landed in a passenger seat while wantsToDrive was true --
          // immediately auto-slide into the connected driver's seat
          // instead of settling into "sitting" at all, mirroring
          // Sitting.ts's own continuous wantsToDrive check triggering
          // SwitchingSeats the instant you've sat down. Queues a new
          // "switching" transition and returns early, skipping the normal
          // cleanup below (a transition is already in flight).
          const partsNow = getVehicleParts(state.scene, transition.vehicleId);
          const fromSeat = partsNow ? getSeatInfo(partsNow.root, transition.targetNodeName) : null;
          const toSeat = partsNow && fromSeat?.connectedSeatName ? getSeatInfo(partsNow.root, fromSeat.connectedSeatName) : null;
          if (partsNow && fromSeat && toSeat) {
            const fromPos = new THREE.Vector3();
            fromSeat.node.getWorldPosition(fromPos);
            fromPos.y += RADIUS;
            const fromQuat = new THREE.Quaternion();
            fromSeat.node.getWorldQuaternion(fromQuat);
            const toPos = new THREE.Vector3();
            toSeat.node.getWorldPosition(toPos);
            const side = sideOf(fromPos, fromQuat, toPos);
            const switchAnim = side === "left" ? "sitting_shift_left" : "sitting_shift_right";

            vehicleTransition.current = {
              mode: "switching",
              vehicleId: transition.vehicleId,
              vehicleType: transition.vehicleType,
              targetNodeName: toSeat.name,
              seatKind: toSeat.kind,
              t: 0,
              duration: clipDuration(switchAnim, 0.5),
              startPos: fromPos,
              startQuat: fromQuat,
              anim: switchAnim,
              exitVelocity: new THREE.Vector3(),
            };
            setIsVehicleTransitioning(true, transition.vehicleId, null);
            setTransitionMode("switching");
            return;
          }
          // No connected driver seat found (shouldn't happen given
          // findSeatAndEntry already required one to set this flag) --
          // fall through and just settle into the passenger seat normally.
          setCurrentControllable(transition.vehicleType, transition.vehicleId, transition.seatKind, transition.targetNodeName);
          playAnim("sitting");
        } else if (transition.mode === "entering" || transition.mode === "switching") {
          setCurrentControllable(transition.vehicleType, transition.vehicleId, transition.seatKind, transition.targetNodeName);
          // Legacy's Driving.ts/Sitting.ts: playAnimation("driving"/
          // "sitting", 0.1) the instant control actually switches (or a
          // seat-switch lands) -- missing this meant the character just
          // stayed frozen on the last frame of sit_down_left/right
          // (clamped, see the oneShotClips comment) for the whole ride
          // instead of holding a proper seated pose. The driver gets the
          // hands-on-wheel "driving" pose (same clip for every vehicle
          // type, matching the legacy Driving state); any other seat just
          // holds "sitting".
          playAnim(transition.seatKind === "driver" ? "driving" : "sitting");
        } else {
          body.setEnabled(true);
          body.setLinvel({ x: transition.exitVelocity.x, y: transition.exitVelocity.y, z: transition.exitVelocity.z }, true);
          setCurrentControllable("player");
          // Force the next real ground check to treat this as a fresh
          // landing (see the airPhase machine below) instead of leaving
          // the character stuck in "falling" forever, or skipping the
          // landing-recovery pose it would otherwise be entitled to.
          wasGrounded.current = false;
          airPhase.current = "falling";
          airPhaseTimer.current = 0;

          // Legacy's ExitingVehicle.ts: only close the door from outside
          // (CloseVehicleDoorOutside) if nobody's already holding a
          // direction key -- if you're in a hurry and walking off, the
          // door is just left open until someone closes it later (matches
          // the original faithfully, quirky as that sounds).
          const stillNoDirection = !input.forward && !input.backward && !input.left && !input.right;
          const partsNow = transition.exitDoorName ? getVehicleParts(state.scene, transition.vehicleId) : null;
          const originSeatNode = partsNow && transition.originSeatName ? partsNow.root.getObjectByName(transition.originSeatName) : null;
          const originDoorNode = partsNow && transition.exitDoorName ? partsNow.root.getObjectByName(transition.exitDoorName) : null;
          if (stillNoDirection && transition.exitDoorName && originSeatNode && originDoorNode) {
            const seatPos = new THREE.Vector3();
            originSeatNode.getWorldPosition(seatPos);
            const seatQuat = new THREE.Quaternion();
            originSeatNode.getWorldQuaternion(seatQuat);
            const doorPos = new THREE.Vector3();
            originDoorNode.getWorldPosition(doorPos);
            const side = sideOf(seatPos, seatQuat, doorPos);
            // Legacy inverts left/right for the OUTSIDE close animation
            // relative to the seat's own side (see CloseVehicleDoorOutside.ts).
            const closeAnim = side === "left" ? "close_door_standing_right" : "close_door_standing_left";
            closingDoorOutside.current = {
              vehicleId: transition.vehicleId,
              doorName: transition.exitDoorName,
              anim: closeAnim,
              t: 0,
              duration: clipDuration(closeAnim, 0.5),
            };
          }
        }
        vehicleTransition.current = null;
        setIsVehicleTransitioning(false);
        setTransitionMode(null);
      }
      return;
    }

    // Post-exit "closing the door from outside" hold, mirroring the legacy
    // CloseVehicleDoorOutside character state -- set up at the tail of the
    // "exiting" completion branch just above. Runs entirely on foot
    // (isPlayerActive is already true here), frozen in place for the
    // clip's duration (no WASD, no gravity drift), then clears the door's
    // held-open flag and falls through to normal control next frame.
    if (closingDoorOutside.current) {
      const cd = closingDoorOutside.current;
      cd.t += delta;
      playAnim(cd.anim);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      setPlayerInfo([position.current[0], position.current[1], position.current[2]], modelRotation.current);
      if (cd.t >= cd.duration) {
        setDoorOpen(cd.vehicleId, cd.doorName, false);
        closingDoorOutside.current = null;
      }
      return;
    }

    if (!isPlayerActive) {
      // Parked inside a vehicle. The visible model's position AND rotation
      // are no longer copied by hand here -- see the createPortal block in
      // the render below, which re-parents clonedScene onto the vehicle's
      // own seat node for real (matching the original's
      // `vehicle.attach(this)` in the old Character.ts), so normal
      // matrixWorld propagation carries both for free every frame. This
      // block still runs every frame for: estimating the seat's velocity
      // (so jumping out of a moving vehicle keeps its momentum), zeroing
      // the disabled RigidBody's own velocity so it doesn't wake up
      // mid-drive with stale momentum from before boarding, seat-switching
      // (X), the door-close-from-inside character animation (mirroring
      // Driving.ts/Sitting.ts), and leaving the seat (F).
      const parts = controlledEntityId ? getVehicleParts(state.scene, controlledEntityId) : null;
      const mySeat = parts && controlledSeatName ? getSeatInfo(parts.root, controlledSeatName) : null;

      if (parts) {
        const seatPos = new THREE.Vector3();
        parts.seat.getWorldPosition(seatPos);

        if (lastSeatPos.current && delta > 0) {
          seatVelocityEstimate.current
            .copy(seatPos)
            .sub(lastSeatPos.current)
            .divideScalar(delta);
        }
        lastSeatPos.current = seatPos;
      }
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);

      // Seat switching (X / seat_switch): lerp to whichever seat this
      // one's userData.connected_seats names, playing sitting_shift_left/
      // right -- a direct port of SwitchingSeats.ts. Reuses the same
      // vehicleTransition machinery as entering/exiting (mode "switching"),
      // seeding the disabled body's own position to the FROM seat first,
      // same as every other transition.
      if (input.consumeJustPressed("seat_switch") && parts && mySeat?.connectedSeatName && !doorCloseTransition.current) {
        const toSeat = getSeatInfo(parts.root, mySeat.connectedSeatName);
        if (toSeat) {
          const fromPos = new THREE.Vector3();
          mySeat.node.getWorldPosition(fromPos);
          fromPos.y += RADIUS;
          const fromQuat = new THREE.Quaternion();
          mySeat.node.getWorldQuaternion(fromQuat);
          const toPos = new THREE.Vector3();
          toSeat.node.getWorldPosition(toPos);
          const side = sideOf(fromPos, fromQuat, toPos);
          const switchAnim = side === "left" ? "sitting_shift_left" : "sitting_shift_right";

          vehicleTransition.current = {
            mode: "switching",
            vehicleId: controlledEntityId!,
            vehicleType: currentControllable as VehicleType,
            targetNodeName: toSeat.name,
            seatKind: toSeat.kind,
            t: 0,
            duration: clipDuration(switchAnim, 0.5),
            startPos: fromPos,
            startQuat: fromQuat,
            anim: switchAnim,
            exitVelocity: new THREE.Vector3(),
          };
          setIsVehicleTransitioning(true, controlledEntityId, null);
          setTransitionMode("switching");
          return;
        }
      }

      // Close-door-from-inside (mirrors Driving.ts/Sitting.ts's per-frame
      // `door.rotation > 0 && noDirectionPressed() -> CloseVehicleDoorInside`):
      // once this seat's own door is open and nobody's pressing a
      // direction, play the seated close-door clip once, then clear the
      // door's held-open flag in the store.
      const noDirection = !input.forward && !input.backward && !input.left && !input.right;
      if (
        !doorCloseTransition.current &&
        mySeat?.doorName &&
        controlledEntityId &&
        !!openVehicleDoors[`${controlledEntityId}:${mySeat.doorName}`] &&
        noDirection
      ) {
        const doorNode = parts?.root.getObjectByName(mySeat.doorName) ?? null;
        const seatPos2 = new THREE.Vector3();
        mySeat.node.getWorldPosition(seatPos2);
        const seatQuat2 = new THREE.Quaternion();
        mySeat.node.getWorldQuaternion(seatQuat2);
        const doorPos = new THREE.Vector3();
        (doorNode ?? mySeat.node).getWorldPosition(doorPos);
        const side = sideOf(seatPos2, seatQuat2, doorPos);
        const closeAnim = side === "left" ? "close_door_sitting_left" : "close_door_sitting_right";
        doorCloseTransition.current = {
          vehicleId: controlledEntityId,
          doorName: mySeat.doorName,
          anim: closeAnim,
          t: 0,
          duration: clipDuration(closeAnim, 0.5),
        };
      }

      if (doorCloseTransition.current) {
        const dc = doorCloseTransition.current;
        dc.t += delta;
        playAnim(dc.anim);
        if (dc.t >= dc.duration) {
          setDoorOpen(dc.vehicleId, dc.doorName, false);
          doorCloseTransition.current = null;
        }
      } else if (mySeat) {
        // Held pose once not mid-close-door -- also what reasserts
        // "driving"/"sitting" the frame right after a close-door animation
        // finishes (playAnim no-ops if already the current clip, so this
        // is a cheap no-op most frames).
        playAnim(mySeat.kind === "driver" ? "driving" : "sitting");
      }

      if (input.consumeJustPressed("enter") && controlledEntityId && parts) {
        // Leave through THIS seat's own entry point (legacy's
        // ExitingVehicle.ts: `this.exitPoint = seat.entryPoints[0]`) --
        // faithful now that passenger seats are real occupiable seats, not
        // just always the driver's own front door.
        const seatForExit = mySeat ?? getSeatInfo(parts.root, "seat_1");
        const entryNode = seatForExit?.entryPointName ? parts.root.getObjectByName(seatForExit.entryPointName) : null;
        const exitPointNode = entryNode ?? parts.entrance;

        const startPos = new THREE.Vector3();
        (seatForExit?.node ?? parts.seat).getWorldPosition(startPos);
        startPos.y += RADIUS; // matches the seat-follow correction above
        const startQuat = new THREE.Quaternion();
        (seatForExit?.node ?? parts.seat).getWorldQuaternion(startQuat);
        const entrancePos = new THREE.Vector3();
        exitPointNode.getWorldPosition(entrancePos);
        const side = sideOf(startPos, startQuat, entrancePos);

        vehicleTransition.current = {
          mode: "exiting",
          vehicleId: controlledEntityId,
          vehicleType: currentControllable as VehicleType,
          targetNodeName: exitPointNode.name,
          seatKind: seatForExit?.kind ?? "driver",
          t: 0,
          duration: VEHICLE_EXIT_DURATION,
          startPos,
          startQuat,
          anim: side === "left" ? "stand_up_left" : "stand_up_right",
          exitVelocity: seatVelocityEstimate.current.clone(),
          originSeatName: seatForExit?.name ?? "seat_1",
          exitDoorName: seatForExit?.doorName ?? null,
        };
        setIsVehicleTransitioning(true, controlledEntityId, seatForExit?.doorName ?? null);
        setTransitionMode("exiting");
      }
      return;
    }

    lastSeatPos.current = null;

    // Vehicle entry: find the nearest vehicle within reach of its door.
    // Two-stage search mirrors the original's findVehicleToEnter() --
    // nearest vehicle overall, then (via findSeatAndEntry) the best SEAT
    // for the given intent and the nearest of ITS OWN entry points --
    // except the original then auto-walks the character all the way to
    // the door; this port requires the player to already be standing
    // within VEHICLE_ENTRANCE_RANGE of it. 'enter' (F, wantsToDrive) only
    // ever lands you in the driver's seat or a seat connected to it (e.g.
    // car.glb's front passenger seat_2, NOT the unconnected rear
    // seat_3/seat_4) -- faithfully reverted from an earlier "every door
    // makes you drive" shortcut. 'enter_passenger' (G) is the
    // wantsToDrive=false path: any passenger seat, no connection required.
    const wantsToDrive = input.consumeJustPressed("enter");
    const wantsPassengerSeat = !wantsToDrive && input.consumeJustPressed("enter_passenger");
    if (wantsToDrive || wantsPassengerSeat) {
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
          const found = findSeatAndEntry(parts.root, playerPos, wantsToDrive);

          if (found) {
            const entrancePos = new THREE.Vector3();
            found.entry.getWorldPosition(entrancePos);

            // Stand-in for the legacy auto-walk: the player has to already
            // be next to whichever entry point this resolved to.
            if (playerPos.distanceTo(entrancePos) <= VEHICLE_ENTRANCE_RANGE) {
              const entranceQuat = new THREE.Quaternion();
              found.entry.getWorldQuaternion(entranceQuat);
              const seatPos = new THREE.Vector3();
              found.seat.node.getWorldPosition(seatPos);
              const side = sideOf(entrancePos, entranceQuat, seatPos);

              // boxman.glb actually ships dedicated enter_airplane_left/
              // right clips (climbing up onto the wing/cockpit), distinct
              // from the car's sit_down_left/right -- confirmed present in
              // the glb's animation list but never referenced anywhere in
              // this file, so every vehicle including the airplane was
              // always using the car clip. Same idea as
              // getEntryAnimations() in the legacy EnteringVehicle.ts,
              // just inlined here since this port only ever needs the one
              // animation-set distinction (car/heli share the same seated
              // pose, only the airplane's is different).
              const enterAnim = closestType === "airplane"
                ? (side === "left" ? "enter_airplane_left" : "enter_airplane_right")
                : (side === "left" ? "sit_down_left" : "sit_down_right");

              vehicleTransition.current = {
                mode: "entering",
                vehicleId: closestId,
                vehicleType: closestType,
                targetNodeName: found.seat.name,
                seatKind: found.seat.kind,
                t: 0,
                duration: VEHICLE_ENTER_DURATION,
                startPos: playerPos.clone(),
                startQuat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), modelRotation.current),
                anim: enterAnim,
                exitVelocity: new THREE.Vector3(),
                // Landed in a passenger seat while actually wanting to
                // drive (e.g. car.glb's seat_2, connected to the driver's
                // seat_1) -- see Sitting.ts's own continuous wantsToDrive
                // check, replicated on arrival in the completion branch
                // above.
                autoSwitchToDriverOnArrival: wantsToDrive && found.seat.kind === "passenger",
              };
              // See the big comment above this function's vehicle-entry section --
              // stop colliding with anything (the target car included) for the
              // whole time this body is associated with a vehicle, re-enabled
              // only once fully exited below.
              body.setEnabled(false);
              setIsVehicleTransitioning(true, closestId, found.seat.doorName);
              // Held open until the character's own close-door-from-inside
              // animation runs (see the parked block above), not simply once
              // this entering transition ends.
              if (found.seat.doorName) setDoorOpen(closestId, found.seat.doorName, true);
              setTransitionMode("entering");
              return;
            }
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
    // cross(forward, up) -- NOT cross(up, forward), which points the wrong
    // way and was making A/D (and gamepad left stick strafe) move the
    // character opposite to what the camera shows (confirmed: with forward
    // = (0,0,-1)/up = (0,1,0), cross(up,forward) = (-1,0,0) but the actual
    // camera-right direction there is (+1,0,0) = cross(forward,up)).
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

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
    const roadOff = getRoadOffset(position.current[0], position.current[2]);
    // Explorable buildings (Claude) -- "rendi i palazzi esplorabili, piani
    // e scale che portano fino al tetto". getBuildingHeightOffset returns
    // null whenever it doesn't apply (outside every building's footprint,
    // or standing at plain ground-floor level), in which case this is a
    // no-op and groundY is exactly what it was before -- see City.tsx's
    // big comment above getBuildingHeightOffset for the full explanation
    // of why building floors/stairs need to hook in HERE rather than
    // relying on physics contact response like a normal collider would.
    const buildingY = getBuildingHeightOffset(position.current[0], position.current[2], position.current[1]);
    const groundY = buildingY !== null ? buildingY : terrainY + roadOff;
    const distToGround = position.current[1] - (groundY + RADIUS);
    // TEMP DEBUG (Claude)
    (window as any).__groundDebug = { pos: position.current.slice(), terrainY, roadOff, groundY, distToGround, isGrounded: isGrounded.current };
    (window as any).__inputDebug = { forward: input.forward, backward: input.backward, left: input.left, right: input.right, shift: input.shift, isPlayerActive };
    // jumpLockout keeps this false for a short window after a jump (see
    // JUMP_LOCKOUT_TIME above).
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
    // collisionGroups above), so this snap is the only thing placing the
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
    body.setLinvel({ x: finalVel.x, y: yVel, z: finalVel.z }, true);

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
    // Computed before playAnim() below so the base layer can pick the
    // right pool (full vs. lower-only) for whatever nextAnim resolved to
    // -- see the big comment above the mixer-building effect.
    const isFiring = !!input.primary;
    (window as any).__animDebug = { nextAnim, currentAnim: currentAnimRef.current, airPhase: airPhase.current, landingAnim: landingAnim.current, landingAnimTimer: landingAnimTimer.current, hSpeed, isGrounded: isGrounded.current, isFiring };
    playAnim(nextAnim, isFiring);

    // Upper-body "shoot" overlay, independent of the base layer above --
    // "l'animazione di sparo deve riguardare solo la parte superiore del
    // corpo perche se corro o sn fermo deve continuare idle o run o walk
    // che sia". Only transitions on actual press/release (mirrors
    // playAnim's own early-return-if-unchanged) so reset()/fadeIn() don't
    // restart the aim/recoil loop every single frame the button is held.
    if (isFiring !== wasFiringRef.current) {
        const shootAction = shootUpperActionRef.current;
        if (shootAction) {
            if (isFiring) {
                shootAction.reset().fadeIn(0.1).play();
            } else {
                shootAction.fadeOut(0.15);
            }
        }
        wasFiringRef.current = isFiring;
    }

    // 6. Network & Store
    setPlayerInfo([position.current[0], position.current[1], position.current[2]], modelRotation.current);

    if (state.clock.getElapsedTime() % 0.05 < 0.02) {
        setPosState([position.current[0], position.current[1], position.current[2]]);
        _networkQuat.setFromAxisAngle(_networkYAxis, modelRotation.current);
        setQuatState([_networkQuat.x, _networkQuat.y, _networkQuat.z, _networkQuat.w]);
    }
  });

  // Real re-parenting for the steady-state "seated and driving" case --
  // the actual fix for "perche' non rifacciamo [l'attach originale]":
  // rather than copying position AND rotation onto the RigidBody by hand
  // every frame (fragile -- that's exactly how the RADIUS offset and the
  // rotation-follow bugs both happened, one missed field at a time),
  // createPortal renders clonedScene as a real three.js child of the
  // vehicle's own seat_1 node for as long as we're fully seated. From then
  // on ordinary matrixWorld propagation carries position AND full 3D
  // rotation (pitch/roll included, e.g. an airplane banking -- something
  // the Y-only modelRotation.current approach could never do) for free,
  // every frame, with no per-frame code at all -- the same guarantee
  // `vehicle.attach(this)` gave the original, just reached the React way
  // (an imperative Object3D.attach() would fight the <primitive>'s own
  // JSX-driven position/rotation props being re-applied on every re-render).
  //
  // Deliberately scoped to ONLY the steady-state period (not entering/
  // exiting): the transition lerp's world-space math already works
  // correctly (RADIUS + rotation both fixed above) and doing that part in
  // local-seat-space too would mean re-deriving the entrance/seat relative
  // offsets for comparatively little benefit, for more risk, than leaving
  // an already-working animation alone.
  const isPlayerActiveForRender = currentControllable === "player";
  const seatedContainer =
    !isPlayerActiveForRender && !isVehicleTransitioning && controlledEntityId
      // Portal onto the ACTUAL occupied seat (controlledSeatName), not
      // always seat_1 -- getVehicleParts().seat is hardcoded to the
      // driver's seat, which was fine back when only the driver seat was
      // ever occupiable, but a passenger sitting in seat_2/3/4 needs to be
      // parented to their own seat node instead.
      ? (getVehicleParts(worldScene, controlledEntityId)?.root.getObjectByName(controlledSeatName ?? "seat_1") ?? null)
      : null;

  return (
    <>
      <RigidBody
        ref={rigidBodyRef}
        name="player"
        type="dynamic"
        colliders={false}
        position={[0, 15, 0]}
        linearDamping={0}
        canSleep={false}
        lockRotations
      >
        <BallCollider
          args={[RADIUS]}
          mass={1}
          friction={0}
          restitution={0}
          // Matches the original's "slippery" cannon Material (see
          // PhysicsManager.ts's characterTrimeshContactMaterial) and
          // excludes TrimeshColliders for the reason explained above the
          // rigidBodyRef declaration.
          collisionGroups={groupsExcluding(CollisionGroups.Characters, CollisionGroups.TrimeshColliders)}
        />
        {/* Always visible now (Claude) -- this used to hide the character
            the instant control handed over to a vehicle (`visible={
            currentControllable === "player" || transitionMode === "exiting"}`,
            inherited unchanged from the old cannon version's own
            <group visible={...}>). That made the character disappear
            entirely the whole time you were actually driving/flying, not
            just during the brief hidden-nowhere-yet instant right after
            control handed over -- unlike the original (non-React)
            Sketchbook, where the character stays visible sitting in the
            seat the whole time (see git history / chat: "il personaggio...
            si sedeva correttamente in auto ora non si vede proprio"). The
            body itself is still correctly seat-tracked and physics-
            disabled while driving (see the vehicle-entry effects above),
            so nothing but the render was ever the problem here. Left as a
            plain <group> (not folded back onto <RigidBody>) because
            RigidBodyProps' TS type has no index signature for arbitrary
            Object3D props like `visible`. */}
        <group>
          {/* While actually seated (not mid entry/exit animation), the
              model+bubble are portalled directly into the vehicle's seat
              node below instead of rendered here -- see the big comment
              above the seatedContainer computation. */}
          {!seatedContainer && (
            <>
              <group rotation={[0, modelRotation.current, 0]}>
                <primitive object={clonedScene} position={[0, -RADIUS, 0]} />
              </group>
              <SpeechBubble message={playerMessage} position={[0, 1.2, 0]} />
            </>
          )}
        </group>
      </RigidBody>
      {seatedContainer && createPortal(
        <>
          {/* seat_1 is already authored at exactly the point the
              character's root should sit (confirmed by the RADIUS math in
              the transition lerp above: bodyOrigin = seatY + RADIUS, model
              drawn at bodyOrigin - RADIUS, net = seatY) -- so, parented
              directly to it, no local offset is needed at all. */}
          <primitive object={clonedScene} position={[0, 0, 0]} quaternion={[0, 0, 0, 1]} />
          <SpeechBubble message={playerMessage} position={[0, 1.2, 0]} />
        </>,
        seatedContainer
      )}
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
