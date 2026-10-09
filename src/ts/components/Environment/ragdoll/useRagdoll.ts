import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import { setBlastWorld } from '../../../lib/explosions';
import { CollisionGroups, allocFighterBit } from '../../../enums/CollisionGroups';
import { useStore } from '../../../store';
import { RAGDOLL_PULSE_NEARBY, HURTBOX_HEIGHT, HURTBOX_RADIUS, HURTBOX_GROUPS } from './ragdollConfig';

import { useRagdollBones } from './hooks/useRagdollBones';
import { useRagdollHurtbox } from './hooks/useRagdollHurtbox';
import { useRagdollSolidBodies, type ObstacleContact, type SolidBodySegmentDebug } from './hooks/useRagdollSolidBodies';

export type { SolidBodySegmentDebug };
import { useRagdollTransient } from './hooks/useRagdollTransient';
import { useRagdollActive, type ActiveRagdollSegmentDebug } from './hooks/useRagdollActive';
import type { JointRange } from './activeRagdollFrames';
import { registerFighterHitHandler } from '../weapons/shootableRegistry';

export type { ActiveRagdollSegmentDebug };

const HIT_PULSE_DURATION = 0.22;
const HIT_BLEND_OUT_DURATION = 0.22;
const MAX_CHAIN_DURATION = 0.9;
const HIT_MARKER_DURATION = 0.3;
const HAND_QUERY_RADIUS = 0.06;
const _identityRot = { x: 0, y: 0, z: 0, w: 1 };

// quanta velocita' orizzontale propria resta al corpo quando un colpo forte lo manda KO
const KNOCK_KEEP = 0.2;
// girarsi sulla schiena: velocita' di rotazione (rad/s), durata massima
// della spinta (s), quando e' "girato" (davanti verso l'alto) e un
// piccolo sollevamento per staccare il fianco dal suolo (m/s)
const ROLL_SPEED = 6;
const ROLL_S = 0.8;
const ROLL_DONE_NY = 0.35;
const ROLL_LIFT = 1.2;

export interface RagdollController {
  // corpo fuori dal mondo (capsule solide e hurtbox), vedi park in fondo
  park: () => void;
  isActive: () => boolean;
  isDeath: () => boolean;
  activateDeath: () => void;
  // Dopo activateDeath (rig transitorio): lancia il corpo morto -- tutti i
  // segmenti a `share` della velocita', quello colpito (se c'e') a piena
  // velocita' (colpo mortale, investimento). No-op col rig attivo.
  launchDeath: (vel: THREE.Vector3, segment?: string | null, share?: number) => void;
  // "vorrei si comportasse piu' da ragdoll se il colpo e' forte" -- colpo
  // forte: il corpo attivo va KO (motori spenti, gravita' piena) e vola con
  // la spinta; poi chi chiama lo rimette in piedi (standUp) quando si e'
  // fermato. false se non c'e' il layer attivo.
  knockDown: (dir: THREE.Vector3, speed: number) => boolean;
  // esplosione (lib/explosions.ts): come knockDown, ma ogni pezzo parte
  // dal centro dell'esplosione verso fuori, piu' forte se piu' vicino (il
  // corpo gira in aria). Vale anche per il corpo gia' a terra o morto.
  // false se non c'e' nessun corpo fisico da spingere.
  blast: (center: THREE.Vector3, speed: number, radius: number) => boolean;
  standUp: () => void;
  isKnockedDown: () => boolean;
  // stato del corpo a terra: fermo? a pancia in su? bacino e direzione della testa
  getLyingState: () => LyingState | null;
  // si gira sulla schiena (se e' caduto a pancia in giu')
  rollOver: () => void;
  pulseHit: (worldImpulseDir: THREE.Vector3, magnitude: number, atSegment?: string, attackerX?: number, attackerZ?: number) => void;
  update: (delta: number, activeRagdollEnabled?: boolean, isIdle?: boolean, isPassive?: boolean) => void;
  // Da chiamare a INIZIO useFrame, prima di mixer.update() (vedi
  // restoreActiveAnimationPose in useRagdollActive.ts).
  beginFrame: () => void;
  // Clip la cui posa iniziale fa da "zero" dei giunti del ragdoll attivo
  // (la guardia) -- vedi captureClipPose in activeRagdollFrames.ts.
  setNeutralClip: (clip: THREE.AnimationClip | null) => void;
  deactivate: () => void;
  getBoneWorldPosition: (boneName: string, target: THREE.Vector3) => boolean;
  getHurtboxHandle: () => number | null;
  pointIntersectsHurtbox: (worldPos: THREE.Vector3, targetHandle: number) => boolean;
  applySpineLean: (pitchRad: number, yawRad: number, weight?: number) => void;
  resolveBodyMovement: (
    desiredX: number,
    desiredZ: number,
    bagSolidHandle: number | null,
    onBagBump?: (worldPoint: THREE.Vector3, worldDir: THREE.Vector3, blockedAmount: number) => void
  ) => { x: number; z: number };
  // ostacoli dell'arena: esce dalle compenetrazioni e dice chi lo sta
  // spingendo (vedi useRagdollSolidBodies.resolveObstacleContacts)
  resolveObstacleContacts: (skipHandle: number | null, dt: number, ignoreBodyHandle?: number | null) => ObstacleContact;
  // getSolidBodySegments: () => SolidBodySegmentDebug[];
  // Vedi ActiveRagdollSegmentDebug in useRagdollActive.ts -- collider
  // fisico e collider bersaglio (animazione) di ogni corpo del layer
  // attivo, con errori e angoli dei giunti rispetto ai limiti.
  getActiveRagdollDebugSegments: () => ActiveRagdollSegmentDebug[];
  // Banco di prova: colpo di prova sul layer attivo e misura dei range
  // dei giunti chiesti dalle clip di animazione.
  testActiveHit: (segmentName: string, dirWorld: THREE.Vector3, speed: number) => boolean;
  measureClipRanges: (
    clips: THREE.AnimationClip[]
  ) => { all: Record<string, JointRange>; perClip: Record<string, Record<string, JointRange>> } | null;
}

// Colpo sul layer attivo: pulseHit riceve una "magnitudo" pensata per il
// sistema transitorio (variazione di velocita' ~0.3 m/s); qui diventa una
// variazione di velocita' vera sul segmento colpito.
const ACTIVE_HIT_SPEED_PER_MAGNITUDE = 40;

const SPINE_LEAN_BONES = ['spine_02', 'spine_03'];
const SPINE_LEAN_CHILD_BONE: Record<string, string> = {
  spine_02: 'spine_03',
  spine_03: 'neck_01',
};
const SPINE_LEAN_MAX_RAD = THREE.MathUtils.degToRad(40);
const SPINE_TWIST_MAX_RAD = THREE.MathUtils.degToRad(80);

export function useRagdoll(
  modelRootRef: React.RefObject<THREE.Object3D | null>,
  // id del combattente (FighterData.id): i suoi collider vengono
  // registrati per i proiettili (weapons/shootableRegistry.ts)
  ownerId?: string
): RagdollController {
  const { world, rapier } = useRapier();
  const { scene } = useThree();
  // le esplosioni spingono anche gli oggetti del mondo (lib/explosions.ts)
  useEffect(() => {
    setBlastWorld(world);
  }, [world]);

  const { resolveBones } = useRagdollBones(modelRootRef);
  // bit del combattente per i gruppi di collisione (vedi FIGHTER_BITS)
  const fighterBitRef = useRef<number | null>(null);
  if (fighterBitRef.current === null) fighterBitRef.current = allocFighterBit();
  const fighterBit = fighterBitRef.current;
  const { syncHurtbox, parkHurtbox, getHurtboxHandle: internalGetHurtboxHandle } = useRagdollHurtbox(modelRootRef);
  const { syncSolidBody, parkSolidBody, resolveBodyMovement, resolveObstacleContacts, getSolidBodySegments } = useRagdollSolidBodies(
    modelRootRef,
    resolveBones,
    ownerId,
    fighterBit
  );
  const {
    buildBodies,
    destroyBodies,
    restoreBonesToAnimation,
    syncAnchors,
    syncBonesFromPhysics,
    clampJointCones,
    clampBodyVelocities,
    stateRef,
    bodiesRef,
  } = useRagdollTransient(modelRootRef, resolveBones);
  const {
    activeBodiesRef,
    ensureActiveRagdoll,
    destroyActiveRagdoll,
    rebuildIfRequested,
    captureActiveTargets,
    driveActiveRagdoll,
    syncActiveBonesBlended,
    restoreActiveAnimationPose,
    resyncActiveRagdollToBones,
    checkActiveRagdollRunaway,
    applyActiveHit,
    getActiveRagdollDebugSegments,
    measureClipRanges,
    setNeutralClip,
    goPassiveNow,
  } = useRagdollActive(modelRootRef, resolveBones, ownerId, fighterBit);
  // KO del layer attivo (morte con ragdoll attivo acceso): motori spenti,
  // gravita' piena, finche' il combattente non viene ricreato/deactivate.
  const activeKnockedOutRef = useRef(false);
  // morto (rig transitorio) quasi fermo da quanti secondi
  const deathStillRef = useRef(0);
  const deathTimeRef = useRef(0);
  const deathHeavyRef = useRef(false);
  const hasActiveRig = () => Object.keys(activeBodiesRef.current).length > 0;

  const markerRef = useRef<THREE.Mesh | null>(null);
  const markerElapsedRef = useRef(0);

  const ensureMarker = useCallback((): THREE.Mesh | null => {
    if (markerRef.current) return markerRef.current;
    const geometry = new THREE.IcosahedronGeometry(0.12, 1);
    const material = new THREE.MeshBasicMaterial({
      color: 0xfff2a8,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.renderOrder = 999;
    mesh.frustumCulled = false;
    scene.add(mesh);
    markerRef.current = mesh;
    return mesh;
  }, [scene]);

  const triggerHitMarker = useCallback(
    (worldPos: THREE.Vector3) => {
      const marker = ensureMarker();
      if (!marker) return;
      marker.position.copy(worldPos);
      marker.visible = true;
      marker.scale.setScalar(0.4);
      (marker.material as THREE.MeshBasicMaterial).opacity = 1;
      markerElapsedRef.current = 0;
    },
    [ensureMarker]
  );

  const activateDeath = useCallback(() => {
    // Con il ragdoll attivo acceso la morte e' il layer attivo che va KO
    // (motori spenti, gravita' piena) -- niente secondo rig transitorio
    // sovrapposto.
    if (hasActiveRig()) {
      activeKnockedOutRef.current = true;
      return;
    }
    if (stateRef.current.active && stateRef.current.isDeath) return;
    // via SUBITO le capsule solide (le parcheggia anche update(), ma solo
    // al frame dopo): il corpo morto lanciato nello stesso frame ci
    // sbatteva contro -- misurato con un'esplosione: da 14 a 4 m/s in 50 ms,
    // il morto restava li' a tremare in piedi a mezz'aria
    parkSolidBody();
    deathStillRef.current = 0;
    deathTimeRef.current = 0;
    deathHeavyRef.current = false;
    destroyBodies();
    buildBodies();
    stateRef.current = {
      active: true,
      isDeath: true,
      pulseElapsed: 0,
      blendElapsed: 0,
      chainElapsed: 0,
    };
  }, [buildBodies, destroyBodies, parkSolidBody]);

  const knockDown = useCallback(
    (dir: THREE.Vector3, speed: number): boolean => {
      if (!hasActiveRig() || stateRef.current.isDeath) return false;
      activeKnockedOutRef.current = true;
      goPassiveNow();
      const entries = activeBodiesRef.current;
      const upper = /^(Head|Spine|Torso|Clavicle|UpperArm|ForeArm)/;
      for (const key of Object.keys(entries)) {
        const b = entries[key].body;
        const v = b.linvel();
        // parte alta spinta di piu' della bassa: il corpo si ribalta
        const k = upper.test(key) ? 1 : key === 'Hips' ? 0.8 : 0.55;
        // "nn viene sbalzato in direzione di dove viene colpito": la velocita'
        // orizzontale che aveva (correva CONTRO la pala, per esempio) si
        // sommava alla spinta e la deviava o la annullava -- il colpo ora la
        // sostituisce quasi tutta: il corpo parte dove lo manda il colpo
        b.setLinvel(
          {
            x: v.x * KNOCK_KEEP + dir.x * speed * k,
            y: v.y + Math.max(0, dir.y) * speed * k + 0.15 * speed,
            z: v.z * KNOCK_KEEP + dir.z * speed * k,
          },
          true
        );
      }
      const head = entries.Head?.body.translation();
      if (head) triggerHitMarker(new THREE.Vector3(head.x, head.y, head.z));
      return true;
    },
    [triggerHitMarker]
  );

  const blast = useCallback(
    (center: THREE.Vector3, speed: number, radius: number): boolean => {
      // pezzi del corpo: quello attivo (vivo o KO) o il rig della morte
      const active = hasActiveRig() && !stateRef.current.isDeath;
      const entries: Record<string, { body: RigidBody }> = active
        ? activeBodiesRef.current
        : stateRef.current.isDeath
          ? bodiesRef.current
          : {};
      const keys = Object.keys(entries);
      if (!keys.length) return false;
      if (active) {
        activeKnockedOutRef.current = true;
        goPassiveNow();
      }
      // velocita' del corpo = speed al bacino; ogni pezzo in proporzione a
      // quanto e' piu' vicino o lontano del bacino dal centro
      const hp = (entries.Hips ?? entries[keys[0]]).body.translation();
      const fHips = Math.max(0.1, 1 - Math.hypot(hp.x - center.x, hp.y - center.y, hp.z - center.z) / radius);
      for (const key of keys) {
        const b = entries[key].body;
        const t = b.translation();
        let dx = t.x - center.x;
        let dy = t.y - center.y;
        let dz = t.z - center.z;
        const dist = Math.hypot(dx, dy, dz) || 1e-3;
        dx /= dist;
        dy = Math.max(dy / dist, 0) + 0.55;
        dz /= dist;
        const l = Math.hypot(dx, dy, dz);
        const f = Math.max(0.1, 1 - dist / radius);
        const s = speed * THREE.MathUtils.clamp(f / fHips, 0.6, 1.6);
        const v = b.linvel();
        b.setLinvel({ x: v.x * 0.3 + (dx / l) * s, y: v.y * 0.3 + (dy / l) * s, z: v.z * 0.3 + (dz / l) * s }, true);
        b.wakeUp();
      }
      return true;
    },
    [activeBodiesRef, bodiesRef, stateRef]
  );

  const standUp = useCallback(() => {
    if (stateRef.current.isDeath) return;
    activeKnockedOutRef.current = false;
  }, []);

  const isKnockedDown = useCallback(() => activeKnockedOutRef.current, []);

  // DEV: KO a comando dal browser (misure di compenetrazione)
  useEffect(() => {
    if (!import.meta.env.DEV || !ownerId) return;
    const reg = ((window as any).__ragdollApi ??= {});
    reg[ownerId] = { knockDown, standUp, isKnockedDown };
    return () => {
      delete reg[ownerId];
    };
  }, [ownerId, knockDown, standUp, isKnockedDown]);

  const _ly = useRef({ h: new THREE.Vector3(), s: new THREE.Vector3(), n: new THREE.Vector3() });
  const getLyingState = useCallback((): LyingState | null => {
    const e = activeBodiesRef.current;
    if (!e.Hips || !e.Head || !e.UpperArm_L || !e.UpperArm_R) return null;
    const hp = e.Hips.body.translation(),
      hd = e.Head.body.translation();
    const l = e.UpperArm_L.body.translation(),
      r = e.UpperArm_R.body.translation();
    const { h, s: sh, n } = _ly.current;
    h.set(hd.x - hp.x, hd.y - hp.y, hd.z - hp.z);
    sh.set(r.x - l.x, r.y - l.y, r.z - l.z);
    // davanti del corpo = testa x spalle (in piedi guarda +Z del modello)
    n.crossVectors(h, sh).normalize();
    let maxV = 0;
    for (const key of Object.keys(e)) {
      const v = e[key].body.linvel();
      maxV = Math.max(maxV, Math.hypot(v.x, v.y, v.z));
    }
    return {
      settled: maxV < 0.5,
      maxSpeed: maxV,
      faceUp: n.y > 0,
      pelvis: new THREE.Vector3(hp.x, hp.y, hp.z),
      headDir: new THREE.Vector3(h.x, 0, h.z).normalize(),
    };
  }, []);

  // Girarsi sulla schiena (il rialzo parte solo da supini). Prima era UNA
  // spinta di rotazione, sempre nello stesso verso: a volte il corpo
  // girava dalla parte del braccio che aveva sotto, si fermava a meta' e
  // si rialzava a pancia in giu' con la clip da supino -- le braccia
  // passavano attraverso il pavimento per raggiungere la posa. Ora gira
  // dalla parte giusta e la spinta dura finche' non e' girato (max ROLL_S).
  const rollRef = useRef({ left: 0, sign: 1, lifted: false });
  const _roll = useRef({ a: new THREE.Vector3(), n: new THREE.Vector3(), h: new THREE.Vector3(), sh: new THREE.Vector3() });
  const frontNormal = (out: THREE.Vector3) => {
    const e = activeBodiesRef.current;
    const hp = e.Hips.body.translation(),
      hd = e.Head.body.translation(),
      l = e.UpperArm_L.body.translation(),
      r = e.UpperArm_R.body.translation();
    const { h, sh } = _roll.current;
    h.set(hd.x - hp.x, hd.y - hp.y, hd.z - hp.z);
    sh.set(r.x - l.x, r.y - l.y, r.z - l.z);
    return out.crossVectors(h, sh).normalize();
  };
  const rollOver = useCallback(() => {
    const e = activeBodiesRef.current;
    if (!e.Hips || !e.Head || !e.UpperArm_L || !e.UpperArm_R) return;
    const hp = e.Hips.body.translation(),
      hd = e.Head.body.translation();
    const { a, n } = _roll.current;
    a.set(hd.x - hp.x, 0, hd.z - hp.z).normalize();
    frontNormal(n);
    // verso di rotazione che porta il davanti in su (d n / dt = w a x n)
    const up = a.z * n.x - a.x * n.z;
    rollRef.current.sign = up >= 0 ? 1 : -1;
    rollRef.current.left = ROLL_S;
    rollRef.current.lifted = false;
  }, []);
  const stepRollAssist = (dt: number) => {
    const rr = rollRef.current;
    if (rr.left <= 0) return;
    rr.left -= dt;
    const e = activeBodiesRef.current;
    if (!e.Hips || !e.Head || !e.UpperArm_L || !e.UpperArm_R) return;
    const { a, n } = _roll.current;
    if (frontNormal(n).y > ROLL_DONE_NY) {
      rr.left = 0;
      return;
    }
    const hp = e.Hips.body.translation(),
      hd = e.Head.body.translation();
    a.set(hd.x - hp.x, 0, hd.z - hp.z).normalize();
    // come un motore: porta la rotazione attorno all'asse bacino->testa
    // almeno a ROLL_SPEED, da corpo rigido (velocita' lineari coerenti)
    const w = e.Hips.body.angvel();
    const cur = (w.x * a.x + w.y * a.y + w.z * a.z) * rr.sign;
    const dw = Math.max(0, ROLL_SPEED - cur) * rr.sign;
    const lift = rr.lifted ? 0 : ROLL_LIFT;
    rr.lifted = true;
    if (dw === 0 && lift === 0) return;
    for (const key of Object.keys(e)) {
      const b = e[key].body;
      const t = b.translation();
      const rx = t.x - hp.x,
        ry = t.y - hp.y,
        rz = t.z - hp.z;
      const v = b.linvel();
      const bw = b.angvel();
      b.setLinvel(
        {
          x: v.x + dw * (a.y * rz - a.z * ry),
          y: v.y + dw * (a.z * rx - a.x * rz) + lift,
          z: v.z + dw * (a.x * ry - a.y * rx),
        },
        true
      );
      b.setAngvel({ x: bw.x + dw * a.x, y: bw.y + dw * a.y, z: bw.z + dw * a.z }, true);
    }
  };

  const pulseHit = useCallback(
    (worldImpulseDir: THREE.Vector3, magnitude: number, atSegment: string = 'Torso', attackerX?: number, attackerZ?: number) => {
      if (stateRef.current.isDeath) return;
      // a terra (KO da colpo forte): il corpo e' gia' tutto fisica
      if (activeKnockedOutRef.current && hasActiveRig()) return;

      // "ragdoll stile euphoria" -- con il layer attivo presente il colpo
      // e' un impulso vero sul corpo attivo colpito (che si piega/incassa
      // e poi i motori lo riportano in guardia), non un secondo rig
      // transitorio sovrapposto.
      if (hasActiveRig() && !activeKnockedOutRef.current) {
        const entry = activeBodiesRef.current[atSegment] ?? activeBodiesRef.current.Torso;
        if (entry) {
          const t = entry.body.translation();
          const dir = new THREE.Vector3();
          if (attackerX !== undefined && attackerZ !== undefined) {
            dir.set(t.x - attackerX, 0, t.z - attackerZ);
            if (dir.lengthSq() < 1e-6) dir.copy(worldImpulseDir);
            dir.normalize();
            dir.y = 0.15;
          } else {
            dir.copy(worldImpulseDir);
          }
          const point = new THREE.Vector3(t.x, t.y, t.z);
          if (attackerX !== undefined && attackerZ !== undefined) {
            const off = new THREE.Vector3(attackerX - t.x, 0, attackerZ - t.z);
            if (off.lengthSq() > 1e-6) point.add(off.normalize().multiplyScalar(entry.segment.radius));
          }
          applyActiveHit(entry.segment.name, dir, magnitude * ACTIVE_HIT_SPEED_PER_MAGNITUDE);
          triggerHitMarker(point);
          return;
        }
      }

      const nearbyOptions = RAGDOLL_PULSE_NEARBY[atSegment] ?? [];
      const nearby = nearbyOptions.length ? nearbyOptions[Math.floor(Math.random() * nearbyOptions.length)] : [];
      const activeSegments = new Set<string>([atSegment, ...nearby]);

      if (!stateRef.current.active) {
        buildBodies(activeSegments);
        stateRef.current = {
          active: true,
          isDeath: false,
          pulseElapsed: 0,
          blendElapsed: 0,
          chainElapsed: 0,
        };
      } else {
        buildBodies(activeSegments);
        if (stateRef.current.chainElapsed < MAX_CHAIN_DURATION) {
          stateRef.current.pulseElapsed = 0;
          stateRef.current.blendElapsed = 0;
        }
      }

      const entry = bodiesRef.current[atSegment] ?? bodiesRef.current.Torso;
      if (entry && magnitude > 0) {
        const mass = entry.body.mass();
        const dir = worldImpulseDir
          .clone()
          .normalize()
          .multiplyScalar(magnitude * mass);
        entry.body.applyImpulse({ x: dir.x, y: dir.y, z: dir.z }, true);

        const t = entry.body.translation();
        const worldPos = new THREE.Vector3(t.x, t.y, t.z);
        if (attackerX !== undefined && attackerZ !== undefined) {
          const offset = new THREE.Vector3(attackerX - t.x, 0, attackerZ - t.z);
          if (offset.lengthSq() > 0.0001) {
            offset.normalize().multiplyScalar(entry.segment.radius);
            worldPos.x += offset.x;
            worldPos.z += offset.z;
          }
        }
        triggerHitMarker(worldPos);
      }
    },
    [buildBodies, triggerHitMarker, applyActiveHit, activeBodiesRef]
  );

  const update = useCallback(
    (delta: number, activeRagdollEnabled: boolean = false, isIdle: boolean = false, isPassive: boolean = false) => {
      if (markerRef.current && markerRef.current.visible) {
        markerElapsedRef.current += delta;
        const t = Math.min(1, markerElapsedRef.current / HIT_MARKER_DURATION);
        (markerRef.current.material as THREE.MeshBasicMaterial).opacity = 1 - t;
        markerRef.current.scale.setScalar(0.4 + t * 0.6);
        if (t >= 1) markerRef.current.visible = false;
      }

      syncHurtbox();
      if (stateRef.current.active && stateRef.current.isDeath) parkSolidBody();
      else syncSolidBody();

      const s = stateRef.current;
      if (!s.active) {
        if (activeRagdollEnabled) {
          ensureActiveRagdoll();
          rebuildIfRequested();
          const passive = isPassive || activeKnockedOutRef.current;
          // Ordine: bersagli dall'animazione (gia' aggiornata da
          // mixer.update / skeleton.pose) -> motori -> ossa dalla fisica.
          if (activeKnockedOutRef.current) stepRollAssist(delta);
          else rollRef.current.left = 0;
          captureActiveTargets(delta);
          if (!passive && checkActiveRagdollRunaway()) {
            resyncActiveRagdollToBones();
          }
          driveActiveRagdoll(delta, passive);
          syncActiveBonesBlended(delta, isIdle, passive ? 1 : undefined);
        } else if (Object.keys(activeBodiesRef.current).length > 0) {
          destroyActiveRagdoll();
        }
        return;
      }

      if (s.isDeath) {
        // "glitch strani" (folla): il morto del rig transitorio non si
        // fermava mai -- strisciava a terra di ~0.3 m/s per sempre (la
        // correzione dei coni dei giunti lo risvegliava a ogni frame).
        // Quasi fermo per un attimo: si addormenta e non si tocca piu'
        // finche' qualcosa non lo urta.
        const bodies = bodiesRef.current;
        let asleep = true;
        let still = true;
        for (const key of Object.keys(bodies)) {
          const b = bodies[key].body;
          if (!b.isSleeping()) asleep = false;
          // solo la velocita' lineare: a terra i pezzi tremano sul posto
          // (misurato: fino a 4.7 rad/s, i coni dei giunti contro i giunti)
          const v = b.linvel();
          if (v.x * v.x + v.y * v.y + v.z * v.z > 0.6 * 0.6) still = false;
        }
        deathStillRef.current = still ? deathStillRef.current + delta : 0;
        // dopo il volo (1.2 s) il morto si "appesantisce": tanto smorzamento,
        // il tremolio dei giunti si spegne e puo' addormentarsi (prima
        // strisciava a ~0.3 m/s per sempre)
        deathTimeRef.current += delta;
        if (deathTimeRef.current > 1.2 && !deathHeavyRef.current) {
          deathHeavyRef.current = true;
          for (const key of Object.keys(bodies)) {
            bodies[key].body.setLinearDamping(3);
            bodies[key].body.setAngularDamping(6);
          }
        }
        if (!asleep) {
          if (deathStillRef.current > 0.8) {
            for (const key of Object.keys(bodies)) bodies[key].body.sleep();
          } else if (!deathHeavyRef.current) clampJointCones();
          // (dopo il volo niente piu' coni: la loro correzione, che sposta
          // i pezzi a mano a ogni frame, era il motore del tremolio)
        }
        syncBonesFromPhysics(1);
        if (activeRagdollEnabled) resyncActiveRagdollToBones();
        return;
      }

      syncAnchors();
      clampBodyVelocities();
      clampJointCones();

      s.chainElapsed += delta;
      s.pulseElapsed += delta;
      if (s.pulseElapsed < HIT_PULSE_DURATION) {
        syncBonesFromPhysics(1);
        if (activeRagdollEnabled) resyncActiveRagdollToBones();
        return;
      }

      s.blendElapsed += delta;
      const weight = Math.max(0, 1 - s.blendElapsed / HIT_BLEND_OUT_DURATION);
      if (weight <= 0) {
        restoreBonesToAnimation();
        destroyBodies();
        stateRef.current = {
          active: false,
          isDeath: false,
          pulseElapsed: 0,
          blendElapsed: 0,
          chainElapsed: 0,
        };
        if (activeRagdollEnabled) resyncActiveRagdollToBones();
        return;
      }
      syncBonesFromPhysics(weight);
      if (activeRagdollEnabled) resyncActiveRagdollToBones();
    },
    [
      syncBonesFromPhysics,
      destroyBodies,
      restoreBonesToAnimation,
      syncAnchors,
      clampBodyVelocities,
      clampJointCones,
      syncHurtbox,
      syncSolidBody,
      ensureActiveRagdoll,
      rebuildIfRequested,
      captureActiveTargets,
      checkActiveRagdollRunaway,
      driveActiveRagdoll,
      syncActiveBonesBlended,
      resyncActiveRagdollToBones,
      destroyActiveRagdoll,
    ]
  );

  const deactivate = useCallback(() => {
    activeKnockedOutRef.current = false;
    destroyBodies();
    stateRef.current = {
      active: false,
      isDeath: false,
      pulseElapsed: 0,
      blendElapsed: 0,
      chainElapsed: 0,
    };
  }, [destroyBodies]);

  useEffect(
    () => () => {
      destroyBodies();
      if (markerRef.current) {
        scene.remove(markerRef.current);
        markerRef.current.geometry.dispose();
        (markerRef.current.material as THREE.Material).dispose();
        markerRef.current = null;
      }
    },
    [destroyBodies, scene]
  );

  const getBoneWorldPosition = useCallback(
    (boneName: string, target: THREE.Vector3): boolean => {
      const bones = resolveBones();
      const bone = bones?.[boneName];
      if (!bone) return false;
      bone.getWorldPosition(target);
      return true;
    },
    [resolveBones]
  );

  const pointIntersectsHurtbox = useCallback(
    (worldPos: THREE.Vector3, targetHandle: number): boolean => {
      let hit = false;
      const shape = new rapier.Ball(HAND_QUERY_RADIUS);
      world.intersectionsWithShape(
        { x: worldPos.x, y: worldPos.y, z: worldPos.z },
        _identityRot,
        shape,
        (collider) => {
          if (collider.handle === targetHandle) {
            hit = true;
            return false;
          }
          return true;
        },
        undefined,
        HURTBOX_GROUPS
      );
      return hit;
    },
    [rapier, world]
  );

  const applySpineLean = useCallback(
    (pitchRad: number, yawRad: number, weight = 1) => {
      if (stateRef.current.active || weight <= 0) return;
      const bones = resolveBones();
      if (!bones) return;
      const clampedPitch = THREE.MathUtils.clamp(pitchRad, -SPINE_LEAN_MAX_RAD, SPINE_LEAN_MAX_RAD);
      const clampedYaw = THREE.MathUtils.clamp(yawRad, -SPINE_TWIST_MAX_RAD, SPINE_TWIST_MAX_RAD);
      const perBonePitch = -clampedPitch / SPINE_LEAN_BONES.length;
      const perBoneYaw = clampedYaw / SPINE_LEAN_BONES.length;
      for (const boneName of SPINE_LEAN_BONES) {
        const bone = bones[boneName];
        if (!bone) continue;
        const child = bones[SPINE_LEAN_CHILD_BONE[boneName]];
        if (child && child.position.lengthSq() > 1e-8) {
          const twistAxis = new THREE.Vector3().copy(child.position).normalize();
          const pitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), perBonePitch);
          const twistQuat = new THREE.Quaternion().setFromAxisAngle(twistAxis, perBoneYaw);
          // SOSTITUISCE la rotazione animata della spina (le clip in piedi
          // l'hanno quasi nulla); con peso < 1 si mescola all'animazione
          twistQuat.multiply(pitchQuat);
          if (weight >= 1) bone.quaternion.copy(twistQuat);
          else bone.quaternion.slerp(twistQuat, weight);
        }
      }
    },
    [resolveBones]
  );

  const testActiveHit = useCallback(
    (segmentName: string, dirWorld: THREE.Vector3, speed: number): boolean => {
      const ok = applyActiveHit(segmentName, dirWorld, speed);
      const e = activeBodiesRef.current[segmentName];
      if (ok && e) {
        const t = e.body.translation();
        triggerHitMarker(new THREE.Vector3(t.x, t.y, t.z));
      }
      return ok;
    },
    [applyActiveHit, activeBodiesRef, triggerHitMarker]
  );

  // "estrai la pistola e la logica di sparo" -- reazione fisica a un
  // proiettile: impulso sul segmento colpito del ragdoll attivo nel punto
  // esatto d'impatto (stile Euphoria: il corpo incassa e poi i motori lo
  // riportano in posa). Senza layer attivo si ripiega sul colpo
  // transitorio, sul segmento equivalente piu' vicino.
  const shotReactionRef = useRef<(segment: string, dir: THREE.Vector3, speed: number, point: THREE.Vector3) => void>(() => {});
  shotReactionRef.current = (segment, dir, speed, point) => {
    if (hasActiveRig()) {
      applyActiveHit(segment, dir, speed, point);
      return;
    }
    const fallback: Record<string, string> = {
      SpineMid: 'Torso',
      SpineHigh: 'Torso',
      ClavicleL: 'UpperArm_L',
      ClavicleR: 'UpperArm_R',
      Hand_L: 'ForeArm_L',
      Hand_R: 'ForeArm_R',
    };
    pulseHit(dir, speed / ACTIVE_HIT_SPEED_PER_MAGNITUDE, fallback[segment] ?? segment);
  };
  useEffect(() => {
    if (!ownerId) return;
    return registerFighterHitHandler(ownerId, (segment, dir, speed, point) => shotReactionRef.current(segment, dir, speed, point));
  }, [ownerId]);

  const launchDeath = useCallback(
    (vel: THREE.Vector3, segment?: string | null, share = 0.45) => {
      if (!stateRef.current.isDeath) return;
      const entries = bodiesRef.current;
      for (const key of Object.keys(entries)) {
        const k = key === segment ? 1 : share;
        entries[key].body.setLinvel({ x: vel.x * k, y: vel.y * k, z: vel.z * k }, true);
      }
    },
    [bodiesRef, stateRef]
  );

  return {
    // corpo fuori dal mondo (capsule solide e hurtbox): per i personaggi
    // lontani o fermi nel pool, che non devono costare ne' bloccare niente.
    // Il prossimo update() li rimette sulle ossa.
    park: () => {
      parkSolidBody();
      parkHurtbox();
    },
    isActive: () => stateRef.current.active,
    isDeath: () => stateRef.current.isDeath,
    activateDeath,
    launchDeath,
    knockDown,
    blast,
    standUp,
    isKnockedDown,
    getLyingState,
    rollOver,
    pulseHit,
    update,
    beginFrame: restoreActiveAnimationPose,
    setNeutralClip,
    deactivate,
    getBoneWorldPosition,
    getHurtboxHandle: internalGetHurtboxHandle,
    pointIntersectsHurtbox,
    applySpineLean,
    resolveBodyMovement,
    resolveObstacleContacts,
    // getSolidBodySegments,
    getActiveRagdollDebugSegments,
    testActiveHit,
    measureClipRanges,
  };
}

export interface LyingState {
  settled: boolean;
  maxSpeed: number;
  faceUp: boolean;
  pelvis: THREE.Vector3;
  headDir: THREE.Vector3; // orizzontale, dal bacino verso la testa
}
