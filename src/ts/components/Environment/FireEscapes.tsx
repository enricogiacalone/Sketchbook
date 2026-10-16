import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { StaticInstances, type InstanceXform } from './StaticInstances';
import { useStaticBoxes, type StaticBox } from './staticColliders';
import { CLIMBABLE_GROUPS, registerLadder, unregisterLadder } from './traversal/traversalWorld';
import { FE_D, FE_LADDER_HALF, FE_W, getFireEscapes, type FireEscape } from './fireEscapeData';

// Scale antincendio su alcuni palazzi (dati: fireEscapeData.ts): piattaforme
// a zig-zag, una per piano, e scale a pioli da una all'altra; la prima parte
// dal marciapiede. Ci si sale come sulla scala del percorso parkour
// (traversal.ts): si va sotto il piolo piu' basso e si preme avanti.

const box = new THREE.BoxGeometry(1, 1, 1);
const metal = new THREE.MeshStandardMaterial({ color: '#2b2f33', roughness: 0.6, metalness: 0.5 });
const rail = new THREE.MeshStandardMaterial({ color: '#3a3f44', roughness: 0.55, metalness: 0.5 });

// (u, v, h) locali dell'impianto -> mondo
const toWorld = (f: FireEscape, u: number, v: number, h: number): [number, number, number] => [
  f.ox + f.tx * u + f.nx * v,
  f.groundY + h,
  f.oz + f.tz * u + f.nz * v,
];

const FireEscapes: React.FC = () => {
  const escapes = useMemo(() => getFireEscapes(), []);

  const built = useMemo(() => {
    const plates: InstanceXform[] = [];
    const rails: InstanceXform[] = [];
    const boxes: StaticBox[] = [];
    const ladders: Array<Parameters<typeof registerLadder>[0]> = [];
    for (const f of escapes) {
      const ry = Math.atan2(-f.tz, f.tx); // asse locale x = lungo il muro
      const item = (list: InstanceXform[], u: number, v: number, h: number, sx: number, sy: number, sz: number) => {
        const [x, y, z] = toWorld(f, u, v, h);
        list.push({ x, y, z, ry, sx, sy, sz });
      };
      for (let k = 1; k <= f.levels; k++) {
        const y = k * f.spacing;
        const uc = k % 2 === 1 ? -FE_W / 2 : FE_W / 2;
        // verso della scala che arriva a questo piano (dal piano sotto)
        const uLadder = k === 1 ? -FE_W : 0;
        item(plates, uc, FE_D / 2, y - 0.04, FE_W, 0.08, FE_D);
        // parapetto: fronte e il lato opposto alla scala (dal lato scala si sale)
        item(rails, uc, FE_D - 0.03, y + 1.0, FE_W, 0.05, 0.05);
        item(rails, uc, FE_D - 0.03, y + 0.5, FE_W, 0.04, 0.04);
        const farU = Math.abs(uc - FE_W / 2 - uLadder) < 1e-6 ? uc + FE_W / 2 : uc - FE_W / 2;
        item(rails, farU, FE_D / 2, y + 1.0, 0.05, 0.05, FE_D);
        item(rails, farU, FE_D / 2, y + 0.5, 0.04, 0.04, FE_D);
        for (const pu of [uc - FE_W / 2 + 0.03, uc + FE_W / 2 - 0.03]) item(rails, pu, FE_D - 0.03, y + 0.5, 0.05, 1.0, 0.05);
        // collider della piattaforma
        const [px, py, pz] = toWorld(f, uc, FE_D / 2, y - 0.06);
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
        boxes.push({ half: [FE_W / 2, 0.06, FE_D / 2], pos: [px, py, pz], rot: [q.x, q.y, q.z, q.w], groups: CLIMBABLE_GROUPS });
        // scala che arriva a questo piano
        const y0 = (k - 1) * f.spacing;
        const [lx, , lz] = toWorld(f, uLadder, FE_D / 2, 0);
        // chi sale sta sulla piattaforma sotto (o a terra): da quel lato della scala
        const ucPrev = k === 1 ? -1e3 : (k - 1) % 2 === 1 ? -FE_W / 2 : FE_W / 2;
        const dir = ucPrev < uLadder ? -1 : 1;
        ladders.push({
          id: `${f.id}-l${k}`,
          x: lx,
          z: lz,
          nx: dir * f.tx,
          nz: dir * f.tz,
          bottomY: f.groundY + y0,
          topY: f.groundY + y,
          halfWidth: FE_LADDER_HALF,
        });
        // montanti e pioli, disegnati
        const lh = y - y0 + 0.9;
        for (const dv of [-FE_LADDER_HALF, FE_LADDER_HALF]) item(rails, uLadder, FE_D / 2 + dv, y0 + lh / 2, 0.05, lh, 0.05);
        for (let h = 0.3; h < y - y0 + 0.5; h += 0.3) item(rails, uLadder, FE_D / 2, y0 + h, 0.04, 0.04, FE_LADDER_HALF * 2);
      }
      // sostegni a muro sotto la prima piattaforma
      for (let k = 1; k <= f.levels; k++) {
        const uc = k % 2 === 1 ? -FE_W / 2 : FE_W / 2;
        item(rails, uc, 0.05, k * f.spacing - 0.4, FE_W, 0.06, 0.06);
      }
    }
    return { plates, rails, boxes, ladders };
  }, [escapes]);

  useStaticBoxes([0, 0, 0], built.boxes);
  useEffect(() => {
    for (const l of built.ladders) registerLadder(l);
    return () => {
      for (const l of built.ladders) unregisterLadder(l.id);
    };
  }, [built]);

  if (!escapes.length) return null;
  return (
    <group>
      <StaticInstances name="fe-plates" geometry={box} material={metal} items={built.plates} castShadow receiveShadow />
      <StaticInstances name="fe-rails" geometry={box} material={rail} items={built.rails} castShadow />
    </group>
  );
};

export default FireEscapes;
