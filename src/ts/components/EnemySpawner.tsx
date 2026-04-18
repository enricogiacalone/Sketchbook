import React, { useState, useEffect } from 'react';
import Enemy from './Enemy';

const EnemySpawner: React.FC = () => {
  const [enemies, setEnemies] = useState<{ id: string, position: [number, number, number] }[]>([]);

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
        <Enemy key={enemy.id} id={enemy.id} initialPosition={enemy.position} />
      ))}
    </group>
  );
};

export default EnemySpawner;
