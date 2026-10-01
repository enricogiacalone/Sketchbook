import React, { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useStaticBoxes, type StaticBox } from './staticColliders';

// "Modelli semplificati da lontano": i palazzi fuori dalla zona caricata
// attorno al giocatore sono UNA scatola ciascuno, tutte in poche draw call
// (InstancedMesh per cella di 120 m). Finestre, zoccolo scuro al piano
// terra e reticolo delle torri di vetro sono disegnati dallo shader alle
// stesse posizioni del palazzo vero (stessa spaziatura 3.4 m, stesse
// quote dei piani), cosi' quando il palazzo dettagliato prende il suo posto
// lo scambio quasi non si vede. Fisica: un solo parallelepipedo per palazzo.

export interface FarBuildingItem {
  key: string;
  x: number; // centro della base
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  color: string;
  kind: 0 | 1 | 2; // 0 finestre (moderno/mattoni), 1 vetro, 2 liscio (annessi, terrazzi)
  countW: number;
  countD: number;
  floorHeight: number;
  numFloors: number;
  roughness: number;
  metalness: number;
  plinth: string;
  seed: number;
  collider: boolean;
}

const _geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

const _material = (() => {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, metalness: 0.25 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aParams;
attribute vec4 aParams2;
attribute vec3 aPlinth;
varying vec4 vParams;
varying vec4 vParams2;
varying vec3 vPlinth;
varying vec3 vLocalPos;
varying vec3 vLocalNormal;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vec3 bScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
vLocalPos = position * bScale;
vLocalNormal = normal;
vParams = aParams;
vParams2 = aParams2;
vPlinth = aPlinth;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec4 vParams;
varying vec4 vParams2;
varying vec3 vPlinth;
varying vec3 vLocalPos;
varying vec3 vLocalNormal;
float fbHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec3 fbEmissive = vec3(0.0);
{
  float kind = vParams.w;
  float y = vLocalPos.y;
  bool side = abs(vLocalNormal.y) < 0.5;
  if (side && kind < 1.5 && y < 3.2) diffuseColor.rgb = vPlinth;
  if (side && kind < 0.5) {
    bool faceZ = abs(vLocalNormal.z) > 0.5;
    float u = faceZ ? vLocalPos.x : vLocalPos.z;
    float count = faceZ ? vParams.x : vParams.y;
    float fh = vParams.z;
    float c = clamp(floor(u / 3.4 + (count - 1.0) * 0.5 + 0.5), 0.0, count - 1.0);
    float cx = (c - (count - 1.0) * 0.5) * 3.4;
    float f = floor(y / fh);
    float cy = (f + 0.5) * fh;
    if (f >= 1.0 && f < vParams2.x && abs(u - cx) < 0.65 && abs(y - cy) < 0.95) {
      float faceId = faceZ ? (vLocalNormal.z > 0.0 ? 1.0 : 2.0) : (vLocalNormal.x > 0.0 ? 3.0 : 4.0);
      float lit = step(0.65, fbHash(vec3(c, f, faceId + vParams2.w)));
      vec3 warm = mix(vec3(1.0, 0.86, 0.55), vec3(1.0, 0.70, 0.48), fbHash(vec3(f, c, faceId)));
      vec3 glassDark = mix(diffuseColor.rgb, vec3(0.075, 0.105, 0.14), 0.8);
      diffuseColor.rgb = mix(glassDark, warm * 0.6, lit);
      fbEmissive = warm * 0.55 * lit;
    }
  }
  if (side && kind > 0.5 && kind < 1.5) {
    // torre di vetro: reticolo dei montanti (piani e moduli da 3.4 m)
    float u = abs(vLocalNormal.z) > 0.5 ? vLocalPos.x : vLocalPos.z;
    float gx = abs(fract(u / 3.4 + 0.5) - 0.5) * 3.4;
    float gy = abs(fract(y / vParams.z + 0.5) - 0.5) * vParams.z;
    if (gx < 0.06 || gy < 0.06) { diffuseColor.rgb *= 0.35; fbEmissive = vec3(0.02, 0.06, 0.08); }
  }
}`
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
roughnessFactor = vParams2.y;
metalnessFactor = vParams2.z;`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += fbEmissive;`
      );
  };
  m.customProgramCacheKey = () => 'far-buildings-v1';
  return m;
})();

const _o = new THREE.Object3D();
const _c = new THREE.Color();

const FarChunk: React.FC<{ items: FarBuildingItem[] }> = ({ items }) => {
  const ref = useRef<THREE.InstancedMesh>(null);
  const attrs = useMemo(() => {
    const n = items.length;
    const p = new Float32Array(n * 4);
    const p2 = new Float32Array(n * 4);
    const pl = new Float32Array(n * 3);
    items.forEach((it, i) => {
      p.set([it.countW, it.countD, it.floorHeight, it.kind], i * 4);
      p2.set([it.numFloors, it.roughness, it.metalness, it.seed], i * 4);
      _c.set(it.plinth).convertSRGBToLinear();
      pl.set([_c.r, _c.g, _c.b], i * 3);
    });
    return {
      aParams: new THREE.InstancedBufferAttribute(p, 4),
      aParams2: new THREE.InstancedBufferAttribute(p2, 4),
      aPlinth: new THREE.InstancedBufferAttribute(pl, 3),
    };
  }, [items]);
  // geometria propria per cella (gli attributi d'istanza stanno sulla geometria)
  const geo = useMemo(() => {
    const g = _geo.clone();
    g.setAttribute('aParams', attrs.aParams);
    g.setAttribute('aParams2', attrs.aParams2);
    g.setAttribute('aPlinth', attrs.aPlinth);
    return g;
  }, [attrs]);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    items.forEach((it, i) => {
      _o.position.set(it.x, it.y, it.z);
      _o.rotation.set(0, 0, 0);
      _o.scale.set(it.w, it.h, it.d);
      _o.updateMatrix();
      m.setMatrixAt(i, _o.matrix);
      m.setColorAt(i, _c.set(it.color));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    m.computeBoundingBox();
  }, [items, geo]);
  useLayoutEffect(() => () => geo.dispose(), [geo]);
  return <instancedMesh ref={ref} args={[geo, _material, items.length]} castShadow receiveShadow />;
};

// un collider (scatola piena) per palazzo lontano, ciascuno nel suo corpo:
// entrare/uscire dalla zona caricata aggiunge/toglie solo quello
const FarCollider: React.FC<{ it: FarBuildingItem; groups: number }> = ({ it, groups }) => {
  const boxes = useMemo<StaticBox[]>(() => [{ half: [it.w / 2, it.h / 2, it.d / 2], pos: [0, it.h / 2, 0], groups }], [it, groups]);
  useStaticBoxes([it.x, it.y, it.z], boxes);
  return null;
};

export const FarBuildings: React.FC<{ items: FarBuildingItem[]; colliderGroups: number }> = ({ items, colliderGroups }) => {
  const chunks = useMemo(() => {
    const map = new Map<string, FarBuildingItem[]>();
    for (const it of items) {
      const k = `${Math.floor((it.x + 60) / 120)},${Math.floor((it.z + 60) / 120)}`;
      let arr = map.get(k);
      if (!arr) map.set(k, (arr = []));
      arr.push(it);
    }
    return [...map.entries()];
  }, [items]);
  return (
    <>
      {chunks.map(([k, arr]) => (
        <FarChunk key={`${k}:${arr.map((a) => a.key).join(',')}`} items={arr} />
      ))}
      {items
        .filter((it) => it.collider)
        .map((it) => (
          <FarCollider key={it.key} it={it} groups={colliderGroups} />
        ))}
    </>
  );
};

export default FarBuildings;
