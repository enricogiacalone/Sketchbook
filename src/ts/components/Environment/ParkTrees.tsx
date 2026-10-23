import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { mergeBufferGeometries } from 'three-stdlib';
import { RigidBody, CylinderCollider } from '@react-three/rapier';
import { Tree, TreePreset } from '@dgreenheck/ez-tree';
import * as THREE from 'three';
import { getTerrainHeight } from './Terrain';
import { CollisionGroups, groupsExcluding } from '../../enums/CollisionGroups';
import { StaticInstances, CulledInstances, type InstanceXform } from './StaticInstances';

// Shared ez-tree template generation + a single tree instance renderer --
// factored out of Park.tsx (where this used to be Park-only, as
// useParkTreeTemplates/ParkTree) so City.tsx's green courtyards/plazas can
// place the SAME real trees instead of the placeholder sphere "bushes"
// they had before (see git history / chat: "le aree verdi devono avere la
// vegetazione del parco"). Behavior/tuning is unchanged from the original
// Park-only version -- Park.tsx now just imports this instead of defining
// its own copy.
export interface TreeTemplatePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

export interface TreeTemplate {
  parts: TreeTemplatePart[];
  trunkHeight: number;
}

// Generating an ez-tree procedurally is the expensive part -- always call
// this ONCE per component that needs trees (e.g. once in Park, once in
// City) and pass the resulting templates down, rather than once per tree
// or once per placement site.
// Generati una volta sola per tutta la scena (parco e citta' usano gli
// stessi modelli): ogni albero e' un'istanza di uno di questi.
const templateCache = new Map<number, TreeTemplate[]>();

export const useTreeTemplates = (variationCount: number = 3): TreeTemplate[] => {
  return useMemo(() => {
    const cached = templateCache.get(variationCount);
    if (cached) return cached;
    const templates: TreeTemplate[] = [];

    for (let i = 0; i < variationCount; i++) {
      try {
        const t = new Tree();
        t.generate();

        const parts: TreeTemplatePart[] = [];
        t.traverse((child: THREE.Object3D) => {
          if (child instanceof THREE.Mesh && child.geometry && child.material) {
            parts.push({
              geometry: child.geometry.clone(),
              material: (child.material as THREE.Material).clone(),
            });
          }
        });

        if (parts.length > 0) {
          templates.push({ parts, trunkHeight: 20 });
        }
      } catch (e) {
        console.warn('useTreeTemplates: failed to generate ez-tree template:', e);
      }
    }

    templateCache.set(variationCount, templates);
    return templates;
  }, [variationCount]);
};

// Gli alberi del PIANETA: specie vere (i preset di ez-tree: frassino, pioppo tremulo, quercia, pino), ognuna con due semi,
// invece dello stesso albero di default ripetuto. L'ordine conta: nearTile.ts sceglie la specie con questi indici
// (0-7 latifoglie, 8-11 pini). Generati una volta sola.
export const PLANET_TREE_SPECIES = ['Ash Medium', 'Aspen Medium', 'Oak Medium', 'Oak Large', 'Pine Medium', 'Pine Large'];
let planetTemplates: TreeTemplate[] | null = null;
export const usePlanetTreeTemplates = (): TreeTemplate[] =>
  useMemo(() => {
    if (planetTemplates) return planetTemplates;
    const out: TreeTemplate[] = [];
    const t0 = performance.now();
    for (const name of PLANET_TREE_SPECIES) {
      for (const seed of [11, 29]) {
        try {
          const t = new Tree();
          t.loadPreset(name as keyof typeof TreePreset);
          t.options.seed = seed;
          t.generate();
          const parts: TreeTemplatePart[] = [];
          t.traverse((child: THREE.Object3D) => {
            if (child instanceof THREE.Mesh && child.geometry && child.material) {
              parts.push({ geometry: child.geometry.clone(), material: (child.material as THREE.Material).clone() });
            }
          });
          // le chiome non vanno al nero nell'ombra: un po' di luce propria verde (e il colore un filo piu' vivo)
          for (const part of parts) {
            const mt = part.material as THREE.MeshStandardMaterial;
            if (mt.alphaTest > 0 || mt.transparent) {
              mt.emissive = new THREE.Color(name.startsWith('Pine') ? 0.03 : 0.07, name.startsWith('Pine') ? 0.1 : 0.17, 0.035);
              mt.emissiveIntensity = 1;
              mt.color.multiplyScalar(1.2);
            }
          }
          if (parts.length > 0) out.push({ parts, trunkHeight: 20 });
        } catch (e) {
          console.warn('usePlanetTreeTemplates: albero non generato', name, e);
        }
      }
    }
    planetTemplates = out;
    if (import.meta.env.DEV) console.info(`[alberi] ${out.length} modelli del pianeta in ${Math.round(performance.now() - t0)} ms`);
    return out;
  }, []);

// One tree, placed at absolute WORLD x/z (ground height looked up
// internally via getTerrainHeight, same convention as everything else in
// Environment/) -- not meant to be nested inside another positioned
// <group>, so callers on a locally-offset block (a courtyard/plaza center)
// should add their own block offset into x/z themselves before passing
// them in, same as Park.tsx's own trees already do relative to the park's
// fixed block coordinates.
// Gli alberi si DISEGNANO in blocco (TreeBatches: un InstancedMesh per
// parte del modello e per zona); qui ogni albero si iscrive nel registro e
// tiene solo il suo collider del tronco.
export interface TreeEntry {
  template: TreeTemplate;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scale: number;
  m?: THREE.Matrix4; // matrice gia' pronta (alberi del pianeta: orientati lungo la normale)
  born?: number; // s: se c'e', l'albero cresce appena nato
}
// un registro di alberi disegnati in blocco: quello di default (scena di gioco) e, a parte, quello del pianeta
export interface TreeSource {
  registry: Set<TreeEntry>;
  listeners: Set<() => void>;
  notify: () => void;
}
export const createTreeSource = (): TreeSource => {
  const registry = new Set<TreeEntry>();
  const listeners = new Set<() => void>();
  let pending = false;
  return {
    registry,
    listeners,
    notify: () => {
      if (pending) return;
      pending = true;
      queueMicrotask(() => {
        pending = false;
        listeners.forEach((l) => l());
      });
    },
  };
};
const defaultSource = createTreeSource();
const treeRegistry = defaultSource.registry;
const treeListeners = defaultSource.listeners;
const notifyTrees = defaultSource.notify;

// iscrive molti alberi in blocco (boschi): disegnati da TreeBatches, senza un componente per albero
export function registerTreeEntries(entries: TreeEntry[], source: TreeSource = defaultSource): () => void {
  entries.forEach((e) => source.registry.add(e));
  source.notify();
  return () => {
    entries.forEach((e) => source.registry.delete(e));
    source.notify();
  };
}

export const TreeInstance: React.FC<{
  x: number;
  z: number;
  rotationY: number;
  scale: number;
  template: TreeTemplate;
}> = ({ x, z, rotationY, scale, template }) => {
  const y = getTerrainHeight(x, z);
  const trunkHeight = template.trunkHeight * scale;
  const trunkRadius = 0.4 * scale;

  useEffect(() => {
    const e: TreeEntry = { template, x, y, z, rotationY, scale };
    treeRegistry.add(e);
    notifyTrees();
    return () => {
      treeRegistry.delete(e);
      notifyTrees();
    };
  }, [template, x, y, z, rotationY, scale]);

  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[x, y + trunkHeight / 2, z]}
      collisionGroups={groupsExcluding(CollisionGroups.Default)}
    >
      <CylinderCollider args={[trunkHeight / 2, trunkRadius]} />
    </RigidBody>
  );
};

// raggio della chioma di un albero ez-tree a scala 1 (gli alberi della
// scena sono a scala ~0.22: ~8 m)
const TREE_RADIUS_AT_SCALE_1 = 36;

// Tutti gli alberi iscritti, disegnati in blocco. Montato una volta (Scene).
// "Modelli semplificati da lontano" per gli alberi: un albero ez-tree ha
// ~25k triangoli (rami 22k); oltre TREE_LOD_DIST si disegna al suo posto
// un impostore -- due piani incrociati con la FOTO dell'albero stesso,
// fatta una volta al caricamento (render su texture con sfondo trasparente).
// 4 triangoli invece di 25k, stessa sagoma, stessa ombra (alphaTest).
const TREE_LOD_DIST = 70;

interface TreeImpostor {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  target: THREE.WebGLRenderTarget;
  ready: boolean; // foto fatta con le texture di corteccia e foglie gia' caricate
}

// le texture di ez-tree arrivano in asincrono: la foto va rifatta quando ci sono
const texturesReady = (tpl: TreeTemplate) =>
  tpl.parts.every((p) => {
    const map = (p.material as THREE.MeshPhongMaterial).map;
    const img = map?.image as HTMLImageElement | undefined;
    return !map || (!!img && (img.width ?? 0) > 0);
  });

function renderImpostor(gl: THREE.WebGLRenderer, tpl: TreeTemplate, target: THREE.WebGLRenderTarget | null) {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  for (const p of tpl.parts) group.add(new THREE.Mesh(p.geometry, p.material));
  scene.add(group);
  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(0.4, 1, 0.8);
  scene.add(sun);
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const halfW = Math.max(size.x, size.z) / 2;
  const halfH = size.y / 2;
  const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 1000);
  cam.position.set(center.x, center.y, center.z + 200);
  cam.lookAt(center);
  const rt =
    target ??
    new THREE.WebGLRenderTarget(256, Math.max(64, Math.round((256 * halfH) / halfW)), {
      minFilter: THREE.LinearMipmapLinearFilter,
      generateMipmaps: true,
    });
  const prevTarget = gl.getRenderTarget();
  const prevClear = gl.getClearColor(new THREE.Color());
  const prevAlpha = gl.getClearAlpha();
  gl.setRenderTarget(rt);
  gl.setClearColor(0x000000, 0);
  gl.clear();
  gl.render(scene, cam);
  gl.setRenderTarget(prevTarget);
  gl.setClearColor(prevClear, prevAlpha);
  return { rt, center, halfW, halfH };
}

function bakeTreeImpostor(gl: THREE.WebGLRenderer, tpl: TreeTemplate): TreeImpostor {
  const { rt: target, center, halfW, halfH } = renderImpostor(gl, tpl, null);
  // due piani incrociati, base a terra, come l'albero vero
  const w = halfW * 2,
    h = halfH * 2;
  const a = new THREE.PlaneGeometry(w, h).translate(center.x, center.y, center.z);
  const b = new THREE.PlaneGeometry(w, h).rotateY(Math.PI / 2).translate(center.x, center.y, center.z);
  // WebGPU: la texture di un render target ha la riga 0 in alto, mentre i piani
  // si aspettano v=0 in basso (come in WebGL): senza questo l'albero lontano
  // compare a testa in giu'.
  if ((gl as any).backend?.isWebGPUBackend) {
    for (const g of [a, b]) {
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    }
  }
  const geometry = mergeBufferGeometries([a, b]) ?? a;
  const material = new THREE.MeshLambertMaterial({ map: target.texture, alphaTest: 0.45, side: THREE.DoubleSide });
  return { geometry, material, target, ready: texturesReady(tpl) };
}

// Tutti gli alberi iscritti, disegnati in blocco. Montato una volta (Scene).
export const TreeBatches: React.FC<{ source?: TreeSource; local?: boolean }> = ({ source = defaultSource, local = false }) => {
  const gl = useThree((s) => s.gl);
  // le foto degli alberi si scattano solo a backend WebGPU pronto (l'init e'
  // asincrono: prima .clear()/.render() lanciano e rompono tutto l'albero React)
  const [glReady, setGlReady] = useState(!!(gl as any)._initialized);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const l = () => setVersion((v) => v + 1);
    source.listeners.add(l);
    l();
    return () => {
      source.listeners.delete(l);
    };
  }, [source]);
  const batches = useMemo(() => {
    const byTemplate = new Map<TreeTemplate, InstanceXform[]>();
    source.registry.forEach((e) => {
      let arr = byTemplate.get(e.template);
      if (!arr) byTemplate.set(e.template, (arr = []));
      arr.push({ x: e.x, y: e.y, z: e.z, ry: e.rotationY, s: e.scale, m: e.m, b: e.born });
    });
    return [...byTemplate.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  const impostors = useRef(new Map<TreeTemplate, TreeImpostor>());
  // rifa le foto scattate prima che le texture fossero pronte
  const retry = useRef(0);
  useFrame((_s, dt) => {
    if (!glReady) {
      if ((gl as any)._initialized) setGlReady(true);
      return;
    }
    retry.current += dt;
    if (retry.current < 0.5) return;
    retry.current = 0;
    impostors.current.forEach((imp, tpl) => {
      if (imp.ready || !texturesReady(tpl)) return;
      renderImpostor(gl, tpl, imp.target);
      imp.ready = true;
    });
  });
  const impostorFor = (tpl: TreeTemplate) => {
    let imp = impostors.current.get(tpl);
    if (!imp) {
      imp = bakeTreeImpostor(gl, tpl);
      impostors.current.set(tpl, imp);
    }
    return imp;
  };
  if (!glReady) return null;
  return (
    <>
      {batches.map(([tpl, items], ti) => {
        const imp = impostorFor(tpl);
        // capacita' a scatti (potenze di 2): aggiungere alberi non ricrea i mesh istanziati (costoso, a ogni tessera caricata)
        const cap = Math.max(256, 2 ** Math.ceil(Math.log2(items.length + 1)));
        return (
          <React.Fragment key={ti}>
            {tpl.parts.map((part, pi) => (
              <CulledInstances
                key={`${pi}-${cap}`}
                capacity={cap}
                name="trees"
                geometry={part.geometry}
                material={part.material}
                items={items}
                radius={TREE_RADIUS_AT_SCALE_1}
                maxDist={TREE_LOD_DIST}
                local={local}
                castShadow
                receiveShadow
              />
            ))}
            <CulledInstances
              key={`imp-${cap}`}
              capacity={cap}
              name="tree-impostors"
              geometry={imp.geometry}
              material={imp.material}
              items={items}
              radius={TREE_RADIUS_AT_SCALE_1}
              minDist={TREE_LOD_DIST}
              maxDist={600}
              local={local}
              castShadow
              receiveShadow
            />
          </React.Fragment>
        );
      })}
    </>
  );
};

// --- Shared Vegetation: Grass + Flowers -----------------------------------
// Same generalization deal as the trees above: this used to be Park-only
// (ParkGrass + an inline flower useMemo/JSX block in Park.tsx). Factored out
// here, parameterized by bounds + an "avoid" list of circular exclusion
// zones (fountain/paths in Park, the monument box in a plaza, etc.), so
// City.tsx's green courtyards/plazas get the same real grass/flowers
// instead of nothing -- see git history / chat: "hai dimenticato l'erba e
// i fiori". Park.tsx now imports these instead of defining its own copies;
// behavior/tuning at Park's own call site is unchanged.

export interface AvoidZone {
  x: number;
  z: number;
  radius: number;
}

// The flat mock-shader instanced grass that used to live here
// (GrassPatch: plane geometry + a one-line sine-wave vertex shader) has
// been replaced everywhere by the real pmndrs-ported grass -- see
// ./RealGrass's RealGrassPatch (used by Park.tsx and, for the courtyards/
// plazas above, City.tsx) and ./GrassMaterial for the shader + full
// attribution chain ("ruba il grass da qui
// https://pmndrs.github.io/examples/grass-shader/ e mettilo nel parco...
// mettilo al posto dell'altro grass"). Flowers below are unchanged.

const DEFAULT_FLOWER_COLORS = ['#ff4444', '#ffff44', '#ff44ff', '#ffffff'];
const _flowerGeo = new THREE.SphereGeometry(0.15, 6, 6);
const _flowerMat = new THREE.MeshStandardMaterial({ color: '#ffffff' });

export const Flowers: React.FC<{
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  count?: number;
  colors?: string[];
  avoid?: AvoidZone[];
}> = ({ minX, maxX, minZ, maxZ, count = 60, colors = DEFAULT_FLOWER_COLORS, avoid = [] }) => {
  const flowers = useMemo(() => {
    const result: Array<{ x: number; z: number; color: string }> = [];
    for (let i = 0; i < count; i++) {
      const x = minX + Math.random() * (maxX - minX);
      const z = minZ + Math.random() * (maxZ - minZ);
      const blocked = avoid.some((a) => Math.hypot(x - a.x, z - a.z) < a.radius);
      if (!blocked) {
        result.push({
          x,
          z,
          color: colors[Math.floor(Math.random() * colors.length)],
        });
      }
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minX, maxX, minZ, maxZ, count, colors, avoid]);

  // tutti i fiori di quest'area in blocco (una draw call per zona)
  const items = useMemo(() => flowers.map((f) => ({ x: f.x, y: getTerrainHeight(f.x, f.z) + 0.2, z: f.z, color: f.color })), [flowers]);
  return <StaticInstances name="flowers" geometry={_flowerGeo} material={_flowerMat} items={items} />;
};
