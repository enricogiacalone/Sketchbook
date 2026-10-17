import React, { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BallCollider, CuboidCollider, RapierRigidBody, RigidBody, useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import * as THREE from 'three';
import { useInput } from '../../hooks/useInput';
import { useStore } from '../../store';
import { CollisionGroups, groupsExcluding } from '../../enums/CollisionGroups';
import { CoefficientCombineRule } from '@dimforge/rapier3d-compat';
import { vehicleBodyHandles } from './vehicleRegistry';
import MotorcycleModel, { applyMotoSuspension } from './MotorcycleModel';
import { MotoSuspension } from '../../lib/motoSuspension';
import { MOTO } from '../../lib/motorcycleGeometry';

// Moto guidabile. Fisica "arcade": un corpo rigido con le rotazioni bloccate che si muove a velocita'
// comandata (accelerazione, freno, resistenza) con il modello di sterzo "a bicicletta" (la velocita'
// di rotazione e' v * tan(sterzo) / interasse); la fisica vera resta per urti, pendenze e salti. L'inclinazione
// in curva (e il beccheggio sul terreno) sono solo del disegno, nel gruppo interno: e' quello che porta
// anche la sella, quindi il pilota si inclina con la moto.
//
// Per salirci il giocatore (PlayerCombatSoldier) cerca nel suo gruppo i nodi `seat_1` ed `entrance_1`, come per
// le auto; lo stato `humanIsDriving` e' lo stesso (currentControllable 'car', id, posto di guida).

const MAX_SPEED = 32; // m/s (~115 km/h)
const REVERSE_SPEED = 2.5;
const ACCEL = 8.5; // m/s^2 a gas aperto (cala con la velocita')
const BRAKE = 14;
const DRAG = 0.012; // resistenza ~ v^2
const ROLLING = 0.9; // m/s^2 senza gas
const MAX_STEER = THREE.MathUtils.degToRad(32);
const STEER_RATE = 5; // 1/s, quanto in fretta il manubrio segue il comando
const MAX_LEAN = THREE.MathUtils.degToRad(38);
const GRAVITY = 9.81;
const BODY_GROUPS = groupsExcluding([CollisionGroups.Default, CollisionGroups.Vehicle, CollisionGroups.Climbable]);

interface Props {
  id?: string;
  position?: [number, number, number];
  yaw?: number;
  // colore del serbatoio non esposto: la moto e' una sola
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();

const Motorcycle: React.FC<Props> = ({ id = 'moto-1', position = [0, 1, 0], yaw = 0 }) => {
  // posizione e orientamento di partenza: fissi (un array nuovo a ogni render farebbe riportare il corpo li' da R3F Rapier)
  const start = useRef({ position, rotation: [0, yaw, 0] as [number, number, number] }).current;
  const { world, rapier } = useRapier();
  const input = useInput();
  const body = useRef<RapierRigidBody>(null);
  const lean = useRef<THREE.Group>(null);
  const fork = useRef<THREE.Group>(null);
  const front = useRef<THREE.Group>(null);
  const rear = useRef<THREE.Group>(null);
  const sprung = useRef<THREE.Group>(null);
  const swingarm = useRef<THREE.Mesh>(null);
  const shock = useRef<THREE.Group>(null);
  const frontSteer = useRef<THREE.Group>(null);
  const susp = useRef(new MotoSuspension()).current;
  const st = useRef({ yaw, speed: 0, steer: 0, lean: 0, pitch: 0, wheelRot: 0, driven: false });

  const isDriven = useStore((s) => s.currentControllable === 'car' && s.controlledEntityId === id && s.controlledSeatType === 'driver');
  // comandi letti nel useFrame (sempre l'ultimo render) e usati dal passo di fisica
  const ctl = useRef({ driven: false, throttle: false, brake: false, hand: false, left: false, right: false });

  useEffect(() => {
    const b = body.current;
    if (!b) return;
    vehicleBodyHandles.add(b.handle);
    // la massa la decidono i dati, non la densita' delle forme
    b.setAdditionalMass(MOTO.massKg, true);
    const t = b.translation();
    useStore.getState().updateEntity(id, { type: 'motorcycle', position: [t.x, t.y, t.z], rotation: yaw });
    return () => {
      vehicleBodyHandles.delete(b.handle);
      useStore.getState().removeEntity(id);
    };
  }, [id, yaw]);

  // controllo e movimento, a passo fisso
  useBeforePhysicsStep(() => {
    const b = body.current;
    if (!b) return;
    const s = st.current;
    const dt = world.timestep;
    const c = ctl.current;
    const driven = c.driven;
    s.driven = driven;
    const lv = b.linvel();
    // velocita' vera in avanti (gli urti la tolgono)
    const fx = Math.sin(s.yaw);
    const fz = Math.cos(s.yaw);
    let sp = lv.x * fx + lv.z * fz;

    const throttle = driven && c.throttle ? 1 : 0;
    const brake = driven && c.brake ? 1 : 0;
    const handbrake = driven && c.hand;
    if (throttle) sp += ACCEL * (1 - Math.max(0, sp) / MAX_SPEED) * dt;
    if (brake) sp -= (sp > 0.3 ? BRAKE : 4) * dt;
    if (handbrake) sp -= BRAKE * 1.5 * dt;
    if (!throttle && !brake) sp -= Math.sign(sp) * Math.min(Math.abs(sp), ROLLING * dt);
    sp -= Math.sign(sp) * DRAG * sp * sp * dt;
    if (!driven && !throttle) sp *= Math.exp(-3 * dt); // parcheggiata: si ferma
    sp = THREE.MathUtils.clamp(sp, -REVERSE_SPEED, MAX_SPEED);
    if (brake && sp < 0 && sp > -0.05) sp = 0;
    s.speed = sp;

    // sterzo: l'effetto cala con la velocita' (a 30 m/s qualche grado fa gia' una curva stretta)
    const steerCmd = driven ? (c.left ? 1 : 0) - (c.right ? 1 : 0) : 0;
    const speedFactor = 1 / (1 + (Math.abs(sp) / 12) ** 2);
    s.steer += (steerCmd * speedFactor - s.steer) * Math.min(1, STEER_RATE * dt);
    const yawRate = (sp * Math.tan(s.steer * MAX_STEER)) / MOTO.wheelbase;
    s.yaw += yawRate * dt;
    // inclinazione: la moto si butta dentro la curva, quanto serve per la forza centrifuga
    const leanTarget = -THREE.MathUtils.clamp(Math.atan((sp * yawRate) / GRAVITY), -MAX_LEAN, MAX_LEAN);
    s.lean += (leanTarget - s.lean) * Math.min(1, 8 * dt);

    _q.setFromAxisAngle(_p.set(0, 1, 0), s.yaw);
    b.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    b.setLinvel({ x: Math.sin(s.yaw) * sp, y: lv.y, z: Math.cos(s.yaw) * sp }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
  });

  const downRay = useRef<InstanceType<typeof rapier.Ray> | null>(null);
  const groundAt = (x: number, y: number, z: number, self: RapierRigidBody): number | null => {
    const ray = (downRay.current ??= new rapier.Ray({ x, y, z }, { x: 0, y: -1, z: 0 }));
    ray.origin.x = x;
    ray.origin.y = y;
    ray.origin.z = z;
    const hit = world.castRay(ray, 3, true, undefined, undefined, undefined, self);
    return hit ? y - hit.timeOfImpact : null;
  };

  useFrame((state, delta) => {
    const b = body.current;
    if (!b) return;
    const s = st.current;
    ctl.current = {
      driven: isDriven && !useStore.getState().isPaused,
      throttle: !!input.forward,
      brake: !!input.backward,
      hand: !!input.jump,
      left: !!input.left,
      right: !!input.right,
    };
    const t = b.translation();
    // beccheggio: pendenza tra i punti di contatto delle due ruote (raggi verso il basso)
    const fx = Math.sin(s.yaw);
    const fz = Math.cos(s.yaw);
    const yRear = groundAt(t.x + fx * MOTO.rearWheel[2], t.y + 0.6, t.z + fz * MOTO.rearWheel[2], b);
    const yFront = groundAt(t.x + fx * MOTO.frontWheel[2], t.y + 0.6, t.z + fz * MOTO.frontWheel[2], b);
    const pitchTarget = yRear !== null && yFront !== null ? -Math.atan2(yFront - yRear, MOTO.wheelbase) : 0;
    s.pitch += (pitchTarget - s.pitch) * Math.min(1, 10 * delta);
    if (lean.current) {
      // la moto ruota intorno alla linea di contatto delle ruote: roll sul suo asse longitudinale
      lean.current.rotation.set(s.pitch, 0, s.lean, 'ZXY');
    }
    susp.update(delta, s.speed, b.linvel().y);
    applyMotoSuspension(
      { sprung: sprung.current, swingarm: swingarm.current, shock: shock.current, fork: fork.current, frontSteer: frontSteer.current },
      susp.h, susp.q, susp.rearExtension, s.steer * MAX_STEER * 0.7
    );
    s.wheelRot += (s.speed * delta) / MOTO.wheelRadius;
    if (front.current) front.current.rotation.x = s.wheelRot;
    if (rear.current) rear.current.rotation.x = s.wheelRot;

    if (s.driven) {
      // il giocatore e' sulla moto: minimappa, missioni e nemici lo seguono
      _e.set(0, s.yaw, 0);
      useStore.getState().setPlayerInfo([t.x, t.y, t.z], s.yaw);
    }
    if (state.clock.elapsedTime % 0.1 < 0.02) useStore.getState().updateEntity(id, { type: 'motorcycle', position: [t.x, t.y, t.z], rotation: s.yaw });
  });

  const [hw, hh, hl] = [0.2, 0.5, 0.95];
  return (
    <RigidBody
      ref={body}
      name={id}
      type="dynamic"
      colliders={false}
      position={start.position}
      rotation={start.rotation}
      enabledRotations={[false, false, false]}
      linearDamping={0.05}
      canSleep={false}
      collisionGroups={BODY_GROUPS}
    >
      {/* le due ruote (sfere: il terreno le fa salire sulle pendenze) e una scatola per il corpo */}
      <BallCollider args={[MOTO.wheelRadius]} position={MOTO.rearWheel} friction={0} frictionCombineRule={CoefficientCombineRule.Min} restitution={0} density={0} />
      <BallCollider args={[MOTO.wheelRadius]} position={MOTO.frontWheel} friction={0} frictionCombineRule={CoefficientCombineRule.Min} restitution={0} density={0} />
      <CuboidCollider args={[hw, hh / 2, hl / 2]} position={[0, 0.62 + hh / 2, 0]} friction={0} frictionCombineRule={CoefficientCombineRule.Min} restitution={0} density={0} />
      <group ref={lean} position={[0, 0, 0]}>
        {/* origine del gruppo interno: sotto la ruota, a meta' interasse; la moto si inclina intorno a li' */}
        <MotorcycleModel rearWheelRef={rear} frontWheelRef={front} forkRef={fork} frontSteerRef={frontSteer} sprungRef={sprung} swingarmRef={swingarm} shockRef={shock}>
          {/* la sella sta sulla massa sospesa: il pilota segue le sospensioni */}
          <object3D name="seat_1" position={MOTO.saddle} />
        </MotorcycleModel>
        <object3D name="entrance_1" position={MOTO.entrance} />
      </group>
    </RigidBody>
  );
};

export default Motorcycle;
