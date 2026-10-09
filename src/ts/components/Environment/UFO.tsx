import React, { useRef, useState, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const Laser: React.FC<{ start: THREE.Vector3, end: THREE.Vector3, onFinish: () => void }> = ({ start, end, onFinish }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  // Was React state updated every frame (setAge), forcing a re-render for
  // the whole 0.5s lifetime of every laser -- a plain ref is all this needs
  // since nothing else reads `age` reactively.
  const age = useRef(0);
  const [isFinished, setIsFinished] = useState(false);
  const lifeTime = 0.5;

  const { distance, quaternion } = useMemo(() => {
    const dir = new THREE.Vector3().subVectors(end, start);
    const dist = dir.length();
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.clone().normalize()
    );
    return { distance: dist, quaternion: quat };
  }, [start, end]);

  useEffect(() => {
    if (isFinished) {
      onFinish();
    }
  }, [isFinished, onFinish]);

  useFrame((state, delta) => {
    if (isFinished) return;

    const next = age.current + delta;
    age.current = next;
    if (next >= lifeTime) {
      setIsFinished(true);
      return;
    }
    if (meshRef.current) {
      (meshRef.current.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - next / lifeTime);
    }
  });

  return (
    <mesh 
        ref={meshRef} 
        position={start} 
        quaternion={quaternion}
    >
        <cylinderGeometry args={[0.2, 0.2, distance, 8]} />
        <meshBasicMaterial color="red" transparent opacity={0.8} />
    </mesh>
  );
};

const _ufoDirection = new THREE.Vector3();

const UFO: React.FC<{ initialPosition: [number, number, number] }> = ({ initialPosition }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const [target, setTarget] = useState(new THREE.Vector3(
    (Math.random() - 0.5) * 1000,
    100 + Math.random() * 100,
    (Math.random() - 0.5) * 1000
  ));
  const [lasers, setLasers] = useState<{ id: number, start: THREE.Vector3, end: THREE.Vector3 }[]>([]);
  const laserIdCounter = useRef(0);
  const laserTimer = useRef(0);
  const speed = 10;

  useFrame((state, delta) => {
    if (!meshRef.current) return;

    const currentPos = meshRef.current.position;
    const distanceToTarget = currentPos.distanceTo(target);

    if (distanceToTarget < 10) {
      setTarget(new THREE.Vector3(
        (Math.random() - 0.5) * 1000,
        100 + Math.random() * 100,
        (Math.random() - 0.5) * 1000
      ));
    }

    _ufoDirection.subVectors(target, currentPos).normalize();
    currentPos.add(_ufoDirection.multiplyScalar(speed * delta));
    meshRef.current.rotation.y += delta * 2;

    laserTimer.current += delta;
    if (laserTimer.current > 3) {
        const start = currentPos.clone();
        const end = new THREE.Vector3((Math.random() - 0.5) * 500, 0, (Math.random() - 0.5) * 500);
        setLasers(prev => [...prev, { id: laserIdCounter.current++, start, end }]);
        laserTimer.current = 0;
    }
  });

  return (
    <group>
      <mesh ref={meshRef} position={initialPosition} castShadow receiveShadow>
        <cylinderGeometry args={[5, 5, 1, 32]} />
        <meshStandardMaterial color="#888" metalness={0.8} roughness={0.2} />
      </mesh>
      {lasers.map(l => (
        <Laser 
            key={l.id} 
            start={l.start} 
            end={l.end} 
            onFinish={() => setLasers(prev => prev.filter(laser => laser.id !== l.id))} 
        />
      ))}
    </group>
  );
};

export default UFO;
