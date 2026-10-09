import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { getTerrainHeight } from './Terrain';
import { getRoadOffset } from './Road';
import type { FighterData } from './SquadArenaTypes';

// "ogni nemico ha la vita sopra di lui" -- barra della vita che segue il
// nemico (sopra la testa, sempre rivolta alla camera): verde -> giallo ->
// rosso man mano che scende, sparisce poco dopo la morte.
const W = 0.8, H = 0.08, ABOVE_M = 2.15, FADE_AFTER_DEATH_S = 1.2;
const _c = new THREE.Color();

const EnemyHealthBar: React.FC<{ data: FighterData; maxHp: number }> = ({ data, maxHp }) => {
  const group = useRef<THREE.Group>(null);
  const fill = useRef<THREE.Mesh>(null);
  const deadFor = useRef(0);
  const mats = useMemo(
    () => ({
      bg: new THREE.MeshBasicMaterial({ color: '#111', toneMapped: false }),
      fg: new THREE.MeshBasicMaterial({ color: '#22c55e', toneMapped: false }),
    }),
    []
  );
  useFrame((_s, delta) => {
    const g = group.current, f = fill.current;
    if (!g || !f) return;
    const p = data.position;
    const ground = getTerrainHeight(p.x, p.z) + getRoadOffset(p.x, p.z);
    g.position.set(p.x, ground + p.y + ABOVE_M, p.z);
    deadFor.current = data.isDead ? deadFor.current + delta : 0;
    g.visible = deadFor.current < FADE_AFTER_DEATH_S;
    const k = THREE.MathUtils.clamp(data.hp / maxHp, 0, 1);
    f.scale.x = Math.max(1e-3, k);
    f.position.x = -(W * (1 - k)) / 2; // si accorcia da destra
    _c.setHSL(0.33 * k, 0.8, 0.5); // 0.33 verde -> 0 rosso
    (f.material as THREE.MeshBasicMaterial).color.copy(_c);
  });
  return (
    <group ref={group}>
      <Billboard>
        <mesh material={mats.bg} renderOrder={10}>
          <planeGeometry args={[W + 0.04, H + 0.04]} />
        </mesh>
        <mesh ref={fill} material={mats.fg} position={[0, 0, 0.001]} renderOrder={11}>
          <planeGeometry args={[W, H]} />
        </mesh>
      </Billboard>
    </group>
  );
};

export default EnemyHealthBar;
