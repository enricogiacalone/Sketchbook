import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { RigidBody, CuboidCollider } from '@react-three/rapier';
import { AUDIO_ARENA_FLOOR_Y } from './audioArena/AudioArena';
import { CLIMBABLE_GROUPS, registerLadder, unregisterLadder } from './traversal/traversalWorld';

// "procedi, voglio anche il salto normale" -- percorso di prova per il
// movimento da avventura (traversal/traversal.ts), nell'angolo dell'arena
// lontano da ostacoli, sacco e casse. Ogni pezzo prova una cosa:
//   gradino 0.4 m      -> salto sopra
//   muretto 1.0 m      -> scavalca (sottile: ci si sale e si riscende)
//   blocco 1.3 m       -> sali sopra
//   muro 2.7 m (4 m)   -> salta, aggrappati, spostati appeso, tirati su
//   piattaforma 3.5 m  -> scala a pioli
//   pietre 0.6 / 0.9 m -> salti da un blocco all'altro
// Bordi arrampicabili segnati in giallo (convenzione dei giochi d'avventura).
const BASE = AUDIO_ARENA_FLOOR_Y;

interface Block {
  x: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
}
const BLOCKS: Block[] = [
  { x: -6, z: -10, sx: 1.2, sy: 0.4, sz: 1.2 },
  { x: -8.2, z: -10, sx: 1.6, sy: 1.0, sz: 0.8 },
  { x: -11, z: -10.5, sx: 2, sy: 1.3, sz: 2 },
  { x: -15, z: -11, sx: 4, sy: 2.7, sz: 3 },
  { x: -10, z: -16, sx: 3, sy: 3.5, sz: 3 },
  { x: -6.5, z: -13.5, sx: 1, sy: 0.6, sz: 1 },
  { x: -6.5, z: -15.5, sx: 1, sy: 0.9, sz: 1 },
];
// scala sulla faccia +z della piattaforma alta
const LADDER = { x: -10, z: -16 + 1.5 + 0.06, halfWidth: 0.3, top: 3.5 };

const ParkourCourse: React.FC = () => {
  const mats = useMemo(
    () => ({
      block: new THREE.MeshStandardMaterial({ color: '#8a8f98', roughness: 0.85, metalness: 0.05 }),
      edge: new THREE.MeshStandardMaterial({ color: '#f5c518', roughness: 0.5, emissive: '#3a2d00' }),
      ladder: new THREE.MeshStandardMaterial({ color: '#6b4a2b', roughness: 0.7 }),
    }),
    []
  );

  useEffect(() => {
    registerLadder({
      id: 'parkour-ladder',
      x: LADDER.x,
      z: LADDER.z,
      nx: 0,
      nz: 1,
      bottomY: BASE,
      topY: BASE + LADDER.top,
      halfWidth: LADDER.halfWidth,
    });
    return () => {
      unregisterLadder('parkour-ladder');
    };
  }, []);

  const rungs: number[] = [];
  for (let y = 0.3; y < LADDER.top; y += 0.3) rungs.push(y);

  return (
    <group>
      <RigidBody type="fixed" colliders={false}>
        {BLOCKS.map((b, i) => (
          <CuboidCollider
            key={i}
            args={[b.sx / 2, b.sy / 2, b.sz / 2]}
            position={[b.x, BASE + b.sy / 2, b.z]}
            collisionGroups={CLIMBABLE_GROUPS}
          />
        ))}
      </RigidBody>
      {BLOCKS.map((b, i) => (
        <group key={i} position={[b.x, BASE, b.z]}>
          <mesh position={[0, b.sy / 2, 0]} material={mats.block} castShadow receiveShadow>
            <boxGeometry args={[b.sx, b.sy, b.sz]} />
          </mesh>
          {/* strisce gialle appena sotto i bordi */}
          <mesh position={[0, b.sy - 0.04, b.sz / 2 + 0.006]} material={mats.edge}>
            <boxGeometry args={[b.sx, 0.08, 0.012]} />
          </mesh>
          <mesh position={[0, b.sy - 0.04, -b.sz / 2 - 0.006]} material={mats.edge}>
            <boxGeometry args={[b.sx, 0.08, 0.012]} />
          </mesh>
          <mesh position={[b.sx / 2 + 0.006, b.sy - 0.04, 0]} material={mats.edge}>
            <boxGeometry args={[0.012, 0.08, b.sz]} />
          </mesh>
          <mesh position={[-b.sx / 2 - 0.006, b.sy - 0.04, 0]} material={mats.edge}>
            <boxGeometry args={[0.012, 0.08, b.sz]} />
          </mesh>
        </group>
      ))}
      {/* scala a pioli */}
      <group position={[LADDER.x, BASE, LADDER.z]}>
        {[-LADDER.halfWidth, LADDER.halfWidth].map((x) => (
          <mesh key={x} position={[x, LADDER.top / 2 + 0.3, 0]} material={mats.ladder} castShadow>
            <boxGeometry args={[0.06, LADDER.top + 0.6, 0.06]} />
          </mesh>
        ))}
        {rungs.map((y) => (
          <mesh key={y} position={[0, y, 0]} rotation={[0, 0, Math.PI / 2]} material={mats.ladder} castShadow>
            <cylinderGeometry args={[0.022, 0.022, LADDER.halfWidth * 2, 8]} />
          </mesh>
        ))}
      </group>
    </group>
  );
};

export default ParkourCourse;
