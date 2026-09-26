import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { useRapier } from "@react-three/rapier";
import { registerShootableCollider, unregisterShootableCollider } from "../../weapons/shootableRegistry";
import type {
  RigidBody as RapierRigidBody,
  Collider,
  KinematicCharacterController,
} from "@dimforge/rapier3d-compat";
import {
  SOLID_BODY_SEGMENTS,
} from "../ragdollConfig";
import {
  SOLID_BODY_GROUPS,
  SOLID_BODY_RAGDOLL_GROUPS,
} from "../../../../enums/CollisionGroups";

interface SolidBodyEntry {
  body: RapierRigidBody;
  collider: Collider;
  halfHeight: number;
  radius: number;
}

export interface SolidBodySegmentDebug {
  name: string;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  halfHeight: number;
  radius: number;
}

export function useRagdollSolidBodies(
  modelRootRef: React.RefObject<THREE.Object3D | null>,
  resolveBones: () => Record<string, THREE.Bone> | null,
  // Proprietario dei collider per i proiettili (vedi shootableRegistry.ts)
  ownerId?: string
) {
  const { world, rapier } = useRapier();
  const solidBodiesRef = useRef<Record<string, SolidBodyEntry>>({});
  const ownColliderHandlesRef = useRef<Set<number>>(new Set());
  const solidControllerRef = useRef<KinematicCharacterController | null>(null);
  // Le capsule solide sono visibili ai ragdoll KO (CollisionGroups.RagdollBody)
  // -- tranne quando il ragdoll a terra e' il NOSTRO: le capsule seguono le
  // sue stesse ossa e lo spingerebbero da dentro.
  const ragdollBlockerRef = useRef(true);

  const _solidV1 = new THREE.Vector3();
  const _solidV2 = new THREE.Vector3();
  const _solidDir = new THREE.Vector3();
  const _solidCenter = new THREE.Vector3();
  const _solidRot = new THREE.Quaternion();
  const _solidBumpPoint = new THREE.Vector3();
  const _solidBumpDir = new THREE.Vector3();
  const _yAxis = new THREE.Vector3(0, 1, 0);

  const ensureSolidBody = useCallback((): boolean => {
    if (Object.keys(solidBodiesRef.current).length > 0) return true;
    const bones = resolveBones();
    if (!bones) return false;

    if (!solidControllerRef.current) {
      const controller = world.createCharacterController(0.02);
      controller.setSlideEnabled(false);
      solidControllerRef.current = controller;
    }

    const entries = solidBodiesRef.current;
    for (const segment of SOLID_BODY_SEGMENTS) {
      const bone = bones[segment.drivingBone];
      const toBone = bones[segment.toBone];
      if (!bone || !toBone) continue;

      bone.getWorldPosition(_solidV1);
      toBone.getWorldPosition(_solidV2);
      const length = Math.max(0.05, _solidV1.distanceTo(_solidV2) * (segment.lengthScale ?? 0.92));
      const halfHeight = Math.max(0.01, length / 2 - segment.radius);

      const dir = _solidDir.copy(_solidV2).sub(_solidV1);
      const dist = dir.length() || 1;
      dir.normalize();
      const center = _solidCenter.copy(_solidV1).addScaledVector(dir, Math.min(dist / 2, length / 2));
      const rot = _solidRot.setFromUnitVectors(_yAxis, dir);

      const bodyDesc = rapier.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(center.x, center.y, center.z)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
      const body = world.createRigidBody(bodyDesc);
      const colliderDesc = rapier.ColliderDesc.capsule(halfHeight, segment.radius)
        .setCollisionGroups(ragdollBlockerRef.current ? SOLID_BODY_RAGDOLL_GROUPS : SOLID_BODY_GROUPS)
        .setSolverGroups(ragdollBlockerRef.current ? SOLID_BODY_RAGDOLL_GROUPS : SOLID_BODY_GROUPS);
      const collider = world.createCollider(colliderDesc, body);

      entries[segment.name] = { body, collider, halfHeight, radius: segment.radius };
      ownColliderHandlesRef.current.add(collider.handle);
      if (ownerId) registerShootableCollider(collider.handle, { ownerId, segment: segment.name });
    }
    return Object.keys(entries).length > 0;
  }, [rapier, world, resolveBones, ownerId]);

  const syncSolidBody = useCallback(() => {
    const entries = solidBodiesRef.current;
    if (Object.keys(entries).length === 0) return;
    const bones = resolveBones();
    if (!bones) return;

    for (const segment of SOLID_BODY_SEGMENTS) {
      const entry = entries[segment.name];
      if (!entry) continue;
      const bone = bones[segment.drivingBone];
      const toBone = bones[segment.toBone];
      if (!bone || !toBone) continue;

      bone.getWorldPosition(_solidV1);
      toBone.getWorldPosition(_solidV2);
      const dir = _solidDir.copy(_solidV2).sub(_solidV1);
      const dist = dir.length() || 1;
      dir.normalize();
      const length = entry.halfHeight * 2 + entry.radius * 2;
      const center = _solidCenter.copy(_solidV1).addScaledVector(dir, Math.min(dist / 2, length / 2));
      const rot = _solidRot.setFromUnitVectors(_yAxis, dir);

      entry.body.setTranslation({ x: center.x, y: center.y, z: center.z }, true);
      entry.body.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }, true);
    }
    world.propagateModifiedBodyPositionsToColliders();
  }, [resolveBones, world]);

  const resolveBodyMovement = useCallback(
    (
      desiredX: number,
      desiredZ: number,
      bagSolidHandle: number | null,
      onBagBump?: (worldPoint: THREE.Vector3, worldDir: THREE.Vector3, blockedAmount: number) => void
    ): { x: number; z: number } => {
      if (!ensureSolidBody()) return { x: desiredX, z: desiredZ };
      const controller = solidControllerRef.current;
      const entries = solidBodiesRef.current;
      if (!controller) return { x: desiredX, z: desiredZ };

      const desiredMagSq = desiredX * desiredX + desiredZ * desiredZ;
      let bestX = desiredX;
      let bestZ = desiredZ;
      let bestMagSq = desiredMagSq;

      const names = Object.keys(entries);
      const ownHandles = ownColliderHandlesRef.current;
      const excludeOwnParts = (c: Collider) => !ownHandles.has(c.handle);
      for (const name of names) {
        const entry = entries[name];
        controller.computeColliderMovement(
          entry.collider,
          { x: desiredX, y: 0, z: desiredZ },
          undefined,
          SOLID_BODY_GROUPS,
          excludeOwnParts
        );
        let corrected: { x: number; z: number } = controller.computedMovement();
        // "la camminata e la corsa nn mi sembrano corrette" -- misurato: nel
        // duello i PIEDI appoggiati toccano il pavimento (collider fisso) e,
        // con lo scivolamento spento, ogni passo li bloccava contro di esso:
        // il 20% dei frame di camminata il corpo restava fermo (1.2 m/s
        // invece di 1.5, a scatti, e i piedi pattinavano 6-19 cm a passo).
        // Un contatto con normale quasi verticale e' il suolo (o un soffitto)
        // su cui il segmento poggia, non un ostacolo davanti: si ignora.
        {
          const n = controller.numComputedCollisions();
          let onlyGround = n > 0;
          for (let i = 0; i < n && onlyGround; i++) {
            const col = controller.computedCollision(i);
            if (!col || Math.abs(col.normal1.y) < 0.7) onlyGround = false;
          }
          if (onlyGround) corrected = { x: desiredX, z: desiredZ };
        }
        const magSq = corrected.x * corrected.x + corrected.z * corrected.z;
        if (import.meta.env.DEV && magSq < desiredMagSq * 0.96) {
          // chi blocca il corpo solido (misure di camminata/corsa)
          const dbg = ((window as any).__solidBlockDebug ??= {} as Record<string, number>);
          for (let i = 0; i < controller.numComputedCollisions(); i++) {
            const c = controller.computedCollision(i)?.collider;
            if (!c) continue;
            const parent = c.parent();
            const key = `${name}->h${c.handle}:${c.isSensor() ? 'sensor' : 'solid'}:${parent ? (parent.isFixed() ? 'fixed' : parent.isKinematic() ? 'kinematic' : 'dynamic') : 'nobody'}:y${c.translation().y.toFixed(2)}`;
            dbg[key] = (dbg[key] ?? 0) + 1;
          }
        }
        if (magSq < bestMagSq) {
          bestMagSq = magSq;
          bestX = corrected.x;
          bestZ = corrected.z;
        }

        if (onBagBump && bagSolidHandle !== null) {
          const numCollisions = controller.numComputedCollisions();
          for (let i = 0; i < numCollisions; i++) {
            const collision = controller.computedCollision(i);
            if (!collision || !collision.collider) continue;
            if (collision.collider.handle !== bagSolidHandle) continue;
            const remaining = collision.translationDeltaRemaining;
            const blocked = Math.hypot(remaining.x, remaining.z);
            if (blocked <= 0.0005) continue;
            _solidBumpPoint.set(collision.witness1.x, collision.witness1.y, collision.witness1.z);
            _solidBumpDir.set(desiredX, 0, desiredZ);
            onBagBump(_solidBumpPoint, _solidBumpDir, blocked);
          }
        }
      }

      for (const name of names) {
        const entry = entries[name];
        const t = entry.body.translation();
        entry.body.setTranslation({ x: t.x + bestX, y: t.y, z: t.z + bestZ }, true);
      }
      world.propagateModifiedBodyPositionsToColliders();

      return { x: bestX, z: bestZ };
    },
    [ensureSolidBody, world]
  );

  // "perche' il personaggio non collide con gli ostacoli nell'arena?" -- il
  // corpo solido e' cinematico come gli ostacoli (pendoli, pale, pistoni):
  // tra due corpi cinematici Rapier non calcola contatti, e resolveBodyMovement
  // blocca solo i movimenti DEL PERSONAGGIO. Un ostacolo che si muove gli
  // passava attraverso, e poi il personaggio restava incastrato dentro
  // (ogni suo movimento partiva gia' in collisione). Qui, a ogni frame:
  //  - si cercano le compenetrazioni di ogni parte del corpo con gli ostacoli
  //    (query di forma + contactCollider) e si sposta il corpo fuori
  //    (solo in orizzontale), cosi' non resta mai incastrato;
  //  - si restituisce la velocita' dell'ostacolo nel punto di contatto, per
  //    la spinta/colpo (lo gestisce chi chiama: PlayerCombatSoldier/CombatSoldier).
  // Velocita' degli ostacoli: i corpi cinematici mossi con
  // setNextKinematic* in Rapier JS riportano linvel/angvel = 0, quindi la
  // velocita' del punto di contatto si calcola qui dalla posa del corpo al
  // frame prima (registrata per tutti gli ostacoli entro 3 m).
  const prevPosesRef = useRef(new Map<number, { t: THREE.Vector3; q: THREE.Quaternion }>());
  const _pq = useRef({ q: new THREE.Quaternion(), qi: new THREE.Quaternion(), v: new THREE.Vector3(), w: new THREE.Vector3() });
  const resolveObstacleContacts = useCallback(
    (skipHandle: number | null, dt: number): ObstacleContact => {
      const out: ObstacleContact = { pushX: 0, pushZ: 0, hitSpeed: 0, hitVX: 0, hitVZ: 0, hitX: 0, hitY: 0, hitZ: 0, segment: null };
      if (!ensureSolidBody()) return out;
      const entries = solidBodiesRef.current;
      const ownHandles = ownColliderHandlesRef.current;
      const others: Collider[] = [];
      for (const name of Object.keys(entries)) {
        const col = entries[name].collider;
        others.length = 0;
        // prima si raccolgono, poi si interrogano (niente query annidate
        // dentro una callback del mondo: Rapier va in errore)
        world.intersectionsWithShape(
          col.translation(),
          col.rotation(),
          col.shape,
          (other) => {
            others.push(other);
            return true;
          },
          undefined,
          SOLID_BODY_GROUPS,
          undefined,
          undefined,
          (c: Collider) => !ownHandles.has(c.handle) && c.handle !== skipHandle && !c.isSensor()
        );
        for (const other of others) {
          const c = col.contactCollider(other, 0);
          if (!c || c.distance >= 0) continue;
          // fuori dall'ostacolo: contro la normale di questa parte, di quanto compenetra
          const px = c.normal1.x * c.distance;
          const pz = c.normal1.z * c.distance;
          if (Math.hypot(px, pz) > Math.hypot(out.pushX, out.pushZ)) {
            out.pushX = px;
            out.pushZ = pz;
          }
          const body = other.parent();
          const prev = body ? prevPosesRef.current.get(body.handle) : undefined;
          if (body && !body.isFixed() && prev && dt > 1e-4) {
            // punto di contatto nel frame dell'ostacolo, riportato alla posa di prima
            const { q, qi, v, w } = _pq.current;
            const bt = body.translation(), br = body.rotation();
            q.set(br.x, br.y, br.z, br.w);
            qi.copy(q).invert();
            v.set(c.point2.x - bt.x, c.point2.y - bt.y, c.point2.z - bt.z).applyQuaternion(qi);
            w.copy(v).applyQuaternion(prev.q).add(prev.t);
            const vx = (c.point2.x - w.x) / dt, vz = (c.point2.z - w.z) / dt;
            const sp = Math.hypot(vx, vz);
            if (sp > out.hitSpeed) {
              out.hitSpeed = sp;
              out.hitVX = vx;
              out.hitVZ = vz;
              out.hitX = c.point1.x;
              out.hitY = c.point1.y;
              out.hitZ = c.point1.z;
              out.segment = name;
            }
          }
        }
      }
      // pose degli ostacoli vicini, per la velocita' del prossimo frame
      const hips = entries.Hips ?? entries[Object.keys(entries)[0]];
      if (hips) {
        const seen = new Set<number>();
        const ht = hips.body.translation();
        world.intersectionsWithShape(
          ht,
          { x: 0, y: 0, z: 0, w: 1 },
          new rapier.Ball(3),
          (c) => {
            const b = c.parent();
            if (b && b.isKinematic() && !seen.has(b.handle)) {
              seen.add(b.handle);
              const t = b.translation(), r = b.rotation();
              const e = prevPosesRef.current.get(b.handle);
              if (e) {
                e.t.set(t.x, t.y, t.z);
                e.q.set(r.x, r.y, r.z, r.w);
              } else prevPosesRef.current.set(b.handle, { t: new THREE.Vector3(t.x, t.y, t.z), q: new THREE.Quaternion(r.x, r.y, r.z, r.w) });
            }
            return true;
          },
          undefined,
          SOLID_BODY_GROUPS,
          undefined,
          undefined,
          (c: Collider) => !ownHandles.has(c.handle)
        );
        for (const k of prevPosesRef.current.keys()) if (!seen.has(k)) prevPosesRef.current.delete(k);
      }
      // limite per frame: esce in pochi frame senza teletrasporti
      const len = Math.hypot(out.pushX, out.pushZ);
      if (len > 0.12) {
        out.pushX *= 0.12 / len;
        out.pushZ *= 0.12 / len;
      }
      if (len > 0) {
        for (const name of Object.keys(entries)) {
          const t = entries[name].body.translation();
          entries[name].body.setTranslation({ x: t.x + out.pushX, y: t.y, z: t.z + out.pushZ }, true);
        }
        world.propagateModifiedBodyPositionsToColliders();
      }
      return out;
    },
    [ensureSolidBody, world, rapier]
  );

  const getSolidBodySegments = useCallback((): SolidBodySegmentDebug[] => {
    const entries = solidBodiesRef.current;
    const out: SolidBodySegmentDebug[] = [];
    for (const name of Object.keys(entries)) {
      const e = entries[name];
      const t = e.body.translation();
      const r = e.body.rotation();
      out.push({ name, x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w, halfHeight: e.halfHeight, radius: e.radius });
    }
    return out;
  }, []);

  useEffect(
    () => () => {
      for (const name of Object.keys(solidBodiesRef.current)) {
        unregisterShootableCollider(solidBodiesRef.current[name].collider.handle);
        world.removeRigidBody(solidBodiesRef.current[name].body);
      }
      solidBodiesRef.current = {};
      ownColliderHandlesRef.current.clear();
      if (solidControllerRef.current) {
        world.removeCharacterController(solidControllerRef.current);
        solidControllerRef.current = null;
      }
    },
    [world]
  );

  const setRagdollBlocker = useCallback((enabled: boolean) => {
    if (ragdollBlockerRef.current === enabled) return;
    ragdollBlockerRef.current = enabled;
    const g = enabled ? SOLID_BODY_RAGDOLL_GROUPS : SOLID_BODY_GROUPS;
    for (const e of Object.values(solidBodiesRef.current)) {
      e.collider.setCollisionGroups(g);
      e.collider.setSolverGroups(g);
    }
  }, []);

  return {
    syncSolidBody,
    setRagdollBlocker,
    resolveBodyMovement,
    resolveObstacleContacts,
    getSolidBodySegments,
  };
}

export interface ObstacleContact {
  // spostamento (m) gia' applicato al corpo solido per uscire dagli ostacoli:
  // chi chiama lo aggiunge alla posizione del personaggio
  pushX: number;
  pushZ: number;
  // ostacolo in movimento piu' veloce che lo tocca (velocita' orizzontale nel
  // punto di contatto, m/s) e dove
  hitSpeed: number;
  hitVX: number;
  hitVZ: number;
  hitX: number;
  hitY: number;
  hitZ: number;
  segment: string | null;
}
