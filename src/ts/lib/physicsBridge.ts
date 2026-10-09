import type RAPIER from '@dimforge/rapier3d-compat';
import type { World } from '@dimforge/rapier3d-compat';

// Il mondo fisico per chi sta fuori da <Physics> (la telecamera,
// useThirdPersonCamera.ts, e' montata dopo): lo scrive PhysicsBridge.tsx,
// montato dentro <Physics> in App.tsx.
export const physicsBridge: { world: World | null; rapier: typeof RAPIER | null } = { world: null, rapier: null };
