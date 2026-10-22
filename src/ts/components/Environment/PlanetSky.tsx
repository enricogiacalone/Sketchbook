import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { styleFromSeed } from '../../lib/planet';
import { hashKey } from '../../lib/globalGrid';
import { PLANET_R, siteFrame, sunPos, type SpacePlanet } from '../../lib/space';

// L'aria di un pianeta vista da fuori: un guscio di atmosfera (alone azzurro sul bordo, piu' forte dal lato
// del sole e arancio verso il terminatore) e uno strato di nuvole procedurali (rumore frattale con ombra propria
// e bordo notte), che ruotano col vento come le nuvole vicine (Clouds.tsx: stesso asse e stessa velocita').
// Entrambi compaiono salendo: le nuvole a sprite stanno in basso, lo strato prende il loro posto da ~0.5 a 1.5 km.
const {
  Fn, float, vec3, vec4, uniform, positionWorld, positionLocal, cameraPosition, normalize, dot, smoothstep, mix, pow, clamp, abs, max,
  mx_fractal_noise_float,
} = TSL as any;

export const ATMO_K = 1.16; // raggio del guscio dell'atmosfera (in raggi del pianeta)
export const CLOUD_ALT = 330; // m sul raggio base: lo strato di nuvole
const R = PLANET_R;
const R_CLOUD = R + CLOUD_ALT;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qwind = new THREE.Quaternion();
const _axis = new THREE.Vector3();

const PlanetSky: React.FC<{ p: SpacePlanet }> = ({ p }) => {
  const style = useMemo(() => styleFromSeed(p.profile.seed), [p.profile.seed]);
  const seed = p.profile.seed | 0;
  const cloudGroup = useRef<THREE.Group>(null);
  const atmoMesh = useRef<THREE.Mesh>(null);
  const cloudMesh = useRef<THREE.Mesh>(null);

  const u = useMemo(
    () => ({
      center: uniform(new THREE.Vector3()),
      sun: uniform(new THREE.Vector3(0, 1, 0)), // dal pianeta verso il sole (riferimento del sito)
      sunLocal: uniform(new THREE.Vector3(0, 1, 0)), // lo stesso, nel riferimento dello strato di nuvole
      tint: uniform(new THREE.Color(style.fogTint)),
      atmoFade: uniform(0),
      cloudFade: uniform(0),
      cover: uniform(Math.min(1.2, style.cloudiness)),
      offset: uniform(new THREE.Vector3(hashKey(1, 7, seed) * 40, hashKey(2, 7, seed) * 40, hashKey(3, 7, seed) * 40)),
    }),
    [style, seed]
  );

  const atmoMat = useMemo(() => {
    const m: any = new MeshBasicNodeMaterial();
    m.side = THREE.BackSide;
    m.transparent = true;
    m.depthWrite = false;
    m.blending = THREE.AdditiveBlending;
    m.colorNode = Fn(() => {
      const n = normalize(positionWorld.sub(u.center));
      const v = normalize(cameraPosition.sub(positionWorld));
      // sul guscio posteriore: nv va da 0 (bordo) a 1 (centro); il bordo del pianeta sta a nv ~ sqrt(1 - 1/K^2)
      const nv = abs(dot(n, v));
      const limb = Math.sqrt(1 - 1 / (ATMO_K * ATMO_K));
      const g = smoothstep(0.0, limb, nv);
      const glow = pow(g, 2.2);
      const sunl = dot(n, u.sun);
      const day = smoothstep(-0.28, 0.4, sunl);
      // arancio al terminatore, azzurro (colore dell'aria del pianeta) di giorno
      const warm = smoothstep(0.22, 0.0, abs(sunl)).mul(0.85);
      const blue = mix(vec3(0.22, 0.48, 1.0), u.tint.mul(0.9), 0.2);
      const col = mix(blue, vec3(1.0, 0.5, 0.25), warm);
      return vec4(col.mul(glow).mul(day).mul(2.4).mul(u.atmoFade), 1.0);
    })();
    return m;
  }, [u]);

  const cloudMat = useMemo(() => {
    const m: any = new MeshBasicNodeMaterial();
    m.transparent = true;
    m.depthWrite = false;
    m.side = THREE.FrontSide;
    const fbm = (pos: any) => mx_fractal_noise_float(pos, 3, 2.0, 0.5);
    const out = Fn(() => {
      const pl = positionLocal.add(u.offset);
      // grandi masse (sistemi) piu' un dettaglio fine
      const big = fbm(pl.div(1100.0));
      const det = fbm(pl.div(260.0).add(11.0));
      const n = big.add(det.mul(0.38));
      const thr = float(0.42).sub(u.cover.mul(0.38));
      const dens = smoothstep(thr, thr.add(0.3), n);
      // un'ombra morbida di se' stessa: lo stesso rumore spostato verso il sole
      const sh = fbm(pl.add(u.sunLocal.mul(70.0)).div(1100.0)).add(det.mul(0.38));
      const shadow = clamp(sh.sub(n).mul(2.2), 0.0, 0.45);
      const nrm = normalize(positionWorld.sub(u.center));
      const ndl = dot(nrm, u.sun);
      const lit = smoothstep(-0.12, 0.5, ndl);
      const warm = smoothstep(0.35, 0.0, abs(ndl)).mul(0.6);
      const dayCol = mix(vec3(0.74, 0.8, 0.92), vec3(1.0, 1.0, 1.0), clamp(lit.sub(shadow), 0.0, 1.0));
      const col = mix(dayCol, vec3(1.0, 0.72, 0.5), warm.mul(lit));
      const nightCol = vec3(0.03, 0.04, 0.08);
      const finalCol = mix(nightCol, col, lit.mul(0.92).add(0.08));
      // bordo: dalla distanza si perde il dettaglio fine, si sfuma verso il limbo
      const v = normalize(cameraPosition.sub(positionWorld));
      const edge = smoothstep(0.0, 0.25, dot(nrm, v));
      return vec4(finalCol, dens.mul(0.94).mul(edge).mul(u.cloudFade));
    });
    m.colorNode = out().xyz;
    m.opacityNode = out().w;
    return m;
  }, [u]);

  useFrame((state) => {
    const cam = state.camera.position;
    const center = p.center;
    // quota sul pianeta (rispetto al raggio base)
    const dist = Math.hypot(cam.x - center[0], cam.y - center[1], cam.z - center[2]);
    const alt = dist - R;
    // atmosfera: si vede da fuori, quando la camera e' ben sopra il guscio dell'aria bassa
    u.atmoFade.value = THREE.MathUtils.smoothstep(alt, 600, 1800);
    // nuvole: sopra lo strato (la camera sta piu' in alto di CLOUD_ALT), prendono il posto degli sprite
    u.cloudFade.value = THREE.MathUtils.smoothstep(dist - R_CLOUD, 120, 1100);
    if (atmoMesh.current) atmoMesh.current.visible = (u.atmoFade.value as number) > 0.002;
    if (cloudMesh.current) cloudMesh.current.visible = (u.cloudFade.value as number) > 0.002;

    // direzione del sole dal centro del pianeta
    const sp = sunPos();
    _v.set(sp[0] - center[0], sp[1] - center[1], sp[2] - center[2]).normalize();
    (u.sun.value as THREE.Vector3).copy(_v);
    (u.center.value as THREE.Vector3).set(center[0], center[1], center[2]);

    // vento: stesso asse e stessa velocita' delle nuvole a sprite (Clouds.tsx)
    const g = cloudGroup.current;
    if (g) {
      _axis.set(hashKey(1, 1, seed) - 0.5, hashKey(2, 1, seed) * 0.4 - 0.2, hashKey(3, 1, seed) - 0.5).normalize();
      const omega = (4 + hashKey(4, 1, seed) * 8) / R;
      _qwind.setFromAxisAngle(_axis, omega * state.clock.elapsedTime);
      // il gruppo e' nel riferimento del pianeta (ruota col sito): quaternione del vento sopra
      g.quaternion.copy(_qwind);
      _qa.copy(siteFrame.quat).multiply(_qwind).invert();
      _w.copy(_v).applyQuaternion(_qa);
      (u.sunLocal.value as THREE.Vector3).copy(_w);
    }
  });

  // niente smaltimento immediato (R3F lo fa a mondo smontato, quando i comandi del frame sono ancora in coda: errore
  // "buffer used in submit while destroyed"): le risorse si liberano un po' dopo
  const geos = useMemo(() => [new THREE.SphereGeometry(R * ATMO_K, 96, 64), new THREE.SphereGeometry(R_CLOUD, 192, 96)], []);
  React.useEffect(
    () => () => {
      window.setTimeout(() => {
        atmoMat.dispose();
        cloudMat.dispose();
        geos.forEach((g) => g.dispose());
      }, 2000);
    },
    [atmoMat, cloudMat, geos]
  );

  return (
    <>
      <mesh ref={atmoMesh} material={atmoMat} geometry={geos[0]} renderOrder={3} frustumCulled={false} visible={false} dispose={null} />
      <group ref={cloudGroup}>
        <mesh ref={cloudMesh} material={cloudMat} geometry={geos[1]} renderOrder={4} frustumCulled={false} visible={false} dispose={null} />
      </group>
    </>
  );
};

export default PlanetSky;
