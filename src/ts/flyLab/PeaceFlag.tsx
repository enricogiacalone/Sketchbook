import React, { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SimpleClothCPU } from '../lib/simpleCloth/SimpleClothCPU';

// Bandiera della pace su un'asta, dietro le mosche: stoffa simulata con
// SimpleClothCPU (porting dell'algoritmo di three-simplecloth). Sette
// strisce dal viola al rosso con la scritta PACE, mossa dal vento a raffiche.
const W = 3.2, H = 2.1; // metri
const NX = 32, NY = 21; // suddivisioni della stoffa
const POLE_H = 6.2;

function peaceTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 672;
  const g = c.getContext('2d')!;
  const stripes = ['#6b3fa0', '#1f4fb5', '#3fa9e0', '#2e9e48', '#f7d417', '#f28a1c', '#d8262c'];
  const h = c.height / stripes.length;
  stripes.forEach((col, i) => {
    g.fillStyle = col;
    g.fillRect(0, Math.floor(i * h), c.width, Math.ceil(h) + 1);
  });
  g.fillStyle = '#ffffff';
  g.font = 'bold 190px "Helvetica Neue", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.25)';
  g.shadowBlur = 8;
  g.fillText('PACE', c.width / 2, c.height / 2 + 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const PeaceFlag: React.FC<{ position: [number, number, number] }> = ({ position }) => {
  const [px, , pz] = position;
  const { cloth, geometry, texture } = useMemo(() => {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const top = POLE_H - 0.15;
    for (let y = 0; y <= NY; y++)
      for (let x = 0; x <= NX; x++) {
        pos.push(px + (x / NX) * W, top - (y / NY) * H, pz);
        uv.push(x / NX, 1 - y / NY);
      }
    for (let y = 0; y < NY; y++)
      for (let x = 0; x < NX; x++) {
        const a = y * (NX + 1) + x, b = a + 1, c = a + NX + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    // il lato attaccato all'asta resta fermo
    const cloth = new SimpleClothCPU(pos, idx, (i) => i % (NX + 1) === 0, {
      stiffness: 1,
      dampening: 0.96,
      stepsPerSecond: 720,
      wind: [8, 0, 2.5],
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(idx);
    geometry.computeVertexNormals();
    return { cloth, geometry, texture: peaceTexture() };
  }, [px, pz]);

  useEffect(() => () => {
    geometry.dispose();
    texture.dispose();
  }, [geometry, texture]);

  useFrame(({ clock }, delta) => {
    // raffiche: il vento cambia forza e un po' direzione nel tempo
    const t = clock.elapsedTime;
    const gust = 0.75 + 0.35 * Math.sin(t * 0.6) + 0.15 * Math.sin(t * 2.1 + 1.3);
    cloth.cfg.wind[0] = 8 * gust;
    cloth.cfg.wind[2] = 2.5 * Math.sin(t * 0.37);
    cloth.update(delta);
    const attr = geometry.getAttribute('position') as THREE.BufferAttribute;
    (attr.array as Float32Array).set(cloth.pos);
    attr.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  });

  return (
    <group>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial map={texture} side={THREE.DoubleSide} roughness={0.85} />
      </mesh>
      <mesh position={[px - 0.03, POLE_H / 2, pz]} castShadow>
        <cylinderGeometry args={[0.045, 0.055, POLE_H, 16]} />
        <meshStandardMaterial color="#c9ccd4" metalness={0.8} roughness={0.35} />
      </mesh>
      <mesh position={[px - 0.03, POLE_H + 0.08, pz]}>
        <sphereGeometry args={[0.1, 16, 12]} />
        <meshStandardMaterial color="#e5c05a" metalness={0.9} roughness={0.25} />
      </mesh>
    </group>
  );
};

export default PeaceFlag;
