import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useStaticBoxes, type StaticBox } from './staticColliders';
import { getTerrainHeight } from './Terrain';
import { CollisionGroups, groupsExcluding } from '../../enums/CollisionGroups';
import { CLIMBABLE_GROUPS } from './traversal/traversalWorld';
import { CITY_LAYOUT } from './City';
import { HOSPITAL, POLICE_STATION, BANK, LOT_RECTS, getStreetProps } from './streetPropsData';
import { worldRng } from '../../lib/worldSeed';
import { getPlanet, isPlazaBlock, onPlanetRebuild } from '../../lib/planet';
import Statue, { STATUE_MATERIALS, type StatueStyle } from './Statue';
import { useGLTF } from '../../lib/gltf';

// Statue nelle zone verdi: nel parco sulle cime delle colline, e nei cortili
// verdi. Sono il manichino del gioco fermato in pose vere delle sue
// animazioni (Statue.tsx), in bronzo, marmo, oro, verderame e ossidiana, su
// piedistalli di pietra che si possono scalare.

const GROUPS = groupsExcluding(CollisionGroups.Default);
const PED_H = 1.5; // altezza del piedistallo

const stone = new THREE.MeshStandardMaterial({ color: '#b9b4aa', roughness: 0.85 });
const stoneDark = new THREE.MeshStandardMaterial({ color: '#8d8981', roughness: 0.9 });
const goldTrim = new THREE.MeshStandardMaterial({ color: '#d9ad3a', roughness: 0.3, metalness: 1 });

// piedistallo a gradini: base larga, fusto, cornice (alto PED_H)
const Pedestal: React.FC<{ w?: number }> = ({ w = 1.8 }) => (
  <group>
    <mesh position={[0, 0.15, 0]} material={stoneDark} castShadow receiveShadow>
      <boxGeometry args={[w + 0.7, 0.5, w + 0.7]} />
    </mesh>
    <mesh position={[0, 0.8, 0]} material={stone} castShadow receiveShadow>
      <boxGeometry args={[w, 1.0, w]} />
    </mesh>
    <mesh position={[0, 1.38, 0]} material={stoneDark} castShadow receiveShadow>
      <boxGeometry args={[w + 0.3, 0.24, w + 0.3]} />
    </mesh>
    {/* targhetta dorata sul fusto */}
    <mesh position={[0, 0.85, w / 2 + 0.01]} material={goldTrim}>
      <boxGeometry args={[w * 0.5, 0.25, 0.02]} />
    </mesh>
  </group>
);

interface Kind {
  name: string;
  pedW?: number;
  // corpo pieno sopra il piedistallo: mezze misure
  body: [number, number, number];
  render: () => React.ReactNode;
}

const KINDS: Kind[] = [
  {
    name: 'Il Vincitore',
    body: [0.6, 2.4, 0.6],
    render: () => (
      <>
        <Pedestal />
        <Statue clip="Victory" pick="high" style="bronze" scale={2.4} position={[0, PED_H, 0]} />
      </>
    ),
  },
  {
    name: 'Il Discobolo',
    body: [0.9, 2.2, 0.9],
    render: () => (
      <>
        <Pedestal w={2} />
        <Statue clip="Throw Object" pick="reach" style="marble" scale={2.4} position={[0, PED_H, 0]} />
      </>
    ),
  },
  {
    name: "Pugno d'oro",
    body: [0.9, 2.0, 0.9],
    render: () => (
      <>
        <Pedestal />
        <Statue clip="Punch_Cross" pick="reach" style="gold" scale={2.3} position={[0, PED_H, 0]} />
      </>
    ),
  },
  {
    name: 'Il Salto',
    body: [0.6, 3.4, 0.6],
    render: () => (
      <>
        <Pedestal />
        <mesh position={[0, PED_H + 0.9, 0]} material={goldTrim} castShadow>
          <cylinderGeometry args={[0.06, 0.09, 1.8, 8]} />
        </mesh>
        <Statue clip="Backflip" pick={0.45} style="bronze" scale={2.2} float={1.8} position={[0, PED_H, 0]} />
      </>
    ),
  },
  {
    name: 'Ballerini',
    pedW: 3.4,
    body: [1.2, 2.0, 0.7],
    render: () => (
      <>
        <Pedestal w={3.2} />
        <Statue clip="Dance Charleston" pick="reach" style="verdigris" scale={2.1} position={[-0.75, PED_H, 0]} rotY={0.5} />
        <Statue clip="Dance Body Roll" pick="reach" style="verdigris" scale={2.1} position={[0.75, PED_H, 0]} rotY={-0.5} />
      </>
    ),
  },
  {
    name: 'Il Meditante',
    body: [0.9, 1.4, 0.9],
    render: () => (
      <>
        <Pedestal w={2} />
        <Statue clip="Meditate" pick={0.5} style="obsidian" scale={2.2} position={[0, PED_H, 0]} />
      </>
    ),
  },
  {
    name: 'Il Duello',
    pedW: 3.4,
    body: [1.3, 2.0, 0.8],
    render: () => (
      <>
        <Pedestal w={3.2} />
        <Statue clip="Punch_Jab" pick="reach" style="marble" scale={2.2} position={[-0.7, PED_H, 0]} rotY={Math.PI / 2} />
        <Statue clip="Kimodo_hit_stomach" pick={0.3} style="bronze" scale={2.2} position={[0.7, PED_H, 0]} rotY={-Math.PI / 2} />
      </>
    ),
  },
  {
    name: 'Levitazione',
    body: [0.7, 3.2, 0.7],
    render: () => (
      <>
        <Pedestal w={2} />
        <Statue clip="Levitate Idle" pick={0.5} style="gold" scale={2.2} float={1.2} position={[0, PED_H, 0]} />
        <mesh position={[0, PED_H + 0.1, 0]} rotation={[Math.PI / 2, 0, 0]} material={goldTrim}>
          <torusGeometry args={[0.9, 0.04, 8, 48]} />
        </mesh>
      </>
    ),
  },
  {
    name: "L'Inchino",
    body: [0.7, 2.0, 0.7],
    render: () => (
      <>
        <Pedestal />
        <Statue clip="Bow" pick={0.5} style="marble" scale={2.2} position={[0, PED_H, 0]} />
      </>
    ),
  },
  {
    name: 'Il Gigante',
    pedW: 2.8,
    body: [1.0, 3.6, 1.0],
    render: () => (
      <>
        <Pedestal w={2.8} />
        <Statue clip="Power Up" pick="high" style="bronze" scale={3.6} position={[0, PED_H, 0]} />
      </>
    ),
  },
];

// Angoli dei blocchi, fra il marciapiede e i palazzi: fuori dalle zone verdi.
// Si scelgono quelli liberi (niente palazzi, arredo, servizi, parcheggi) e
// distanti fra loro.
export function cornerSpots(count: number): Array<[number, number]> {
  const rnd = worldRng('monument-corners');
  const solids = getStreetProps().solids;
  const circles = getStreetProps().crowdCircles;
  const services = [HOSPITAL, POLICE_STATION, BANK].map((b) => ({ minX: b.x - b.w / 2 - 5, maxX: b.x + b.w / 2 + 13, minZ: b.z - b.d / 2 - 5, maxZ: b.z + b.d / 2 + 5 }));
  const rects = [
    ...services,
    ...LOT_RECTS.map((r) => ({ minX: r.minX - 3, maxX: r.maxX + 3, minZ: r.minZ - 3, maxZ: r.maxZ + 3 })),
    ...CITY_LAYOUT.buildings.map((o) => ({ minX: o.x - o.w / 2 - 3.4, maxX: o.x + o.w / 2 + 3.4, minZ: o.z - o.d / 2 - 3.4, maxZ: o.z + o.d / 2 + 3.4 })),
  ];
  const R = 2.6; // mezzo ingombro del piedistallo con un po' d'aria
  const cands: Array<[number, number]> = [];
  const GR = getPlanet().gridRadius;
  for (let i = -GR; i <= GR; i++) {
    for (let j = -GR; j <= GR; j++) {
      // parco e piazze (mercato, deposito) escluse
      if ((i === 0 && j === 0) || isPlazaBlock(i, j, GR)) continue;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) cands.push([i * 60 + 30 + sx * 20.5, j * 60 + 30 + sz * 20.5]);
      }
    }
  }
  const free = cands.filter(([x, z]) => {
    if (rects.some((r) => x + R > r.minX && x - R < r.maxX && z + R > r.minZ && z - R < r.maxZ)) return false;
    if (solids.some((q) => x + R > q.x - q.hx && x - R < q.x + q.hx && z + R > q.z - q.hz && z - R < q.z + q.hz)) return false;
    if (circles.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + R)) return false;
    return true;
  });
  const order = free.map((p) => ({ p, k: rnd() })).sort((a, b) => a.k - b.k).map((o) => o.p);
  const out: Array<[number, number]> = [];
  for (const p of order) {
    if (out.length >= count) break;
    if (out.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 45)) out.push(p);
  }
  return out;
}

// Statue scaricate, tutte CC0 (pubblico dominio), in public/statues/ (crediti in
// CREDITS.txt): cavallo, volpe e cervo (Poly Pizza, Quaternius) e cavaliere,
// dea del sole e statua con lampione (OpenGameArt).
// Hanno il loro piedistallo: si scalano a un'altezza fissa e si ricentrano.
interface ModelDef {
  file: string;
  title: string;
  label: string; // nome sulla mappa
  height: number; // altezza finale voluta (m)
  // dimensioni originali (x, y, z) del file, per scalare e per il collider
  size: [number, number, number];
  // materiale al posto di quello del file (per i modelli senza texture)
  style?: StatueStyle;
}
const MODELS: ModelDef[] = [
  { file: 'statues/horse.glb', title: 'Horse Statue', label: 'Statua del cavallo', height: 4.6, size: [1.74, 5.85, 3.38] },
  { file: 'statues/fox.glb', title: 'Fox Statue', label: 'Statua della volpe', height: 3.4, size: [1.35, 3.75, 1.68] },
  { file: 'statues/stag.glb', title: 'Stag Statue', label: 'Statua del cervo', height: 4.2, size: [2.31, 4.63, 1.27] },
  // OpenGameArt (CC0), convertite da .blend / .obj in GLB: crediti in public/statues/CREDITS.txt
  { file: 'statues/knight.glb', title: 'Knight statue', label: 'Cavaliere inginocchiato', height: 4.0, size: [1.82, 3.49, 1.04], style: 'marble' },
  { file: 'statues/sungoddess.glb', title: 'Sun Goddess', label: 'Dea del sole', height: 4.8, size: [0.58, 1.65, 0.67], style: 'bronze' },
  { file: 'statues/lamp.glb', title: 'Statue holding Lightpost', label: 'Statua col lampione', height: 4.8, size: [173.34, 301.81, 108.81] },
];

const ModelStatue: React.FC<{ def: ModelDef; rotY: number }> = ({ def, rotY }) => {
  const { scene } = useGLTF(def.file);
  const { obj, k } = useMemo(() => {
    const o = scene.clone(true);
    o.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) {
        if (def.style) (c as THREE.Mesh).material = STATUE_MATERIALS[def.style];
        c.castShadow = true;
        c.receiveShadow = true;
      }
    });
    const box = new THREE.Box3().setFromObject(o);
    const centre = box.getCenter(new THREE.Vector3());
    const k = def.height / (box.max.y - box.min.y);
    // ricentrato in x/z, base a terra
    const wrap = new THREE.Group();
    o.position.set(-centre.x, -box.min.y, -centre.z);
    wrap.add(o);
    wrap.scale.setScalar(k);
    wrap.rotation.y = rotY;
    return { obj: wrap, k };
  }, [scene, def, rotY]);
  void k;
  return <primitive object={obj} />;
};

// Posizioni di tutte le statue (sempre le stesse): le statue del manichino e
// quelle scaricate; la mappa di pausa segna le scaricate (UI/PauseMap.tsx).
let layoutCache: ReturnType<typeof computeLayout> | null = null;
onPlanetRebuild(() => {
  layoutCache = null;
});
function computeLayout() {
  const rnd = worldRng('monument-kinds');
  // il Gigante sta sulla fontana del parco: le altre nove agli angoli dei blocchi
  const rest = KINDS.filter((k) => k.name !== 'Il Gigante');
  const spots = cornerSpots(rest.length + MODELS.length);
  const order = rest.map((k, i) => ({ i, r: rnd() })).sort((a, b) => a.r - b.r).map((o) => o.i);
  const statues = spots
    .slice(0, rest.length)
    .map(([x, z], n) => ({ x, z, y: getTerrainHeight(x, z), kind: rest[order[n % rest.length]], rot: rnd() * Math.PI * 2 }));
  // le statue scaricate negli altri angoli liberi, ruotate a multipli di 90 gradi
  const models = spots.slice(rest.length).map(([x, z], n) => ({ x, z, y: getTerrainHeight(x, z), def: MODELS[n % MODELS.length], quarter: Math.floor(rnd() * 4) }));
  return { statues, models };
}
export function getMonumentLayout() {
  return (layoutCache ??= computeLayout());
}

const CityMonuments: React.FC = () => {
  const { statues: items, models } = useMemo(() => getMonumentLayout(), []);

  const boxes = useMemo<StaticBox[]>(() => {
    const out: StaticBox[] = [];
    for (const m of items) {
      const w = (m.kind.pedW ?? 1.8) / 2 + 0.35;
      // il piedistallo si scala (parkour)
      out.push({ half: [w, PED_H / 2, w], pos: [m.x, m.y + PED_H / 2 - 0.1, m.z], groups: CLIMBABLE_GROUPS });
      // la statua sopra: un blocco pieno
      const [hx, hy, hz] = m.kind.body;
      out.push({ half: [hx, hy / 2, hz], pos: [m.x, m.y + PED_H + hy / 2, m.z], groups: GROUPS });
    }
    for (const m of models) {
      const swap = m.quarter % 2 === 1;
      const k = m.def.height / m.def.size[1];
      const hx = ((swap ? m.def.size[2] : m.def.size[0]) * k) / 2;
      const hz = ((swap ? m.def.size[0] : m.def.size[2]) * k) / 2;
      out.push({ half: [hx * 0.9, m.def.height / 2, hz * 0.9], pos: [m.x, m.y + m.def.height / 2, m.z], groups: GROUPS });
    }
    return out;
  }, [items, models]);
  // sulla fontana del parco (cima del terzo gradino a ~2.2 m): il Gigante, senza piedistallo
  const fy = useMemo(() => getTerrainHeight(30, 30) + 2.2, []);
  const fountainBoxes = useMemo<StaticBox[]>(() => [{ half: [0.5, 1.2, 0.5], pos: [30, fy + 1.2, 30], groups: GROUPS }], [fy]);
  useStaticBoxes([0, 0, 0], boxes);
  useStaticBoxes([0, 0, 0], fountainBoxes);

  return (
    <group>
      <Statue clip="Power Up" pick="high" style="gold" scale={2.6} position={[30, fy, 30]} rotY={0.4} />
      {models.map((m, i) => (
        <group key={`model-${i}`} position={[m.x, m.y, m.z]}>
          <React.Suspense fallback={null}>
            <ModelStatue def={m.def} rotY={(m.quarter * Math.PI) / 2} />
          </React.Suspense>
        </group>
      ))}
      {items.map((m, i) => (
        <group key={i} position={[m.x, m.y, m.z]} rotation={[0, m.rot, 0]}>
          {m.kind.render()}
        </group>
      ))}
    </group>
  );
};

export default CityMonuments;
