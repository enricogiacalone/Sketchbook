import { useRef, useMemo } from 'react';
import * as THREE from 'three';

// Scratch vector reused across every call/instance instead of allocating a
// fresh THREE.Vector3 every call -- this runs once per frame per Enemy.
const _springAccel = new THREE.Vector3();

export const useSpringVector = (mass: number, damping: number) => {
  const position = useRef(new THREE.Vector3());
  const velocity = useRef(new THREE.Vector3());
  const target = useRef(new THREE.Vector3());

  const simulate = (timeStep: number) => {
    _springAccel.subVectors(target.current, position.current);
    _springAccel.divideScalar(mass);
    velocity.current.add(_springAccel);
    velocity.current.multiplyScalar(damping);
    position.current.add(velocity.current);
  };

  return { position, velocity, target, simulate };
};
