import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { CollisionGroups, groupsExcluding } from '../../enums/CollisionGroups';
import { getCurrentSite } from '../../lib/site';
import { wildInfo } from '../../lib/site';
import { getTerrainHeight, getCityHalf } from './Terrain';
import { registerTreeEntries, useTreeTemplates, type TreeEntry } from './ParkTrees';
import { StaticInstances, type InstanceXform } from './StaticInstances';
import { useStaticBoxes, type StaticBox } from './staticColliders';

// Natura procedurale del sito: boschi e rocce sul terreno del pianeta (lib/site.ts). Tutto dipende dal seme e
// dal luogo (stesso posto = stesso bosco): densita' dal bioma (lib/planetSurface.ts surfaceInfo), pendenza,
// niente alberi sott'acqua ne' in citta'. Gli alberi si disegnano in blocco (TreeBatches) e hanno un
// collider cilindrico ciascuno in UN corpo fisso.
const AREA = 700; // m dal centro del sito
const CELL = 12; // m: una pianta per cella al massimo
const MAX_TREES = 1500;
const MAX_ROCKS = 450;

const hash = (a: number, b: number, s: number) => {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(s, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// prato: ciuffi d'erba a chiazze (rumore a valori a ~35 m) sul terreno erboso, piu' fitti dove il rumore e' alto
const MAX_TUFTS = 12000;
const vnoise = (x: number, z: number, s: number) => {
  const xi = Math.floor(x), zi = Math.floor(z);
  const u = (x - xi) * (x - xi) * (3 - 2 * (x - xi)), v = (z - zi) * (z - zi) * (3 - 2 * (z - zi));
  const c = (dx: number, dz: number) => hash(xi + dx, zi + dz, s);
  return (c(0, 0) * (1 - u) + c(1, 0) * u) * (1 - v) + (c(0, 1) * (1 - u) + c(1, 1) * u) * v;
};
const makeTuftGeometry = () => {
  const pos: number[] = [], col: number[] = [];
  const blades = 7;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + b * 0.7;
    const lean = 0.18 + (b % 3) * 0.08;
    const hgt = 0.55 + (b % 4) * 0.12;
    const dx = Math.cos(a), dz = Math.sin(a);
    const bx = dx * 0.06, bz = dz * 0.06;
    const px = -dz * 0.05, pz = dx * 0.05; // larghezza della lama
    pos.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, bx + dx * lean, hgt, bz + dz * lean);
    col.push(0.6, 0.68, 0.5, 0.6, 0.68, 0.5, 1, 1, 0.9);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
};
const TUFT_GEO = makeTuftGeometry();
const TUFT_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1 });

const GROUPS = groupsExcluding(CollisionGroups.Default);
const ROCK_GEO = new THREE.IcosahedronGeometry(1, 1);
const ROCK_MAT = new THREE.MeshStandardMaterial({ color: '#8a8782', roughness: 0.95, flatShading: true });

const Wilderness: React.FC = () => {
  const site = getCurrentSite();
  const templates = useTreeTemplates();

  const { trees, rocks, boxes, tufts } = useMemo(() => {
    const trees: Array<{ x: number; y: number; z: number; ry: number; s: number; t: number }> = [];
    const rocks: InstanceXform[] = [];
    const exclude = site.kind === 'city' ? getCityHalf() + 40 : 0;
    const seed = (site.planetSeed ^ 0x51ed) | 0;
    for (let gz = -AREA; gz < AREA; gz += CELL) {
      for (let gx = -AREA; gx < AREA; gx += CELL) {
        const ix = Math.round(gx / CELL), iz = Math.round(gz / CELL);
        const x = gx + hash(ix, iz, seed) * CELL;
        const z = gz + hash(ix, iz, seed + 1) * CELL;
        if (exclude && Math.abs(x) < exclude && Math.abs(z) < exclude) continue;
        if (site.kind === 'wild' && Math.hypot(x, z) < 8) continue; // l'arrivo resta libero
        const roll = hash(ix, iz, seed + 2);
        if (trees.length >= MAX_TREES && rocks.length >= MAX_ROCKS) break;
        const info = wildInfo(x, z, site);
        if (info.h < 3) continue; // acqua / spiaggia
        const y = getTerrainHeight(x, z);
        const slope = Math.max(Math.abs(getTerrainHeight(x + 3, z) - y), Math.abs(getTerrainHeight(x, z + 3) - y)) / 3;
        if (info.forest > 0.05 && slope < 0.6 && trees.length < MAX_TREES && roll < info.forest * 0.85) {
          trees.push({ x, y, z, ry: hash(ix, iz, seed + 3) * Math.PI * 2, s: 0.17 + hash(ix, iz, seed + 4) * 0.14, t: Math.floor(hash(ix, iz, seed + 5) * 100) });
        } else if (rocks.length < MAX_ROCKS && (slope > 0.35 || info.rock > 0.3) && roll > 0.9) {
          const s = 0.5 + hash(ix, iz, seed + 6) * 2.4;
          rocks.push({ x, y: y + s * 0.2, z, ry: hash(ix, iz, seed + 7) * Math.PI * 2, sx: s * 1.3, sy: s * 0.8, sz: s });
        }
      }
    }
    // prato
    const tufts: InstanceXform[] = [];
    const tseed = (site.planetSeed ^ 0x7a11) | 0;
    const TUFT_AREA = exclude ? 640 : 320; // in citta' il prato sta fuori dalle strade, quindi piu' largo e piu' rado
    const TUFT_CELL = exclude ? 5 : 3.2;
    const green = new THREE.Color();
    for (let gz = -TUFT_AREA; gz < TUFT_AREA; gz += TUFT_CELL) {
      for (let gx = -TUFT_AREA; gx < TUFT_AREA; gx += TUFT_CELL) {
        const ix = Math.round(gx / TUFT_CELL), iz = Math.round(gz / TUFT_CELL);
        const x = gx + hash(ix, iz, tseed) * TUFT_CELL;
        const z = gz + hash(ix, iz, tseed + 1) * TUFT_CELL;
        if (exclude && Math.abs(x) < exclude && Math.abs(z) < exclude) continue;
        if (site.kind === 'wild' && Math.hypot(x, z) < 3) continue;
        const patch = vnoise(x / 35, z / 35, tseed + 2) * 0.7 + vnoise(x / 9, z / 9, tseed + 3) * 0.3;
        if (hash(ix, iz, tseed + 4) > Math.max(0, patch - 0.3) * 2.1) continue;
        const info = wildInfo(x, z, site);
        if (info.h < 1.5 || info.sand > 0.3 || info.snow > 0.1 || info.rock > 0.3) continue;
        const y = getTerrainHeight(x, z);
        const slope = Math.max(Math.abs(getTerrainHeight(x + 2, z) - y), Math.abs(getTerrainHeight(x, z + 2) - y)) / 2;
        if (slope > 0.5) continue;
        const sc = 0.8 + hash(ix, iz, tseed + 5) * 1.0;
        green.setHSL(0.2 + hash(ix, iz, tseed + 6) * 0.1, 0.5, 0.45 + hash(ix, iz, tseed + 7) * 0.15);
        tufts.push({ x, y, z, ry: hash(ix, iz, tseed + 8) * Math.PI * 2, sx: sc, sy: sc * (0.8 + hash(ix, iz, tseed + 9) * 0.6), sz: sc, color: green.getHex() });
      }
    }
    // troppi: se ne tengono a caso (in modo deterministico) quanti ne servono, su tutta l'area
    if (tufts.length > MAX_TUFTS) {
      const keep = MAX_TUFTS / tufts.length;
      const kept = tufts.filter((t) => hash(Math.round(t.x * 10), Math.round(t.z * 10), tseed + 11) < keep);
      tufts.length = 0;
      tufts.push(...kept);
    }
    const boxes: StaticBox[] = trees.map((t) => {
      const th = 20 * t.s;
      return { half: [th / 2, 0.4 * t.s, 0] as [number, number, number], pos: [t.x, t.y + th / 2, t.z] as [number, number, number], shape: 'cylinder' as const, groups: GROUPS };
    });
    return { trees, rocks, boxes, tufts };
  }, [site.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (templates.length === 0) return;
    const entries: TreeEntry[] = trees.map((t) => ({ template: templates[t.t % templates.length], x: t.x, y: t.y, z: t.z, rotationY: t.ry, scale: t.s }));
    return registerTreeEntries(entries);
  }, [trees, templates]);

  useStaticBoxes([0, 0, 0], boxes);

  return (
    <>
      {rocks.length > 0 && <StaticInstances geometry={ROCK_GEO} material={ROCK_MAT} items={rocks} castShadow receiveShadow chunk={120} />}
      {tufts.length > 0 && <StaticInstances geometry={TUFT_GEO} material={TUFT_MAT} items={tufts} receiveShadow chunk={60} />}
    </>
  );
};

export default Wilderness;
