import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useRapier, interactionGroups } from '@react-three/rapier';
import type { RigidBody as RapierRigidBody, ImpulseJoint, Collider } from '@dimforge/rapier3d-compat';
import { CollisionGroups, groupsExcluding } from '../../../enums/CollisionGroups';
import { RAGDOLL_PULSE_NEARBY, RAGDOLL_SEGMENTS, RAGDOLL_SEGMENT_FROZEN_BONES, RagdollSegment } from './ragdollConfig';

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
const HIT_BLEND_OUT_DURATION = 0.35; // secondi di sfumatura (slerp) verso l'animazione
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
const HURTBOX_RADIUS = 0.28;
// Member of AND only collides-with Hurtbox -- so a query using this same
// group only ever matches another fighter's hurtbox, never terrain,
// ragdoll pieces, or anything else sharing the physics world.
const HURTBOX_GROUPS = interactionGroups([CollisionGroups.Hurtbox], [CollisionGroups.Hurtbox]);
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

interface RagdollState {
  active: boolean;
  isDeath: boolean;
  pulseElapsed: number;
  blendElapsed: number;
}

export interface RagdollController {
  isActive: () => boolean;
  isDeath: () => boolean;
  activateDeath: () => void;
  pulseHit: (worldImpulseDir: THREE.Vector3, magnitude: number, atSegment?: string, attackerX?: number, attackerZ?: number) => void;
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
  pointIntersectsHurtbox: (worldPos: THREE.Vector3, targetHandle: number) => boolean;
  // "mi piacerebbe che il busto seguisse il movimento" -- tilts the spine
  // forward/back by `pitchRad` on top of whatever the AnimationMixer just
  // set this frame (additive local-space rotation, same "mixer writes
  // first, this overwrites/adjusts specific bones after" ordering
  // syncBonesFromPhysics already relies on -- see its own comment). Only
  // the player's own fighter calls this (PlayerCombatSoldier.tsx, driven
  // by camera pitch); the AI never does. No-ops while a hit-pulse or
  // death is active so it doesn't fight the ragdoll physics.
  applySpineLean: (pitchRad: number) => void;
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
const _leanQuat = new THREE.Quaternion();
// Split across both spine bones rather than piling the whole tilt onto
// one joint -- reads as a smoother, more natural bend (same reasoning as
// RAGDOLL_SEGMENT_FROZEN_BONES.Torso already grouping these two).
const SPINE_LEAN_BONES = ['spine_02', 'spine_03'];
const _identityQuat = new THREE.Quaternion();
const _segmentByName: Record<string, RagdollSegment> = {};
for (const seg of RAGDOLL_SEGMENTS) _segmentByName[seg.name] = seg;

function freshState(): RagdollState {
  return { active: false, isDeath: false, pulseElapsed: 0, blendElapsed: 0 };
}

export function useRagdoll(modelRootRef: React.RefObject<THREE.Object3D | null>): RagdollController {
  const { world, rapier } = useRapier();
  const { scene } = useThree();

  const bonesRef = useRef<Record<string, THREE.Bone> | null>(null);
  const bodiesRef = useRef<Record<string, BodyEntry>>({});
  const anchorsRef = useRef<Record<string, AnchorEntry>>({});
  const jointsRef = useRef<ImpulseJoint[]>([]);
  const stateRef = useRef<RagdollState>(freshState());
  const hurtboxRef = useRef<{ body: RapierRigidBody; collider: Collider } | null>(null);

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
  const ensureHurtbox = useCallback((): { body: RapierRigidBody; collider: Collider } | null => {
    if (hurtboxRef.current) return hurtboxRef.current;
    const root = modelRootRef.current;
    if (!root) return null;
    root.getWorldPosition(_v1);
    const bodyDesc = rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(
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
    entry.body.setNextKinematicTranslation({ x: _v1.x, y: _v1.y + HURTBOX_HEIGHT / 2, z: _v1.z });
  }, [ensureHurtbox, modelRootRef]);

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

      const segmentsToBuild = (
        activeSegments ? RAGDOLL_SEGMENTS.filter((s) => activeSegments.has(s.name)) : RAGDOLL_SEGMENTS
      ).filter((s) => !bodiesRef.current[s.name]);
      if (segmentsToBuild.length === 0) return;

      const entries = bodiesRef.current; // extended in place
      const anchors = anchorsRef.current; // extended in place

      const getOrCreateAnchor = (parentSegmentName: string): AnchorEntry | null => {
        const existing = anchors[parentSegmentName];
        if (existing) return existing;
        const parentSegment = _segmentByName[parentSegmentName];
        const parentBone = parentSegment ? bones[parentSegment.drivingBone] : null;
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

        const length = Math.max(0.05, _v1.distanceTo(_v2) * (segment.lengthScale ?? 0.92));
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
        const localDir = _v3.copy(_v2).sub(_v1).applyQuaternion(_q2.copy(_q1).invert());
        const localLen = localDir.length() || 1;
        localDir.normalize();
        const capsuleRot = new THREE.Quaternion().setFromUnitVectors(_yAxis, localDir);
        const capsuleOffset = localDir.clone().multiplyScalar(Math.min(localLen / 2, length / 2));

        const colliderDesc = rapier.ColliderDesc.capsule(halfHeight, segment.radius)
          .setTranslation(capsuleOffset.x, capsuleOffset.y, capsuleOffset.z)
          .setRotation({ x: capsuleRot.x, y: capsuleRot.y, z: capsuleRot.z, w: capsuleRot.w })
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
          .setCollisionGroups(groupsExcluding(CollisionGroups.Ragdoll, CollisionGroups.Characters))
          .setDensity(1.0);
        world.createCollider(colliderDesc, body);

        entries[segment.name] = { segment, body, bone, restLocalPos: bone.position.clone() };

        if (segment.parent) {
          const parentEntry = entries[segment.parent];
          const parentBody = parentEntry ? parentEntry.body : getOrCreateAnchor(segment.parent)?.body;
          const parentBone = parentEntry ? parentEntry.bone : anchors[segment.parent]?.bone;
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
            const anchor1 = _v2.clone().sub(_v1).applyQuaternion(_q1.clone().invert());
            const jointData = rapier.JointData.spherical(
              { x: anchor1.x, y: anchor1.y, z: anchor1.z },
              { x: 0, y: 0, z: 0 }
            );
            const joint = world.createImpulseJoint(jointData, parentBody, body, true);
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
        body.setLinvel({ x: v.x * scale, y: v.y * scale, z: v.z * scale }, true);
      }
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
    stateRef.current = { active: true, isDeath: true, pulseElapsed: 0, blendElapsed: 0 };
  }, [buildBodies, destroyBodies]);

  const pulseHit = useCallback(
    (worldImpulseDir: THREE.Vector3, magnitude: number, atSegment: string = 'Torso', attackerX?: number, attackerZ?: number) => {
      if (stateRef.current.isDeath) return; // already a corpse -- a pulse on top would fight the death ragdoll

      // "anche il braccio/gamba piu' vicino per un effetto un po' piu'
      // ampio" -- see ragdollConfig.ts's RAGDOLL_PULSE_NEARBY.
      const nearbyOptions = RAGDOLL_PULSE_NEARBY[atSegment] ?? [];
      const nearby = nearbyOptions.length ? nearbyOptions[Math.floor(Math.random() * nearbyOptions.length)] : [];
      const activeSegments = new Set<string>([atSegment, ...nearby]);

      if (!stateRef.current.active) {
        buildBodies(activeSegments);
        stateRef.current = { active: true, isDeath: false, pulseElapsed: 0, blendElapsed: 0 };
      } else {
        // Already mid-pulse (a second hit landed before the first fully
        // blended out) -- buildBodies only adds whatever's newly needed
        // (see its own comment) and resets the timers, so the reaction
        // doesn't visibly snap/reset.
        buildBodies(activeSegments);
        stateRef.current.pulseElapsed = 0;
        stateRef.current.blendElapsed = 0;
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
        const dir = worldImpulseDir.clone().normalize().multiplyScalar(magnitude * mass);
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
      // currently active -- unlike everything below this line.
      syncHurtbox();

      const s = stateRef.current;
      if (!s.active) return;

      if (s.isDeath) {
        syncBonesFromPhysics(1);
        return;
      }

      syncAnchors();
      clampBodyVelocities();

      s.pulseElapsed += delta;
      if (s.pulseElapsed < HIT_PULSE_DURATION) {
        syncBonesFromPhysics(1);
        return;
      }

      s.blendElapsed += delta;
      const weight = Math.max(0, 1 - s.blendElapsed / HIT_BLEND_OUT_DURATION);
      if (weight <= 0) {
        destroyBodies();
        stateRef.current = freshState();
        return;
      }
      syncBonesFromPhysics(weight);
    },
    [syncBonesFromPhysics, destroyBodies, syncAnchors, clampBodyVelocities, syncHurtbox]
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

  const applySpineLean = useCallback(
    (pitchRad: number) => {
      // Don't fight an in-progress hit reaction or the death ragdoll --
      // both already own spine_02/03 (RAGDOLL_SEGMENT_FROZEN_BONES.Torso)
      // every frame they're active, via syncBonesFromPhysics.
      if (stateRef.current.active) return;
      const bones = resolveBones();
      if (!bones) return;
      const perBone = pitchRad / SPINE_LEAN_BONES.length;
      for (const boneName of SPINE_LEAN_BONES) {
        const bone = bones[boneName];
        if (!bone) continue;
        _leanQuat.setFromAxisAngle(_xAxis, perBone);
        bone.quaternion.multiply(_leanQuat);
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
  };
}
