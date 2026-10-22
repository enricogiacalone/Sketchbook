import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CITY_LAYOUT } from './City';
import { ROAD_GRID_SPACING } from './Road';
import { onPlanetRebuild } from '../../lib/planet';
import { getSunDirection, getDayFactor } from '../../lib/SunCycle';

// Insegne al neon (stile notte blu neon, lib/SunCycle.ts NEON_NIGHT_HOUR): cartelli verticali luminosi sulla facciata
// che guarda la strada di una parte dei palazzi, rosa / ciano / viola / arancio, con una cornice piu' chiara. Come
// BuildingLeds: UNA instancedMesh, colore per istanza (MeshBasicMaterial, toneMapped spento: il bagliore lo fa il
// passaggio dei contorni, ToonOutline.tsx), spente di giorno.
const COLORS = ['#ff2e93', '#22e5ff', '#a855f7', '#ff8a1f', '#39ff88'];
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

interface Sign {
  x: number;
  y: number;
  z: number;
  ry: number;
  w: number;
  h: number;
  color: THREE.Color;
  phase: number;
}

const make = (): Sign[] => {
  const out: Sign[] = [];
  CITY_LAYOUT.buildings.forEach((b, i) => {
    if (b.h < 8 || hash(i + 0.5) > 0.45) return;
    // la facciata verso la strada: dal centro dell'isolato (griglia da ROAD_GRID_SPACING) al palazzo
    const cx = Math.round(b.x / ROAD_GRID_SPACING) * ROAD_GRID_SPACING;
    const cz = Math.round(b.z / ROAD_GRID_SPACING) * ROAD_GRID_SPACING;
    const ox = b.x - cx;
    const oz = b.z - cz;
    const alongX = Math.abs(ox) > Math.abs(oz);
    const sx = alongX ? Math.sign(ox) || 1 : 0;
    const sz = alongX ? 0 : Math.sign(oz) || 1;
    const w = 0.7 + hash(i + 2) * 0.5;
    const h = 2.2 + hash(i + 3) * 3.2;
    const y = b.by + 3.2 + hash(i + 4) * Math.max(0, Math.min(b.h - h - 4, 9));
    // un po' fuori dalla facciata, lungo la facciata scelta un po' di lato
    const slide = (hash(i + 5) - 0.5) * ((alongX ? b.d : b.w) * 0.6);
    out.push({
      x: b.x + sx * (b.w / 2 + 0.25) + (alongX ? 0 : slide),
      y: y + h / 2,
      z: b.z + sz * (b.d / 2 + 0.25) + (alongX ? slide : 0),
      ry: alongX ? Math.PI / 2 : 0,
      w,
      h,
      color: new THREE.Color(COLORS[Math.floor(hash(i + 6) * COLORS.length)]),
      phase: hash(i + 7) * 6.28,
    });
  });
  return out;
};
let ALL = make();
onPlanetRebuild(() => {
  ALL = make();
});

const _o = new THREE.Object3D();
const _c = new THREE.Color();

const NeonSigns: React.FC = () => {
  const ref = useRef<THREE.InstancedMesh>(null);
  useFrame((state) => {
    const m = ref.current;
    if (!m) return;
    const t = state.clock.elapsedTime;
    const night = 1 - getDayFactor(getSunDirection(t).y);
    if (night <= 0.01) {
      if (m.userData.lit) {
        for (let i = 0; i < ALL.length; i++) m.setColorAt(i, _c.setScalar(0));
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        m.userData.lit = false;
      }
      return;
    }
    m.userData.lit = true;
    for (let i = 0; i < ALL.length; i++) {
      const s = ALL[i];
      // sfarfallio raro: ogni tanto un'insegna "singhiozza"
      const flick = Math.sin(t * 23 + s.phase * 9) > 0.985 ? 0.35 : 1;
      m.setColorAt(i, _c.copy(s.color).multiplyScalar(night * (0.85 + 0.15 * Math.sin(t * 1.7 + s.phase)) * flick));
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh
      ref={ref}
      args={[undefined as any, undefined as any, ALL.length]}
      frustumCulled={false}
      onUpdate={(self) => {
        for (let i = 0; i < ALL.length; i++) {
          const s = ALL[i];
          _o.position.set(s.x, s.y, s.z);
          _o.rotation.set(0, s.ry, 0);
          _o.scale.set(0.16, s.h, s.w);
          _o.updateMatrix();
          self.setMatrixAt(i, _o.matrix);
          self.setColorAt(i, _c.setScalar(0));
        }
        self.instanceMatrix.needsUpdate = true;
        if (self.instanceColor) self.instanceColor.needsUpdate = true;
      }}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial vertexColors toneMapped={false} />
    </instancedMesh>
  );
};

export default NeonSigns;
