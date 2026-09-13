import * as THREE from "three";

// Shared day/night cycle math -- "sistemiamo il cielo... lo vorrei piu
// realistico". Used to live only inline inside Sky.tsx's useFrame, with no
// way for anything else (lighting, fog, stars) to agree on the same sun
// position -- there was a real directional-light-less sky, a flat fixed
// pointLight/ambientLight that never changed with time of day, and no
// night at all in terms of actual illumination. Pulling the math out into
// plain, pure, hook-free functions (same pattern as getTerrainHeight/
// getRoadOffset) lets every consumer (Sky, SunLight, WorldFog, NightSky)
// independently derive the EXACT same sun state from state.clock.elapsedTime
// each frame, with no cross-component synchronization needed.
//
// Also fixes a real bug in the original formula: the old
// `phi = (90 - Math.sin(hourFactor * Math.PI) * 90)` construction gave the
// SAME (maximal, straight-up) sun elevation at both noon AND midnight --
// sin(hourFactor*PI) is 0 at hourFactor=0 (noon) AND at hourFactor=+/-1
// (midnight), so the sun's height above the horizon never actually went
// negative. There was no real "sun below the horizon" state, so the sky
// shader's own day/night fade never really triggered, and scene lighting
// (flat regardless of the shader) definitely never did.

export const DAY_CYCLE_SECONDS = 360; // full day/night in 360s -- user clarified they meant LONGER than 240s, not shorter

// A small tilt so the sun's rise/set points aren't exactly due
// north/south -- purely cosmetic variety, doesn't affect correctness.
const SUN_PATH_TILT = Math.PI * 0.12;
const UP_AXIS = new THREE.Vector3(0, 1, 0);

// "fai cominciare il gioco di giorno" -- elapsedTime starts at 0 the
// moment the Canvas mounts, which without this offset maps to
// timeOfDay=0 (midnight, sun straight down) -- the game always started
// at night. Shifting by half a cycle makes elapsedTime=0 read as noon
// instead; the cycle still runs at the same speed and still goes
// through a full day/night after that, just phase-shifted.
const DAY_START_OFFSET = DAY_CYCLE_SECONDS / 2;

// TEMP DEBUG (Claude): browser-automation testing can't wait out a real
// day/night cycle (or see anything useful at night), and switching desktop
// Spaces mid-test trips App.tsx's own auto-pause (see the
// __disableAutoPause hook there) -- window.__forceTimeOfDay lets a test
// session pin the sun to a fixed hour (e.g. 12 for noon) regardless of
// elapsedTime, consistently across every consumer of this function (Sky,
// SunLight, WorldFog, NightSky all call getTimeOfDay, never compute their
// own time), without touching the real day/night cycle for actual players.
export const getTimeOfDay = (elapsedTime: number): number => {
  const forced = (window as any).__forceTimeOfDay;
  if (typeof forced === 'number') return forced;
  return (((elapsedTime + DAY_START_OFFSET) / DAY_CYCLE_SECONDS) * 24) % 24;
};

// Unit vector pointing FROM the world origin TOWARD the sun. y > 0 means
// above the horizon. Traces a single vertical great circle per day (0 =
// midnight/nadir, 6 = sunrise/horizon, 12 = noon/zenith, 18 =
// sunset/horizon, back to nadir at 24) -- correctly goes negative at
// night, unlike the old formula.
export const getSunDirection = (elapsedTime: number): THREE.Vector3 => {
  const timeOfDay = getTimeOfDay(elapsedTime);
  const a = (timeOfDay / 24) * Math.PI * 2;
  const dir = new THREE.Vector3(0, -Math.cos(a), -Math.sin(a));
  dir.applyAxisAngle(UP_AXIS, SUN_PATH_TILT);
  return dir;
};

// Smooth 0 (full night) .. 1 (full day) ramp across a +/-~7deg twilight
// band around the horizon (sunDirY in [-0.12, 0.12]), instead of a hard
// cutoff at y=0 -- avoids lighting/fog/stars all popping instantly the
// moment the sun crosses the horizon.
export const getDayFactor = (sunDirY: number): number =>
  THREE.MathUtils.smoothstep(sunDirY, -0.12, 0.12);

// Warm-near-horizon / neutral-near-zenith blend factor, 0..1, used to tint
// both the sun light and the fog/horizon color toward orange at sunrise
// and sunset without affecting the color at high noon.
export const getWarmth = (sunDirY: number): number =>
  1 - THREE.MathUtils.clamp(sunDirY, 0, 1);
