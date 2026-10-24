import React, { useMemo } from 'react';
import * as THREE from 'three';
import { CollisionGroups, groupsExcluding } from '../../enums/CollisionGroups';
import { getCurrentSite } from '../../lib/site';
import { PLANET_RADIUS as R } from '../../lib/planetSurface';
import { TILE_CENTERS, TILE_COUNT, TILE_RADIUS } from '../../lib/cubeTiles';
import { BRIDGE_BASE, BRIDGE_WIDTH, buildTileVegetation, type Vegetation } from '../../lib/nearTile';
import { VILLAGE_SPECS, VK, kindOf } from '../../lib/village';
import { getTerrainHeight } from './Terrain';
import { useStaticBoxes, type StaticBox } from './staticColliders';

// La natura si VEDE dalle tessere del pianeta (PlanetNearField.tsx, fisse sul pianeta, sempre montate): alberi, rocce e
// prato non dipendono dal sito. Qui c'e' solo la FISICA: i tronchi (un cilindro ciascuno, in UN corpo fisso) degli alberi
// attorno al sito, che si ricrea a ogni cambio di sito insieme al collider del terreno. Sono gli stessi alberi delle
// tessere (stesse celle, stesse regole): si calcolano con la stessa funzione (lib/nearTile.ts).
// [raggio alla base, lunghezza del tronco] nelle unita' del modello, per specie (PLANET_TREE_SPECIES: frassino, pioppo, quercia
// media, quercia grande, pino medio, pino grande), misurati dai preset di ez-tree
const TRUNKS: Array<[number, number]> = [[2, 43], [1.6, 40], [2.5, 40], [3, 48], [1.05, 50], [1.27, 65]];
const RADIUS = 220; // m attorno al sito
const GROUPS = groupsExcluding(CollisionGroups.Default);
const _v = new THREE.Vector3();
const _hp = new THREE.Vector3(), _hs = new THREE.Vector3();
const _hq = new THREE.Quaternion();

const Wilderness: React.FC = () => {
  const site = getCurrentSite();

  const boxes = useMemo<StaticBox[]>(() => {
    const out: StaticBox[] = [];
    const cos = Math.cos((RADIUS + TILE_RADIUS) / R);
    const n = site.n;
    for (let k = 0; k < TILE_COUNT; k++) {
      const dot = TILE_CENTERS[k * 3] * n[0] + TILE_CENTERS[k * 3 + 1] * n[1] + TILE_CENTERS[k * 3 + 2] * n[2];
      if (dot < cos) continue;
      const veg: Vegetation = { trees: [], rocks: [], tufts: [], houses: [] };
      const gen = buildTileVegetation(k, site.planetSeed, 'base', veg);
      while (!gen.next().done);
      // case e arredi del villaggio: un cuboide per pezzo (orientato come il modello, nel riferimento del sito)
      for (const h of veg.houses) {
        if (h.t >= BRIDGE_BASE) {
          // ponte: il piano (e i due parapetti) a quota vera, non quella del terreno
          _v.set(h.x, h.y, h.z).applyQuaternion(site.quat);
          if (Math.hypot(_v.x, _v.z) > RADIUS + 80) continue;
          h.m.decompose(_hp, _hq, _hs);
          _hq.premultiply(site.quat);
          const y = _v.y - (R + site.hN);
          const len = (h.t - BRIDGE_BASE) * 4;
          const q: [number, number, number, number] = [_hq.x, _hq.y, _hq.z, _hq.w];
          out.push({ half: [BRIDGE_WIDTH / 2, 0.2, len / 2], pos: [_v.x, y - 0.3, _v.z], rot: q, groups: GROUPS });
          for (const sx of [-1, 1]) {
            const ox = (BRIDGE_WIDTH / 2 - 0.1) * sx;
            _hp.set(ox, 0, 0).applyQuaternion(_hq);
            out.push({ half: [0.1, 0.55, len / 2], pos: [_v.x + _hp.x, y + 0.55 + _hp.y, _v.z + _hp.z], rot: q, groups: GROUPS });
          }
          continue;
        }
        const kd = kindOf(h.t);
        const sp = VILLAGE_SPECS[kd];
        if (!sp?.solid || kd === VK.Fence) continue;
        _v.set(h.x, h.y, h.z).applyQuaternion(site.quat);
        if (Math.hypot(_v.x, _v.z) > RADIUS + 60) continue;
        h.m.decompose(_hp, _hq, _hs);
        _hq.premultiply(site.quat);
        const s = _hs.x;
        const y = getTerrainHeight(_v.x, _v.z);
        const hy = (sp.h * s) / 2;
        out.push({ half: [(sp.w * s) / 2, hy, (sp.d * s) / 2], pos: [_v.x, y + hy, _v.z], rot: [_hq.x, _hq.y, _hq.z, _hq.w], groups: GROUPS });
      }
      for (const t of veg.trees) {
        // dal riferimento del pianeta a quello del sito (il centro del pianeta sta in (0, -(R + hN), 0))
        _v.set(t.x, t.y, t.z).applyQuaternion(site.quat);
        const x = _v.x, z = _v.z;
        if (Math.hypot(x, z) > RADIUS) continue;
        const s = Math.hypot(t.m.elements[0], t.m.elements[1], t.m.elements[2]);
        const y = getTerrainHeight(x, z);
        // tronco: raggio e lunghezza dai modelli ez-tree della specie (unita' del modello x scala dell'albero)
        const tr = TRUNKS[Math.min(TRUNKS.length - 1, t.t >> 1)];
        const rad = Math.max(0.12, tr[0] * s * 0.7);
        const th = Math.max(2.5, tr[1] * s * 0.55);
        out.push({ half: [th / 2, rad, 0], pos: [x, y + th / 2, z], shape: 'cylinder', groups: GROUPS });
      }
    }
    return out;
  }, [site.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useStaticBoxes([0, 0, 0], boxes);
  return null;
};

export default Wilderness;
