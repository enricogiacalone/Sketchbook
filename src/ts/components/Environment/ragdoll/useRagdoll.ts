import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import type { RigidBody as RapierRigidBody, ImpulseJoint } from '@dimforge/rapier3d-compat';
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

const HIT_PULSE_DURATION = 0.45; // secondi in cui il corpo e' guidato al 100% dalla fisica dopo un colpo
const HIT_BLEND_OUT_DURATION = 0.35; // secondi di sfumatura (slerp) verso l'animazione
const HIT_MARKER_DURATION = 0.3; // secondi di vita del lampo visivo sul punto colpito

interface BodyEntry {
  segment: RagdollSegment;
  body: RapierRigidBody;
  bone: THREE.Bone;
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
          .setCollisionGroups(groupsExcluding(CollisionGroups.Ragdoll))
          .setDensity(1.0);
        world.createCollider(colliderDesc, body);

        entries[segment.name] = { segment, body, bone };

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
      const { body, bone } = entries[key];
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

      const s = stateRef.current;
      if (!s.active) return;

      if (s.isDeath) {
        syncBonesFromPhysics(1);
        return;
      }

      syncAnchors();

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
    [syncBonesFromPhysics, destroyBodies, syncAnchors]
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

  return {
    isActive: () => stateRef.current.active,
    isDeath: () => stateRef.current.isDeath,
    activateDeath,
    pulseHit,
    update,
    deactivate,
  };
}
