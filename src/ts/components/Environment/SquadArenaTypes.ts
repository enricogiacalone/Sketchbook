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
