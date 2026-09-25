import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { useRapier } from '@react-three/rapier';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { createFlyBody, destroyFlyBody, writeBodiesToBones, FLY_BODY_VERSION, type FlyBody } from '../../flyBrain/flyBody';
import {
  parseFlyGraph, makeLayout, ConnectomeBrain, initialParams, decodeParams, type FlyGraph, type FlyWeightsFile,
} from '../../flyBrain/connectomePolicy';
import { FlyController, CONTROL_HZ, N_CMD, type FlyTask } from '../../flyBrain/flyController';
import { flyBrainSettings } from '../../flyBrain/flyBrainSettings';
import { AUDIO_ARENA_FLOOR_Y } from './audioArena/AudioArena';
import { useStore } from '../../store';

// "La mosca si crede un umano": un secondo personaggio nell'arena, corpo
// ragdoll COMPLETAMENTE fisico (flyBody.ts) comandato dal sottografo del
// connettoma di Drosophila (connectomePolicy.ts) addestrato in
// training/fly-brain. L'animazione e' solo il riferimento che la mosca
// cerca di imitare; se sta in piedi o cammina lo fa con le sue "zampe".
// Acceso dal pannello "Cervello mosca".
const MODEL_URL = 'soldier-citizen.glb';
const BASE_ANIMS_URL = 'soldier-citizen-base-animations.glb';
const ADDON_ANIMS_URL = 'soldier-citizen-addon-animations.glb';
const SPAWN = new THREE.Vector3(0, AUDIO_ARENA_FLOOR_Y, 5); // davanti al giocatore, lontano da sacco e oggetti
const FLY_COLOR = '#a855f7';

function boneMap(root: THREE.Object3D) {
  const m: Record<string, THREE.Bone> = {};
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) m[o.name] = o as THREE.Bone;
  });
  return m;
}

let graphPromise: Promise<FlyGraph> | null = null;
function loadGraph() {
  if (!graphPromise) {
    graphPromise = Promise.all([
      fetch('/fly-brain/fly-brain.json').then((r) => r.json()),
      fetch('/fly-brain/fly-brain-edges.bin').then((r) => r.arrayBuffer()),
    ]).then(([j, b]) => parseFlyGraph(j, b));
  }
  return graphPromise;
}

const FlyBrainFighter: React.FC = () => {
  const { world, rapier } = useRapier();
  const { scene } = useGLTF(MODEL_URL);
  const { animations: baseAnims } = useGLTF(BASE_ANIMS_URL);
  const { animations: addonAnims } = useGLTF(ADDON_ANIMS_URL);
  const clips = useMemo(() => {
    const all: Record<string, THREE.AnimationClip> = {};
    for (const c of [...baseAnims, ...addonAnims]) all[c.name] = c;
    return all;
  }, [baseAnims, addonAnims]);

  // clone di riferimento (invisibile, suona l'animazione) e clone visibile
  const { refRoot, refBones, visRoot, visBones } = useMemo(() => {
    const refRoot = SkeletonUtils.clone(scene);
    const visRoot = SkeletonUtils.clone(scene);
    visRoot.traverse((c: any) => {
      if (c.isSkinnedMesh) {
        c.material = c.material.clone();
        c.material.emissive = new THREE.Color(FLY_COLOR);
        c.material.emissiveIntensity = 0.35;
        c.frustumCulled = false;
        c.castShadow = true;
      }
    });
    return { refRoot, refBones: boneMap(refRoot), visRoot, visBones: boneMap(visRoot) };
  }, [scene]);

  const graphRef = useRef<FlyGraph | null>(null);
  const paramsRef = useRef<{ task: FlyTask; params: Float32Array | null; info: string } | null>(null);
  const simRef = useRef<{ fb: FlyBody; ctl: FlyController; acc: number; downFor: number; age: number; task: FlyTask } | null>(null);
  const seenRef = useRef({ reset: 0, reload: 0, task: '' as string, brainOff: false });
  const loadingRef = useRef(false);

  const destroySim = () => {
    if (simRef.current) {
      destroyFlyBody(simRef.current.fb);
      simRef.current = null;
    }
  };
  useEffect(() => () => destroySim(), []);

  const loadWeights = async (task: FlyTask) => {
    loadingRef.current = true;
    try {
      graphRef.current = await loadGraph();
      let params: Float32Array | null = null;
      let info = `${task}: non ancora addestrato (solo animazione)`;
      try {
        let r = await fetch(`/__flybrain/load?task=${task}`);
        if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) r = await fetch(`/fly-brain/weights-${task}.json?t=${Date.now()}`);
        if (r.ok) {
          const w = (await r.json()) as FlyWeightsFile;
          if (w.bodyVersion === FLY_BODY_VERSION && (w.brain ?? 'real') === 'real') {
            params = decodeParams(w.params);
            info = `${task}: generazione ${w.generation}, punteggio ${w.score.toFixed(3)}`;
          } else info = `${task}: pesi di un corpo vecchio, ignorati`;
        }
      } catch {
        /* nessun peso */
      }
      paramsRef.current = { task, params, info };
      flyBrainSettings.info = info;
    } finally {
      loadingRef.current = false;
    }
  };

  const createSim = (task: FlyTask) => {
    const g = graphRef.current;
    if (!g) return;
    destroySim();
    refRoot.position.copy(SPAWN);
    refRoot.updateMatrixWorld(true);
    const fb = createFlyBody(rapier as any, world as any, refRoot, refBones, clips['Fighting Idle'] ?? null);
    const layout = makeLayout(g, fb.nObs + N_CMD + fb.nAct, fb.nAct);
    let params = paramsRef.current?.params ?? null;
    if (!params || params.length !== layout.nParams || flyBrainSettings.brainOff) params = initialParams(layout);
    const brain = new ConnectomeBrain(g, layout, params);
    const ctl = new FlyController(fb, brain, { idle: clips['Idle_A'], walk: clips['Walk'], lay: clips['LayToIdle'] }, refRoot, task);
    ctl.groundY = SPAWN.y;
    ctl.start(0);
    simRef.current = { fb, ctl, acc: 0, downFor: 0, age: 0, task };
  };

  useFrame((_s, delta) => {
    const S = flyBrainSettings;
    if (!S.show) {
      if (simRef.current) destroySim();
      visRoot.visible = false;
      return;
    }
    visRoot.visible = !!simRef.current;
    const seen = seenRef.current;
    if (!loadingRef.current && (S.reloadNonce !== seen.reload || S.task !== seen.task || !paramsRef.current)) {
      seen.reload = S.reloadNonce;
      seen.task = S.task;
      loadWeights(S.task).then(() => createSim(S.task));
      return;
    }
    if (S.resetNonce !== seen.reset || S.brainOff !== seen.brainOff) {
      seen.reset = S.resetNonce;
      seen.brainOff = S.brainOff;
      createSim(S.task);
    }
    const sim = simRef.current;
    if (!sim || useStore.getState().isPaused) return;
    sim.acc += Math.min(delta, 0.1);
    sim.age += Math.min(delta, 0.1);
    while (sim.acc >= 1 / CONTROL_HZ) {
      sim.ctl.control();
      sim.acc -= 1 / CONTROL_HZ;
    }
    // disegno: prima tutta la posa del riferimento (dita, ecc.), poi le
    // ossa simulate dalla fisica
    for (const name in visBones) {
      const src = refBones[name];
      if (!src) continue;
      visBones[name].position.copy(src.position);
      visBones[name].quaternion.copy(src.quaternion);
    }
    visRoot.updateMatrixWorld(true);
    writeBodiesToBones(sim.fb, visBones);
    // caduto a terra troppo a lungo, o finito l'alzarsi: si riparte
    const head = sim.fb.bySeg.Head.body.translation();
    sim.downFor = head.y < AUDIO_ARENA_FLOOR_Y + 0.5 ? sim.downFor + delta : 0;
    const hip = sim.fb.segs[0].body.translation();
    const far = Math.hypot(hip.x - SPAWN.x, hip.z - SPAWN.z) > 20;
    if ((sim.task !== 'getup' && sim.downFor > 1.5) || (sim.task === 'getup' && sim.age > 8) || far || !Number.isFinite(hip.y)) {
      createSim(sim.task);
    }
  });

  return <primitive object={visRoot} />;
};

export default FlyBrainFighter;
