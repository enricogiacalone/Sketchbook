import React, { useRef, useState, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface ExplosionProps {
  position: [number, number, number];
  scale?: number;
  color?: string;
  onFinish: () => void;
}

const Explosion: React.FC<ExplosionProps> = ({ position, scale = 1, color = "orange", onFinish }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = 50;
  const [age, setAge] = useState(0);
  const lifeTime = 1.5; 
  const finished = useRef(false); // Ref to prevent multiple onFinish calls
  
  const particles = useMemo(() => {
    return Array.from({ length: count }, () => ({
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 20 * scale,
        (Math.random() - 0.5) * 20 * scale,
        (Math.random() - 0.5) * 20 * scale
      ),
      initialScale: (Math.random() * 0.5 + 0.2) * scale,
    }));
  }, [scale]);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (age >= lifeTime && !finished.current) {
      finished.current = true;
      onFinish();
    }
  }, [age, onFinish, lifeTime]);

  useFrame((state, delta) => {
    if (finished.current) return;

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
      <meshBasicMaterial color={color} transparent opacity={1} />
    </instancedMesh>
  );
};

export default Explosion;
