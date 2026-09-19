// Ragdoll rig definition for the soldier-citizen.glb skeleton (an
// Epic/UE-mannequin-style bone naming convention -- pelvis/spine_0N/
// clavicle_l/upperarm_l/lowerarm_l/hand_l/thigh_l/calf_l/foot_l etc.,
// verified by parsing the GLB's own node list directly). Same skeleton
// used by both CombatSoldier.tsx (city-wide arena) and
// PlayerCombatSoldier.tsx (the 1v1 duel), so both share this one config
// via useRagdoll.ts.
//
// Inspired by epol1/trr's three.js-rapier-ragdoll approach (a capsule per
// limb + a limit joint per pair), but DATA-DRIVEN rather than hand-typed
// per-bone offsets: only a bone-name pair and a radius are declared here,
// every capsule's actual length/position/orientation is measured off the
// character's own live bone positions the moment the ragdoll activates
// (see useRagdoll.ts's buildBodies). That's both more robust (no
// hand-guessed numbers that can silently stop matching if the model is
// re-exported slightly differently) and reusable for a different
// similarly-named rig without editing this file's numbers.
//
// Simplified to 10 rigid bodies rather than one per bone (real ragdolls in
// shipped games are rarely much finer than this): the spine's 3 bones
// (spine_01/02/03) collapse into one rigid "Torso" capsule, each
// shoulder's clavicle collapses into its upper arm, and each hand/foot
// collapses into its forearm/shin. Every bone NOT given its own body here
// is listed in RAGDOLL_SEGMENT_FROZEN_BONES below -- while the segment
// that "owns" it is active, its local rotation is reset to identity every
// frame, so it rigidly extends whichever real ragdoll body is its nearest
// simulated ancestor instead of silently freezing at a stale animated
// pose (which would show as a kink where the simulated part ends and the
// frozen part begins).
export interface RagdollSegment {
  name: string;
  // The one bone whose LOCAL transform gets overwritten from physics each
  // frame while the ragdoll drives this segment.
  drivingBone: string;
  // Name of the parent segment (by `name`), or null for the root (pelvis).
  parent: string | null;
  // Which bone marks the "far end" of this capsule -- its live world
  // position (relative to drivingBone) at activation time sets the
  // capsule's length and local orientation. Usually the child segment's
  // own drivingBone.
  toBone: string;
  radius: number;
  // Extra fraction to trim off the measured length so neighboring
  // capsules don't visibly overlap/z-fight at the joint (capsule caps are
  // already rounded, so a small margin reads better than none).
  lengthScale?: number;
}

export const RAGDOLL_SEGMENTS: RagdollSegment[] = [
  { name: 'Hips', drivingBone: 'pelvis', parent: null, toBone: 'spine_01', radius: 0.15, lengthScale: 0.6 },
  { name: 'Torso', drivingBone: 'spine_01', parent: 'Hips', toBone: 'neck_01', radius: 0.18 },
  // "la testa del solido e' troppo bassa rispetto a quella reale" --
  // head_leaf sits close to the true top of the skull but the mesh's
  // own hair/head volume still reads visibly taller than a capsule
  // sized off the bare neck_01->head_leaf bone distance (radius 0.13
  // alone gave a ~0.28m-tall near-sphere centered mid-skull) -- bumped
  // radius and lengthScale so the covered volume clears the real
  // rendered head, verified live against the debug wireframe.
  { name: 'Head', drivingBone: 'neck_01', parent: 'Torso', toBone: 'head_leaf', radius: 0.15, lengthScale: 1.3 },
  { name: 'UpperArm_L', drivingBone: 'upperarm_l', parent: 'Torso', toBone: 'lowerarm_l', radius: 0.06 },
  { name: 'ForeArm_L', drivingBone: 'lowerarm_l', parent: 'UpperArm_L', toBone: 'hand_l', radius: 0.05 },
  { name: 'UpperArm_R', drivingBone: 'upperarm_r', parent: 'Torso', toBone: 'lowerarm_r', radius: 0.06 },
  { name: 'ForeArm_R', drivingBone: 'lowerarm_r', parent: 'UpperArm_R', toBone: 'hand_r', radius: 0.05 },
  { name: 'Thigh_L', drivingBone: 'thigh_l', parent: 'Hips', toBone: 'calf_l', radius: 0.095 },
  { name: 'Shin_L', drivingBone: 'calf_l', parent: 'Thigh_L', toBone: 'foot_l', radius: 0.07 },
  { name: 'Thigh_R', drivingBone: 'thigh_r', parent: 'Hips', toBone: 'calf_r', radius: 0.095 },
  { name: 'Shin_R', drivingBone: 'calf_r', parent: 'Thigh_R', toBone: 'foot_r', radius: 0.07 },
];

// "mani e piedi nn sn solidi" -- the 11 segments above deliberately
// collapse each hand/foot into its forearm/shin (see this file's own
// top comment, "real ragdolls in shipped games are rarely much finer
// than this") -- a fine simplification for the transient hit-reaction/
// death ragdoll's own joint-solver cost, but NOT what's wanted for the
// permanent SOLID-BODY collision layer (useRagdoll.ts's ensureSolidBody/
// syncSolidBody/resolveBodyMovement): a fist that's just the end of the
// forearm capsule can't really connect with a punch, and a foot that's
// just the end of the shin capsule can clip through the opponent/ground
// at the ankle. So these 4 are declared SEPARATELY rather than folded
// into RAGDOLL_SEGMENTS above -- solid-body code reads BOTH arrays
// (SOLID_BODY_SEGMENTS below), the dynamic ragdoll (buildBodies) still
// reads ONLY RAGDOLL_SEGMENTS and is completely unaffected, exactly as
// asked (this is a collision-layer fix, not a ragdoll-physics one).
//
// toBone for each uses a real further-out bone rather than a guessed
// fixed size: middle_01_l/r (the middle finger's own first knuckle) for
// a hand -- close enough to the wrist that finger CURL at build time
// (fist vs open hand) barely changes the measured length, unlike a
// fingertip bone would -- and ball_l/r (the ball of the foot, already
// used as Shin's own frozen pass-through bone) for a foot, giving a real
// ankle-to-forefoot capsule instead of an arbitrary sphere.
export const SOLID_BODY_EXTRA_SEGMENTS: RagdollSegment[] = [
  { name: 'Hand_L', drivingBone: 'hand_l', parent: 'ForeArm_L', toBone: 'middle_01_l', radius: 0.045, lengthScale: 1.4 },
  { name: 'Hand_R', drivingBone: 'hand_r', parent: 'ForeArm_R', toBone: 'middle_01_r', radius: 0.045, lengthScale: 1.4 },
  { name: 'Foot_L', drivingBone: 'foot_l', parent: 'Shin_L', toBone: 'ball_l', radius: 0.075, lengthScale: 1.4 },
  { name: 'Foot_R', drivingBone: 'foot_r', parent: 'Shin_R', toBone: 'ball_r', radius: 0.075, lengthScale: 1.4 },
];

// What the solid-body system (useRagdoll.ts) actually builds every
// fighter out of: the 11 anatomical segments PLUS the 4 hand/foot ones
// above -- 15 real colliders per fighter. Kept as one combined list here
// (rather than having useRagdoll.ts concatenate the two arrays itself)
// so there's a single source of truth for "how many solid parts does a
// fighter have" that SolidBodyDebugView.tsx's own MAX_SOLID_SEGMENTS
// pool size is checked against.
export const SOLID_BODY_SEGMENTS: RagdollSegment[] = [...RAGDOLL_SEGMENTS, ...SOLID_BODY_EXTRA_SEGMENTS];

// Which pass-through bones belong to each segment, frozen to an identity
// local rotation while (and ONLY while) that segment is one of the
// currently-active ragdoll bodies (see useRagdoll.ts's syncBonesFromPhysics).
//
// This used to be one flat list applied unconditionally, back when every
// hit built the ENTIRE rig. Now that a live hit-reaction (pulseHit) only
// makes a couple of segments physical at a time -- see
// RAGDOLL_PULSE_NEARBY below -- freezing, say, spine_02/03 while only the
// Head is reacting would wrongly stomp the animated torso's own pose even
// though Torso itself was never touched. Keying frozen bones to their
// owning segment keeps each hit's effect scoped to exactly the body parts
// that are actually simulated. A bone with no entry here (finger bones,
// leaf helpers) is simply left alone -- whatever the AnimationMixer last
// wrote for it stays, which is harmless since nothing simulated depends
// on its exact pose.
// "le parti del corpo devono seguire sempre i constraint dell'anatomia
// umana.. a meno di un colpo davvero forte (di cui parleremo in futuro)"
// -- every joint below gets a REAL limit now instead of the free-
// spinning spherical joints this used to create for all 11 of them.
//
// Elbows and knees are genuine single-axis hinges anatomically, so they
// get a real Rapier revolute joint with a hard [min, max] flexion limit
// (degrees) -- see useRagdoll.ts's buildBodies, which passes these
// straight to JointData.revolute(...).limits. The hinge AXIS itself is
// computed at build time from live bone WORLD positions (thigh_l vs
// thigh_r), not guessed from this rig's raw per-bone local axis
// convention -- see buildBodies' own comment for why. Sign/exact plane
// is a reasonable anatomical approximation, not biomechanically exact;
// still, this is what actually stops "spinning 360" or bending
// backwards through the joint, which is the point.
export const RAGDOLL_HINGE_LIMITS_DEG: Record<string, [number, number]> = {
  ForeArm_L: [-10, 150],
  ForeArm_R: [-10, 150],
  Shin_L: [-10, 150],
  Shin_R: [-10, 150],
};

// Everything else (spine, neck, shoulders, hips) is genuinely multi-axis
// in real anatomy -- shoulders in particular have a huge range of
// motion -- so these stay real Rapier spherical joints (3 rotational
// DOF), but useRagdoll.ts's clampJointCones() manually pulls each one
// back every frame once it strays more than this many degrees (in ANY
// direction at once, not a separate swing/twist split) from its own
// "neutral" pose -- whatever the character was actually doing the
// instant the hit landed, not a fixed bind/T-pose. Rapier's spherical
// joint has no native angular-limit API in this version, hence the
// manual clamp rather than a built-in one (see that function's comment).
export const RAGDOLL_CONE_LIMIT_DEG: Record<string, number> = {
  Torso: 45, // spine bend, relative to Hips
  Head: 50, // neck, relative to Torso
  UpperArm_L: 100, // shoulder, relative to Torso -- generous: real shoulders have a very wide range
  UpperArm_R: 100,
  Thigh_L: 80, // hip, relative to Hips
  Thigh_R: 80,
};

export const RAGDOLL_SEGMENT_FROZEN_BONES: Record<string, string[]> = {
  Torso: ['spine_02', 'spine_03'],
  UpperArm_L: ['clavicle_l'],
  UpperArm_R: ['clavicle_r'],
  ForeArm_L: ['hand_l'],
  ForeArm_R: ['hand_r'],
  Shin_L: ['foot_l', 'ball_l'],
  Shin_R: ['foot_r', 'ball_r'],
};

// "vorrei qualcosa di dinamico.. un contraccolpo su dove ho colpito" /
// "anche il braccio/gamba piu vicino per un effetto un po' piu ampio" --
// a live hit-reaction pulse (pulseHit, character still alive) makes
// physical ONLY the struck segment (Head or Torso -- see CombatSoldier.tsx/
// PlayerCombatSoldier.tsx's triggerHit branch) plus one nearby limb picked
// from here, chosen at random each hit since a hit's impulse direction
// today carries no real left/right information to pick a true "nearest"
// side from. Hips/legs are NEVER part of a live pulse when the primary hit
// is the Head -- and even when the primary is Torso, the OTHER leg and
// both arms stay fully animated -- so the character always keeps standing
// on its own two feet through a hit; only the struck area and its pick of
// neighbor actually go limp and recoil. (activateDeath -- the K.O./death
// ragdoll -- ignores this entirely and always builds the full 11-body rig,
// per "1. crollo totale": that one really is meant to fully collapse.)
export const RAGDOLL_PULSE_NEARBY: Record<string, [string, string][]> = {
  Head: [
    ['UpperArm_L', 'ForeArm_L'],
    ['UpperArm_R', 'ForeArm_R'],
  ],
  Torso: [
    ['Thigh_L', 'Shin_L'],
    ['Thigh_R', 'Shin_R'],
  ],
};
