import * as THREE from 'three';

// Coda di effetti di sparo: chi spara (PlayerCombatSoldier.tsx) ci mette
// dentro un evento, WeaponEffects.tsx lo consuma nel suo useFrame e
// anima traccianti/lampi/scintille/fori con oggetti riciclati (nessuna
// allocazione di mesh per colpo).
export type ShotSurface = 'world' | 'body' | 'bag' | 'none';

export interface ShotFx {
  from: THREE.Vector3; // canna
  to: THREE.Vector3; // punto d'impatto (o fine gittata)
  normal: THREE.Vector3 | null;
  surface: ShotSurface;
  // true se la superficie e' statica (terreno, edifici): li' resta il foro
  decal: boolean;
}

const queue: ShotFx[] = [];

// Chi vuole sapere degli spari locali (la rete: CityPlayer li manda agli
// altri giocatori). Gli spari arrivati dalla rete si emettono con
// remote=true e non vengono ripetuti ai listener (niente eco).
type ShotFxListener = (fx: ShotFx) => void;
const listeners = new Set<ShotFxListener>();
export function onLocalShotFx(fn: ShotFxListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitShotFx(fx: ShotFx, remote = false) {
  if (!remote) listeners.forEach((fn) => fn(fx));
  queue.push({
    from: fx.from.clone(),
    to: fx.to.clone(),
    normal: fx.normal ? fx.normal.clone() : null,
    surface: fx.surface,
    decal: fx.decal,
  });
  if (queue.length > 32) queue.shift();
}

export function drainShotFx(): ShotFx[] {
  if (queue.length === 0) return queue;
  return queue.splice(0, queue.length);
}
