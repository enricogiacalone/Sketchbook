import React, { useRef, useState, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useSphere } from '@react-three/cannon';
import * as THREE from 'three';

const Explosion: React.FC<{ position: [number, number, number], scale: number, onFinish: () => void }> = ({ position, scale, onFinish }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = 50;
  const [age, setAge] = useState(0);
  const lifeTime = 2.0;
  
  const particles = useMemo(() => {
    return Array.from({ length: count }, () => ({
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 40 * scale,
        (Math.random() - 0.5) * 40 * scale,
        (Math.random() - 0.5) * 40 * scale
      ),
      initialScale: (Math.random() * 1.0 + 0.5) * scale,
    }));
  }, [scale]);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Safe update: call onFinish in useEffect instead of inside setAge
  useEffect(() => {
    if (age >= lifeTime) {
      onFinish();
    }
  }, [age, onFinish, lifeTime]);

  useFrame((state, delta) => {
    setAge(prev => {
        const next = prev + delta;
        if (next >= lifeTime) return lifeTime;
        
        if (meshRef.current) {
            const progress = next / lifeTime;
            particles.forEach((p, i) => {
                const currentScale = p.initialScale * (1 - progress);
                dummy.scale.set(currentScale, currentScale, currentScale);
                dummy.position.copy(p.velocity.clone().multiplyScalar(next));
                dummy.updateMatrix();
                meshRef.current!.setMatrixAt(i, dummy.matrix);
            });
            meshRef.current.instanceMatrix.needsUpdate = true;
            (meshRef.current.material as THREE.MeshBasicMaterial).opacity = 1 - progress;
        }
        return next;
    });
  });

  return (
    <instancedMesh ref={meshRef} args={[null as any, null as any, count]} position={position}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial color="orange" transparent opacity={1} />
    </instancedMesh>
  );
};

const Meteorite: React.FC<{ id: number, initialPosition: [number, number, number], initialVelocity: [number, number, number], onExplode: (id: number, pos: [number, number, number]) => void }> = ({ id, initialPosition, initialVelocity, onExplode }) => {
  const [ref, api] = useSphere<THREE.Mesh>(() => ({
    mass: 5,
    position: initialPosition,
    velocity: initialVelocity,
    args: [0.3],
    onCollide: (e) => {
        // Use the id passed down to ensure correct identification
        onExplode(id, initialPosition); 
    }
  }));

  const currentPos = useRef<[number, number, number]>(initialPosition);
  useEffect(() => api.position.subscribe(p => currentPos.current = p), [api.position]);

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
    if (timer.current > 5) { // Spawn every 5 seconds
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
    if (explodingMeteoriteIds.current.has(id)) {
        return; 
    }
    
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
        <Meteorite 
            key={m.id} 
            id={m.id} 
            initialPosition={m.pos} 
            initialVelocity={m.vel} 
            onExplode={handleExplode} 
        />
      ))}
      {explosions.map(e => (
        <Explosion 
            key={e.id} 
            position={e.pos} 
            scale={1} 
            onFinish={() => {
                handleExplosionFinish(e.id); 
            }} 
        />
      ))}
    </group>
  );
};

export default MeteoriteSpawner;
