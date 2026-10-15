import React, { useMemo } from 'react';
import * as THREE from 'three';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import Car from '../Vehicles/Car';
import { getRoadOffset } from './Road';
import { getTerrainHeight } from './Terrain';
import { StaticInstances, type InstanceXform } from './StaticInstances';
import { worldRng } from '../../lib/worldSeed';

// Parcheggi: le auto ferme della citta' stanno qui, non piu' sparse lungo i
// marciapiedi. Tre piazzali sui blocchi vuoti oltre il bordo ovest della
// citta' (x da -180 a -120: la griglia dei palazzi arriva fino a -120), ognuno
// con un raccordo asfaltato alla strada a x = -120. Due file da 8 posti, con
// le auto di muso verso il bordo e la coda sul corsello centrale; i posti sono
// segnati con le strisce e molti sono occupati.

const LOT_X = -150; // centro dei piazzali (blocco vuoto a ovest)
const LOT_Z = [-90, 30, 150]; // blocchi liberi
const HALF_X = 10.5;
const HALF_Z = 12.5;
const ROW_X = 5.9; // centro delle auto in ogni fila
const BAYS = 8;
const PITCH = 3;
const ROAD_EDGE_X = -124; // dove finisce la carreggiata della strada a x=-120
const SURF_Y = 0.15; // la quota delle strade (ROAD_Y_OFFSET)
const OCCUPANCY = 0.72;

const asphaltMat = new THREE.MeshStandardMaterial({ color: '#2b2d31', roughness: 0.9 });
const stripeMat = new THREE.MeshStandardMaterial({ color: '#e8e8e8', roughness: 0.8 });
const stripeGeo = new THREE.PlaneGeometry(5.2, 0.12).rotateX(-Math.PI / 2);
const signPoleMat = new THREE.MeshStandardMaterial({ color: '#666', metalness: 0.5, roughness: 0.5 });

// insegna "P" blu (una sola texture per tutti)
let signTex: THREE.CanvasTexture | null = null;
const getSignTexture = () => {
  if (signTex) return signTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1565c0';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#fff';
  g.lineWidth = 6;
  g.strokeRect(5, 5, 118, 118);
  g.fillStyle = '#fff';
  g.font = 'bold 92px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('P', 64, 70);
  signTex = new THREE.CanvasTexture(c);
  signTex.colorSpace = THREE.SRGBColorSpace;
  return signTex;
};

interface ParkedCar {
  id: string;
  x: number;
  z: number;
  yaw: number;
}

const ParkingLots: React.FC = () => {
  const { cars, stripes } = useMemo(() => {
    const rnd = worldRng('parking-lots');
    const cars: ParkedCar[] = [];
    const stripes: InstanceXform[] = [];
    let n = 0;
    // le sei auto "con nome" (prima in mezzo alle strade, vicino al punto di partenza)
    // occupano sempre i primi posti: car-1 ... car-6
    const NAMED = ['car-1', 'car-2', 'car-3', 'car-4', 'car-5', 'car-6'];
    let named = 0;
    for (const lz of LOT_Z) {
      for (const side of [-1, 1]) {
        const rx = LOT_X + side * ROW_X;
        // strisce tra i posti (e ai due capi)
        for (let k = 0; k <= BAYS; k++) stripes.push({ x: rx, y: SURF_Y + 0.012, z: lz + (k - BAYS / 2) * PITCH });
        for (let k = 0; k < BAYS; k++) {
          const isNamed = named < NAMED.length;
          if (!isNamed && rnd() > OCCUPANCY) continue;
          cars.push({
            id: isNamed ? NAMED[named++] : `city-car-${n++}`,
            x: rx + (rnd() - 0.5) * 0.3,
            z: lz + (k - (BAYS - 1) / 2) * PITCH + (rnd() - 0.5) * 0.25,
            // di muso verso il bordo del piazzale, coda sul corsello
            yaw: side < 0 ? -Math.PI / 2 : Math.PI / 2,
          });
        }
      }
    }
    return { cars, stripes };
  }, []);

  // il raccordo va dal bordo del piazzale (x=-139.5) alla carreggiata (x=-124)
  const apronW = ROAD_EDGE_X - (LOT_X + HALF_X);

  return (
    <group>
      {LOT_Z.map((lz) => (
        <group key={lz}>
          {/* asfalto del piazzale e raccordo con la strada: solido, alla quota delle strade */}
          <mesh position={[LOT_X, SURF_Y / 2, lz]} material={asphaltMat} receiveShadow>
            <boxGeometry args={[HALF_X * 2, SURF_Y, HALF_Z * 2]} />
          </mesh>
          <mesh position={[LOT_X + HALF_X + apronW / 2, SURF_Y / 2, lz]} material={asphaltMat} receiveShadow>
            <boxGeometry args={[apronW + 0.2, SURF_Y, 8]} />
          </mesh>
          <RigidBody type="fixed" colliders={false}>
            <CuboidCollider args={[HALF_X, SURF_Y / 2, HALF_Z]} position={[LOT_X, SURF_Y / 2, lz]} />
            <CuboidCollider args={[apronW / 2 + 0.1, SURF_Y / 2, 4]} position={[LOT_X + HALF_X + apronW / 2, SURF_Y / 2, lz]} />
          </RigidBody>
          {/* insegna P all'ingresso */}
          <mesh position={[ROAD_EDGE_X - 1.2, 1.4, lz + 5]} material={signPoleMat} castShadow>
            <cylinderGeometry args={[0.05, 0.05, 2.8, 8]} />
          </mesh>
          <mesh position={[ROAD_EDGE_X - 1.2, 2.9, lz + 5]} rotation={[0, Math.PI / 2, 0]}>
            <planeGeometry args={[0.9, 0.9]} />
            <meshBasicMaterial map={getSignTexture()} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
      <StaticInstances name="parking-stripes" geometry={stripeGeo} material={stripeMat} items={stripes} receiveShadow />
      {cars.map((c) => (
        <Car
          key={c.id}
          id={c.id}
          position={[c.x, getTerrainHeight(c.x, c.z) + getRoadOffset(c.x, c.z) + SURF_Y + 1.5, c.z]}
          rotation={[0, c.yaw, 0]}
        />
      ))}
    </group>
  );
};

export default ParkingLots;
