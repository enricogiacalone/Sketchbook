import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { styleFromSeed, usePlanetEpoch } from '../../lib/planet';
import { useFrame } from '@react-three/fiber';
import { orbitOf, PLANET_R, SUN_R, SURFACE_SINK, spacePlanets, spaceState, spaceTime, sunPos, type SpacePlanet } from '../../lib/space';

// I pianeti nello spazio (lib/space.ts): sfere con un aspetto procedurale
// derivato dal seme (continenti, mari, colore della foschia), e una colonna di
// luce al polo nord, dove sta la citta'. Il pianeta corrente e' la sfera sotto
// la citta' (sta pochi metri sotto il terreno piatto). Tutto visivo, senza
// fisica: il drone non ci sbatte, e' Drone.tsx a tenerlo fuori.

function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// rumore a valori, periodico in x (la texture e' equirettangolare)
function vnoise(u: number, v: number, period: number, seed: number): number {
  const x0 = Math.floor(u), y0 = Math.floor(v);
  const fx = u - x0, fy = v - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const w = (x: number) => ((x % period) + period) % period;
  const a = hash2(w(x0), y0, seed), b = hash2(w(x0 + 1), y0, seed);
  const c = hash2(w(x0), y0 + 1, seed), d = hash2(w(x0 + 1), y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function planetTexture(seed: number): THREE.CanvasTexture {
  const st = styleFromSeed(seed);
  const W = 512, H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(W, H);
  const tint = new THREE.Color(st.fogTint);
  const sea = new THREE.Color().setHSL((seed % 360) / 360, 0.45, 0.28);
  const land = new THREE.Color().setHSL(((seed * 7) % 360) / 360, 0.35, 0.42);
  const sea2 = sea.clone().lerp(tint, 0.25);
  const out = new THREE.Color();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let n = 0, amp = 0.5, f = 4, tot = 0;
      for (let o = 0; o < 5; o++) {
        n += amp * vnoise((x / W) * f, (y / H) * (f / 2), f, seed + o * 17);
        tot += amp;
        amp *= 0.5;
        f *= 2;
      }
      n /= tot;
      const polar = Math.abs(y / H - 0.5) * 2; // 0 equatore, 1 poli
      if (n > 0.5) out.copy(land).lerp(tint, Math.min(1, (n - 0.5) * 2)); else out.copy(sea).lerp(sea2, n * 2);
      if (polar > 0.86) out.lerp(new THREE.Color('#eef4fa'), (polar - 0.86) / 0.14);
      const i = (y * W + x) * 4;
      img.data[i] = out.r * 255;
      img.data[i + 1] = out.g * 255;
      img.data[i + 2] = out.b * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
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
    <sprite position={[0, -PLANET_R, 0]} scale={[PLANET_R * 2 * 1.28, PLANET_R * 2 * 1.28, 1]} renderOrder={-1}>
      <spriteMaterial ref={mat} map={map} color={tint} transparent opacity={fadeWithAltitude ? 0 : 1} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} />
    </sprite>
  );
};

const SpacePlanets: React.FC = () => {
  const epoch = usePlanetEpoch();
  // (ricalcolato a ogni cambio di riferimento: le posizioni dipendono dal pianeta corrente)
  const planets = useMemo<SpacePlanet[]>(() => spacePlanets(), [epoch]); // eslint-disable-line react-hooks/exhaustive-deps
  const textures = useMemo(() => new Map<number, THREE.CanvasTexture>(), []);
  const halo = useMemo(() => haloTexture(1 / 1.28), []);
  const marker = useMemo(() => markerTexture(), []);
  const tex = (seed: number) => {
    let t = textures.get(seed);
    if (!t) textures.set(seed, (t = planetTexture(seed)));
    return t;
  };

  return (
    <group dispose={null}>
      {planets.map((p) => (
        <PlanetBody key={p.profile.seed} p={p} map={tex(p.profile.seed)} halo={halo} marker={marker} />
      ))}
      <OrbitRings planets={planets} />
    </group>
  );
};

// un pianeta: il gruppo sta sul polo (la citta') e segue la sua orbita; la sfera gli gira sotto
const PlanetBody: React.FC<{ p: SpacePlanet; map: THREE.Texture; halo: THREE.Texture; marker: THREE.Texture }> = ({ p, map, halo, marker }) => {
  const group = useRef<THREE.Group>(null);
  const sphere = useRef<THREE.Mesh>(null);
  const spin = useMemo(() => 0.02 + ((p.profile.seed * 7) % 13) * 0.004, [p.profile.seed]); // rad/s, attorno all'asse del polo
  useFrame(() => {
    if (group.current) group.current.position.set(p.pole[0], p.pole[1], p.pole[2]);
    if (sphere.current) sphere.current.rotation.y = spaceTime() * spin;
  });
  return (
    <group ref={group}>
      <mesh ref={sphere} position={[0, -PLANET_R - (p.isCurrent ? SURFACE_SINK : 0), 0]}>
        <sphereGeometry args={[PLANET_R, 96, 64]} />
        <meshStandardMaterial map={map} color="#b8b8b8" roughness={1} metalness={0} />
      </mesh>
      {/* atmosfera: alone del colore della foschia del pianeta, attorno alla sfera */}
      <PlanetHalo tint={styleFromSeed(p.profile.seed).fogTint} map={halo} fadeWithAltitude={p.isCurrent} />
      {/* la citta': colonna di luce al polo, si vede da vicino, e un punto di dimensione fissa sullo schermo,
          che si vede da qualsiasi distanza */}
      {!p.isCurrent && (
        <>
          <mesh position={[0, 900, 0]}>
            <cylinderGeometry args={[45, 45, 1800, 12, 1, true]} />
            <meshBasicMaterial color="#7fe9ff" transparent opacity={0.55} fog={false} depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
          <sprite position={[0, 40, 0]} scale={[0.02, 0.02, 1]} renderOrder={5}>
            <spriteMaterial map={marker} color="#7fe9ff" sizeAttenuation={false} transparent depthTest={false} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} />
          </sprite>
        </>
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
