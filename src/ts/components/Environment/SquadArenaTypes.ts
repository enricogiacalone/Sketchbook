import * as THREE from 'three';

// Shared types for the Combat Arena ported from simulation-citta's
// "RiggedCitizen" / CombatArenaSimulation. Data objects here are mutated
// IN PLACE every frame by CombatSoldier/CombatTower/CombatMedkit (same
// pattern the original used) rather than going through React state --
// cheap, and each component's own imperative Three.js writes
// (group.position.copy, etc.) are what actually moves things on screen.

export type Team = 'RED' | 'BLUE' | 'NEUTRAL' | string; // FFA fighters get a unique "FFA_i" pseudo-team so nobody shares one
export type GameMode = 'TERRITORY_CONTROL' | 'TEAMS' | 'FFA';

export interface AnimCatalog {
  idle: string;
  run: string;
  walk: string;
  dodge: string;
  block: string;
  taunt: string;
  victory: string;
  death: string;
  // Random pool the AI (CombatSoldier.tsx) still picks from every swing
  // -- unrelated to the three player-choosable strikes below, kept
  // exactly as before so the AI's own attack variety is untouched.
  attacks: string[];
  // "dividi i colpi in piu tasti cosi riesco a sceglierli" -- three
  // distinct, deterministic strikes, each bound to its OWN key/gamepad
  // button in PlayerCombatSoldier.tsx (Jab: Left Click/R2, Cross:
  // Q/Square, Hook: E/Triangle) instead of one button randomly picking
  // from `attacks`. Built the same way as `attacks` (see both fighters'
  // animCatalog useMemo) so each is always a real clip this rig has,
  // never an empty string. The AI never reads these -- it still only
  // uses `attacks` above -- but both catalogs populate them since
  // AnimCatalog is one shared shape.
  attackJab: string;
  attackCross: string;
  attackHook: string;
}

export interface FighterData {
  id: string;
  name: string;
  team: Team;
  hp: number;
  isDead: boolean;
  position: THREE.Vector3;
  rotation: number;
  isAttacking: boolean;
  duelTimer: number;
  attackLock: number;
  currentAnim: string;
  // Set once by CombatSoldier after building its animation catalog, so a
  // fighter can check an opponent's animCatalog.block against their
  // currentAnim (parry check). The original source never actually set
  // this field, which silently made "was the target blocking" always
  // false -- see CombatSoldier.tsx for the fix.
  animCatalog: AnimCatalog | null;
  state: string;
  triggerHit: string | null;
  // World-space X/Z of whoever landed the hit that just set `triggerHit`,
  // captured by the ATTACKER at the moment of impact (see CombatSoldier.tsx/
  // PlayerCombatSoldier.tsx's attack-resolution branches). Lets the
  // victim's own ragdoll pulse ("il colpo deve avvenire precisamente dove
  // le mesh si sono toccate") place the hit-marker on the actual side of
  // their body that was facing the attacker, instead of always the
  // struck segment's own center -- see useRagdoll.ts's pulseHit.
  hitFromX: number;
  hitFromZ: number;
  // "voglio che il colpo avvenga proprio dove ho colpito, non in un
  // range" -- this fighter's own Rapier hurtbox collider handle (see
  // useRagdoll.ts's getHurtboxHandle), refreshed every frame by its own
  // component. An attacker reads the TARGET's handle here and queries it
  // via THEIR OWN ragdoll.pointIntersectsHurtbox -- fighters never call
  // into each other's hooks directly, only through this shared plain-data
  // object, same as every other field here. null until that fighter's
  // hurtbox has been created (its first update() call).
  hurtboxHandle: number | null;
  // "come sarebbe meglio fare in stile euphoria" -- this fighter's own
  // solid-body collider handles+names (see useRagdoll.ts's
  // getSolidBodyHandleNames), refreshed every frame by its own component
  // exactly like hurtboxHandle above. An attacker reads the TARGET's copy
  // here and queries it via THEIR OWN ragdoll.findStruckSegment, so the
  // hit-reaction can target the REAL body part that was struck instead of
  // picking Head/Torso at random. Empty array until that fighter's solid
  // bodies have been created.
  solidBodyHandles: { handle: number; name: string }[];
  // "come sarebbe meglio fare in stile euphoria" -- the REAL segment name
  // (e.g. 'ForeArm_L', 'Thigh_R'...) that findStruckSegment identified for
  // the hit that just set triggerHit/hitFromX/hitFromZ above, captured by
  // the ATTACKER the same way/moment as those two fields. null when the
  // query found no matching solid-body capsule (falls back to the old
  // random Head/Torso pick at the pulseHit call site) or when no hit is
  // currently pending.
  hitSegment: string | null;
  // "metti un opzione in cui l'avversario si ferma e non combatte che
  // posso attivare a piacimento" -- when true, CombatSoldier.tsx (the AI)
  // stands down: no chasing, no attacking, no blocking, just idle -- but
  // still takes damage and still reacts physically to a hit (see its own
  // useFrame guard). Always false for CombatArena.tsx's 120 city fighters
  // (nothing ever sets it there); only DuelArena.tsx's single enemyData
  // gets toggled, mirrored every frame off the store's duelDummyMode (see
  // store.ts's own comment on that field for why the bridge runs through
  // the store instead of a prop).
  isPassive: boolean;
}

export interface TowerData {
  id: number;
  position: THREE.Vector3;
  radius: number;
  owner: Team;
  progress: number;
}

export interface HealingItemData {
  id: number;
  position: THREE.Vector3;
  active: boolean;
  respawnTimer: number;
  healAmount: number;
}

export interface CombatPropData {
  id: string;
  kind: 'CRATE' | 'BARREL';
  position: THREE.Vector3;
  radius: number;
}
