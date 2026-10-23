import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { styleFromSeed } from './planet';
import { PLANET_RADIUS } from './planetSurface';
import { sunPos, spaceState, type SpacePlanet } from './space';
import { getDayFactor, getSunDirection } from './SunCycle';

// L'acqua alla maniera di droneWorld (blaze33, src/ocean: Water2 di three + shader subacqueo): due mappe di
// normali che scorrono in direzioni diverse e si mescolano, riflesso alla Fresnel (di taglio l'acqua e' uno
// specchio del cielo, di fronte si vede il fondo colorato), il sole che si specchia in scintille nette, e sotto
// la superficie un mondo azzurro-verde con foschia fitta. Qui senza le mappe e senza i render target di
// riflesso/rifrazione (un secondo passaggio di scena e' troppo caro: il gioco e' limitato dalla CPU): le normali
// vengono da due rumori 3D che scorrono (gradiente), il riflesso e' il colore del cielo del pianeta.
const { Fn, float, vec3, uniform, positionWorld, cameraPosition, cameraViewMatrix, vec4, normalize, dot, time, smoothstep, pow, saturate, length, mix, attribute, mx_noise_float } = TSL as any;

interface WaterUniforms {
  center: any;
  sky: any;
  sunGlow: any;
  under: any;
}
interface Entry {
  p: SpacePlanet;
  u: WaterUniforms;
}
const registry = new Set<Entry>();

export function makeWaterMaterial(p: SpacePlanet): THREE.Material {
  const u: WaterUniforms = {
    center: uniform(new THREE.Vector3()),
    sky: uniform(new THREE.Color('#9fc4e8')),
    sunGlow: uniform(1),
    under: uniform(0),
  };
  const m: any = new MeshStandardNodeMaterial();
  m.roughness = 0.12;
  m.metalness = 0;
  m.side = THREE.DoubleSide;

  // normale dell'onda nel riferimento del mondo
  const flow1 = vec3(0.55, 0.0, 0.2);
  const flow2 = vec3(-0.3, 0.0, 0.5);
  const grad = (q: any) => {
    const e = 0.18;
    const f0 = mx_noise_float(q);
    return vec3(mx_noise_float(q.add(vec3(e, 0, 0))).sub(f0), mx_noise_float(q.add(vec3(0, e, 0))).sub(f0), mx_noise_float(q.add(vec3(0, 0, e))).sub(f0)).div(e);
  };
  const g1 = grad(positionWorld.mul(0.42).add(flow1.mul(time)));
  const g2 = grad(positionWorld.mul(1.9).add(flow2.mul(time.mul(1.3))));
  const g3 = grad(positionWorld.mul(0.06).add(vec3(0.07, 0, 0.03).mul(time)));
  const g = g1.mul(0.8).add(g2.mul(0.32)).add(g3.mul(1.4));
  const nS = normalize(positionWorld.sub(u.center));
  const tang = g.sub(nS.mul(dot(nS, g)));
  const dCam = length(cameraPosition.sub(positionWorld));
  // le onde si spianano da lontano (niente sfarfallio)
  const amp = float(0.17).mul(float(1).sub(smoothstep(120.0, 1400.0, dCam)));
  const nW = normalize(nS.sub(tang.mul(amp)));
  m.normalNode = cameraViewMatrix.mul(vec4(nW, 0.0)).xyz.normalize();

  // colore: il fondo (vertex color) piu' chiaro sulle creste, riflesso del cielo alla Fresnel
  const view = normalize(cameraPosition.sub(positionWorld));
  const ndv = saturate(dot(nW, view));
  const fres = float(0.03).add(float(0.97).mul(pow(float(1).sub(ndv), 5.0)));
  const crest = smoothstep(0.55, 1.1, g1.length().add(g2.length().mul(0.5)));
  const base = attribute('color', 'vec3').mul(float(1).add(crest.mul(0.18)));
  m.colorNode = base;
  // sott'acqua il "cielo" riflesso e' il verde-azzurro dell'acqua stessa
  const reflected = mix(u.sky, vec3(0.05, 0.28, 0.34), u.under);
  m.emissiveNode = reflected.mul(fres).mul(0.85).add(base.mul(0.04));
  const entry: Entry = { p, u };
  registry.add(entry);
  const dispose = m.dispose.bind(m);
  m.dispose = () => {
    registry.delete(entry);
    dispose();
  };
  return m;
}

const _c = new THREE.Color();
const _d = new THREE.Vector3();
// aggiorna le uniformi di tutta l'acqua (una volta a frame) e calcola se la camera e' sott'acqua
export function updateWater(camera: THREE.Camera, elapsed: number) {
  const dir = getSunDirection(elapsed);
  const day = getDayFactor(dir.y);
  let under = false;
  for (const { p, u } of registry) {
    const c = p.center;
    (u.center.value as THREE.Vector3).set(c[0], c[1], c[2]);
    // il cielo del pianeta: la sua foschia di giorno, quasi nero di notte
    _c.set(styleFromSeed(p.profile.seed).fogTint).multiplyScalar(0.35 + 0.65 * day);
    _c.lerp(new THREE.Color('#06101f'), 1 - day);
    (u.sky.value as THREE.Color).copy(_c);
    _d.set(camera.position.x - c[0], camera.position.y - c[1], camera.position.z - c[2]);
    const dist = _d.length();
    // sotto il livello del mare (sfera di raggio R) e non dentro la terra: la superficie sta a R + 0.05
    const below = dist < PLANET_RADIUS + 0.02 && dist > PLANET_RADIUS - 400;
    (u.under.value as number) += ((below ? 1 : 0) - (u.under.value as number)) * 0.2;
    if (below) under = true;
  }
  // (prove dalla console: window.__forceUnder = true)
  if ((window as unknown as { __forceUnder?: boolean }).__forceUnder) under = true;
  const target = under ? 1 : 0;
  spaceState.underwater += (target - spaceState.underwater) * 0.15;
  void sunPos;
}
