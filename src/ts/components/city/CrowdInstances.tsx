import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '../../lib/gltf';
import { SkeletonUtils, mergeBufferGeometries } from 'three-stdlib';
import * as THREE from 'three';
import { RAGDOLL_SEGMENTS, ACTIVE_RAGDOLL_EXTRA_SEGMENTS } from '../Environment/ragdoll/ragdollConfig';
import { MANNEQUIN_URL, MANNEQUIN_BASE_ANIMS_URL } from './useMannequinActor';
import { crowdAgents, CROWD_DRAW_DIST } from './crowdSim';

// La folla lontana disegnata in blocco: ogni passante senza corpo vero e'
// una sagoma del manichino fatta di capsule (le stesse dei segmenti del
// ragdoll, ~1k triangoli invece di ~14k), in pose PRECALCOLATE una volta
// dalla camminata vera (8 fotogrammi) + una da fermo. Ogni posa e' un
// InstancedMesh: a ogni frame ogni agente finisce nella posa del suo passo.
// Niente scheletro, niente mixer, niente fisica: costo per passante ~zero.

const WALK_FRAMES = 8;
const RADIUS_SCALE = 1.25; // la sagoma del manichino e' piu' piena delle capsule fisiche
const BASE_TINT = new THREE.Color('#c9c97a');

const _up = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();

function bakePose(root: THREE.Object3D): THREE.BufferGeometry {
  root.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  const bone = (n: string) => root.getObjectByName(n);
  const segs = [...RAGDOLL_SEGMENTS, ...ACTIVE_RAGDOLL_EXTRA_SEGMENTS];
  for (const s of segs) {
    const A = bone(s.drivingBone);
    const B = bone(s.toBone);
    if (!A || !B) continue;
    A.getWorldPosition(_a);
    B.getWorldPosition(_b);
    _d.subVectors(_b, _a).multiplyScalar(s.lengthScale ?? 1);
    const len = Math.max(0.01, _d.length());
    const r = s.radius * RADIUS_SCALE;
    const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len - r), 3, 8);
    _q.setFromUnitVectors(_up, _d.clone().normalize());
    g.applyQuaternion(_q);
    g.translate(_a.x + _d.x / 2, _a.y + _d.y / 2, _a.z + _d.z / 2);
    parts.push(g.toNonIndexed());
  }
  for (const h of ['hand_l', 'hand_r']) {
    const H = bone(h);
    if (!H) continue;
    H.getWorldPosition(_a);
    const g = new THREE.SphereGeometry(0.06, 8, 6);
    g.translate(_a.x, _a.y, _a.z);
    parts.push(g.toNonIndexed());
  }
  for (const p of parts) p.deleteAttribute('uv');
  const merged = mergeBufferGeometries(parts) ?? new THREE.BufferGeometry();
  parts.forEach((p) => p.dispose());
  return merged;
}

const _o = new THREE.Object3D();
const _c = new THREE.Color();
const _tint = new THREE.Color();
const _frustum = new THREE.Frustum();
const _pv = new THREE.Matrix4();
const _sphere = new THREE.Sphere(new THREE.Vector3(), 4);

const CrowdInstances: React.FC = () => {
  const { scene } = useGLTF(MANNEQUIN_URL);
  const { animations } = useGLTF(MANNEQUIN_BASE_ANIMS_URL);

  // pose precalcolate: [0..WALK_FRAMES-1] camminata, ultima da fermo
  const poses = useMemo(() => {
    const rig = SkeletonUtils.clone(scene);
    rig.position.set(0, 0, 0);
    rig.rotation.set(0, 0, 0);
    const mixer = new THREE.AnimationMixer(rig);
    const walk = animations.find((a) => a.name === 'Walk');
    const idle = animations.find((a) => a.name === 'Idle_A');
    const out: THREE.BufferGeometry[] = [];
    if (walk) {
      const act = mixer.clipAction(walk);
      act.play();
      for (let k = 0; k < WALK_FRAMES; k++) {
        mixer.setTime((k / WALK_FRAMES) * walk.duration);
        out.push(bakePose(rig));
      }
      act.stop();
    }
    if (idle) {
      const act = mixer.clipAction(idle);
      act.play();
      mixer.setTime(0);
      out.push(bakePose(rig));
      act.stop();
    }
    if (out.length === 0) out.push(bakePose(rig));
    mixer.stopAllAction();
    return out;
  }, [scene, animations]);

  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75, metalness: 0.05 }), []);
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  const counts = useMemo(() => new Array(poses.length).fill(0), [poses]);
  const cap = crowdAgents.length;

  useFrame(({ camera: liveCamera }) => {
    counts.fill(0);
    // debug: inquadratura forzata (window.__fixedCam) anche per il culling
    const camera: THREE.Camera = (import.meta.env.DEV && (window as any).__fixedCam) || liveCamera;
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pv);
    const idleIdx = poses.length - 1;
    const walkFrames = Math.max(1, poses.length - 1);
    for (const a of crowdAgents) {
      if (a.gone || a.slot >= 0 || a.dist > CROWD_DRAW_DIST) continue;
      // fuori dall'inquadratura (con un margine per l'ombra): niente
      _sphere.center.set(a.x, a.y + 0.9, a.z);
      if (!_frustum.intersectsSphere(_sphere)) continue;
      const pi = a.pause > 0 || poses.length === 1 ? idleIdx : Math.floor(a.gait * walkFrames) % walkFrames;
      const m = meshes.current[pi];
      if (!m) continue;
      const i = counts[pi]++;
      _o.position.set(a.x, a.y, a.z);
      _o.rotation.set(0, a.yaw, 0);
      _o.updateMatrix();
      m.setMatrixAt(i, _o.matrix);
      // colore del manichino + la tinta "civile" del passante (come
      // l'emissivo del corpo vero)
      _c.copy(BASE_TINT).add(_tint.set(a.color).multiplyScalar(0.35));
      m.setColorAt(i, _c);
    }
    meshes.current.forEach((m, pi) => {
      if (!m) return;
      m.count = counts[pi];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  });

  return (
    <>
      {poses.map((geo, pi) => (
        <instancedMesh
          key={pi}
          name="crowd"
          ref={(m) => {
            meshes.current[pi] = m;
            // colori d'istanza pronti dal primo frame
            if (m && !m.instanceColor) m.setColorAt(0, _c.set('#ffffff'));
          }}
          args={[geo, material, cap]}
          castShadow
          receiveShadow
          frustumCulled={false}
        />
      ))}
    </>
  );
};

export default CrowdInstances;
