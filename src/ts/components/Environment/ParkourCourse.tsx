import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { RigidBody, CuboidCollider } from '@react-three/rapier';
import { AUDIO_ARENA_FLOOR_Y } from './audioArena/AudioArena';
import { CLIMBABLE_GROUPS, STAIR_RAMP_GROUPS, registerLadder, unregisterLadder } from './traversal/traversalWorld';

// "procedi, voglio anche il salto normale" -- percorso di prova per il
// movimento da avventura (traversal/traversal.ts), nell'angolo dell'arena
// lontano da ostacoli, sacco e casse. Ogni pezzo prova una cosa:
//   gradino 0.4 m      -> salto sopra
//   muretto 1.0 m      -> scavalca (sottile: ci si sale e si riscende)
//   blocco 1.3 m       -> sali sopra
//   muro 2.7 m (4 m)   -> salta, aggrappati, spostati appeso, tirati su
//   piattaforma 3.5 m  -> scala a pioli davanti, rampa di scale sul lato
//                         ovest (come le scale dei palazzi del playground)
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

// Scale "come quelle degli edifici del playground" (City.tsx): gradini
// indaco a sbalzo, uno per ogni tratto della rampa, e sotto una rampa
// invisibile che e' quello su cui si cammina davvero (li' e' la funzione
// d'altezza getBuildingHeightOffset, qui una rampa di collisione che
// supportHeight segue). Salgono verso +x fino alla cima della piattaforma
// alta (faccia ovest, x = -11.5).
const STAIRS = { x0: -14.5, x1: -11.5, z: -16, width: 2.0, rise: 3.5, steps: 12 };
const STAIR_RUN = STAIRS.x1 - STAIRS.x0;
const STAIR_ANGLE = Math.atan2(STAIRS.rise, STAIR_RUN);
const STAIR_LEN = Math.hypot(STAIRS.rise, STAIR_RUN);
const RAMP_T = 0.3; // spessore della rampa di collisione

const ParkourCourse: React.FC = () => {
  const mats = useMemo(
    () => ({
      block: new THREE.MeshStandardMaterial({ color: '#8a8f98', roughness: 0.85, metalness: 0.05 }),
      edge: new THREE.MeshStandardMaterial({ color: '#f5c518', roughness: 0.5, emissive: '#3a2d00' }),
      ladder: new THREE.MeshStandardMaterial({ color: '#6b4a2b', roughness: 0.7 }),
      // stesso colore dei gradini dei palazzi del playground (City.tsx)
      stair: new THREE.MeshStandardMaterial({ color: '#4f46e5', roughness: 0.7, metalness: 0.1 }),
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
        {/* rampa delle scale: la faccia superiore passa da (x0, base) a (x1, base+rise) */}
        <CuboidCollider
          args={[STAIR_LEN / 2, RAMP_T / 2, STAIRS.width / 2]}
          position={[
            (STAIRS.x0 + STAIRS.x1) / 2 + Math.sin(STAIR_ANGLE) * (RAMP_T / 2),
            BASE + STAIRS.rise / 2 - Math.cos(STAIR_ANGLE) * (RAMP_T / 2),
            STAIRS.z,
          ]}
          rotation={[0, 0, STAIR_ANGLE]}
          collisionGroups={STAIR_RAMP_GROUPS}
        />
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
      {/* gradini (la cima di ognuno sta sulla rampa, al suo centro) */}
      {Array.from({ length: STAIRS.steps }, (_, i) => {
        const t = (i + 0.5) / STAIRS.steps;
        const stepRun = (STAIR_RUN / STAIRS.steps) * 1.1;
        const stepRise = STAIRS.rise / STAIRS.steps;
        return (
          <mesh
            key={`st${i}`}
            position={[STAIRS.x0 + t * STAIR_RUN, BASE + t * STAIRS.rise - stepRise / 2, STAIRS.z]}
            material={mats.stair}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[stepRun, stepRise, STAIRS.width]} />
          </mesh>
        );
      })}
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
