import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { mergeBufferGeometries } from 'three-stdlib';
import * as THREE from 'three';
import { farCars } from './vehicleRegistry';

// Le auto lontane (vedi CAR_LOD_DIST in Car.tsx) disegnate in blocco: il
// modello dell'auto fuso in un'unica geometria per materiale (carrozzeria +
// portiere, ruote) e un InstancedMesh per ciascuno. Tutte le auto lontane
// = 2 draw call invece di 9 a testa. Da lontano portiere e ruote ferme non
// si notano.

const PARTS = /^(body|door_\d|wheel.*|Cylinder001)$/;
const MAX_FAR_CARS = 64;

const FarCars: React.FC = () => {
  const { scene } = useGLTF('car.glb');
  const batches = useMemo(() => {
    scene.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(scene.matrixWorld).invert();
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !PARTS.test(m.name)) return;
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      const g = m.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      for (const key of Object.keys(g.attributes)) {
        if (!['position', 'normal', 'uv'].includes(key)) g.deleteAttribute(key);
      }
      let arr = byMat.get(mat);
      if (!arr) byMat.set(mat, (arr = []));
      arr.push(g.index ? g.toNonIndexed() : g);
    });
    return [...byMat.entries()]
      .map(([mat, geos]) => ({ mat, geo: mergeBufferGeometries(geos) }))
      .filter((b): b is { mat: THREE.Material; geo: THREE.BufferGeometry } => !!b.geo);
  }, [scene]);

  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  useFrame(() => {
    let n = 0;
    for (const obj of farCars.values()) {
      if (n >= MAX_FAR_CARS) break;
      for (const m of meshes.current) m?.setMatrixAt(n, obj.matrixWorld);
      n++;
    }
    for (const m of meshes.current) {
      if (!m) continue;
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      {batches.map((b, i) => (
        <instancedMesh
          key={i}
          name="far-cars"
          ref={(m) => {
            meshes.current[i] = m;
          }}
          args={[b.geo, b.mat, MAX_FAR_CARS]}
          castShadow
          receiveShadow
          frustumCulled={false}
        />
      ))}
    </>
  );
};

export default FarCars;
