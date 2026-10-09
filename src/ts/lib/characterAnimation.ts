import * as THREE from "three";

// Shared by every boxman.glb-driven character -- Player, Enemy, and
// (potentially) Pedestrian all use the exact same rig/clip set, so this is
// the single place defining which bones count as "upper body"
// (arms/torso/head, driven by a one-off overlay like "shoot") vs
// "lower body" (legs/hips, driven by whatever locomotion clip is playing).
// "il nemico o il pedone o il player devono avere tutti le stesse
// animazioni e caratteristiche sono tutti characters" -- keeping this in
// one shared module instead of copy-pasted per-component bone lists is
// what actually guarantees that: Player.tsx and Enemy.tsx both import
// these same arrays rather than maintaining their own (drifting) copies.
//
// Layering (not weight-blending) is required because three.js's
// PropertyMixer.accumulate() normalizes weight across every ACTIVE action
// touching a given bone -- two actions both at weight=1 on the same bone
// blend ~50/50 instead of the later one overriding, which is exactly what
// caused "tiene le mani basse" (hands stay low) before this was in place.
// See PropertyMixer.js for the actual accumulation math if this ever needs
// re-deriving.
export const UPPER_BODY_BONES = [
  "body_upper",
  "head",
  "arm_upper.L",
  "arm_lower.L",
  "arm_upper.R",
  "arm_lower.R",
];

export const LOWER_BODY_BONES = [
  "root",
  "butt_bone",
  "body_lower",
  "leg_upper.L",
  "leg_lower.L",
  "leg_upper.R",
  "leg_lower.R",
];

// GLTFLoader's PropertyBinding.sanitizeNodeName strips reserved characters
// (including '.') when building AnimationClip track names, so a bone
// named "arm_upper.L" produces track names prefixed "arm_upperL", NOT
// "arm_upper.L". Any bone-name filter has to sanitize the same way before
// comparing, or it silently matches nothing (see git history: "vedo solo
// la testa muoversi allo sparo.. le braccia nn fanno l animazione").
export function filterTracksByBones(
  clip: THREE.AnimationClip,
  bones: string[]
): THREE.KeyframeTrack[] {
  const sanitized = bones.map((bone) => THREE.PropertyBinding.sanitizeNodeName(bone));
  return clip.tracks.filter((t) => sanitized.some((bone) => t.name.startsWith(bone + ".")));
}
