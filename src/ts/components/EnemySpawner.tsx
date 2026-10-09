import React, { useState, useEffect, useCallback } from 'react';
import Enemy from './Enemy';

const EnemySpawner: React.FC = () => {
  const [enemies, setEnemies] = useState<{ id: string, position: [number, number, number] }[]>([]);
  // These aren't converted pedestrians (see Environment/CityDetails.tsx's
  // own pedestrian<->Enemy handling for that case) -- just standalone
  // random spawns, so there's no "ordinary self" to revert to once one
  // gives up the chase. Simplest consistent behavior: it despawns.
  const handleGiveUp = useCallback((id: string) => {
    setEnemies((prev) => prev.filter((e) => e.id !== id));
  }, []);

  useEffect(() => {
    // Initial spawn
    const initialEnemies = Array.from({ length: 5 }, (_, i) => ({
      id: `enemy-${i}`,
      position: [
        (Math.random() - 0.5) * 50,
        15,
        (Math.random() - 0.5) * 50
      ] as [number, number, number]
    }));
    setEnemies(initialEnemies);
  }, []);

  return (
    <group>
      {enemies.map((enemy) => (
        <Enemy key={enemy.id} id={enemy.id} initialPosition={enemy.position} onGiveUp={handleGiveUp} />
      ))}
    </group>
  );
};

export default EnemySpawner;
