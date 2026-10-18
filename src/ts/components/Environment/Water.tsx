import React, { useMemo } from 'react';
import * as THREE from 'three';
import { getCurrentSite } from '../../lib/site';
import { PLANET_RADIUS as R, seaColor } from '../../lib/planetSurface';

// L'acqua del sito: mari, laghi e fiumi sono UNA superficie, il livello del mare del pianeta (una sfera di raggio
// R). Qui e' una toppa di quella sfera attorno al sito (griglia sul piano tangente con la curvatura calcolata
// per vertice), cosi' i bordi coincidono con le coste del terreno (lib/planetSurface.ts scava laghi e fiumi
// sotto quota 0). Il terreno che resta sotto si vede in trasparenza.
const HALF = 1700;
const STEP = 40;

const Water: React.FC = () => {
  const site = getCurrentSite();
  const { geo, color } = useMemo(() => {
    const n = Math.round((HALF * 2) / STEP);
    const pos = new Float32Array((n + 1) * (n + 1) * 3);
    const cy = R + site.hN;
    let k = 0;
    for (let j = 0; j <= n; j++)
      for (let i = 0; i <= n; i++) {
        const x = -HALF + i * STEP, z = -HALF + j * STEP;
        const r2 = Math.min(x * x + z * z, (R * 0.95) * (R * 0.95));
        pos[k++] = x;
        pos[k++] = Math.sqrt(R * R - r2) - cy + 0.05;
        pos[k++] = z;
      }
    const idx = new Uint32Array(n * n * 6);
    let q = 0;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
        idx.set([a, c, b, b, c, d], q);
        q += 6;
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const col = seaColor(site.planetSeed);
    return { geo: g, color: col };
  }, [site.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <mesh geometry={geo} frustumCulled={false} renderOrder={1}>
      <meshStandardMaterial color={color} roughness={0.3} metalness={0} transparent opacity={0.9} />
    </mesh>
  );
};

export default Water;
