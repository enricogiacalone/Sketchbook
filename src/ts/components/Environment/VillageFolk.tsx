import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../../store';
import { getCurrentSite } from '../../lib/site';
import { PLANET_RADIUS, villagesOf, type VillageSite } from '../../lib/planetSurface';
import { VK, fromSiteXZ, siteFrameOf, toSiteXZ, villageFrame, villageItemMatrix, settlementOf, dimOf, type SiteFrame } from '../../lib/village';
import { PALETTE, roleOf, cultureOfKind } from '../../lib/culture';
import { nearestNode, shortestPath, type Settlement } from '../../lib/settlement';
import { getTimeOfDay } from '../../lib/SunCycle';
import { weather } from '../../lib/weather';
import { useMannequinActor } from '../city/useMannequinActor';
import { K } from '../../lib/kimodo';
import { playerHitRecently } from '../../lib/wanted';
import SpeechBubble from '../UI/SpeechBubble';
import { acquireAudioListener, releaseAudioListener } from '../../lib/sharedAudioListener';
import { audioCtx, makeEmitter, playBark, playChirp, playCluck } from '../../lib/proceduralAudio';
import { getTerrainHeight } from './Terrain';
import { devTime } from '../../lib/devTime';
import { useGLTF } from '../../lib/gltf';
import { SkeletonUtils } from 'three-stdlib';

// Gli abitanti dei villaggi vicini al sito (< RANGE m): manichini del gioco con corpo vero (lo stesso dei passanti della
// citta': si colpiscono, vanno KO e si rialzano, muoiono). Hanno una giornata: di mattina escono dalla loro casa e passeggiano
// lungo le due strade (si fermano a chiacchierare, qualcuno sta in piazza), di sera tornano alla loro porta e di notte stanno
// dentro (spariscono); se li colpisci o ti avvicini armato scappano verso la fine della strada piu' lontana da te. Si calcolano
// nel riferimento del sito; da lontano il corpo si addormenta da solo (useMannequinActor). Animali: sotto, in Animal.
const RANGE = 380; // m dal sito: villaggi da popolare
const PER_TIER = [5, 9, 24, 44]; // abitanti per taglia (casale, villaggio, paese, citta')
const SHOW_DIST = 140; // m dalla camera: oltre non si animano gli animali
const WALK_CLIP_SPEED = 0.73; // m/s a cui la clip 'Walk' avanza a velocita' 1
const FLEE_SPEED = 3.7;
const FLEE_CLIPS = ['Run_Female', 'Run_Anime', 'Run_Stealth'];
const CORPSE_S = 30;

interface Plan {
  key: string;
  village: VillageSite;
  seed: number;
  rng: number;
  still: boolean; // sta in piazza tutto il giorno e tutta la notte
  home: [number, number]; // porta di casa (u, w)
  homeNode: number; // nodo del grafo stradale vicino alla porta
  culture: number;
}
const hash = (a: number, b: number) => {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// cammino sul grafo stradale del villaggio (lib/settlement.ts) da (u, w) a un nodo, come lista di punti
const settleOf = (plan: { seed: number; village: VillageSite }): Settlement => settlementOf(plan.seed, plan.village);
const pathPoints = (S: Settlement, from: [number, number], toNode: number): Array<[number, number]> => {
  const a = nearestNode(S.graph, from[0], from[1]);
  return shortestPath(S.graph, a, toNode).map((i) => S.graph.nodes[i] as [number, number]);
};

const Villager: React.FC<{ plan: Plan }> = ({ plan }) => {
  const npcId = `village-${plan.key}`;
  const actor = useMannequinActor({
    id: npcId,
    name: 'Abitante',
    team: `CIVILIAN_${npcId}`,
    color: PALETTE[plan.culture].shirts[Math.floor(plan.rng * PALETTE[plan.culture].shirts.length) % PALETTE[plan.culture].shirts.length],
    hp: 60,
    x: 0,
    z: -1000,
    enableActiveRagdoll: useStore((s) => s.crowdActiveRagdoll),
  });
  const { data } = actor;
  const group = useRef<THREE.Group>(null);
  const [speech, setSpeech] = useState('');
  const S = useRef({
    mode: 'hidden' as 'hidden' | 'wander' | 'home' | 'flee' | 'dead',
    u: plan.home[0], w: plan.home[1],
    route: [] as Array<[number, number]>,
    leg: 0,
    pause: 0,
    speed: 0.95 + hash(plan.rng * 977, 1) * 0.35,
    side: hash(plan.rng * 313, 2) < 0.5 ? 1 : -1,
    bed: (plan.village.tier >= 2 ? 22.6 : 20) + hash(plan.rng * 71, 3) * (plan.village.tier >= 2 ? 1.3 : 3), // ora in cui rientra (in citta' piu' tardi)
    wake: 5.8 + hash(plan.rng * 53, 4) * 1.8, // ora in cui esce
    fear: 0,
    yaw: hash(plan.rng * 11, 5) * 6.28,
    greetAt: -99,
    greeting: 0,
    handled: false,
    n: 0,
    clip: '',
  });
  const frameRef = useRef<SiteFrame | null>(null);
  const rnd = () => ((S.current.n += 1), hash(plan.rng * 4099 + S.current.n * 17, S.current.n * 31 + 5));
  const say = (m: string, ms = 1800) => {
    setSpeech(m);
    window.setTimeout(() => setSpeech(''), ms);
  };
  const pos = useMemo(() => new THREE.Vector3(), []);
  const next = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    actor.sleep();
    if (import.meta.env.DEV) ((window as any).__vf ??= {})[npcId] = S.current; // (stato per le prove dal vivo)
    return () => {
      actor.sleep();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wanderRoute = (): Array<[number, number]> => {
    const s = S.current;
    const St = settleOf(plan);
    // meta': in piazza o in un punto a caso dell'abitato (piu' spesso vicino al centro)
    const near = rnd() < 0.5;
    let target = 0;
    for (let k = 0; k < 6; k++) {
      const i = Math.floor(rnd() * St.graph.nodes.length);
      const [nu, nw] = St.graph.nodes[i];
      if (!near || Math.hypot(nu, nw) < 45) { target = i; break; }
      target = i;
    }
    return pathPoints(St, [s.u, s.w], target);
  };
  const homeRoute = (): Array<[number, number]> => {
    const s = S.current;
    return [...pathPoints(settleOf(plan), [s.u, s.w], plan.homeNode), plan.home];
  };
  const fleeRoute = (px: number, pz: number): Array<[number, number]> => {
    const s = S.current;
    const f = frameRef.current;
    if (!f) return [];
    const [tu, tw] = fromSiteXZ(f, px, pz);
    const St = settleOf(plan);
    // nodo lontano dal pericolo (tra i piu' lontani, a caso) raggiunto per le strade
    const ranked = St.graph.nodes.map((n, i) => ({ i, d: Math.hypot(n[0] - tu, n[1] - tw) - Math.hypot(n[0] - s.u, n[1] - s.w) * 0.3 })).sort((a, b) => b.d - a.d).slice(0, 6);
    const pick = ranked[Math.floor(rnd() * ranked.length)] ?? ranked[0];
    return pick ? pathPoints(St, [s.u, s.w], pick.i) : [];
  };

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const s = S.current;
    const d = Math.min(delta, 0.1);
    const f = (frameRef.current = siteFrameOf(plan.village, plan.seed));
    const hour = getTimeOfDay(state.clock.elapsedTime);
    const night = hour >= s.bed || hour < s.wake;
    const away = !plan.still && (night || weather.rain > 0.6); // (col temporale vanno in casa)

    // dentro casa: esce al mattino
    if (s.mode === 'hidden') {
      g.visible = false;
      if (away) return;
      s.u = plan.home[0];
      s.w = plan.home[1];
      toSiteXZ(f, s.u, s.w, pos);
      actor.wake(pos.x, pos.z);
      g.visible = true;
      s.mode = 'wander';
      s.route = [];
      s.leg = 0;
      s.pause = 0.5 + rnd() * 6;
      return;
    }

    toSiteXZ(f, s.u, s.w, pos);
    if (actor.isDormant() && s.mode !== 'dead') actor.wake(pos.x, pos.z); // (rete di sicurezza: il corpo non deve dormire fuori da casa)
    data.position.set(pos.x, 0, pos.z);
    const res = actor.beginFrame(d, data.position);

    if (res === 'dead') {
      s.mode = 'dead';
      if (actor.deadFor() < CORPSE_S) return;
      // dopo un po' il corpo sparisce e l'abitante torna nella sua casa
      actor.revive();
      s.mode = 'hidden';
      s.u = plan.home[0];
      s.w = plan.home[1];
      g.visible = false;
      actor.sleep();
      return;
    }
    if (res === 'down') {
      actor.holdRoot(g);
      return;
    }

    const store = useStore.getState();
    const pp = store.playerPos;

    // colpito (da lui o per caso, o rialzato da un KO): scappa
    if (res === 'hurt' && !s.handled) {
      s.handled = true;
      s.fear = 9;
      s.route = fleeRoute(pp[0], pp[2]);
      s.leg = 0;
      s.mode = 'flee';
      say(playerHitRecently(npcId, 3) ? 'Aiuto!' : 'Ahia!', 1700);
    } else if (res !== 'hurt') s.handled = false;

    const hx = pp[0] - pos.x, hz = pp[2] - pos.z;
    const distSq = hx * hx + hz * hz;

    // sera: tutti a casa (tranne chi sta in piazza)
    if (away && s.mode === 'wander') {
      s.mode = 'home';
      s.route = homeRoute();
      s.leg = 0;
    }
    // e' tornato il giorno mentre rientrava: riprende a passeggiare
    if (!away && s.mode === 'home') {
      s.mode = 'wander';
      s.route = [];
      s.leg = 0;
    }
    // giocatore con l'arma in pugno troppo vicino: si spaventano
    const armed = store.playerWeapon === 'pistol' || store.playerWeapon === 'rifle';
    if (s.mode === 'wander' && armed && store.playerAiming && distSq < 14 * 14) {
      s.fear = 6;
      s.route = fleeRoute(pp[0], pp[2]);
      s.leg = 0;
      s.mode = 'flee';
      say('Non sparare!', 1600);
    }

    let moving = false;
    const speed = s.mode === 'flee' ? FLEE_SPEED : s.speed;
    if (s.pause > 0 && s.mode !== 'flee') {
      s.pause -= d;
    } else if (s.mode === 'wander' || s.mode === 'home' || s.mode === 'flee') {
      if (s.leg >= s.route.length) {
        if (s.mode === 'home') {
          // arrivato alla porta: entra
          s.mode = 'hidden';
          g.visible = false;
          actor.sleep();
          return;
        }
        if (s.mode === 'flee') {
          // al riparo: resta tremante un po', poi riprende la giornata
          s.pause = 4 + rnd() * 3;
          s.mode = 'wander';
          s.route = [];
          s.leg = 0;
        } else {
          s.route = wanderRoute();
          s.leg = 0;
        }
      }
      const [tu, tw] = s.route[s.leg] ?? [s.u, s.w];
      const du = tu - s.u, dw = tw - s.w, dist = Math.hypot(du, dw);
      if (dist < 0.4) {
        s.leg++;
        if (s.leg >= s.route.length && s.mode === 'wander') s.pause = 3 + rnd() * 9; // si ferma un po' (chiacchiera, guarda)
      } else {
        const step = Math.min(dist, speed * d);
        s.u += (du / dist) * step;
        s.w += (dw / dist) * step;
        moving = true;
        toSiteXZ(f, s.u + (du / dist) * 0.8, s.w + (dw / dist) * 0.8, next);
        s.yaw = Math.atan2(next.x - pos.x, next.z - pos.z);
      }
    }

    // saluto: chi e' fermo e vede il giocatore a pochi metri
    if (!moving && s.mode === 'wander' && distSq < 36 && distSq > 6 && state.clock.elapsedTime - s.greetAt > 45) {
      s.greetAt = state.clock.elapsedTime;
      if (actor.hasClip('Greeting')) {
        s.greeting = Math.min(actor.clipDuration('Greeting'), 2.5);
        say(['Buongiorno!', 'Salve!', 'Ciao, forestiero!'][Math.floor(rnd() * 3)], 2200);
      }
    }
    if (s.greeting > 0) {
      s.greeting -= d;
      actor.play('Greeting', 0.15, false);
      s.clip = 'Greeting';
      let dy = Math.atan2(hx, hz) - g.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      g.rotation.y += dy * Math.min(1, d * 6);
    } else {
      if (s.mode === 'flee' && moving) {
        const want = FLEE_CLIPS[Math.floor(plan.rng * 3) % 3];
        const clip = actor.hasClip(want) ? want : 'Walk';
        if (clip !== s.clip) actor.play(clip, 0.2, true, clip === 'Walk' ? FLEE_SPEED / WALK_CLIP_SPEED : 1);
        s.clip = clip;
      } else if (moving) {
        if (s.clip !== 'Walk') actor.play('Walk', 0.25, true, s.speed / WALK_CLIP_SPEED);
        s.clip = 'Walk';
      } else {
        const idle = s.fear > 0 && actor.hasClip(K.cower) ? K.cower : 'Idle_A';
        if (s.clip !== idle) actor.play(idle, 0.3, true);
        s.clip = idle;
      }
      let dy = s.yaw - g.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      g.rotation.y += dy * Math.min(1, d * 8);
    }
    s.fear = Math.max(0, s.fear - d);
    g.position.set(pos.x, pos.y, pos.z);
    data.position.set(pos.x, 0, pos.z);
    data.rotation = g.rotation.y + Math.PI;
  });

  return (
    <group ref={group} position={[0, -1000, 0]} visible={false}>
      <primitive object={actor.clone} />
      {speech && <SpeechBubble message={speech} position={[0, 2.3, 0]} />}
    </group>
  );
};

// --- animali ----------------------------------------------------------------------------------------------------------
// Modelli veri di Mesh2Motion (CC0, public/animals/CREDITS.txt): galline (uccello piccolo) nei cortili, cani (la volpe, tinta)
// per le strade, cavalli nel recinto dei fienili, volpi ai margini del bosco (scappano se ti avvicini) e uccelli che
// girano in cerchio sopra il villaggio. Solo decorativi (niente fisica); si nascondono e si fermano da lontano.
type AnimalKind = 'hen' | 'dog' | 'horse' | 'fox' | 'bird';
interface AnimalPlan { key: string; village: VillageSite; seed: number; kind: AnimalKind; rng: number; barn?: { u: number; w: number; f: number } }
const MODEL: Record<AnimalKind, string> = { hen: 'animals/bird.glb', dog: 'animals/fox.glb', horse: 'animals/horse.glb', fox: 'animals/fox.glb', bird: 'animals/bird.glb' };
const SCALE: Record<AnimalKind, number> = { hen: 0.13, dog: 0.3, horse: 0.85, fox: 0.3, bird: 0.45 };
const DOG_TINTS = ['#8a6a4a', '#4a4440', '#cdb89a', '#a07850'];

const Animal: React.FC<{ plan: AnimalPlan }> = ({ plan }) => {
  const { scene, animations } = useGLTF(MODEL[plan.kind]);
  const model = useMemo(() => {
    const c = SkeletonUtils.clone(scene);
    c.traverse((o: any) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false;
      if (plan.kind === 'dog' && o.material) {
        o.material = o.material.clone();
        o.material.color.set(DOG_TINTS[Math.floor(plan.rng * DOG_TINTS.length) % DOG_TINTS.length]);
      }
    });
    return c;
  }, [scene, plan.kind, plan.rng]);
  const mixer = useMemo(() => new THREE.AnimationMixer(model), [model]);
  const actions = useMemo(() => {
    const a: Record<string, THREE.AnimationAction> = {};
    for (const c of animations) a[c.name] = mixer.clipAction(c);
    return a;
  }, [animations, mixer]);
  const cur = useRef('');
  const play = (name: string, speed = 1, fade = 0.25) => {
    const act = actions[name] ?? actions['Idle'];
    if (!act) return;
    act.timeScale = speed;
    if (cur.current === name) return;
    const prev = actions[cur.current];
    cur.current = name;
    act.reset().fadeIn(fade).play();
    prev?.fadeOut(fade);
  };
  const st = useRef({ u: 0, w: 0, tu: 0, tw: 0, pause: hash(plan.rng * 999, 2) * 3, yaw: hash(plan.rng * 31, 3) * 6.28, n: 0, init: false, run: 0, ang: hash(plan.rng * 71, 4) * 6.28, eat: false });
  const pos = useMemo(() => new THREE.Vector3(), []);
  const rnd = () => ((st.current.n += 1), hash(plan.rng * 8191 + st.current.n * 13, st.current.n * 29 + 3));
  // dove puo' stare: galline dietro le case, cani sulle strade, cavalli nel recinto del fienile, volpi tra 140 e 210 m
  const pick = (): [number, number] => {
    if (plan.kind === 'fox') {
      const a = rnd() * Math.PI * 2, r = 140 + rnd() * 70;
      return [Math.cos(a) * r, Math.sin(a) * r];
    }
    const S = settlementOf(plan.seed, plan.village);
    if (plan.kind === 'dog') { const nd = S.graph.nodes[Math.floor(rnd() * S.graph.nodes.length)] ?? [0, 0]; return [nd[0] + (rnd() - 0.5) * 2, nd[1] + (rnd() - 0.5) * 2]; }
    if (plan.kind === 'horse' && plan.barn) {
      const lx = (rnd() * 2 - 1) * 9, lz = 6.2 + rnd() * 3.2, cb = Math.cos(plan.barn.f), sb = Math.sin(plan.barn.f);
      return [plan.barn.u - lx * cb + lz * sb, plan.barn.w + lx * sb + lz * cb];
    }
    // galline: nei cortili dietro le case (dietro la porta di una casa a caso)
    const dr = S.doors[Math.floor(rnd() * S.doors.length)];
    if (!dr) return [(rnd() * 2 - 1) * 40, (rnd() * 2 - 1) * 40];
    const it = S.items[dr.index], dd = dimOf(cultureOfKind(it.kind), roleOf(it.kind));
    const back = (dd.d * (it.sz ?? 1)) / 2 + 3 + rnd() * 5;
    return [it.u - Math.sin(it.f) * back + (rnd() - 0.5) * 6, it.w - Math.cos(it.f) * back + (rnd() - 0.5) * 6];
  };
  const group = useRef<THREE.Group>(null);
  const { camera } = useThree();

  useEffect(() => () => { mixer.stopAllAction(); }, [mixer]);

  // voce: galline, cani e uccelli ogni tanto (sorgente posizionale sull'animale; volpi e cavalli stanno zitti)
  const voice = useRef<{ emitter: ReturnType<typeof makeEmitter>; next: number } | null>(null);
  useEffect(() => {
    if (plan.kind !== 'hen' && plan.kind !== 'dog' && plan.kind !== 'bird') return;
    const g = group.current;
    if (!g) return;
    const listener = acquireAudioListener(camera);
    const emitter = makeEmitter(listener, g, plan.kind === 'bird' ? 14 : 4, plan.kind === 'bird' ? 1.2 : 1.6, plan.kind === 'bird' ? 220 : 70);
    voice.current = { emitter, next: 2 + hash(plan.rng * 7, 11) * 12 };
    return () => {
      emitter.dispose();
      voice.current = null;
      releaseAudioListener();
    };
  }, [plan.kind, plan.rng, camera]);
  const speak = (t: number, dist2: number) => {
    const v = voice.current;
    if (!v || t < v.next) return;
    const [lo, hi] = plan.kind === 'hen' ? [8, 26] : plan.kind === 'dog' ? [35, 95] : [5, 14];
    v.next = t + lo + Math.random() * (hi - lo);
    if (dist2 > (plan.kind === 'bird' ? 200 : 60) ** 2) return;
    const ctx = audioCtx();
    if (plan.kind === 'hen') playCluck(ctx, v.emitter.bus, 0.45, 0.9 + hash(plan.rng * 3, 5) * 0.25);
    else if (plan.kind === 'dog') playBark(ctx, v.emitter.bus, 0.45, 0.85 + hash(plan.rng * 5, 6) * 0.3);
    else playChirp(ctx, v.emitter.bus, 0.3);
  };

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const s = st.current;
    const d = Math.min(delta, 0.1);
    const f = siteFrameOf(plan.village, plan.seed);
    const cam = state.camera.position;
    if (!s.init) {
      [s.u, s.w] = plan.kind === 'bird' ? [0, 0] : pick();
      s.tu = s.u;
      s.tw = s.w;
      s.init = true;
    }
    // uccelli: girano in cerchio a 35-70 m sopra il villaggio
    if (plan.kind === 'bird') {
      const r = 40 + plan.rng * 55, alt = 30 + hash(plan.rng * 5, 8) * 40, w = (0.12 + hash(plan.rng * 3, 9) * 0.1) * (plan.rng < 0.5 ? 1 : -1);
      s.ang += w * d;
      const u = Math.cos(s.ang) * r, v = Math.sin(s.ang) * r;
      toSiteXZ(f, u, v, pos);
      const near = (pos.x - cam.x) ** 2 + (pos.z - cam.z) ** 2 < 260 * 260;
      g.visible = near;
      if (!near) return;
      const ahead = new THREE.Vector3();
      toSiteXZ(f, Math.cos(s.ang + w * 0.3) * r, Math.sin(s.ang + w * 0.3) * r, ahead);
      g.position.set(pos.x, pos.y + alt + Math.sin(state.clock.elapsedTime * 0.7 + plan.rng * 9) * 2, pos.z);
      g.rotation.y = Math.atan2(ahead.x - pos.x, ahead.z - pos.z);
      play(Math.sin(state.clock.elapsedTime * 0.3 + plan.rng * 20) > 0.5 ? 'Flap' : 'Glide', 1);
      mixer.update(d);
      speak(state.clock.elapsedTime, (pos.x - cam.x) ** 2 + (pos.z - cam.z) ** 2);
      return;
    }
    toSiteXZ(f, s.u, s.w, pos);
    const dist2 = (pos.x - cam.x) ** 2 + (pos.z - cam.z) ** 2;
    const near = dist2 < (SHOW_DIST * 0.9) ** 2;
    g.visible = near;
    if (!near) return;
    speak(state.clock.elapsedTime, dist2);
    const pp = useStore.getState().playerPos;
    const pd = Math.hypot(pp[0] - pos.x, pp[2] - pos.z);
    // volpe: scappa dal giocatore
    if (plan.kind === 'fox' && pd < 30) {
      s.run = 4;
      const [pu, pw] = fromSiteXZ(f, pp[0], pp[2]);
      const au = s.u - pu, aw = s.w - pw, l = Math.hypot(au, aw) || 1;
      s.tu = s.u + (au / l) * 60;
      s.tw = s.w + (aw / l) * 60;
      s.pause = 0;
    }
    let walking = false;
    const running = s.run > 0;
    const speed = plan.kind === 'hen' ? 0.6 : plan.kind === 'dog' ? 1.2 + (rnd() < 0.002 ? 2 : 0) : plan.kind === 'horse' ? 1.3 : running ? 5.5 : 1.1;
    s.run = Math.max(0, s.run - d);
    if (s.pause > 0) s.pause -= d;
    else {
      const du = s.tu - s.u, dw = s.tw - s.w, dist = Math.hypot(du, dw);
      if (dist < 0.4) {
        [s.tu, s.tw] = pick();
        s.pause = plan.kind === 'hen' ? 1 + rnd() * 5 : 3 + rnd() * 10;
        s.eat = plan.kind === 'horse' && rnd() < 0.5;
      } else {
        const step = Math.min(dist, speed * d);
        const nu = s.u + (du / dist) * step, nw = s.w + (dw / dist) * step;
        toSiteXZ(f, nu, nw, g.position);
        s.yaw = Math.atan2(g.position.x - pos.x, g.position.z - pos.z);
        s.u = nu;
        s.w = nw;
        walking = true;
      }
    }
    toSiteXZ(f, s.u, s.w, pos);
    // fuori dalla zolla piatta (volpi) si sta sul terreno vero
    const y = plan.kind === 'fox' ? getTerrainHeight(pos.x, pos.z) : pos.y;
    g.position.set(pos.x, Number.isFinite(y) ? y : pos.y, pos.z);
    let dy = s.yaw - g.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    g.rotation.y += dy * Math.min(1, d * 7);
    if (walking) {
      if (plan.kind === 'fox' && running) play('Run', 1);
      else if (plan.kind === 'dog' && speed > 2) play('Run', 0.8);
      else play('Walk', plan.kind === 'hen' ? 1.4 : plan.kind === 'horse' ? 1.1 : 1);
    } else if (plan.kind === 'horse' && s.eat) play('Eating', 1);
    else play('Idle', 1);
    mixer.update(d);
  });

  return (
    <group ref={group} name={`animal-${plan.kind}`} visible={false}>
      <primitive object={model} scale={SCALE[plan.kind]} />
    </group>
  );
};

// --- fumo dai camini ----------------------------------------------------------------------------------------------------
// Qualche sbuffo grigio per camino (cottage, fattorie, case lunghe) che sale, si allarga e svanisce, spinto da un po' di vento.
// Un solo InstancedMesh per tutti; le posizioni dei camini (sito) si calcolano una volta.
const PUFFS = 4;
const _cm = new THREE.Matrix4(), _cp = new THREE.Vector3(), _cq = new THREE.Quaternion(), _cs = new THREE.Vector3();
const ChimneySmoke: React.FC<{ villages: VillageSite[]; seed: number }> = ({ villages, seed }) => {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const site = getCurrentSite();
  const chimneys = useMemo(() => devTime('Chimneys', () => {
    const out: THREE.Vector3[] = [];
    for (const v of villages) {
      const fr = villageFrame(v, seed);
      for (const it of settlementOf(seed, v).items) {
        const ch = dimOf(cultureOfKind(it.kind), roleOf(it.kind)).chimney;
        if (!ch) continue;
        villageItemMatrix(it, fr, _cm);
        _cp.set(ch[0], ch[1], ch[2]).applyMatrix4(_cm).applyQuaternion(site.quat);
        out.push(new THREE.Vector3(_cp.x, _cp.y - (PLANET_RADIUS + site.hN), _cp.z));
      }
    }
    return out;
  }), [site.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const geo = useMemo(() => new THREE.IcosahedronGeometry(0.4, 0), []);
  const matr = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d4d4d4', roughness: 1, transparent: true, opacity: 0.42, depthWrite: false }), []);
  useFrame((state) => {
    const m = mesh.current;
    if (!m) return;
    const t = state.clock.elapsedTime;
    const cam = state.camera.position;
    let n = 0;
    for (let c = 0; c < chimneys.length; c++) {
      const p = chimneys[c];
      if ((p.x - cam.x) ** 2 + (p.z - cam.z) ** 2 > 160 * 160) continue; // lontano: niente fumo
      for (let k = 0; k < PUFFS; k++) {
        const ph = (t * 0.28 + k / PUFFS + c * 0.173) % 1;
        const size = 0.5 + ph * 1.5;
        const fade = 1 - Math.max(0, (ph - 0.7) / 0.3);
        _cp.set(p.x + ph * 5 + Math.sin(t * 0.9 + k) * 0.25, p.y + 0.4 + ph * 7, p.z + ph * 2 + Math.cos(t * 0.7 + k * 2) * 0.25);
        _cs.setScalar(size * fade + 0.001);
        _cq.identity();
        m.setMatrixAt(n++, _cm.compose(_cp, _cq, _cs));
      }
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geo, matr, Math.max(1, chimneys.length * PUFFS)]} frustumCulled={false} />;
};

const VillageFolk: React.FC = () => {
  const site = getCurrentSite();
  const { villagers, animals, near } = useMemo(() => devTime('VillageFolk plans', () => {
    const near: VillageSite[] = [];
    const vs: Plan[] = [];
    const an: AnimalPlan[] = [];
    for (const v of villagesOf(site.planetSeed)) {
      const f = siteFrameOf(v, site.planetSeed);
      if (Math.hypot(f.cx, f.cz) > RANGE + v.radius * 0.9) continue;
      near.push(v);
      // le case dove abitano: le porte del grafo stradale del villaggio
      const S = settlementOf(site.planetSeed, v);
      // le case piu' vicine al punto d'atterraggio (l'origine del sito): negli abitati grandi gli abitanti vivono dove sta il giocatore
      const tmp = new THREE.Vector3();
      const ranked = S.doors.map((dr, i) => { toSiteXZ(f, dr.u, dr.w, tmp); return { i, d: Math.hypot(tmp.x, tmp.z) }; }).sort((a, b) => a.d - b.d).slice(0, Math.max(12, PER_TIER[v.tier] * 5));
      for (let k = 0; k < PER_TIER[v.tier]; k++) {
        const rng = hash(site.planetSeed + v.id * 31, k * 7 + 1);
        const pickI = ranked.length ? ranked[Math.floor(hash(rng * 1000, 9) * ranked.length) % ranked.length].i : -1;
        const dr = pickI >= 0 ? S.doors[pickI] : null;
        const home: [number, number] = dr ? [dr.u, dr.w] : [0, 4];
        // (in citta' uno su tre sta fuori anche di notte)
        vs.push({ key: `${v.id}-${k}`, village: v, seed: site.planetSeed, rng, still: v.tier >= 2 ? k % 3 === 2 : k % 5 === 4, home, homeNode: dr ? dr.node : 0, culture: S.culture });
      }
      for (let k = 0; k < 7; k++) an.push({ key: `${v.id}-h${k}`, village: v, seed: site.planetSeed, kind: 'hen', rng: hash(v.id * 17 + k, 5) });
      for (let k = 0; k < 2; k++) an.push({ key: `${v.id}-d${k}`, village: v, seed: site.planetSeed, kind: 'dog', rng: hash(v.id * 23 + k, 6) });
      for (let k = 0; k < 2; k++) an.push({ key: `${v.id}-f${k}`, village: v, seed: site.planetSeed, kind: 'fox', rng: hash(v.id * 29 + k, 7) });
      for (let k = 0; k < 4; k++) an.push({ key: `${v.id}-b${k}`, village: v, seed: site.planetSeed, kind: 'bird', rng: hash(v.id * 37 + k, 8) });
      // cavalli nel recinto dei fienili (2 per fienile, al massimo 4)
      const barns = S.items.filter((it) => roleOf(it.kind) === VK.Granary);
      let nh = 0;
      for (const b of barns) for (let k = 0; k < 2 && nh < 4; k++, nh++) an.push({ key: `${v.id}-o${nh}`, village: v, seed: site.planetSeed, kind: 'horse', rng: hash(v.id * 41 + nh, 9), barn: { u: b.u, w: b.w, f: b.f } });
    }
    return { villagers: vs, animals: an, near };
  }), [site.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {villagers.map((p) => (
        <Villager key={p.key} plan={p} />
      ))}
      {animals.map((p) => (
        <Animal key={p.key} plan={p} />
      ))}
      {near.length > 0 && <ChimneySmoke villages={near} seed={site.planetSeed} />}
    </>
  );
};

export default VillageFolk;
