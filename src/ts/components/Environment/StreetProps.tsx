import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { StaticInstances, type InstanceXform } from './StaticInstances';
import { useStaticBoxes, type StaticBox } from './staticColliders';
import { CollisionGroups, groupsExcluding } from '../../enums/CollisionGroups';
import { streetLampBulbMaterial } from './Road';
import { getMarkings, getStreetProps, type GeoKey, type MatKey } from './streetPropsData';

// Disegno dell'arredo urbano (dati in streetPropsData.ts): ogni tipo di pezzo
// (box, cilindro, sfera, piano) per materiale e' un'unica draw call per zona.
// I pannelli con scritte (cartelli, manifesti) usano due atlanti disegnati su
// canvas, una volta sola.

const GEO: Record<GeoKey, THREE.BufferGeometry> = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  sph: new THREE.SphereGeometry(0.5, 10, 8),
  plane: new THREE.PlaneGeometry(1, 1),
};
const MAT: Record<MatKey, THREE.Material> = {
  paint: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75 }),
  metal: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4, metalness: 0.6 }),
  glass: new THREE.MeshStandardMaterial({ color: '#9ec9d8', roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
  // insegne e schermi: si accendono di notte (vedi sotto)
  neon: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, side: THREE.DoubleSide }),
  dark: new THREE.MeshStandardMaterial({ color: '#262a2e', roughness: 0.9 }),
};
const NEON = MAT.neon as THREE.MeshBasicMaterial;

// --- atlanti (canvas) ----------------------------------------------------------
function makeAtlas(cells: number, cw: number, ch: number, draw: (g: CanvasRenderingContext2D, i: number, w: number, h: number) => void) {
  const c = document.createElement('canvas');
  c.width = cw * cells;
  c.height = ch;
  const g = c.getContext('2d')!;
  for (let i = 0; i < cells; i++) {
    g.save();
    g.translate(i * cw, 0);
    g.beginPath();
    g.rect(0, 0, cw, ch);
    g.clip();
    draw(g, i, cw, ch);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const SIGN_CELLS = 5;
const POSTER_CELLS = 4;
let signTex: THREE.CanvasTexture | null = null;
let posterTex: THREE.CanvasTexture | null = null;
let hazardTex: THREE.CanvasTexture | null = null;

const getSignAtlas = () =>
  (signTex ??= makeAtlas(SIGN_CELLS, 128, 128, (g, i, w, h) => {
    g.clearRect(0, 0, w, h);
    const oct = (r: number, fill: string) => {
      g.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = (Math.PI / 4) * k + Math.PI / 8;
        g[k === 0 ? 'moveTo' : 'lineTo'](w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
      }
      g.closePath();
      g.fillStyle = fill;
      g.fill();
    };
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (i === 0) {
      oct(62, '#fff');
      oct(56, '#c62828');
      g.fillStyle = '#fff';
      g.font = 'bold 40px Arial, sans-serif';
      g.fillText('STOP', w / 2, h / 2 + 2);
    } else if (i === 1) {
      g.beginPath();
      g.arc(w / 2, h / 2, 60, 0, Math.PI * 2);
      g.fillStyle = '#c62828';
      g.fill();
      g.beginPath();
      g.arc(w / 2, h / 2, 46, 0, Math.PI * 2);
      g.fillStyle = '#fff';
      g.fill();
      g.fillStyle = '#111';
      g.font = 'bold 50px Arial, sans-serif';
      g.fillText('30', w / 2, h / 2 + 3);
    } else if (i === 2) {
      g.fillStyle = '#1565c0';
      g.fillRect(6, 24, w - 12, h - 48);
      g.strokeStyle = '#fff';
      g.lineWidth = 3;
      g.strokeRect(10, 28, w - 20, h - 56);
      g.fillStyle = '#fff';
      g.beginPath();
      g.moveTo(24, h / 2 - 8);
      g.lineTo(w - 48, h / 2 - 8);
      g.lineTo(w - 48, h / 2 - 22);
      g.lineTo(w - 20, h / 2);
      g.lineTo(w - 48, h / 2 + 22);
      g.lineTo(w - 48, h / 2 + 8);
      g.lineTo(24, h / 2 + 8);
      g.closePath();
      g.fill();
    } else if (i === 3) {
      g.beginPath();
      g.arc(w / 2, h / 2, 60, 0, Math.PI * 2);
      g.fillStyle = '#1565c0';
      g.fill();
      g.strokeStyle = '#c62828';
      g.lineWidth = 9;
      g.beginPath();
      g.arc(w / 2, h / 2, 50, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(w / 2 - 36, h / 2 + 36);
      g.lineTo(w / 2 + 36, h / 2 - 36);
      g.stroke();
    } else {
      g.fillStyle = '#1565c0';
      g.fillRect(6, 6, w - 12, h - 12);
      g.strokeStyle = '#fff';
      g.lineWidth = 3;
      g.strokeRect(10, 10, w - 20, h - 20);
      g.fillStyle = '#fff';
      g.font = 'bold 28px Arial, sans-serif';
      g.fillText('BUS', w / 2, h / 2 + 2);
    }
  }));

const getPosterAtlas = () =>
  (posterTex ??= makeAtlas(POSTER_CELLS, 256, 128, (g, i, w, h) => {
    const bg = ['#e53935', '#1e88e5', '#43a047', '#fb8c00'][i];
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, bg);
    grad.addColorStop(1, '#111');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 44px Arial, sans-serif';
    g.fillText(['PIZZA!', 'CINEMA', 'BANCA', 'SODA'][i], w / 2, h / 2 - 8);
    g.font = '18px Arial, sans-serif';
    g.fillText(['calda tutta la notte', 'stasera alle 21', 'conto zero spese', 'dissetati di piu\''][i], w / 2, h / 2 + 30);
  }));

const getHazardTexture = () => {
  if (hazardTex) return hazardTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f9c80e';
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#111';
  for (let x = -32; x < 160; x += 32) {
    g.beginPath();
    g.moveTo(x, 32);
    g.lineTo(x + 16, 32);
    g.lineTo(x + 32, 0);
    g.lineTo(x + 16, 0);
    g.closePath();
    g.fill();
  }
  hazardTex = new THREE.CanvasTexture(c);
  hazardTex.colorSpace = THREE.SRGBColorSpace;
  hazardTex.wrapS = THREE.RepeatWrapping;
  hazardTex.repeat.set(4, 1);
  return hazardTex;
};

// piano con le UV su una cella dell'atlante
const cellGeo = (cell: number, cells: number) => {
  const g = new THREE.PlaneGeometry(1, 1);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setX(i, (cell + uv.getX(i)) / cells);
  return g;
};

// --- segnaletica a terra ----------------------------------------------------------
const stripGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const zebraGeo = new THREE.PlaneGeometry(0.5, 3.5).rotateX(-Math.PI / 2);
const arrowGeo = (() => {
  const s = new THREE.Shape();
  s.moveTo(0, 1.5);
  s.lineTo(0.75, 0.3);
  s.lineTo(0.28, 0.3);
  s.lineTo(0.28, -1.5);
  s.lineTo(-0.28, -1.5);
  s.lineTo(-0.28, 0.3);
  s.lineTo(-0.75, 0.3);
  s.closePath();
  return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
})();
const whitePaint = new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
const bumpGeo = new THREE.BoxGeometry(7.6, 0.07, 0.7);

const GROUPS = groupsExcluding(CollisionGroups.Default);

const StreetProps: React.FC = () => {
  const data = useMemo(() => getStreetProps(), []);
  const marks = useMemo(() => getMarkings(), []);

  const solids = useMemo<StaticBox[]>(
    () => data.solids.map((s) => ({ half: [s.hx, s.hy, s.hz], pos: [s.x, s.y, s.z], groups: GROUPS })),
    [data]
  );
  useStaticBoxes([0, 0, 0], solids);

  // insegne: piu' accese di sera (stessa curva dei lampioni)
  useFrame(() => {
    const night = streetLampBulbMaterial.emissiveIntensity / 2.2;
    NEON.color.setScalar(0.35 + 0.65 * night);
  });

  // piani dei cartelli e dei manifesti: una mesh per cella dell'atlante
  const plates = useMemo(() => {
    const by = new Map<string, InstanceXform[]>();
    for (const p of data.plates) {
      const key = `${p.atlas}|${p.cell}`;
      let arr = by.get(key);
      if (!arr) by.set(key, (arr = []));
      arr.push({ x: p.x, y: p.y, z: p.z, ry: p.ry, sx: p.w, sy: p.h, sz: 1 });
    }
    return [...by.entries()].map(([key, items]) => {
      const [atlas, cell] = key.split('|');
      return { key, atlas: atlas as 'sign' | 'poster', geo: cellGeo(Number(cell), atlas === 'sign' ? SIGN_CELLS : POSTER_CELLS), items };
    });
  }, [data]);
  const signMat = useMemo(() => new THREE.MeshBasicMaterial({ map: getSignAtlas(), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }), []);
  const posterMat = useMemo(() => new THREE.MeshBasicMaterial({ map: getPosterAtlas(), side: THREE.DoubleSide }), []);
  const bumpMat = useMemo(() => new THREE.MeshStandardMaterial({ map: getHazardTexture(), roughness: 0.8 }), []);
  useEffect(
    () => () => {
      for (const p of plates) p.geo.dispose();
    },
    [plates]
  );

  return (
    <group>
      {Object.entries(data.parts).map(([key, items]) => {
        const [g, m] = key.split('|') as [GeoKey, MatKey];
        const solid = m === 'paint' || m === 'metal' || m === 'dark';
        return <StaticInstances key={key} name={`street-${key}`} geometry={GEO[g]} material={MAT[m]} items={items} castShadow={solid} receiveShadow={solid} />;
      })}
      {plates.map((p) => (
        <StaticInstances key={p.key} name={`plates-${p.key}`} geometry={p.geo} material={p.atlas === 'sign' ? signMat : posterMat} items={p.items} />
      ))}
      <StaticInstances name="stop-lines" geometry={stripGeo} material={whitePaint} items={marks.stops} receiveShadow />
      <StaticInstances name="road-arrows" geometry={arrowGeo} material={whitePaint} items={marks.arrows} receiveShadow />
      <StaticInstances name="mid-zebra" geometry={zebraGeo} material={whitePaint} items={marks.zebra} receiveShadow />
      <StaticInstances name="speed-bumps" geometry={bumpGeo} material={bumpMat} items={marks.bumps} castShadow receiveShadow />
    </group>
  );
};

export default StreetProps;
