import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { useRapier, useBeforePhysicsStep } from '@react-three/rapier';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { createFlyBody, destroyFlyBody, writeBodiesToBones, type FlyBody } from '../flyBrain/flyBody';
import { makeLayout, ConnectomeBrain, initialParams, fitParams, type FlyGraph } from '../flyBrain/connectomePolicy';
import { FlyController, CONTROL_HZ, N_CMD, type FlyTask } from '../flyBrain/flyController';
import { applyPush, assistUp, isStanding } from '../flyBrain/flyEnv';

// Una mosca-umano del laboratorio: corpo fisico + cervello con i parametri
// dati (null = cervello "spento": insegue solo l'animazione). Riparte da sola
// quando cade; in "alzarsi" anche se non si e' alzata entro `episodeSeconds`, cosi' mostra sempre i pesi recenti.
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
  // spinta manuale: ogni volta che cambia, un colpo in direzione casuale
  pushNonce: number;
  // spinte casuali automatiche in scena (N*s, 0 = niente), come in addestramento
  autoPush: number;
  // alzarsi: "mano che aiuta" (0..1), lo stesso livello dell'addestramento
  assist: number;
}

const LabFly: React.FC<Props> = ({ graph, params, paramsVersion, task, x, color, ghost, episodeSeconds, restartNonce, status, paused, pushNonce, autoPush, assist }) => {
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

  const simRef = useRef<{ fb: FlyBody; ctl: FlyController; sub: number; downFor: number; age: number; upAt: number; straightSince: number } | null>(null);
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
    const p = (params && fitParams(layout, params)) || initialParams(layout);
    const brain = new ConnectomeBrain(graph, layout, p);
    const ctl = new FlyController(fb, brain, { idle: clips['Idle_A'], walk: clips['Walk'], lay: clips['LayToIdle'] }, refRoot, task);
    ctl.groundY = 0;
    ctl.start(0);
    // upAt: quando e' in piedi (-1 = ancora a terra, solo per "alzarsi")
    simRef.current = { fb, ctl, sub: 0, downFor: 0, age: 0, straightSince: -1, upAt: task === 'getup' ? -1 : 0 };
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
  const lastPushRef = useRef(pushNonce);
  const nextAutoRef = useRef(2);
  // pesi nuovi: si applicano al prossimo episodio (non a meta')
  const pendingRef = useRef(false);
  useEffect(() => {
    pendingRef.current = true;
  }, [paramsVersion]);

  // Il cervello pensa agganciato ai passi di FISICA, non ai fotogrammi:
  // ogni 4 passi da 1/120 s un passo di controllo (30 Hz), esattamente come
  // in addestramento. Cosi' se il browser rallenta (per esempio mentre i
  // worker addestrano) animazione di riferimento e corpo restano a tempo.
  const assistRef = useRef(assist);
  assistRef.current = task === 'getup' ? assist : 0;
  useBeforePhysicsStep((w) => {
    const sim = simRef.current;
    if (!sim || paused) return;
    if (sim.sub === 0) {
      sim.ctl.control();
      sim.age += 1 / CONTROL_HZ;
    }
    sim.sub = (sim.sub + 1) % 4;
    if (assistRef.current > 0) assistUp(sim.fb, assistRef.current, (w as any).timestep ?? 1 / 120, sim.ctl.assistHipY, sim.ctl.assistChestY, sim.ctl.assistCentre);
  });

  useFrame((_s, delta) => {
    if (wantCreateRef.current) {
      wantCreateRef.current = false;
      createSim();
    }
    const sim = simRef.current;
    if (!sim || paused) return;
    const dt = Math.min(delta, 0.1);
    if (pushNonce !== lastPushRef.current) {
      lastPushRef.current = pushNonce;
      applyPush(sim.fb, 35, Math.random() * Math.PI * 2);
    }
    if (autoPush > 0 && sim.upAt >= 0) {  // in "alzarsi" solo dopo che si e' alzata
      nextAutoRef.current -= dt;
      if (nextAutoRef.current <= 0) {
        applyPush(sim.fb, autoPush * (0.6 + 0.4 * Math.random()), Math.random() * Math.PI * 2);
        nextAutoRef.current = 1.2 + Math.random() * 1.8;
      }
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
    // "in piedi" = testa sopra 1.2 m E corpo dritto (inclinato < 25 gradi):
    // il contatore misura il tempo di fila passato cosi'. "Alzarsi" conta
    // come riuscito dalla prima volta che ci arriva; da li' vale la regola di
    // "in piedi" (riparte solo se cade)
    const straight = isStanding(sim.fb);
    if (straight && sim.straightSince < 0) sim.straightSince = sim.age;
    if (!straight) sim.straightSince = -1;
    if (sim.upAt < 0 && straight) sim.upAt = sim.age;
    const isUp = sim.upAt >= 0;
    const down = isUp && head.y < 0.9;
    sim.downFor = down ? sim.downFor + dt : 0;
    status.current.upFor = sim.straightSince >= 0 ? sim.age - sim.straightSince : 0;
    status.current.bestUp = Math.max(status.current.bestUp, status.current.upFor);
    const far = Math.hypot(hip.x - x, hip.z) > 25;
    if (sim.downFor > 1.2 || (!isUp && sim.age > episodeSeconds) || far || !Number.isFinite(hip.y) || (pendingRef.current && sim.downFor > 0.3)) {
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
