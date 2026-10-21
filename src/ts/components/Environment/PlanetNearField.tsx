import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PLANET_RADIUS as R } from '../../lib/planetSurface';
import { siteFrame, type SpacePlanet } from '../../lib/space';
import { GRID, TILE_CENTERS, TILE_COUNT, TILE_RADIUS } from '../../lib/cubeTiles';
import { buildTileMesh, buildTileVegetation, makeTileBuffers, TILE_VERTS, type TileBuffers, type Vegetation } from '../../lib/nearTile';
// (buildTileMesh / makeTileBuffers non servono piu' qui: il terreno e' nel quadtree)
import { requestVegetation, workerCapacity, workersAvailable } from '../../lib/planetWorkers';
import { createTreeSource, registerTreeEntries, TreeBatches, useTreeTemplates, type TreeEntry } from './ParkTrees';

// La vegetazione vicina al pianeta, FISSA sul pianeta: alberi, rocce e prato (celle lat/lon, lib/globalGrid.ts). Si carica e si scarica a pezzetti attorno al punto
// sotto la camera e non dipende dal sito su cui e' montato il mondo di gioco: cambiare sito (rebase del riferimento)
// non smonta ne' ricalcola niente, cambia solo la trasformazione del gruppo (come la sfera di PlanetLOD). La fisica
// (collider del terreno, tronchi) e' un'altra cosa e si ricrea attorno al giocatore (Terrain.tsx, Wilderness.tsx).
const NEAR_ALT = 2600; // sotto questa quota (m sulla superficie) si caricano le tessere
const FAR_ALT = 4200; // sopra questa si scaricano tutte
const LOAD_RANGE = 1000; // m dal punto sotto la camera
const KEEP_RANGE = 1300;
const TUFT_RANGE = 420;
const SELECT_EVERY = 0.2; // s
const EMERGE_S = 1.4; // s: una tessera nuova sale da sotto i livelli di dettaglio
const EMERGE_FROM = 16; // m sotto la quota vera, all'inizio
const GROW_S = 1.6; // s: rocce e prato nuovi crescono

// geometria condivisa: indici (stessa griglia per terreno e acqua)
const INDEX = (() => {
  const idx = new Uint32Array(GRID * GRID * 6);
  let q = 0;
  for (let j = 0; j < GRID; j++)
    for (let i = 0; i < GRID; i++) {
      const a = j * (GRID + 1) + i, b = a + 1, d = a + GRID + 1, e = d + 1;
      idx.set([a, b, d, b, e, d], q);
      q += 6;
    }
  return new THREE.BufferAttribute(idx, 1);
})();

const makeGeo = (withNormal: boolean) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TILE_VERTS * 3), 3));
  if (withNormal) g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(TILE_VERTS * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TILE_VERTS * 3), 3));
  g.setIndex(INDEX);
  return g;
};

// i pezzi grafici si riusano (non si distruggono mai: il renderer WebGPU non ama buffer liberati mentre sono in uso)
const ROCK_GEO = new THREE.IcosahedronGeometry(1, 1);
const ROCK_MAT = new THREE.MeshStandardMaterial({ color: '#8a8782', roughness: 0.95, flatShading: true });
const TUFT_GEO = (() => {
  const pos: number[] = [], col: number[] = [], nor: number[] = [];
  const blades = 7;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + b * 0.7;
    const lean = 0.18 + (b % 3) * 0.08;
    const hgt = 0.55 + (b % 4) * 0.12;
    const dx = Math.cos(a), dz = Math.sin(a);
    const bx = dx * 0.06, bz = dz * 0.06;
    const px = -dz * 0.05, pz = dx * 0.05;
    pos.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, bx + dx * lean, hgt, bz + dz * lean);
    col.push(0.6, 0.68, 0.5, 0.6, 0.68, 0.5, 1, 1, 0.9);
    nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
})();
const TUFT_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1 });
const ROCK_CAP = 120;
const TUFT_CAP = 3200;

const _gm = new THREE.Matrix4();
const _g0 = new THREE.Vector3(0.001, 0.001, 0.001);
const _gv = new THREE.Vector3();
// spostamento verso il basso (lungo la normale al centro della tessera) di una tessera che sta salendo
const emergeOffset = (key: number, depth: number) => new THREE.Vector3(-TILE_CENTERS[key * 3], -TILE_CENTERS[key * 3 + 1], -TILE_CENTERS[key * 3 + 2]).multiplyScalar(depth);
const ease = (x: number) => 1 - (1 - x) * (1 - x) * (1 - x);

interface Tile {
  key: number;
  state: 'mesh' | 'veg' | 'tufts' | 'done';
  terrain: THREE.Mesh | null;
  water: THREE.Mesh | null;
  rocks: THREE.InstancedMesh | null;
  tufts: THREE.InstancedMesh | null;
  buf: TileBuffers | null;
  veg: Vegetation;
  unregisterTrees: (() => void) | null;
  treesRegistered: boolean;
  tuftsDone: boolean;
  born: number; // s: quando il terreno e' comparso
  rockBase: THREE.Matrix4[];
  rockBorn: number;
  tuftBase: THREE.Matrix4[];
  tuftBorn: number;
  busy: boolean; // un worker sta costruendo la sua vegetazione
}

const PlanetNearField: React.FC<{ p: SpacePlanet }> = ({ p }) => {
  const group = useRef<THREE.Group>(null);
  const seed = p.profile.seed;
  const templates = useTreeTemplates();
  const source = useMemo(() => createTreeSource(), []);
  const terrainMat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }), []);
  const waterMat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0 }), []);
  const st = useRef({
    tiles: new Map<number, Tile>(),
    poolTerrain: [] as THREE.Mesh[],
    poolWater: [] as THREE.Mesh[],
    poolRocks: [] as THREE.InstancedMesh[],
    poolTufts: [] as THREE.InstancedMesh[],
    poolBuf: [] as TileBuffers[],
    inflight: 0,
    job: null as null | { tile: Tile; gen: Generator<void, void, void>; kind: 'mesh' | 'veg' | 'tufts' },
    selectT: 0,
    want: [] as number[],
    camLocal: new THREE.Vector3(),
    qi: new THREE.Quaternion(),
    nadir: new THREE.Vector3(),
  });
  const tplRef = useRef(templates);
  tplRef.current = templates;

  const registerTrees = (tile: Tile) => {
    const tpl = tplRef.current;
    const born = performance.now() / 1000;
    if (tile.treesRegistered || tpl.length === 0 || tile.veg.trees.length === 0) return;
    const entries: TreeEntry[] = tile.veg.trees.map((t) => ({ template: tpl[t.t % tpl.length], x: t.x, y: t.y, z: t.z, rotationY: 0, scale: t.m.elements[0] ? Math.hypot(t.m.elements[0], t.m.elements[1], t.m.elements[2]) : 0.2, m: t.m, born }));
    tile.unregisterTrees = registerTreeEntries(entries, source);
    tile.treesRegistered = true;
  };
  // se i modelli degli alberi arrivano dopo le tessere
  useEffect(() => {
    st.current.tiles.forEach(registerTrees);
  }, [templates]); // eslint-disable-line react-hooks/exhaustive-deps

  const acquire = (pool: THREE.Mesh[], make: () => THREE.Mesh) => pool.pop() ?? make();

  const unload = (tile: Tile) => {
    const S = st.current;
    if (S.job && S.job.tile === tile) S.job = null;
    tile.unregisterTrees?.();
    for (const m of [tile.terrain, tile.water, tile.rocks, tile.tufts]) if (m) group.current?.remove(m);
    if (tile.terrain) S.poolTerrain.push(tile.terrain);
    if (tile.water) S.poolWater.push(tile.water);
    if (tile.rocks) S.poolRocks.push(tile.rocks);
    if (tile.tufts) S.poolTufts.push(tile.tufts);
    if (tile.buf) S.poolBuf.push(tile.buf);
    S.tiles.delete(tile.key);
  };

  const finishMesh = (tile: Tile) => {
    const S = st.current;
    const buf = tile.buf!;
    const tm = acquire(S.poolTerrain, () => {
      const m = new THREE.Mesh(makeGeo(true), terrainMat);
      m.receiveShadow = true;
      return m;
    });
    const g = tm.geometry;
    (g.attributes.position.array as Float32Array).set(buf.pos);
    (g.attributes.normal.array as Float32Array).set(buf.nor);
    (g.attributes.color.array as Float32Array).set(buf.col);
    g.attributes.position.needsUpdate = g.attributes.normal.needsUpdate = g.attributes.color.needsUpdate = true;
    g.computeBoundingSphere();
    tm.frustumCulled = true;
    tile.terrain = tm;
    tile.born = performance.now() / 1000;
    tm.position.copy(emergeOffset(tile.key, EMERGE_FROM));
    group.current?.add(tm);
    if (buf.hasWater) {
      const wm = acquire(S.poolWater, () => {
        const m = new THREE.Mesh(makeGeo(false), waterMat);
        return m;
      });
      const wg = wm.geometry;
      (wg.attributes.position.array as Float32Array).set(buf.wpos);
      (wg.attributes.color.array as Float32Array).set(buf.wcol);
      wg.attributes.position.needsUpdate = wg.attributes.color.needsUpdate = true;
      wg.computeBoundingSphere();
      // (la normale dell'acqua e' la direzione radiale: si calcola dalle posizioni)
      wg.computeVertexNormals();
      tile.water = wm;
      wm.position.copy(emergeOffset(tile.key, EMERGE_FROM));
      group.current?.add(wm);
    }
    S.poolBuf.push(buf);
    tile.buf = null;
  };

  const instanced = (pool: THREE.InstancedMesh[], geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, shadow: boolean) =>
    pool.pop() ??
    (() => {
      const m = new THREE.InstancedMesh(geo, mat, cap);
      m.frustumCulled = false;
      m.castShadow = shadow;
      m.receiveShadow = true;
      return m;
    })();

  const finishVeg = (tile: Tile) => {
    const S = st.current;
    registerTrees(tile);
    const rocks = tile.veg.rocks.slice(0, ROCK_CAP);
    if (rocks.length > 0) {
      const m = instanced(S.poolRocks, ROCK_GEO, ROCK_MAT, ROCK_CAP, true);
      tile.rockBase = rocks.map((r) => r.m);
      tile.rockBorn = performance.now() / 1000;
      rocks.forEach((r, i) => m.setMatrixAt(i, _gm.copy(r.m).scale(_g0)));
      m.count = rocks.length;
      m.instanceMatrix.needsUpdate = true;
      tile.rocks = m;
      group.current?.add(m);
    }
  };
  const finishTufts = (tile: Tile) => {
    const S = st.current;
    const tufts = tile.veg.tufts.slice(0, TUFT_CAP);
    if (tufts.length === 0) return;
    const m = instanced(S.poolTufts, TUFT_GEO, TUFT_MAT, TUFT_CAP, false);
    const c = new THREE.Color();
    tile.tuftBase = tufts.map((t) => t.m);
    tile.tuftBorn = performance.now() / 1000;
    tufts.forEach((t, i) => {
      m.setMatrixAt(i, _gm.copy(t.m).scale(_g0));
      m.setColorAt(i, c.setHex(t.color ?? 0x66aa44));
    });
    m.count = tufts.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    tile.tufts = m;
    group.current?.add(m);
  };

  useEffect(
    () => () => {
      const S = st.current;
      S.tiles.forEach((t) => t.unregisterTrees?.());
    },
    []
  );

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const S = st.current;
    g.position.set(p.center[0], p.center[1], p.center[2]);
    g.quaternion.copy(siteFrame.quat);
    S.qi.copy(siteFrame.quat).invert();
    S.camLocal.set(state.camera.position.x - p.center[0], state.camera.position.y - p.center[1], state.camera.position.z - p.center[2]).applyQuaternion(S.qi);
    const dist = S.camLocal.length();
    const alt = dist - R;
    S.nadir.copy(S.camLocal).divideScalar(dist || 1);

    if (alt > FAR_ALT) {
      if (S.tiles.size > 0) [...S.tiles.values()].forEach(unload);
      g.visible = false;
      return;
    }
    g.visible = true;

    // quali tessere servono: vicine al punto sotto la camera (si ricalcola ogni tanto)
    S.selectT += delta;
    if (S.selectT > SELECT_EVERY && alt < NEAR_ALT) {
      S.selectT = 0;
      const nx = S.nadir.x, ny = S.nadir.y, nz = S.nadir.z;
      const cosLoad = Math.cos((LOAD_RANGE + TILE_RADIUS) / R);
      const want: Array<[number, number]> = [];
      for (let k = 0; k < TILE_COUNT; k++) {
        const dot = TILE_CENTERS[k * 3] * nx + TILE_CENTERS[k * 3 + 1] * ny + TILE_CENTERS[k * 3 + 2] * nz;
        if (dot > cosLoad) want.push([k, dot]);
      }
      want.sort((a, b) => b[1] - a[1]);
      S.want = want.map((w) => w[0]);
      // scarica quelle troppo lontane
      const cosKeep = Math.cos((KEEP_RANGE + TILE_RADIUS) / R);
      S.tiles.forEach((tile) => {
        const k = tile.key;
        const dot = TILE_CENTERS[k * 3] * nx + TILE_CENTERS[k * 3 + 1] * ny + TILE_CENTERS[k * 3 + 2] * nz;
        if (dot < cosKeep) unload(tile);
      });
    }

    // animazioni di nascita: le tessere salgono, rocce e prato crescono
    const nowS = performance.now() / 1000;
    S.tiles.forEach((tile) => {
      if (tile.terrain) {
        const x = (nowS - tile.born) / EMERGE_S;
        const off = x >= 1 ? 0 : EMERGE_FROM * (1 - ease(Math.max(0, x)));
        if (off > 0 || tile.terrain.position.lengthSq() > 0) {
          const o = emergeOffset(tile.key, off);
          tile.terrain.position.copy(o);
          tile.water?.position.copy(o);
        }
      }
      for (const kind of ['rock', 'tuft'] as const) {
        const mesh = kind === 'rock' ? tile.rocks : tile.tufts;
        const base = kind === 'rock' ? tile.rockBase : tile.tuftBase;
        const born = kind === 'rock' ? tile.rockBorn : tile.tuftBorn;
        if (!mesh || base.length === 0) continue;
        const x = (nowS - born) / GROW_S;
        if (x >= 1) {
          if (born > 0) {
            base.forEach((m, i) => mesh.setMatrixAt(i, m));
            mesh.instanceMatrix.needsUpdate = true;
            if (kind === 'rock') tile.rockBorn = 0;
            else tile.tuftBorn = 0;
          }
          continue;
        }
        if (born === 0) continue;
        const gg = Math.max(0.001, ease(Math.max(0, x)));
        _gv.set(gg, gg, gg);
        base.forEach((m, i) => mesh.setMatrixAt(i, _gm.copy(m).scale(_gv)));
        mesh.instanceMatrix.needsUpdate = true;
      }
    });

    // un lavoro alla volta: prima il terreno delle tessere piu' vicine, poi alberi e rocce, poi il prato
    const usingWorkers = workersAvailable();
    if (!S.job && (!usingWorkers || S.inflight < workerCapacity())) {
      let next: Tile | null = null;
      let kind: 'mesh' | 'veg' | 'tufts' = 'mesh';
      for (const k of S.want) {
        if (!S.tiles.has(k)) {
          const tile: Tile = { key: k, state: 'veg', terrain: null, water: null, rocks: null, tufts: null, buf: null, veg: { trees: [], rocks: [], tufts: [] }, unregisterTrees: null, treesRegistered: false, tuftsDone: false, born: 0, rockBase: [], rockBorn: 0, tuftBase: [], tuftBorn: 0, busy: false };
          tile.state = 'veg'; // il terreno e l'acqua li disegna il quadtree (PlanetQuadtree.tsx): qui solo la vegetazione
          S.tiles.set(k, tile);
          continue;
        }
        const t = S.tiles.get(k)!;
        if (t.state === 'mesh' && !t.terrain) {
          next = t;
          kind = 'mesh';
          break;
        }
      }
      if (!next) {
        // vegetazione per le tessere con il terreno pronto
        for (const k of S.want) {
          const t = S.tiles.get(k);
          if (t && t.state === 'veg' && !t.busy) {
            next = t;
            kind = 'veg';
            break;
          }
        }
      }
      if (!next) {
        // prato per le tessere vicine
        const cosTuft = Math.cos((TUFT_RANGE + TILE_RADIUS) / R);
        for (const k of S.want) {
          const t = S.tiles.get(k);
          if (!t || t.state !== 'done' || t.tuftsDone || t.busy) continue;
          const dot = TILE_CENTERS[k * 3] * S.nadir.x + TILE_CENTERS[k * 3 + 1] * S.nadir.y + TILE_CENTERS[k * 3 + 2] * S.nadir.z;
          if (dot > cosTuft) {
            next = t;
            kind = 'tufts';
            break;
          }
        }
      }
      if (next && usingWorkers && kind !== 'mesh') {
        // vegetazione calcolata nei worker (workers/planetWorker.ts)
        const t = next;
        t.busy = true;
        S.inflight++;
        requestVegetation(t.key, seed, p.profile.gridRadius, kind === 'veg' ? 'base' : 'tufts')
          .then((veg) => {
            S.inflight--;
            t.busy = false;
            if (S.tiles.get(t.key) !== t) return; // scaricata nel frattempo
            if (kind === 'veg') {
              t.veg = veg;
              finishVeg(t);
              t.state = 'done';
            } else {
              t.veg.tufts = veg.tufts;
              finishTufts(t);
              t.tuftsDone = true;
            }
          })
          .catch(() => {
            S.inflight--;
            t.busy = false;
          });
      } else if (next) {
        if (kind === 'mesh') {
          next.buf = S.poolBuf.pop() ?? makeTileBuffers();
          S.job = { tile: next, gen: buildTileMesh(next.key, seed, next.buf), kind };
        } else if (kind === 'veg') {
          S.job = { tile: next, gen: buildTileVegetation(next.key, seed, 'base', next.veg), kind };
        } else {
          const extra: Vegetation = { trees: [], rocks: [], tufts: [] };
          const t = next;
          S.job = {
            tile: t,
            kind,
            gen: (function* () {
              yield* buildTileVegetation(t.key, seed, 'tufts', extra);
              t.veg.tufts = extra.tufts;
            })(),
          };
        }
      }
    }
    if (S.job) {
      const job = S.job;
      const r = job.gen.next();
      if (r.done) {
        S.job = null;
        const tile = job.tile;
        if (job.kind === 'mesh') {
          finishMesh(tile);
          tile.state = 'veg';
        } else if (job.kind === 'veg') {
          finishVeg(tile);
          tile.state = 'done';
        } else {
          finishTufts(tile);
          tile.tuftsDone = true;
        }
      }
    }
  });

  return (
    <group ref={group} visible={false} dispose={null}>
      <TreeBatches source={source} local />
    </group>
  );
};

export default PlanetNearField;
