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
}

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
