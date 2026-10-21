import React, { useMemo, useRef } from 'react';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PLANET_RADIUS as R } from '../../lib/planetSurface';
import { siteFrame, type SpacePlanet } from '../../lib/space';
import { faceDir, GRID } from '../../lib/cubeTiles';
import { requestNode, workerCapacity, workersAvailable } from '../../lib/planetWorkers';
import { buildNodeMesh, makeNodeBuffers, MAX_LEVEL, NODE_INDEX, NODE_VERTS, GRID_VERTS, nodeSize, type NodeBuffers } from '../../lib/quadNode';

// Il terreno del pianeta come QUADTREE a geomorphing (come i motori planetari tipo Google Earth, CDLOD): ogni faccia della
// cubo-sfera e' un albero di nodi quadrati, ognuno una griglia 64x64 (livello 0 = tutta la faccia, ~73 m di passo;
// livello 4 = ~4.6 m). Un nodo si divide in 4 quando la camera e' a meno di K volte la sua taglia, e si ricompone quando si
// allontana. Il passaggio e' senza scatti perche':
//  - un nodo figlio compare solo quando tutti e 4 i figli sono PRONTI (niente buchi), e nasce "morfato" sulla forma del
//    padre (ogni vertice dispari sta a meta' tra due vertici pari: quota, normale e colore), poi acquista dettaglio piano
//    piano avvicinandosi (fattore di morph da 1 a 0 in funzione della distanza); alla fusione il percorso e' inverso;
//  - i bordi tra livelli diversi hanno una "gonna" (lib/quadNode.ts) che copre le fessure;
//  - tutto e' fisso sul pianeta: cambiare sito (rebase) cambia solo la trasformazione del gruppo.
const ACTIVE_ALT = 9000; // sotto questa quota (m sulla superficie) il quadtree e' attivo
const K = 2.6; // un nodo si divide quando la sua distanza e' minore di K x la sua taglia
const K_FINE = 1.8; // per l'ultima divisione (livello 3 -> 4) un po' meno: ogni divisione crea 4 nodi fini, tanti disegni
const kOf = (level: number) => (level >= MAX_LEVEL - 1 ? K_FINE : K);
const HYST = 1.15; // isteresi per non oscillare
const MORPH_FROM = 0.7; // il morph inizia (x = 1) e finisce (x = MORPH_FROM) al variare della distanza del padre / (K x taglia padre)
const MAX_NODES = 200;
const BUDGET_MS = 5;

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface QNode {
  key: string;
  face: number;
  level: number;
  i: number;
  j: number;
  center: THREE.Vector3; // direzione (unitaria) del centro
  size: number; // m
  state: 0 | 1 | 2; // 0 non richiesto, 1 in costruzione/coda, 2 pronto
  buf: NodeBuffers | null;
  mesh: THREE.Mesh | null;
  water: THREE.Mesh | null;
  split: boolean;
  lastUsed: number;
  lastM: number;
  m: number; // fattore di morph di questo frame (se e' una foglia mostrata)
  children: QNode[] | null;
  parent: QNode | null;
  dead: boolean; // scaricato mentre un worker lo stava ancora costruendo
}

// Indici dell'acqua: solo la griglia
const WATER_INDEX = new THREE.BufferAttribute(new Uint32Array(NODE_INDEX.slice(0, GRID * GRID * 6)), 1);
const TERRAIN_INDEX = new THREE.BufferAttribute(new Uint32Array(NODE_INDEX), 1);

const makeTerrainGeo = () => {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color', 'aMorphPos', 'aMorphNor', 'aMorphCol']) g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(NODE_VERTS * 3), 3));
  g.setIndex(TERRAIN_INDEX);
  return g;
};
const makeWaterGeo = () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(GRID_VERTS * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(GRID_VERTS * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(GRID_VERTS * 3), 3));
  g.setIndex(WATER_INDEX);
  return g;
};

// (i tipi di 'three/tsl' del progetto non elencano tutto: si usa il modulo come `any`)
const { attribute, mix, normalLocal, positionLocal, transformNormalToView, uniform } = TSL as any;
const _camDir = new THREE.Vector3();

const PlanetQuadtree: React.FC<{ p: SpacePlanet }> = ({ p }) => {
  const group = useRef<THREE.Group>(null);
  const seed = p.profile.seed;
  // Geomorphing sulla GPU: posizione, normale e colore passano dalla forma del nodo a quella del padre (attributi aMorph*, fissi dopo la
  // costruzione) col fattore `userData.morph` di OGNI mesh (uniform per oggetto): niente piu' ricalcolo e caricamento di buffer a frame.
  const terrainMat = useMemo(() => {
    const m: any = new MeshStandardNodeMaterial();
    m.roughness = 0.9;
    m.metalness = 0;
    const morph: any = uniform(0);
    morph.onObjectUpdate(function (this: any, frame: any) {
      this.value = frame.object.userData.morph ?? 0;
    });
    m.positionNode = mix(positionLocal, attribute('aMorphPos', 'vec3'), morph);
    m.normalNode = transformNormalToView(mix(normalLocal, attribute('aMorphNor', 'vec3'), morph).normalize());
    m.colorNode = mix(attribute('color', 'vec3'), attribute('aMorphCol', 'vec3'), morph);
    return m;
  }, []);
  const waterMat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0 }), []);
  const S = useRef({
    roots: [] as QNode[],
    all: new Map<string, QNode>(),
    frame: 0,
    poolGeo: [] as THREE.BufferGeometry[],
    poolWGeo: [] as THREE.BufferGeometry[],
    poolBuf: [] as NodeBuffers[],
    queue: [] as QNode[],
    inflight: 0,
    job: null as null | { node: QNode; gen: Generator<void, void, void> },
    shown: [] as QNode[],
    camLocal: new THREE.Vector3(),
    qi: new THREE.Quaternion(),
    tmp: new THREE.Vector3(),
  });

  const make = (parent: QNode | null, face: number, level: number, i: number, j: number): QNode => {
    const key = `${face}:${level}:${i}:${j}`;
    const T = 1 << level;
    const c = faceDir(face, (i + 0.5) / T, (j + 0.5) / T, new THREE.Vector3());
    const n: QNode = { key, face, level, i, j, center: c, size: nodeSize(level), state: 0, buf: null, mesh: null, water: null, split: false, lastUsed: 0, lastM: -1, m: 0, children: null, parent, dead: false };
    S.current.all.set(key, n);
    return n;
  };

  const request = (n: QNode) => {
    if (n.state !== 0) return;
    n.state = 1;
    S.current.queue.push(n);
  };

  const finish = (n: QNode) => {
    const st = S.current;
    const buf = n.buf!;
    const geo = st.poolGeo.pop() ?? makeTerrainGeo();
    const mesh = new THREE.Mesh(geo, terrainMat);
    mesh.frustumCulled = true;
    mesh.receiveShadow = true;
    mesh.visible = false;
    (geo.attributes.position.array as Float32Array).set(buf.pos);
    (geo.attributes.normal.array as Float32Array).set(buf.nor);
    (geo.attributes.color.array as Float32Array).set(buf.col);
    (geo.attributes.aMorphPos.array as Float32Array).set(buf.mpos);
    (geo.attributes.aMorphNor.array as Float32Array).set(buf.mnor);
    (geo.attributes.aMorphCol.array as Float32Array).set(buf.mcol);
    for (const a of ['position', 'normal', 'color', 'aMorphPos', 'aMorphNor', 'aMorphCol']) geo.attributes[a].needsUpdate = true;
    mesh.userData.morph = 1; // (finche' non e' mostrato non importa)
    // sfera di contorno a mano (cosi' il frustum culling non dipende dal morph): centro sul pianeta, raggio = taglia + rilievo
    geo.boundingSphere = new THREE.Sphere(n.center.clone().multiplyScalar(R), n.size * 0.8 + 500);
    n.mesh = mesh;
    group.current?.add(mesh);
    if (buf.hasWater) {
      const wgeo = st.poolWGeo.pop() ?? makeWaterGeo();
      (wgeo.attributes.position.array as Float32Array).set(buf.wpos);
      (wgeo.attributes.color.array as Float32Array).set(buf.wcol);
      const nor = wgeo.attributes.normal.array as Float32Array;
      for (let k = 0; k < GRID_VERTS * 3; k++) nor[k] = buf.wpos[k] / (R + 0.05);
      for (const a of ['position', 'normal', 'color']) wgeo.attributes[a].needsUpdate = true;
      wgeo.boundingSphere = geo.boundingSphere.clone();
      const wm = new THREE.Mesh(wgeo, waterMat);
      wm.visible = false;
      n.water = wm;
      group.current?.add(wm);
    }
    // (i buffer restano al nodo: servono al geomorphing; tornano al pool quando il nodo viene scaricato)
    n.state = 2;
    n.lastM = -1;
  };

  const evict = (n: QNode) => {
    const st = S.current;
    n.dead = true;
    if (n.state === 1 && st.job && st.job.node === n) st.job = null;
    if (n.mesh) {
      group.current?.remove(n.mesh);
      st.poolGeo.push(n.mesh.geometry);
    }
    if (n.water) {
      group.current?.remove(n.water);
      st.poolWGeo.push(n.water.geometry);
    }
    if (n.buf) st.poolBuf.push(n.buf);
    n.buf = null;
    st.all.delete(n.key);
    st.queue = st.queue.filter((q) => q !== n);
  };

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const st = S.current;
    g.position.set(p.center[0], p.center[1], p.center[2]);
    g.quaternion.copy(siteFrame.quat);
    st.qi.copy(siteFrame.quat).invert();
    st.camLocal.set(state.camera.position.x - p.center[0], state.camera.position.y - p.center[1], state.camera.position.z - p.center[2]).applyQuaternion(st.qi);
    const dist = st.camLocal.length();
    const alt = dist - R;
    if (alt > ACTIVE_ALT) {
      g.visible = false;
      return;
    }
    g.visible = true;
    st.frame++;
    const cam = st.camLocal;

    if (st.roots.length === 0) {
      for (let f = 0; f < 6; f++) st.roots.push(make(null, f, 0, 0, 0));
    }

    // --- selezione dei nodi da mostrare ---
    const shown: QNode[] = [];
    const tmp = st.tmp;
    const distTo = (n: QNode) => {
      tmp.copy(n.center).multiplyScalar(R);
      return Math.max(0, tmp.distanceTo(cam) - 0.75 * n.size);
    };
    // orizzonte: i nodi oltre la curvatura del pianeta (dietro l'orizzonte della camera) non si disegnano ne' si dividono
    const camLen = cam.length();
    const camDir = _camDir.copy(cam).divideScalar(camLen || 1);
    const horizon = camLen > R ? Math.acos(Math.min(1, R / camLen)) : Math.PI / 2;
    const visit = (n: QNode, parentDist: number, parentSize: number) => {
      n.lastUsed = st.frame;
      const ang = Math.acos(Math.min(1, Math.max(-1, camDir.dot(n.center))));
      if (ang > horizon + (0.75 * n.size + 500) / R + 0.02) return; // dietro l'orizzonte
      const d = distTo(n);
      const thr = kOf(n.level) * n.size * (n.split ? HYST : 1);
      if (n.level < MAX_LEVEL && d < thr) {
        n.split = true;
        if (!n.children) {
          const T2 = 2;
          n.children = [];
          for (let cj = 0; cj < T2; cj++) for (let ci = 0; ci < T2; ci++) n.children.push(make(n, n.face, n.level + 1, n.i * 2 + ci, n.j * 2 + cj));
        }
        let ready = true;
        for (const c of n.children) {
          if (c.state === 0) request(c);
          if (c.state !== 2) ready = false;
        }
        if (ready) {
          for (const c of n.children) visit(c, d, n.size);
          return;
        }
      } else n.split = false;
      if (n.state !== 2) return;
      // foglia: va mostrata. Fattore di morph dalla distanza del PADRE (alla divisione del padre vale 1: forma del padre)
      let m = 0;
      if (n.level > 0) {
        const x = parentDist / (kOf(n.level - 1) * parentSize);
        m = smooth(MORPH_FROM, 1, Math.min(1.2, x));
      }
      n.m = m;
      shown.push(n);
    };
    for (const r of st.roots) {
      if (r.state === 0) request(r);
      visit(r, 0, 0);
    }
    // visibilita'
    for (const n of st.shown) {
      if (n.mesh) n.mesh.visible = false;
      if (n.water) n.water.visible = false;
    }
    for (const n of shown) {
      if (n.mesh) n.mesh.visible = true;
      if (n.water) n.water.visible = true;
    }
    st.shown = shown;

    // --- geomorphing: posizione, normale e colore tra la forma del nodo e quella del padre ---
    for (const n of shown) if (n.mesh) n.mesh.userData.morph = n.m;

    // --- costruzione dei nodi richiesti, il piu' vicino per primo ---
    const useWorkers = workersAvailable();
    const nearestQueued = (): QNode | null => {
      let best: QNode | null = null;
      let bd = Infinity;
      for (const q of st.queue) {
        const d = distTo(q) - q.level; // (a parita' di distanza prima i livelli piu' fini)
        if (d < bd) {
          bd = d;
          best = q;
        }
      }
      return best;
    };
    if (useWorkers) {
      // nei worker (workers/planetWorker.ts): il calcolo non occupa il thread principale
      const cap = workerCapacity();
      while (st.inflight < cap && st.queue.length > 0) {
        const node = nearestQueued();
        if (!node) break;
        st.queue = st.queue.filter((q) => q !== node);
        st.inflight++;
        requestNode(node.face, node.level, node.i, node.j, seed, p.profile.gridRadius)
          .then((buf) => {
            st.inflight--;
            if (node.dead) return; // nel frattempo scaricato
            node.buf = buf;
            finish(node);
          })
          .catch(() => {
            st.inflight--;
            if (!node.dead) node.state = 0; // si riprovera'
          });
      }
    } else {
      // senza worker: a pezzetti nel thread principale
      if (!st.job) {
        const best = nearestQueued();
        if (best) {
          st.queue = st.queue.filter((q) => q !== best);
          best.buf = st.poolBuf.pop() ?? makeNodeBuffers();
          st.job = { node: best, gen: buildNodeMesh(best.face, best.level, best.i, best.j, seed, best.buf) };
        }
      }
      if (st.job) {
        const r = st.job.gen.next();
        if (r.done) {
          finish(st.job.node);
          st.job = null;
        }
      }
    }

    // --- eviction: i figli (tutti e 4 insieme) non usati da un po' ---
    if (st.all.size > MAX_NODES && st.frame % 30 === 0) {
      const parents = [...st.all.values()].filter((n) => n.children && n.children.every((c) => c.lastUsed < st.frame - 240 && !c.children && c.state !== 1));
      parents.sort((a, b) => a.children![0].lastUsed - b.children![0].lastUsed);
      let over = st.all.size - MAX_NODES;
      for (const pn of parents) {
        if (over <= 0) break;
        for (const c of pn.children!) evict(c);
        pn.children = null;
        pn.split = false;
        over -= 4;
      }
    }
  });

  // geomorphing sulla CPU: solo per i nodi mostrati il cui fattore e' cambiato abbastanza
  return <group ref={group} visible={false} dispose={null} />;
};

export default PlanetQuadtree;
