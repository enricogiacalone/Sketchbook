import React, { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, CuboidCollider, RapierRigidBody, useRapier, useBeforePhysicsStep, interactionGroups } from '@react-three/rapier';
import { useGLTF, Html } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { useInput } from '../../hooks/useInput';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { CollisionGroups, groupsExcluding } from '../../enums/CollisionGroups';
import { vehicleBodyHandles, farCars } from './vehicleRegistry';
import { MANNEQUIN_URL, MANNEQUIN_BASE_ANIMS_URL } from '../city/useMannequinActor';
import { remoteDrivenCars, isRemoteDriven } from '../multiplayer/remoteVehicles';
import { simDebug } from '../../debug/simDebug';
import { getTerrainHeight } from '../Environment/Terrain';
import { getRoadOffset } from '../Environment/Road';
import { CoefficientCombineRule } from '@dimforge/rapier3d-compat';
import { SketchbookRaycastVehicle } from './sketchbookRaycastVehicle';

interface CarProps {
  position?: [number, number, number];
  id?: string;
  // "crea la polizia che gira in auto per la citta" -- a closed loop of
  // world (x,z) waypoints. When set, this Car drives itself (AI, ported
  // from the original vanilla engine's FollowPath/FollowTarget character
  // AI -- see the AI block in useFrame below) instead of sitting parked,
  // and shows a driver (Officer, below) in its seat -- unless/until an
  // actual player boards and drives it themselves (see humanIsDriving).
  patrolRoute?: [number, number][];
  // Initial yaw, e.g. for a car spawned already facing along a road/curb
  // (see CityDetails.tsx's parked cars, now real drivable Car instances
  // instead of the old static ParkedCar decoration) -- purely a spawn-time
  // orientation, exactly like `position`; the RigidBody is fully dynamic
  // afterwards so this doesn't constrain it in any way once physics takes
  // over.
  rotation?: [number, number, number];
  // "inserisci una macchina nell'arena.. insegnare al personaggio ad
  // entrarci": car.glb e' a misura dell'omino boxman del playground (lunga
  // 2.5 m, tetto a 1.2 m); il soldato del duello e' alto 1.8 m. Scala
  // TUTTA l'auto -- modello, scocca, ruote, sospensioni, fari, sedili --
  // tenendo la stessa massa (densita' / scala^3), cosi' guida come prima.
  scale?: number;
  // Massa vera (kg). car.glb pesa 2.1 kg (densita' 1 sui suoi due box): con
  // i ragdoll a terra da 75 kg un'auto "di carta" si fermava contro un
  // corpo come contro un muro. Con la massa si scalano allo stesso modo
  // motore e freni (la sospensione di Rapier e' gia' proporzionale alla
  // massa), cosi' la guida resta identica. Assente = com'era.
  massKg?: number;
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

  constructor(
    private mass: number,
    private damping: number,
    fps: number = 60
  ) {
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
const FRICTION_SLIP = 0.8; // come l'originale (era 1.0)
const DAMPING_RELAXATION = 2;
const DAMPING_COMPRESSION = 2;
// "qui la macchina si guidava molto meglio": la spinta laterale delle ruote
// applicata piu' in basso, verso il baricentro (vedi sketchbookRaycastVehicle.ts)
// -- il DynamicRayCastVehicleController di Rapier non ce l'ha.
const ROLL_INFLUENCE = 0.8;
// Il telaio dell'originale: 50 kg, baricentro nell'origine del modello (non
// nel centro delle forme: piu' in basso, e' cio' che lo tiene dritto),
// inerzia della scatola che contiene tutte le forme di collisione di
// car.glb (i due box + le 12 sfere) e gravita' 9.81 (il nostro mondo ha
// 20: l'auto ha la sua scala di gravita'). Le forze sono riportate alla
// massa vera (FORCE_SCALE) e, con la scala S del modello, le velocita' a
// sqrt(S) (stessa dinamica dell'originale, solo piu' grande).
const ORIGINAL_MASS = 50;
const ORIGINAL_GRAVITY = 9.81;
const CANNON_AABB_HALF = [0.612, 0.555, 1.2105];
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

// Motore/cambio/sterzo: gli stessi numeri di Car.ts dell'originale (forze
// per il telaio da 50 kg, riportate alla massa vera con FORCE_SCALE) sul
// veicolo a raggi dell'originale (sketchbookRaycastVehicle.ts).
const ENGINE_FORCE = 500; // Restored to match the original vanilla Sketchbook's Car.ts tuning.
const MAX_GEARS = 5;
const TIME_TO_SHIFT = 0.2;
const GEARS_MAX_SPEEDS: Record<string, number> = { R: -4, '0': 0, '1': 5, '2': 9, '3': 13, '4': 17, '5': 22 };
const BRAKE_FORCE = 1000000; // Restored to match the original vanilla Sketchbook's Car.ts tuning.
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
  {
    fullDimensions: [1.2233487367630005, 0.4973112344741821, 2.420389175415039] as [number, number, number],
    position: [0, 0.09126596, 0.03799713] as [number, number, number],
  },
  {
    fullDimensions: [1.0837020874023438, 0.5600574016571045, 1.071435809135437] as [number, number, number],
    position: [0, 0.6199502944946289, -0.2552129924297333] as [number, number, number],
  },
];
// Raggi delle ruote: solo il "terreno" (chi appartiene a Default o ai
// trimesh: strade, terreno, pavimenti, muri, altri veicoli) -- non i
// personaggi (Characters: capsule dei combattenti, sfera del giocatore) ne'
// i pezzi dei ragdoll. Prima le ruote ci salivano sopra: un'auto contro una
// persona in piedi si fermava di colpo come contro un gradino.
const WHEEL_RAY_GROUPS = interactionGroups([CollisionGroups.Default], [CollisionGroups.Default, CollisionGroups.TrimeshColliders]);

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
const _airAng = new THREE.Vector3();
const _airRight = new THREE.Vector3();
const _uprightQuat = new THREE.Quaternion();
const _uprightEuler = new THREE.Euler();
// AI patrol scratch vectors -- see the FollowPath-derived AI block in
// useFrame below.
const _aiViewDir = new THREE.Vector3();
const _aiCross = new THREE.Vector3();
const _aiSegDir = new THREE.Vector3();
// Dedicated telemetry scratch objects (window.__sim, debug/simDebug.ts)
// -- kept separate from _chassisQuat/_carEuler above so reading telemetry
// can never race with what the driving/wheel-sync logic is doing with
// those in the same callback.
const _carTelQuat = new THREE.Quaternion();
const _carTelEuler = new THREE.Euler();

// "crea la polizia che gira in auto per la citta" -- ported from the
// original vanilla engine's FollowPath.ts/FollowTarget.ts (character AI
// driving a vehicle toward a moving target node, advancing along a linked
// list of PathNodes). Re-tuned for a simple looping array of waypoints
// instead of a linked list (this only ever needs one-way loops, not the
// original's reversible traversal), and for city-block scale distances.
const PATROL_NODE_RADIUS = 8; // ~ROAD_WIDTH -- "arrived" once this close, matching how wide the road itself is
const PATROL_STEER_DEADZONE = 0.15; // radians, matches the original's angle threshold
const PATROL_CORNER_SLOWDOWN_DOT = 0.7; // matches the original's slowDownAngle threshold
const PATROL_CORNER_SLOWDOWN_DIST = 15;
const PATROL_CORNER_SLOWDOWN_SPEED = 6;
const PATROL_STUCK_TIMEOUT = 5; // seconds, matches the original's staleTimer

// The officer visibly driving a patrol car -- a separate component (not
// inlined into Car) so its useGLTF('boxman.glb')/useAnimations/
// SkeletonUtils.clone cost is only ever paid for the 1-2 actual patrol
// cars, never for the ~35 ordinary parked Car instances CityDetails.tsx
// spawns across the city (conditionally MOUNTING this, not conditionally
// calling hooks inside Car itself, is what keeps that cost out of every
// other car -- same lesson as the headlights: "il gioco e' rallentato di
// molto" the first time real per-instance cost wasn't gated behind an
// actual mount/unmount).
// "anche la polizia sostituiscila con il manichino": l'agente al volante
// e' il manichino del giocatore (stesse ossa, stessa clip 'Driving', stessa
// posizione sul sedile di PlayerCombatSoldier: 0.31 m avanti e 0.44 m sotto
// il nodo seat_1), in divisa blu. Solo visivo.
const OFFICER_COLOR = '#1e40af';
const OFFICER_SEAT_FWD = 0.31;
const OFFICER_SEAT_DOWN = 0.44;
const Officer: React.FC<{ seatPosition: [number, number, number]; seatQuaternion: [number, number, number, number] }> = ({
  seatPosition,
}) => {
  const { scene } = useGLTF(MANNEQUIN_URL);
  const { animations } = useGLTF(MANNEQUIN_BASE_ANIMS_URL);
  const { clone, mixer } = useMemo(() => {
    const c = SkeletonUtils.clone(scene);
    c.traverse((child: any) => {
      if (child.isSkinnedMesh) {
        child.material = child.material.clone();
        child.material.emissive = new THREE.Color(OFFICER_COLOR);
        child.material.emissiveIntensity = 0.45;
      }
    });
    return { clone: c, mixer: new THREE.AnimationMixer(c) };
  }, [scene]);

  useEffect(() => {
    const clip = animations.find((a) => a.name === 'Driving');
    if (!clip) return;
    const a = mixer.clipAction(clip);
    a.play();
    return () => {
      a.stop();
    };
  }, [animations, mixer]);
  useFrame((_, delta) => mixer.update(delta));

  // nello spazio del telaio: avanti = +Z, il modello guarda gia' avanti
  return (
    <group position={[seatPosition[0], seatPosition[1] - OFFICER_SEAT_DOWN, seatPosition[2] + OFFICER_SEAT_FWD]}>
      <primitive object={clone} />
    </group>
  );
};

// Scala/massa di default di tutte le auto: il manichino e' alto 1.8 m, il
// modello originale era fatto per il boxman (x1.5 = stessa proporzione
// dell'auto dell'arena). Massa reale: investire qualcuno lo butta giu'.
export const DEFAULT_CAR_SCALE = 1.5;
export const DEFAULT_CAR_MASS_KG = 1100;

// auto guidata da un altro giocatore: inseguimento della posa di rete
// oltre questa distanza dal giocatore un'auto parcheggiata e ferma si congela
const CAR_SLEEP_DIST = 60;
// oltre questa distanza dalla telecamera il modello e' quello semplificato in blocco
const CAR_LOD_DIST = 70;
const REMOTE_CAR_FOLLOW_RATE = 14; // 1/s
const REMOTE_CAR_SNAP_DIST = 8; // m
const _remoteCarQ = new THREE.Quaternion();
const _remoteCarQ2 = new THREE.Quaternion();

const Car: React.FC<CarProps> = ({
  position = [10, 5, 0],
  id = 'car-1',
  rotation = [0, 0, 0],
  patrolRoute,
  scale = DEFAULT_CAR_SCALE,
  massKg = DEFAULT_CAR_MASS_KG,
}) => {
  const S = scale;
  const MASS = massKg || DEFAULT_CAR_MASS_KG;
  const FORCE_SCALE = MASS / ORIGINAL_MASS;
  // similitudine con l'originale (modello S volte piu' grande): velocita' e
  // tempi x sqrt(S)
  const VS = Math.sqrt(S);
  const { scene } = useGLTF('car.glb');
  const clonedScene = useMemo(() => scene.clone(), [scene]);
  const { world, rapier } = useRapier();

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
      console.warn(
        `Car ${id}: expected 4 wheel nodes in car.glb, found ${defs.length}. Falling back to a stub wheel (physics only, no visual) for any missing slot.`
      );
    }
    return defs;
  }, [clonedScene]);

  const input = useInput();
  const {
    currentControllable,
    controlledEntityId,
    controlledSeatType,
    isVehicleTransitioning,
    transitioningEntityId,
    transitioningDoorName,
    openVehicleDoors,
    updateEntity,
    setPlayerInfo,
    isPaused,
  } = useStore(
    useShallow((state) => ({
      currentControllable: state.currentControllable,
      controlledEntityId: state.controlledEntityId,
      // Only an occupant of the DRIVER seat actually steers/throttles the
      // car (see isCarActive below) -- a passenger just rides along, same
      // as the legacy Sitting state never calling startControllingVehicle().
      controlledSeatType: state.controlledSeatType,
      isVehicleTransitioning: state.isVehicleTransitioning,
      transitioningEntityId: state.transitioningEntityId,
      transitioningDoorName: state.transitioningDoorName,
      // Doors held open by Player.tsx's close-door character animation
      // states, independent of isVehicleTransitioning -- see store.ts.
      openVehicleDoors: state.openVehicleDoors,
      updateEntity: state.updateEntity,
      setPlayerInfo: state.setPlayerInfo,
      isPaused: state.isPaused,
    }))
  );

  // Render-scope (not just inside useFrame) because the Officer/label JSX
  // below needs it too, to disappear the instant an actual player takes
  // the wheel of a patrol car -- R3F's useFrame always runs the latest
  // render's callback, so reading this same variable inside useFrame below
  // is exactly as fresh as recomputing it there every frame would be.
  const humanIsDriving = currentControllable === 'car' && controlledEntityId === id && controlledSeatType === 'driver';

  // AI patrol state (see the useFrame block below) -- only ever advanced
  // when patrolRoute is set; harmless idle refs otherwise.
  const aiTargetIndex = useRef(0);
  const aiStaleTimer = useRef(0);

  // Officer's seat transform, in THIS car's own local space (same frame
  // <primitive object={clonedScene}> and the headlights already use) --
  // computed once off the glb's own seat_1 node rather than a hardcoded
  // guess (unlike the headlights, which have no such node to read).
  // clonedScene has no parent of its own at this point, so its world
  // transform IS its local transform -- exactly the frame the Officer
  // needs to be positioned in as a sibling of <primitive> inside the same
  // RigidBody.
  const officerSeatTransform = useMemo(() => {
    if (!patrolRoute) return null;
    const seatNode = clonedScene.getObjectByName('seat_1');
    if (!seatNode) return null;
    clonedScene.updateMatrixWorld(true);
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    seatNode.getWorldPosition(worldPos);
    seatNode.getWorldQuaternion(worldQuat);
    const localPos = clonedScene.worldToLocal(worldPos.clone());
    return {
      // il modello e' scalato di S dentro il RigidBody, l'Officer no
      position: [localPos.x * S, localPos.y * S, localPos.z * S] as [number, number, number],
      quaternion: [worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w] as [number, number, number, number],
    };
  }, [clonedScene, patrolRoute, S]);

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

  // "aggiungi dei fari veri alla macchina che accendo a comando" -- car.glb
  // ships no headlight geometry at all (confirmed: no light/lamp nodes in
  // the glb), so both the glowing lens (bulb mesh, purely cosmetic) and the
  // actual light source are new here. Positions are read off the glb's own
  // front-bumper-corner collision spheres (~x=+-0.306, y=0.151, z=0.943)
  // nudged to the very front face (chassis half-depth ~1.21 -- see
  // CHASSIS_SHAPES) -- local space, since these mount as siblings of
  // <primitive object={clonedScene}> inside the same RigidBody. +Z is
  // forward here (wheel_fl/fr sit at z=+0.86 vs the rear wheels' z=-0.79).
  //
  // "il gioco e' rallentato di molto" -- the first version kept the
  // <spotLight> elements permanently mounted on EVERY Car instance
  // (intensity toggled 0/45 via a ref) so flipping the switch wouldn't
  // re-render. That's backwards for a scene with dozens of these: City.tsx/
  // CityDetails.tsx spawn a real drivable <Car> for every parked car in the
  // whole city (see the GRID_RADIUS loop), so that kept 2 real SpotLights
  // PER PARKED CAR permanently in the scene graph -- three.js still counts
  // a light toward the shader's light loop regardless of intensity=0 (the
  // exact "per-lamp lights don't scale with lamp count" problem
  // StreetLampGlow.tsx/BuildingLedGlow.tsx's own pooling comments already
  // called out for streetlamps/LEDs), so this was 40-100+ always-on real
  // lights city-wide. Conditionally rendering on `headlightsOn` instead
  // means only the ONE car actually being driven, and only while its
  // lights are actually switched on, ever has real lights in the scene at
  // all -- toggling is rare enough that the resulting re-render is free.
  const HEADLIGHT_X = 0.32;
  const HEADLIGHT_Y = 0.18;
  const HEADLIGHT_Z = 1.18;
  const HEADLIGHT_INTENSITY = 45;
  const HEADLIGHT_BULB_EMISSIVE = 3;
  const leftHeadlightRef = useRef<THREE.SpotLight>(null);
  const rightHeadlightRef = useRef<THREE.SpotLight>(null);
  const leftHeadlightTargetRef = useRef<THREE.Object3D>(null);
  const rightHeadlightTargetRef = useRef<THREE.Object3D>(null);
  // Persists across the driver getting in/out -- toggling isn't tied to
  // isCarActive (a real car's headlights stay on after you park and walk
  // away), only WHO can flip the switch is (see the consumeJustPressed
  // check in useFrame below). React state, not a ref, precisely BECAUSE it
  // needs to trigger the mount/unmount below -- the opposite tradeoff from
  // the usual "ref avoids a re-render" pattern elsewhere in this file.
  const [headlightsOn, setHeadlightsOn] = useState(false);

  useEffect(() => {
    // THREE.SpotLight.target defaults to a detached Object3D at the world
    // origin -- pointing it at our own sibling target node (also a child
    // of this RigidBody, so it inherits the same local->world transform
    // every frame) is what makes the beam actually follow the car instead
    // of always aiming at (0,0,0) in world space. Depends on headlightsOn
    // because the light/target pair only exists in the tree while on (see
    // the conditional render below) -- this needs to re-wire the target
    // every time they're freshly mounted, not just once on first mount.
    if (leftHeadlightRef.current && leftHeadlightTargetRef.current) {
      leftHeadlightRef.current.target = leftHeadlightTargetRef.current;
    }
    if (rightHeadlightRef.current && rightHeadlightTargetRef.current) {
      rightHeadlightRef.current.target = rightHeadlightTargetRef.current;
    }
  }, [headlightsOn]);

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
  // guidata in rete da un altro giocatore (vedi useBeforePhysicsStep)
  const remoteCarRef = useRef({ active: false, vel: new THREE.Vector3() });

  // Real vehicle controller (see useEffect below) -- replaces BOTH
  // useRaycastVehicle (never actually propelled or suspended the chassis in
  // the old cannon-worker-api setup, see git history) and the kinematic
  // driveSpeed/analytic-ground-snap/quaternion-rotateTowards self-righting
  // hack that was built as a workaround for it. This is a REAL raycast
  // vehicle: engine force/brake/steering genuinely act on the chassis via
  // its own suspension physics, and rollover recovery (or lack thereof) is
  // now a real physical consequence of chassis mass/CoM/suspension tuning,
  // not something hand-simulated.
  // (veicolo a raggi dell'originale, vedi sketchbookRaycastVehicle.ts)
  const vehicleController = useRef<SketchbookRaycastVehicle | null>(null);

  // Per-wheel chassis-local connection point (top of the suspension strut).
  // The +0.2 Y offset is inherited, unchanged, from the old cannon setup's
  // chassisConnectionPointLocal -- it's how far above the wheel's authored
  // resting position the strut's mount point sits, before suspension travel
  // (SUSPENSION_REST_LENGTH) brings the wheel back down to about the right
  // spot. Computed once and shared between vehicleController.addWheel below
  // and the visual wheel-sync loop in useFrame, so the rendered wheel mesh
  // always matches exactly what the controller is actually simulating.
  const wheelConnectionPoints = useMemo(
    () =>
      [0, 1, 2, 3].map((i) => {
        const def = wheelDefs[i] ?? FALLBACK_WHEEL;
        return new THREE.Vector3(def.position[0] * S, (def.position[1] + 0.2) * S, def.position[2] * S);
      }),
    [wheelDefs, S]
  );

  useEffect(() => {
    const chassis = chassisRef.current;
    if (!chassis) return;

    // massa/baricentro/inerzia come l'originale (le forme hanno densita' 0)
    const e = CANNON_AABB_HALF.map((h) => h * S);
    const inertia = new THREE.Vector3(
      (MASS / 12) * (4 * e[1] * e[1] + 4 * e[2] * e[2]),
      (MASS / 12) * (4 * e[0] * e[0] + 4 * e[2] * e[2]),
      (MASS / 12) * (4 * e[1] * e[1] + 4 * e[0] * e[0])
    );
    chassis.setAdditionalMassProperties(
      MASS,
      { x: 0, y: 0, z: 0 },
      { x: inertia.x, y: inertia.y, z: inertia.z },
      { x: 0, y: 0, z: 0, w: 1 },
      true
    );
    chassis.setGravityScale(ORIGINAL_GRAVITY / Math.max(0.1, Math.abs(world.gravity.y)), true);

    const controller = new SketchbookRaycastVehicle(world, rapier, chassis, inertia);
    for (let i = 0; i < 4; i++) {
      controller.addWheel({
        connectionLocal: wheelConnectionPoints[i],
        directionLocal: WHEEL_DIRECTION_AXIS,
        axleLocal: WHEEL_AXLE_AXIS,
        radius: WHEEL_RADIUS * S,
        suspensionRestLength: SUSPENSION_REST_LENGTH * S,
        maxSuspensionTravel: MAX_SUSPENSION_TRAVEL * S,
        // (similitudine: stessa compressione relativa, stessi tempi x sqrt(S))
        suspensionStiffness: SUSPENSION_STIFFNESS / S,
        dampingCompression: DAMPING_COMPRESSION / VS,
        dampingRelaxation: DAMPING_RELAXATION / VS,
        frictionSlip: FRICTION_SLIP,
        rollInfluence: ROLL_INFLUENCE,
      });
    }

    vehicleController.current = controller;
    vehicleBodyHandles.add(chassis.handle);
    // Populate the store immediately instead of waiting for the first
    // throttled updateEntity below, so e.g. Player.tsx's nearest-vehicle
    // search doesn't have a stale/missing entry for this car right after it
    // spawns.
    const t = chassis.translation();
    updateEntity(id, { type: 'car', position: [t.x, t.y, t.z] });

    return () => {
      vehicleBodyHandles.delete(chassis.handle);
      vehicleController.current = null;
      // Drop this car's window.__sim telemetry entry on unmount (e.g.
      // leaving the race/car-test scenario) so a stale, no-longer-driven
      // body's last-known position/velocity doesn't linger forever in
      // state().vehicles under this id.
      if (import.meta.env.DEV) simDebug.unregisterVehicle(id);
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
  // controllo in aria / raddrizzarsi (originale: airSpinTimer, canTiltForwards)
  const airSpinTimer = useRef(0);
  const canTiltForwards = useRef(false);

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
  // parcheggiata lontano: corpo fisso (vedi sotto)
  const frozenRef = useRef(false);
  const settledRef = useRef(0);
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

    // -- Guidata da un altro giocatore (rete): niente simulazione, il telaio
    // (cinematico) insegue la posa che arriva da chi guida. Quando smette di
    // arrivare torna fisico con la velocita' che aveva.
    {
      const rc = remoteDrivenCars.get(id);
      const remote = !humanIsDriving && !!rc && isRemoteDriven(id);
      const rs = remoteCarRef.current;
      if (remote && rc) {
        frozenRef.current = false;
        if (!rs.active) {
          chassis.setBodyType(rapier.RigidBodyType.KinematicPositionBased, true);
          rs.active = true;
        }
        const cur = chassis.translation();
        const k = 1 - Math.exp(-dt * REMOTE_CAR_FOLLOW_RATE);
        const dx = rc.p[0] - cur.x,
          dy = rc.p[1] - cur.y,
          dz = rc.p[2] - cur.z;
        const snap = dx * dx + dy * dy + dz * dz > REMOTE_CAR_SNAP_DIST * REMOTE_CAR_SNAP_DIST;
        const f = snap ? 1 : k;
        const nx = cur.x + dx * f,
          ny = cur.y + dy * f,
          nz = cur.z + dz * f;
        rs.vel.set((nx - cur.x) / dt, (ny - cur.y) / dt, (nz - cur.z) / dt);
        chassis.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
        const r = chassis.rotation();
        _remoteCarQ.set(r.x, r.y, r.z, r.w).slerp(_remoteCarQ2.set(rc.q[0], rc.q[1], rc.q[2], rc.q[3]), f);
        chassis.setNextKinematicRotation({ x: _remoteCarQ.x, y: _remoteCarQ.y, z: _remoteCarQ.z, w: _remoteCarQ.w });
        return;
      }
      if (rs.active) {
        chassis.setBodyType(rapier.RigidBodyType.Dynamic, true);
        chassis.setLinvel({ x: rs.vel.x, y: rs.vel.y, z: rs.vel.z }, true);
        chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
        rs.active = false;
      }
    }

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
          chassis.setTranslation({ x: flipPos.x, y: groundY + 1.2 * S, z: flipPos.z }, true);
          chassis.setRotation({ x: _uprightQuat.x, y: _uprightQuat.y, z: _uprightQuat.z, w: _uprightQuat.w }, true);
          chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
          chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
          flipTimer.current = 0;
        }
      } else {
        flipTimer.current = 0;
      }
    }

    const isAiDriving = !!patrolRoute && patrolRoute.length >= 2 && !humanIsDriving;
    const isCarActive = humanIsDriving || isAiDriving;
    if (isCarActive && frozenRef.current) {
      chassis.setBodyType(rapier.RigidBodyType.Dynamic, true);
      frozenRef.current = false;
    }

    // Unified telemetry for window.__sim (debug/simDebug.ts) -- same idea
    // as Airplane.tsx/Helicopter.tsx's reportTelemetry, adapted to this
    // vehicle's real DynamicRayCastVehicleController: "enginePower" here is
    // the last wheel engine force actually applied, normalized to
    // [-1, 1] by ENGINE_FORCE (this vehicle has no single 0..1 throttle
    // ramp like the air vehicles), and gear/steering/brake/AI-vs-human go
    // in `extra`.
    const reportTelemetry = (active: boolean, extra?: Record<string, unknown>) => {
      const rotT = chassis.rotation();
      _carTelQuat.set(rotT.x, rotT.y, rotT.z, rotT.w);
      _carTelEuler.setFromQuaternion(_carTelQuat, 'YXZ');
      const posT = chassis.translation();
      const velT = chassis.linvel();
      const angvelT = chassis.angvel();
      const collider0 = chassis.collider(0);
      let numContacts = 0;
      world.contactPairsWith(collider0, () => {
        numContacts += 1;
      });
      simDebug.registerVehicle('car', chassis, {
        id,
        active,
        paused: isPaused,
        enginePower: typeof extra?.engineForce === 'number' ? (extra.engineForce as number) / (ENGINE_FORCE * FORCE_SCALE) : 0,
        input: Object.fromEntries(Object.entries(input).filter(([, v]) => typeof v === 'boolean')),
        pos: [posT.x, posT.y, posT.z],
        quat: [rotT.x, rotT.y, rotT.z, rotT.w],
        eulerDeg: [
          THREE.MathUtils.radToDeg(_carTelEuler.y),
          THREE.MathUtils.radToDeg(_carTelEuler.x),
          THREE.MathUtils.radToDeg(_carTelEuler.z),
        ],
        vel: [velT.x, velT.y, velT.z],
        speed: Math.hypot(velT.x, velT.y, velT.z),
        localSpeed: typeof extra?.forwardSpeed === 'number' ? (extra.forwardSpeed as number) : null,
        angvel: [angvelT.x, angvelT.y, angvelT.z],
        sleeping: chassis.isSleeping(),
        friction: collider0 ? collider0.friction() : null,
        frictionCombineRule: collider0 ? collider0.frictionCombineRule() : null,
        numContacts,
        grounded: numContacts > 0,
        extra,
      });
    };

    // Only the driver's own key press flips THIS car's switch -- input is
    // a global keyboard read, so without the isCarActive gate every other
    // Car instance on screen (parked, or someone else's) would toggle its
    // headlights too every time anyone pressed L. The state update itself
    // (and the resulting mount/unmount of the actual light objects, see
    // the JSX below) only happens on the rare frame the key is pressed --
    // everywhere else this is a plain boolean read.
    if (humanIsDriving && input.consumeJustPressed('headlights')) {
      setHeadlightsOn((v) => !v);
    }

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
      // "oggetti lontani non calcolano fisica": parcheggiata, ferma, dritta
      // e lontana dal giocatore diventa un corpo FISSO (niente sospensioni
      // da integrare, fuori dal solutore; il corpo ha canSleep=false, quindi
      // dormire non basterebbe). Torna dinamica, ferma dov'era, appena il
      // giocatore si riavvicina.
      {
        const pp = useStore.getState().playerPos;
        const ct = chassis.translation();
        const dx = ct.x - pp[0],
          dz = ct.z - pp[2];
        const far = dx * dx + dz * dz > CAR_SLEEP_DIST * CAR_SLEEP_DIST;
        if (far) {
          if (frozenRef.current) return;
          // solo dopo che si e' posata davvero: ferma da un po' e con le
          // ruote a terra (appena nata e' ferma ma ancora in aria)
          const v = chassis.linvel();
          let grounded = true;
          for (let w = 0; w < controller.numWheels(); w++) grounded &&= controller.wheelIsInContact(w);
          if (grounded && v.x * v.x + v.y * v.y + v.z * v.z < 0.05 && _chassisUp.y > FLIP_UP_DOT_THRESHOLD) {
            settledRef.current += dt;
          } else {
            settledRef.current = 0;
          }
          if (settledRef.current > 1) {
            chassis.setBodyType(rapier.RigidBodyType.Fixed, false);
            frozenRef.current = true;
            settledRef.current = 0;
            return;
          }
        } else if (frozenRef.current) {
          chassis.setBodyType(rapier.RigidBodyType.Dynamic, true);
          chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
          chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
          frozenRef.current = false;
        }
      }
      controller.updateVehicle(dt, rapier.QueryFilterFlags.EXCLUDE_SENSORS, WHEEL_RAY_GROUPS);
      if (import.meta.env.DEV) reportTelemetry(false);
      return;
    }

    const rot = chassis.rotation();
    _chassisQuat.set(rot.x, rot.y, rot.z, rot.w);
    _forward.set(0, 0, 1).applyQuaternion(_chassisQuat);

    const linvel = chassis.linvel();
    _velVec.set(linvel.x, linvel.y, linvel.z);
    const speed = _velVec.dot(_forward);

    // -- AI patrol input, ported from FollowPath.ts/FollowTarget.ts (see
    // the big comment on PATROL_NODE_RADIUS above) -- only computed for an
    // AI-driven car; the real keyboard `input` is used untouched otherwise.
    let aiForward = false,
      aiBackward = false,
      aiLeft = false,
      aiRight = false;
    if (isAiDriving && patrolRoute && patrolRoute.length >= 2) {
      const posNow = chassis.translation();
      const wp = patrolRoute[aiTargetIndex.current];
      _aiViewDir.set(wp[0] - posNow.x, 0, wp[1] - posNow.z);
      const distToTarget = _aiViewDir.length();

      if (distToTarget > 0.001) {
        _aiViewDir.multiplyScalar(1 / distToTarget);

        // Throttle vs reverse: original's `forward.dot(viewVector) < 0.0`.
        aiBackward = _forward.dot(_aiViewDir) < 0;
        aiForward = !aiBackward;

        // Steering: which side of our own forward the target sits on,
        // using the same cross(dir, forward)/_up sign convention as the
        // driftCorrection computation just below (input.left -> positive
        // steeringSpring target in this codebase's convention).
        const angleToTarget = _forward.angleTo(_aiViewDir);
        if (angleToTarget > PATROL_STEER_DEADZONE) {
          _aiCross.crossVectors(_aiViewDir, _forward);
          if (_up.dot(_aiCross) < 0) aiLeft = true;
          else aiRight = true;
        }

        // Corner slowdown: brake (reverse) instead of accelerating into a
        // sharp upcoming turn -- original's slowDownAngle check against
        // the segment AFTER the current target node.
        const nextWp = patrolRoute[(aiTargetIndex.current + 1) % patrolRoute.length];
        const afterWp = patrolRoute[(aiTargetIndex.current + 2) % patrolRoute.length];
        _aiSegDir.set(afterWp[0] - nextWp[0], 0, afterWp[1] - nextWp[1]);
        if (_aiSegDir.lengthSq() > 0.001) {
          _aiSegDir.normalize();
          const slowDownDot = _aiViewDir.dot(_aiSegDir);
          if (
            slowDownDot < PATROL_CORNER_SLOWDOWN_DOT &&
            distToTarget < PATROL_CORNER_SLOWDOWN_DIST &&
            speed > PATROL_CORNER_SLOWDOWN_SPEED
          ) {
            aiForward = false;
            aiBackward = true;
          }
        }
      }

      // Stuck recovery, mirroring the original's staleTimer -> teleport
      // back above the current target node -- a patrol car wedged against
      // a curb/wall/another car otherwise stays stuck there forever.
      if (Math.abs(speed) < 1) {
        aiStaleTimer.current += dt;
      } else {
        aiStaleTimer.current = 0;
      }
      if (aiStaleTimer.current > PATROL_STUCK_TIMEOUT) {
        const groundY = getTerrainHeight(wp[0], wp[1]) + getRoadOffset(wp[0], wp[1]);
        const yaw = _uprightEuler.setFromQuaternion(_chassisQuat, 'YXZ').y;
        _uprightQuat.setFromEuler(_uprightEuler.set(0, yaw, 0));
        chassis.setTranslation({ x: wp[0], y: groundY + 1.2, z: wp[1] }, true);
        chassis.setRotation({ x: _uprightQuat.x, y: _uprightQuat.y, z: _uprightQuat.z, w: _uprightQuat.w }, true);
        chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
        chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
        aiStaleTimer.current = 0;
      }

      if (distToTarget < PATROL_NODE_RADIUS) {
        aiTargetIndex.current = (aiTargetIndex.current + 1) % patrolRoute.length;
      }
    }

    const activeForward = humanIsDriving ? input.forward : aiForward;
    const activeBackward = humanIsDriving ? input.backward : aiBackward;
    const activeLeft = humanIsDriving ? input.left : aiLeft;
    const activeRight = humanIsDriving ? input.right : aiRight;

    // Tuning telemetry (ENGINE_FORCE/BRAKE_FORCE/etc.) removed now that
    // the real Rapier vehicle controller is dialed in -- it was running 8
    // extra wheelIsInContact()/wheelSuspensionLength() physics queries
    // plus several array allocations every frame for whichever car was
    // being driven. "ok ma dobbiamo ottimizzare le performance perche e
    // rallentato il gioco" -- gone now, along with the matching per-frame
    // debug block below that ran the same kind of query for EVERY car
    // (parked ones included, ~35 in a full city), not just the driven one.

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
    // Tracks whatever was last actually handed to
    // controller.setWheelEngineForce() below -- purely for window.__sim's
    // telemetry (see reportTelemetry above), no effect on driving.
    let appliedEngineForce = 0;
    if (shiftTimer.current > 0) {
      shiftTimer.current = Math.max(0, shiftTimer.current - dt);
    } else if (activeBackward) {
      const powerFactor = (GEARS_MAX_SPEEDS['R'] * VS - speed) / Math.abs(GEARS_MAX_SPEEDS['R'] * VS);
      const force = ((ENGINE_FORCE * FORCE_SCALE) / gear.current) * Math.abs(powerFactor);
      // (segni come l'originale: con il veicolo di sketchbookRaycastVehicle
      // la forza positiva spinge indietro)
      appliedEngineForce = force;
      for (let i = 0; i < 4; i++) controller.setWheelEngineForce(i, force);
    } else {
      const top = GEARS_MAX_SPEEDS[String(gear.current)] * VS;
      const bottom = GEARS_MAX_SPEEDS[String(gear.current - 1)] * VS;
      const powerFactor = (top - speed) / (top - bottom);

      if (powerFactor < 0.1 && gear.current < MAX_GEARS) {
        gear.current += 1;
        shiftTimer.current = TIME_TO_SHIFT;
        for (let i = 0; i < 4; i++) controller.setWheelEngineForce(i, 0);
      } else if (gear.current > 1 && powerFactor > 1.2) {
        gear.current -= 1;
        shiftTimer.current = TIME_TO_SHIFT;
        for (let i = 0; i < 4; i++) controller.setWheelEngineForce(i, 0);
      } else if (activeForward) {
        const force = ((ENGINE_FORCE * FORCE_SCALE) / gear.current) * powerFactor;
        // avanti = forza negativa, come applyEngineForce(-force) dell'originale
        appliedEngineForce = -force;
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

    const speedFactor = THREE.MathUtils.clamp((speed / VS) * 0.3, 1, Number.MAX_VALUE);
    if (activeRight) {
      const steering = Math.min(-MAX_STEER_VAL / speedFactor, -driftCorrection);
      steeringSpring.current.target = THREE.MathUtils.clamp(steering, -MAX_STEER_VAL, MAX_STEER_VAL);
    } else if (activeLeft) {
      const steering = Math.max(MAX_STEER_VAL / speedFactor, -driftCorrection);
      steeringSpring.current.target = THREE.MathUtils.clamp(steering, -MAX_STEER_VAL, MAX_STEER_VAL);
    } else {
      steeringSpring.current.target = 0;
    }
    steeringSpring.current.simulate(dt);
    for (let j = 0; j < steeringIndices.length; j++) controller.setWheelSteering(steeringIndices[j], steeringSpring.current.position);

    // -- In aria e a ruote all'aria, come l'originale (Car.physicsPreStep):
    // sinistra/destra fanno ruotare l'auto attorno al suo asse lungo,
    // avanti/indietro la fanno beccheggiare. In aria l'effetto cresce in 2 s;
    // ferma e capovolta, sinistra/destra la fanno rigirare sulle ruote.
    {
      if (controller.numWheelsOnGround === 0) {
        airSpinTimer.current += dt;
        if (!activeForward) canTiltForwards.current = true;
      } else {
        canTiltForwards.current = false;
        airSpinTimer.current = 0;
      }
      const sp = speed / VS;
      const airInfluence = THREE.MathUtils.clamp(airSpinTimer.current / 2, 0, 1) * THREE.MathUtils.clamp(sp, 0, 1);
      _chassisUp.set(0, 1, 0).applyQuaternion(_chassisQuat);
      const flipOver = THREE.MathUtils.clamp(1 - sp, 0, 1) * (-_chassisUp.y / 2 + 0.5) * 3;
      // (originale: 0.15 rad/s per passo a 60 Hz, tetto 2 rad/s; tempi x sqrt(S))
      const accel = (0.15 * dt * 60) / VS;
      const maxSpin = 2 / VS;
      const av = chassis.angvel();
      _airAng.set(av.x, av.y, av.z);
      _airRight.set(1, 0, 0).applyQuaternion(_chassisQuat);
      const before = _airAng.lengthSq();
      if (activeRight && !activeLeft) {
        if (_airAng.dot(_forward) < maxSpin) _airAng.addScaledVector(_forward, accel * (airInfluence + flipOver));
      } else if (activeLeft && !activeRight) {
        if (_airAng.dot(_forward) > -maxSpin) _airAng.addScaledVector(_forward, -accel * (airInfluence + flipOver));
      }
      if (canTiltForwards.current && activeForward && !activeBackward) {
        if (_airAng.dot(_airRight) < maxSpin) _airAng.addScaledVector(_airRight, accel * airInfluence);
      } else if (activeBackward && !activeForward) {
        if (_airAng.dot(_airRight) > -maxSpin) _airAng.addScaledVector(_airRight, -accel * airInfluence);
      }
      if (_airAng.lengthSq() !== before) chassis.setAngvel({ x: _airAng.x, y: _airAng.y, z: _airAng.z }, true);
    }

    // -- Handbrake (Space), rear wheels only, matching the original.
    const brakeForce = input.jump ? BRAKE_FORCE * FORCE_SCALE : 0;
    for (let j = 0; j < rwdIndices.length; j++) controller.setWheelBrake(rwdIndices[j], brakeForce);

    controller.updateVehicle(dt, rapier.QueryFilterFlags.EXCLUDE_SENSORS, WHEEL_RAY_GROUPS);

    if (import.meta.env.DEV) {
      reportTelemetry(true, {
        engineForce: appliedEngineForce,
        forwardSpeed: speed,
        gear: gear.current,
        isAiDriving,
        humanIsDriving,
        steeringTarget: steeringSpring.current.target,
        steeringPosition: steeringSpring.current.position,
        brakeForce,
      });
    }
  });

  // "modelli semplificati da lontano": oltre CAR_LOD_DIST dalla telecamera
  // il modello (9 mesh) si nasconde e l'auto viene disegnata in blocco con
  // tutte le altre lontane (FarCars.tsx: 2 draw call per tutte).
  useFrame(({ camera }) => {
    const c = chassisRef.current;
    if (!c) return;
    const t = c.translation();
    const dx = t.x - camera.position.x,
      dz = t.z - camera.position.z;
    const far = !humanIsDriving && dx * dx + dz * dz > CAR_LOD_DIST * CAR_LOD_DIST;
    if (far !== !clonedScene.visible) {
      clonedScene.visible = !far;
      if (far) farCars.set(id, clonedScene);
      else farCars.delete(id);
    }
  });
  useEffect(
    () => () => {
      farCars.delete(id);
    },
    [id]
  );

  useFrame((state, delta) => {
    if (!chassisRef.current) return;
    // Freezes door-swing animation and the debug/entity-sync writes below
    // while paused -- this plain useFrame isn't stopped by <Physics
    // paused>, only the useBeforePhysicsStep block above is.
    if (isPaused) return;

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
      // The door being actively walked through this instant (mid entering/
      // exiting transition) always swings open; on top of that, ANY door
      // Player.tsx has marked as held-open in the store (openVehicleDoors --
      // set the moment it's walked through, cleared only once the
      // character's own close-door animation finishes, see store.ts) stays
      // open too. That's what lets the door hang open the whole time you're
      // stopped mid-drive instead of auto-closing the instant the
      // entering/exiting lerp itself ends.
      const transitioningDoor = isVehicleTransitioning && transitioningEntityId === id ? (transitioningDoorName ?? 'door_1') : null;
      const step = DOOR_ROTATION_SPEED * delta;
      for (const doorName in doorsRef.current) {
        const door = doorsRef.current[doorName];
        const isHeldOpen = !!openVehicleDoors[`${id}:${doorName}`];
        const target = doorName === transitioningDoor || isHeldOpen ? 1 : 0;
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
        const suspLen = controller.wheelSuspensionLength(i) ?? SUSPENSION_REST_LENGTH * S;
        const steerAngle = controller.wheelSteering(i) ?? 0;
        const spinAngle = controller.wheelRotation(i) ?? 0;

        const conn = wheelConnectionPoints[i];
        // (i nodi delle ruote stanno dentro il modello scalato: posizione
        // nel suo spazio = spazio della scocca / S)
        def.node.position.set(
          (conn.x + WHEEL_DIRECTION_AXIS.x * suspLen) / S,
          (conn.y + WHEEL_DIRECTION_AXIS.y * suspLen) / S,
          (conn.z + WHEEL_DIRECTION_AXIS.z * suspLen) / S
        );

        _steerQuat.setFromAxisAngle(WHEEL_UP_AXIS, steerAngle);
        _spinQuat.setFromAxisAngle(WHEEL_AXLE_AXIS, spinAngle);
        def.node.quaternion.copy(_steerQuat).multiply(_spinQuat);
      }
    }

    // solo l'auto guidata dal giocatore e' "il giocatore" (minimappa, missioni,
    // nemici): le auto in pattuglia non devono sovrascriverne la posizione
    if (humanIsDriving) setPlayerInfo([_carPos.x, _carPos.y, _carPos.z], _carEuler.y);

    // elapsedTime e non getElapsedTime(): quella chiama getDelta() e ruba
    // tempo al delta del frame dopo per TUTTI i useFrame (fisica compresa)
    if (state.clock.elapsedTime % 0.1 < 0.02) {
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
      rotation={rotation}
      linearDamping={0.01}
      angularDamping={0.01}
      canSleep={false}
      collisionGroups={groupsExcluding(CollisionGroups.Default)}
    >
      {CHASSIS_SHAPES.map((shape, i) => (
        <CuboidCollider
          key={i}
          args={[(shape.fullDimensions[0] / 2) * S, (shape.fullDimensions[1] / 2) * S, (shape.fullDimensions[2] / 2) * S]}
          position={[shape.position[0] * S, shape.position[1] * S, shape.position[2] * S]}
          // telaio "scivoloso" come l'originale (attrito 0.01): contro un muro
          // striscia invece di inchiodarsi
          friction={0.01}
          frictionCombineRule={CoefficientCombineRule.Min}
          restitution={0}
          // massa e baricentro li decide setAdditionalMassProperties (sopra)
          density={0}
        />
      ))}
      <primitive object={clonedScene} scale={S} />

      {/* Headlights -- conditionally mounted (see the big comment above):
          only exist in the scene graph at all while `headlightsOn`, so a
          parked/off car costs nothing extra. */}
      {headlightsOn && (
        <>
          <spotLight
            ref={leftHeadlightRef}
            position={[HEADLIGHT_X * S, HEADLIGHT_Y * S, HEADLIGHT_Z * S]}
            angle={0.45}
            penumbra={0.5}
            distance={26}
            decay={1}
            intensity={HEADLIGHT_INTENSITY}
            color="#fff4d6"
          />
          <object3D ref={leftHeadlightTargetRef} position={[HEADLIGHT_X * S, HEADLIGHT_Y * S - 1, HEADLIGHT_Z * S + 20]} />
          <mesh position={[HEADLIGHT_X * S, HEADLIGHT_Y * S, HEADLIGHT_Z * S]}>
            <sphereGeometry args={[0.06, 12, 12]} />
            <meshStandardMaterial color="#fffbe6" emissive="#fff4d6" emissiveIntensity={HEADLIGHT_BULB_EMISSIVE} toneMapped={false} />
          </mesh>

          <spotLight
            ref={rightHeadlightRef}
            position={[-HEADLIGHT_X * S, HEADLIGHT_Y * S, HEADLIGHT_Z * S]}
            angle={0.45}
            penumbra={0.5}
            distance={26}
            decay={1}
            intensity={HEADLIGHT_INTENSITY}
            color="#fff4d6"
          />
          <object3D ref={rightHeadlightTargetRef} position={[-HEADLIGHT_X * S, HEADLIGHT_Y * S - 1, HEADLIGHT_Z * S + 20]} />
          <mesh position={[-HEADLIGHT_X * S, HEADLIGHT_Y * S, HEADLIGHT_Z * S]}>
            <sphereGeometry args={[0.06, 12, 12]} />
            <meshStandardMaterial color="#fffbe6" emissive="#fff4d6" emissiveIntensity={HEADLIGHT_BULB_EMISSIVE} toneMapped={false} />
          </mesh>
        </>
      )}

      {/* "un character dentro un auto che gira in citta" -- the officer,
          only while an actual player hasn't taken the wheel (see
          humanIsDriving). Purely visual: the AI drives the RigidBody
          directly (activeForward/Backward/Left/Right above), same as a
          human would via the keyboard -- this is just who you see doing it. */}
      {patrolRoute && !humanIsDriving && officerSeatTransform && (
        <Officer seatPosition={officerSeatTransform.position} seatQuaternion={officerSeatTransform.quaternion} />
      )}
      {patrolRoute && !humanIsDriving && (
        <Html position={[0, 2.2, 0]} center distanceFactor={12} occlude={false}>
          <div
            style={{
              color: '#dfe9ff',
              background: 'rgba(10,30,80,0.65)',
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: 'bold',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
          >
            Polizia
          </div>
        </Html>
      )}
    </RigidBody>
  );
};

export default Car;
