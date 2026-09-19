import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { useRapier, interactionGroups } from "@react-three/rapier";
import type {
  RigidBody as RapierRigidBody,
  ImpulseJoint,
  Collider,
  KinematicCharacterController,
} from "@dimforge/rapier3d-compat";
import {
  CollisionGroups,
  groupsExcluding,
  SOLID_BODY_GROUPS,
} from "../../../enums/CollisionGroups";
import {
  RAGDOLL_PULSE_NEARBY,
  RAGDOLL_SEGMENTS,
  RAGDOLL_SEGMENT_FROZEN_BONES,
  RAGDOLL_HINGE_LIMITS_DEG,
  RAGDOLL_CONE_LIMIT_DEG,
  RagdollSegment,
  // "ogni parte del corpo deve essere un collider" -- SOLID_BODY_SEGMENTS
  // (RAGDOLL_SEGMENTS + hand/foot) is what ensureSolidBody/syncSolidBody
  // below actually build/track; the transient hit-pulse/death ragdoll
  // (buildBodies, further down this file) deliberately keeps reading
  // RAGDOLL_SEGMENTS alone -- see ragdollConfig.ts's own comment on why
  // hands/feet are solid-body-only.
  SOLID_BODY_SEGMENTS,
} from "./ragdollConfig";

// "riusciamo a Ricreare la fisica ragdoll attiva in stile Euphoria?" --
// vera Euphoria (NaturalMotion) e' tecnologia proprietaria, anni di lavoro
// di uno studio dedicato: non realisticamente ricreabile 1:1. Quello che
// SI puo' fare, e la tecnica reale dietro tanti indie con "ragdoll vivo",
// e' questo hook: un rig a capsule Rapier ispirato a epol1/trr (vedi
// ragdollConfig.ts), usato in due modi --
//   1. "ragdoll passivo" (activateDeath): permanente, crollo totale --
//      la fisica costruisce e guida TUTTO lo scheletro (11 corpi) per
//      sempre una volta morto. "1. crollo totale" -- voluto, non cambia.
//   2. "reazione ai colpi mentre vivo" (pulseHit): "vorrei qualcosa di
//      dinamico.. un contraccolpo su dove ho colpito" -- un impulso
//      fisico reale, ma SOLO sul pezzo colpito (piu' un arto vicino a
//      scelta, vedi ragdollConfig.ts's RAGDOLL_PULSE_NEARBY) mentre il
//      resto del corpo (bacino, gambe, tutto quanto non e' coinvolto)
//      resta guidato dall'animazione normale -- il personaggio incassa il
//      colpo e resta in piedi, non crolla per intero come nella morte. Il
//      pezzo colpito e' agganciato con un vero giunto fisico a un corpo
//      "fantasma" cinematico che ogni frame insegue la posizione live
//      dell'osso animato a cui sarebbe normalmente attaccato (vedi
//      buildBodies/syncAnchors) -- cosi' il contraccolpo e' fisica vera
//      (massa, smorzamento, inerzia), non solo un'animazione di reazione,
//      ma non puo' mai far crollare l'intero corpo. Non e' un vero layer
//      di motori-PD-continui (quello resterebbe il prossimo passo se
//      questo approccio non bastasse).
//
// Vale per QUALSIASI personaggio che usi lo scheletro soldier-citizen.glb
// (CombatSoldier.tsx e PlayerCombatSoldier.tsx) -- basta passargli il ref
// del gruppo che contiene le ossa clonate.

const HIT_PULSE_DURATION = 0.22; // secondi in cui il corpo e' guidato al 100% dalla fisica dopo un colpo -- "il contraccolpo e' troppo": accorciato cosi' la gravita'/inerzia ha meno tempo per trascinare l'arto prima che si rimetta a sfumare verso l'animazione
const HIT_BLEND_OUT_DURATION = 0.22; // secondi di sfumatura (slerp) verso l'animazione
// "quando nn mi muovo e l'avversario mi colpisce, la ragdoll si deforma ma
// nn torna allo stato normale" -- root cause: a fresh hit landing while a
// PREVIOUS pulse is still active fully resets pulseElapsed/blendElapsed back
// to 0 (see pulseHit's "already mid-pulse" branch below), so the whole
// HIT_PULSE_DURATION+HIT_BLEND_OUT_DURATION=0.44s recovery window restarts
// from scratch on every single re-hit. Standing still against an AI that
// keeps landing hits faster than that (Melee_Hook's own clip is only 0.458s
// long, and contact typically lands mid-swing, well under 0.44s apart) means
// the ragdoll can get re-triggered before it ever finishes blending out --
// active forever, reads as "stuck"/deformed. Moving away breaks the AI's
// line/range (or triggers a dodge), the hit-chain stops, and the LAST pulse
// finally gets to finish uninterrupted -- exactly "torna normale se mi muovo
// successivamente". Fix: cap how long an unbroken chain of re-hits can keep
// extending the timers (see chainElapsed) -- past this, a new hit still
// applies its impulse/marker/damage as normal, it just no longer resets the
// recovery clock, so the character is always guaranteed a full release
// within MAX_CHAIN_DURATION regardless of how relentlessly it's being hit.
const MAX_CHAIN_DURATION = 0.9;
const HIT_MARKER_DURATION = 0.3; // secondi di vita del lampo visivo sul punto colpito

// "voglio che il colpo avvenga proprio dove ho colpito, non in un range"
// -- a permanent (not pulse-only) sensor capsule approximating this
// fighter's standing body, feet to head, used purely for a real Rapier
// shape-intersection query in the attacker's checkAttackContact (see
// PlayerCombatSoldier.tsx/CombatSoldier.tsx) instead of hand-rolled
// distance math. HURTBOX_HEIGHT/RADIUS are deliberately independent of
// RAGDOLL_SEGMENTS' own per-limb capsules -- this is one coarse volume
// for "is this fighter's body here at all", not a per-body-part rig.
const HURTBOX_HEIGHT = 1.65; // feet to roughly head height
const HURTBOX_RADIUS = 0.33;
// Member of AND only collides-with Hurtbox -- so a query using this same
// group only ever matches another fighter's hurtbox, never terrain,
// ragdoll pieces, or anything else sharing the physics world.
const HURTBOX_GROUPS = interactionGroups(
  [CollisionGroups.Hurtbox],
  [CollisionGroups.Hurtbox]
);
const HAND_QUERY_RADIUS = 0.06; // tiny sphere cast at the attacking hand's position, see pointIntersectsHurtbox
const _identityRot = { x: 0, y: 0, z: 0, w: 1 };

interface BodyEntry {
  segment: RagdollSegment;
  body: RapierRigidBody;
  bone: THREE.Bone;
  // The bone's own LOCAL position at the moment its body was created --
  // i.e. whatever the AnimationMixer had already written for it (bone
  // lengths are constant for a normal skeletal rig, so this is the
  // "correct" resting offset). Captured so syncBonesFromPhysics can lerp
  // back to it during blend-out instead of leaving position frozen at
  // wherever gravity/impulse last placed it -- see that function's comment.
  restLocalPos: THREE.Vector3;
  // Same idea as restLocalPos, but for rotation -- see
  // frozenBoneRestQuatRef's big comment (above bodiesRef's own
  // declaration) for why this turned out to be necessary too: a
  // DRIVING bone whose currently-playing clip happens to hold it at a
  // constant rotation (this rig's spine_01 does, in "Fighting Idle")
  // hits the exact same AnimationMixer cache-skip issue as a frozen
  // companion bone once syncBonesFromPhysics has been overwriting it --
  // position already gets an explicit restLocalPos to fall back to on
  // release, rotation did not, so on a constant track it stayed
  // wherever the last real physics frame left it, forever. Restored
  // explicitly alongside restLocalPos on full release, same as every
  // other bone touched here.
  restQuat: THREE.Quaternion;
  // This segment's rotation relative to its PARENT's rotation, at the
  // moment its body was created (i.e. the "neutral" joint pose, whatever
  // the character was actually doing -- mid-punch, mid-run -- when the
  // hit landed). Only set for segments that have a parent (not Hips) AND
  // aren't one of the hinge joints (ForeArm_*/Shin_*, which get a real
  // Rapier revolute limit instead -- see buildBodies). clampJointCones
  // uses this every frame to measure how far a ball-and-socket joint
  // (spine/neck/shoulder/hip) has rotated away from that neutral pose in
  // ANY direction, and pulls it back once it exceeds RAGDOLL_CONE_LIMIT_RAD
  // -- "le parti del corpo devono seguire sempre i constraint dell
  // anatomia umana".
  restRelativeQuat?: THREE.Quaternion;
}

// A kinematic (position-driven, unaffected by forces/gravity) stand-in
// for a segment's parent bone whenever that parent ISN'T itself one of
// the currently-active ragdoll bodies -- see buildBodies. `bone` is
// tracked every frame (syncAnchors) so the anchor follows wherever the
// still-animated skeleton actually moves it.
interface AnchorEntry {
  body: RapierRigidBody;
  bone: THREE.Bone;
}

// One of a fighter's 11 PERMANENT solid-body colliders (see
// ensureSolidBody/syncSolidBody/resolveBodyMovement below) -- unlike
// BodyEntry above (a transient, DYNAMIC ragdoll piece that only exists
// during a hit-pulse/death), these are always there for as long as the
// fighter is, kinematic (position-driven, following the LIVE animated
// bone every frame, not physically simulated themselves), and are what
// actually stands in for "this body part is solid" for movement
// blocking + pushing the punching bag. halfHeight/radius are captured
// once at creation (a bone's own length never changes) so syncSolidBody
// only ever needs to re-derive this frame's POSITION/ROTATION, not
// re-measure the shape itself.
interface SolidBodyEntry {
  body: RapierRigidBody;
  collider: Collider;
  halfHeight: number;
  radius: number;
}

// Plain-data snapshot shape returned by getSolidBodySegments (see below)
// -- named explicitly rather than inferred from that function's own
// return type, since TS can't reference a function's own inferred return
// type from inside its own body.
export interface SolidBodySegmentDebug {
  name: string;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  halfHeight: number;
  radius: number;
}

interface RagdollState {
  active: boolean;
  isDeath: boolean;
  pulseElapsed: number;
  blendElapsed: number;
  // Real time (seconds) since the FIRST hit of the current unbroken re-hit
  // chain -- see MAX_CHAIN_DURATION above. Reset to 0 only when the ragdoll
  // actually goes back to freshState() (a full, uninterrupted release).
  chainElapsed: number;
}

export interface RagdollController {
  isActive: () => boolean;
  isDeath: () => boolean;
  activateDeath: () => void;
  pulseHit: (
    worldImpulseDir: THREE.Vector3,
    magnitude: number,
    atSegment?: string,
    attackerX?: number,
    attackerZ?: number
  ) => void;
  update: (delta: number) => void;
  deactivate: () => void;
  // "il colpo deve essere sferrato dove effettivamente le mesh collidono"
  // -- lets the combat code (PlayerCombatSoldier.tsx/CombatSoldier.tsx)
  // track a fighter's OWN hand bones every frame during a swing, to
  // resolve a hit against real reach instead of a single distance check
  // taken the instant the attack button is pressed. Reuses this file's
  // own bone cache (resolveBones/bonesRef) rather than making combat code
  // walk the skeleton a second time. Returns false (and leaves `target`
  // untouched) if the rig has no bone by that name.
  getBoneWorldPosition: (boneName: string, target: THREE.Vector3) => boolean;
  // "voglio che il colpo avvenga proprio dove ho colpito, non in un
  // range" -- a real Rapier sensor collider (see HURTBOX_* below)
  // representing this fighter's standing body, lazily created on first
  // use and kept following modelRootRef every update() call. Returns
  // null until the first update() has run (nothing to attack before
  // then).
  getHurtboxHandle: () => number | null;
  // Casts a tiny sphere at `worldPos` and checks whether the Hurtbox-group
  // collider it lands on is specifically the one identified by
  // `targetHandle` (another fighter's own getHurtboxHandle() result) --
  // a genuine Rapier shape-intersection query, not distance math.
  pointIntersectsHurtbox: (
    worldPos: THREE.Vector3,
    targetHandle: number
  ) => boolean;
  // "mi piacerebbe che il busto seguisse il movimento" / "le gambe nn
  // devono ruotare secondo l'orbit control" -- tilts the spine forward/
  // back by `pitchRad` (camera up/down look) AND twists it left/right by
  // `yawRad` (camera yaw relative to the legs, which auto-face the
  // opponent independently -- see PlayerCombatSoldier.tsx) as ONE
  // absolute local-space rotation per bone, entirely replacing whatever
  // the AnimationMixer just set this frame for spine_02/03 (no animation
  // blending at all -- "nessuna animazione si deve intromettere nella sua
  // inclinazione"). Only the player's own fighter calls this
  // (PlayerCombatSoldier.tsx, driven by the camera), the AI never does.
  // No-ops while a hit-pulse or death is active so it doesn't fight the
  // ragdoll physics.
  applySpineLean: (pitchRad: number, yawRad: number) => void;
  // "nn voglio che usi distanze per fermarlo.. ogni parte del corpo deve
  // essere un collider.. se collide collide.. se sbatto col sacco dovrei
  // muoverlo" -- the real per-limb movement resolution (see
  // resolveBodyMovement's own comment above for the full explanation).
  // Lazily builds this fighter's 11 permanent solid colliders on first
  // call. Pass the bag's own solid-collider handle (null before
  // PunchingBag.tsx has reported it) and an onBagBump callback to also
  // get real "I bumped into it" push feedback, not just blocking.
  resolveBodyMovement: (
    desiredX: number,
    desiredZ: number,
    bagSolidHandle: number | null,
    onBagBump?: (worldPoint: THREE.Vector3, worldDir: THREE.Vector3, blockedAmount: number) => void
  ) => { x: number; z: number };
  // "fai riferimenti visivi per ragdoll e fisica dei solidi" -- live
  // snapshot of all 11 solid colliders' world transforms, for a debug
  // wireframe renderer. Empty array before resolveBodyMovement has ever
  // run once.
  getSolidBodySegments: () => SolidBodySegmentDebug[];
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _worldMatrix = new THREE.Matrix4();
const _parentInverse = new THREE.Matrix4();
const _unitScale = new THREE.Vector3(1, 1, 1);
const _yAxis = new THREE.Vector3(0, 1, 0);
const _xAxis = new THREE.Vector3(1, 0, 0);
// Split across both spine bones rather than piling the whole tilt onto
// one joint -- reads as a smoother, more natural bend (same reasoning as
// RAGDOLL_SEGMENT_FROZEN_BONES.Torso already grouping these two).
const SPINE_LEAN_BONES = ["spine_02", "spine_03"];
// Each spine bone's own TWIST axis ("up the spine", to rotate left/right
// around) is derived geometrically from its own child bone's rest
// position rather than guessed as a raw local axis name -- this file
// already hit two real bugs (a compounding bug, then a genuine sign bug)
// guessing spine_02/03's local axis convention for pitch alone, so the
// yaw/twist axis is computed instead (see applySpineLean below).
// pelvis -> spine_01 -> spine_02 -> spine_03 -> neck_01 -> head, per
// ragdollConfig.ts's Torso segment (spine_01 -> neck_01).
const SPINE_LEAN_CHILD_BONE: Record<string, string> = {
  spine_02: "spine_03",
  spine_03: "neck_01",
};
// Defense in depth -- PlayerCombatSoldier.tsx already clamps what it
// passes in, but applySpineLean re-clamps here too rather than trusting
// every future caller to remember.
const SPINE_LEAN_MAX_RAD = THREE.MathUtils.degToRad(40);
// Wider than the pitch clamp -- "le gambe nn devono ruotare secondo
// l'orbit control" moved leg-facing off the camera entirely, so the
// torso alone now has to cover the full left/right aim range on top of
// whatever way the legs happen to be squared up, same idea as a real
// boxer's hips-vs-shoulders separation.
const SPINE_TWIST_MAX_RAD = THREE.MathUtils.degToRad(80);
const _spineTwistAxis = new THREE.Vector3();
const _spinePitchQuat = new THREE.Quaternion();
const _spineTwistQuat = new THREE.Quaternion();
const _identityQuat = new THREE.Quaternion();
const _segmentByName: Record<string, RagdollSegment> = {};
for (const seg of RAGDOLL_SEGMENTS) _segmentByName[seg.name] = seg;

const RAGDOLL_CONE_LIMIT_RAD: Record<string, number> = {};
for (const key of Object.keys(RAGDOLL_CONE_LIMIT_DEG)) {
  RAGDOLL_CONE_LIMIT_RAD[key] = THREE.MathUtils.degToRad(
    RAGDOLL_CONE_LIMIT_DEG[key]
  );
}

// "ogni parte del corpo deve essere un collider.. se collide collide..
// se sbatto col sacco dovrei muoverlo" -- own dedicated scratch set for
// the permanent solid-body system below (ensureSolidBody/syncSolidBody/
// resolveBodyMovement), same "give it its own set" reasoning as
// clampJointCones' own _cone* scratch pair just below.
const _solidV1 = new THREE.Vector3();
const _solidV2 = new THREE.Vector3();
const _solidDir = new THREE.Vector3();
const _solidCenter = new THREE.Vector3();
const _solidRot = new THREE.Quaternion();
const _solidBumpPoint = new THREE.Vector3();
const _solidBumpDir = new THREE.Vector3();

// Scratch quaternions for clampJointCones -- kept separate from this
// file's other _q1/_q2 scratch pair since buildBodies (which also uses
// _q1/_q2) and clampJointCones never run inside the same call stack, but
// giving this its own set avoids any future ordering footgun between them.
const _coneParentQuat = new THREE.Quaternion();
const _coneChildQuat = new THREE.Quaternion();
const _coneRelQuat = new THREE.Quaternion();
const _coneDeltaQuat = new THREE.Quaternion();
const _coneClampedDelta = new THREE.Quaternion();
const _coneCorrectedRel = new THREE.Quaternion();
const _coneCorrectedWorld = new THREE.Quaternion();

function freshState(): RagdollState {
  return { active: false, isDeath: false, pulseElapsed: 0, blendElapsed: 0, chainElapsed: 0 };
}

export function useRagdoll(
  modelRootRef: React.RefObject<THREE.Object3D | null>
): RagdollController {
  const { world, rapier } = useRapier();
  const { scene } = useThree();

  const bonesRef = useRef<Record<string, THREE.Bone> | null>(null);
  const bodiesRef = useRef<Record<string, BodyEntry>>({});
  const anchorsRef = useRef<Record<string, AnchorEntry>>({});
  // "la ragdoll si deforma ma nn torna allo stato normale" (quando
  // il personaggio resta fermo) -- root cause, confirmed live in the
  // browser: RAGDOLL_SEGMENT_FROZEN_BONES bones (spine_02/03,
  // clavicle_l/r, hand_l/r, foot_l/r, ball_l/r) get hard-forced to
  // THREE.Quaternion.identity() every frame their owning segment is
  // active (see syncBonesFromPhysics below). That's fine WHILE active,
  // but once the pulse fully releases, the AnimationMixer never takes
  // these particular bones back: for a bone whose current clip track is
  // CONSTANT (this rig's idle poses hold spine_02/03/clavicle_l/r dead
  // still -- confirmed by parsing the GLB, 2 identical keyframes), THREE's
  // PropertyMixer compares its newly-interpolated value against its OWN
  // cache of what it last wrote, not against the bone's actual live
  // value -- so once we've externally overwritten the bone to identity,
  // the mixer keeps computing the SAME constant value it always did,
  // matches its stale cache, and silently skips re-applying it forever.
  // (Driving bones like thigh_l/upperarm_l never hit this because their
  // idle tracks keep changing frame to frame, forcing a real rewrite
  // every time regardless of what else touched them meanwhile.)
  // Fix: capture each frozen bone's own correct quaternion the moment
  // its segment starts simulating (below, in buildBodies) -- same idea
  // as BodyEntry.restLocalPos for a driving bone's position -- and
  // explicitly restore it ourselves on full release (see update()'s
  // weight<=0 branch) instead of trusting the mixer to notice.
  const frozenBoneRestQuatRef = useRef<Record<string, THREE.Quaternion>>({});
  const jointsRef = useRef<ImpulseJoint[]>([]);
  const stateRef = useRef<RagdollState>(freshState());
  const hurtboxRef = useRef<{
    body: RapierRigidBody;
    collider: Collider;
  } | null>(null);
  // "ogni parte del corpo deve essere un collider" -- the 11 permanent
  // solid-body colliders (see SolidBodyEntry above), keyed by segment
  // name same as bodiesRef. Empty until the caller's first
  // ensureSolidBody()/resolveBodyMovement() call -- a fighter that never
  // calls either (every CombatSoldier.tsx instance in the 120-fighter
  // FFA arena, which never opts in) allocates NONE of this, zero extra
  // physics cost for them.
  const solidBodiesRef = useRef<Record<string, SolidBodyEntry>>({});
  // "ogni parte del corpo deve essere un collider" also means every part
  // is naturally touching/overlapping its OWN neighbours at rest (an
  // UpperArm capsule meets its own Torso at the shoulder, a Thigh meets
  // the Hips, etc -- that's what makes it an anatomically-correct rig in
  // the first place). Without excluding them, each limb's own
  // computeColliderMovement query below would detect this fighter's
  // OTHER 10 parts as blocking obstacles too (they're SOLID_BODY_GROUPS
  // members just like the opponent/bag), which -- since they're already
  // overlapping BEFORE any movement -- permanently freezes movement at
  // zero. This set of this fighter's OWN collider handles is what the
  // resolveBodyMovement filterPredicate below excludes, so only the
  // OPPONENT's 11 parts and the bag's solid collider ever actually block.
  const ownColliderHandlesRef = useRef<Set<number>>(new Set());
  // This fighter's own character controller for the solid-body movement
  // queries -- separate instance from the transient ragdoll's own joints/
  // bodies above, lazily created alongside the first solid-body segment.
  const solidControllerRef = useRef<KinematicCharacterController | null>(null);

  // "metti un segnale su dove e' stato colpito" -- a single reusable
  // glowing marker per character, lazily created on the first hit that
  // actually needs it (so a fighter that's never hit, e.g. most of the
  // 120 in CombatArena.tsx which don't even have ragdoll enabled, never
  // allocates one). Repositioned and re-triggered on every subsequent hit
  // rather than spawning a new object each time.
  const markerRef = useRef<THREE.Mesh | null>(null);
  const markerElapsedRef = useRef(0);

  const resolveBones = useCallback((): Record<string, THREE.Bone> | null => {
    if (bonesRef.current) return bonesRef.current;
    const root = modelRootRef.current;
    if (!root) return null;
    const map: Record<string, THREE.Bone> = {};
    root.traverse((obj) => {
      if ((obj as THREE.Bone).isBone) map[obj.name] = obj as THREE.Bone;
    });
    bonesRef.current = map;
    return map;
  }, [modelRootRef]);

  // Lazily creates this fighter's permanent hurtbox (see HURTBOX_* above)
  // -- a KINEMATIC (position-driven, no physics response needed -- it's
  // a sensor, purely for intersection queries) capsule, built once and
  // then just repositioned every frame by syncHurtbox. Unlike the live-
  // pulse ragdoll bodies, this is NOT torn down between hits -- it lives
  // for as long as the fighter does.
  const ensureHurtbox = useCallback((): {
    body: RapierRigidBody;
    collider: Collider;
  } | null => {
    if (hurtboxRef.current) return hurtboxRef.current;
    const root = modelRootRef.current;
    if (!root) return null;
    root.getWorldPosition(_v1);
    const bodyDesc =
      rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(
        _v1.x,
        _v1.y + HURTBOX_HEIGHT / 2,
        _v1.z
      );
    const body = world.createRigidBody(bodyDesc);
    const halfHeight = Math.max(0.01, HURTBOX_HEIGHT / 2 - HURTBOX_RADIUS);
    const colliderDesc = rapier.ColliderDesc.capsule(halfHeight, HURTBOX_RADIUS)
      .setSensor(true)
      .setCollisionGroups(HURTBOX_GROUPS)
      .setSolverGroups(HURTBOX_GROUPS);
    const collider = world.createCollider(colliderDesc, body);
    const entry = { body, collider };
    hurtboxRef.current = entry;
    return entry;
  }, [rapier, world, modelRootRef]);

  // Every update() frame: re-centers the hurtbox capsule on wherever the
  // character's root actually is right now (same live-tracking idea as
  // syncAnchors, just for one permanent collider instead of several
  // transient ones).
  const syncHurtbox = useCallback(() => {
    const entry = ensureHurtbox();
    if (!entry) return;
    const root = modelRootRef.current;
    if (!root) return;
    root.getWorldPosition(_v1);
    entry.body.setNextKinematicTranslation({
      x: _v1.x,
      y: _v1.y + HURTBOX_HEIGHT / 2,
      z: _v1.z,
    });
  }, [ensureHurtbox, modelRootRef]);

  // "nn voglio che usi distanze per fermarlo.. il suo corpo e' solido
  // nelle sue parti quindi nn deve servire la distanza.. se collide
  // collide.. ogni parte del corpo deve essere un collider" -- lazily
  // builds this fighter's 11 PERMANENT solid-body colliders (see
  // SolidBodyEntry above), one real capsule per RAGDOLL_SEGMENT (Hips,
  // Torso, Head, both upper/fore arms, both thighs/shins), sized off the
  // SAME live-bone measurement buildBodies already uses for the transient
  // hit-pulse rig (distance between drivingBone and toBone), just kept
  // permanently instead of only existing while a hit pulse is active.
  // Called (idempotently) from resolveBodyMovement below, so simply never
  // calling resolveBodyMovement (every CombatSoldier.tsx in the 120-
  // fighter FFA arena) means this never runs and never allocates a single
  // extra Rapier body.
  const ensureSolidBody = useCallback((): boolean => {
    if (Object.keys(solidBodiesRef.current).length > 0) return true;
    const bones = resolveBones();
    if (!bones) return false;

    if (!solidControllerRef.current) {
      // Same skin-margin/hit-and-stop reasoning as the old
      // useDuelBodyCollider.tsx's single capsule (now removed) -- see its
      // own comment history: setSlideEnabled(false) avoids a real,
      // previously-hit numerical-drift bug where hit-and-SLIDE let a
      // mover slip around an obstacle when a second same-group collider
      // was also nearby. With 11 real colliders per fighter now
      // routinely near each other, that scenario is the NORM rather than
      // an edge case, so hit-and-stop stays the only safe choice here.
      const controller = world.createCharacterController(0.02);
      controller.setSlideEnabled(false);
      solidControllerRef.current = controller;
    }

    const entries = solidBodiesRef.current;
    for (const segment of SOLID_BODY_SEGMENTS) {
      const bone = bones[segment.drivingBone];
      const toBone = bones[segment.toBone];
      if (!bone || !toBone) continue; // this rig doesn't have the bone -- skip gracefully, same as buildBodies

      bone.getWorldPosition(_solidV1);
      toBone.getWorldPosition(_solidV2);
      const length = Math.max(0.05, _solidV1.distanceTo(_solidV2) * (segment.lengthScale ?? 0.92));
      const halfHeight = Math.max(0.01, length / 2 - segment.radius);

      // World-space capsule center/orientation computed directly (unlike
      // buildBodies' transient bodies, which set the BODY to the bone's
      // own raw transform and give the collider a local offset instead --
      // that's needed there because the dynamic body's rotation has to
      // track the bone exactly for the joint solver; here the body IS the
      // capsule, repositioned/reoriented wholesale every frame by
      // syncSolidBody, so there's nothing local-offset math would buy us).
      const dir = _solidDir.copy(_solidV2).sub(_solidV1);
      const dist = dir.length() || 1;
      dir.normalize();
      const center = _solidCenter.copy(_solidV1).addScaledVector(dir, Math.min(dist / 2, length / 2));
      const rot = _solidRot.setFromUnitVectors(_yAxis, dir);

      const bodyDesc = rapier.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(center.x, center.y, center.z)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
      const body = world.createRigidBody(bodyDesc);
      const colliderDesc = rapier.ColliderDesc.capsule(halfHeight, segment.radius)
        .setCollisionGroups(SOLID_BODY_GROUPS)
        .setSolverGroups(SOLID_BODY_GROUPS);
      const collider = world.createCollider(colliderDesc, body);

      entries[segment.name] = { body, collider, halfHeight, radius: segment.radius };
      ownColliderHandlesRef.current.add(collider.handle);
    }
    return Object.keys(entries).length > 0;
  }, [rapier, world, resolveBones]);

  // Every update() frame (unconditionally, like syncHurtbox -- both are
  // permanent, always-on trackers, not tied to the transient pulse/death
  // state below): re-centers/re-orients each of the 11 solid colliders on
  // wherever its own bone ACTUALLY is right now, i.e. this frame's real
  // animated pose (walking, mid-punch, whatever) -- BEFORE
  // resolveBodyMovement runs and shape-casts them forward by this frame's
  // desired movement delta. A no-op until ensureSolidBody has actually
  // built the rig.
  const syncSolidBody = useCallback(() => {
    const entries = solidBodiesRef.current;
    if (Object.keys(entries).length === 0) return;
    const bones = resolveBones();
    if (!bones) return;

    for (const segment of SOLID_BODY_SEGMENTS) {
      const entry = entries[segment.name];
      if (!entry) continue;
      const bone = bones[segment.drivingBone];
      const toBone = bones[segment.toBone];
      if (!bone || !toBone) continue;

      bone.getWorldPosition(_solidV1);
      toBone.getWorldPosition(_solidV2);
      const dir = _solidDir.copy(_solidV2).sub(_solidV1);
      const dist = dir.length() || 1;
      dir.normalize();
      // Bone lengths don't change frame to frame -- reuse the length this
      // segment was originally measured at (entry.halfHeight/radius) so a
      // limb held at an odd angle a given frame (dist can shrink toward 0
      // when a bone points straight at the camera, purely a projection
      // artifact) never shrinks the capsule itself, only repositions it.
      const length = entry.halfHeight * 2 + entry.radius * 2;
      const center = _solidCenter.copy(_solidV1).addScaledVector(dir, Math.min(dist / 2, length / 2));
      const rot = _solidRot.setFromUnitVectors(_yAxis, dir);

      // Direct + synchronous (setTranslation/setRotation, not
      // setNextKinematicTranslation) -- see useDuelBodyCollider.tsx's own
      // (now-removed) history for the real bug this avoids: a queued
      // "next" translation isn't visible to any query run before the
      // world's own next step(), which would make resolveBodyMovement see
      // a stale pose for whichever of a fighter's 11 parts happens to run
      // its query first. propagateModifiedBodyPositionsToColliders() is
      // called ONCE after this whole loop (not per-segment) purely as a
      // batching optimization -- it doesn't need to run per-collider.
      entry.body.setTranslation({ x: center.x, y: center.y, z: center.z }, true);
      entry.body.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }, true);
    }
    world.propagateModifiedBodyPositionsToColliders();
  }, [resolveBones, world]);

  // "se collide collide.. se sbatto col sacco dovrei muoverlo" -- the
  // actual movement resolution: given how far this fighter WANTS to move
  // this frame (desiredX/desiredZ, horizontal only, world-space -- same
  // convention useDuelBodyCollider.tsx's own resolveMovement used), runs
  // a REAL character-controller shape-cast for EVERY ONE of this
  // fighter's 11 solid-body colliders (not one synthetic whole-body
  // capsule), and returns however much of that movement the MOST
  // restrictive part actually allows -- exactly "ogni parte del corpo
  // deve essere un collider" instead of a single approximate radius: an
  // outstretched arm can get blocked (or bump the bag) well before the
  // torso's own center would ever have been close enough for the old
  // distance-based capsule to notice.
  //
  // `bagSolidHandle`/`onBagBump`: while iterating each part's own
  // computedCollision() results, any collision against the bag's SOLID
  // collider (as opposed to the opponent's own body parts, which just
  // block silently) is reported back via onBagBump with the real Rapier
  // contact point (witness1) and how much movement was actually blocked
  // -- PlayerCombatSoldier.tsx/CombatSoldier.tsx then forward that
  // straight into PunchingBag.tsx's own applyBodyBump, a real impulse,
  // not a scripted animation -- "se sbatto col sacco dovrei muoverlo".
  const resolveBodyMovement = useCallback(
    (
      desiredX: number,
      desiredZ: number,
      bagSolidHandle: number | null,
      onBagBump?: (worldPoint: THREE.Vector3, worldDir: THREE.Vector3, blockedAmount: number) => void
    ): { x: number; z: number } => {
      if (!ensureSolidBody()) return { x: desiredX, z: desiredZ };
      const controller = solidControllerRef.current;
      const entries = solidBodiesRef.current;
      if (!controller) return { x: desiredX, z: desiredZ };

      const desiredMagSq = desiredX * desiredX + desiredZ * desiredZ;
      let bestX = desiredX;
      let bestZ = desiredZ;
      let bestMagSq = desiredMagSq;

      const names = Object.keys(entries);
      const ownHandles = ownColliderHandlesRef.current;
      // Never treat this fighter's OWN other 10 body-part colliders as
      // obstacles for the 11th -- see ownColliderHandlesRef's own comment
      // above for why that would otherwise permanently freeze movement.
      const excludeOwnParts = (c: Collider) => !ownHandles.has(c.handle);
      for (const name of names) {
        const entry = entries[name];
        controller.computeColliderMovement(
          entry.collider,
          { x: desiredX, y: 0, z: desiredZ },
          undefined,
          SOLID_BODY_GROUPS,
          excludeOwnParts
        );
        const corrected = controller.computedMovement();
        const magSq = corrected.x * corrected.x + corrected.z * corrected.z;
        if (magSq < bestMagSq) {
          bestMagSq = magSq;
          bestX = corrected.x;
          bestZ = corrected.z;
        }

        if (onBagBump && bagSolidHandle !== null) {
          const numCollisions = controller.numComputedCollisions();
          for (let i = 0; i < numCollisions; i++) {
            const collision = controller.computedCollision(i);
            if (!collision || !collision.collider) continue;
            if (collision.collider.handle !== bagSolidHandle) continue;
            const remaining = collision.translationDeltaRemaining;
            const blocked = Math.hypot(remaining.x, remaining.z);
            if (blocked <= 0.0005) continue;
            _solidBumpPoint.set(collision.witness1.x, collision.witness1.y, collision.witness1.z);
            _solidBumpDir.set(desiredX, 0, desiredZ);
            onBagBump(_solidBumpPoint, _solidBumpDir, blocked);
          }
        }
      }

      // Commit: shift every one of this fighter's own 11 colliders by the
      // SAME final corrected delta (a uniform rigid translation of the
      // whole already-measured rig), so the OPPONENT's own
      // resolveBodyMovement call later this frame (or next frame) sees
      // this frame's real, final positions -- NOT re-derived from bones
      // (which wouldn't reflect this decision until next frame's matrix
      // update anyway, see syncSolidBody's own comment).
      for (const name of names) {
        const entry = entries[name];
        const t = entry.body.translation();
        entry.body.setTranslation({ x: t.x + bestX, y: t.y, z: t.z + bestZ }, true);
      }
      world.propagateModifiedBodyPositionsToColliders();

      return { x: bestX, z: bestZ };
    },
    [ensureSolidBody, world]
  );

  // "fai riferimenti visivi per ragdoll e fisica dei solidi" -- read-only
  // snapshot of all 11 solid-body colliders' LIVE world transforms, for a
  // debug wireframe renderer (PlayerCombatSoldier.tsx/CombatSoldier.tsx,
  // gated behind the shared showPhysicsDebug store flag) to draw exactly
  // what's actually colliding, not what the mesh LOOKS like. Deliberately
  // NOT called every frame regardless -- only when that debug flag is on
  // -- so it costs nothing for the common case.
  const getSolidBodySegments = useCallback((): SolidBodySegmentDebug[] => {
    const entries = solidBodiesRef.current;
    const out: SolidBodySegmentDebug[] = [];
    for (const name of Object.keys(entries)) {
      const e = entries[name];
      const t = e.body.translation();
      const r = e.body.rotation();
      out.push({ name, x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w, halfHeight: e.halfHeight, radius: e.radius });
    }
    return out;
  }, []);

  const destroyBodies = useCallback(() => {
    for (const joint of jointsRef.current) {
      world.removeImpulseJoint(joint, true);
    }
    jointsRef.current = [];
    for (const key of Object.keys(bodiesRef.current)) {
      world.removeRigidBody(bodiesRef.current[key].body);
    }
    bodiesRef.current = {};
    for (const key of Object.keys(anchorsRef.current)) {
      world.removeRigidBody(anchorsRef.current[key].body);
    }
    anchorsRef.current = {};
  }, [world]);

  // Explicitly hands every bone this pulse ever touched -- both each
  // segment's own DRIVING bone (thigh_l, upperarm_l, spine_01, ...) and
  // its frozen companions (spine_02/03, clavicle_l/r, hand_l/r,
  // foot_l/r, ball_l/r) -- back to its own captured rest quaternion,
  // instead of leaving it wherever syncBonesFromPhysics last set it and
  // trusting the AnimationMixer to reclaim it. See frozenBoneRestQuatRef
  // and BodyEntry.restQuat's own comments for why the mixer can't
  // actually be trusted to do that on its own for a bone whose current
  // clip happens to hold it at a CONSTANT rotation (spine_01 in
  // "Fighting Idle" turned out to be just as affected as the frozen
  // companions -- this isn't only a frozen-bones problem). Called once,
  // right when a pulse fully releases (update()'s weight<=0 branch),
  // BEFORE destroyBodies() clears bodiesRef -- NOT every frame, since
  // after this the mixer is exactly as free to keep driving these bones
  // as any other (this only fixes the one frame where its own internal
  // cache would otherwise wrongly think nothing needs to change).
  const restoreBonesToAnimation = useCallback(() => {
    const bones = resolveBones();
    if (bones) {
      for (const key of Object.keys(bodiesRef.current)) {
        const entry = bodiesRef.current[key];
        entry.bone.quaternion.copy(entry.restQuat);
      }
      const rest = frozenBoneRestQuatRef.current;
      for (const name of Object.keys(rest)) {
        const bone = bones[name];
        if (bone) bone.quaternion.copy(rest[name]);
      }
    }
    frozenBoneRestQuatRef.current = {};
  }, [resolveBones]);

  // Builds one dynamic RigidBody + capsule per segment, measured off the
  // character's OWN live bone positions right now (bind pose or
  // mid-animation, doesn't matter -- see ragdollConfig.ts), and a
  // spherical (free ball) joint linking each segment to its parent.
  //
  // `activeSegments` is the partial-ragdoll case (a live pulseHit):
  // when given, only those named segments get built. Any built segment
  // whose declared parent ISN'T also in the active set (almost always
  // true here -- e.g. a Head hit builds only Head, whose parent Torso
  // stays purely animated) gets jointed to a NEW kinematic anchor body
  // instead of a real parent body -- see getOrCreateAnchor below. Calling
  // this with no argument (activateDeath's own use) builds the full
  // 11-segment rig exactly as before, parent-jointed-to-parent throughout,
  // no anchors at all.
  //
  // Already-built segments (bodiesRef.current) are skipped rather than
  // re-built -- this makes the function safe to call again mid-pulse with
  // a DIFFERENT atSegment (a second hit landing before the first one
  // finished blending out): it just extends the active rig with whatever
  // new segments that second hit needs, instead of silently doing nothing
  // or rebuilding (and losing) everything already simulating.
  const buildBodies = useCallback(
    (activeSegments?: Set<string>) => {
      const bones = resolveBones();
      if (!bones) return;

      // A rough, robust "character's own left-right" world direction at
      // this exact moment -- used below as every hinge joint's (elbow/
      // knee) bend axis. Derived purely from two bones' WORLD POSITIONS
      // rather than guessing any single bone's own local axis convention
      // (which this rig's raw export doesn't document, and which bit us
      // once already on the spine-lean feature) -- so it works regardless
      // of how soldier-citizen.glb's bones are locally oriented, and
      // stays reasonable even mid-animation (not just in a bind pose).
      const sideways = new THREE.Vector3(1, 0, 0);
      const thighL = bones["thigh_l"];
      const thighR = bones["thigh_r"];
      if (thighL && thighR) {
        thighL.getWorldPosition(_v1);
        thighR.getWorldPosition(_v2);
        sideways.subVectors(_v1, _v2);
        if (sideways.lengthSq() > 0.0001) sideways.normalize();
        else sideways.set(1, 0, 0);
      }

      const segmentsToBuild = (
        activeSegments
          ? RAGDOLL_SEGMENTS.filter((s) => activeSegments.has(s.name))
          : RAGDOLL_SEGMENTS
      ).filter((s) => !bodiesRef.current[s.name]);
      if (segmentsToBuild.length === 0) return;

      const entries = bodiesRef.current; // extended in place
      const anchors = anchorsRef.current; // extended in place

      const getOrCreateAnchor = (
        parentSegmentName: string
      ): AnchorEntry | null => {
        const existing = anchors[parentSegmentName];
        if (existing) return existing;
        const parentSegment = _segmentByName[parentSegmentName];
        const parentBone = parentSegment
          ? bones[parentSegment.drivingBone]
          : null;
        if (!parentBone) return null;
        parentBone.getWorldPosition(_v1);
        parentBone.getWorldQuaternion(_q1);
        const anchorDesc = rapier.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(_v1.x, _v1.y, _v1.z)
          .setRotation({ x: _q1.x, y: _q1.y, z: _q1.z, w: _q1.w });
        const anchorBody = world.createRigidBody(anchorDesc);
        const entry: AnchorEntry = { body: anchorBody, bone: parentBone };
        anchors[parentSegmentName] = entry;
        return entry;
      };

      for (const segment of segmentsToBuild) {
        const bone = bones[segment.drivingBone];
        const toBone = bones[segment.toBone];
        if (!bone || !toBone) continue; // this rig doesn't have the bone -- skip gracefully

        bone.getWorldPosition(_v1);
        bone.getWorldQuaternion(_q1);
        toBone.getWorldPosition(_v2);

        const length = Math.max(
          0.05,
          _v1.distanceTo(_v2) * (segment.lengthScale ?? 0.92)
        );
        const halfHeight = Math.max(0.01, length / 2 - segment.radius);

        const bodyDesc = rapier.RigidBodyDesc.dynamic()
          .setTranslation(_v1.x, _v1.y, _v1.z)
          .setRotation({ x: _q1.x, y: _q1.y, z: _q1.z, w: _q1.w })
          .setLinearDamping(0.5)
          .setAngularDamping(0.9);
        const body = world.createRigidBody(bodyDesc);

        // The collider's own local translation/rotation (relative to the
        // body, whose own transform is just the bone's own transform --
        // see above) is what actually points the capsule from this bone
        // toward toBone: `localDir` is (toBone.worldPos - bone.worldPos)
        // rotated into the bone's OWN local frame (inverse of its world
        // rotation), since a collider's local offset is expressed in its
        // parent body's frame.
        const localDir = _v3
          .copy(_v2)
          .sub(_v1)
          .applyQuaternion(_q2.copy(_q1).invert());
        const localLen = localDir.length() || 1;
        localDir.normalize();
        const capsuleRot = new THREE.Quaternion().setFromUnitVectors(
          _yAxis,
          localDir
        );
        const capsuleOffset = localDir
          .clone()
          .multiplyScalar(Math.min(localLen / 2, length / 2));

        const colliderDesc = rapier.ColliderDesc.capsule(
          halfHeight,
          segment.radius
        )
          .setTranslation(capsuleOffset.x, capsuleOffset.y, capsuleOffset.z)
          .setRotation({
            x: capsuleRot.x,
            y: capsuleRot.y,
            z: capsuleRot.z,
            w: capsuleRot.w,
          })
          // "il personaggio si trasla in aria quando prende un colpo" --
          // root cause: this excluded ONLY other Ragdoll-group pieces
          // (redundant anyway -- Rapier already disables collision
          // between two bodies it just jointed together), so the
          // Characters group stayed in the filter. This capsule spawns
          // at the struck bone's live world position, i.e. ALREADY deep
          // inside the character's own main capsule collider (also in
          // Characters) -- so the instant it's created (before any hit
          // impulse even applies), Rapier's own contact solver saw a
          // massive overlap with the character's real movement capsule
          // and shoved them violently apart, launching the whole
          // character upward until the overlap resolved and gravity/the
          // controller pulled it back down. Excluding Characters here
          // stops the ragdoll rig from ever pushing on any character's
          // own movement collider, while it still falls/collides
          // normally against terrain, roads, buildings, etc.
          // "il personaggio si trasla in aria" -- confirmed via a live test (collide
          // with NOTHING at all) that collision isn't the cause, it's the joint
          // solver (see clampBodyVelocities' comment) -- so this stays a normal
          // exclusion (ragdoll pieces still fall/collide against terrain, roads,
          // buildings etc, just not against any character's own movement
          // collider, and not needlessly against each other either).
          .setCollisionGroups(
            groupsExcluding(CollisionGroups.Ragdoll, CollisionGroups.Characters)
          )
          .setDensity(1.0);
        world.createCollider(colliderDesc, body);

        entries[segment.name] = {
          segment,
          body,
          bone,
          restLocalPos: bone.position.clone(),
          restQuat: bone.quaternion.clone(),
        };

        // Capture this segment's own frozen companion bones' CURRENT
        // (still animation-driven, not yet forced) quaternion, before
        // anything below ever sets them to identity -- see
        // frozenBoneRestQuatRef's own comment above for why this capture
        // is what makes full release actually work.
        const frozenNamesForThisSegment = RAGDOLL_SEGMENT_FROZEN_BONES[segment.name];
        if (frozenNamesForThisSegment) {
          for (const frozenName of frozenNamesForThisSegment) {
            const frozenBone = bones[frozenName];
            if (frozenBone) {
              frozenBoneRestQuatRef.current[frozenName] = frozenBone.quaternion.clone();
            }
          }
        }

        if (segment.parent) {
          const parentEntry = entries[segment.parent];
          const parentBody = parentEntry
            ? parentEntry.body
            : getOrCreateAnchor(segment.parent)?.body;
          const parentBone = parentEntry
            ? parentEntry.bone
            : anchors[segment.parent]?.bone;
          if (parentBody && parentBone) {
            // anchor1 (this joint's point, in the PARENT body's own local
            // frame): since the parent body's rotation is exactly the
            // parent bone's world rotation (whether that parent is a real
            // simulated segment or a kinematic anchor tracking an
            // animated bone -- both cases set their rotation from the
            // same bone the same way), this is just `bone`'s world
            // position transformed into that same frame. anchor2 is
            // [0,0,0] because this segment's body origin IS `bone`'s own
            // world position by construction above.
            parentBone.getWorldPosition(_v1);
            parentBone.getWorldQuaternion(_q1);
            bone.getWorldPosition(_v2);
            const anchor1 = _v2
              .clone()
              .sub(_v1)
              .applyQuaternion(_q1.clone().invert());

            // "le parti del corpo devono seguire sempre i constraint dell
            // anatomia umana" -- elbows/knees are real single-axis hinges,
            // so they get an actual Rapier revolute joint with a hard
            // flexion limit (RAGDOLL_HINGE_LIMITS_DEG) instead of a free
            // spherical one. Everything else stays spherical (shoulders/
            // hips/neck/spine genuinely need more than one rotational DOF)
            // but gets its OWN limit enforced manually every frame by
            // clampJointCones, via the restRelativeQuat captured below.
            const hingeLimitsDeg = RAGDOLL_HINGE_LIMITS_DEG[segment.name];
            let jointData;
            if (hingeLimitsDeg) {
              // axis is expressed "in the local-space of the rigid-bodies
              // it is attached to" (both -- Rapier's revolute() only
              // takes one). Converting our world-space `sideways` vector
              // through the PARENT's inverse rotation is exact for that
              // body; it's only approximate for the child if the two
              // bones don't share a perfectly consistent local roll
              // convention along this limb, which just means the hinge
              // plane may be a few degrees off anatomically -- still
              // firmly bounded either way, which is the actual goal here.
              const axisLocal = sideways
                .clone()
                .applyQuaternion(_q1.clone().invert());
              jointData = rapier.JointData.revolute(
                { x: anchor1.x, y: anchor1.y, z: anchor1.z },
                { x: 0, y: 0, z: 0 },
                { x: axisLocal.x, y: axisLocal.y, z: axisLocal.z }
              );
              jointData.limitsEnabled = true;
              jointData.limits = [
                THREE.MathUtils.degToRad(hingeLimitsDeg[0]),
                THREE.MathUtils.degToRad(hingeLimitsDeg[1]),
              ];
            } else {
              jointData = rapier.JointData.spherical(
                { x: anchor1.x, y: anchor1.y, z: anchor1.z },
                { x: 0, y: 0, z: 0 }
              );
              // Neutral/rest pose for this joint, in the parent's local
              // frame, captured NOW (whatever the character was actually
              // doing when the hit landed) -- see clampJointCones and
              // BodyEntry's own comment.
              bone.getWorldQuaternion(_q2);
              entries[segment.name].restRelativeQuat = _q1
                .clone()
                .invert()
                .multiply(_q2);
            }

            const joint = world.createImpulseJoint(
              jointData,
              parentBody,
              body,
              true
            );
            jointsRef.current.push(joint);
          }
        }
      }
    },
    [rapier, world, resolveBones]
  );

  // "il personaggio si trasla in aria quando prende un colpo" -- root
  // cause found empirically (a temporary debug log printed every live
  // body's world Y every frame): the spherical joints occasionally send
  // a segment's linear velocity into the tens of m/s within 2-3 physics
  // substeps of being created, even though the anchor math is exactly
  // zero-error at creation time (verified by hand) and even with the
  // capsules' own collision entirely disabled (so it's not a collision
  // popping them apart -- confirmed live, same explosion either way).
  // That points at the joint SOLVER itself occasionally overshooting
  // (a known class of Rapier joint-stiffness issue with small/light
  // capsule bodies), not a bug in this file's own math. Rather than
  // chase an intermittent solver edge case, this clamps every live
  // ragdoll body's linear speed every frame -- a standard, blunt safety
  // net for exactly this failure mode: it can't stop a single bad
  // substep, but it stops that bad substep's velocity from ever being
  // visible for more than one frame, so a solver hiccup reads as a tiny
  // stutter instead of a launch into orbit. HIT_MAX_LINVEL is well above
  // the intended 0.3 m/s hit-impulse kick, so normal recoil is untouched.
  const HIT_MAX_LINVEL = 3; // m/s
  const clampBodyVelocities = useCallback(() => {
    const entries = bodiesRef.current;
    for (const key of Object.keys(entries)) {
      const { body } = entries[key];
      const v = body.linvel();
      const speedSq = v.x * v.x + v.y * v.y + v.z * v.z;
      if (speedSq > HIT_MAX_LINVEL * HIT_MAX_LINVEL) {
        const scale = HIT_MAX_LINVEL / Math.sqrt(speedSq);
        body.setLinvel(
          { x: v.x * scale, y: v.y * scale, z: v.z * scale },
          true
        );
      }
    }
  }, []);

  // "le parti del corpo devono seguire sempre i constraint dell'anatomia
  // umana.. a meno di un colpo davvero forte (di cui parleremo in
  // futuro)" -- the hinge joints (elbow/knee) already get a hard limit
  // straight from Rapier's own revolute solver (see buildBodies), but its
  // spherical joints (spine/neck/shoulders/hips) have no native angular-
  // limit API in this Rapier version, so this manually pulls each one
  // back toward its own restRelativeQuat (the joint's pose at the moment
  // THIS pulse/death started, not a fixed bind pose) whenever it strays
  // more than RAGDOLL_CONE_LIMIT_DEG in ANY direction at once -- a single
  // total-angle cone, not a separate swing/twist split, which is simpler
  // and good enough for "does this look like a human body" rather than
  // biomechanically exact per-axis ranges. The "colpo davvero forte"
  // override mentioned above doesn't exist yet -- every hit is bound by
  // this today, on purpose, until that's designed.
  const clampJointCones = useCallback(() => {
    const entries = bodiesRef.current;
    const anchors = anchorsRef.current;
    for (const key of Object.keys(entries)) {
      const entry = entries[key];
      if (!entry.restRelativeQuat || !entry.segment.parent) continue; // Hips (no parent), or a hinge joint (already limited above)
      const maxAngle = RAGDOLL_CONE_LIMIT_RAD[entry.segment.name];
      if (maxAngle === undefined) continue;

      const parentEntry = entries[entry.segment.parent];
      const parentAnchor = anchors[entry.segment.parent];
      const parentRot = parentEntry
        ? parentEntry.body.rotation()
        : parentAnchor
          ? parentAnchor.body.rotation()
          : null;
      if (!parentRot) continue;

      _coneParentQuat.set(parentRot.x, parentRot.y, parentRot.z, parentRot.w);
      const childRot = entry.body.rotation();
      _coneChildQuat.set(childRot.x, childRot.y, childRot.z, childRot.w);

      // relative = parentInv * child ; delta = restRelativeInv * relative
      // -- see BodyEntry's own comment for what restRelativeQuat is.
      _coneRelQuat.copy(_coneParentQuat).invert().multiply(_coneChildQuat);
      _coneDeltaQuat
        .copy(entry.restRelativeQuat)
        .invert()
        .multiply(_coneRelQuat);

      const w = THREE.MathUtils.clamp(Math.abs(_coneDeltaQuat.w), -1, 1);
      const angle = 2 * Math.acos(w);
      if (angle <= maxAngle || angle < 1e-5) continue;

      // Scale the excess rotation back down to exactly maxAngle (same
      // axis, smaller angle) via a slerp-from-identity, then rebuild the
      // corrected world orientation and hard-set it on the body.
      const t = maxAngle / angle;
      _coneClampedDelta.copy(_identityQuat).slerp(_coneDeltaQuat, t);
      _coneCorrectedRel
        .copy(entry.restRelativeQuat)
        .multiply(_coneClampedDelta);
      _coneCorrectedWorld.copy(_coneParentQuat).multiply(_coneCorrectedRel);
      entry.body.setRotation(
        {
          x: _coneCorrectedWorld.x,
          y: _coneCorrectedWorld.y,
          z: _coneCorrectedWorld.z,
          w: _coneCorrectedWorld.w,
        },
        true
      );

      // Without this, the solver's own momentum just drives it straight
      // back past the limit next step and this ends up fighting itself
      // every frame (visible as a buzz/jitter right at the limit) instead
      // of settling there. A blunt full damping (not just the offending
      // component) is fine since this only fires once a joint is already
      // AT its limit, not during ordinary motion.
      const av = entry.body.angvel();
      entry.body.setAngvel(
        { x: av.x * 0.2, y: av.y * 0.2, z: av.z * 0.2 },
        true
      );
    }
  }, []);

  // Re-points every kinematic anchor (see buildBodies) at its tracked
  // bone's CURRENT world transform -- that bone keeps being driven by the
  // normal animation the whole time a pulse is active, so this is what
  // lets a struck limb swing off a point that's still walking/attacking/
  // etc instead of a frozen one. updateWorldMatrix(true, false) forces
  // this one bone's own matrixWorld (and its ancestors') fresh for THIS
  // frame rather than reading last frame's already-rendered one -- cheap
  // (walks up the hierarchy only, not the whole scene) and worth it here
  // since the anchor's responsiveness is exactly what sells the recoil as
  // "live", unlike the one-frame staleness accepted elsewhere in this
  // file where it doesn't matter as much.
  const syncAnchors = useCallback(() => {
    const anchors = anchorsRef.current;
    for (const key of Object.keys(anchors)) {
      const { body, bone } = anchors[key];
      bone.updateWorldMatrix(true, false);
      bone.getWorldPosition(_v1);
      bone.getWorldQuaternion(_q1);
      body.setNextKinematicTranslation({ x: _v1.x, y: _v1.y, z: _v1.z });
      body.setNextKinematicRotation({ x: _q1.x, y: _q1.y, z: _q1.z, w: _q1.w });
    }
  }, []);

  // Overwrites each simulated bone's LOCAL transform (position/rotation
  // relative to its parent in the skeleton) from its rigid body's world
  // transform. `weight` < 1 slerps the ROTATION only, toward whatever the
  // bone's quaternion already holds this frame (i.e. whatever the
  // AnimationMixer just wrote, since this always runs after
  // mixer.update() in the caller's useFrame) -- that's the blend-out.
  // Position is only ever hard-set at weight===1: once the pulse lets go,
  // the bone should fall back to its constant mixer-driven local offset,
  // not a lerped one (bone LENGTHS don't change, only rotations do, for a
  // normal skeletal animation -- blending position would visibly stretch
  // limbs).
  const syncBonesFromPhysics = useCallback((weight: number) => {
    const entries = bodiesRef.current;
    for (const key of Object.keys(entries)) {
      const { body, bone, restLocalPos } = entries[key];
      if (!bone.parent) continue;
      const t = body.translation();
      const r = body.rotation();
      _v1.set(t.x, t.y, t.z);
      _q1.set(r.x, r.y, r.z, r.w);

      _worldMatrix.compose(_v1, _q1, _unitScale);
      _parentInverse.copy(bone.parent.matrixWorld).invert();
      _worldMatrix.premultiply(_parentInverse);
      _worldMatrix.decompose(_v2, _q2, _v3);

      if (weight >= 1) {
        bone.position.copy(_v2);
        bone.quaternion.copy(_q2);
      } else {
        // "il personaggio si trasla in aria quando prende un colpo" --
        // position used to be left untouched here, frozen at whatever
        // the physics last computed (often airborne, thanks to gravity
        // plus the hit impulse's own upward component) for the WHOLE
        // 0.35s blend-out, since most bones have no position keyframes
        // of their own for the mixer to overwrite it with. Lerping it
        // back toward the bone's captured resting offset (same rate as
        // the rotation slerp) fixes the floating limb without the
        // "stretching" risk a naive continuous blend would have, since
        // both ends of this lerp are physically valid local offsets.
        bone.position.lerpVectors(restLocalPos, _v2, weight);
        bone.quaternion.slerp(_q2, weight);
      }
    }

    // "1. crollo totale" (activateDeath) builds all 11 segments, so this
    // covers every frozen bone same as before; a live pulseHit only ever
    // builds a couple, so only THEIR frozen bones (if any) get touched --
    // e.g. hitting just the Head never resets spine_02/03 (Torso's own),
    // which would otherwise visibly stomp the still-animated torso pose.
    const bones = bonesRef.current;
    if (bones) {
      for (const key of Object.keys(entries)) {
        const frozenNames = RAGDOLL_SEGMENT_FROZEN_BONES[key];
        if (!frozenNames) continue;
        for (const boneName of frozenNames) {
          const bone = bones[boneName];
          if (!bone) continue;
          if (weight >= 1) bone.quaternion.identity();
          else bone.quaternion.slerp(_identityQuat, weight);
        }
      }
    }
  }, []);

  const ensureMarker = useCallback((): THREE.Mesh | null => {
    if (markerRef.current) return markerRef.current;
    const geometry = new THREE.IcosahedronGeometry(0.12, 1);
    const material = new THREE.MeshBasicMaterial({
      color: 0xfff2a8,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.renderOrder = 999; // always draw on top, like a real hit-flash
    mesh.frustumCulled = false; // tiny + short-lived -- not worth the bounding check
    scene.add(mesh);
    markerRef.current = mesh;
    return mesh;
  }, [scene]);

  const triggerHitMarker = useCallback(
    (worldPos: THREE.Vector3) => {
      const marker = ensureMarker();
      if (!marker) return;
      marker.position.copy(worldPos);
      marker.visible = true;
      marker.scale.setScalar(0.4);
      (marker.material as THREE.MeshBasicMaterial).opacity = 1;
      markerElapsedRef.current = 0;
    },
    [ensureMarker]
  );

  const activateDeath = useCallback(() => {
    if (stateRef.current.active && stateRef.current.isDeath) return;
    destroyBodies();
    buildBodies();
    stateRef.current = {
      active: true,
      isDeath: true,
      pulseElapsed: 0,
      blendElapsed: 0,
      chainElapsed: 0,
    };
  }, [buildBodies, destroyBodies]);

  const pulseHit = useCallback(
    (
      worldImpulseDir: THREE.Vector3,
      magnitude: number,
      atSegment: string = "Torso",
      attackerX?: number,
      attackerZ?: number
    ) => {
      if (stateRef.current.isDeath) return; // already a corpse -- a pulse on top would fight the death ragdoll

      // "anche il braccio/gamba piu' vicino per un effetto un po' piu'
      // ampio" -- see ragdollConfig.ts's RAGDOLL_PULSE_NEARBY.
      const nearbyOptions = RAGDOLL_PULSE_NEARBY[atSegment] ?? [];
      const nearby = nearbyOptions.length
        ? nearbyOptions[Math.floor(Math.random() * nearbyOptions.length)]
        : [];
      const activeSegments = new Set<string>([atSegment, ...nearby]);

      if (!stateRef.current.active) {
        buildBodies(activeSegments);
        stateRef.current = {
          active: true,
          isDeath: false,
          pulseElapsed: 0,
          blendElapsed: 0,
          chainElapsed: 0,
        };
      } else {
        // Already mid-pulse (a second hit landed before the first fully
        // blended out) -- buildBodies only adds whatever's newly needed
        // (see its own comment). The timers only get reset ("the reaction
        // doesn't visibly snap/reset") while this unbroken re-hit chain is
        // still under MAX_CHAIN_DURATION -- past that, a hit lands (impulse/
        // marker/damage below are unaffected) but no longer extends the
        // recovery clock, guaranteeing a full release even under sustained
        // attack instead of the chain resetting forever (see that
        // constant's own comment -- this is the actual fix for "la ragdoll
        // si deforma ma nn torna allo stato normale" while standing still).
        buildBodies(activeSegments);
        if (stateRef.current.chainElapsed < MAX_CHAIN_DURATION) {
          stateRef.current.pulseElapsed = 0;
          stateRef.current.blendElapsed = 0;
        }
      }

      const entry = bodiesRef.current[atSegment] ?? bodiesRef.current.Torso;
      if (entry && magnitude > 0) {
        // "vola via velocissimo" -- these capsules are tiny (Torso radius
        // 0.18, Head 0.13 -- see ragdollConfig.ts) and Rapier derives mass
        // from actual collider volume * density, so a Head/ForeArm body
        // masses well under 100g. `magnitude` applied as a raw impulse
        // (kg*m/s) ignored that entirely: applyImpulse adds impulse/mass
        // to linear velocity, so the SAME 3.2 that reads as a firm shove
        // on a heavy Torso rockets a light Head to tens of m/s. Scaling by
        // the segment's own live mass turns `magnitude` into what it was
        // actually meant to be -- a target VELOCITY KICK in m/s, the same
        // for every segment regardless of how big or small its capsule is.
        const mass = entry.body.mass();
        const dir = worldImpulseDir
          .clone()
          .normalize()
          .multiplyScalar(magnitude * mass);
        entry.body.applyImpulse({ x: dir.x, y: dir.y, z: dir.z }, true);

        const t = entry.body.translation();
        _v1.set(t.x, t.y, t.z);

        // "il colpo deve avvenire precisamente dove le mesh si sono
        // toccate" -- attackerX/Z (the attacker's own live position,
        // threaded through from the attack-resolution branch in
        // CombatSoldier.tsx/PlayerCombatSoldier.tsx) lets the marker sit
        // on the near side of the struck capsule -- the side that was
        // actually facing the attacker -- instead of always this
        // segment's own center, which read as floating inside the torso
        // no matter which direction the hit came from.
        if (attackerX !== undefined && attackerZ !== undefined) {
          _v2.set(attackerX - t.x, 0, attackerZ - t.z);
          if (_v2.lengthSq() > 0.0001) {
            _v2.normalize().multiplyScalar(entry.segment.radius);
            _v1.x += _v2.x;
            _v1.z += _v2.z;
          }
        }

        triggerHitMarker(_v1);
      }
    },
    [buildBodies, triggerHitMarker]
  );

  const update = useCallback(
    (delta: number) => {
      // Hit-marker fade runs independently of ragdoll state -- it can
      // still be fading out slightly after the pulse itself has already
      // fully blended back to pure animation.
      if (markerRef.current && markerRef.current.visible) {
        markerElapsedRef.current += delta;
        const t = Math.min(1, markerElapsedRef.current / HIT_MARKER_DURATION);
        (markerRef.current.material as THREE.MeshBasicMaterial).opacity = 1 - t;
        markerRef.current.scale.setScalar(0.4 + t * 0.6);
        if (t >= 1) markerRef.current.visible = false;
      }

      // The hurtbox (see HURTBOX_* above) tracks this fighter for as long
      // as it's alive, independently of whether a ragdoll pulse/death is
      // currently active -- unlike everything below this line. Same for
      // the 11 solid-body colliders (see ensureSolidBody's own comment) --
      // this only actually does anything once the caller's own
      // resolveBodyMovement has built them at least once.
      syncHurtbox();
      syncSolidBody();

      const s = stateRef.current;
      if (!s.active) return;

      if (s.isDeath) {
        // Full 11-body collapse (no kinematic anchors involved -- see
        // "1. crollo totale") still gets the same anatomical cone clamp
        // as a live hit-reaction, so a K.O. reads as a body collapsing,
        // not folding into a pretzel.
        clampJointCones();
        syncBonesFromPhysics(1);
        return;
      }

      syncAnchors();
      clampBodyVelocities();
      clampJointCones();

      s.chainElapsed += delta;
      s.pulseElapsed += delta;
      if (s.pulseElapsed < HIT_PULSE_DURATION) {
        syncBonesFromPhysics(1);
        return;
      }

      s.blendElapsed += delta;
      const weight = Math.max(0, 1 - s.blendElapsed / HIT_BLEND_OUT_DURATION);
      if (weight <= 0) {
        restoreBonesToAnimation();
        destroyBodies();
        stateRef.current = freshState();
        return;
      }
      syncBonesFromPhysics(weight);
    },
    [
      syncBonesFromPhysics,
      destroyBodies,
      restoreBonesToAnimation,
      syncAnchors,
      clampBodyVelocities,
      clampJointCones,
      syncHurtbox,
      syncSolidBody,
    ]
  );

  const deactivate = useCallback(() => {
    destroyBodies();
    stateRef.current = freshState();
  }, [destroyBodies]);

  // Cleanup on unmount -- a fighter/player object that gets removed from
  // the scene (e.g. the duel ends) shouldn't leave orphaned Rapier bodies
  // or the hit-marker mesh behind.
  useEffect(
    () => () => {
      destroyBodies();
      if (markerRef.current) {
        scene.remove(markerRef.current);
        markerRef.current.geometry.dispose();
        (markerRef.current.material as THREE.Material).dispose();
        markerRef.current = null;
      }
    },
    [destroyBodies, scene]
  );

  const getBoneWorldPosition = useCallback(
    (boneName: string, target: THREE.Vector3): boolean => {
      const bones = resolveBones();
      const bone = bones?.[boneName];
      if (!bone) return false;
      bone.getWorldPosition(target);
      return true;
    },
    [resolveBones]
  );

  const getHurtboxHandle = useCallback((): number | null => {
    return hurtboxRef.current ? hurtboxRef.current.collider.handle : null;
  }, []);

  // "voglio che il colpo avvenga proprio dove ho colpito, non in un
  // range" -- a real Rapier query: casts a tiny sphere at `worldPos`
  // (the attacker's own hand, read via getBoneWorldPosition) and asks
  // Rapier which Hurtbox-group colliders it actually overlaps, rather
  // than hand-rolling distance-to-capsule math against the target's root
  // position. filterGroups=HURTBOX_GROUPS keeps this from ever matching
  // terrain, ragdoll pieces, or anything outside the Hurtbox group.
  const pointIntersectsHurtbox = useCallback(
    (worldPos: THREE.Vector3, targetHandle: number): boolean => {
      let hit = false;
      const shape = new rapier.Ball(HAND_QUERY_RADIUS);
      world.intersectionsWithShape(
        { x: worldPos.x, y: worldPos.y, z: worldPos.z },
        _identityRot,
        shape,
        (collider) => {
          if (collider.handle === targetHandle) {
            hit = true;
            return false; // stop as soon as we've found it
          }
          return true;
        },
        undefined,
        HURTBOX_GROUPS
      );
      return hit;
    },
    [rapier, world]
  );

  // "il movimento del busto devo controllarlo solo io con l'orbit
  // control.. nessuna animazione si deve intromettere nella sua
  // inclinazione" -- a hard, ABSOLUTE bone.quaternion.setFromAxisAngle(...)
  // every frame: spine_02/spine_03's rotation is entirely and exclusively
  // the camera pitch, whatever the currently-playing clip (idle/walk/
  // punch/whatever) baked in for those two bones is fully discarded, not
  // blended with. An absolute set also can't compound across frames the
  // way an earlier relative-multiply version once did (that's what
  // caused "sta ruotando sul bacino a 360 gradi") -- there's nothing to
  // track/undo between calls anymore.
  //
  // "se guardo il personaggio da sotto lui piega il busto per guardare
  // sotto ma dovrebbe essere al contrario" -- sign fix: camPitch (from
  // PlayerCombatSoldier.tsx's camera.getWorldDirection) is positive when
  // the camera is looking UP (e.g. orbited below the character looking
  // up at them), and the torso should tilt to look the SAME way the
  // camera is looking, not toward the camera itself. The un-negated
  // angle had it backwards; negating it here (rather than flipping
  // camPitch's own sign at the call site, which reads correctly as "the
  // camera's own up/down look angle") keeps that meaning intact and
  // scopes the sign correction to what it's actually compensating for --
  // this bone's own local axis convention.
  const applySpineLean = useCallback(
    (pitchRad: number, yawRad: number) => {
      // Don't fight an in-progress hit reaction or the death ragdoll --
      // both already own spine_02/03 (RAGDOLL_SEGMENT_FROZEN_BONES.Torso)
      // every frame they're active, via syncBonesFromPhysics.
      if (stateRef.current.active) return;
      const bones = resolveBones();
      if (!bones) return;
      const clampedPitch = THREE.MathUtils.clamp(
        pitchRad,
        -SPINE_LEAN_MAX_RAD,
        SPINE_LEAN_MAX_RAD
      );
      const clampedYaw = THREE.MathUtils.clamp(
        yawRad,
        -SPINE_TWIST_MAX_RAD,
        SPINE_TWIST_MAX_RAD
      );
      const perBonePitch = -clampedPitch / SPINE_LEAN_BONES.length;
      const perBoneYaw = clampedYaw / SPINE_LEAN_BONES.length;
      for (const boneName of SPINE_LEAN_BONES) {
        const bone = bones[boneName];
        if (!bone) continue;
        // Twist axis = direction toward this bone's own child, in the
        // bone's own local space -- bone.position is a constant bind-pose
        // offset on a standard skeletal rig (only rotations animate), so
        // the child's rest position IS "up the spine" from here, exactly
        // the axis a spinal twist should turn around. Geometric, not
        // guessed -- see SPINE_LEAN_CHILD_BONE's comment above.
        const child = bones[SPINE_LEAN_CHILD_BONE[boneName]];
        if (child && child.position.lengthSq() > 1e-8) {
          _spineTwistAxis.copy(child.position).normalize();
        } else {
          _spineTwistAxis.copy(_yAxis); // fallback -- should never actually hit on this rig
        }
        _spinePitchQuat.setFromAxisAngle(_xAxis, perBonePitch);
        _spineTwistQuat.setFromAxisAngle(_spineTwistAxis, perBoneYaw);
        bone.quaternion.copy(_spineTwistQuat).multiply(_spinePitchQuat);
      }
    },
    [resolveBones]
  );

  // The hurtbox is the one piece of this hook's state that ISN'T torn
  // down by destroyBodies/deactivate (it's meant to outlive every
  // individual pulse) -- so it needs its own unmount cleanup, same
  // reasoning as the hit-marker mesh below.
  useEffect(
    () => () => {
      if (hurtboxRef.current) {
        world.removeRigidBody(hurtboxRef.current.body);
        hurtboxRef.current = null;
      }
    },
    [world]
  );

  // Same "outlives every individual pulse, needs its own cleanup" story
  // as the hurtbox above -- the 11 solid-body colliders (and their own
  // character controller) are permanent for as long as the fighter is,
  // so they need tearing down on unmount too (re-entering the duel
  // shouldn't leak 11 orphaned Rapier bodies per fighter, per attempt).
  useEffect(
    () => () => {
      for (const name of Object.keys(solidBodiesRef.current)) {
        world.removeRigidBody(solidBodiesRef.current[name].body);
      }
      solidBodiesRef.current = {};
      ownColliderHandlesRef.current.clear();
      if (solidControllerRef.current) {
        world.removeCharacterController(solidControllerRef.current);
        solidControllerRef.current = null;
      }
    },
    [world]
  );

  return {
    isActive: () => stateRef.current.active,
    isDeath: () => stateRef.current.isDeath,
    activateDeath,
    pulseHit,
    update,
    deactivate,
    getBoneWorldPosition,
    getHurtboxHandle,
    pointIntersectsHurtbox,
    applySpineLean,
    resolveBodyMovement,
    getSolidBodySegments,
  };
}
