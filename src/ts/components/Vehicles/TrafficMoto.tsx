import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RapierRigidBody, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { useGLTF } from '../../lib/gltf';
import { useStore } from '../../store';
import { CollisionGroups, groupsExcluding } from '../../enums/CollisionGroups';
import { MANNEQUIN_URL, MANNEQUIN_BASE_ANIMS_URL } from '../city/useMannequinActor';
import { K, KIMODO_ANIMS_URL } from '../../lib/kimodo';
import { MOTO } from '../../lib/motorcycleGeometry';
import { vehicleBodyHandles } from './vehicleRegistry';
import MotorcycleModel, { applyMotoSuspension } from './MotorcycleModel';
import { MotoSuspension } from '../../lib/motoSuspension';

// Moto del traffico civile: la posizione la decide la simulazione di Traffic.tsx (la stessa delle auto: corsie,
// semafori, code, svolte); qui si disegnano -- inclinate in curva, con le ruote che girano e un pilota seduto --
// e hanno un corpo cinematico per urtare i personaggi (come le auto fisiche del traffico).

export interface TrafficMotoState {
  id: number;
  x: number;
  y: number; // quota del centro del telaio dell'auto (Traffic.tsx: suolo + 0.62)
  z: number;
  yaw: number;
  speed: number;
}

const BODY_COLORS = ['#c62828', '#1565c0', '#2e7d32', '#f9a825', '#6a1b9a', '#ef6c00', '#455a64', '#00838f'];
const RIDER_COLORS = ['#8d6e63', '#607d8b', '#9e9d24', '#6d4c41', '#78909c', '#a1887f', '#5d4037', '#827717', '#455a64'];
const HIDE_DIST = 170;
const MAX_LEAN = THREE.MathUtils.degToRad(32);
const BODY_GROUPS = groupsExcluding([CollisionGroups.Default, CollisionGroups.Vehicle, CollisionGroups.Climbable]);
const RIDE_Y = 0.62; // come Traffic.tsx
// il pilota ha lo stesso riferimento del giocatore (PlayerCombatSoldier: VEH_SEAT.motorcycle, 0.45 sotto la sella)
const SEAT_DOWN = 0.45;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

const TrafficMoto: React.FC<{ car: TrafficMotoState }> = ({ car }) => {
  const { scene } = useGLTF(MANNEQUIN_URL);
  const { animations: base } = useGLTF(MANNEQUIN_BASE_ANIMS_URL);
  const { animations: kimodo } = useGLTF(KIMODO_ANIMS_URL);
  const bodyColor = BODY_COLORS[car.id % BODY_COLORS.length];
  const riderColor = RIDER_COLORS[(car.id * 7) % RIDER_COLORS.length];
  const root = useRef<THREE.Group>(null);
  const lean = useRef<THREE.Group>(null);
  const fork = useRef<THREE.Group>(null);
  const sprung = useRef<THREE.Group>(null);
  const swingarm = useRef<THREE.Mesh>(null);
  const shock = useRef<THREE.Group>(null);
  const frontSteer = useRef<THREE.Group>(null);
  const susp = useRef(new MotoSuspension()).current;
  const front = useRef<THREE.Group>(null);
  const rear = useRef<THREE.Group>(null);
  const body = useRef<RapierRigidBody>(null);
  const st = useRef({ yaw: car.yaw, lean: 0, steer: 0, wheel: 0, init: false, gy: undefined as number | undefined });

  const { clone, mixer } = useMemo(() => {
    const c = SkeletonUtils.clone(scene);
    c.traverse((child: any) => {
      if (child.isSkinnedMesh) {
        child.material = child.material.clone();
        child.material.emissive = new THREE.Color(riderColor);
        child.material.emissiveIntensity = 0.45;
        child.frustumCulled = false;
      }
    });
    return { clone: c, mixer: new THREE.AnimationMixer(c) };
  }, [scene, riderColor]);

  useEffect(() => {
    // la clip Kimodo della marcia se c'e', altrimenti quella di guida dell'auto
    const clip = kimodo.find((a) => a.name === K.moto.ride) ?? base.find((a) => a.name === 'Driving');
    if (!clip) return;
    const a = mixer.clipAction(clip);
    a.play();
    return () => {
      a.stop();
    };
  }, [kimodo, base, mixer]);

  useEffect(() => {
    const b = body.current;
    if (!b) return;
    vehicleBodyHandles.add(b.handle);
    return () => {
      vehicleBodyHandles.delete(b.handle);
    };
  }, []);

  useFrame((state, delta) => {
    const g = root.current;
    if (!g) return;
    const s = st.current;
    const pp = useStore.getState().playerPos;
    const d = Math.hypot(car.x - pp[0], car.z - pp[2]);
    const near = d < HIDE_DIST;
    g.visible = near;
    if (!s.init) {
      s.init = true;
      s.yaw = car.yaw;
    }
    const dt = Math.min(delta, 0.05);
    // velocita' di rotazione dalla simulazione (cambia a scatti sul teletrasporto: si ignora se enorme)
    let yawRate = dt > 0 ? wrap(car.yaw - s.yaw) / dt : 0;
    if (Math.abs(yawRate) > 3) yawRate = 0;
    s.yaw = car.yaw;
    const v = Math.max(0, car.speed);
    const leanTarget = -THREE.MathUtils.clamp(Math.atan((v * yawRate) / 9.81), -MAX_LEAN, MAX_LEAN);
    s.lean += (leanTarget - s.lean) * Math.min(1, 8 * dt);
    s.steer += (Math.atan((yawRate * MOTO.wheelbase) / Math.max(v, 1.5)) - s.steer) * Math.min(1, 8 * dt);
    s.wheel += (v * dt) / MOTO.wheelRadius;
    const gy = car.y - RIDE_Y;
    g.position.set(car.x, gy, car.z);
    g.rotation.y = car.yaw;
    if (lean.current) lean.current.rotation.set(0, 0, s.lean, 'ZXY');
    const vy = dt > 0 && s.gy !== undefined ? (gy - s.gy) / dt : 0;
    s.gy = gy;
    susp.update(dt, v, Math.abs(vy) > 8 ? 0 : vy);
    applyMotoSuspension(
      { sprung: sprung.current, swingarm: swingarm.current, shock: shock.current, fork: fork.current, frontSteer: frontSteer.current },
      susp.h, susp.q, susp.rearExtension, THREE.MathUtils.clamp(s.steer, -0.5, 0.5) * 0.7
    );
    if (front.current) front.current.rotation.x = s.wheel;
    if (rear.current) rear.current.rotation.x = s.wheel;
    if (near) mixer.update(dt);
    const b = body.current;
    if (b) {
      _q.setFromAxisAngle(_up, car.yaw);
      b.setNextKinematicTranslation({ x: car.x, y: gy, z: car.z });
      b.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
    }
    void state;
  });

  return (
    <>
      <group ref={root}>
        <group ref={lean}>
          <MotorcycleModel rearWheelRef={rear} frontWheelRef={front} forkRef={fork} frontSteerRef={frontSteer} sprungRef={sprung} swingarmRef={swingarm} shockRef={shock} color={bodyColor}>
          {/* il pilota: seduto, come il giocatore (origine dei piedi 0.45 sotto la sella) */}
          <group position={[0, MOTO.saddle[1] - SEAT_DOWN, MOTO.saddle[2]]}>
            <primitive object={clone} />
          </group>
          </MotorcycleModel>
        </group>
      </group>
      <RigidBody ref={body} type="kinematicPosition" colliders={false} collisionGroups={BODY_GROUPS} position={[car.x, car.y - RIDE_Y, car.z]}>
        <CuboidCollider args={[0.25, 0.55, 0.95]} position={[0, 0.6, 0]} friction={0} />
      </RigidBody>
    </>
  );
};

export default TrafficMoto;
