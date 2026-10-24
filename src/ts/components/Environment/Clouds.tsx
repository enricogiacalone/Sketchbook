import React, { useRef, useMemo, useEffect } from 'react';
import { weather } from '../../lib/weather';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getPlanetStyle } from '../../lib/planet';
import { getCurrentSite } from '../../lib/site';
import { noise3 } from '../../lib/planetSurface';
import { cellDir, cellOf, hashKey, localFromDir, makeCell } from '../../lib/globalGrid';
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
const ALT_SEA = 300; // m sul livello del mare
const HEIGHT_VARIATION = 140;
const R_PLANET = 3000;

const fadeS = (t: number) => t * t * (3 - 2 * t);

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
const _greyCloud = new THREE.Color('#6f747a');
const _tint = new THREE.Color();
const _axis = new THREE.Vector3();
const _qw = new THREE.Quaternion();
const _qwi = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _dl = new THREE.Vector3();
const _dc = new THREE.Vector3();
const _pos0 = new THREE.Vector3();
const _cell = makeCell();
const _seen = new Set<number>();

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
    // meteo: nuvole grigie con pioggia e nebbia (lib/weather.ts)
    if (weather.grey > 0.01) material.color.lerp(_greyCloud, weather.grey * 0.75 * (0.3 + 0.7 * day));

    // le nuvole stanno sul PIANETA (celle lat/lon, lib/globalGrid.ts) e scorrono col vento (rotazione del pianeta intorno a
    // un asse orizzontale dal seme): la stessa nuvola e' sempre nello stesso punto, qualunque sito sia montato
    const site = getCurrentSite();
    const seed = site.planetSeed | 0;
    const ax = hashKey(1, 1, seed) - 0.5, ay = hashKey(2, 1, seed) * 0.4 - 0.2, az = hashKey(3, 1, seed) - 0.5;
    _axis.set(ax, ay, az).normalize();
    const omega = (4 + hashKey(4, 1, seed) * 8) / R_PLANET; // rad/s (4-12 m/s)
    _qw.setFromAxisAngle(_axis, omega * t);
    _qwi.copy(_qw).invert();
    _qi.copy(site.quat).invert();
    const cloudiness = getPlanetStyle().cloudiness;
    const cy0 = R_PLANET + site.hN;

    let i = 0;
    _seen.clear();
    const step = CELL / 2;
    for (let gz = -RING * CELL; gz <= RING * CELL; gz += step) {
      for (let gx = -RING * CELL; gx <= RING * CELL; gx += step) {
        // direzione del pianeta sotto questo punto (nel riferimento del vento)
        _dl.set(cam.x + gx, cy0 + ALT_SEA, cam.z + gz).normalize().applyQuaternion(_qi).applyQuaternion(_qwi);
        cellOf(_dl.x, _dl.y, _dl.z, CELL, _cell);
        if (_seen.has(_cell.key)) continue;
        _seen.add(_cell.key);
        const k = _cell.key;
        const cov = noise3((_dl.x * R_PLANET) / 1500 + 3.1, (_dl.y * R_PLANET) / 1500, (_dl.z * R_PLANET) / 1500 + 7.7, seed + 12);
        const chance = Math.min(0.95, cloudiness * 0.34 * (0.15 + 1.7 * cov));
        if (hashKey(k, 1, seed) > chance) continue;
        cellDir(_cell, CELL, hashKey(k, 2, seed), hashKey(k, 3, seed), _dc);
        _dc.applyQuaternion(_qw); // dal riferimento del vento a quello del pianeta
        const alt = ALT_SEA + (hashKey(k, 5, seed) - 0.5) * HEIGHT_VARIATION;
        localFromDir(site, _dc, R_PLANET + alt, _pos0);
        const dist = Math.hypot(_pos0.x - cam.x, _pos0.z - cam.z);
        const fade = 1 - fadeS(Math.min(1, Math.max(0, (dist - FADE_FROM) / (FADE_TO - FADE_FROM))));
        if (fade <= 0.01) continue;
        const size = 70 + hashKey(k, 4, seed) * 120;
        for (let j = 0; j < PUFFS_PER_CLOUD; j++) {
          const ox = (hashKey(k, 10 + j, seed) - 0.5) * size * 0.9;
          const oy = (hashKey(k, 20 + j, seed) - 0.5) * size * 0.25;
          const oz = (hashKey(k, 30 + j, seed) - 0.5) * size * 0.9;
          const sc = (0.7 + hashKey(k, 40 + j, seed) * 0.5) * size * fade;
          const spin = (hashKey(k, 50 + j, seed) < 0.5 ? -1 : 1) * (0.01 + hashKey(k, 60 + j, seed) * 0.03);
          const angle = hashKey(k, 70 + j, seed) * Math.PI * 2;
          _pos.set(_pos0.x + ox, _pos0.y + oy, _pos0.z + oz);
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
