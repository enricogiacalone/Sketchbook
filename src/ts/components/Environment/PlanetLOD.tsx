import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PLANET_RADIUS as R, hEff, surfaceColor, surfaceHeight, surfaceInfo } from '../../lib/planetSurface';
import { siteFrame, type SpacePlanet } from '../../lib/space';

// Livelli di dettaglio del pianeta attorno al punto sotto la camera ("nadir"): la sfera di base (SpacePlanets.tsx)
// ha celle da ~120 m; qui ci sono quadrati di terreno via via piu' fini (90, 36, 12, 4 m) centrati sul nadir, che si
// rigenerano a pezzetti mentre ci si muove. Stessa funzione di quota del terreno su cui si atterra
// (lib/planetSurface.ts), quindi scendendo si vede lo stesso pianeta con sempre piu' dettaglio e il terreno fisico del
// sito (4 m, quota esatta) si innesta senza salti.
//
// I livelli si sovrappongono (non ci sono buchi): ognuno e' abbassato di una frazione del suo passo, i piu' fini
// stanno sopra; ai bordi un livello scende verso la quota del livello piu' grossolano (cosi' non resta uno scalino).
// La sfera di base e' abbassata del suo passo (SpacePlanets.tsx, BASE_DROP).
const N = 64;
const LEVELS = [
  { half: 128, enable: 2600 },
  { half: 384, enable: 9000 },
  { half: 1152, enable: 9000 },
  { half: 2880, enable: 9000 },
].map((l) => ({ ...l, step: (2 * l.half) / N }));
const DROP = 0.12; // frazione del passo
export const BASE_STEP = 120;
const FRAME_BUDGET_MS = 6;

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const INDEX = (() => {
  const idx = new Uint32Array(N * N * 6);
  let q = 0;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, d = a + N + 1, e = d + 1;
      idx.set([a, d, b, b, d, e], q);
      q += 6;
    }
  return new THREE.BufferAttribute(idx, 1);
})();

const ROCK = new THREE.Color('#6a6560');

interface LevelState {
  mesh: THREE.Mesh | null;
  center: THREE.Vector3; // direzione del centro (nel riferimento del pianeta)
  built: boolean;
  job: Generator<void, void, void> | null;
  jobCenter: THREE.Vector3;
  pos: Float32Array;
  col: Float32Array;
}

function* buildJob(seed: number, level: (typeof LEVELS)[number], li: number, c: THREE.Vector3, pos: Float32Array, col: Float32Array): Generator<void, void, void> {
  const up = Math.abs(c.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const e1 = new THREE.Vector3().crossVectors(up, c).normalize();
  const e2 = new THREE.Vector3().crossVectors(c, e1).normalize();
  const dir = new THREE.Vector3();
  const colr = new THREE.Color();
  const dThis = DROP * level.step;
  const dNext = DROP * (li + 1 < LEVELS.length ? LEVELS[li + 1].step : BASE_STEP);
  let t0 = performance.now();
  for (let j = 0; j <= N; j++) {
    const z = -level.half + j * level.step;
    for (let i = 0; i <= N; i++) {
      const x = -level.half + i * level.step;
      dir.copy(c).addScaledVector(e1, x / R).addScaledVector(e2, z / R).normalize();
      const info = surfaceInfo(seed, dir.x, dir.y, dir.z);
      const h = hEff(info.h);
      const edge = smooth(0.7, 1, Math.max(Math.abs(x), Math.abs(z)) / level.half);
      const r = R + h - (dThis + (dNext - dThis) * edge);
      const k = (j * (N + 1) + i) * 3;
      pos[k] = dir.x * r;
      pos[k + 1] = dir.y * r;
      pos[k + 2] = dir.z * r;
      surfaceColor(seed, info, colr);
      col[k] = colr.r;
      col[k + 1] = colr.g;
      col[k + 2] = colr.b;
    }
    if (performance.now() - t0 > FRAME_BUDGET_MS) {
      yield;
      t0 = performance.now();
    }
  }
}

// le pendenze forti diventano roccia (come il terreno del sito, Terrain.tsx)
function applyRockOnSlopes(geo: THREE.BufferGeometry, col: Float32Array, pos: Float32Array) {
  const nor = geo.attributes.normal;
  const n = (N + 1) * (N + 1);
  const dir = new THREE.Vector3();
  for (let v = 0; v < n; v++) {
    const k = v * 3;
    dir.set(pos[k], pos[k + 1], pos[k + 2]).normalize();
    const up = nor.getX(v) * dir.x + nor.getY(v) * dir.y + nor.getZ(v) * dir.z;
    const w = smooth(0.3, 0.6, 1 - up);
    if (w <= 0) continue;
    // sott'acqua meno (il fondale)
    const f = w * (Math.hypot(pos[k], pos[k + 1], pos[k + 2]) > R ? 1 : 0.4);
    col[k] += (ROCK.r - col[k]) * f;
    col[k + 1] += (ROCK.g - col[k + 1]) * f;
    col[k + 2] += (ROCK.b - col[k + 2]) * f;
  }
}

const PlanetLOD: React.FC<{ p: SpacePlanet }> = ({ p }) => {
  const group = useRef<THREE.Group>(null);
  const seed = p.profile.seed;
  const material = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }), []);
  const levels = useMemo<LevelState[]>(
    () =>
      LEVELS.map(() => ({
        mesh: null,
        center: new THREE.Vector3(0, 1, 0),
        built: false,
        job: null,
        jobCenter: new THREE.Vector3(),
        pos: new Float32Array((N + 1) * (N + 1) * 3),
        col: new Float32Array((N + 1) * (N + 1) * 3),
      })),
    [seed] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const geos = useMemo(
    () =>
      LEVELS.map(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N + 1) * (N + 1) * 3), 3));
        g.setAttribute('color', new THREE.BufferAttribute(new Float32Array((N + 1) * (N + 1) * 3), 3));
        g.setIndex(INDEX);
        return g;
      }),
    [seed] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const camLocal = useMemo(() => new THREE.Vector3(), []);
  const qi = useMemo(() => new THREE.Quaternion(), []);
  const nadir = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    // el pianeta: posizione e rotazione nel riferimento del sito
    g.position.set(p.center[0], p.center[1], p.center[2]);
    g.quaternion.copy(siteFrame.quat);
    qi.copy(siteFrame.quat).invert();
    camLocal.set(state.camera.position.x - p.center[0], state.camera.position.y - p.center[1], state.camera.position.z - p.center[2]).applyQuaternion(qi);
    const dist = camLocal.length();
    const alt = dist - R;
    g.visible = alt < 9000;
    if (!g.visible) return;
    nadir.copy(camLocal).divideScalar(dist || 1);

    // quali livelli rigenerare: il nadir si e' mosso di piu' di un quarto del lato
    const t0 = performance.now();
    for (let li = 0; li < LEVELS.length; li++) {
      const L = LEVELS[li];
      const S = levels[li];
      if (alt > L.enable) {
        if (S.mesh) S.mesh.visible = false;
        continue;
      }
      if (!S.job) {
        const moved = Math.acos(Math.min(1, S.center.dot(nadir))) * R;
        if (!S.built || moved > L.half / 4) {
          S.jobCenter.copy(nadir);
          S.job = buildJob(seed, L, li, S.jobCenter, S.pos, S.col);
        }
      }
      if (S.job && performance.now() - t0 < FRAME_BUDGET_MS) {
        // un solo livello per frame, il piu' fine per primo; si continua fino al tempo a disposizione
        const r = S.job.next();
        if (r.done) {
          S.job = null;
          S.center.copy(S.jobCenter);
          const geo = geos[li];
          (geo.attributes.position.array as Float32Array).set(S.pos);
          geo.attributes.position.needsUpdate = true;
          geo.computeVertexNormals();
          const colArr = geo.attributes.color.array as Float32Array;
          colArr.set(S.col);
          applyRockOnSlopes(geo, colArr, S.pos);
          geo.attributes.color.needsUpdate = true;
          geo.computeBoundingSphere();
          S.built = true;
        }
      }
      if (S.mesh) S.mesh.visible = S.built;
    }
  });

  return (
    <group ref={group} visible={false}>
      {LEVELS.map((L, li) => (
        <mesh
          key={li}
          ref={(m) => {
            levels[li].mesh = m;
          }}
          geometry={geos[li]}
          material={material}
          frustumCulled={false}
          visible={false}
        />
      ))}
    </group>
  );
};

export default PlanetLOD;
