import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { mergeBufferGeometries } from 'three-stdlib';
import { RigidBody, CylinderCollider } from '@react-three/rapier';
import { Tree } from '@dgreenheck/ez-tree';
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
interface TreeEntry {
  template: TreeTemplate;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scale: number;
}
const treeRegistry = new Set<TreeEntry>();
const treeListeners = new Set<() => void>();
let treeNotifyPending = false;
const notifyTrees = () => {
  if (treeNotifyPending) return;
  treeNotifyPending = true;
  queueMicrotask(() => {
    treeNotifyPending = false;
    treeListeners.forEach((l) => l());
  });
};

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
  const geometry = mergeBufferGeometries([a, b]) ?? a;
  const material = new THREE.MeshLambertMaterial({ map: target.texture, alphaTest: 0.45, side: THREE.DoubleSide });
  return { geometry, material, target, ready: texturesReady(tpl) };
}

// Tutti gli alberi iscritti, disegnati in blocco. Montato una volta (Scene).
export const TreeBatches: React.FC = () => {
  const gl = useThree((s) => s.gl);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const l = () => setVersion((v) => v + 1);
    treeListeners.add(l);
    l();
    return () => {
      treeListeners.delete(l);
    };
  }, []);
  const batches = useMemo(() => {
    const byTemplate = new Map<TreeTemplate, InstanceXform[]>();
    treeRegistry.forEach((e) => {
      let arr = byTemplate.get(e.template);
      if (!arr) byTemplate.set(e.template, (arr = []));
      arr.push({ x: e.x, y: e.y, z: e.z, ry: e.rotationY, s: e.scale });
    });
    return [...byTemplate.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  const impostors = useRef(new Map<TreeTemplate, TreeImpostor>());
  // rifa le foto scattate prima che le texture fossero pronte
  const retry = useRef(0);
  useFrame((_s, dt) => {
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
  return (
    <>
      {batches.map(([tpl, items], ti) => {
        const imp = impostorFor(tpl);
        return (
          <React.Fragment key={ti}>
            {tpl.parts.map((part, pi) => (
              <CulledInstances
                key={`${pi}-${items.length}`}
                name="trees"
                geometry={part.geometry}
                material={part.material}
                items={items}
                radius={TREE_RADIUS_AT_SCALE_1}
                maxDist={TREE_LOD_DIST}
                castShadow
                receiveShadow
              />
            ))}
            <CulledInstances
              key={`imp-${items.length}`}
              name="tree-impostors"
              geometry={imp.geometry}
              material={imp.material}
              items={items}
              radius={TREE_RADIUS_AT_SCALE_1}
              minDist={TREE_LOD_DIST}
              maxDist={600}
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
