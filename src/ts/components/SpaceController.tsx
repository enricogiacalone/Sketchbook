import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import '../lib/rapierGuard';
import { useStore } from '../store';
import { applyWorldSeed, fetchJson } from '../lib/worldSeed';
import { warmWorld } from '../lib/worldWarmup';
import { SPACE_FAR, SUN_R, sunPos, droneRebase, PLANET_R, requestDroneRebase, siteFrame, siteTransform, spacePlanets, spaceState, type SpacePlanet } from '../lib/space';
import { getPlanet, mountPlanetWorld, planetCatalog, rebuildPlanetData, recreatePhysics, unmountWorld } from '../lib/planet';
import { getCurrentSite, makeSite, setCurrentSite, type Site } from '../lib/site';
import { hEff, surfaceHeight } from '../lib/planetSurface';

// Il cuore del viaggio nello spazio e dell'atterraggio OVUNQUE, sempre montato:
//  - quota sul corpo piu' vicino -> strati dell'atmosfera, limite di velocita' e piani della camera
//  - sito: il mondo di gioco e' montato su UN sito alla volta (un punto di un pianeta, lib/site.ts). Scendendo
//    sotto MOUNT_ALT su un pianeta il mondo si genera sotto il drone (terreno procedurale, boschi; la citta'
//    se si e' sul suo polo) e il riferimento si sposta li' (rebase con rotazione). Allontanandosi dal sito
//    (drone o a piedi) il mondo si rimonta sotto di te; salendo oltre UNMOUNT_ALT si smonta.
const MOUNT_ALT = 1500; // m sulla superficie: si monta il mondo sotto il drone
const UNMOUNT_ALT = 4000; // m: si smonta
const RESITE_WILD = 600; // m dal centro del sito (drone): si rimonta sotto di lui
const RESITE_CITY = 1000;
const RESITE_FOOT_WILD = 450; // a piedi
const RESITE_FOOT_CITY = 900;

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const _v = new THREE.Vector3();
const _qi = new THREE.Quaternion();

// il pianeta piu' vicino alla posizione p (riferimento del sito) con la sua quota sulla superficie e la
// direzione del punto sotto di p nel riferimento del pianeta
function nearestPlanet(p: [number, number, number], planets: SpacePlanet[]) {
  let best: { pl: SpacePlanet; alt: number; n: [number, number, number] } | null = null;
  _qi.copy(siteFrame.quat).invert();
  for (const pl of planets) {
    const dx = p[0] - pl.center[0], dy = p[1] - pl.center[1], dz = p[2] - pl.center[2];
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-3) continue;
    _v.set(dx / dist, dy / dist, dz / dist).applyQuaternion(_qi);
    const h = hEff(surfaceHeight(pl.profile.seed, _v.x, _v.y, _v.z));
    const alt = dist - PLANET_R - h;
    if (!best || alt < best.alt) best = { pl, alt, n: [_v.x, _v.y, _v.z] };
  }
  return best;
}

const SpaceController: React.FC = () => {
  const { camera } = useThree();
  const busy = useRef(false);
  const near = useRef(0.1);
  const last = useRef(0);
  const mountedAt = useRef(0);
  const wasDrone = useRef(false);
  const lastDrone = useRef<[number, number, number]>([0, 0, 0]);
  const lastDroneYaw = useRef(0);

  useEffect(() => {
    spaceState.resident = getPlanet();
    spaceState.site = getCurrentSite();
  }, []);

  useFrame((state) => {
    const st = useStore.getState();
    const p: [number, number, number] = st.isDrone ? (st.playerPos as [number, number, number]) : [camera.position.x, camera.position.y, camera.position.z];
    const planets = spacePlanets();
    const near0 = nearestPlanet(p, planets);

    // quota sul corpo piu' vicino (con il rilievo)
    const alt = near0 ? near0.alt : Infinity;
    spaceState.alt = alt;
    // direzione del sole vero (la luce nello spazio)
    const sp = sunPos();
    const sdx = sp[0] - p[0], sdy = sp[1] - p[1], sdz = sp[2] - p[2];
    const sl = Math.hypot(sdx, sdy, sdz) || 1;
    spaceState.sunDir = [sdx / sl, sdy / sl, sdz / sl];
    // strati dell'atmosfera: tutti continui, ognuno con la sua fascia di quota
    spaceState.t = smooth(400, 9000, alt);
    // il sole dello shader del cielo e quello vero devono coincidere gia' prima che il sole vero si veda
    spaceState.sunBlend = smooth(800, 4500, alt);
    spaceState.fog = Math.exp(-Math.max(0, alt) / 350); // l'aria sottile: la foschia cala esponenzialmente con la quota
    spaceState.cloud = 1 - smooth(500, 3200, alt); // poi le nuvole restano sotto
    const dk = smooth(1500, 11000, alt);
    spaceState.dark = dk * dk * (3 - 2 * dk); // il cielo si scurisce piano, fino al nero
    // Velocita': il limite cresce con la quota sul corpo piu' vicino (pianeta o sole)
    const speedAlt = Math.max(0, Math.min(alt, Math.hypot(sdx, sdy, sdz) - SUN_R));
    spaceState.vmax = Math.min(35000, 40 + 0.4 * speedAlt);
    spaceState.boost = Math.max(1, spaceState.vmax / 30);

    // piani della camera: vicino fine vicino al suolo, ampio nello spazio
    const wantNear = alt > 300 ? 1 : 0.1;
    if (wantNear !== near.current && camera instanceof THREE.PerspectiveCamera) {
      near.current = wantNear;
      camera.near = wantNear;
      camera.far = wantNear === 1 ? SPACE_FAR : 1500;
      camera.updateProjectionMatrix();
    }

    // chi a piedi cade nel vuoto e' dato per morto (rinasce all'ospedale)
    if (!st.isDrone && p[1] < -150 && st.health > 0) st.setHealth(0);

    // ultima posizione del drone (per atterrare dove si e' premuto B)
    const droneJustLeft = wasDrone.current && !st.isDrone;
    if (st.isDrone) {
      lastDrone.current = [p[0], p[1], p[2]];
      lastDroneYaw.current = st.playerYaw;
    }
    wasDrone.current = st.isDrone;

    // --- siti: ogni 0.25 s, e mai mentre il drone non ha ancora applicato il rebase (la sua posizione e' nel
    // riferimento vecchio) o se un montaggio e' in corso ---
    if (busy.current || droneRebase.pending) return;
    if (performance.now() - mountedAt.current < 3000) return;
    if (!droneJustLeft && state.clock.elapsedTime - last.current < 0.25) return;
    last.current = state.clock.elapsedTime;
    const res = spaceState.resident;
    const site = getCurrentSite();

    // B: il giocatore scende dove era il drone (il mondo si rimonta sotto di lui)
    if (droneJustLeft && res && near0) {
      const d = nearestPlanet(lastDrone.current, planets);
      if (d && d.alt < UNMOUNT_ALT && d.pl.profile.seed === site.planetSeed) {
        const lat = Math.hypot(lastDrone.current[0], lastDrone.current[2]);
        const want = makeSite(d.pl.profile.seed, d.n[0], d.n[1], d.n[2]);
        if (lat > 80 && want.id !== site.id) {
          mountedAt.current = performance.now() + 1500;
          void handoff(want, busy, { onFootAt: lastDrone.current, yaw: lastDroneYaw.current });
          return;
        }
      }
    }

    const ref = st.isDrone ? p : (st.playerPos as [number, number, number]);
    const n = st.isDrone ? near0 : nearestPlanet(ref, planets);
    if (!n) return;
    if (res) {
      const lateral = Math.hypot(ref[0], ref[2]);
      const lim = st.isDrone ? (site.kind === 'city' ? RESITE_CITY : RESITE_WILD) : site.kind === 'city' ? RESITE_FOOT_CITY : RESITE_FOOT_WILD;
      if (st.isDrone && (n.pl.profile.seed !== site.planetSeed || n.alt > UNMOUNT_ALT)) {
        void leave(busy);
      } else if (lateral > lim && n.pl.profile.seed === site.planetSeed && n.alt < UNMOUNT_ALT) {
        const want = makeSite(n.pl.profile.seed, n.n[0], n.n[1], n.n[2]);
        if (want.id !== site.id) {
          mountedAt.current = performance.now() + 1500;
          void handoff(want, busy, st.isDrone ? {} : { onFootAt: ref });
        }
      }
    } else if (st.isDrone && n.alt < MOUNT_ALT) {
      mountedAt.current = performance.now() + 1500; // (il montaggio vero avviene tra poco)
      void handoff(makeSite(n.pl.profile.seed, n.n[0], n.n[1], n.n[2]), busy, {});
    }
  });

  return null;
};

const tl = (m: string) => {
  if (import.meta.env.DEV) ((window as any).__tl ??= []).push(`${Math.round(performance.now())} ${m}`);
};

async function leave(busy: { current: boolean }) {
  busy.current = true;
  try {
    tl('leave');
    spaceState.resident = null;
    await unmountWorld();
  } finally {
    busy.current = false;
  }
}

// monta il mondo sul sito `to`. onFootAt: il giocatore (a piedi) si trova li' (riferimento vecchio) e deve
// riapparire nello stesso punto, con la stessa direzione, nel mondo nuovo
async function handoff(to: Site, busy: { current: boolean }, opts: { onFootAt?: [number, number, number]; yaw?: number }) {
  busy.current = true;
  try {
    const from = getCurrentSite();
    tl(`handoff ${to.id} (da ${from.id}) resident=${spaceState.resident?.name}`);
    if (spaceState.resident) {
      spaceState.resident = null;
      await unmountWorld();
    }
    // mondo fisico nuovo (il drone, dentro, si ricrea dov'e')
    await recreatePhysics();
    // il riferimento passa al sito `to`: rotazione e traslazione, applicate al drone; a piedi si prepara il punto di ritorno
    const { q, t } = siteTransform(from, to);
    tl('rebase');
    requestDroneRebase(q, t);
    const st = useStore.getState();
    if (opts.onFootAt) {
      const pNew = new THREE.Vector3(...opts.onFootAt).applyQuaternion(q).add(t);
      const yaw = opts.yaw ?? st.playerYaw;
      const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).applyQuaternion(q);
      st.setSpawnPoint([pNew.x, pNew.z, Math.atan2(f.x, f.z), Math.min(pNew.y, 2) - 0.5]);
    } else {
      st.setSpawnPoint(null);
    }
    setCurrentSite(to);
    spaceState.site = to;
    const profile = planetCatalog().find((p) => p.seed === to.planetSeed)!;
    if (profile.seed !== getPlanet().seed) {
      applyWorldSeed(profile);
      void fetchJson('/api/world/reseed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: profile.seed, gridRadius: profile.gridRadius }),
      });
      rebuildPlanetData();
    }
    tl('data');
    // i dati procedurali (citta', terreno) si preparano a pezzetti tra un frame e l'altro, a mondo ancora smontato
    await warmWorld(to);
    tl('warm');
    mountPlanetWorld();
    tl('rebuilt');
    spaceState.resident = profile;
  } finally {
    busy.current = false;
  }
}

export default SpaceController;
