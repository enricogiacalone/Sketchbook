import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import '../lib/rapierGuard';
import { useStore } from '../store';
import { applyWorldSeed, fetchJson } from '../lib/worldSeed';
import { warmWorld } from '../lib/worldWarmup';
import { SPACE_FAR, SUN_R, sunPos, droneRebase, MOUNT_DIST, PLANET_R, UNMOUNT_DIST, poleShift, requestDroneRebase, spacePlanets, spaceState } from '../lib/space';
import { getPlanet, mountPlanetWorld, rebuildPlanetData, recreatePhysics, unmountWorld, type PlanetProfile } from '../lib/planet';

// Il cuore del viaggio nello spazio, sempre montato:
//  - quota sul pianeta piu' vicino -> atmosfera/spazio (spaceState.t), spinta
//    del drone (spaceState.boost) e piani della camera (vicino/lontano)
//  - residenza: la citta' di UN pianeta alla volta e' montata. Avvicinandosi
//    al polo di un altro pianeta il mondo si rigenera li' (procedurale) e il
//    riferimento si sposta sul suo polo (rebase: solo una traslazione, il
//    drone resta dov'e' nel mondo); allontanandosi la citta' si smonta.
const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const SpaceController: React.FC = () => {
  const { camera } = useThree();
  const busy = useRef(false);
  const near = useRef(0.1);
  const last = useRef(0);
  const mountedAt = useRef(0);

  useEffect(() => {
    spaceState.resident = getPlanet();
  }, []);

  useFrame((state) => {
    const st = useStore.getState();
    const p: [number, number, number] = st.isDrone ? (st.playerPos as [number, number, number]) : [camera.position.x, camera.position.y, camera.position.z];
    const planets = spacePlanets();

    // quota sul pianeta piu' vicino
    let alt = Infinity;
    for (const pl of planets) {
      const d = Math.hypot(p[0] - pl.center[0], p[1] - pl.center[1], p[2] - pl.center[2]) - PLANET_R;
      if (d < alt) alt = d;
    }
    spaceState.alt = alt;
    // direzione del sole vero (la luce nello spazio)
    const sp = sunPos();
    const sdx = sp[0] - p[0], sdy = sp[1] - p[1], sdz = sp[2] - p[2];
    const sl = Math.hypot(sdx, sdy, sdz) || 1;
    spaceState.sunDir = [sdx / sl, sdy / sl, sdz / sl];
    // strati dell'atmosfera: tutti continui, ognuno con la sua fascia di quota
    spaceState.t = smooth(400, 9000, alt);
    // il sole dello shader del cielo e quello vero devono coincidere gia' prima che il sole vero si veda
    // (compare con dark > 0.3, sopra ~5 km): a 4.5 km il sole del cielo e' gia' al suo posto
    spaceState.sunBlend = smooth(800, 4500, alt);
    spaceState.fog = Math.exp(-Math.max(0, alt) / 350); // l'aria sottile: la foschia cala esponenzialmente con la quota
    spaceState.cloud = 1 - smooth(500, 3200, alt); // poi le nuvole restano sotto
    const dk = smooth(1500, 11000, alt);
    spaceState.dark = dk * dk * (3 - 2 * dk); // il cielo si scurisce piano, fino al nero
    // Velocita': il limite cresce con la quota sul corpo piu' vicino (pianeta o sole), quindi
    // decollando si accelera a poco a poco e atterrando si frena da soli (a ogni metro di
    // quota ~0.4 m/s: la discesa e' un esponenziale con costante di tempo ~2.5 s). La spinta si
    // adegua, e Drone.tsx taglia la velocita' al limite.
    const dsx = sp[0] - p[0], dsy = sp[1] - p[1], dsz = sp[2] - p[2];
    const speedAlt = Math.max(0, Math.min(alt, Math.hypot(dsx, dsy, dsz) - SUN_R));
    spaceState.vmax = Math.min(35000, 40 + 0.4 * speedAlt);
    spaceState.boost = Math.max(1, spaceState.vmax / 30);

    // piani della camera: vicino fine in citta', ampio nello spazio
    const wantNear = alt > 300 ? 1 : 0.1;
    if (wantNear !== near.current && camera instanceof THREE.PerspectiveCamera) {
      near.current = wantNear;
      camera.near = wantNear;
      camera.far = wantNear === 1 ? SPACE_FAR : 1500;
      camera.updateProjectionMatrix();
    }

    // senza muri ai bordi della citta': chi a piedi cade nel vuoto e' dato per morto (rinasce all'ospedale)
    if (!st.isDrone && p[1] < -150 && st.health > 0) st.setHealth(0);

    // residenza (ogni 0.25 s, e solo col drone in volo). Mentre il drone non ha ancora applicato il
    // rebase la sua posizione e' nel riferimento vecchio: non si decide niente (e una citta' appena
    // montata non si smonta subito: il suo smontaggio a meta' montaggio manda in panico Rapier)
    if (busy.current || droneRebase.pending || !st.isDrone || state.clock.elapsedTime - last.current < 0.25) return;
    if (performance.now() - mountedAt.current < 3000) return;
    last.current = state.clock.elapsedTime;
    const res = spaceState.resident;
    let nearest: { pl: (typeof planets)[number]; d: number } | null = null;
    for (const pl of planets) {
      const d = Math.hypot(p[0] - pl.pole[0], p[1] - pl.pole[1], p[2] - pl.pole[2]);
      if (!nearest || d < nearest.d) nearest = { pl, d };
    }
    if (!nearest) return;
    if (nearest.d < MOUNT_DIST && res?.seed !== nearest.pl.profile.seed) {
      mountedAt.current = performance.now() + 1500; // (il montaggio vero avviene tra poco)
      void handoff(nearest.pl.profile, busy);
    } else if (res && !(nearest.pl.profile.seed === res.seed && nearest.d < UNMOUNT_DIST)) {
      // lontano dalla citta' montata: si smonta
      void leave(busy);
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

async function handoff(to: PlanetProfile, busy: { current: boolean }) {
  busy.current = true;
  try {
    const from = getPlanet();
    tl(`handoff ${to.name} resident=${spaceState.resident?.name}`);
    if (spaceState.resident) {
      spaceState.resident = null;
      await unmountWorld();
    }
    // mondo fisico nuovo (il drone, dentro, si ricrea dov'e')
    await recreatePhysics();
    // il riferimento passa al polo di `to`: il drone e' fermo nel mondo, si sposta solo il suo numero
    const d = poleShift(from, to);
    tl('rebase');
    requestDroneRebase(d);
    applyWorldSeed(to);
    void fetchJson('/api/world/reseed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed: to.seed, gridRadius: to.gridRadius }),
    });
    rebuildPlanetData();
    tl('data');
    // i dati procedurali si preparano a pezzetti tra un frame e l'altro, a mondo ancora smontato
    await warmWorld();
    tl('warm');
    mountPlanetWorld();
    tl('rebuilt');
    spaceState.resident = to;
  } finally {
    busy.current = false;
  }
}

export default SpaceController;
