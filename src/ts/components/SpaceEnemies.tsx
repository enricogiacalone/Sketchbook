import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '../lib/gltf';
import { useStore } from '../store';
import { planetCatalog } from '../lib/planet';
import { PLANET_R, planetCenterUniv, siteToUniv, spaceTime, univToSite } from '../lib/space';
import { addSpaceFlyer, removeSpaceFlyer } from './city/cityActors';
import { registerBlastTarget } from '../lib/explosions';
import { makeFighter } from './Environment/DuelArena';
import Explosion from './Environment/Explosion';

// I droni nemici interstellari (come i bersagli di github.com/blaze33/droneWorld, che girano in tondo con 100 di vita e
// fumano a meta'): pattugliano il sistema solare. Ognuno ha una rotta: vola da un pianeta all'altro (transito), gira
// attorno al pianeta di arrivo per un po' (orbita) e riparte verso un altro. Se il drone del giocatore e' vicino lo
// attaccano (inseguimento: gli girano intorno e sparano a raffiche), e se lo perdono tornano in pattuglia. Sono bersagli
// veri del drone (HUD, aggancio, mitragliatrice, missili, vedi cityActors.spaceFlyers e Drone.tsx).
//
// La simulazione vive nell'UNIVERSO (le coordinate non cambiano quando il mondo si rimonta su un altro sito); per
// disegnarli e per far funzionare il drone si converte nel riferimento del sito a ogni frame.
const COUNT = 8;
const CRUISE = 7000; // m/s in transito
const ORBIT_K = 2.4; // raggio dell'orbita, in raggi del pianeta
const ORBIT_V = 380; // m/s in orbita
const ORBIT_S: [number, number] = [45, 95]; // s di sosta in orbita
const DETECT = 7000; // m: vedono il drone del giocatore
const LOSE = 18000; // m: lo perdono
const FIRE_RANGE = 650; // m
const STRAFE_R = 170; // m: il raggio del giro intorno al giocatore
const CHASE_V = 3200; // m/s massimo in inseguimento
const BOLT_SPEED = 520; // m/s
const BOLT_LIFE = 1.6; // s
const BOLT_HIT = 3.2; // m dal drone del giocatore
const BOLT_DAMAGE = 2.5;
const MAX_BOLTS = 48;
const RESPAWN_S = 25;
const MODEL_SCALE = 0.07; // drone.glb e' ~90 unita': ~6 m
const HP = 100;

type Mode = 'transit' | 'orbit' | 'chase';
interface Enemy {
  data: ReturnType<typeof makeFighter>;
  from: number;
  to: number;
  mode: Mode;
  pos: THREE.Vector3; // universo
  vel: THREE.Vector3;
  site: THREE.Vector3; // riferimento del sito (aggiornato ogni frame)
  orbitT: number;
  ang: number;
  u: THREE.Vector3;
  w: THREE.Vector3;
  blend: number;
  strafe: number;
  fireT: number;
  respawnT: number;
  seed: number;
}
interface Bolt {
  pos: THREE.Vector3; // universo
  vel: THREE.Vector3;
  age: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _pu = new THREE.Vector3();
const _pp = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _o = new THREE.Object3D();
const UP = new THREE.Vector3(0, 1, 0);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

const glowTexture = (() => {
  let tex: THREE.CanvasTexture | null = null;
  return () => {
    if (tex) return tex;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.15, 'rgba(255,120,90,0.9)');
    gr.addColorStop(0.5, 'rgba(255,40,20,0.22)');
    gr.addColorStop(1, 'rgba(255,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    tex = new THREE.CanvasTexture(c);
    return tex;
  };
})();

const planetSeeds = () => planetCatalog().map((p) => p.seed);

// un punto del sistema su una rotta (frazione 0..1 tra due pianeti), nell'universo
function pointOnRoute(a: number, b: number, k: number, out: THREE.Vector3) {
  const seeds = planetSeeds();
  const t = spaceTime();
  planetCenterUniv(seeds[a], t, _a);
  planetCenterUniv(seeds[b], t, _b);
  return out.copy(_a).lerp(_b, k);
}

function makeEnemy(i: number): Enemy {
  const data = makeFighter(`sd-${i}`, 'Drone nemico', 'CITY_ENEMY', 0, 0, 0);
  data.hp = HP;
  data.isPassive = true;
  return {
    data,
    from: 0,
    to: 1,
    mode: 'transit',
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    site: new THREE.Vector3(),
    orbitT: 0,
    ang: 0,
    u: new THREE.Vector3(1, 0, 0),
    w: new THREE.Vector3(0, 0, 1),
    blend: 0,
    strafe: Math.random() < 0.5 ? 1 : -1,
    fireT: rnd(1, 3),
    respawnT: 0,
    seed: Math.random() * 1000,
  };
}

// dove sta e che rotta fa quando nasce (o rinasce): a un punto casuale di una rotta tra due pianeti
function place(e: Enemy) {
  const n = planetSeeds().length;
  e.from = Math.floor(Math.random() * n);
  do e.to = Math.floor(Math.random() * n);
  while (e.to === e.from && n > 1);
  pointOnRoute(e.from, e.to, rnd(0.1, 0.9), e.pos);
  e.vel.set(0, 0, 0);
  e.mode = 'transit';
  e.blend = 0;
  e.data.hp = HP;
  e.data.isDead = false;
  e.respawnT = 0;
}

function nextRoute(e: Enemy) {
  const n = planetSeeds().length;
  e.from = e.to;
  do e.to = Math.floor(Math.random() * n);
  while (e.to === e.from && n > 1);
  e.mode = 'transit';
}

const SpaceEnemies: React.FC = () => {
  const { scene } = useGLTF('drone.glb');
  const enemies = useMemo(() => Array.from({ length: COUNT }, (_, i) => makeEnemy(i)), []);
  const groups = useRef<Array<THREE.Group | null>>([]);
  const glows = useRef<Array<THREE.Sprite | null>>([]);
  const bolts = useRef<Bolt[]>([]);
  const boltMesh = useRef<THREE.InstancedMesh>(null);
  const [booms, setBooms] = useState<Array<{ id: number; pos: [number, number, number] }>>([]);
  const boomId = useRef(0);

  // il modello: la stessa mesh del drone del giocatore, scura e con la luce rossa
  const models = useMemo(
    () =>
      enemies.map(() => {
        const c = scene.clone(true);
        c.traverse((o: any) => {
          if (o.isMesh) {
            const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((m: THREE.Material) => {
              const k = (m as THREE.MeshStandardMaterial).clone();
              if (k.color) k.color.multiply(new THREE.Color('#5a1f1f'));
              (k as THREE.MeshStandardMaterial).emissive = new THREE.Color('#ff2a10');
              (k as THREE.MeshStandardMaterial).emissiveIntensity = 0.45;
              return k;
            });
            o.material = Array.isArray(o.material) ? mats : mats[0];
            o.castShadow = false;
          }
        });
        return c;
      }),
    [enemies, scene]
  );

  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __spaceEnemies?: unknown }).__spaceEnemies = enemies;
    enemies.forEach((e) => {
      place(e);
      addSpaceFlyer(e.data);
    });
    const offs = enemies.map((e) =>
      registerBlastTarget(e.data.id, {
        pos: (out) => {
          if (e.data.isDead) return false;
          out.copy(e.data.position);
          return true;
        },
        onBlast: (ev) => {
          if (e.data.isDead) return;
          e.data.hp -= ev.damage * 1.4;
          if (e.data.hp <= 0) {
            e.data.hp = 0;
            e.data.isDead = true;
          }
        },
      })
    );
    return () => {
      enemies.forEach((e) => removeSpaceFlyer(e.data));
      offs.forEach((f) => f());
    };
  }, [enemies]);

  const spawnBolt = (from: THREE.Vector3, to: THREE.Vector3, vel: THREE.Vector3) => {
    _a.copy(to).sub(from);
    const dist = _a.length();
    // anticipo: dove sara' il giocatore quando arriva il colpo
    _a.addScaledVector(vel, dist / BOLT_SPEED).normalize();
    _a.x += (Math.random() - 0.5) * 0.02;
    _a.y += (Math.random() - 0.5) * 0.02;
    _a.z += (Math.random() - 0.5) * 0.02;
    if (bolts.current.length >= MAX_BOLTS) bolts.current.shift();
    bolts.current.push({ pos: from.clone(), vel: _a.clone().normalize().multiplyScalar(BOLT_SPEED), age: 0 });
  };

  const playerVel = useRef(new THREE.Vector3());
  const lastPlayer = useRef<THREE.Vector3 | null>(null);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const t = spaceTime();
    const st = useStore.getState();
    const seeds = planetSeeds();
    if (seeds.length < 2) return;
    // il giocatore (solo il suo drone conta): universo e velocita'
    const hasDrone = st.isDrone && st.health > 0;
    if (hasDrone) {
      siteToUniv(_pp.set(st.playerPos[0], st.playerPos[1], st.playerPos[2]), _pu, t);
      if (lastPlayer.current) playerVel.current.copy(_pu).sub(lastPlayer.current).divideScalar(Math.max(dt, 1e-3)).clampLength(0, 40000);
      else playerVel.current.set(0, 0, 0);
      if (!lastPlayer.current) lastPlayer.current = new THREE.Vector3();
      lastPlayer.current.copy(_pu);
    } else lastPlayer.current = null;

    enemies.forEach((e, i) => {
      const g = groups.current[i];
      const glow = glows.current[i];
      if (e.data.isDead) {
        // botto, via il modello, rinasce piu' tardi
        if (e.respawnT === 0) {
          e.respawnT = RESPAWN_S;
          const id = boomId.current++;
          setBooms((l) => [...l, { id, pos: [e.site.x, e.site.y, e.site.z] }]);
        }
        e.respawnT -= dt;
        if (g) g.visible = false;
        if (e.respawnT <= 0) place(e);
        return;
      }
      planetCenterUniv(seeds[e.to % seeds.length], t, _c);
      const R = PLANET_R * ORBIT_K;
      // il giocatore e' vicino?
      let dP = Infinity;
      if (hasDrone) dP = e.pos.distanceTo(_pu);
      if (hasDrone && e.mode !== 'chase' && dP < DETECT) {
        e.mode = 'chase';
        e.fireT = rnd(1.5, 3);
      } else if (e.mode === 'chase' && (!hasDrone || dP > LOSE)) {
        nextRoute(e);
      }

      if (e.mode === 'transit') {
        // verso un punto dell'orbita del pianeta d'arrivo, dal lato da cui si arriva
        _a.copy(e.pos).sub(_c).normalize().multiplyScalar(R).add(_c);
        _b.copy(_a).sub(e.pos);
        const dist = _b.length();
        const sp = Math.min(CRUISE, dist * 0.3 + ORBIT_V);
        _b.normalize().multiplyScalar(sp);
        e.vel.lerp(_b, 1 - Math.exp(-dt * 1.4));
        e.pos.addScaledVector(e.vel, dt);
        if (e.pos.distanceTo(_c) < R * 1.12) {
          e.mode = 'orbit';
          e.orbitT = rnd(ORBIT_S[0], ORBIT_S[1]);
          e.u.copy(e.pos).sub(_c).normalize();
          // piano d'orbita: un'inclinazione a caso attorno alla direzione d'arrivo
          _a.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).cross(e.u).normalize();
          e.w.copy(e.u).cross(_a).normalize();
          e.ang = 0;
          e.blend = 0;
        }
      } else if (e.mode === 'orbit') {
        e.ang += (ORBIT_V / R) * dt;
        e.blend = Math.min(1, e.blend + dt / 3);
        _a.copy(e.u).multiplyScalar(Math.cos(e.ang)).addScaledVector(e.w, Math.sin(e.ang)).multiplyScalar(R + Math.sin(t * 0.3 + e.seed) * 250).add(_c);
        _b.copy(e.pos);
        e.pos.lerp(_a, e.blend > 0.999 ? 1 : 1 - Math.exp(-dt * 2 * (0.2 + e.blend)));
        e.vel.copy(e.pos).sub(_b).divideScalar(Math.max(dt, 1e-3));
        e.orbitT -= dt;
        if (e.orbitT <= 0) nextRoute(e);
      } else {
        // inseguimento: gira intorno al giocatore a STRAFE_R e si avvicina in fretta da lontano
        _b.copy(e.pos).sub(_pu);
        const d = Math.max(1, _b.length());
        _b.divideScalar(d);
        // la direzione "di lato" per girargli intorno
        _a.crossVectors(_b, UP);
        if (_a.lengthSq() < 1e-6) _a.set(1, 0, 0);
        _a.normalize().multiplyScalar(e.strafe);
        _c.copy(_pu).addScaledVector(_b, STRAFE_R).addScaledVector(_a, STRAFE_R * 0.9).addScaledVector(playerVel.current, 0.25);
        _a.copy(_c).sub(e.pos);
        const dist = _a.length();
        const sp = Math.min(CHASE_V, dist * 1.3 + 40);
        _a.normalize().multiplyScalar(sp).addScaledVector(playerVel.current, dist < 900 ? 1 : 0);
        e.vel.lerp(_a, 1 - Math.exp(-dt * 2.2));
        e.pos.addScaledVector(e.vel, dt);
        // fuoco a raffiche (3 colpi) quando e' a tiro
        e.fireT -= dt;
        if (dP < FIRE_RANGE && e.fireT <= 0) {
          e.fireT = rnd(1.4, 2.6);
          for (let k = 0; k < 3; k++) window.setTimeout(() => !e.data.isDead && spawnBolt(e.pos, _pu, playerVel.current), k * 110);
        }
      }

      // nel riferimento del sito: per disegnarlo e per il drone del giocatore
      univToSite(e.pos, e.site, t);
      e.data.position.copy(e.site);
      if (g) {
        g.visible = true;
        g.position.copy(e.site);
        // muso nella direzione del moto
        if (e.vel.lengthSq() > 1) {
          univToSite(_a.copy(e.pos).add(e.vel), _b, t);
          _o.position.copy(e.site);
          _o.up.copy(UP);
          _o.lookAt(_b);
          g.quaternion.slerp(_o.quaternion, 1 - Math.exp(-dt * 6));
        }
      }
      if (glow) {
        // un punto luminoso sempre visibile da lontano (dimensione minima sullo schermo)
        const dc = state.camera.position.distanceTo(e.site);
        const s = Math.max(40, dc * 0.006);
        glow.scale.set(s, s, 1);
        (glow.material as THREE.SpriteMaterial).opacity = e.data.hp < 50 ? 0.55 + 0.45 * Math.abs(Math.sin(t * 9 + e.seed)) : 0.95;
        (glow.material as THREE.SpriteMaterial).color.set(e.data.hp < 50 ? '#ff9a2a' : '#ff3322');
      }
    });

    // i colpi dei nemici (nell'universo; si disegnano nel sito)
    const list = bolts.current;
    const mesh = boltMesh.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      b.age += dt;
      b.pos.addScaledVector(b.vel, dt);
      let dead = b.age > BOLT_LIFE;
      if (!dead && hasDrone && b.pos.distanceTo(_pu) < BOLT_HIT) {
        dead = true;
        // niente colpo di grazia: sotto il 30% di vita smettono di fare danno
        if (st.health > 30) st.takeDamage(BOLT_DAMAGE);
      }
      if (dead) list.splice(i, 1);
    }
    if (mesh) {
      for (let i = 0; i < MAX_BOLTS; i++) {
        const b = list[i];
        if (b) {
          univToSite(b.pos, _a, t);
          univToSite(_c.copy(b.pos).add(b.vel), _b, t);
          _o.position.copy(_a);
          _o.up.copy(UP);
          _o.lookAt(_b);
          _o.scale.set(1, 1, 1);
          _o.updateMatrix();
          _m.copy(_o.matrix);
        } else {
          _m.makeScale(0, 0, 0);
        }
        mesh.setMatrixAt(i, _m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    void _q;
  });

  return (
    <group dispose={null}>
      {enemies.map((e, i) => (
        <group key={e.data.id} ref={(g) => {
            groups.current[i] = g;
          }} visible={false}>
          <group rotation={[-Math.PI / 2, 0, 0]} scale={MODEL_SCALE}>
            <primitive object={models[i]} />
          </group>
          <sprite ref={(sp) => {
              glows.current[i] = sp;
            }} scale={[40, 40, 1]} renderOrder={6}>
            <spriteMaterial map={glowTexture()} color="#ff3322" transparent depthWrite={false} blending={THREE.AdditiveBlending} fog={false} />
          </sprite>
        </group>
      ))}
      <instancedMesh ref={boltMesh} args={[undefined, undefined, MAX_BOLTS]} frustumCulled={false}>
        <boxGeometry args={[0.14, 0.14, 6]} />
        <meshBasicMaterial color="#ff4a2a" toneMapped={false} fog={false} />
      </instancedMesh>
      {booms.map((b) => (
        <Explosion key={b.id} position={b.pos} scale={4} color="#ff7a30" onFinish={() => setBooms((l) => l.filter((x) => x.id !== b.id))} />
      ))}
    </group>
  );
};

export default SpaceEnemies;
