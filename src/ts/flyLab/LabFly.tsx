import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { useRapier } from '@react-three/rapier';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { createFlyBody, destroyFlyBody, writeBodiesToBones, type FlyBody } from '../flyBrain/flyBody';
import { makeLayout, ConnectomeBrain, initialParams, type FlyGraph } from '../flyBrain/connectomePolicy';
import { FlyController, CONTROL_HZ, N_CMD, type FlyTask } from '../flyBrain/flyController';

// Una mosca-umano del laboratorio: corpo fisico + cervello con i parametri
// dati (null = cervello "spento": insegue solo l'animazione). Riparte da sola
// quando cade o dopo `episodeSeconds`, cosi' mostra sempre i pesi recenti.
const MODEL_URL = 'soldier-citizen.glb';
const BASE_ANIMS_URL = 'soldier-citizen-base-animations.glb';
const ADDON_ANIMS_URL = 'soldier-citizen-addon-animations.glb';

function boneMap(root: THREE.Object3D) {
  const m: Record<string, THREE.Bone> = {};
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) m[o.name] = o as THREE.Bone;
  });
  return m;
}

export interface LabFlyStatus {
  upFor: number;
  episodes: number;
  bestUp: number;
}

interface Props {
  graph: FlyGraph;
  params: Float32Array | null;
  paramsVersion: number;
  task: FlyTask;
  x: number;
  color: string;
  ghost: boolean;
  episodeSeconds: number;
  restartNonce: number;
  status: React.MutableRefObject<LabFlyStatus>;
  paused: boolean;
}

const LabFly: React.FC<Props> = ({ graph, params, paramsVersion, task, x, color, ghost, episodeSeconds, restartNonce, status, paused }) => {
  const { world, rapier } = useRapier();
  const { scene } = useGLTF(MODEL_URL);
  const { animations: baseAnims } = useGLTF(BASE_ANIMS_URL);
  const { animations: addonAnims } = useGLTF(ADDON_ANIMS_URL);
  const clips = useMemo(() => {
    const all: Record<string, THREE.AnimationClip> = {};
    for (const c of [...baseAnims, ...addonAnims]) all[c.name] = c;
    return all;
  }, [baseAnims, addonAnims]);

  const { refRoot, refBones, visRoot, visBones } = useMemo(() => {
    const refRoot = SkeletonUtils.clone(scene);
    const visRoot = SkeletonUtils.clone(scene);
    visRoot.traverse((c: any) => {
      if (c.isSkinnedMesh) {
        c.material = c.material.clone();
        // colore ben riconoscibile: tinta + un po' di luce propria
        c.material.color = new THREE.Color(color);
        c.material.emissive = new THREE.Color(color);
        c.material.emissiveIntensity = 0.25;
        c.frustumCulled = false;
        c.castShadow = true;
      }
    });
    // fantasma: il riferimento animato, trasparente
    refRoot.traverse((c: any) => {
      if (c.isSkinnedMesh) {
        c.material = new THREE.MeshBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.18, depthWrite: false });
        c.frustumCulled = false;
      }
    });
    return { refRoot, refBones: boneMap(refRoot), visRoot, visBones: boneMap(visRoot) };
  }, [scene, color]);

  const simRef = useRef<{ fb: FlyBody; ctl: FlyController; acc: number; downFor: number; age: number } | null>(null);
  const destroySim = () => {
    if (simRef.current) {
      // il mondo Rapier puo' essere gia' stato liberato (smontaggio della
      // scena, StrictMode): in quel caso i corpi sono spariti con lui
      try {
        destroyFlyBody(simRef.current.fb);
      } catch {
        /* mondo gia' distrutto */
      }
      simRef.current = null;
    }
  };
  const createSim = () => {
    destroySim();
    refRoot.position.set(x, 0, 0);
    refRoot.updateMatrixWorld(true);
    const fb = createFlyBody(rapier as any, world as any, refRoot, refBones, clips['Fighting Idle'] ?? null);
    const layout = makeLayout(graph, fb.nObs + N_CMD + fb.nAct, fb.nAct);
    const p = params && params.length === layout.nParams ? params : initialParams(layout);
    const brain = new ConnectomeBrain(graph, layout, p);
    const ctl = new FlyController(fb, brain, { idle: clips['Idle_A'], walk: clips['Walk'], lay: clips['LayToIdle'] }, refRoot, task);
    ctl.groundY = 0;
    ctl.start(0);
    simRef.current = { fb, ctl, acc: 0, downFor: 0, age: 0 };
    status.current.upFor = 0;
    status.current.episodes++;
  };

  // Creazione rimandata al primo frame (dentro il ciclo di R3F, col mondo
  // Rapier gia' stabile): creare corpi da un effetto React poteva usare un
  // mondo appena ricreato/liberato (StrictMode) -> panico wasm.
  const wantCreateRef = useRef(true);
  useEffect(() => {
    wantCreateRef.current = true;
  }, [task, restartNonce, graph]);
  useEffect(() => () => destroySim(), []);
  // pesi nuovi: si applicano al prossimo episodio (non a meta')
  const pendingRef = useRef(false);
  useEffect(() => {
    pendingRef.current = true;
  }, [paramsVersion]);

  useFrame((_s, delta) => {
    if (wantCreateRef.current) {
      wantCreateRef.current = false;
      createSim();
    }
    const sim = simRef.current;
    if (!sim || paused) return;
    const dt = Math.min(delta, 0.1);
    sim.acc += dt;
    sim.age += dt;
    while (sim.acc >= 1 / CONTROL_HZ) {
      sim.ctl.control();
      sim.acc -= 1 / CONTROL_HZ;
    }
    for (const name in visBones) {
      const src = refBones[name];
      if (!src) continue;
      visBones[name].position.copy(src.position);
      visBones[name].quaternion.copy(src.quaternion);
    }
    visRoot.updateMatrixWorld(true);
    writeBodiesToBones(sim.fb, visBones);
    const head = sim.fb.bySeg.Head.body.translation();
    const hip = sim.fb.segs[0].body.translation();
    const down = task === 'getup' ? false : head.y < 0.9;
    sim.downFor = down ? sim.downFor + dt : 0;
    if (!down) {
      status.current.upFor = sim.age;
      status.current.bestUp = Math.max(status.current.bestUp, sim.age);
    }
    const far = Math.hypot(hip.x - x, hip.z) > 25;
    if (sim.downFor > 1.2 || sim.age > episodeSeconds || far || !Number.isFinite(hip.y) || (pendingRef.current && sim.downFor > 0.3)) {
      pendingRef.current = false;
      createSim();
    }
  });

  return (
    <>
      <primitive object={visRoot} />
      <primitive object={refRoot} visible={ghost} />
    </>
  );
};

export default LabFly;
