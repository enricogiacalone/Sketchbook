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

export const CulledInstances: React.FC<{
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  items: InstanceXform[];
  radius: number; // raggio di un'istanza a scala 1
  minDist?: number; // per i livelli di dettaglio: solo oltre questa distanza
  maxDist?: number;
  margin?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  name?: string;
}> = ({ geometry, material, items, radius, minDist = 0, maxDist = 260, margin = 18, castShadow, receiveShadow, name }) => {
  const ref = useRef<THREE.InstancedMesh>(null);
  const mats = useMemo(
    () =>
      items.map((it) => {
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
    _frustum.setFromProjectionMatrix(_pv);
    const cx = camera.position.x,
      cz = camera.position.z;
    let n = 0;
    for (const e of mats) {
      const dx = e.x - cx,
        dz = e.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > maxDist * maxDist || d2 < minDist * minDist) continue;
      _sphere.center.set(e.x, e.y + e.r * 0.5, e.z);
      _sphere.radius = e.r + margin;
      if (!_frustum.intersectsSphere(_sphere)) continue;
      mesh.setMatrixAt(n++, e.m);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh
      ref={ref}
      name={name}
      args={[geometry, material as THREE.Material, Math.max(1, items.length)]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      frustumCulled={false}
    />
  );
};
