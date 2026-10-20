import * as THREE from 'three';
import { hEff, PLANET_RADIUS as R, surfaceHeight, surfaceInfo, type SurfaceInfo } from './planetSurface';

// Un "sito" e' il punto del pianeta dove si e' montato il mondo di gioco: il riferimento di gioco ha
// l'origine li', con l'alto (+Y) lungo la normale della superficie. La citta' e' al polo nord del
// pianeta (sito 'city', riferimento = quello dell'universo); atterrando altrove il mondo si monta
// su un sito 'wild' (terreno procedurale, boschi, rocce) con un riferimento ruotato (rebase con
// rotazione, lib/space.ts siteTransform). Il terreno del sito segue la curvatura del pianeta e il
// suo rilievo (lib/planetSurface.ts), cosi' coincide con la sfera vista dallo spazio.
export type SiteKind = 'city' | 'wild';

export interface Site {
  id: string;
  planetSeed: number;
  n: [number, number, number]; // normale (direzione dal centro del pianeta), nel riferimento del pianeta/universo
  kind: SiteKind;
  quat: THREE.Quaternion; // universo -> sito (porta n su +Y)
  hN: number; // quota effettiva della superficie in n
}

export const CITY_SNAP = 600 / R; // rad: entro questo angolo dal polo il sito e' la citta'
const UP = new THREE.Vector3(0, 1, 0);

export function makeSite(planetSeed: number, nx: number, ny: number, nz: number): Site {
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  const ang = Math.acos(Math.min(1, Math.max(-1, ny)));
  let kind: SiteKind = 'wild';
  if (ang < CITY_SNAP) {
    kind = 'city';
    nx = 0;
    ny = 1;
    nz = 0;
  }
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(nx, ny, nz), UP);
  const hN = hEff(surfaceHeight(planetSeed, nx, ny, nz));
  const id = kind === 'city' ? `${planetSeed}:city` : `${planetSeed}:${nx.toFixed(4)},${ny.toFixed(4)},${nz.toFixed(4)}`;
  return { id, planetSeed, n: [nx, ny, nz], kind, quat, hN };
}
export const citySite = (planetSeed: number) => makeSite(planetSeed, 0, 1, 0);

let current: Site = citySite(1);
export const getCurrentSite = (): Site => current;
export const setCurrentSite = (s: Site) => {
  current = s;
};

// --- terreno selvaggio del sito ------------------------------------------------------------------
// quota (m) del terreno in (x, z) nel riferimento del sito: la superficie del pianeta proiettata
// radialmente sul piano tangente al sito (curvatura + rilievo), 0 nell'origine.
const _qi = new THREE.Quaternion();
const _v = new THREE.Vector3();
let _cacheSite: Site | null = null;
function prep(s: Site) {
  if (_cacheSite !== s) {
    _qi.copy(s.quat).invert();
    _cacheSite = s;
  }
}
// direzione del pianeta (riferimento dell'universo) di un punto locale (x, y, z): serve a campionare il pianeta
export function planetDirOf(s: Site, x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  prep(s);
  out.set(x, R + s.hN + y, z).normalize();
  return out.applyQuaternion(_qi);
}
// Il terreno e' la VERA superficie sferica del pianeta vista dal sito: il punto sul piano (x, z) e' quello a distanza
// laterale x, z dal sito, cioe' angolo phi dal sito con (R + h) sin(phi) = r (h dipende dalla direzione: due
// iterazioni). Cosi' coincide con la sfera e con i livelli di dettaglio (PlanetLOD.tsx), senza distorsioni.
let _h = 0; // quota (grezza, senza il pavimento) del punto risolto
let _y = 0; // quota locale
function solveSite(x: number, z: number, s: Site) {
  prep(s);
  const cy = R + s.hN;
  const r = Math.hypot(x, z);
  let phi = Math.asin(Math.min(0.98, r / R));
  const ux = r > 1e-6 ? x / r : 0, uz = r > 1e-6 ? z / r : 0;
  for (let i = 0; i < 3; i++) {
    const sp = Math.sin(phi);
    _v.set(sp * ux, Math.cos(phi), sp * uz).applyQuaternion(_qi);
    _h = surfaceHeight(s.planetSeed, _v.x, _v.y, _v.z);
    phi = Math.asin(Math.min(0.98, r / (R + hEff(_h))));
  }
  const sp = Math.sin(phi);
  _v.set(sp * ux, Math.cos(phi), sp * uz).applyQuaternion(_qi);
  _y = (R + hEff(_h)) * Math.cos(phi) - cy;
}
export function wildHeight(x: number, z: number, s: Site = current): number {
  solveSite(x, z, s);
  return _y;
}
export function wildInfo(x: number, z: number, s: Site = current): SurfaceInfo {
  solveSite(x, z, s);
  return surfaceInfo(s.planetSeed, _v.x, _v.y, _v.z, _h);
}

// quota e informazioni del bioma in (x, z) con UNA sola risoluzione della direzione (per la costruzione del terreno)
export const wildSampleInfo: { y: number; info: SurfaceInfo } = { y: 0, info: { h: 0, forest: 0, snow: 0, rock: 0, sand: 0 } };
export function wildSample(x: number, z: number, s: Site): typeof wildSampleInfo {
  solveSite(x, z, s);
  wildSampleInfo.y = _y;
  wildSampleInfo.info = surfaceInfo(s.planetSeed, _v.x, _v.y, _v.z, _h);
  return wildSampleInfo;
}

// direzione del pianeta (riferimento dell'universo) del punto del terreno in (x, z)
export function wildDir(x: number, z: number, s: Site, out: THREE.Vector3): THREE.Vector3 {
  solveSite(x, z, s);
  return out.copy(_v);
}
