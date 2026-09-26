import { interactionGroups } from "@react-three/rapier";

// Rapier's collisionGroups/solverGroups pack membership + filter into one
// 32-bit InteractionGroups number, built with @react-three/rapier's
// `interactionGroups(memberships, filters)`. Both memberships and filters
// are lists of small group INDICES (0-15), not the 32-bit bitmask values
// cannon-es used directly (Default=1, Characters=2, etc.) -- so these are
// now plain indices, one per group, not powers of two.
export enum CollisionGroups {
  Default = 0,
  Characters = 1,
  TrimeshColliders = 2,
  Bullet = 3,
  Tornado = 4,
  // Ragdoll rig pieces (useRagdoll.ts) -- own group mainly so a corpse's
  // capsules don't need to reason about anything special to fall onto
  // terrain/roads/buildings like everything else in `Default`. Two
  // capsules connected by a joint never collide with each other anyway
  // (Rapier disables that pair automatically for jointed bodies), so no
  // exclusion is needed for the rig's own adjacent pieces; NON-adjacent
  // pieces of the same ragdoll (e.g. an arm swinging across the chest)
  // can still self-intersect a little -- a known, accepted simplification.
  Ragdoll = 5,
  // "voglio che il colpo avvenga proprio dove ho colpito, non in un
  // range" -- a real Rapier sensor collider per fighter (useRagdoll.ts's
  // hurtbox), queried via a genuine shape-intersection test against the
  // attacker's actual hand position instead of hand-rolled distance math.
  // Its own group so the intersection query only ever matches OTHER
  // hurtboxes -- never terrain, ragdoll pieces, or anything else sharing
  // the world.
  Hurtbox = 6,
  // "migliora la fisica della ragdoll -- compenetrazioni": ostacoli del
  // mondo che il ragdoll attivo deve toccare SEMPRE, anche da vivo
  // (muri, casse, ostacoli mobili dell'arena) -- NON il pavimento, che da
  // vivo resta escluso (vedi ALIVE_COLLISION_GROUPS in useRagdollActive).
  RagdollWorld = 7,
  // Corpi che solo il ragdoll A TERRA/KO deve toccare: le capsule solide
  // degli altri combattenti e il sacco. Da vivo le mani li attraversano
  // (i colpi sono gestiti dalle hurtbox); da KO un corpo che cade addosso
  // a un altro ci sbatte invece di passarci dentro.
  RagdollBody = 8,
}

// "ogni parte del corpo deve essere un collider.. se collide collide"
// -- shared by every REAL solid-body collider in the duel: each
// fighter's 11 permanent per-limb capsules (useRagdoll.ts's solid-body
// system) AND the punching bag's own non-sensor capsule (PunchingBag.tsx)
// all join this one group, so any of them can physically block or shove
// any other member -- an arm, a leg, the torso, the bag, whatever
// actually touches, touches; nothing here is a synthetic single-capsule
// "whole body" stand-in or a distance check. Previously lived as
// DUEL_BODY_GROUPS in useDuelBodyCollider.tsx (now removed -- that hook
// was exactly the "one approximate capsule, stop at a distance" approach
// this replaces); same underlying value, moved here since it's no longer
// owned by one single-collider hook but by the whole solid-body system
// plus the bag.
export const SOLID_BODY_GROUPS = interactionGroups(
  [CollisionGroups.Characters],
  [CollisionGroups.Characters]
);

// Capsule solide di un combattente IN PIEDI e sacco: come SOLID_BODY_GROUPS
// + visibili al ragdoll KO (di un ALTRO combattente -- le proprie capsule
// tornano a SOLID_BODY_GROUPS finche' il proprio ragdoll e' a terra, vedi
// useRagdollSolidBodies.setRagdollBlocker).
export const SOLID_BODY_RAGDOLL_GROUPS = interactionGroups(
  [CollisionGroups.Characters, CollisionGroups.RagdollBody],
  [CollisionGroups.Characters, CollisionGroups.Ragdoll]
);

// Ostacoli dell'arena (pendoli, pistoni, rotore): bloccano i combattenti
// (Characters) E il ragdoll, vivo o KO.
export const SOLID_OBSTACLE_GROUPS = interactionGroups(
  [CollisionGroups.Characters, CollisionGroups.RagdollWorld],
  [CollisionGroups.Characters, CollisionGroups.Ragdoll]
);

const ALL_GROUP_INDICES = Array.from({ length: 16 }, (_, i) => i);

// Convenience wrapper around `interactionGroups`, for the very common
// pattern this app uses everywhere: "I'm a member of `membership`, and I
// collide with everything EXCEPT these groups" -- the direct equivalent of
// cannon's `collisionFilterGroup: X, collisionFilterMask: ~Y` pairing.
export function groupsExcluding(
  membership: CollisionGroups | CollisionGroups[],
  ...excluded: CollisionGroups[]
): number {
  const filters = ALL_GROUP_INDICES.filter((g) => !excluded.includes(g));
  const memberships = Array.isArray(membership) ? membership : [membership];
  return interactionGroups(memberships, filters);
}
