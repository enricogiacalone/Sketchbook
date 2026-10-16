import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { useGLTF } from '../../lib/gltf';
import { MANNEQUIN_URL, MANNEQUIN_BASE_ANIMS_URL, MANNEQUIN_ADDON_ANIMS_URL } from '../city/useMannequinActor';
import { KIMODO_ANIMS_URL } from '../../lib/kimodo';
import { bakeSkinned } from '../city/CrowdInstances';

// Una statua: il manichino del gioco fermato in un fotogramma di una delle sue
// animazioni (stessa mesh e stesse pose del personaggio), reso in bronzo,
// marmo, oro... Il fotogramma si sceglie fra 16 campioni: dove le mani sono
// piu' lontane dal bacino ('reach'), piu' in alto ('high') o a un istante fisso.

export type StatueStyle = 'bronze' | 'marble' | 'gold' | 'verdigris' | 'obsidian';
export const STATUE_MATERIALS: Record<StatueStyle, THREE.MeshStandardMaterial> = {
  bronze: new THREE.MeshStandardMaterial({ color: '#9a6b3a', roughness: 0.42, metalness: 0.85 }),
  marble: new THREE.MeshStandardMaterial({ color: '#ece8df', roughness: 0.3, metalness: 0.05 }),
  gold: new THREE.MeshStandardMaterial({ color: '#e0b43a', roughness: 0.22, metalness: 1 }),
  verdigris: new THREE.MeshStandardMaterial({ color: '#5c9a84', roughness: 0.6, metalness: 0.35 }),
  obsidian: new THREE.MeshStandardMaterial({ color: '#1b1c20', roughness: 0.18, metalness: 0.7 }),
};

export interface StatueProps {
  clip: string;
  pick?: 'reach' | 'high' | number; // un numero e' la frazione 0..1 della clip
  style: StatueStyle;
  scale?: number;
  // altezza da terra voluta dei piedi (statue in volo)
  float?: number;
  rotY?: number;
  position?: [number, number, number];
}

const SAMPLES = 16;
const _v = new THREE.Vector3();

const Statue: React.FC<StatueProps> = ({ clip, pick = 0.5, style, scale = 2.2, float = 0, rotY = 0, position = [0, 0, 0] }) => {
  const { scene } = useGLTF(MANNEQUIN_URL);
  const { animations: base } = useGLTF(MANNEQUIN_BASE_ANIMS_URL);
  const { animations: addon } = useGLTF(MANNEQUIN_ADDON_ANIMS_URL);
  const { animations: kimodo } = useGLTF(KIMODO_ANIMS_URL);

  const geo = useMemo(() => {
    const rig = SkeletonUtils.clone(scene);
    rig.position.set(0, 0, 0);
    rig.rotation.set(0, 0, 0);
    let sm: THREE.SkinnedMesh | null = null;
    rig.traverse((o) => {
      if (!sm && (o as THREE.SkinnedMesh).isSkinnedMesh) sm = o as THREE.SkinnedMesh;
    });
    const mesh = sm as THREE.SkinnedMesh | null;
    const c = [...base, ...addon, ...kimodo].find((a) => a.name === clip);
    if (!mesh || !c) return null;
    const mixer = new THREE.AnimationMixer(rig);
    const act = mixer.clipAction(c);
    act.play();
    const get = (n: string) => rig.getObjectByName(n);
    let t = typeof pick === 'number' ? pick * c.duration : 0;
    if (typeof pick === 'string') {
      let best = -1e9;
      for (let i = 0; i < SAMPLES; i++) {
        const tt = (i / SAMPLES) * c.duration;
        mixer.setTime(tt);
        rig.updateMatrixWorld(true);
        const pelvis = get('pelvis');
        const hands = [get('hand_l'), get('hand_r')];
        if (!pelvis) continue;
        pelvis.getWorldPosition(_v);
        const px = _v.x;
        const py = _v.y;
        const pz = _v.z;
        let score = 0;
        for (const h of hands) {
          if (!h) continue;
          h.getWorldPosition(_v);
          score += pick === 'high' ? _v.y - py : Math.hypot(_v.x - px, _v.y - py, _v.z - pz);
        }
        if (score > best) {
          best = score;
          t = tt;
        }
      }
    }
    mixer.setTime(t);
    const { pos, nrm } = bakeSkinned(mesh, rig);
    // centrato sul bacino in x/z, piedi a terra (o a `float`)
    let minY = Infinity;
    let cx = 0;
    let cz = 0;
    const n = pos.length / 3;
    for (let i = 0; i < n; i++) {
      minY = Math.min(minY, pos[i * 3 + 1]);
      cx += pos[i * 3];
      cz += pos[i * 3 + 2];
    }
    cx /= n;
    cz /= n;
    for (let i = 0; i < n; i++) {
      pos[i * 3] -= cx;
      pos[i * 3 + 1] -= minY;
      pos[i * 3 + 2] -= cz;
    }
    const g = new THREE.BufferGeometry();
    g.setIndex(mesh.geometry.index);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.computeBoundingSphere();
    return g;
  }, [scene, base, addon, kimodo, clip, pick]);

  useEffect(() => () => geo?.dispose(), [geo]);
  if (!geo) return null;
  return (
    <mesh geometry={geo} material={STATUE_MATERIALS[style]} position={[position[0], position[1] + float, position[2]]} rotation={[0, rotY, 0]} scale={scale} castShadow receiveShadow />
  );
};

export default Statue;
