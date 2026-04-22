import React, { useRef, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useSphere } from '@react-three/cannon';
import * as THREE from 'three';
import Explosion from './Explosion';

const Meteorite: React.FC<{ id: number, initialPosition: [number, number, number], initialVelocity: [number, number, number], onExplode: (id: number, pos: [number, number, number]) => void }> = ({ id, initialPosition, initialVelocity, onExplode }) => {
  const [ref, api] = useSphere<THREE.Mesh>(() => ({
    mass: 5,
    position: initialPosition,
    velocity: initialVelocity,
    args: [0.3],
    onCollide: (e) => {
        onExplode(id, initialPosition); 
    }
  }));

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.3, 8, 8]} />
      <meshStandardMaterial color="#ccc" />
    </mesh>
  );
};

const MeteoriteSpawner: React.FC = () => {
  const [meteorites, setMeteorites] = useState<{ id: number, pos: [number, number, number], vel: [number, number, number] }[]>([]);
  const [explosions, setExplosions] = useState<{ id: number, pos: [number, number, number] }[]>([]);
  const idCounter = useRef(0);
  const timer = useRef(0);
  const explodingMeteoriteIds = useRef<Set<number>>(new Set());


  useFrame((state, delta) => {
    timer.current += delta;
    if (timer.current > 5) { 
        const x = (Math.random() - 0.5) * 200;
        const z = (Math.random() - 0.5) * 200;
        const y = 50;
        setMeteorites(prev => [...prev, { 
            id: idCounter.current++, 
            pos: [x, y, z], 
            vel: [(Math.random() - 0.5) * 10, -20, (Math.random() - 0.5) * 10] 
        }]);
        timer.current = 0;
    }
  });

  const handleExplode = (id: number, pos: [number, number, number]) => {
    if (explodingMeteoriteIds.current.has(id)) return;
    explodingMeteoriteIds.current.add(id);
    setMeteorites(prev => prev.filter(met => met.id !== id));
    setExplosions(prev => [...prev, { id: id, pos }]);
  };

  const handleExplosionFinish = (id: number) => {
    setExplosions(prev => prev.filter(exp => exp.id !== id));
    explodingMeteoriteIds.current.delete(id);
  };


  return (
    <group>
      {meteorites.map(m => (
        <Meteorite key={m.id} id={m.id} initialPosition={m.pos} initialVelocity={m.vel} onExplode={handleExplode} />
      ))}
      {explosions.map(e => (
        <Explosion key={e.id} position={e.pos} onFinish={() => handleExplosionFinish(e.id)} />
      ))}
    </group>
  );
};

export default MeteoriteSpawner;
