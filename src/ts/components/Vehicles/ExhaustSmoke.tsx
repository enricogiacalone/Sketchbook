import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import * as WEBGPU from 'three/webgpu';
import * as TSL from 'three/tsl';

// i tipi di @types/three installati non hanno ancora questi nodi (ci sono a
// runtime in three 0.186): stessi errori di tipo di Ocean.tsx/RealGrass.tsx
const { Sprite, SpriteNodeMaterial } = WEBGPU as any;
const { color, mix, range, rotateUV, texture, time, uniform, uv } = TSL as any;

// "puoi estrarre il fumo del tubo di scappamento dell'auto da qui?
// (threejs-conference) vorrei averlo uguale": stesso emettitore di
// src/world/effects/createSmoke.js di quel progetto -- sprite instanziati
// tutti in GPU (TSL), nessun conto per frame in JS: ogni particella ha la
// sua vita, salita, grandezza e rotazione casuali (range()) e il tempo
// (time) le fa nascere e svanire in ciclo. Stessa texture (smoke.png),
// stessi colori, opacita', velocita' e misure; due tubi, 50 particelle
// l'uno.

const SMOKE_TEXTURE_PATH = '/textures/smoke.png';
const EXHAUST_COUNT = 50;
export const EXHAUST_PARAMS = {
  opacity: 0.4,
  scale: 4,
  speed: 0.5,
};

let mapPromise: Promise<THREE.Texture> | null = null;
function loadSmokeMap() {
  if (!mapPromise) {
    mapPromise = new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(
        SMOKE_TEXTURE_PATH,
        (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          resolve(t);
        },
        undefined,
        reject
      );
    });
  }
  return mapPromise;
}

// In quel progetto l'auto e' ferma; qui va in giro e il fumo, essendo
// figlio dell'auto, la seguirebbe come appiccicato. Ogni sbuffo resta
// indietro di quanto l'auto si e' spostata da quando e' nato (velocita'
// dell'auto in coordinate sue x eta' dello sbuffo, fino a DRIFT_MAX_S).
const DRIFT_MAX_S = 1.2;

function createExhaustEmitter(map: THREE.Texture, drift: any) {
  const offsetMin = new THREE.Vector3(-0.08, 0.02, -0.04);
  const offsetMax = new THREE.Vector3(0.08, 0.35, 0.04);
  const lifeRange = range(0.1, 1);
  const offsetRange = range(offsetMin, offsetMax);
  const scaleRange = range(0.12, 0.42);
  const rotateRange = range(0.1, 4);

  const speedUniform = uniform(EXHAUST_PARAMS.speed);
  const opacityUniform = uniform(EXHAUST_PARAMS.opacity);
  const scaledTime = time.add(5).mul(speedUniform);
  const lifeTime = scaledTime.mul(lifeRange).mod(1);
  const life = lifeTime.div(lifeRange);

  const textureNode = texture(map, rotateUV(uv(), scaledTime.mul(rotateRange)));
  const smokeAlpha = textureNode.a.mul(textureNode.r.max(textureNode.g).max(textureNode.b));

  const material = new SpriteNodeMaterial();
  material.colorNode = mix(color(0x9a9890), color(0x4a4845), life.mul(0.85));
  material.opacityNode = smokeAlpha.mul(life.oneMinus()).mul(opacityUniform);
  const ageS = lifeTime.div(speedUniform.mul(lifeRange)).min(DRIFT_MAX_S);
  material.positionNode = offsetRange.mul(lifeTime).add(drift.mul(ageS));
  material.scaleNode = scaleRange.mul(lifeTime.max(0.25));
  material.depthWrite = false;
  material.depthTest = true;
  material.alphaTest = 0.05;
  material.transparent = true;
  material.toneMapped = false;

  const sprite = new Sprite(material);
  sprite.scale.setScalar(EXHAUST_PARAMS.scale);
  (sprite as any).count = EXHAUST_COUNT;
  const reach = Math.max(offsetMin.length(), offsetMax.length(), EXHAUST_PARAMS.scale);
  sprite.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, reach * 0.5, 0), reach);
  sprite.frustumCulled = true;
  sprite.renderOrder = 5;
  sprite.name = 'exhaust-smoke';
  const emitter = { sprite, material, speedUniform, opacityUniform };
  if (import.meta.env.DEV) {
    const w = window as any;
    (w.__exhaustEmitters ??= new Set()).add(emitter);
  }
  return emitter;
}

const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

// I tubi, in coordinate dell'auto (+Z avanti). Montato solo a motore acceso.
const ExhaustSmoke: React.FC<{ pipes: [number, number, number][] }> = ({ pipes }) => {
  const [map, setMap] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let alive = true;
    loadSmokeMap()
      .then((m) => alive && setMap(m))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const drift = useMemo(() => uniform(new THREE.Vector3()), []);
  const emitters = useMemo(() => (map ? pipes.map(() => createExhaustEmitter(map, drift)) : []), [map, pipes, drift]);
  const prev = useRef<THREE.Vector3 | null>(null);
  useFrame((_s, dt) => {
    const car = emitters[0]?.sprite.parent;
    if (!car || dt <= 0) return;
    car.getWorldPosition(_p);
    if (!prev.current) prev.current = _p.clone();
    // velocita' dell'auto (m/s) portata nelle coordinate dell'auto, al
    // contrario e divisa per la scala dello sprite (le posizioni del
    // materiale sono in unita' dello sprite)
    _v.subVectors(_p, prev.current).divideScalar(dt);
    _v.y = 0;
    prev.current.copy(_p);
    car.getWorldQuaternion(_q).invert();
    _v.applyQuaternion(_q).multiplyScalar(-1 / EXHAUST_PARAMS.scale);
    // morbido, se no ogni scossone delle sospensioni si vede nel fumo
    drift.value.lerp(_v, Math.min(1, dt * 8));
  });
  useEffect(
    () => () => {
      for (const e of emitters) e.material.dispose();
    },
    [emitters]
  );

  return (
    <>
      {emitters.map((e, i) => (
        <primitive key={i} object={e.sprite} position={pipes[i]} />
      ))}
    </>
  );
};

export default ExhaustSmoke;
