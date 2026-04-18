import { useRef, useMemo } from 'react';
import * as THREE from 'three';

export const useSpringVector = (mass: number, damping: number) => {
  const position = useRef(new THREE.Vector3());
  const velocity = useRef(new THREE.Vector3());
  const target = useRef(new THREE.Vector3());

  const simulate = (timeStep: number) => {
    const acceleration = new THREE.Vector3().subVectors(target.current, position.current);
    acceleration.divideScalar(mass);
    velocity.current.add(acceleration);
    velocity.current.multiplyScalar(damping);
    position.current.add(velocity.current);
  };

  return { position, velocity, target, simulate };
};
