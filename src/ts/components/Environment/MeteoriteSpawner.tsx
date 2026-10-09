import React, { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, BallCollider, RapierRigidBody } from '@react-three/rapier';
import Explosion from './Explosion';
import { useStore } from '../../store';
import { explodeAt } from '../../lib/explosions';

const Meteorite: React.FC<{ id: number, initialPosition: [number, number, number], initialVelocity: [number, number, number], onExplode: (id: number, pos: [number, number, number]) => void }> = ({ id, initialPosition, initialVelocity, onExplode }) => {
  const position = useRef(initialPosition);
  const ref = useRef<RapierRigidBody>(null);

  const age = useRef(0);
  useFrame((_state, delta) => {
    const body = ref.current;
    if (body) {
      const t = body.translation();
      position.current = [t.x, t.y, t.z];
    }
    age.current += delta;
    if (age.current > 10) onExplode(id, position.current);
  });

  return (
    <RigidBody
      ref={ref}
      type="dynamic"
      colliders={false}
      position={initialPosition}
      linearVelocity={initialVelocity}
    >
      <BallCollider
        args={[0.3]}
        mass={5}
        onCollisionEnter={() => onExplode(id, position.current)}
      />
      <mesh castShadow>
        <sphereGeometry args={[0.3, 8, 8]} />
        <meshStandardMaterial color="#ccc" />
      </mesh>
    </RigidBody>
  );
};

const MeteoriteSpawner: React.FC = () => {
  const [meteorites, setMeteorites] = useState<{ id: number, pos: [number, number, number], vel: [number, number, number] }[]>([]);
  const [explosions, setExplosions] = useState<{ id: number, pos: [number, number, number], scale: number }[]>([]);
  const idCounter = useRef(0);
  const timer = useRef(0);
  const explodingMeteoriteIds = useRef<Set<number>>(new Set());

  useFrame((_state, delta) => {
    const st = useStore.getState();
    if (!st.meteoritesEnabled) return;
    timer.current += delta;
    if (timer.current >= st.meteoriteFrequency) { 
        const isDuel = st.testScene === 'duel';
        const spread = isDuel ? 48 : 200;
        const x = (Math.random() - 0.5) * spread;
        const z = (Math.random() - 0.5) * spread;
        const y = 50;
        setMeteorites(prev => [...prev, { 
            id: idCounter.current++, 
            pos: [x, y, z], 
            vel: [(Math.random() - 0.5) * (isDuel ? 3 : 10), -20, (Math.random() - 0.5) * (isDuel ? 3 : 10)] 
        }]);
        timer.current = 0;
    }
  });

  const handleExplode = (id: number, pos: [number, number, number]) => {
    if (explodingMeteoriteIds.current.has(id)) return;
    explodingMeteoriteIds.current.add(id);
    setMeteorites(prev => prev.filter(met => met.id !== id));

    const state = useStore.getState();
    const scale = state.explosionIntensity;
    const blastRadius = state.explosionRadius;
    setExplosions(prev => [...prev, { id: id, pos, scale }]);

    // danno, KO/morte e spinta per tutti (giocatore, nemici, passanti) e
    // per gli oggetti: lib/explosions.ts
    explodeAt(pos, { radius: blastRadius, power: scale, damage: 50, source: 'meteorite' });

    // Play explosion sound
    try {
      const audio = new Audio('/drone-sounds/explosion1.ogg');
      audio.volume = Math.min(1.0, 0.6 * scale);
      audio.play().catch(() => {});
    } catch {}
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
        <Explosion key={e.id} position={e.pos} scale={e.scale} onFinish={() => handleExplosionFinish(e.id)} />
      ))}
    </group>
  );
};

export default MeteoriteSpawner;
