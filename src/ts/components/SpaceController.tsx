import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import '../lib/rapierGuard';
import { useStore } from '../store';
import { applyWorldSeed, fetchJson, getPersistedSeed, previewWorldSeed } from '../lib/worldSeed';
import { warmWorld } from '../lib/worldWarmup';
import { SPACE_FAR, SUN_R, sunPos, droneLive, droneResume, droneRebase, PLANET_R, requestDroneRebase, siteFrame, siteTransform, spacePlanets, spaceState, type SpacePlanet } from '../lib/space';
import { getDataSeed, getPlanet, mountPlanetWorld, planetCatalog, rebuildPlanetData, recreatePhysics, unmountWorld } from '../lib/planet';
import { getCurrentSite, makeSite, setCurrentSite, type Site } from '../lib/site';
import { hEff, surfaceHeight } from '../lib/planetSurface';
import { parking, respawnPlayer, setDormant, type ParkedPlayer } from '../lib/playerParking';
import { getTerrainHeight } from './Environment/Terrain';

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
const PREVIEW_ALT = 14000; // m dalla superficie: sotto questa quota si anticipano i dati del pianeta (la sua citta' da lontano)
const PARK_SPAWN_R = 600; // m dal centro del sito: entro questo raggio il giocatore lasciato a terra riappare (c'e' il terreno fisico)

// posizione del giocatore (riferimento del sito corrente) -> posizione 'parcheggiata' sul pianeta
function parkFromLocal(pos: [number, number, number], yaw: number): ParkedPlayer {
  const site = getCurrentSite();
  const q = new THREE.Quaternion().copy(site.quat).invert();
  const v = new THREE.Vector3(pos[0], pos[1] + PLANET_R + site.hN, pos[2]).applyQuaternion(q);
  const rad = v.length();
  const dir = v.clone().divideScalar(rad);
  const h = hEff(surfaceHeight(site.planetSeed, dir.x, dir.y, dir.z));
  const above = Math.min(30, Math.max(0, rad - (PLANET_R + h) - 1));
  const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).applyQuaternion(q);
  return { seed: site.planetSeed, dir: [dir.x, dir.y, dir.z], fwd: [fwd.x, fwd.y, fwd.z], above: above < 2 ? 0 : above };
}
// ... e viceversa: dove sta nel riferimento del sito `to`
function parkedLocal(pk: ParkedPlayer, to: Site) {
  const h = hEff(surfaceHeight(pk.seed, pk.dir[0], pk.dir[1], pk.dir[2]));
  const v = new THREE.Vector3(...pk.dir).multiplyScalar(PLANET_R + h + pk.above).applyQuaternion(to.quat);
  v.y -= PLANET_R + to.hN;
  const f = new THREE.Vector3(...pk.fwd).applyQuaternion(to.quat);
  return { x: v.x, y: v.y, z: v.z, yaw: Math.atan2(f.x, f.z) };
}

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

// il sito sotto il drone adesso (il drone continua a volare mentre il mondo si smonta e si rimonta)
const resolveUnderDrone = (): Site | null => {
  const pp = useStore.getState().playerPos as [number, number, number];
  const nn = nearestPlanet(pp, spacePlanets());
  return nn ? makeSite(nn.pl.profile.seed, nn.n[0], nn.n[1], nn.n[2]) : null;
};

const SpaceController: React.FC = () => {
  const { camera } = useThree();
  const busy = useRef(false);
  const near = useRef(0.1);
  const last = useRef(0);
  const mountedAt = useRef(0);
  const wasDrone = useRef(false);
  const lastDrone = useRef<[number, number, number]>([0, 0, 0]);
  const lastDroneYaw = useRef(0);
  const lastFoot = useRef<{ pos: [number, number, number]; yaw: number } | null>(null);
  const exitPending = useRef(false);

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
    spaceState.cloud = 1 - smooth(450, 1500, alt); // poi lo strato di nuvole del pianeta (PlanetSky) prende il loro posto
    const dk = smooth(450, 4500, alt);
    spaceState.dark = dk * dk * (3 - 2 * dk); // il cielo si scurisce piano (azzurro -> blu scuro -> nero), tutto sotto i ~4.5 km
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

    // il giocatore resta DOVE L'HAI LASCIATO: salendo sul drone se ne ricorda il punto sul pianeta (lib/playerParking.ts)
    if (!st.isDrone && st.currentControllable === 'player') lastFoot.current = { pos: [st.playerPos[0], st.playerPos[1], st.playerPos[2]], yaw: st.playerYaw };
    if (st.isDrone && !wasDrone.current && lastFoot.current) parking.parked = parkFromLocal(lastFoot.current.pos, lastFoot.current.yaw);

    // ultima posizione del drone (per atterrare dove si e' premuto B)
    const droneJustLeft = wasDrone.current && !st.isDrone;
    if (droneJustLeft) exitPending.current = true;
    if (st.isDrone) {
      lastDrone.current = [p[0], p[1], p[2]];
      lastDroneYaw.current = st.playerYaw;
    }
    wasDrone.current = st.isDrone;

    // --- siti: ogni 0.25 s, e mai mentre il drone non ha ancora applicato il rebase (la sua posizione e' nel
    // riferimento vecchio) o se un montaggio e' in corso ---
    if (busy.current || droneRebase.pending) return;
    // in volo, ancora senza mondo montato, avvicinandosi a un pianeta se ne costruiscono i dati in anteprima (senza salvarlo): serve a
    // mostrare la sua citta' da lontano (CityProxy.tsx)
    {
      const res0 = spaceState.resident;
      if (!res0 && near0 && near0.alt < PREVIEW_ALT && getDataSeed() !== near0.pl.profile.seed) {
        previewWorldSeed(near0.pl.profile);
        rebuildPlanetData();
        return;
      }
    }
    if (performance.now() - mountedAt.current < 3000 && !exitPending.current) return;
    if (!exitPending.current && state.clock.elapsedTime - last.current < 0.25) return;
    last.current = state.clock.elapsedTime;
    const res = spaceState.resident;
    const site = getCurrentSite();

    // B: il giocatore scende dove era il drone (se serve il mondo si rimonta sotto di lui; altrimenti il giocatore si rimonta
    // li' sul posto, anche se era "dormiente" lontano)
    if (exitPending.current && !st.isDrone) {
      exitPending.current = false;
      parking.parked = null;
      if (res && near0) {
        const d = nearestPlanet(lastDrone.current, planets);
        if (d && d.alt < UNMOUNT_ALT && d.pl.profile.seed === site.planetSeed) {
          const lat = Math.hypot(lastDrone.current[0], lastDrone.current[2]);
          const want = makeSite(d.pl.profile.seed, d.n[0], d.n[1], d.n[2]);
          if (lat > 80 && want.id !== site.id) {
            mountedAt.current = performance.now() + 1500;
            void handoff(want, busy, { onFootAt: lastDrone.current, yaw: lastDroneYaw.current, camera });
            return;
          }
        }
        const [lx, , lz] = lastDrone.current;
        useStore.getState().setSpawnPoint([lx, lz, lastDroneYaw.current, getTerrainHeight(lx, lz) + 0.3]);
        respawnPlayer();
        return;
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
          void handoff(want, busy, st.isDrone ? { camera, resolve: resolveUnderDrone } : { onFootAt: ref, camera });
        }
      }
    } else if (st.isDrone && n.alt < MOUNT_ALT) {
      mountedAt.current = performance.now() + 1500; // (il montaggio vero avviene tra poco)
      void handoff(makeSite(n.pl.profile.seed, n.n[0], n.n[1], n.n[2]), busy, { camera, resolve: resolveUnderDrone });
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
async function handoff(to0: Site, busy: { current: boolean }, opts: { onFootAt?: [number, number, number]; yaw?: number; camera?: THREE.Camera; resolve?: () => Site | null }) {
  busy.current = true;
  let to = to0;
  try {
    const from = getCurrentSite();
    tl(`handoff ${to.id} (da ${from.id}) resident=${spaceState.resident?.name}`);
    if (spaceState.resident) {
      spaceState.resident = null;
      await unmountWorld();
    }
    // Il drone sta fuori dal gate del mondo, ma dentro <Physics>, che si ricrea qui: il drone nuovo riprende il volo esattamente
    // dov'era (stesso telaio, inclinazione e velocita', ancora nel riferimento vecchio) invece di ripartire livellato
    if (useStore.getState().isDrone && droneLive.valid) {
      droneResume.valid = true;
      droneResume.pos.copy(droneLive.pos);
      droneResume.quat.copy(droneLive.quat);
      droneResume.vel.copy(droneLive.vel);
      droneResume.dq.copy(droneLive.dq);
      droneResume.dpos.copy(droneLive.dpos);
    }
    // mondo fisico nuovo (il drone, dentro, si ricrea dov'e')
    await recreatePhysics();
    // il drone ha continuato a volare mentre il mondo si smontava: il sito si sceglie ORA, sotto di lui
    if (opts.resolve) to = opts.resolve() ?? to;
    // il riferimento passa al sito `to`: rotazione e traslazione, applicate al drone; a piedi si prepara il punto di ritorno
    const { q, t } = siteTransform(from, to);
    tl('rebase');
    const st = useStore.getState();
    requestDroneRebase(q, t);
    // La camera e la posizione del giocatore/drone passano subito al riferimento nuovo: il drone (che di solito le sposta)
    // e' smontato per qualche secondo, e senza questo il mondo (fisso sul pianeta, ruotato col riferimento) sembra saltare
    if (opts.camera) {
      opts.camera.position.applyQuaternion(q).add(t);
      opts.camera.quaternion.premultiply(q);
      opts.camera.updateMatrixWorld(true);
    }
    if (st.isDrone) {
      const pp = new THREE.Vector3(...(st.playerPos as [number, number, number])).applyQuaternion(q).add(t);
      st.setPlayerInfo([pp.x, pp.y, pp.z], st.playerYaw);
    }
    if (opts.onFootAt) {
      const pNew = new THREE.Vector3(...opts.onFootAt).applyQuaternion(q).add(t);
      const yaw = opts.yaw ?? st.playerYaw;
      const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).applyQuaternion(q);
      st.setSpawnPoint([pNew.x, pNew.z, Math.atan2(f.x, f.z), Math.min(pNew.y, 2) - 0.5]);
      parking.parked = null;
      setDormant(false);
    } else {
      // volando col drone: il giocatore resta dov'era (se il suo punto sta nella zona montata riappare li', altrimenti dorme)
      const pk = parking.parked;
      const L = st.isDrone && pk && pk.seed === to.planetSeed ? parkedLocal(pk, to) : null;
      if (L && Math.hypot(L.x, L.z) < PARK_SPAWN_R) {
        st.setSpawnPoint([L.x, L.z, L.yaw, L.y]);
        setDormant(false);
      } else {
        st.setSpawnPoint(null);
        setDormant(st.isDrone);
      }
    }
    setCurrentSite(to);
    spaceState.site = to;
    const profile = planetCatalog().find((p) => p.seed === to.planetSeed)!;
    if (profile.seed !== getPersistedSeed()) {
      applyWorldSeed(profile);
      void fetchJson('/api/world/reseed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: profile.seed, gridRadius: profile.gridRadius }),
      });
    }
    // i dati del mondo (citta', strade...) si costruiscono se non sono gia' quelli di questo pianeta (anche l'anteprima
    // fatta avvicinandosi da lontano li ha gia' costruiti)
    if (getDataSeed() !== profile.seed) {
      previewWorldSeed(profile);
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
