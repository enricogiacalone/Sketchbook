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
  attacks: string[];
  // Second, deterministic punch (as opposed to `attacks`, which is always
  // a random pick) -- "aggiungi un secondo input di pugno" -- lets
  // PlayerCombatSoldier.tsx give the player a distinct, player-chosen
  // second attack on its own key rather than only the random one on
  // primary. Built the same way as `attacks` (see both fighters'
  // animCatalog useMemo) so it's always a real clip this rig has, never
  // an empty string.
  attackAlt: string;
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
