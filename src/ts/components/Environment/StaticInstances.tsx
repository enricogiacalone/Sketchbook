import React, { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

// "Disegnare in blocco": tanti oggetti uguali e fermi (strisce pedonali,
// lampioni, semafori, fiori, alberi...) in UNA draw call per zona invece di
// una mesh ciascuno. Gli oggetti sono raggruppati in celle di `chunk` metri:
// ogni cella e' un InstancedMesh col suo bounding sphere, cosi' le celle
// fuori dall'inquadratura (e dall'ombra) non si disegnano proprio.

export interface InstanceXform {
  x: number;
  y: number;
  z: number;
  rx?: number;
  ry?: number;
  rz?: number;
  s?: number; // scala uniforme
  sx?: number;
  sy?: number;
  sz?: number;
  color?: THREE.ColorRepresentation;
  m?: THREE.Matrix4; // matrice gia' pronta (ha la precedenza sul resto)
  b?: number; // nascita (s, performance.now()/1000): l'istanza cresce da 0 a piena in GROW_S secondi
}

interface Props {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  items: InstanceXform[];
  castShadow?: boolean;
  receiveShadow?: boolean;
  chunk?: number;
  name?: string;
}

const _o = new THREE.Object3D();
const _c = new THREE.Color();

const ChunkMesh: React.FC<Omit<Props, 'chunk'>> = ({ geometry, material, items, castShadow, receiveShadow, name }) => {
  const ref = useRef<THREE.InstancedMesh>(null);
  const hasColor = items.some((i) => i.color !== undefined);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    items.forEach((it, i) => {
      if (it.m) {
        m.setMatrixAt(i, it.m);
      } else {
        _o.position.set(it.x, it.y, it.z);
        _o.rotation.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0);
        const s = it.s ?? 1;
        _o.scale.set(it.sx ?? s, it.sy ?? s, it.sz ?? s);
        _o.updateMatrix();
        m.setMatrixAt(i, _o.matrix);
      }
      if (hasColor) m.setColorAt(i, _c.set(it.color ?? '#ffffff'));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    m.computeBoundingBox();
  }, [items, hasColor]);
  return (
    <instancedMesh
      ref={ref}
      name={name}
      args={[geometry, material as THREE.Material, items.length]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    />
  );
};

export const StaticInstances: React.FC<Props> = ({ items, chunk = 120, ...rest }) => {
  const groups = useMemo(() => {
    const map = new Map<string, InstanceXform[]>();
    for (const it of items) {
      // celle centrate sugli incroci della griglia stradale (multipli di 60 m)
      const k = `${Math.floor((it.x + chunk / 2) / chunk)},${Math.floor((it.z + chunk / 2) / chunk)}`;
      let arr = map.get(k);
      if (!arr) map.set(k, (arr = []));
      arr.push(it);
    }
    return [...map.entries()];
  }, [items, chunk]);
  return (
    <>
      {groups.map(([k, arr]) => (
        // la chiave include il numero di istanze: InstancedMesh ha la
        // capacita' fissata alla creazione
        <ChunkMesh key={`${k}:${arr.length}`} items={arr} {...rest} />
      ))}
    </>
  );
};

export default StaticInstances;

// Variante con culling per istanza (per oggetti pesanti come gli alberi:
// ~25k triangoli l'uno): a ogni frame finiscono nel buffer solo le istanze
// dentro l'inquadratura (con un margine, perche' chi sta appena dietro la
// telecamera proietta ancora l'ombra in vista) ed entro `maxDist`.
const _frustum = new THREE.Frustum();
const _pv = new THREE.Matrix4();
const _sphere = new THREE.Sphere();
const _inv = new THREE.Matrix4();
const _cp = new THREE.Vector3();
const _lv = new THREE.Vector3();
const _gm = new THREE.Matrix4();
const _gv = new THREE.Vector3();
export const GROW_S = 1.6; // s: durata della crescita di un'istanza appena nata

export const CulledInstances: React.FC<{
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  items: InstanceXform[];
  radius: number; // raggio di un'istanza a scala 1
  minDist?: number; // per i livelli di dettaglio: solo oltre questa distanza
  maxDist?: number;
  margin?: number;
  capacity?: number; // capacita' dell'InstancedMesh (fissata alla creazione): se maggiore delle istanze, si puo' crescere senza ricrearlo
  local?: boolean; // le istanze stanno nel riferimento del gruppo padre (pianeta): il culling si fa li', in 3D
  castShadow?: boolean;
  receiveShadow?: boolean;
  name?: string;
}> = ({ geometry, material, items, radius, minDist = 0, maxDist = 260, margin = 18, local = false, capacity, castShadow, receiveShadow, name }) => {
  const ref = useRef<THREE.InstancedMesh>(null);
  const mats = useMemo(
    () =>
      items.map((it) => {
        if (it.m) return { m: it.m, r: radius * Math.max(it.sx ?? it.s ?? 1, it.sy ?? it.s ?? 1, it.sz ?? it.s ?? 1), x: it.x, y: it.y, z: it.z, b: it.b };
        _o.position.set(it.x, it.y, it.z);
        _o.rotation.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0);
        const s = it.s ?? 1;
        _o.scale.set(it.sx ?? s, it.sy ?? s, it.sz ?? s);
        _o.updateMatrix();
        return { m: _o.matrix.clone(), r: radius * Math.max(it.sx ?? s, it.sy ?? s, it.sz ?? s), x: it.x, y: it.y, z: it.z };
      }),
    [items, radius]
  );
  useFrame(({ camera: liveCamera }) => {
    const mesh = ref.current;
    // debug: inquadratura forzata (window.__fixedCam) anche per il culling
    const camera: THREE.Camera = (import.meta.env.DEV && (window as any).__fixedCam) || liveCamera;
    if (!mesh) return;
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    let cx = camera.position.x, cy = 0, cz = camera.position.z;
    if (local) {
      // nel riferimento locale del gruppo (pianeta): il frustum e la camera si portano li'
      _pv.multiply(mesh.matrixWorld);
      _inv.copy(mesh.matrixWorld).invert();
      _cp.copy(camera.position).applyMatrix4(_inv);
      cx = _cp.x;
      cy = _cp.y;
      cz = _cp.z;
    }
    _frustum.setFromProjectionMatrix(_pv);
    let n = 0;
    const nowS = performance.now() / 1000;
    for (const e of mats) {
      const dx = e.x - cx,
        dz = e.z - cz;
      const dy = local ? e.y - cy : 0;
      const d2 = dx * dx + dz * dz + dy * dy;
      if (d2 > maxDist * maxDist || d2 < minDist * minDist) continue;
      if (local) {
        _lv.set(e.x, e.y, e.z).normalize();
        _sphere.center.set(e.x + _lv.x * e.r * 0.5, e.y + _lv.y * e.r * 0.5, e.z + _lv.z * e.r * 0.5);
      } else _sphere.center.set(e.x, e.y + e.r * 0.5, e.z);
      _sphere.radius = e.r + margin;
      if (!_frustum.intersectsSphere(_sphere)) continue;
      const age = e.b === undefined ? GROW_S : nowS - e.b;
      if (age < GROW_S) {
        const x = Math.max(0, age) / GROW_S;
        const g = 1 - (1 - x) * (1 - x) * (1 - x);
        _gm.copy(e.m).scale(_gv.set(g, g, g));
        mesh.setMatrixAt(n++, _gm);
      } else mesh.setMatrixAt(n++, e.m);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh
      ref={ref}
      name={name}
      args={[geometry, material as THREE.Material, Math.max(1, capacity ?? items.length)]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      frustumCulled={false}
    />
  );
};
