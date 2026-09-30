import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF, Html } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import { RigidBody, CapsuleCollider, RapierRigidBody, interactionGroups, useRapier } from '@react-three/rapier';
import type { RigidBody as RRigidBody, Collider } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import SpeechBubble from '../UI/SpeechBubble';
import { CollisionGroups } from '../../enums/CollisionGroups';
import type { FighterData } from '../Environment/SquadArenaTypes';
import { RAGDOLL_SEGMENTS, HURTBOX_GROUPS } from '../Environment/ragdoll/ragdollConfig';
import { registerShootableCollider, unregisterShootableCollider, setShotTransparent } from '../Environment/weapons/shootableRegistry';
import { usePistolModel, useGunModel, RIFLE_SPEC } from '../Environment/weapons/usePistolModel';
import { useKnifeModel } from '../Environment/weapons/useKnifeModel';
import { DEFAULT_CAR_SCALE } from '../Vehicles/Car';
import { RemoteMannequin } from './useMannequinNetwork';
import { remoteGunFx } from './remoteRegistry';
import { FINGER_FOLLOW, decodePose, findBones, newDecodedPose, POSE_BONES } from './mannequinPose';

const MODEL_URL = 'soldier-citizen.glb';

// Un altro giocatore: lo stesso manichino, mosso dalla posa che manda
// (mannequinPose.ts). Tra un pacchetto e l'altro (50 ms) si insegue la posa
// con un filtro esponenziale: movimento continuo anche a 20 Hz.
const FOLLOW_RATE = 16; // 1/s
const SNAP_DIST = 6; // m: oltre (teletrasporto, respawn) si salta, non si scivola

// Il corpo solido: blocca il giocatore locale (i suoi capsuloni solidi
// interrogano Characters) finche' il remoto e' in piedi; a terra (ragdoll,
// capriola) si spegne, cosi' non c'e' un palo invisibile sopra il corpo.
const REMOTE_GROUPS = interactionGroups([CollisionGroups.Characters], [CollisionGroups.Characters]);
const CAPSULE_HALF = 0.55;
const CAPSULE_R = 0.3;
const STANDING_PELVIS_Y = 0.6; // m sopra i piedi
const PARKED = { x: 0, y: -1000, z: 0 };

// Bersagli per gli spari: una capsula per segmento del ragdoll (stessi nomi:
// testa, busto, braccia...), cinematiche, messe ogni frame sulle ossa della
// posa ricevuta. Non toccano niente (gruppi vuoti): le trovano solo i raggi
// degli spari, che non filtrano per gruppo (weapons/hitscan.ts).
const HITBOX_GROUPS = 0;

// Hurtbox per il corpo a corpo (pugni, coltello): piu' larga di quella dei
// combattenti locali (0.33) perche' il remoto si vede con ~100 ms di
// ritardo: un colpo che sul suo schermo lo sfiora qui deve prenderlo.
const HURTBOX_HEIGHT = 1.8;
const HURTBOX_RADIUS = 0.45;

const DRONE_URL = 'drone.glb';
const DRONE_MODEL_SCALE = 0.016;

const _pelvisWorld = new THREE.Vector3();
const _tq = new THREE.Quaternion();
const _tp = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _e = new THREE.Euler();

// --- drone e auto dei remoti (solo visivi) ---------------------------------
const RemoteDrone: React.FC<{ remote: RemoteMannequin }> = ({ remote }) => {
  const { scene } = useGLTF(DRONE_URL);
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const ref = useRef<THREE.Group>(null);
  const first = useRef(true);
  useFrame((_, dt) => {
    const d = remote.ext?.drone;
    const g = ref.current;
    if (!g) return;
    g.visible = !!d;
    if (!d) return;
    const k = first.current ? 1 : 1 - Math.exp(-dt * FOLLOW_RATE);
    first.current = false;
    g.position.lerp(_tp.set(d.p[0], d.p[1], d.p[2]), k);
    g.quaternion.slerp(_tq.set(d.q[0], d.q[1], d.q[2], d.q[3]), k);
  });
  return (
    <group ref={ref} scale={DRONE_MODEL_SCALE} visible={false}>
      <primitive object={clone} />
    </group>
  );
};

// Auto che nel mondo di chi guarda non esiste (scenari diversi): copia visiva
const GhostCar: React.FC<{ remote: RemoteMannequin }> = ({ remote }) => {
  const { scene } = useGLTF('car.glb');
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const v = remote.ext?.veh;
    const g = ref.current;
    if (!g || !v) return;
    const k = 1 - Math.exp(-dt * FOLLOW_RATE);
    g.position.lerp(_tp.set(v.p[0], v.p[1], v.p[2]), k);
    g.quaternion.slerp(_tq.set(v.q[0], v.q[1], v.q[2], v.q[3]), k);
  });
  const v = remote.ext?.veh;
  return (
    <group ref={ref} position={v ? v.p : undefined}>
      <primitive object={clone} scale={DEFAULT_CAR_SCALE} />
    </group>
  );
};

const NetworkMannequin: React.FC<{
  id: string;
  remotesRef: React.MutableRefObject<Map<string, RemoteMannequin>>;
  proxy: FighterData;
  message?: string;
}> = ({ id, remotesRef, proxy, message }) => {
  const { scene } = useGLTF(MODEL_URL);
  const { scene: worldScene } = useThree();
  const { world, rapier } = useRapier();
  const info = remotesRef.current.get(id);
  const color = info?.color ?? '#ffffff';
  const name = info?.name ?? '';

  const clone = useMemo(() => {
    const c = SkeletonUtils.clone(scene);
    c.traverse((child: any) => {
      if (child.isSkinnedMesh) {
        child.material = child.material.clone();
        child.material.emissive = new THREE.Color(color);
        child.material.emissiveIntensity = 0.35;
        // il ragdoll puo' portare le ossa lontano dalla radice: il box di
        // culling del modello a riposo non basterebbe
        child.frustumCulled = false;
      }
    });
    return c;
  }, [scene, color]);
  const cloneRef = useRef<THREE.Object3D | null>(clone);
  cloneRef.current = clone;

  const rig = useMemo(() => {
    const map = findBones(clone);
    const bones = POSE_BONES.map((n) => map.get(n) ?? null);
    const followers: [THREE.Object3D, number][] = [];
    for (const [child, parentName] of Object.entries(FINGER_FOLLOW)) {
      const b = map.get(child);
      const idx = (POSE_BONES as readonly string[]).indexOf(parentName);
      if (b && idx >= 0) followers.push([b, idx]);
    }
    const segs = RAGDOLL_SEGMENTS.map((s) => ({ seg: s, from: map.get(s.drivingBone) ?? null, to: map.get(s.toBone) ?? null }));
    return { bones, followers, segs };
  }, [clone]);

  // --- armi in mano (le stesse del giocatore) ----------------------------
  const pistol = usePistolModel(cloneRef);
  const rifle = useGunModel(cloneRef, RIFLE_SPEC);
  const knife = useKnifeModel(cloneRef);
  useEffect(() => {
    remoteGunFx.set(id, {
      shot: (w) => {
        const gun = w === 'rifle' ? rifle : pistol;
        gun.kick();
        gun.playShot();
      },
    });
    return () => {
      remoteGunFx.delete(id);
    };
  }, [id, pistol, rifle]);

  // --- bersagli (spari) e hurtbox (corpo a corpo) --------------------------
  const physRef = useRef<{
    hit: { body: RRigidBody; collider: Collider; seg: (typeof rig.segs)[number] }[];
    hurt: { body: RRigidBody; collider: Collider } | null;
  }>({ hit: [], hurt: null });
  useEffect(() => {
    const hit = rig.segs.map((s) => {
      const body = world.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -1000, 0));
      const collider = world.createCollider(
        rapier.ColliderDesc.capsule(0.1, s.seg.radius).setCollisionGroups(HITBOX_GROUPS).setSolverGroups(HITBOX_GROUPS),
        body
      );
      registerShootableCollider(collider.handle, { ownerId: id, segment: s.seg.name });
      return { body, collider, seg: s };
    });
    const hb = world.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -1000, 0));
    const hc = world.createCollider(
      rapier.ColliderDesc.capsule(Math.max(0.01, HURTBOX_HEIGHT / 2 - HURTBOX_RADIUS), HURTBOX_RADIUS)
        .setSensor(true)
        .setCollisionGroups(HURTBOX_GROUPS)
        .setSolverGroups(HURTBOX_GROUPS),
      hb
    );
    physRef.current = { hit, hurt: { body: hb, collider: hc } };
    proxy.hurtboxHandle = hc.handle;
    return () => {
      for (const h of hit) {
        unregisterShootableCollider(h.collider.handle);
        world.removeRigidBody(h.body);
      }
      world.removeRigidBody(hb);
      physRef.current = { hit: [], hurt: null };
      proxy.hurtboxHandle = null;
    };
  }, [world, rapier, rig, id, proxy]);

  // l'auto guidata esiste anche qui? (altrimenti copia visiva)
  const [ghostCar, setGhostCar] = useState(false);

  // il corpo d'ingombro non ferma gli spari (li prendono i segmenti dentro)
  const bodyRef = useRef<RapierRigidBody>(null);
  useEffect(() => {
    let raf = 0;
    let handle: number | null = null;
    const tryReg = () => {
      const c = bodyRef.current?.collider(0);
      if (!c) {
        raf = requestAnimationFrame(tryReg);
        return;
      }
      handle = c.handle;
      setShotTransparent(handle, true);
    };
    tryReg();
    return () => {
      cancelAnimationFrame(raf);
      if (handle !== null) setShotTransparent(handle, false);
    };
  }, []);
  const carCheckRef = useRef(0);

  const groupRef = useRef<THREE.Group>(null);
  const st = useRef({ seq: -1, hasPose: false, first: true, pose: newDecodedPose() });

  useFrame((_, delta) => {
    const g = groupRef.current;
    const r = remotesRef.current.get(id);
    if (!g || !r) return;
    const s = st.current;
    const ext = r.ext;
    if (r.pose && r.seq !== s.seq) {
      s.seq = r.seq;
      if (decodePose(r.pose, s.pose)) s.hasPose = true;
    }
    g.visible = s.hasPose;
    const k = 1 - Math.exp(-delta * FOLLOW_RATE);

    _tp.set(r.pos[0], r.pos[1], r.pos[2]);
    _tq.set(r.quat[0], r.quat[1], r.quat[2], r.quat[3]);
    if (s.first || g.position.distanceTo(_tp) > SNAP_DIST) {
      g.position.copy(_tp);
      g.quaternion.copy(_tq);
    } else {
      g.position.lerp(_tp, k);
      g.quaternion.slerp(_tq, k);
    }

    if (s.hasPose) {
      const kk = s.first ? 1 : k;
      const { bones, followers } = rig;
      for (let i = 0; i < bones.length; i++) {
        const b = bones[i];
        if (b) b.quaternion.slerp(s.pose.quats[i], kk);
      }
      if (bones[0]) bones[0].position.lerp(s.pose.root, kk);
      if (bones[1]) bones[1].position.lerp(s.pose.pelvis, kk);
      for (const [b, idx] of followers) b.quaternion.copy(s.pose.quats[idx]);
      s.first = false;
    }
    g.updateMatrixWorld(true);

    // armi
    const w = r.weapon;
    const inVeh = !!ext?.veh;
    pistol.setVisible(w === 'pistol' && !inVeh);
    rifle.setVisible(w === 'rifle' && !inVeh);
    knife.setVisible(w === 'knife' && !inVeh);
    rifle.setRaise(ext?.raise ?? 0);
    pistol.update(delta);
    rifle.update(delta);
    knife.update();

    // in piedi? (bacino alto sopra i piedi)
    const pelvis = rig.bones[1];
    let standing = false;
    if (pelvis && s.hasPose) {
      pelvis.getWorldPosition(_pelvisWorld);
      standing = _pelvisWorld.y - g.position.y > STANDING_PELVIS_Y;
    }
    const targetable = s.hasPose && !inVeh;

    // corpo solido (blocca il giocatore locale)
    bodyRef.current?.setNextKinematicTranslation(
      standing && targetable ? { x: _pelvisWorld.x, y: g.position.y + CAPSULE_HALF + CAPSULE_R, z: _pelvisWorld.z } : PARKED
    );
    // bersagli per segmento
    const phys = physRef.current;
    for (const h of phys.hit) {
      const { from, to, seg } = h.seg;
      if (!targetable || !from || !to) {
        h.body.setNextKinematicTranslation(PARKED);
        continue;
      }
      from.getWorldPosition(_a);
      to.getWorldPosition(_b);
      _dir.subVectors(_b, _a);
      const len = Math.max(0.05, _dir.length() * (seg.lengthScale ?? 1));
      _dir.normalize();
      const half = Math.max(0.02, len / 2 - seg.radius);
      if (Math.abs(h.collider.halfHeight() - half) > 0.01) h.collider.setHalfHeight(half);
      _a.addScaledVector(_dir, len / 2);
      _q.setFromUnitVectors(_up, _dir);
      h.body.setNextKinematicTranslation({ x: _a.x, y: _a.y, z: _a.z });
      h.body.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
    }
    phys.hurt?.body.setNextKinematicTranslation(
      targetable ? { x: g.position.x, y: g.position.y + HURTBOX_HEIGHT / 2, z: g.position.z } : PARKED
    );

    // il FighterData "specchio" che il giocatore locale usa come avversario
    // (mira, lock-on, pugni, parata): CityPlayer legge i colpi dati qui
    proxy.position.set(g.position.x, 0, g.position.z);
    proxy.rotation = _e.setFromQuaternion(g.quaternion, 'YXZ').y;
    proxy.isDead = !targetable || !!ext?.dead;
    proxy.currentAnim = ext?.blocking ? REMOTE_BLOCK_ANIM : r.animation;

    // auto: esiste qui? controlla ogni tanto
    carCheckRef.current -= delta;
    if (carCheckRef.current <= 0) {
      carCheckRef.current = 1;
      const want = !!ext?.veh && !worldScene.getObjectByName(ext.veh.id);
      if (want !== ghostCar) setGhostCar(want);
    }
  });

  const remote = info;
  return (
    <>
      <group ref={groupRef} visible={false}>
        <primitive object={clone} rotation={[0, Math.PI, 0]} />
        <Html position={[0, 2.1, 0]} center distanceFactor={10}>
          <div
            style={{
              color,
              background: 'rgba(0,0,0,0.5)',
              padding: '2px 8px',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 'bold',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
          >
            {name}
          </div>
        </Html>
        <SpeechBubble message={message ?? ''} position={[0, 2.4, 0]} />
      </group>
      <RigidBody ref={bodyRef} type="kinematicPosition" colliders={false} position={[0, -1000, 0]}>
        <CapsuleCollider args={[CAPSULE_HALF, CAPSULE_R]} collisionGroups={REMOTE_GROUPS} />
      </RigidBody>
      {remote && <RemoteDrone remote={remote} />}
      {remote && ghostCar && <GhostCar remote={remote} />}
    </>
  );
};

// nome finto della clip di parata (il proxy ha animCatalog.block uguale)
export const REMOTE_BLOCK_ANIM = '__remote_block__';

export default NetworkMannequin;

useGLTF.preload(MODEL_URL);
