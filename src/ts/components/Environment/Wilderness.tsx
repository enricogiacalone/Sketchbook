import React, { useMemo } from 'react';
import * as THREE from 'three';
import { CollisionGroups, groupsExcluding } from '../../enums/CollisionGroups';
import { getCurrentSite } from '../../lib/site';
import { PLANET_RADIUS as R } from '../../lib/planetSurface';
import { TILE_CENTERS, TILE_COUNT, TILE_RADIUS } from '../../lib/cubeTiles';
import { buildTileVegetation, type Vegetation } from '../../lib/nearTile';
import { getTerrainHeight } from './Terrain';
import { useStaticBoxes, type StaticBox } from './staticColliders';

// La natura si VEDE dalle tessere del pianeta (PlanetNearField.tsx, fisse sul pianeta, sempre montate): alberi, rocce e
// prato non dipendono dal sito. Qui c'e' solo la FISICA: i tronchi (un cilindro ciascuno, in UN corpo fisso) degli alberi
// attorno al sito, che si ricrea a ogni cambio di sito insieme al collider del terreno. Sono gli stessi alberi delle
// tessere (stesse celle, stesse regole): si calcolano con la stessa funzione (lib/nearTile.ts).
const RADIUS = 220; // m attorno al sito
const GROUPS = groupsExcluding(CollisionGroups.Default);
const _v = new THREE.Vector3();

const Wilderness: React.FC = () => {
  const site = getCurrentSite();

  const boxes = useMemo<StaticBox[]>(() => {
    const out: StaticBox[] = [];
    const cos = Math.cos((RADIUS + TILE_RADIUS) / R);
    const n = site.n;
    for (let k = 0; k < TILE_COUNT; k++) {
      const dot = TILE_CENTERS[k * 3] * n[0] + TILE_CENTERS[k * 3 + 1] * n[1] + TILE_CENTERS[k * 3 + 2] * n[2];
      if (dot < cos) continue;
      const veg: Vegetation = { trees: [], rocks: [], tufts: [] };
      const gen = buildTileVegetation(k, site.planetSeed, 'base', veg);
      while (!gen.next().done);
      for (const t of veg.trees) {
        // dal riferimento del pianeta a quello del sito (il centro del pianeta sta in (0, -(R + hN), 0))
        _v.set(t.x, t.y, t.z).applyQuaternion(site.quat);
        const x = _v.x, z = _v.z;
        if (Math.hypot(x, z) > RADIUS) continue;
        const s = Math.hypot(t.m.elements[0], t.m.elements[1], t.m.elements[2]);
        const y = getTerrainHeight(x, z);
        const th = 20 * s;
        out.push({ half: [th / 2, 0.4 * s, 0], pos: [x, y + th / 2, z], shape: 'cylinder', groups: GROUPS });
      }
    }
    return out;
  }, [site.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useStaticBoxes([0, 0, 0], boxes);
  return null;
};

export default Wilderness;
