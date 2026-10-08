import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '../../lib/gltf';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute } from 'three/tsl';
import { MANNEQUIN_URL, MANNEQUIN_BASE_ANIMS_URL } from './useMannequinActor';
import { KIMODO_ANIMS_URL, K } from '../../lib/kimodo';
import {
  crowdAgents,
  CROWD_DRAW_DIST,
  IDLE_CLIPS,
  LOOK_CLIP,
  LINGER_CLIPS,
  IDLE_POSE_AT,
  describeCrowdAgent,
  isCowering,
  raycastCrowd,
  type CrowdAgent,
} from './crowdSim';
import crowdLod from '../../generated/crowdLod.json';
import { registerInspectable } from '../../lib/npcInspect';
import { registerShotProxy } from '../../lib/shotProxies';

// La folla lontana disegnata in blocco: ogni passante senza corpo vero e'
// una copia instanziata del manichino in pose PRECALCOLATE una volta dalle
// animazioni vere (camminata, corsa di panico, accucciato, una posa per
// ogni clip da fermo). Ogni posa e' un InstancedMesh: a ogni frame ogni
// agente finisce nella posa del suo passo. Niente scheletro, niente mixer,
// niente fisica.
//
// "ci sono glitch strani" (folla): prima le sagome erano omini di capsule
// verde oliva (~1k triangoli) in 8 pose: a 6-26 m, dove il corpo vero
// prende il loro posto, si vedeva il passante cambiare forma e colore di
// colpo. Ora sono la mesh vera del manichino (stessa texture, stessa
// tinta), 16 pose di camminata, e il corpo vero riparte dallo stesso punto
// del passo (CrowdPedestrian).

const WALK_FRAMES = 16;
// oltre questa distanza dalla telecamera (m) la sagoma usa la mesh
// semplificata (scripts/crowd-lod.mjs: ~1.6k triangoli invece di 13.8k)
const LOD_DIST = 30;
const noRaycast = () => {};
const RUN_FRAMES = 12;

// pose di un corpo vero (manichino) in coordinate del modello
function bakeSkinned(mesh: THREE.SkinnedMesh, root: THREE.Object3D): { pos: Float32Array; nrm: Float32Array } {
  root.updateMatrixWorld(true);
  const sk = mesh.skeleton;
  sk.update();
  const nb = sk.bones.length;
  const toModel = new THREE.Matrix4().copy(mesh.matrixWorld).multiply(mesh.bindMatrixInverse);
  const C: number[][] = [];
  const B = new THREE.Matrix4();
  for (let i = 0; i < nb; i++) {
    B.fromArray(sk.boneMatrices as Float32Array, i * 16);
    C.push(new THREE.Matrix4().copy(toModel).multiply(B).multiply(mesh.bindMatrix).elements.slice());
  }
  const g = mesh.geometry;
  const P = g.attributes.position;
  const N = g.attributes.normal;
  const SI = g.attributes.skinIndex;
  const SW = g.attributes.skinWeight;
  const n = P.count;
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const x = P.getX(v);
    const y = P.getY(v);
    const z = P.getZ(v);
    const nx = N.getX(v);
    const ny = N.getY(v);
    const nz = N.getZ(v);
    let px = 0;
    let py = 0;
    let pz = 0;
    let qx = 0;
    let qy = 0;
    let qz = 0;
    for (let k = 0; k < 4; k++) {
      const w = SW.getComponent(v, k);
      if (w <= 0) continue;
      const e = C[SI.getComponent(v, k)];
      px += w * (e[0] * x + e[4] * y + e[8] * z + e[12]);
      py += w * (e[1] * x + e[5] * y + e[9] * z + e[13]);
      pz += w * (e[2] * x + e[6] * y + e[10] * z + e[14]);
      qx += w * (e[0] * nx + e[4] * ny + e[8] * nz);
      qy += w * (e[1] * nx + e[5] * ny + e[9] * nz);
      qz += w * (e[2] * nx + e[6] * ny + e[10] * nz);
    }
    const l = Math.hypot(qx, qy, qz) || 1;
    pos[v * 3] = px;
    pos[v * 3 + 1] = py;
    pos[v * 3 + 2] = pz;
    nrm[v * 3] = qx / l;
    nrm[v * 3 + 1] = qy / l;
    nrm[v * 3 + 2] = qz / l;
  }
  return { pos, nrm };
}

interface Poses {
  geos: THREE.BufferGeometry[];
  walk: number[]; // indici delle pose
  run: number[];
  cower: number;
  idle: Record<string, number>;
  map: THREE.Texture | null;
}

const _o = new THREE.Object3D();
const _tint = new THREE.Color();
const _frustum = new THREE.Frustum();
const _pv = new THREE.Matrix4();
const _sphere = new THREE.Sphere(new THREE.Vector3(), 4);

// quale posa disegna l'agente adesso
function poseOf(a: CrowdAgent, p: Poses): number {
  if (a.fear > 0) {
    if (isCowering(a)) return p.cower;
    return p.run[Math.floor(a.gait * p.run.length) % p.run.length];
  }
  if (a.pause > 0) return p.idle[a.idleClip] ?? p.idle.Idle_A ?? p.walk[0];
  // in attesa dietro a qualcuno o davanti a un'auto: in piedi
  if (a.curSpeed < 0.1) return p.idle.Idle_A ?? p.walk[0];
  return p.walk[Math.floor(a.gait * p.walk.length) % p.walk.length];
}

function describePose(a: CrowdAgent, p: Poses, i: number): string {
  if (p.walk.includes(i)) return `posa precalcolata della camminata (Walk), fotogramma ${p.walk.indexOf(i) + 1} di ${p.walk.length}`;
  if (p.run.includes(i)) return `posa precalcolata della corsa di panico, fotogramma ${p.run.indexOf(i) + 1} di ${p.run.length}`;
  if (i === p.cower) return 'posa fissa: accucciato';
  const idle = Object.entries(p.idle).find(([, k]) => k === i);
  return idle ? `posa fissa da fermo (${idle[0]}, primo fotogramma)` : `posa ${i}`;
}

const CrowdInstances: React.FC = () => {
  const { scene } = useGLTF(MANNEQUIN_URL);
  const { animations: base } = useGLTF(MANNEQUIN_BASE_ANIMS_URL);
  const { animations: kimodo } = useGLTF(KIMODO_ANIMS_URL);

  const poses = useMemo<Poses>(() => {
    const rig = SkeletonUtils.clone(scene);
    rig.position.set(0, 0, 0);
    rig.rotation.set(0, 0, 0);
    let skinned: THREE.SkinnedMesh | null = null;
    rig.traverse((o) => {
      if (!skinned && (o as THREE.SkinnedMesh).isSkinnedMesh) skinned = o as THREE.SkinnedMesh;
    });
    const sm = skinned as THREE.SkinnedMesh | null;
    const out: Poses = { geos: [], walk: [], run: [], cower: -1, idle: {}, map: null };
    if (!sm) return out;
    out.map = ((sm.material as THREE.MeshStandardMaterial).map as THREE.Texture | null) ?? null;
    const src = sm.geometry;
    const clips = new Map([...base, ...kimodo].map((c) => [c.name, c]));
    const mixer = new THREE.AnimationMixer(rig);
    const add = () => {
      const { pos, nrm } = bakeSkinned(sm, rig);
      const g = new THREE.BufferGeometry();
      g.setIndex(src.index);
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      if (src.attributes.uv) g.setAttribute('uv', src.attributes.uv);
      g.computeBoundingSphere();
      out.geos.push(g);
      return out.geos.length - 1;
    };
    const sample = (name: string, frames: number, at?: number): number[] => {
      const clip = clips.get(name);
      if (!clip) return [];
      mixer.stopAllAction();
      const act = mixer.clipAction(clip);
      act.play();
      const idx: number[] = [];
      for (let k = 0; k < frames; k++) {
        mixer.setTime(at !== undefined ? at * clip.duration : (k / frames) * clip.duration);
        idx.push(add());
      }
      act.stop();
      return idx;
    };
    out.walk = sample('Walk', WALK_FRAMES);
    out.run = sample(clips.has(K.panicRun) ? K.panicRun : 'Run_Female', RUN_FRAMES);
    out.cower = sample(clips.has(K.cower) ? K.cower : 'Idle_A', 1, 0.999)[0] ?? -1;
    for (const name of new Set(['Idle_A', LOOK_CLIP, ...LINGER_CLIPS, ...IDLE_CLIPS])) {
      const i = sample(name, 1, IDLE_POSE_AT)[0];
      if (i !== undefined) out.idle[name] = i;
    }
    if (!out.walk.length) out.walk = [add()];
    if (!out.run.length) out.run = out.walk;
    if (out.cower < 0) out.cower = out.walk[0];
    mixer.stopAllAction();
    return out;
  }, [scene, base, kimodo]);

  // stessa resa del corpo vero: texture del manichino + tinta "civile"
  // dell'agente come emissivo (sul corpo vero: emissive = tinta, 0.35)
  const material = useMemo(() => {
    // (i tipi dei materiali a nodi non combaciano con quelli di three: any,
    // come in Grass.tsx)
    const m = new MeshStandardNodeMaterial() as any;
    m.map = poses.map;
    m.roughness = 1;
    m.metalness = 0;
    m.emissiveNode = attribute('tint', 'vec3').mul(0.35);
    return m as THREE.Material;
  }, [poses]);

  // da disegnare: per ogni posa la mesh intera (vicino) e quella
  // semplificata (lontano), stessi vertici
  const draws = useMemo(() => {
    const lodIndex = new THREE.BufferAttribute(new Uint32Array(crowdLod.index), 1);
    let maxIdx = 0;
    for (const v of crowdLod.index) if (v > maxIdx) maxIdx = v;
    return poses.geos.flatMap((g) => {
      const pos = g.getAttribute('position');
      if (!pos || maxIdx >= pos.count) return [g, g];
      const far = new THREE.BufferGeometry();
      far.setIndex(lodIndex);
      far.setAttribute('position', pos);
      far.setAttribute('normal', g.getAttribute('normal'));
      if (g.getAttribute('uv')) far.setAttribute('uv', g.getAttribute('uv'));
      far.boundingSphere = g.boundingSphere;
      return [g, far];
    });
  }, [poses]);
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  const tints = useMemo(
    () =>
      draws.map((g, k) => {
        // (vicino e lontano possono essere la stessa geometria: un attributo per mesh)
        const geo = k % 2 === 1 && draws[k - 1] === g ? g.clone() : g;
        if (geo !== g) draws[k] = geo;
        const t = new THREE.InstancedBufferAttribute(new Float32Array(crowdAgents.length * 3), 3);
        t.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('tint', t);
        return t;
      }),
    [draws]
  );
  const counts = useMemo(() => new Array(draws.length).fill(0), [draws]);
  const cap = crowdAgents.length;

  // colpi da lontano sulle sagome (lib/shotProxies.ts)
  useEffect(
    () =>
      registerShotProxy((o, d, maxDist) => {
        const h = raycastCrowd(o.x, o.y, o.z, d.x, d.y, d.z, maxDist);
        return h ? { ownerId: `crowd-agent-${h.agent.id}`, segment: h.seg, distance: h.distance, crowdAgentId: h.agent.id } : null;
      }),
    []
  );

  // ispettore NPC: anche le sagome si possono scegliere col clic
  useEffect(() => {
    const offs = crowdAgents.map((a) =>
      registerInspectable(`crowd-agent-${a.id}`, {
        where: (out) => {
          if (a.gone || a.slot >= 0 || a.dist > CROWD_DRAW_DIST) return false;
          out.x = a.x;
          out.y = a.y;
          out.z = a.z;
          out.h = 1.8;
          return true;
        },
        info: () => ({
          title: `Passante: sagoma della folla (#${a.id})`,
          rows: [
            ['animazione', `nessuna: ${describePose(a, poses, poseOf(a, poses))}`],
            ['dettaglio', "lontano: mesh instanziata, niente scheletro ne' fisica"],
            ...describeCrowdAgent(a),
          ],
        }),
      })
    );
    return () => offs.forEach((off) => off());
  }, [poses]);

  useEffect(
    () => () => {
      poses.geos.forEach((g) => g.dispose());
      draws.forEach((g, k) => k % 2 === 1 && g.dispose());
      material.dispose();
    },
    [poses, draws, material]
  );

  useFrame(({ camera: liveCamera }) => {
    counts.fill(0);
    // debug: inquadratura forzata (window.__fixedCam) anche per il culling
    const camera: THREE.Camera = (import.meta.env.DEV && (window as any).__fixedCam) || liveCamera;
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pv);
    for (const a of crowdAgents) {
      if (a.gone || a.slot >= 0 || a.dist > CROWD_DRAW_DIST) continue;
      // fuori dall'inquadratura (con un margine per l'ombra): niente
      _sphere.center.set(a.x, a.y + 0.9, a.z);
      if (!_frustum.intersectsSphere(_sphere)) continue;
      const cx = a.x - camera.position.x;
      const cz = a.z - camera.position.z;
      const pi = poseOf(a, poses) * 2 + (cx * cx + cz * cz > LOD_DIST * LOD_DIST ? 1 : 0);
      const m = meshes.current[pi];
      if (!m) continue;
      const i = counts[pi]++;
      _o.position.set(a.x, a.y, a.z);
      _o.rotation.set(0, a.yaw, 0);
      _o.updateMatrix();
      m.setMatrixAt(i, _o.matrix);
      _tint.set(a.color);
      tints[pi].setXYZ(i, _tint.r, _tint.g, _tint.b);
    }
    meshes.current.forEach((m, pi) => {
      if (!m) return;
      m.count = counts[pi];
      // vuota: niente chiamata di disegno (ne' per l'ombra)
      m.visible = counts[pi] > 0;
      m.instanceMatrix.needsUpdate = true;
      if (counts[pi] > 0) tints[pi].needsUpdate = true;
    });
  });

  return (
    <>
      {draws.map((geo, pi) => (
        <instancedMesh
          key={pi}
          name="crowd"
          ref={(m) => {
            meshes.current[pi] = m;
            // niente raggi di three sulle sagome (la telecamera, i clic):
            // l'ispettore e i colpi da lontano usano i loro conti
            if (m) m.raycast = noRaycast;
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
