import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getPlanetStyle } from '../../lib/planet';
import { getCurrentSite } from '../../lib/site';
import { spaceState } from '../../lib/space';
import { getSunDirection, getDayFactor, getWarmth } from '../../lib/SunCycle';

// "da qui ruba le nuvole" -- nuvole alla maniera di chasergit/gear
// (https://github.com/chasergit/gear, shaders/sprite.js + js/sprites_list.js):
// ogni nuvola e' un gruppo di sprite con la texture cloud.png (un cumulo
// fotografico 256x256 con alfa), orientati verso la camera tenendo l'asse
// verticale del mondo (modo "quaternion.w == 6" del loro shader: niente
// scatti quando la camera ruota) e che girano lentamente su se stessi
// (loro "rotation.x": angolo = tempo * velocita', segno casuale).
// Texture: public/clouds/cloud.png -- quel repo NON ha licenza (vedi
// public/clouds/PROVENIENZA.txt); se il file manca si torna al vecchio
// sprite sfumato generato a runtime.
//
// In piu' rispetto a prima: colore legato al ciclo giorno/notte (bianche
// di giorno, arancio al tramonto, grigio-blu scure di notte), i puff bassi
// di ogni nuvola un po' piu' scuri (base in ombra), e visibili anche nel
// duello (vedi Scene.tsx).

const CLOUD_URL = '/clouds/cloud.png';

const createFallbackTexture = (): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d')!;
  const g = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.8)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = g;
  context.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
};

// Le nuvole sono procedurali e seguono la camera: lo spazio attorno a lei e' una griglia di celle (CELL m) che
// scorre col vento; ogni cella ha o non ha una nuvola (e forma, quota, dimensione) in funzione solo di (cella,
// seme del pianeta), con una copertura che varia piano da una zona all'altra (zone serene, zone nuvolose).
// Cosi' ci sono nuvole ovunque si atterri e si volino i dintorni, non solo sopra la citta'.
const PUFFS_PER_CLOUD = 6;
const CELL = 200; // m
const RING = 6; // celle per lato attorno alla camera (raggio ~1200 m)
const MAX_CLOUDS = (2 * RING + 1) * (2 * RING + 1);
const TOTAL = MAX_CLOUDS * PUFFS_PER_CLOUD;
const FADE_FROM = 800;
const FADE_TO = 1180;
const BASE_HEIGHT = 170;
const HEIGHT_VARIATION = 120;
const R_PLANET = 3000;

const hash = (a: number, b: number, s: number, k: number) => {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(s, 2147483647) + Math.imul(k, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
const fadeS = (t: number) => t * t * (3 - 2 * t);
// copertura 0..1 che varia piano (rumore a valori 2D a scala di ~6 celle)
const coverage = (iu: number, iv: number, s: number) => {
  const x = iu / 6, y = iv / 6;
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = fadeS(x - xi), v = fadeS(y - yi);
  const c = (dx: number, dy: number) => hash(xi + dx, yi + dy, s, 77);
  return (c(0, 0) * (1 - u) + c(1, 0) * u) * (1 - v) + (c(0, 1) * (1 - u) + c(1, 1) * u) * v;
};

const DAY_COLOR = new THREE.Color(1, 1, 1);
const SUNSET_COLOR = new THREE.Color(1, 0.78, 0.62);
const NIGHT_COLOR = new THREE.Color(0.1, 0.12, 0.18);

const _up = new THREE.Vector3(0, 1, 0);
const _look = new THREE.Vector3();
const _right = new THREE.Vector3();
const _vUp = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _spin = new THREE.Matrix4();
const _scale = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _tint = new THREE.Color();

const Clouds: React.FC = () => {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: createFallbackTexture(),
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        opacity: 0.6,
      }),
    []
  );

  // texture di gear: caricata a parte, cosi' se manca non blocca la scena
  useEffect(() => {
    let alive = true;
    new THREE.TextureLoader().load(
      CLOUD_URL,
      (tex) => {
        if (!alive) return;
        tex.colorSpace = THREE.SRGBColorSpace;
        material.map?.dispose();
        material.map = tex;
        material.opacity = 0.95;
        material.needsUpdate = true;
      },
      undefined,
      () => console.warn('[nuvole] texture non trovata, uso lo sprite sfumato:', CLOUD_URL)
    );
    return () => {
      alive = false;
    };
  }, [material]);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    // nello spazio (lib/space.ts) le nuvole non ci sono
    mesh.visible = spaceState.cloud > 0.01;
    if (!mesh.visible) return;
    material.opacity = 0.95 * spaceState.cloud;
    const t = state.clock.elapsedTime;
    const cam = state.camera.position;

    // colore col ciclo giorno/notte
    const sun = getSunDirection(t);
    const day = getDayFactor(sun.y);
    const warmth = getWarmth(sun.y);
    _tint.copy(DAY_COLOR).lerp(SUNSET_COLOR, warmth * 0.8);
    material.color.copy(NIGHT_COLOR).lerp(_tint, day);

    // vento: dal seme del pianeta (direzione e velocita')
    const seed = getCurrentSite().planetSeed | 0;
    const wa = hash(seed, 1, 5, 9) * Math.PI * 2;
    const ws = 4 + hash(seed, 2, 5, 9) * 8;
    const wx = Math.cos(wa) * ws * t, wz = Math.sin(wa) * ws * t;
    const cloudiness = getPlanetStyle().cloudiness;
    // la camera nello spazio delle nuvole (che scorre col vento)
    const cu = cam.x - wx, cv = cam.z - wz;
    const i0 = Math.floor(cu / CELL), j0 = Math.floor(cv / CELL);

    let i = 0;
    let nc = 0;
    for (let dj = -RING; dj <= RING; dj++) {
      for (let di = -RING; di <= RING; di++) {
        const iu = i0 + di, iv = j0 + dj;
        const presence = hash(iu, iv, seed, 1);
        const chance = Math.min(0.95, cloudiness * 0.34 * (0.15 + 1.7 * coverage(iu, iv, seed)));
        if (presence > chance) continue;
        const cx = (iu + hash(iu, iv, seed, 2)) * CELL + wx;
        const cz = (iv + hash(iu, iv, seed, 3)) * CELL + wz;
        const dist = Math.hypot(cx - cam.x, cz - cam.z);
        const fade = 1 - fadeS(Math.min(1, Math.max(0, (dist - FADE_FROM) / (FADE_TO - FADE_FROM))));
        if (fade <= 0.01) continue;
        const size = 70 + hash(iu, iv, seed, 4) * 120;
        const cy = BASE_HEIGHT + (hash(iu, iv, seed, 5) - 0.5) * HEIGHT_VARIATION - (dist * dist) / (2 * R_PLANET);
        nc++;
        for (let j = 0; j < PUFFS_PER_CLOUD; j++) {
          const ox = (hash(iu, iv, seed, 10 + j) - 0.5) * size * 0.9;
          const oy = (hash(iu, iv, seed, 20 + j) - 0.5) * size * 0.25;
          const oz = (hash(iu, iv, seed, 30 + j) - 0.5) * size * 0.9;
          const sc = (0.7 + hash(iu, iv, seed, 40 + j) * 0.5) * size * fade;
          const spin = (hash(iu, iv, seed, 50 + j) < 0.5 ? -1 : 1) * (0.01 + hash(iu, iv, seed, 60 + j) * 0.03);
          const angle = hash(iu, iv, seed, 70 + j) * Math.PI * 2;
          _pos.set(cx + ox, cy + oy, cz + oz);
          // verso la camera tenendo l'alto del mondo (gear, modo 6)
          _look.subVectors(cam, _pos);
          if (_look.lengthSq() < 1e-6) _look.set(0, 0, 1);
          _look.normalize();
          _right.crossVectors(_up, _look);
          if (_right.lengthSq() < 1e-8) _right.set(1, 0, 0);
          _right.normalize();
          _vUp.crossVectors(_look, _right);
          _basis.makeBasis(_right, _vUp, _look);
          _spin.makeRotationZ(angle + t * spin);
          _scale.makeScale(sc, sc, 1);
          _m.copy(_basis).multiply(_spin).multiply(_scale).setPosition(_pos);
          mesh.setMatrixAt(i, _m);
          // base della nuvola in ombra
          mesh.setColorAt(i, _tint.setScalar(THREE.MathUtils.lerp(0.78, 1, oy / (size * 0.25) + 0.5)));
          i++;
        }
      }
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, material, TOTAL]} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
    </instancedMesh>
  );
};

export default Clouds;
