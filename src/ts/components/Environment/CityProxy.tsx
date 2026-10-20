import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PLANET_RADIUS as R } from '../../lib/planetSurface';
import { siteFrame, type SpacePlanet } from '../../lib/space';
import { getCurrentSite } from '../../lib/site';
import { getDataSeed, isWorldMounted, usePlanetData } from '../../lib/planet';
import { buildCityImage, WORLD_HALF } from '../../lib/cityMapImage';
import { getCityProxyItems } from './City';
import { FarBuildings } from './FarBuildings';

// La CITTA' DA LONTANO: il mondo di gioco monta la citta' solo quando il sito e' la citta' (scendendo sotto 1.5 km o a piedi),
// ma dal cielo si deve vedere prima: contorni (isolati, strade, parco, la pianta vista dall'alto) e i palazzi come scatole con
// le stesse finestre dello shader di FarBuildings, fissi sul pianeta come tutto il resto. Avvicinandosi, il mondo vero (palazzi
// dettagliati, strade, arredo) prende il posto di questo e il proxy si spegne. I dati della citta' del pianeta che si sta
// raggiungendo si costruiscono in anteprima (SpaceController, previewWorldSeed).
const SHOW_DIST = 9000; // m dal centro della citta'
const DROP = 1.45; // la zolla del terreno sta 1.5 m sotto lo 0 della citta' (lib/quadNode.ts): il proxy la segue

const PALETTE = {
  water: 'rgba(0,0,0,0)',
  land: '#2a2d2a',
  block: '#3a3e43',
  building: '#3a3e43',
  buildingEdge: '#3a3e43',
  park: '#2f5a2a',
  plaza: '#8d897e',
  sidewalk: '#7c8085',
  road: '#202224',
  runway: '#2a2a2a',
  runwayMark: '#cfcfcf',
  heliport: '#44484c',
};

const CityProxy: React.FC<{ p: SpacePlanet }> = ({ p }) => {
  const outer = useRef<THREE.Group>(null);
  const seed = p.profile.seed;
  const dataVer = usePlanetData();
  const ready = getDataSeed() === seed;
  const items = useMemo(() => (ready ? getCityProxyItems() : []), [ready, dataVer]); // eslint-disable-line react-hooks/exhaustive-deps
  const tex = useMemo(() => {
    if (!ready) return null;
    const c = buildCityImage(PALETTE, 1.5);
    // bordo che sfuma nel terreno (come il suolo della citta' vero, Terrain.tsx: il colore si fonde con quello del pianeta)
    const g = c.getContext('2d')!;
    const r = c.width / 2;
    const grad = g.createRadialGradient(r, r, r * 0.45, r, r, r * 0.98);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [ready, dataVer]); // eslint-disable-line react-hooks/exhaustive-deps
  const half = WORLD_HALF;

  useFrame((state) => {
    const g = outer.current;
    if (!g) return;
    g.position.set(p.center[0], p.center[1], p.center[2]);
    g.quaternion.copy(siteFrame.quat);
    const site = getCurrentSite();
    const real = site.kind === 'city' && site.planetSeed === seed && isWorldMounted();
    const cam = state.camera.position;
    const d = Math.hypot(cam.x - p.pole[0], cam.y - p.pole[1], cam.z - p.pole[2]);
    g.visible = ready && !real && d < SHOW_DIST;
  });

  return (
    <group ref={outer} visible={false} dispose={null}>
      <group position={[0, R + p.hPole - DROP, 0]}>
        {tex && (
          <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[half * 2, half * 2]} />
            <meshStandardMaterial map={tex} transparent alphaTest={0.05} roughness={0.95} metalness={0} />
          </mesh>
        )}
        {items.length > 0 && <FarBuildings items={items} colliderGroups={0} grow={false} />}
      </group>
    </group>
  );
};

export default CityProxy;
