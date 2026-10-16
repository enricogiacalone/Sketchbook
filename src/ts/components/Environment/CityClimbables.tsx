import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useStaticBoxes, type StaticBox } from './staticColliders';
import { getTerrainHeight } from './Terrain';
import { CLIMBABLE_GROUPS, registerLadder, unregisterLadder } from './traversal/traversalWorld';

// Roba da arrampicare in citta': un angolo "parkour" nella piazza del Mercato
// (lato ovest, lontano dalle bancarelle) con gli stessi pezzi del percorso
// dell'arena (ParkourCourse.tsx): gradino, muretto da scavalcare, blocco da
// salirci, muro alto da prendere a bordo e tirarsi su, piattaforma con scala a
// pioli, pietre per saltare. In piu' i cassonetti, i chioschi e le fioriere
// dei marciapiedi sono scavalcabili (StreetProps.tsx).

interface Block {
  x: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  color?: string;
}
const BLOCKS: Block[] = [
  { x: -108, z: 138, sx: 1.2, sy: 0.4, sz: 1.2 }, // gradino
  { x: -108, z: 141, sx: 1.8, sy: 1.0, sz: 0.7 }, // muretto
  { x: -108, z: 145, sx: 2, sy: 1.3, sz: 2 }, // blocco
  { x: -107, z: 151, sx: 4.5, sy: 2.7, sz: 2.4 }, // muro alto
  { x: -104, z: 159, sx: 3, sy: 3.5, sz: 3 }, // piattaforma
  { x: -110, z: 160, sx: 1, sy: 0.6, sz: 1 }, // pietre
  { x: -110, z: 162.2, sx: 1, sy: 0.9, sz: 1 },
  { x: -110, z: 164.4, sx: 1, sy: 1.2, sz: 1 },
  { x: -103, z: 166, sx: 2.2, sy: 1.1, sz: 2.2 }, // casse impilate
  { x: -103, z: 166, sx: 1.4, sy: 2.2, sz: 1.4 },
];
const LADDER = { x: -104, z: 159 + 1.5 + 0.06, halfWidth: 0.3, top: 3.5 };

const CityClimbables: React.FC = () => {
  const gy = useMemo(() => getTerrainHeight(-105, 150), []);
  const boxes = useMemo<StaticBox[]>(
    () => BLOCKS.map((b) => ({ half: [b.sx / 2, b.sy / 2, b.sz / 2], pos: [b.x, gy + b.sy / 2, b.z], groups: CLIMBABLE_GROUPS })),
    [gy]
  );
  useStaticBoxes([0, 0, 0], boxes);

  useEffect(() => {
    registerLadder({ id: 'city-ladder', x: LADDER.x, z: LADDER.z, nx: 0, nz: 1, bottomY: gy, topY: gy + LADDER.top, halfWidth: LADDER.halfWidth });
    return () => {
      unregisterLadder('city-ladder');
    };
  }, [gy]);

  const mats = useMemo(
    () => ({
      block: new THREE.MeshStandardMaterial({ color: '#8a8f98', roughness: 0.85, metalness: 0.05 }),
      edge: new THREE.MeshStandardMaterial({ color: '#f5c518', roughness: 0.5, emissive: '#3a2d00' }),
      ladder: new THREE.MeshStandardMaterial({ color: '#6b4a2b', roughness: 0.7 }),
    }),
    []
  );
  const rungs: number[] = [];
  for (let y = 0.3; y < LADDER.top; y += 0.3) rungs.push(y);

  return (
    <group>
      {BLOCKS.map((b, i) => (
        <group key={i} position={[b.x, gy, b.z]}>
          <mesh position={[0, b.sy / 2, 0]} material={mats.block} castShadow receiveShadow>
            <boxGeometry args={[b.sx, b.sy, b.sz]} />
          </mesh>
          {/* strisce gialle appena sotto i bordi: "qui ci si arrampica" */}
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
      <group position={[LADDER.x, gy, LADDER.z]}>
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

export default CityClimbables;
