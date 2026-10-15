import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useStaticBoxes, type StaticBox } from './staticColliders';
import { CollisionGroups, groupsExcluding } from '../../enums/CollisionGroups';
import { streetLampBulbMaterial } from './Road';
import { HOSPITAL, POLICE_STATION } from './streetPropsData';

// Ospedale e stazione di polizia: edifici veri a ovest, accanto ai parcheggi.
// E' qui che si ricompare dopo Wasted e Busted (UI/PlayerFate.tsx). Facciata
// con le finestre disegnate su una texture, insegna luminosa, tettoia
// d'ingresso e lampeggianti sul tetto. Non si entra (come i palazzi della
// citta', ma senza porte), le pareti sono solide.

const GROUPS = groupsExcluding(CollisionGroups.Default);
const TILE = 3.2; // m: una finestra per 3.2 m

let facadeTex: THREE.CanvasTexture | null = null;
const getFacade = () => {
  if (facadeTex) return facadeTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#7fa6c4';
  g.fillRect(24, 28, 80, 72);
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fillRect(24, 28, 80, 20);
  g.strokeStyle = '#555';
  g.lineWidth = 4;
  g.strokeRect(24, 28, 80, 72);
  g.beginPath();
  g.moveTo(64, 28);
  g.lineTo(64, 100);
  g.stroke();
  facadeTex = new THREE.CanvasTexture(c);
  facadeTex.colorSpace = THREE.SRGBColorSpace;
  facadeTex.wrapS = facadeTex.wrapT = THREE.RepeatWrapping;
  facadeTex.anisotropy = 4;
  return facadeTex;
};

// scatola le cui UV ripetono la texture ogni TILE metri
function facadeBox(w: number, h: number, d: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i));
    const ny = Math.abs(n.getY(i));
    const uw = ny > 0.5 ? w : nx > 0.5 ? d : w; // larghezza della faccia
    const uh = ny > 0.5 ? d : h;
    uv.setXY(i, (uv.getX(i) * uw) / TILE, (uv.getY(i) * uh) / TILE);
  }
  return g;
}

function signTexture(text: string, bg: string, fg: string, cross: boolean) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = fg;
  g.lineWidth = 6;
  g.strokeRect(6, 6, 500, 116);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 74px Arial, sans-serif';
  g.fillText(text, cross ? 280 : 256, 68);
  if (cross) {
    g.fillStyle = '#d32f2f';
    g.fillRect(50, 44, 80, 28);
    g.fillRect(76, 18, 28, 80);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Spec {
  b: { x: number; z: number; w: number; d: number; h: number };
  wall: string;
  roof: string;
  sign: THREE.CanvasTexture;
  lights: string;
}

const Service: React.FC<{ spec: Spec }> = ({ spec }) => {
  const { b } = spec;
  const geo = useMemo(() => facadeBox(b.w, b.h, b.d), [b]);
  const wallMat = useMemo(() => new THREE.MeshStandardMaterial({ map: getFacade(), color: spec.wall, roughness: 0.8 }), [spec.wall]);
  const roofMat = useMemo(() => new THREE.MeshStandardMaterial({ color: spec.roof, roughness: 0.9 }), [spec.roof]);
  const signMat = useMemo(() => new THREE.MeshBasicMaterial({ map: spec.sign, toneMapped: false }), [spec.sign]);
  const lightMat = useMemo(() => new THREE.MeshBasicMaterial({ color: spec.lights, toneMapped: false }), [spec.lights]);
  const boxes = useMemo<StaticBox[]>(
    () => [
      { half: [b.w / 2, b.h / 2, b.d / 2], pos: [b.x, b.h / 2, b.z], groups: GROUPS },
      // pilastri della tettoia d'ingresso
      { half: [0.2, 1.7, 0.2], pos: [b.x + b.w / 2 + 6, 1.7, b.z - 4.5], groups: GROUPS },
      { half: [0.2, 1.7, 0.2], pos: [b.x + b.w / 2 + 6, 1.7, b.z + 4.5], groups: GROUPS },
    ],
    [b]
  );
  useStaticBoxes([0, 0, 0], boxes);
  const front = b.x + b.w / 2; // facciata verso la strada (est)
  // i lampeggianti: alternano rosso/blu
  const redRef = React.useRef<THREE.MeshBasicMaterial>(null);
  const blueRef = React.useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    const on = Math.floor(performance.now() / 280) % 2 === 0;
    redRef.current?.color.set(on ? '#ff3030' : '#3a0a0a');
    blueRef.current?.color.set(on ? '#0a143a' : '#3d7bff');
    // insegna piu' accesa di sera
    signMat.color.setScalar(0.55 + 0.45 * (streetLampBulbMaterial.emissiveIntensity / 2.2));
  });
  return (
    <group>
      <mesh geometry={geo} material={wallMat} position={[b.x, b.h / 2, b.z]} castShadow receiveShadow />
      {/* cornicione e tetto */}
      <mesh position={[b.x, b.h + 0.25, b.z]} material={roofMat} castShadow>
        <boxGeometry args={[b.w + 0.8, 0.5, b.d + 0.8]} />
      </mesh>
      <mesh position={[b.x - 2, b.h + 1.1, b.z]} material={roofMat} castShadow>
        <boxGeometry args={[6, 1.2, 5]} />
      </mesh>
      {/* porta e zoccolo scuro */}
      <mesh position={[front + 0.03, 1.2, b.z]}>
        <boxGeometry args={[0.1, 2.4, 3.6]} />
        <meshStandardMaterial color="#2a3238" metalness={0.3} roughness={0.5} />
      </mesh>
      {/* tettoia d'ingresso */}
      <mesh position={[front + 3.2, 3.5, b.z]} material={roofMat} castShadow receiveShadow>
        <boxGeometry args={[6.4, 0.3, 10]} />
      </mesh>
      <mesh position={[front + 6, 1.7, b.z - 4.5]} castShadow>
        <cylinderGeometry args={[0.16, 0.16, 3.4, 8]} />
        <meshStandardMaterial color="#c9ccd1" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[front + 6, 1.7, b.z + 4.5]} castShadow>
        <cylinderGeometry args={[0.16, 0.16, 3.4, 8]} />
        <meshStandardMaterial color="#c9ccd1" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* insegna sopra l'ingresso */}
      <mesh position={[front + 0.08, 5.2, b.z]} rotation={[0, Math.PI / 2, 0]} material={signMat}>
        <planeGeometry args={[9, 2.25]} />
      </mesh>
      {/* lampeggianti */}
      <mesh position={[b.x - 3.5, b.h + 1.85, b.z - 1.2]} material={lightMat}>
        <boxGeometry args={[1.2, 0.5, 0.9]} />
      </mesh>
      <mesh position={[b.x - 3.5, b.h + 1.85, b.z + 1.2]}>
        <boxGeometry args={[1.2, 0.5, 0.9]} />
        <meshBasicMaterial ref={redRef} color="#ff3030" toneMapped={false} />
      </mesh>
      <mesh position={[b.x - 0.5, b.h + 1.85, b.z + 1.2]}>
        <boxGeometry args={[1.2, 0.5, 0.9]} />
        <meshBasicMaterial ref={blueRef} color="#3d7bff" toneMapped={false} />
      </mesh>
      {/* striscia gialla/blu sulla porta e attacco con la strada: asfalto davanti all'ingresso */}
      <mesh position={[front + 3.5, 0.04, b.z]} receiveShadow>
        <boxGeometry args={[7, 0.08, 12]} />
        <meshStandardMaterial color="#3a3d42" roughness={0.9} />
      </mesh>
    </group>
  );
};

const CityServices: React.FC = () => {
  const specs = useMemo<Spec[]>(
    () => [
      { b: HOSPITAL, wall: '#e8eef2', roof: '#9aa3ab', sign: signTexture('OSPEDALE', '#ffffff', '#c62828', true), lights: '#ffffff' },
      { b: POLICE_STATION, wall: '#6f86b8', roof: '#2a3556', sign: signTexture('POLIZIA', '#1c2c5e', '#ffffff', false), lights: '#ffffff' },
    ],
    []
  );
  return (
    <group>
      {specs.map((s, i) => (
        <Service key={i} spec={s} />
      ))}
    </group>
  );
};

export default CityServices;
