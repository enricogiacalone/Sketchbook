import React, { useImperativeHandle, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RigidBody, CapsuleCollider, RapierRigidBody, interactionGroups, useSphericalJoint } from '@react-three/rapier';
import type { Collider } from '@dimforge/rapier3d-compat';
import { CollisionGroups } from '../../enums/CollisionGroups';
import { SOLID_BODY_RAGDOLL_GROUPS } from '../../enums/CollisionGroups';
import { getTerrainHeight } from './Terrain';
import { useStore } from '../../store';

// "crea un sacco su cui allenarmi nell'arena.. mi serve per capire la
// precisione delle collisioni" -- a practice target, independent of the
// AI opponent/training dummy (CombatSoldier.tsx's own isPassive toggle):
// always there, never fights back, never dies, just measures exactly
// where your punches land.
//
// "rendi il sacco penzolante come un vero sacco" -- no longer "resta
// fermo": the bag itself is now a real DYNAMIC Rapier body hanging from a
// fixed anchor point via a spherical joint (see BAG_TOP_LOCAL_Y/the
// useSphericalJoint call below) -- exactly the "pendulum" use case that
// joint type's own upstream doc comment names. Gravity + the joint pivot
// alone are enough to make it hang straight down at rest (the pivot
// sits directly above the bag's own center of mass along local Y, which
// is the pendulum's natural stable equilibrium -- no separate "return to
// center" logic needed), and a hit now applies a real impulse at the
// exact contact point (see registerHit below) so it visibly swings/sways
// and gradually settles back down via linear/angular damping, instead of
// only ever showing a static hit marker.
//
// Visual proportions of the bag itself -- a real heavy bag, roughly
// chest-height, NOT useRagdoll.ts's own HURTBOX_HEIGHT/RADIUS (those size
// a standing HUMANOID's coarse body cylinder; this is a much shorter,
// narrower hanging cylinder with a different shape entirely).
const BAG_HEIGHT = 1.1;
export const BAG_RADIUS = 0.22;
// Local-space (relative to this body's own ground-level origin, see
// `position` below) height of the bag's own vertical CENTER -- roughly
// chest height, so a Jab/Cross/Hook all land on it naturally without
// crouching or reaching up (same rough band useRagdoll.ts's own pulseHit
// picks 'Head' or 'Torso' within).
const BAG_CENTER_Y = 1.3;
const STRAP_HEIGHT = 0.35; // chain/strap linking the bag's own top to the fixed mount point it now actually hangs from
// The exact local-space point (still relative to this body's own
// ground-level origin) where the strap meets the fixed mount above it --
// this is what the spherical joint pivots around, so the whole assembly
// (strap + bag, both still simple children of this one dynamic body)
// swings together as a single rigid unit, same as a real bag's chain
// never bending on its own.
const BAG_TOP_LOCAL_Y = BAG_CENTER_Y + BAG_HEIGHT / 2 + STRAP_HEIGHT;

// A real heavy bag's actual mass (kg) -- set explicitly on the collider
// (overriding density-based auto-computation) so the swing weight is
// predictable rather than whatever a sensor collider's default density
// happens to resolve to.
const BAG_MASS = 18;
// "come un vero sacco" -- damped enough that a swing settles back to
// hanging straight down within a couple of seconds rather than spinning
// or swaying indefinitely, same spirit as useRagdoll.ts's own limb
// damping (there 0.5/0.9) just heavier here to match a real bag's bulk.
const BAG_LINEAR_DAMPING = 0.6;
const BAG_ANGULAR_DAMPING = 1.4;
// Impulse magnitude (kg*m/s) applied at the exact hand-contact point on
// every hit -- tuned live in the browser against BAG_MASS/damping above
// until a clean Jab reads as a real, visible swing-and-settle rather
// than an imperceptible twitch or a wild spin.
const BAG_HIT_IMPULSE = 16;
// Un colpo di pistola sposta il sacco meno di un pugno pieno.
const BAG_SHOT_IMPULSE = 6;

// Same interactionGroups useRagdoll.ts's own per-fighter hurtbox capsules
// use (member AND filter = Hurtbox only) -- this is exactly what lets
// PlayerCombatSoldier.tsx's existing ragdoll.pointIntersectsHurtbox query
// (built for testing a hand position against an OPPONENT's hurtbox) match
// this collider too, with zero changes needed to that query itself: as
// far as Rapier's concerned this is just another Hurtbox-group sensor.
// Still a SENSOR even now that the body is dynamic -- sensors don't
// generate contact response (so nothing else in the world ever bumps
// into/gets pushed by the bag), they just report intersection queries
// and are otherwise moved completely normally by the joint/gravity/
// impulses below, exactly like any other dynamic body's collider.
const BAG_HURTBOX_GROUPS = interactionGroups([CollisionGroups.Hurtbox], [CollisionGroups.Hurtbox]);

// How long a hit marker stays visible before fully fading (seconds) --
// mirrors useRagdoll.ts's own hit-marker lifetime so a bag hit reads
// consistently with a real fighter hit.
const MARKER_LIFETIME = 0.5;

// Scratch objects for registerHit's world<->local transform -- avoids a
// per-hit allocation burst, matching this file's siblings' own module-
// level scratch vectors elsewhere in this codebase (PlayerCombatSoldier's
// _handPos, useRagdoll's _v1/_v2/...).
const _bodyPos = new THREE.Vector3();
const _bodyQuat = new THREE.Quaternion();
const _localPoint = new THREE.Vector3();
const _impulseDir = new THREE.Vector3();

export interface PunchingBagHandle {
  // Called by PlayerCombatSoldier.tsx's checkAttackContact the instant a
  // hand bone is found inside this bag's own hurtbox -- see there. Takes
  // the exact WORLD-space contact point (the same live hand position the
  // opponent-hit branch already uses), not just "a hit happened", since
  // the whole point is measuring precision (and, now, exactly where to
  // apply the swing impulse).
  registerHit: (worldPos: THREE.Vector3, hand: 'hand_l' | 'hand_r') => void;
  // "se sbatto col sacco dovrei muoverlo" -- called by useRagdoll.ts's
  // solid-body resolveBodyMovement whenever ANY of a fighter's 11 real
  // per-limb colliders (not a punch, not registerHit -- just casually
  // walking/bumping into it) gets blocked by this bag's own solid
  // collider. A real impulse at the actual contact point, same mechanic
  // as registerHit's swing (applyImpulseAtPoint), just a gentler,
  // separately-tuned magnitude for a bump vs. a thrown punch -- see
  // BODY_BUMP_IMPULSE_SCALE.
  applyBodyBump: (worldPoint: THREE.Vector3, worldDir: THREE.Vector3, blockedAmount: number) => void;
  // TEMP debug-only readout (live browser verification of "se sbatto col
  // sacco dovrei muoverlo") -- the bag's own actual live world position,
  // as opposed to DuelArena.tsx's __duelDebug bagX/bagZ which is a fixed
  // spawn useMemo, not the live swinging body. Returns null before the
  // dynamic body's first collider exists.
  getWorldPosition: () => { x: number; y: number; z: number } | null;
  // Proiettile della pistola (PlayerCombatSoldier.tsx): marker nel punto
  // d'impatto + spinta lungo la direzione del colpo. Non conta come pugno
  // (niente registerBagHit / statistiche di precisione dei pugni).
  registerShot: (worldPoint: THREE.Vector3, worldDir: THREE.Vector3) => void;
}

interface PunchingBagProps {
  // Ground-plane [x, z] only -- Y (both the ground contact point AND the
  // bag's own BAG_CENTER_Y offset above it) is resolved internally via
  // getTerrainHeight, same as every other fixed-position prop/scenery in
  // this file's siblings, so the caller never has to think about terrain
  // height itself.
  positionXZ: [number, number];
  // Reports this bag's own hurtbox collider handle once Rapier has
  // actually created it (colliders don't exist on the very first render)
  // -- see DuelArena.tsx, which forwards the handle into
  // PlayerCombatSoldier.tsx as a prop so checkAttackContact can query it
  // exactly like it already queries the opponent's own hurtboxHandle.
  onReady: (handle: number) => void;
  // Same idea, for the bag's OTHER collider -- the solid (non-sensor)
  // SOLID_BODY_GROUPS capsule a fighter's real per-limb colliders
  // actually collide against. useRagdoll.ts's resolveBodyMovement needs
  // this handle to recognize "the thing that just blocked me IS the bag"
  // (as opposed to the opponent's own body) so it knows when to call
  // applyBodyBump instead of just stopping.
  onSolidReady: (handle: number) => void;
}

// "se sbatto col sacco dovrei muoverlo" -- a casual body bump is a much
// gentler contact than a thrown punch (BAG_HIT_IMPULSE=16 above), so it
// gets its own, separately-tuned scale rather than reusing that constant
// outright -- tuned live so a light graze barely nudges the bag while
// walking firmly into it gives it a real, visible shove.
const BODY_BUMP_IMPULSE_SCALE = 14; // (kg*m/s) per meter of blocked movement
const BODY_BUMP_IMPULSE_MAX = 10; // cap -- a full-body dead stop against the bag shouldn't fling it like a punch

const PunchingBag = React.forwardRef<PunchingBagHandle, PunchingBagProps>(
  ({ positionXZ, onReady, onSolidReady }, ref) => {
    const groundY = getTerrainHeight(positionXZ[0], positionXZ[1]);
    const position: [number, number, number] = [positionXZ[0], groundY, positionXZ[1]];
    // The fixed mount point the bag's strap actually hangs from -- same
    // X/Z as the bag itself, BAG_TOP_LOCAL_Y higher up. A separate,
    // otherwise invisible fixed body purely so the joint below has
    // something immovable to pivot against (a real ceiling hook).
    const anchorPosition: [number, number, number] = [positionXZ[0], groundY + BAG_TOP_LOCAL_Y, positionXZ[1]];

    const bagBodyRef = useRef<RapierRigidBody>(null);
    const anchorBodyRef = useRef<RapierRigidBody>(null);
    const colliderRef = useRef<Collider | null>(null);
    const solidColliderRef = useRef<Collider | null>(null);
    const reportedRef = useRef(false);
    const solidReportedRef = useRef(false);

    // "come un vero sacco" -- the actual pendulum: pivots at
    // anchorBodyRef's own origin (body1Anchor [0,0,0], since that fixed
    // body IS placed exactly at the mount point above) and at the bag
    // body's own local BAG_TOP_LOCAL_Y (body2Anchor -- the top of its
    // strap, not its center), so the whole bag+strap assembly swings as
    // one rigid unit around that top point, exactly like a real chain
    // attached to a fixed hook.
    useSphericalJoint(anchorBodyRef as React.RefObject<RapierRigidBody>, bagBodyRef as React.RefObject<RapierRigidBody>, [
      [0, 0, 0],
      [0, BAG_TOP_LOCAL_Y, 0],
    ]);

    // The collider only actually exists a frame or two after mount (same
    // "not there yet on the very first render" reality useRagdoll.ts's own
    // hurtbox/getHurtboxHandle already documents) -- poll for it in
    // useFrame rather than assuming a useEffect on mount is late enough,
    // and only report once (this collider's own handle never changes
    // after creation, even though the body it's attached to now moves).
    useFrame(() => {
      if (reportedRef.current) return;
      if (colliderRef.current) {
        reportedRef.current = true;
        onReady(colliderRef.current.handle);
      }
    });

    useFrame(() => {
      if (solidReportedRef.current) return;
      if (solidColliderRef.current) {
        solidReportedRef.current = true;
        onSolidReady(solidColliderRef.current.handle);
      }
    });

    // Local-space (relative to the bag body's OWN current transform, not
    // just its rest spawn point -- see registerHit below) offset of the
    // most recent hit, and how long ago it landed -- drives the glowing
    // marker mesh, which is itself a child of the swinging body so it
    // rides along with it automatically once positioned in local space.
    // Infinity = "no hit yet this session" (matches useRagdoll.ts's own
    // marker-elapsed convention).
    const markerLocalPos = useRef(new THREE.Vector3(0, BAG_CENTER_Y, 0));
    const markerElapsedRef = useRef(Infinity);
    const markerMeshRef = useRef<THREE.Mesh>(null);
    // "fai riferimenti visivi per ragdoll e fisica dei solidi" -- wireframe
    // over the bag's OWN solid collider (the one fighters' real body
    // parts actually collide against, not the sensor), toggled by the
    // same showPhysicsDebug flag as SolidBodyDebugView.tsx. A plain child
    // of this body, same local position/size as the solid collider
    // itself, so it swings along automatically -- no per-frame sync
    // needed at all, unlike a fighter's own (world-space) debug capsules.
    const solidDebugMeshRef = useRef<THREE.Mesh>(null);

    useImperativeHandle(
      ref,
      () => ({
        registerHit: (worldPos: THREE.Vector3, hand: 'hand_l' | 'hand_r') => {
          const body = bagBodyRef.current;
          if (!body) return;

          // "come un vero sacco" -- the bag now actually moves, so
          // everything below is computed in the body's CURRENT local
          // frame (translation + rotation read live off the physics
          // body), not the fixed spawn `position` a static bag could
          // get away with before. localPoint = inverse(bodyRotation) *
          // (worldPos - bodyPosition) -- the same hand contact point,
          // expressed relative to wherever the bag actually is RIGHT
          // NOW (mid-swing or at rest, doesn't matter).
          const t = body.translation();
          const r = body.rotation();
          _bodyPos.set(t.x, t.y, t.z);
          _bodyQuat.set(r.x, r.y, r.z, r.w);
          _localPoint.copy(worldPos).sub(_bodyPos).applyQuaternion(_bodyQuat.clone().invert());

          markerLocalPos.current.copy(_localPoint);
          markerElapsedRef.current = 0;

          // "mi serve per capire la precisione delle collisioni" -- the
          // actual precision readout: horizontal distance from the bag's
          // own vertical centerline (0 = dead center) and signed vertical
          // distance from its own center height, both in meters, in the
          // bag's own local frame (so this stays correct even mid-swing),
          // reported to DuelHUD.tsx via the store (see store.ts's
          // registerBagHit comment for why this is a direct imperative
          // call here rather than a per-frame mirror).
          const radialOffset = Math.sqrt(_localPoint.x * _localPoint.x + _localPoint.z * _localPoint.z);
          const heightOffset = _localPoint.y - BAG_CENTER_Y;
          useStore.getState().registerBagHit(radialOffset, heightOffset, hand);

          // "rendi il sacco penzolante come un vero sacco" -- the actual
          // swing: a real impulse at the exact contact point, pushing
          // AWAY from the bag's own central vertical axis (world-space,
          // using the body's translation directly -- only the X/Z
          // components matter for a horizontal push direction, so the
          // fact that this body's own origin sits at ground level rather
          // than at bag-center height doesn't affect this calculation at
          // all). Falls back to an arbitrary horizontal direction on the
          // (practically impossible) exact-dead-center-of-the-axis case,
          // purely so normalize() never divides by zero.
          _impulseDir.set(worldPos.x - t.x, 0, worldPos.z - t.z);
          if (_impulseDir.lengthSq() < 1e-6) _impulseDir.set(0, 0, 1);
          _impulseDir.normalize().multiplyScalar(BAG_HIT_IMPULSE);
          body.applyImpulseAtPoint(
            { x: _impulseDir.x, y: _impulseDir.y, z: _impulseDir.z },
            { x: worldPos.x, y: worldPos.y, z: worldPos.z },
            true
          );
        },
        applyBodyBump: (worldPoint: THREE.Vector3, worldDir: THREE.Vector3, blockedAmount: number) => {
          const body = bagBodyRef.current;
          if (!body) return;
          const mag = Math.min(BODY_BUMP_IMPULSE_MAX, blockedAmount * BODY_BUMP_IMPULSE_SCALE);
          if (mag <= 0.0001) return;
          _impulseDir.copy(worldDir);
          _impulseDir.y = 0;
          if (_impulseDir.lengthSq() < 1e-6) return;
          _impulseDir.normalize().multiplyScalar(mag);
          body.applyImpulseAtPoint(
            { x: _impulseDir.x, y: _impulseDir.y, z: _impulseDir.z },
            { x: worldPoint.x, y: worldPoint.y, z: worldPoint.z },
            true
          );
        },
        registerShot: (worldPoint: THREE.Vector3, worldDir: THREE.Vector3) => {
          const body = bagBodyRef.current;
          if (!body) return;
          const t = body.translation();
          const r = body.rotation();
          _bodyPos.set(t.x, t.y, t.z);
          _bodyQuat.set(r.x, r.y, r.z, r.w);
          _localPoint.copy(worldPoint).sub(_bodyPos).applyQuaternion(_bodyQuat.clone().invert());
          markerLocalPos.current.copy(_localPoint);
          markerElapsedRef.current = 0;
          _impulseDir.copy(worldDir);
          if (_impulseDir.lengthSq() < 1e-6) return;
          _impulseDir.normalize().multiplyScalar(BAG_SHOT_IMPULSE);
          body.applyImpulseAtPoint(
            { x: _impulseDir.x, y: _impulseDir.y, z: _impulseDir.z },
            { x: worldPoint.x, y: worldPoint.y, z: worldPoint.z },
            true
          );
        },
        getWorldPosition: () => {
          const body = bagBodyRef.current;
          if (!body) return null;
          const t = body.translation();
          return { x: t.x, y: t.y, z: t.z };
        },
      }),
      []
    );

    useFrame((_state, delta) => {
      if (!markerMeshRef.current) return;
      if (markerElapsedRef.current > MARKER_LIFETIME) {
        if (markerMeshRef.current.visible) markerMeshRef.current.visible = false;
        return;
      }
      markerElapsedRef.current += delta;
      markerMeshRef.current.visible = true;
      markerMeshRef.current.position.copy(markerLocalPos.current);
      const mat = markerMeshRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, 1 - markerElapsedRef.current / MARKER_LIFETIME);
    });

    useFrame(() => {
      if (!solidDebugMeshRef.current) return;
      const show = useStore.getState().showPhysicsDebug;
      if (solidDebugMeshRef.current.visible !== show) solidDebugMeshRef.current.visible = show;
    });

    const halfHeight = Math.max(0.01, BAG_HEIGHT / 2 - BAG_RADIUS);

    return (
      <>
        {/* Invisible fixed mount point -- the "ceiling hook" the bag's
            strap actually pivots from (see useSphericalJoint above). No
            collider at all: this body only ever needs to exist as an
            immovable anchor for the joint, never to be hit or collided
            with itself. */}
        <RigidBody ref={anchorBodyRef} type="fixed" colliders={false} position={anchorPosition} />

        <RigidBody
          ref={bagBodyRef}
          type="dynamic"
          colliders={false}
          position={position}
          linearDamping={BAG_LINEAR_DAMPING}
          angularDamping={BAG_ANGULAR_DAMPING}
          // Same Ragdoll-vs-Characters exclusion reasoning as
          // useRagdoll.ts's own segment colliders (see its own long
          // comment on the topic) -- the bag's sensor collider already
          // can't push anything via contact response, but this also
          // keeps it from firing spurious intersection *events* against
          // the fighters' own movement capsules, leaving it purely a
          // punch target.
          collisionGroups={BAG_HURTBOX_GROUPS}
        >
          <CapsuleCollider
            ref={colliderRef}
            args={[halfHeight, BAG_RADIUS]}
            position={[0, BAG_CENTER_Y, 0]}
            sensor
            mass={BAG_MASS}
            collisionGroups={BAG_HURTBOX_GROUPS}
            solverGroups={BAG_HURTBOX_GROUPS}
          />
          <CapsuleCollider
            ref={solidColliderRef}
            args={[halfHeight, BAG_RADIUS]}
            position={[0, BAG_CENTER_Y, 0]}
            mass={0}
            collisionGroups={SOLID_BODY_RAGDOLL_GROUPS}
            solverGroups={SOLID_BODY_RAGDOLL_GROUPS}
          />

          {/* "fai riferimenti visivi per ragdoll e fisica dei solidi" --
              see solidDebugMeshRef's own comment above. */}
          <mesh ref={solidDebugMeshRef} position={[0, BAG_CENTER_Y, 0]} visible={false}>
            <capsuleGeometry args={[BAG_RADIUS, halfHeight * 2, 4, 8]} />
            <meshBasicMaterial color="#00e5ff" wireframe transparent opacity={0.9} depthTest={false} />
          </mesh>

          {/* Strap/chain -- purely visual, links the bag's own top to the
              fixed mount point above it. Still just a plain child mesh in
              local space: since the joint pivots the WHOLE body around
              BAG_TOP_LOCAL_Y (exactly where this sits), the strap swings
              rigidly along with the bag as one piece, same as a real
              chain never bending on its own. */}
          <mesh position={[0, BAG_CENTER_Y + BAG_HEIGHT / 2 + STRAP_HEIGHT / 2, 0]}>
            <cylinderGeometry args={[0.018, 0.018, STRAP_HEIGHT, 6]} />
            <meshStandardMaterial color="#2a2a2a" roughness={0.5} metalness={0.6} />
          </mesh>

          {/* The bag itself -- a squat leather-red capsule, matching the
              collider's own shape/size 1:1 so what you SEE lining up with a
              punch is exactly what the hurtbox query actually tested. */}
          <mesh position={[0, BAG_CENTER_Y, 0]} castShadow receiveShadow>
            <capsuleGeometry args={[BAG_RADIUS, BAG_HEIGHT - BAG_RADIUS * 2, 4, 12]} />
            <meshStandardMaterial color="#7a2e1d" roughness={0.85} />
          </mesh>
          {/* Top/bottom stitched bands -- cheap visual detail so the bag
              doesn't read as a plain cylinder at a glance. */}
          <mesh position={[0, BAG_CENTER_Y + BAG_HEIGHT / 2 - BAG_RADIUS * 0.6, 0]}>
            <torusGeometry args={[BAG_RADIUS * 1.01, 0.012, 6, 16]} />
            <meshStandardMaterial color="#3d1810" roughness={0.9} />
          </mesh>
          <mesh position={[0, BAG_CENTER_Y - BAG_HEIGHT / 2 + BAG_RADIUS * 0.6, 0]}>
            <torusGeometry args={[BAG_RADIUS * 1.01, 0.012, 6, 16]} />
            <meshStandardMaterial color="#3d1810" roughness={0.9} />
          </mesh>

          {/* Hit marker -- same idea as useRagdoll.ts's own glowing hit dot,
              reimplemented standalone here since this bag has no skeleton/
              ragdoll rig to hang the original one off of. Starts hidden;
              registerHit above repositions + reveals it, the useFrame
              fades it back out. A plain child of this body, same as
              everything else above, so it swings along with the bag too. */}
          <mesh ref={markerMeshRef} visible={false}>
            <sphereGeometry args={[0.045, 10, 10]} />
            <meshBasicMaterial color="#ffdd55" transparent opacity={1} depthTest={false} />
          </mesh>
        </RigidBody>
      </>
    );
  }
);

PunchingBag.displayName = 'PunchingBag';

export default PunchingBag;
