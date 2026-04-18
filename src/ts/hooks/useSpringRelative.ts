import { useRef } from 'react';
import * as THREE from 'three';

export const useSpringRelative = (mass: number, damping: number) => {
  const position = useRef(0);
  const velocity = useRef(0);
  const target = useRef(0);

  const simulate = (timeStep: number) => {
    let acceleration = target.current - position.current;
    acceleration /= mass;
    velocity.current += acceleration;
    velocity.current *= damping;
    position.current += velocity.current;
  };

  return { position, velocity, target, simulate };
};
