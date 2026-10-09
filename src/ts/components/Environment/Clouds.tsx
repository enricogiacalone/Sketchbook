import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
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

const CLOUD_COUNT = 40;
const PUFFS_PER_CLOUD = 6;
const TOTAL = CLOUD_COUNT * PUFFS_PER_CLOUD;
const SPREAD = 800;
const WRAP = 500;
const BASE_HEIGHT = 150;
const HEIGHT_VARIATION = 100;

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

  const clouds = useMemo(() => {
    const data = [];
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const position = new THREE.Vector3(
        (Math.random() - 0.5) * SPREAD,
        BASE_HEIGHT + (Math.random() - 0.5) * HEIGHT_VARIATION,
        (Math.random() - 0.5) * SPREAD
      );
      const size = 50 + Math.random() * 100;
      const driftSpeed = (Math.random() - 0.5) * 2;
      const puffs = [];
      for (let j = 0; j < PUFFS_PER_CLOUD; j++) {
        const offset = new THREE.Vector3(
          (Math.random() - 0.5) * size * 0.9,
          (Math.random() - 0.5) * size * 0.25,
          (Math.random() - 0.5) * size * 0.9
        );
        puffs.push({
          offset,
          angle: Math.random() * Math.PI * 2,
          // come gear: rotazione lenta, verso casuale
          spin: (Math.random() < 0.5 ? -1 : 1) * (0.01 + Math.random() * 0.03),
          scale: (0.7 + Math.random() * 0.5) * size,
          // base della nuvola in ombra
          shade: THREE.MathUtils.lerp(0.78, 1, (offset.y / (size * 0.25)) + 0.5),
        });
      }
      data.push({ position, puffs, driftSpeed });
    }
    return data;
  }, []);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    let i = 0;
    for (const c of clouds) for (const p of c.puffs) mesh.setColorAt(i++, _tint.setScalar(p.shade));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [clouds]);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = state.clock.elapsedTime;
    const cam = state.camera.position;

    // colore col ciclo giorno/notte
    const sun = getSunDirection(t);
    const day = getDayFactor(sun.y);
    const warmth = getWarmth(sun.y);
    _tint.copy(DAY_COLOR).lerp(SUNSET_COLOR, warmth * 0.8);
    material.color.copy(NIGHT_COLOR).lerp(_tint, day);

    let i = 0;
    for (const cloud of clouds) {
      cloud.position.x += cloud.driftSpeed * delta;
      if (cloud.position.x > WRAP) cloud.position.x = -WRAP;
      if (cloud.position.x < -WRAP) cloud.position.x = WRAP;
      for (const p of cloud.puffs) {
        _pos.copy(cloud.position).add(p.offset);
        // verso la camera tenendo l'alto del mondo (gear, modo 6)
        _look.subVectors(cam, _pos);
        if (_look.lengthSq() < 1e-6) _look.set(0, 0, 1);
        _look.normalize();
        _right.crossVectors(_up, _look);
        if (_right.lengthSq() < 1e-8) _right.set(1, 0, 0);
        _right.normalize();
        _vUp.crossVectors(_look, _right);
        _basis.makeBasis(_right, _vUp, _look);
        _spin.makeRotationZ(p.angle + t * p.spin);
        _scale.makeScale(p.scale, p.scale, 1);
        _m.copy(_basis).multiply(_spin).multiply(_scale).setPosition(_pos);
        mesh.setMatrixAt(i++, _m);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, material, TOTAL]} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
    </instancedMesh>
  );
};

export default Clouds;
