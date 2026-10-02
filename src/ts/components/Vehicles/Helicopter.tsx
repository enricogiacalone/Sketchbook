import React, { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, CuboidCollider, RapierRigidBody, useRapier, useBeforePhysicsStep } from '@react-three/rapier';
// CoefficientCombineRule isn't re-exported by @react-three/rapier's own
// types (only as a TS type, not the runtime enum) -- pulled directly from
// its underlying @dimforge/rapier3d-compat dependency instead (already in
// node_modules via @react-three/rapier, just not a direct package.json dep).
import { CoefficientCombineRule } from '@dimforge/rapier3d-compat';
import { useGLTF } from '../../lib/gltf';
import * as THREE from 'three';
import { useInput } from '../../hooks/useInput';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { CollisionGroups, groupsExcluding } from '../../enums/CollisionGroups';
import { simDebug } from '../../debug/simDebug';

interface HelicopterProps {
  position?: [number, number, number];
  id?: string;
  // "ingrandisci anche l'elicottero": scala del modello (come le auto, il
  // modello originale era fatto per il boxman). La dinamica resta quella
  // dell'originale in proporzione: tempi x sqrt(S) (vedi useBeforePhysicsStep).
  scale?: number;
}

const _heliUp = new THREE.Vector3();
const _heliGlobalUp = new THREE.Vector3(0, 1, 0);
const _heliRight = new THREE.Vector3();
const _heliForward = new THREE.Vector3();
const _heliRotStabQuat = new THREE.Quaternion();
const _heliRotStabEuler = new THREE.Euler();
const _heliVertStab = new THREE.Vector3();
const _heliPos = new THREE.Vector3();
const _heliEuler = new THREE.Euler();
const _heliQuat = new THREE.Quaternion();
const _phQuat = new THREE.Quaternion();
const _phUp = new THREE.Vector3();
const _phRight = new THREE.Vector3();
const _phForward = new THREE.Vector3();
const _phVel = new THREE.Vector3();
const _phAng = new THREE.Vector3();
// forme di collisione di heli.glb (come l'originale) e massa 50 kg con
// l'inerzia della scatola che le contiene tutte (cannon)
const HELI_BOXES: { pos: [number, number, number]; half: [number, number, number] }[] = [
  { pos: [0, 0.038, -0.145], half: [0.533, 0.711, 0.559] },
  { pos: [0, 0.401, -1.229], half: [0.208, 0.349, 0.524] },
  { pos: [0, 0.038, 0.621], half: [0.059, 0.711, 0.207] },
  { pos: [0.296, -0.373, 0.621], half: [0.237, 0.3, 0.207] },
  { pos: [-0.296, -0.373, 0.621], half: [0.237, 0.3, 0.207] },
];
// massa vera (gli impulsi di volo sono velocita', non dipendono dalla massa:
// conta solo negli urti -- con 50 kg un'auto o un manichino lo spostavano)
const HELI_MASS = 700;
export const DEFAULT_HELI_SCALE = 1.5;
const HELI_AABB_HALF = [0.534, 0.7895, 1.3035];

const Helicopter: React.FC<HelicopterProps> = ({ position = [-15, 20, 15], id = 'heli-1', scale = DEFAULT_HELI_SCALE }) => {
  const S = scale;
  const TS = Math.sqrt(S);
  const { scene } = useGLTF('heli.glb');
  const clonedScene = useMemo(() => scene.clone(), [scene]);
  // For window.__sim's `grounded`/`numContacts` telemetry -- see
  // Airplane.tsx / debug/simDebug.ts for the full explanation.
  const { world } = useRapier();

  // Same fix as Airplane.tsx / Car.tsx: heli.glb bakes in its own
  // "collision" helper meshes (Cube.NNN boxes + Sphere.NNN spheres, all
  // carrying userData.data === 'collision') authored only to help build the
  // physics hull in Blender, never meant to be visible in-game -- nothing
  // was hiding them here, so they rendered as real geometry (see git
  // history / chat: "l'elicottero ha delle sfere visibili").
  useEffect(() => {
    clonedScene.traverse((child) => {
      if (child.userData?.data === 'collision') child.visible = false;
    });
  }, [clonedScene]);
  const input = useInput();
  // Vehicle entry/exit (including the exit key) is orchestrated centrally
  // by Player.tsx (see vehicleTransition there).
  const {
    currentControllable,
    controlledEntityId,
    controlledSeatType,
    isVehicleTransitioning,
    transitioningEntityId,
    transitioningDoorName,
    updateEntity,
    setPlayerInfo,
    isPaused,
  } = useStore(
    useShallow((state) => ({
      currentControllable: state.currentControllable,
      controlledEntityId: state.controlledEntityId,
      // Only the occupant of the driver seat (seat_1) actually flies the
      // helicopter -- a passenger in seat_2 just rides along. See
      // Player.tsx's getSeatInfo()/seat-switching and Car.tsx's identical
      // isCarActive gate.
      controlledSeatType: state.controlledSeatType,
      isVehicleTransitioning: state.isVehicleTransitioning,
      transitioningEntityId: state.transitioningEntityId,
      transitioningDoorName: state.transitioningDoorName,
      updateEntity: state.updateEntity,
      setPlayerInfo: state.setPlayerInfo,
      isPaused: state.isPaused,
    }))
  );

  // Migrated from @react-three/cannon's useBox to @react-three/rapier's
  // <RigidBody>/<CuboidCollider> -- see Airplane.tsx for the general
  // reasoning (half-extents conversion, collisionGroups). Old full-size box
  // [1.2, 1.5, 4] -> half-extents [0.6, 0.75, 2].
  const ref = useRef<RapierRigidBody>(null);

  useEffect(() => {
    // Populate the store immediately -- see Airplane.tsx/Car.tsx for why.
    if (!ref.current) return;
    const t = ref.current.translation();
    updateEntity(id, { type: 'helicopter', position: [t.x, t.y, t.z] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // massa, inerzia e gravita' come l'originale (forme a densita' 0)
  useEffect(() => {
    const body = ref.current;
    if (!body) return;
    const e = HELI_AABB_HALF.map((h) => h * S);
    const I = [
      (HELI_MASS / 12) * (4 * e[1] * e[1] + 4 * e[2] * e[2]),
      (HELI_MASS / 12) * (4 * e[0] * e[0] + 4 * e[2] * e[2]),
      (HELI_MASS / 12) * (4 * e[1] * e[1] + 4 * e[0] * e[0]),
    ];
    body.setAdditionalMassProperties(HELI_MASS, { x: 0, y: 0, z: 0 }, { x: I[0], y: I[1], z: I[2] }, { x: 0, y: 0, z: 0, w: 1 }, true);
    body.setGravityScale(9.81 / Math.max(0.1, Math.abs(world.gravity.y)), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, S]);

  const velocity = useRef([0, 0, 0]);
  const angularVelocity = useRef([0, 0, 0]);

  const enginePower = useRef(0);
  const activeRef = useRef(false);
  const isPausedRef = useRef(false);
  isPausedRef.current = isPaused;
  const lastTelemetry = useRef<Record<string, unknown>>({});
  const rotorsRef = useRef<THREE.Object3D[]>([]);
  // portiere (door_L/door_R): si aprono mentre il personaggio sale o scende,
  // come le auto (VehicleDoor dell'originale)
  const doorsRef = useRef<{ node: THREE.Object3D; sign: number; open: number }[]>([]);

  useEffect(() => {
    // Same bug/fix as Airplane.tsx: this traversed `scene` (the shared,
    // cached, never-rendered GLTF scene) instead of `clonedScene` (what
    // the <primitive> below actually renders) -- rotating the found
    // "rotor" nodes every frame had no visible effect since they belonged
    // to a completely different, invisible clone of the object graph.
    if (clonedScene) {
      const rotors: THREE.Object3D[] = [];
      clonedScene.traverse((child) => {
        if (child.userData.data === 'rotor') rotors.push(child);
      });
      rotorsRef.current = rotors;
      const doors: { node: THREE.Object3D; sign: number; open: number }[] = [];
      clonedScene.traverse((child) => {
        if (child.name.startsWith('door_')) doors.push({ node: child, sign: -Math.sign(child.position.x) || 1, open: 0 });
      });
      doorsRef.current = doors;
    }
  }, [clonedScene]);

  useFrame((state, delta) => {
    const body = ref.current;
    const isHeliActive =
      currentControllable === 'helicopter' && controlledEntityId === id && !isVehicleTransitioning && controlledSeatType === 'driver';

    if (!body) return;
    // (in pausa fermi anche motore e rotori)
    if (isPaused) return;

    // Synchronous Rapier reads (no more worker-subscription lag -- see
    // Player.tsx's rigidBodyRef comment for the general explanation).
    const lv = body.linvel();
    velocity.current[0] = lv.x;
    velocity.current[1] = lv.y;
    velocity.current[2] = lv.z;
    const av = body.angvel();
    angularVelocity.current[0] = av.x;
    angularVelocity.current[1] = av.y;
    angularVelocity.current[2] = av.z;

    // Keep the store's entities map accurate EVEN WHILE PARKED (nobody
    // driving it yet) -- this used to sit only in the isHeliActive branch
    // below, so a never-entered helicopter's stored position was frozen at
    // whatever ref.current.translation() happened to be at the very first
    // mount-time snapshot (still up near its spawn height, e.g. y=20),
    // forever outside Player.tsx's VEHICLE_SEARCH_RADIUS -- explaining "F
    // nn fa nulla vicino l'elicottero" (F does nothing near the
    // helicopter): Player.tsx's nearest-vehicle search never found it in
    // the first place, regardless of how close the player actually stood.
    // Throttled the same way (~10Hz) as the old active-only call it
    // replaces.
    // elapsedTime e non getElapsedTime(): quella chiama getDelta() e ruba
    // tempo al delta del frame dopo per TUTTI i useFrame (fisica compresa)
    if (state.clock.elapsedTime % 0.1 < 0.02) {
      const t0 = body.translation();
      const rot0 = body.rotation();
      _heliQuat.set(rot0.x, rot0.y, rot0.z, rot0.w);
      _heliEuler.setFromQuaternion(_heliQuat, 'YXZ');
      updateEntity(id, { type: 'helicopter', position: [t0.x, t0.y, t0.z], rotation: _heliEuler.y });
    }

    // Unified telemetry for window.__sim (debug/simDebug.ts) -- see
    // Airplane.tsx for the full writeup; the helicopter previously had NO
    // debug hooks at all, unlike the airplane's ad hoc ones.
    const reportTelemetry = (active: boolean, extra?: Record<string, unknown>) => {
      const rotT = body.rotation();
      _heliQuat.set(rotT.x, rotT.y, rotT.z, rotT.w);
      _heliEuler.setFromQuaternion(_heliQuat, 'YXZ');
      const posT = body.translation();
      const velT = body.linvel();
      const angvelT = body.angvel();
      const collider0 = body.collider(0);
      let numContacts = 0;
      if (collider0)
        world.contactPairsWith(collider0, () => {
          numContacts += 1;
        });
      simDebug.registerVehicle('helicopter', body, {
        id,
        active,
        paused: isPaused,
        enginePower: enginePower.current,
        // Drop consumeJustPressed (a function, not a flag) so this is a
        // plain, JSON.stringify-able snapshot of the actual held keys.
        input: Object.fromEntries(Object.entries(input).filter(([, v]) => typeof v === 'boolean')),
        pos: [posT.x, posT.y, posT.z],
        quat: [rotT.x, rotT.y, rotT.z, rotT.w],
        eulerDeg: [THREE.MathUtils.radToDeg(_heliEuler.y), THREE.MathUtils.radToDeg(_heliEuler.x), THREE.MathUtils.radToDeg(_heliEuler.z)],
        vel: [velT.x, velT.y, velT.z],
        speed: Math.hypot(velT.x, velT.y, velT.z),
        localSpeed: null,
        angvel: [angvelT.x, angvelT.y, angvelT.z],
        sleeping: body.isSleeping(),
        friction: collider0 ? collider0.friction() : null,
        frictionCombineRule: collider0 ? collider0.frictionCombineRule() : null,
        numContacts,
        grounded: numContacts > 0,
        extra,
      });
    };

    {
      const openDoor = isVehicleTransitioning && transitioningEntityId === id ? transitioningDoorName : null;
      const step = 5 * delta;
      for (const d of doorsRef.current) {
        const target = d.node.name === openDoor ? 1 : 0;
        d.open = Math.abs(target - d.open) <= step ? target : d.open + Math.sign(target - d.open) * step;
        d.node.rotation.y = d.sign * d.open;
      }
    }

    // potenza del motore e rotori (come Helicopter.update dell'originale:
    // sale in 5 s con qualcuno ai comandi, scende piano senza)
    activeRef.current = isHeliActive;
    if (isHeliActive) enginePower.current = Math.min(1, enginePower.current + delta * 0.2);
    else enginePower.current = Math.max(0, enginePower.current - delta * 0.06);
    for (let i = 0; i < rotorsRef.current.length; i++) {
      rotorsRef.current[i].rotateX(enginePower.current * delta * 30);
    }
    if (import.meta.env.DEV) reportTelemetry(isHeliActive, isHeliActive ? { ...lastTelemetry.current } : undefined);
    if (!isHeliActive) return;

    const rot = body.rotation();
    _heliQuat.set(rot.x, rot.y, rot.z, rot.w);
    const t = body.translation();
    _heliPos.set(t.x, t.y, t.z);
    _heliEuler.setFromQuaternion(_heliQuat, 'YXZ');
    // Update player info so camera/minimap follow the helicopter
    setPlayerInfo([_heliPos.x, _heliPos.y, _heliPos.z], _heliEuler.y);
  });

  // "anche gli altri veicoli aereo e elicottero" -- Helicopter.physicsPreStep
  // dell'originale, a OGNI passo di fisica (l'originale: 60 Hz, qui 1/120 s:
  // gli incrementi per passo sono riportati al passo vero con k = dt*60, gli
  // smorzamenti come potenze). Differenze dalla versione di prima: gravita'
  // dell'originale (9.81: il nostro mondo ha 20, l'elicottero ha la sua
  // scala di gravita') e stabilizzazione dell'assetto identica (il
  // quaternione scalato a 0.3 dell'originale: un raddrizzamento morbido,
  // prima era ~20 volte piu' forte e l'elicottero non si inclinava quasi).
  useBeforePhysicsStep((w) => {
    const body = ref.current;
    if (!body || isPausedRef.current) return;
    const dt = w.timestep;
    const k = dt * 60;
    const ep = enginePower.current;
    const active = activeRef.current;
    const rot = body.rotation();
    _phQuat.set(rot.x, rot.y, rot.z, rot.w);
    _phUp.set(0, 1, 0).applyQuaternion(_phQuat);
    _phRight.set(1, 0, 0).applyQuaternion(_phQuat);
    _phForward.set(0, 0, 1).applyQuaternion(_phQuat);
    const lv = body.linvel();
    const vel = _phVel.set(lv.x, lv.y, lv.z);

    // spinta (Shift su, Spazio giu')
    if (active && input.shift) vel.addScaledVector(_phUp, 0.15 * ep * k);
    if (active && input.jump) vel.addScaledVector(_phUp, -0.15 * ep * k);

    // stabilizzazione verticale: compensa il 98% della gravita' (vera, quella
    // che sente il corpo) secondo quanto e' dritto, piu' uno smorzamento
    let gc = Math.abs(w.gravity.y) * body.gravityScale() * dt * 0.98;
    gc *= Math.sqrt(THREE.MathUtils.clamp(_heliGlobalUp.dot(_phUp), 0, 1));
    _heliVertStab.copy(_phUp).multiplyScalar(gc);
    _heliVertStab.y += (vel.y * -0.01 * k) / TS;
    vel.addScaledVector(_heliVertStab, ep);

    // smorzamento orizzontale
    // (similitudine con la scala S: rotazioni e smorzamenti piu' lenti di
    // sqrt(S), accelerazioni lineari uguali)
    const posDamp = Math.pow(THREE.MathUtils.lerp(1, 0.995, ep), k / TS);
    vel.x *= posDamp;
    vel.z *= posDamp;
    body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);

    const av = body.angvel();
    const ang = _phAng.set(av.x, av.y, av.z);
    // raddrizzamento (solo con qualcuno ai comandi), come l'originale
    if (active) {
      _heliRotStabQuat.setFromUnitVectors(_phUp, _heliGlobalUp);
      _heliRotStabQuat.x *= 0.3;
      _heliRotStabQuat.y *= 0.3;
      _heliRotStabQuat.z *= 0.3;
      _heliRotStabQuat.w *= 0.3;
      _heliRotStabEuler.setFromQuaternion(_heliRotStabQuat);
      ang.x += (_heliRotStabEuler.x * ep * k) / S;
      ang.y += (_heliRotStabEuler.y * ep * k) / S;
      ang.z += (_heliRotStabEuler.z * ep * k) / S;
    }
    if (active) {
      const r = (0.07 * ep * k) / S;
      if (input.backward) ang.addScaledVector(_phRight, -r); // S: muso su
      if (input.forward) ang.addScaledVector(_phRight, r); // W: muso giu'
      if (input.yawLeft) ang.addScaledVector(_phUp, r);
      if (input.yawRight) ang.addScaledVector(_phUp, -r);
      if (input.left) ang.addScaledVector(_phForward, -r);
      if (input.right) ang.addScaledVector(_phForward, r);
    }
    ang.multiplyScalar(Math.pow(0.97, k / TS));
    body.setAngvel({ x: ang.x, y: ang.y, z: ang.z }, true);
    if (import.meta.env.DEV) {
      lastTelemetry.current = { gravityCompensation: gc, dt, k, vertStab: [_heliVertStab.x, _heliVertStab.y, _heliVertStab.z] };
    }
  });

  return (
    <RigidBody
      ref={ref}
      name={id}
      type="dynamic"
      colliders={false}
      position={position}
      linearDamping={0.01}
      angularDamping={0.01}
      collisionGroups={groupsExcluding(CollisionGroups.Default)}
    >
      {/* Same fix as Airplane.tsx: a bare box chassis with no wheel/
          traction model was resting on Rapier's default friction
          (~0.5) -- low friction here so it doesn't get glued down or
          snag while sliding/tipping on the ground. */}
      {HELI_BOXES.map((b, i) => (
        <CuboidCollider
          key={i}
          args={[b.half[0] * S, b.half[1] * S, b.half[2] * S]}
          position={[b.pos[0] * S, b.pos[1] * S, b.pos[2] * S]}
          density={0}
          friction={0.05}
          restitution={0}
          frictionCombineRule={CoefficientCombineRule.Min}
        />
      ))}
      {/* Chassis box half-height is 0.75; the glb's lowest point sits
          0.673 below the model's own origin, so -0.08 aligns it with
          the box's bottom face. */}
      <primitive object={clonedScene} scale={S} />
    </RigidBody>
  );
};

export default Helicopter;
