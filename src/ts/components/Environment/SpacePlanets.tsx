import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { styleFromSeed, usePlanetEpoch } from '../../lib/planet';
import { PLANET_RADIUS, seaColor as seaColorOf, surfaceColor, surfaceInfo, surfacePoint } from '../../lib/planetSurface';
import PlanetLOD, { BASE_STEP } from './PlanetLOD';
import { getCurrentSite } from '../../lib/site';
import { useFrame } from '@react-three/fiber';
import { orbitOf, PLANET_R, SUN_R, siteFrame, spacePlanets, spaceState, sunPos, type SpacePlanet } from '../../lib/space';

// I pianeti nello spazio (lib/space.ts): sfere con un aspetto procedurale
// derivato dal seme (continenti, mari, colore della foschia), e una colonna di
// luce al polo nord, dove sta la citta'. Il pianeta corrente e' la sfera sotto
// la citta' (sta pochi metri sotto il terreno piatto). Tutto visivo, senza
// fisica: il drone non ci sbatte, e' Drone.tsx a tenerlo fuori.

// geometria della superficie di un pianeta: sfera di raggio R spostata dal rilievo procedurale (stessa funzione del
// terreno su cui si atterra, lib/planetSurface.ts), con i colori dei biomi. Una per pianeta, in cache.
const surfaceGeoCache = new Map<number, THREE.BufferGeometry>();
function planetSurfaceGeometry(seed: number): THREE.BufferGeometry {
  let g = surfaceGeoCache.get(seed);
  if (g) return g;
  const W = 160, H = 80;
  const pos = new Float32Array((W + 1) * (H + 1) * 3);
  const col = new Float32Array((W + 1) * (H + 1) * 3);
  const c = new THREE.Color();
  const pt = new THREE.Vector3();
  let k = 0;
  for (let j = 0; j <= H; j++) {
    const v = j / H;
    const phi = v * Math.PI; // 0 al polo nord (+Y)
    for (let i = 0; i <= W; i++) {
      const u = i / W;
      const th = u * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(th), y = Math.cos(phi), z = Math.sin(phi) * Math.sin(th);
      surfacePoint(seed, x, y, z, pt);
      // abbassata del suo passo: i livelli di dettaglio (PlanetLOD) le stanno sopra
      pt.multiplyScalar(1 - (0.12 * BASE_STEP) / pt.length());
      pos[k] = pt.x;
      pos[k + 1] = pt.y;
      pos[k + 2] = pt.z;
      surfaceColor(seed, surfaceInfo(seed, x, y, z), c);
      col[k] = c.r;
      col[k + 1] = c.g;
      col[k + 2] = c.b;
      k += 3;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const a = j * (W + 1) + i, b = a + 1, d = a + (W + 1), e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  surfaceGeoCache.set(seed, g);
  return g;
}

// alone: anello luminoso che sfuma verso fuori (atmosfera vista dallo spazio)
function haloTexture(inner: number, soft = 0.0): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(Math.max(0, inner - 0.02), 'rgba(255,255,255,0)');
  gr.addColorStop(inner, 'rgba(255,255,255,0.55)');
  gr.addColorStop(Math.min(0.99, inner + 0.1 + soft), 'rgba(255,255,255,0.12)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}
// punto-guida di un pianeta: cerchietto con un nucleo luminoso
function markerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(160,240,255,0.9)');
  gr.addColorStop(0.55, 'rgba(120,220,255,0.15)');
  gr.addColorStop(1, 'rgba(120,220,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
// bagliore del sole: cuore bianco-giallo che sfuma
function sunGlowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,250,225,1)');
  gr.addColorStop(0.18, 'rgba(255,236,170,0.85)');
  gr.addColorStop(0.45, 'rgba(255,190,90,0.25)');
  gr.addColorStop(1, 'rgba(255,150,40,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

// stelle lontane e una fascia piu' densa (la nostra galassia), a distanza enorme
// attorno alla camera: visibili solo nello spazio (spaceState.t)
export const SpaceStars: React.FC = () => {
  const ref = useRef<THREE.Points>(null);
  const mat = useRef<THREE.PointsMaterial>(null);
  const geo = useMemo(() => {
    const N = 9000;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const c = new THREE.Color();
    let seed = 12345;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < N; i++) {
      let x, y, z;
      if (i < N * 0.35) {
        // fascia: vicino a un piano inclinato, con spessore gaussiano
        const a = rnd() * Math.PI * 2;
        const th = (rnd() + rnd() + rnd() - 1.5) * 0.18;
        x = Math.cos(a) * Math.cos(th);
        z = Math.sin(a) * Math.cos(th);
        y = Math.sin(th);
        const ty = y * Math.cos(0.5) - z * Math.sin(0.5);
        const tz = y * Math.sin(0.5) + z * Math.cos(0.5);
        y = ty;
        z = tz;
      } else {
        const u = rnd() * 2 - 1;
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(1 - u * u);
        x = r * Math.cos(a);
        y = u;
        z = r * Math.sin(a);
      }
      pos.set([x * 700000, y * 700000, z * 700000], i * 3);
      const k = rnd();
      c.setHSL(k < 0.15 ? 0.6 : k < 0.3 ? 0.08 : 0.12, k < 0.3 ? 0.5 : 0.1, 0.55 + rnd() * 0.45);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }, []);
  useFrame((state) => {
    if (!ref.current || !mat.current) return;
    ref.current.position.copy(state.camera.position);
    ref.current.quaternion.copy(siteFrame.quat); // fisse nell'universo: nel riferimento del sito ruotano
    const t = Math.min(1, Math.max(0, (spaceState.dark - 0.2) / 0.6));
    mat.current.opacity = t;
    ref.current.visible = t > 0.01;
  });
  return (
    <points ref={ref} geometry={geo} frustumCulled={false} renderOrder={-2}>
      <pointsMaterial ref={mat} vertexColors size={2.3} sizeAttenuation={false} transparent opacity={0} depthWrite={false} fog={false} blending={THREE.AdditiveBlending} />
    </points>
  );
};

// il sole al centro del sistema: sfera luminosa + bagliore (sprite che guarda la camera)
export const SpaceSun: React.FC = () => {
  const glow = useMemo(() => sunGlowTexture(), []);
  const body = useRef<THREE.MeshBasicMaterial>(null);
  const halo = useRef<THREE.SpriteMaterial>(null);
  const group = useRef<THREE.Group>(null);
  // il sole vero compare man mano che il cielo si scurisce: nel cielo di giorno c'e' solo
  // il disco dello shader del cielo, cosi' i due non si sovrappongono
  useFrame(() => {
    const k = Math.min(1, Math.max(0, (spaceState.dark - 0.3) / 0.55));
    if (body.current) body.current.opacity = k;
    if (halo.current) halo.current.opacity = k;
    if (group.current) {
      group.current.visible = k > 0.003;
      group.current.position.fromArray(sunPos()); // il riferimento segue il pianeta: il sole si muove
    }
  });
  return (
    <group ref={group} dispose={null} visible={false}>
      <mesh>
        <sphereGeometry args={[SUN_R, 64, 48]} />
        <meshBasicMaterial ref={body} color="#fff1c2" toneMapped={false} fog={false} transparent opacity={0} />
      </mesh>
      <sprite scale={[SUN_R * 7, SUN_R * 7, 1]}>
        <spriteMaterial ref={halo} map={glow} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} />
      </sprite>
    </group>
  );
};

const PlanetHalo: React.FC<{ tint: string; map: THREE.Texture; fadeWithAltitude: boolean }> = ({ tint, map, fadeWithAltitude }) => {
  const mat = useRef<THREE.SpriteMaterial>(null);
  // il pianeta dove si e' (citta' montata): l'alone si vede solo salendo, non dal suolo
  useFrame(() => {
    // gli aloni compaiono man mano che il cielo si scurisce (quello del pianeta dove si e' e' piu' sottile in basso)
    if (mat.current) mat.current.opacity = Math.min(1, Math.max(0, (spaceState.dark - 0.05) / 0.5)) * (fadeWithAltitude ? 1 : 0.9);
  });
  return (
    <sprite scale={[PLANET_R * 2 * 1.28, PLANET_R * 2 * 1.28, 1]} renderOrder={-1}>
      <spriteMaterial ref={mat} map={map} color={tint} transparent opacity={fadeWithAltitude ? 0 : 1} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} />
    </sprite>
  );
};

const SpacePlanets: React.FC = () => {
  const epoch = usePlanetEpoch();
  // (ricalcolato a ogni cambio di riferimento: le posizioni dipendono dal pianeta corrente)
  const planets = useMemo<SpacePlanet[]>(() => spacePlanets(), [epoch]); // eslint-disable-line react-hooks/exhaustive-deps
  const halo = useMemo(() => haloTexture(1 / 1.28), []);
  const marker = useMemo(() => markerTexture(), []);
  return (
    <group dispose={null}>
      {planets.map((p) => (
        <PlanetBody key={p.profile.seed} p={p} halo={halo} marker={marker} />
      ))}
      {planets.map((p) => (
        <PlanetLOD key={'lod' + p.profile.seed} p={p} />
      ))}
      <OrbitRings planets={planets} />
    </group>
  );
};

// un pianeta: il gruppo sta nel suo centro (nel riferimento del sito) e ruota col riferimento; dentro ci
// sono la superficie col rilievo, il mare (sfera di raggio R), l'alone dell'atmosfera e il punto-guida
// della citta' (al polo nord, quota della superficie al polo)
const PlanetBody: React.FC<{ p: SpacePlanet; halo: THREE.Texture; marker: THREE.Texture }> = ({ p, halo, marker }) => {
  const group = useRef<THREE.Group>(null);
  const geo = useMemo(() => planetSurfaceGeometry(p.profile.seed), [p.profile.seed]);
  const tint = useMemo(() => styleFromSeed(p.profile.seed).fogTint, [p.profile.seed]);
  const seaColor = useMemo(() => seaColorOf(p.profile.seed), [p.profile.seed]);
  useFrame(() => {
    if (!group.current) return;
    group.current.position.set(p.center[0], p.center[1], p.center[2]);
    group.current.quaternion.copy(siteFrame.quat);
  });
  return (
    <group ref={group}>
      <mesh geometry={geo}>
        <meshStandardMaterial vertexColors roughness={0.95} metalness={0} polygonOffset polygonOffsetFactor={3} polygonOffsetUnits={3} />
      </mesh>
      {/* il mare: la sfera al livello zero; le montagne e le coste la bucano */}
      <mesh>
        <sphereGeometry args={[PLANET_RADIUS, 256, 128]} />
        <meshStandardMaterial color={seaColor} roughness={0.3} metalness={0} transparent opacity={0.9} polygonOffset polygonOffsetFactor={2} polygonOffsetUnits={2} />
      </mesh>
      <PlanetHalo tint={tint} map={halo} fadeWithAltitude={p.isCurrent} />
      {/* la citta': colonna di luce al polo, si vede da vicino, e un punto di dimensione fissa sullo schermo,
          che si vede da qualsiasi distanza */}
      {(!p.isCurrent || getCurrentSite().kind === 'wild') && (
        <group position={[0, PLANET_RADIUS + p.hPole, 0]}>
          <mesh position={[0, 900, 0]}>
            <cylinderGeometry args={[45, 45, 1800, 12, 1, true]} />
            <meshBasicMaterial color="#7fe9ff" transparent opacity={0.55} fog={false} depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
          <sprite position={[0, 40, 0]} scale={[0.02, 0.02, 1]} renderOrder={5}>
            <spriteMaterial map={marker} color="#7fe9ff" sizeAttenuation={false} transparent depthTest={false} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} />
          </sprite>
        </group>
      )}
    </group>
  );
};

// le orbite: anelli sottili attorno al sole, nel riferimento che segue il pianeta corrente
const OrbitRings: React.FC<{ planets: SpacePlanet[] }> = ({ planets }) => {
  const group = useRef<THREE.Group>(null);
  const mat = useMemo(() => new THREE.LineBasicMaterial({ color: '#9fd8ff', transparent: true, opacity: 0, depthWrite: false, fog: false }), []);
  const lines = useMemo(
    () =>
      planets.map((pl) => {
        const o = orbitOf(pl.profile.seed);
        const pts: number[] = [];
        for (let i = 0; i <= 192; i++) {
          const th = (i / 192) * Math.PI * 2;
          pts.push(Math.cos(th) * o.r, Math.sin(th) * o.r * Math.sin(o.inc), Math.sin(th) * o.r * Math.cos(o.inc));
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        const line = new THREE.Line(g, mat);
        line.frustumCulled = false;
        line.renderOrder = -1;
        return line;
      }),
    [planets, mat]
  );
  useFrame(() => {
    if (!group.current) return;
    group.current.position.fromArray(sunPos());
    group.current.quaternion.copy(siteFrame.quat);
    // visibili nello spazio, non dal suolo
    const k = Math.min(1, Math.max(0, (spaceState.dark - 0.4) / 0.5));
    group.current.visible = k > 0.01;
    mat.opacity = 0.22 * k;
  });
  return (
    <group ref={group} visible={false}>
      {lines.map((l, i) => (
        <primitive key={i} object={l} />
      ))}
    </group>
  );
};

export default SpacePlanets;
