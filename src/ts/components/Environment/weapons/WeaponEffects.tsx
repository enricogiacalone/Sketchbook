import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { drainShotFx, type ShotFx } from './weaponFx';

// Effetti di sparo (ispirati alla descrizione di Dusterheim: traccianti
// "world-locked", lampo alla canna, fori e particelle d'impatto). Tutto
// riciclato da pool fissi: nessuna mesh creata per colpo.
const MAX_TRACERS = 16;
const TRACER_SPEED = 320; // m/s
const TRACER_MAX_LEN = 4; // m
const MAX_FLASHES = 6;
const FLASH_LIFE = 0.05;
const MAX_BURSTS = 16;
const SPARKS_PER_BURST = 12;
const SPARK_LIFE = 0.35;
const MAX_DECALS = 60;

const SURFACE_SPARK_COLOR: Record<string, THREE.Color> = {
  world: new THREE.Color('#ffc66b'),
  body: new THREE.Color('#8a0f0f'),
  bag: new THREE.Color('#c9b089'),
  none: new THREE.Color('#ffc66b'),
};

function radialTexture(inner: string, outer: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Tracer { active: boolean; from: THREE.Vector3; dir: THREE.Vector3; dist: number; t: number }
interface Flash { active: boolean; t: number }

const _yAxis = new THREE.Vector3(0, 1, 0);
const _tmp = new THREE.Vector3();

const WeaponEffects: React.FC = () => {
  const tracerMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const flashSprites = useRef<(THREE.Sprite | null)[]>([]);
  const decalMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);
  const pointsRef = useRef<THREE.Points>(null);

  const state = useMemo(() => {
    const tracers: Tracer[] = Array.from({ length: MAX_TRACERS }, () => ({
      active: false, from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, t: 0,
    }));
    const flashes: Flash[] = Array.from({ length: MAX_FLASHES }, () => ({ active: false, t: 0 }));
    const nSparks = MAX_BURSTS * SPARKS_PER_BURST;
    const sparkPos = new Float32Array(nSparks * 3).fill(-10000);
    const sparkCol = new Float32Array(nSparks * 3);
    const sparkVel = new Float32Array(nSparks * 3);
    const sparkLife = new Float32Array(nSparks);
    const sparkBase = new Float32Array(nSparks * 3);
    return { tracers, flashes, nextTracer: 0, nextFlash: 0, nextBurst: 0, nextDecal: 0, sparkPos, sparkCol, sparkVel, sparkLife, sparkBase, lightT: 1 };
  }, []);

  const tex = useMemo(
    () => ({
      flash: radialTexture('rgba(255,240,200,1)', 'rgba(255,120,20,0)'),
      spark: radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)'),
      decal: radialTexture('rgba(10,10,10,0.95)', 'rgba(20,20,20,0)'),
    }),
    []
  );
  const tracerGeom = useMemo(() => new THREE.CylinderGeometry(0.006, 0.006, 1, 5, 1, true), []);
  const decalGeom = useMemo(() => new THREE.PlaneGeometry(0.07, 0.07), []);
  const sparkGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(state.sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(state.sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
    return g;
  }, [state]);

  const spawn = (fx: ShotFx) => {
    // tracciante
    const tr = state.tracers[state.nextTracer];
    state.nextTracer = (state.nextTracer + 1) % MAX_TRACERS;
    tr.active = true;
    tr.from.copy(fx.from);
    tr.dir.copy(fx.to).sub(fx.from);
    tr.dist = tr.dir.length();
    if (tr.dist > 1e-4) tr.dir.divideScalar(tr.dist);
    tr.t = 0;
    // lampo
    const fl = state.flashes[state.nextFlash];
    const sprite = flashSprites.current[state.nextFlash];
    state.nextFlash = (state.nextFlash + 1) % MAX_FLASHES;
    fl.active = true;
    fl.t = 0;
    if (sprite) {
      sprite.position.copy(fx.from);
      const s = 0.18 + Math.random() * 0.12;
      sprite.scale.set(s, s, s);
      (sprite.material as THREE.SpriteMaterial).rotation = Math.random() * Math.PI * 2;
    }
    if (lightRef.current) {
      lightRef.current.position.copy(fx.from);
      state.lightT = 0;
    }
    if (fx.surface === 'none') return;
    // scintille / schizzi
    const b = state.nextBurst;
    state.nextBurst = (state.nextBurst + 1) % MAX_BURSTS;
    const n = fx.normal ?? _tmp.copy(fx.from).sub(fx.to).normalize();
    const col = SURFACE_SPARK_COLOR[fx.surface];
    for (let i = 0; i < SPARKS_PER_BURST; i++) {
      const k = b * SPARKS_PER_BURST + i;
      state.sparkPos.set([fx.to.x, fx.to.y, fx.to.z], k * 3);
      // emisfero attorno alla normale
      let vx = Math.random() * 2 - 1, vy = Math.random() * 2 - 1, vz = Math.random() * 2 - 1;
      const d = vx * n.x + vy * n.y + vz * n.z;
      if (d < 0) { vx -= 2 * d * n.x; vy -= 2 * d * n.y; vz -= 2 * d * n.z; }
      const sp = 1.5 + Math.random() * 3;
      const len = Math.hypot(vx, vy, vz) || 1;
      state.sparkVel.set([(vx / len + n.x * 0.6) * sp, (vy / len + n.y * 0.6) * sp, (vz / len + n.z * 0.6) * sp], k * 3);
      state.sparkLife[k] = SPARK_LIFE * (0.6 + Math.random() * 0.4);
      state.sparkBase.set([col.r, col.g, col.b], k * 3);
    }
    // foro
    if (fx.decal && fx.normal) {
      const m = decalMeshes.current[state.nextDecal];
      state.nextDecal = (state.nextDecal + 1) % MAX_DECALS;
      if (m) {
        m.visible = true;
        m.position.copy(fx.to).addScaledVector(fx.normal, 0.003);
        m.lookAt(_tmp.copy(m.position).add(fx.normal));
        m.rotateZ(Math.random() * Math.PI * 2);
        const s = 0.8 + Math.random() * 0.5;
        m.scale.set(s, s, s);
      }
    }
  };

  useFrame((_s, delta) => {
    for (const fx of drainShotFx()) spawn(fx);
    const dt = Math.min(delta, 0.05);
    // traccianti
    for (let i = 0; i < MAX_TRACERS; i++) {
      const tr = state.tracers[i];
      const mesh = tracerMeshes.current[i];
      if (!mesh) continue;
      if (!tr.active) { if (mesh.visible) mesh.visible = false; continue; }
      tr.t += dt;
      // scia lunga al massimo TRACER_MAX_LEN (e mai piu' di meta' del
      // tragitto); velocita' ridotta sui colpi corti cosi' la scia resta
      // visibile almeno ~3 frame invece di uno solo.
      const len = Math.min(TRACER_MAX_LEN, tr.dist * 0.5);
      const speed = Math.min(TRACER_SPEED, (tr.dist + len) / 0.05);
      const front = tr.t * speed;
      const head = Math.min(tr.dist, front);
      const tail = Math.max(0, front - len);
      if (tail >= tr.dist - 1e-3 || tr.t > 1) { tr.active = false; mesh.visible = false; continue; }
      mesh.visible = true;
      mesh.position.copy(tr.from).addScaledVector(tr.dir, (head + tail) / 2);
      mesh.quaternion.setFromUnitVectors(_yAxis, tr.dir);
      mesh.scale.set(1, Math.max(0.01, head - tail), 1);
    }
    // lampi
    for (let i = 0; i < MAX_FLASHES; i++) {
      const fl = state.flashes[i];
      const sp = flashSprites.current[i];
      if (!sp) continue;
      if (!fl.active) { if (sp.visible) sp.visible = false; continue; }
      fl.t += dt;
      sp.visible = fl.t < FLASH_LIFE;
      if (!sp.visible) fl.active = false;
    }
    if (lightRef.current) {
      state.lightT += dt;
      lightRef.current.intensity = state.lightT < 0.06 ? 6 * (1 - state.lightT / 0.06) : 0;
    }
    // scintille
    let any = false;
    for (let k = 0; k < state.sparkLife.length; k++) {
      if (state.sparkLife[k] <= 0) continue;
      any = true;
      state.sparkLife[k] -= dt;
      const i3 = k * 3;
      if (state.sparkLife[k] <= 0) {
        state.sparkPos[i3 + 1] = -10000;
        continue;
      }
      state.sparkVel[i3 + 1] -= 9.8 * dt;
      state.sparkPos[i3] += state.sparkVel[i3] * dt;
      state.sparkPos[i3 + 1] += state.sparkVel[i3 + 1] * dt;
      state.sparkPos[i3 + 2] += state.sparkVel[i3 + 2] * dt;
      const f = state.sparkLife[k] / SPARK_LIFE;
      state.sparkCol[i3] = state.sparkBase[i3] * f;
      state.sparkCol[i3 + 1] = state.sparkBase[i3 + 1] * f;
      state.sparkCol[i3 + 2] = state.sparkBase[i3 + 2] * f;
    }
    if (any) {
      sparkGeom.attributes.position.needsUpdate = true;
      sparkGeom.attributes.color.needsUpdate = true;
    }
  });

  return (
    <group>
      {Array.from({ length: MAX_TRACERS }).map((_, i) => (
        <mesh key={`tr${i}`} ref={(m) => { tracerMeshes.current[i] = m; }} geometry={tracerGeom} visible={false} frustumCulled={false}>
          <meshBasicMaterial color="#ffe3a0" transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
      {Array.from({ length: MAX_FLASHES }).map((_, i) => (
        <sprite key={`fl${i}`} ref={(s) => { flashSprites.current[i] = s; }} visible={false}>
          <spriteMaterial map={tex.flash} transparent blending={THREE.AdditiveBlending} depthWrite={false} />
        </sprite>
      ))}
      {Array.from({ length: MAX_DECALS }).map((_, i) => (
        <mesh key={`dc${i}`} ref={(m) => { decalMeshes.current[i] = m; }} geometry={decalGeom} visible={false}>
          <meshBasicMaterial map={tex.decal} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-4} />
        </mesh>
      ))}
      <points ref={pointsRef} geometry={sparkGeom} frustumCulled={false}>
        <pointsMaterial map={tex.spark} size={0.05} vertexColors transparent blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation />
      </points>
      <pointLight ref={lightRef} color="#ffb05a" intensity={0} distance={5} decay={2} />
    </group>
  );
};

export default WeaponEffects;
