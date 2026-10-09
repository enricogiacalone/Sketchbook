import React, { useRef, useMemo } from 'react';
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
  // `age` used to be React state, updated every single frame for the whole
  // 1.5s of the animation -- that's ~90 unnecessary re-renders per
  // explosion on top of the particle math below, for a value nothing ever
  // reads outside this component's own useFrame. It's purely internal
  // per-frame animation state, so a ref (imperative, no re-render) is the
  // correct tool -- same as every other per-frame-mutated value in this
  // codebase (velocity/position refs, spring simulators, etc.).
  const age = useRef(0);
  const lifeTime = 1.5;
  const finished = useRef(false);

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

  useFrame((state, delta) => {
    if (finished.current) return;

    const next = Math.min(age.current + delta, lifeTime);
    age.current = next;

    if (meshRef.current) {
      const progress = next / lifeTime;
      // Every meteorite explosion used to allocate 50 new THREE.Vector3
      // (`p.velocity.clone()`) on EVERY FRAME of this 1.5s animation --
      // ~4500 short-lived objects per explosion, repeating every few
      // seconds as meteorites land. That's exactly the kind of allocation
      // burst that triggers a GC pause you feel as a stutter. `dummy` is
      // already a persistent, reused THREE.Object3D (see the useMemo
      // above) -- reusing its own `.position` here instead of cloning
      // avoids the allocation entirely.
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const currentScale = p.initialScale * (1 - progress);
        dummy.scale.set(currentScale, currentScale, currentScale);
        dummy.position.copy(p.velocity).multiplyScalar(next);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
      }
      meshRef.current.instanceMatrix.needsUpdate = true;
      (meshRef.current.material as THREE.MeshBasicMaterial).opacity = 1 - progress;
    }

    if (next >= lifeTime) {
      finished.current = true;
      onFinish();
    }
  });

  return (
    <instancedMesh ref={meshRef} args={[null as any, null as any, count]} position={position}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial color={color} transparent opacity={1} />
    </instancedMesh>
  );
};

export default Explosion;
