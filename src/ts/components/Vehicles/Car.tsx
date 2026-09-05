import React, { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useBox } from '@react-three/cannon';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useInput } from '../../hooks/useInput';
import { useStore } from '../../store';

interface CarProps {
  position?: [number, number, number];
  id?: string;
}

const Car: React.FC<CarProps> = ({ position = [10, 5, 0], id = 'car-1' }) => {
  const { scene } = useGLTF('car.glb');
  const clonedScene = useMemo(() => {
    const s = scene.clone();
    s.traverse((child) => {
      // Hide all wheel models as requested
      if (child.userData.data === 'wheel' || child.name.toLowerCase().includes('wheel')) {
        child.visible = false;
      }
    });
    return s;
  }, [scene]);
  
  const input = useInput();
  // Vehicle entry/exit (including the exit key) is orchestrated centrally
  // by Player.tsx (see vehicleTransition there) -- it owns walking the
  // character to the seat/door and back, so this component only needs to
  // know whether IT currently has driving control.
  const { currentControllable, controlledEntityId, isVehicleTransitioning, transitioningEntityId, updateEntity, setPlayerInfo } = useStore();
  const [isReady, setIsReady] = useState(false);

  // -- Door, mirroring the original's VehicleDoor: swings open for the
  // whole entering/exiting transition and closes the rest of the time
  // (parked or driving). Found and oriented once from the glb below.
  const doorRef = useRef<THREE.Object3D | undefined>(undefined);
  const doorSign = useRef(1);
  const doorOpenFactor = useRef(0);
  const DOOR_ROTATION_SPEED = 5; // rad/sec, matches the original's VehicleDoor.rotationSpeed
  const DOOR_MAX_ANGLE = 1; // radians (~57deg), matches the original's targetRotation of 1

  useEffect(() => {
    const entrance = clonedScene.getObjectByName('entrance_1');
    if (!entrance) return;
    const entrancePos = new THREE.Vector3();
    entrance.getWorldPosition(entrancePos);

    let nearestDoor: THREE.Object3D | null = null;
    let nearestDist = Infinity;
    clonedScene.traverse((child) => {
      if (child.name.toLowerCase().startsWith('door')) {
        const p = new THREE.Vector3();
        child.getWorldPosition(p);
        const d = p.distanceTo(entrancePos);
        if (d < nearestDist) {
          nearestDist = d;
          nearestDoor = child;
        }
      }
    });

    if (nearestDoor) {
      doorRef.current = nearestDoor;
      // The door's own local X (relative to its parent, the car body) says
      // which side of the car it's on; every door panel on this model
      // extends toward local -Z from a hinge at local Z=0 (checked against
      // the glb), so a door on the +X (right) side needs a NEGATIVE Y
      // rotation to swing outward, and one on the -X (left) side needs a
      // POSITIVE one.
      doorSign.current = -Math.sign((nearestDoor as THREE.Object3D).position.x) || 1;
    }
  }, [clonedScene]);

  const chassisArgs: [number, number, number] = [1.2, 0.7, 3];

  // Chassis Body - Now the ONLY physical body for the car
  const [chassisRef, chassisApi] = useBox<THREE.Mesh>(() => ({
    allowSleep: false,
    args: chassisArgs,
    mass: 150,
    position: position,
    linearDamping: 0.5,
    angularDamping: 0.5,
    collisionFilterGroup: 1, // Default
    collisionFilterMask: -1, // Collide with everything
  }));

  const velocity = useRef([0, 0, 0]);
  useEffect(() => {
    const unsubVel = chassisApi.velocity.subscribe(v => velocity.current = v);
    const unsubPos = chassisApi.position.subscribe((p) => {
      if (p) {
        updateEntity(id, { 
          type: 'car', 
          position: p as [number, number, number] 
        });
        setIsReady(true);
      }
    });
    return () => { unsubVel(); unsubPos(); };
  }, [chassisApi, updateEntity, id]);

  useFrame((state, delta) => {
    if (!isReady || !chassisRef.current) return;

    // Door animation runs whenever THIS car is the one being entered or
    // exited, regardless of whether driving control has actually handed
    // over yet -- controlledEntityId only updates once the transition
    // finishes, so during "entering" it still points at whatever was
    // controlled before (see transitioningEntityId in store.ts).
    if (doorRef.current) {
      const doorShouldBeOpen = isVehicleTransitioning && transitioningEntityId === id;
      const target = doorShouldBeOpen ? 1 : 0;
      const step = DOOR_ROTATION_SPEED * delta;
      const diff = target - doorOpenFactor.current;
      doorOpenFactor.current = Math.abs(diff) <= step ? target : doorOpenFactor.current + Math.sign(diff) * step;
      doorRef.current.rotation.y = doorSign.current * doorOpenFactor.current * DOOR_MAX_ANGLE;
    }

    // While a vehicle-entry/exit animation is playing, the character
    // hasn't actually taken (or given up) the wheel yet -- ignore input
    // so the car can't still be steered mid-exit.
    const isCarActive = currentControllable === 'car' && controlledEntityId === id && !isVehicleTransitioning;

    if (!isCarActive) return;

    const moveSpeed = 45;
    const turnSpeed = 2.5;
    
    const quat = chassisRef.current.quaternion;
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);

    // Dampen lateral (sideways) velocity to simulate tire grip
    const velVec = new THREE.Vector3(...velocity.current);
    const lateralSpeed = velVec.dot(right);
    const lateralCorrection = right.clone().multiplyScalar(-lateralSpeed * 0.92);
    // Car mass is 150
    chassisApi.applyImpulse([lateralCorrection.x * 150, lateralCorrection.y * 150, lateralCorrection.z * 150], [0, 0, 0]);

    // Simple movement logic without wheels.
    // moveSpeed/turnSpeed were tuned as a fixed impulse applied once per
    // RENDERED frame, with no time scaling at all -- so the actual driving
    // force (and turn rate) depended entirely on the display's refresh
    // rate: a 120Hz ProMotion display applies these impulses twice as
    // often per second as a 60Hz one, doubling acceleration and turning,
    // which is exactly the kind of thing that reads as "doesn't drive
    // right". `dt60` renormalizes every continuous-force impulse/torque
    // below to the tuning's implicit 60fps baseline (dt60 == 1 at exactly
    // 60fps, preserving the original feel there) while making the actual
    // force-per-second the same on any display.
    // Clamped so a dropped/backgrounded frame (a big one-off `delta`)
    // can't fling the car with a single huge impulse -- caps the
    // renormalization at 3x the 60fps baseline (i.e. as low as ~20fps)
    // instead of following an arbitrarily large delta.
    const dt60 = Math.min(delta * 60, 3);

    if (input.forward) {
        chassisApi.applyImpulse([forward.x * moveSpeed * dt60, forward.y * moveSpeed * dt60, forward.z * moveSpeed * dt60], [0, 0, 0]);
    }
    if (input.backward) {
        chassisApi.applyImpulse([-forward.x * moveSpeed * dt60, -forward.y * moveSpeed * dt60, -forward.z * moveSpeed * dt60], [0, 0, 0]);
    }

    if (input.left) {
        chassisApi.applyTorque([0, turnSpeed * 65 * dt60, 0]);
    }
    if (input.right) {
        chassisApi.applyTorque([0, -turnSpeed * 65 * dt60, 0]);
    }

    // Dampen rotation when not turning
    if (!input.left && !input.right) {
        chassisApi.angularVelocity.set(0, 0, 0);
    }

    const carPos = new THREE.Vector3();
    chassisRef.current.getWorldPosition(carPos);
    const carEuler = new THREE.Euler().setFromQuaternion(quat, 'YXZ');
    
    // Update player info so camera/minimap follow the car
    setPlayerInfo([carPos.x, carPos.y, carPos.z], carEuler.y);

    if (state.clock.getElapsedTime() % 0.1 < 0.02) {
      updateEntity(id, {
        type: 'car',
        position: [carPos.x, carPos.y, carPos.z],
        rotation: carEuler.y
      });
    }

  });

  return (
    <mesh ref={chassisRef} name={id}>
      <boxGeometry args={chassisArgs} />
      <meshStandardMaterial visible={false} />
      {/* Chassis box half-height is 0.35 (chassisArgs[1]/2); the glb's
          lowest point (the wheels) sits 0.358 below the model's own
          origin, so ~0 aligns the wheels with the box's bottom face --
          i.e. the road surface once the chassis settles on it. */}
      <primitive object={clonedScene} position={[0, 0.01, 0]} />
    </mesh>
  );
};

export default Car;
