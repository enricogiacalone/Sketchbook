import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { CapsuleCollider, RigidBody } from '@react-three/rapier';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { useGLTF } from '../../lib/gltf';
import { KIMODO_ANIMS_URL } from '../../lib/kimodo';
import { MANNEQUIN_ADDON_ANIMS_URL, MANNEQUIN_BASE_ANIMS_URL, MANNEQUIN_URL } from '../city/useMannequinActor';
import { getTerrainHeight } from '../Environment/Terrain';
import { useStore } from '../../store';

// Un personaggio della storia (StoryMission.tsx): lo stesso manichino della
// folla, ma leggero -- niente ragdoll ne' fisica dei segmenti, solo
// l'animazione (fermo, seduto, al telefono...), un collider fisso perche'
// non ci si passi attraverso e il nome sopra la testa. Si gira verso il
// giocatore quando ci si parla (o se `watch` e' acceso, quando e' vicino).

export interface StoryNpcProps {
  name: string;
  color: string;
  x: number;
  z: number;
  // verso dove guarda da fermo (rad, 0 = +Z)
  yaw: number;
  clip: string;
  // clip mentre ci si parla (di solito Idle_Talking / Sitting_Talking)
  talkClip?: string;
  talking?: boolean;
  // seduto: niente giro verso il giocatore, collider piu' basso
  seated?: boolean;
  // altezza dei piedi sopra il terreno (seduto su una sedia: la clip ha il
  // bacino all'altezza giusta con i piedi a terra)
  y?: number;
  // freccia gialla sopra la testa: e' lui il prossimo obiettivo
  marker?: boolean;
  watch?: boolean;
  // personaggio che si muove (Franco che scappa): posizione e direzione
  // scritte da fuori a ogni frame; niente collider fisso
  follow?: { x: number; z: number; yaw: number };
  // velocita' della clip (corsa)
  clipSpeed?: number;
  hidden?: boolean;
}

const NAME_DIST = 14; // m: il nome si vede da qui
const FAR_DIST = 70; // oltre: animazione a scatti, poi ferma
const _v = new THREE.Vector3();

const StoryNpc: React.FC<StoryNpcProps> = ({
  name,
  color,
  x,
  z,
  yaw,
  clip,
  talkClip,
  talking,
  seated,
  y = 0,
  marker,
  watch,
  follow,
  clipSpeed = 1,
  hidden,
}) => {
  const { scene } = useGLTF(MANNEQUIN_URL);
  const { animations: baseAnims } = useGLTF(MANNEQUIN_BASE_ANIMS_URL);
  const { animations: addonAnims } = useGLTF(MANNEQUIN_ADDON_ANIMS_URL);
  const { animations: kimodoAnims } = useGLTF(KIMODO_ANIMS_URL);
  const groupRef = useRef<THREE.Group>(null);
  const markerRef = useRef<THREE.Mesh>(null);
  const nameRef = useRef<HTMLDivElement>(null);
  const groundY = useMemo(() => getTerrainHeight(x, z) + y, [x, z, y]);

  const { clone, mixer, clips } = useMemo(() => {
    const c = SkeletonUtils.clone(scene);
    c.traverse((child: any) => {
      if (child.isSkinnedMesh) {
        child.material = child.material.clone();
        child.material.emissive = new THREE.Color(color);
        child.material.emissiveIntensity = 0.45;
        child.castShadow = true;
      }
    });
    const map: Record<string, THREE.AnimationClip> = {};
    for (const a of [...baseAnims, ...addonAnims, ...kimodoAnims]) map[a.name] = a;
    return { clone: c, mixer: new THREE.AnimationMixer(c), clips: map };
  }, [scene, baseAnims, addonAnims, kimodoAnims, color]);

  // clip attuale: cambia con dissolvenza
  const curRef = useRef<THREE.AnimationAction | null>(null);
  const want = talking && talkClip && clips[talkClip] ? talkClip : clips[clip] ? clip : 'Idle_A';
  useEffect(() => {
    const c = clips[want];
    if (!c) return;
    const a = mixer.clipAction(c);
    // (StrictMode riesegue l'effetto: la stessa azione non va spenta)
    if (curRef.current === a) return;
    a.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.3).play();
    // fasi diverse per personaggi con la stessa clip
    if (!curRef.current) a.time = Math.random() * c.duration;
    curRef.current?.fadeOut(0.3);
    curRef.current = a;
  }, [want, clips, mixer]);
  useEffect(() => {
    curRef.current?.setEffectiveTimeScale(clipSpeed);
  }, [clipSpeed, want]);
  useEffect(
    () => () => {
      mixer.stopAllAction();
      curRef.current = null;
    },
    [mixer]
  );

  const acc = useRef(0);
  useFrame((state, delta) => {
    const g = groupRef.current;
    if (!g) return;
    g.visible = !hidden;
    if (hidden) return;
    const px = follow ? follow.x : x;
    const pz = follow ? follow.z : z;
    if (follow) g.position.set(px, getTerrainHeight(px, pz) + y, pz);
    const pp = useStore.getState().playerPos;
    const dx = pp[0] - px;
    const dz = pp[2] - pz;
    const d = Math.hypot(dx, dz);
    // lontano: l'animazione si aggiorna meno spesso
    acc.current += delta;
    if (d < FAR_DIST || acc.current > 0.25) {
      mixer.update(acc.current);
      acc.current = 0;
    }
    // si gira verso il giocatore mentre ci parla (in piedi)
    let target = follow ? follow.yaw : yaw;
    if (!seated && (talking || (watch && d < 6)) && d > 0.3) target = Math.atan2(dx, dz);
    let a = target - g.rotation.y;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    g.rotation.y += a * Math.min(1, delta * 5);
    if (markerRef.current) {
      const t = state.clock.elapsedTime;
      markerRef.current.position.y = (seated ? 1.9 : 2.35) + Math.sin(t * 3) * 0.08;
      markerRef.current.rotation.y = t * 2;
    }
    if (nameRef.current) {
      _v.set(x, groundY, z);
      nameRef.current.style.opacity = d < NAME_DIST ? '1' : '0';
    }
  });

  return (
    <group ref={groupRef} position={[x, groundY, z]} rotation={[0, yaw, 0]}>
      <primitive object={clone} />
      {!follow && (
        <RigidBody type="fixed" colliders={false} position={[0, seated ? 0.6 : 0.9, 0]}>
          <CapsuleCollider args={[seated ? 0.25 : 0.55, 0.3]} />
        </RigidBody>
      )}
      {marker && (
        <mesh ref={markerRef} position={[0, 2.35, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.18, 0.4, 4]} />
          <meshBasicMaterial color="#ffd54a" />
        </mesh>
      )}
      <Html position={[0, seated ? 1.6 : 2.05, 0]} center distanceFactor={9} style={{ pointerEvents: 'none' }}>
        <div
          ref={nameRef}
          style={{
            color: '#fff',
            fontFamily: 'Arial, sans-serif',
            fontWeight: 700,
            fontSize: 15,
            whiteSpace: 'nowrap',
            textShadow: '0 0 3px #000, 0 0 6px #000',
            transition: 'opacity 0.3s',
            opacity: 0,
          }}
        >
          {name}
        </div>
      </Html>
    </group>
  );
};

export default StoryNpc;
