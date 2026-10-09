import * as THREE from 'three';
import type { World } from '@dimforge/rapier3d-compat';
import { crowdPanic } from '../components/city/crowdSim';
import type { FighterData } from '../components/Environment/SquadArenaTypes';

// "le esplosioni nn fanno reagire i malcapitati come dovrebbero.. che sia
// un missile del drone o un meteorite o un esplosione di test da hud":
// UNA esplosione per tutti. Prima ogni fonte faceva a modo suo: il
// meteorite dava solo una spinta al busto del giocatore e danno alle
// "entita'" (i passanti non ricevevano niente: nessuno li ascoltava), il
// missile del drone colpiva solo il suo bersaglio, nessuno andava KO.
//
// explodeAt(): ogni personaggio iscritto (giocatore, nemici dell'arena,
// passanti, nemici e poliziotti della citta') entro il raggio riceve danno
// e una spinta che cala con la distanza, verso fuori e verso l'alto: se
// e' in piedi va KO (o muore e vola), se e' gia' a terra il corpo viene
// rilanciato. I pezzi piu' vicini al centro partono piu' forte degli altri
// (il corpo gira in aria). Gli oggetti dinamici (auto, casse) ricevono un
// impulso; la folla intorno scappa.

export interface BlastEvent {
  center: THREE.Vector3;
  radius: number;
  // 0..1: 1 al centro, 0 sul bordo
  falloff: number;
  // direzione della spinta sul bersaglio (unitaria, gia' con la parte verso l'alto)
  dir: THREE.Vector3;
  // velocita' del corpo (m/s) e danno al bersaglio
  speed: number;
  damage: number;
  source: string;
}

export interface BlastTarget {
  // centro del corpo (mondo); false = non c'e' (addormentato, lontanissimo)
  pos: (out: THREE.Vector3) => boolean;
  onBlast: (ev: BlastEvent) => void;
}

const targets = new Map<string, BlastTarget>();

export function registerBlastTarget(id: string, t: BlastTarget): () => void {
  targets.set(id, t);
  return () => {
    if (targets.get(id) === t) targets.delete(id);
  };
}

// il mondo fisico per spingere gli oggetti (lo iscrive useRagdoll)
let blastWorld: World | null = null;
export function setBlastWorld(w: World | null) {
  blastWorld = w;
}

export interface ExplodeOptions {
  radius?: number; // m
  power?: number; // moltiplicatore (intensita' del pannello Scenari)
  damage?: number; // danno al centro
  source?: string;
  // chi non deve ricevere niente (es. chi ha lanciato il razzo)
  ignore?: string;
}

// velocita' (m/s) di un corpo vicinissimo al centro, a potenza 1
const MAX_BODY_SPEED = 13;
// quanto conta l'alto nella direzione della spinta
const UP_BIAS = 0.55;
// oggetti: variazione di velocita' al centro (m/s), ridotta per i pesanti
const PROP_SPEED = 9;

const _p = new THREE.Vector3();
const _d = new THREE.Vector3();

export function explodeAt(center: THREE.Vector3 | [number, number, number], opts: ExplodeOptions = {}) {
  const c = Array.isArray(center) ? new THREE.Vector3(...center) : center.clone();
  const radius = opts.radius ?? 6;
  const power = opts.power ?? 1;
  const dmg = opts.damage ?? 40;
  const source = opts.source ?? 'esplosione';

  for (const [id, t] of targets) {
    if (id === opts.ignore || !t.pos(_p)) continue;
    _d.subVectors(_p, c);
    const dist = _d.length();
    if (dist >= radius) continue;
    const falloff = 1 - dist / radius;
    // fuori e in alto; sotto i piedi (meteorite caduto addosso): quasi solo in alto
    if (dist < 1e-3) _d.set(0, 1, 0);
    else _d.divideScalar(dist);
    _d.y = Math.max(_d.y, 0) + UP_BIAS;
    _d.normalize();
    t.onBlast({
      center: c.clone(),
      radius,
      falloff,
      dir: _d.clone(),
      speed: MAX_BODY_SPEED * power * Math.pow(falloff, 0.6),
      damage: Math.round(dmg * power * falloff),
      source,
    });
  }

  // oggetti dinamici (auto, casse, oggetti di scena): i corpi dei
  // personaggi (gruppo Ragdoll, 5) li gestiscono i personaggi stessi
  const w = blastWorld;
  if (w) {
    const pushed = new Set<number>();
    w.colliders.forEach((col) => {
      const b = col.parent();
      if (!b || !b.isDynamic() || pushed.has(b.handle)) return;
      if (((col.collisionGroups() >>> 16) & (1 << 5)) !== 0) return;
      const t = b.translation();
      _d.set(t.x - c.x, t.y - c.y, t.z - c.z);
      const dist = _d.length();
      if (dist >= radius) return;
      pushed.add(b.handle);
      const falloff = 1 - dist / radius;
      if (dist < 1e-3) _d.set(0, 1, 0);
      else _d.divideScalar(dist);
      _d.y = Math.max(_d.y, 0) + UP_BIAS;
      _d.normalize();
      const m = b.mass();
      // i pesanti si muovono meno (un'auto da 1100 kg ~ un terzo)
      const dv = PROP_SPEED * power * falloff * Math.min(1, Math.pow(80 / Math.max(1, m), 0.25));
      const col0 = b.collider(0);
      const cp = col0 ? col0.translation() : t;
      // un po' fuori centro: gira
      b.applyImpulseAtPoint(
        { x: _d.x * dv * m, y: _d.y * dv * m, z: _d.z * dv * m },
        { x: cp.x - _d.x * 0.3, y: cp.y - 0.3, z: cp.z - _d.z * 0.3 },
        true
      );
    });
  }

  // chi e' intorno scappa
  crowdPanic(c.x, c.z, Math.max(30, radius * 4));
}

// Un combattente (FighterData) come bersaglio: danno, poi KO o morte con
// la spinta dell'esplosione. Chi lo usa consuma data.knockdown come per
// ogni colpo forte (KO + blast del corpo) anche da morto. Gia' a terra o
// morto: il corpo viene rilanciato subito.
export function registerFighterBlast(
  data: FighterData,
  body: {
    blast: (center: THREE.Vector3, speed: number, radius: number) => boolean;
    getBoneWorldPosition: (bone: string, out: THREE.Vector3) => boolean;
  },
  isDown: () => boolean,
  opts: { present?: () => boolean; onDamage?: (amount: number) => void } = {}
): () => void {
  return registerBlastTarget(data.id, {
    pos: (out) => {
      if (opts.present && !opts.present()) return false;
      if (body.getBoneWorldPosition('spine_02', out)) return true;
      out.set(data.position.x, data.position.y + 1, data.position.z);
      return true;
    },
    onBlast: (ev) => {
      if (data.isDead || isDown()) {
        body.blast(ev.center, ev.speed, ev.radius);
        return;
      }
      if (opts.onDamage) opts.onDamage(ev.damage);
      data.hp -= ev.damage;
      if (data.hp <= 0) {
        data.hp = 0;
        data.isDead = true;
        data.attackLock = 0;
      }
      data.knockdown = {
        dirX: ev.dir.x,
        dirZ: ev.dir.z,
        speed: ev.speed,
        up: ev.dir.y,
        blast: { x: ev.center.x, y: ev.center.y, z: ev.center.z, radius: ev.radius, speed: ev.speed },
      };
    },
  });
}

// dopo il KO o la morte: ogni pezzo del corpo dal centro dell'esplosione
export function applyKnockdownBlast(
  k: FighterData['knockdown'],
  body: { blast: (center: THREE.Vector3, speed: number, radius: number) => boolean }
) {
  if (!k?.blast) return;
  body.blast(new THREE.Vector3(k.blast.x, k.blast.y, k.blast.z), k.blast.speed, k.blast.radius);
}

if (import.meta.env.DEV) (window as any).__explodeAt = explodeAt;
