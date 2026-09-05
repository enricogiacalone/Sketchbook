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
