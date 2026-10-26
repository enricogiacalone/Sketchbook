import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useInput } from '../../hooks/useInput';
import { useStore } from '../../store';
import { getCurrentSite } from '../../lib/site';
import { PLANET_RADIUS as R, ruinsOf, villagesOf } from '../../lib/planetSurface';
import { fromSiteXZ, siteFrameOf, toSiteXZ } from '../../lib/village';
import { getTerrainHeight } from '../Environment/Terrain';
import { talkState, getDialogueHandlers, setDialogueHandlers, type DialogueHandlers, type DialogueTree } from '../../lib/dialogue';
import { devTime } from '../../lib/devTime';
import { getWorldSeed } from '../../lib/worldSeed';
import { audioCtx } from '../../lib/proceduralAudio';
import { currentObjective, elderDialogue, elderId, elderName, fragmentPlanets, planetName } from '../../story/mainStory';
import StoryNpc from './StoryNpc';

// "Il Seme" (docs/storia.md): la storia principale. Qui vivono gli anziani dei villaggi (uno per villaggio, in piazza), il frammento
// che brilla nelle rovine, il dialogo, la bussola (distanza e verso del bersaglio, letti da UI/MainStoryHUD.tsx) e l'avvio.
// Gira in ogni sito: gli anziani e le rovine compaiono dove ci sono (siti selvaggi vicino ai villaggi).
const TALK_DIST = 2.8; // m
const TAKE_DIST = 3.4;
const LEAVE_DIST = 5.5;
const NPC_RANGE = 360; // m dal sito: anziani da disegnare
const _c = new THREE.Vector3();
const _w = new THREE.Vector3();

interface Elder { id: string; vid: number; name: string; x: number; z: number; yaw: number }

const chime = () => {
  try {
    const ctx = audioCtx();
    [659.25, 830.6, 987.77, 1318.5].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      const t0 = ctx.currentTime + i * 0.11;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.18, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 1.7);
    });
  } catch {
    /* niente audio */
  }
};

const MainStory: React.FC = () => {
  const input = useInput();
  const site = getCurrentSite();
  const here = site.planetSeed;
  const joined = useStore((s) => s.gameJoined);
  const story = useStore((s) => s.mainStory);
  const [talking, setTalking] = useState<string | null>(null);
  const dlg = useRef<{ id: string; tree: DialogueTree; node: string } | null>(null);
  const prevHandlers = useRef<DialogueHandlers | null>(null);
  const crystal = useRef<THREE.Group>(null);
  const tHint = useRef(0);
  const promptSet = useRef(false);
  const ownNear = useRef(false);

  // avvio: all'ingresso in gioco (e se il salvataggio non ha ancora la storia)
  useEffect(() => {
    if (!joined) return;
    const st = useStore.getState();
    if (st.mainStory.started) return;
    st.setMainStory({ started: true, home: getWorldSeed() });
    window.setTimeout(() => {
      const t = useStore.getState();
      t.setStoryBanner({ title: 'IL SEME', subtitle: "Il Laboratorio ha un incarico: raccogli i frammenti della mente", color: '#7cf0ff', until: performance.now() + 6500 });
    }, 3500);
  }, [joined]);

  // anziani e rovina di questo pianeta, nel riferimento del sito
  const world = useMemo(() => devTime('MainStory world', () => {
    const elders: Elder[] = [];
    for (const v of villagesOf(here)) {
      if (v.tier < 1) continue; // (i casali non hanno un anziano)
      const f = siteFrameOf(v, here);
      const a = ((v.id * 2.399 + here) % 6.283) as number;
      toSiteXZ(f, Math.cos(a) * 4.4, Math.sin(a) * 4.4, _w);
      elders.push({ id: elderId(here, v.id), vid: v.id, name: elderName(here, v.id), x: _w.x, z: _w.z, yaw: Math.atan2(f.cx - _w.x, f.cz - _w.z) });
    }
    let ruin: { x: number; z: number } | null = null;
    const r = ruinsOf(here)[0];
    if (r) {
      _c.set(r.x, r.y, r.z).multiplyScalar(R + r.h).applyQuaternion(site.quat);
      ruin = { x: _c.x, z: _c.z };
    }
    return { elders, ruin };
  }), [site.id, here]); // eslint-disable-line react-hooks/exhaustive-deps

  if (import.meta.env.DEV) (window as any).__mainStory = world; // (prove dal vivo)
  const fragmentHere = fragmentPlanets(story).includes(here);
  const taken = story.fragments.includes(here);
  const showCrystal = !!world.ruin && fragmentHere && !taken;

  const banner = (title: string, subtitle: string, color = '#7cf0ff') =>
    useStore.getState().setStoryBanner({ title, subtitle, color, until: performance.now() + 5500 });

  const show = useCallback((nodeId: string | null | undefined) => {
    const d = dlg.current;
    const st = useStore.getState();
    const node = d && nodeId ? d.tree[nodeId] : null;
    if (!d || !node) {
      dlg.current = null;
      talkState.open = false;
      st.setDialogueView(null);
      setTalking(null);
      // restituisce i comandi del dialogo a chi li aveva (le missioni della citta')
      setDialogueHandlers(prevHandlers.current);
      prevHandlers.current = null;
      return;
    }
    d.node = nodeId!;
    node.onEnter?.();
    st.setDialogueView({
      speaker: node.speaker ?? d.id.split('|')[1] ?? '',
      color: '#ffd9a0',
      text: node.text,
      options: (node.options ?? []).map((o) => ({ label: o.label, disabled: o.disabled })),
    });
  }, []);

  const openElder = useCallback(
    (e: Elder) => {
      const st = useStore.getState();
      const tree = elderDialogue(here, e.vid, st.mainStory, {
        reveal: (seed) => {
          const s = useStore.getState().mainStory;
          if (!s.hints.includes(seed)) useStore.getState().setMainStory({ hints: [...s.hints, seed] });
        },
        markElder: (id) => {
          const s = useStore.getState().mainStory;
          if (!s.elders.includes(id)) useStore.getState().setMainStory({ elders: [...s.elders, id] });
        },
        say: (t, sub) => banner(t, sub),
      });
      dlg.current = { id: `${e.id}|${e.name}`, tree, node: 'start' };
      talkState.open = true;
      setTalking(e.id);
      if (document.pointerLockElement) document.exitPointerLock();
      prevHandlers.current = getDialogueHandlers();
      setDialogueHandlers({
        choose: (i) => {
          const d = dlg.current;
          const o = d?.tree[d.node]?.options?.[i];
          if (!o || o.disabled) return;
          o.action?.();
          show(o.goto ?? null);
        },
        advance: () => {
          const d = dlg.current;
          const node = d ? d.tree[d.node] : null;
          if (!node || node.options?.length) return;
          show(node.next ?? null);
        },
        close: () => show(null),
      });
      show('start');
    },
    [here, show]
  );

  useEffect(
    () => () => {
      if (dlg.current) show(null);
    },
    [show]
  );

  useFrame((state, delta) => {
    const st = useStore.getState();
    if (st.isPaused || !st.gameJoined) return;
    const pp = st.playerPos;
    const onFoot = st.currentControllable === 'player';
    const s = st.mainStory;

    // chi/cosa e' a portata di mano
    let nearElder: Elder | null = null;
    let best = Infinity;
    if (onFoot && !talkState.open) {
      for (const e of world.elders) {
        const d = Math.hypot(e.x - pp[0], e.z - pp[2]);
        if (d < TALK_DIST && d < best) {
          best = d;
          nearElder = e;
        }
      }
    }
    let nearFragment = false;
    if (onFoot && showCrystal && world.ruin && !talkState.open) nearFragment = Math.hypot(world.ruin.x - pp[0], world.ruin.z - pp[2]) < TAKE_DIST;
    const prompt = nearElder ? `Parla con ${nearElder.name}` : nearFragment ? 'Prendi il frammento' : null;
    // (come StoryMission: chi e' a portata di mano, cosi' il tasto T / Triangolo parla invece di aprire la chat)
    if (prompt) {
      talkState.near = nearElder ? nearElder.id : 'fragment';
      ownNear.current = true;
    } else if (ownNear.current) {
      if (!talkState.open) talkState.near = null;
      ownNear.current = false;
    }
    if (prompt) {
      st.setTalkPrompt(prompt);
      promptSet.current = true;
    } else if (promptSet.current && !talkState.open) {
      st.setTalkPrompt(null);
      promptSet.current = false;
    }
    if (input.consumeJustPressed('talk')) {
      if (nearElder && !talkState.open) openElder(nearElder);
      else if (nearFragment) {
        const cur = useStore.getState().mainStory;
        const list = [...cur.fragments, here];
        st.setMainStory({ fragments: list });
        const total = fragmentPlanets(cur).length;
        chime();
        banner(`FRAMMENTO ${list.length}/${total}`, list.length >= total ? 'Hai tutto: torna al Laboratorio cervello mosca' : `Il Seme ricorda un po' di piu' (${planetName(here)})`, '#7cf0ff');
      }
    }
    // allontanandosi il dialogo si chiude
    if (dlg.current && talking) {
      const e = world.elders.find((x) => x.id === talking);
      if (e && Math.hypot(e.x - pp[0], e.z - pp[2]) > LEAVE_DIST) show(null);
    }

    // il frammento: gira e pulsa
    const g = crystal.current;
    if (g && world.ruin) {
      const t = state.clock.elapsedTime;
      g.rotation.y = t * 1.2;
      g.position.y = getTerrainHeight(world.ruin.x, world.ruin.z) + 1.5 + Math.sin(t * 2) * 0.12;
      g.scale.setScalar(1 + Math.sin(t * 3) * 0.06);
    }

    // bussola: bersaglio, distanza e verso (a 4 Hz)
    tHint.current += delta;
    if (tHint.current > 0.25) {
      tHint.current = 0;
      const obj = currentObjective(s, here);
      let target: { x: number; z: number } | null = null;
      if (obj.kind === 'ruin' && world.ruin) target = world.ruin;
      else if (obj.kind === 'elder' && world.elders.length) {
        let bd = Infinity;
        for (const e of world.elders) {
          const d = Math.hypot(e.x - pp[0], e.z - pp[2]);
          if (d < bd) {
            bd = d;
            target = e;
          }
        }
      }
      let dist: number | null = null;
      let arrow: number | null = null;
      if (target) {
        const dx = target.x - pp[0], dz = target.z - pp[2];
        dist = Math.hypot(dx, dz);
        state.camera.getWorldDirection(_c);
        arrow = Math.atan2(dx, dz) - Math.atan2(_c.x, _c.z);
      }
      const prev = st.storyHint;
      const r = (v: number | null, q: number) => (v === null ? null : Math.round(v / q) * q);
      const next = { text: obj.text, kind: obj.kind, dist: r(dist, 1), arrow: arrow === null ? null : Math.round(arrow * 20) / 20 };
      if (!prev || prev.text !== next.text || prev.dist !== next.dist || prev.arrow !== next.arrow || prev.kind !== next.kind) st.setStoryHint(next);
    }
  });

  return (
    <>
      {world.elders.map((e) => {
        if (Math.hypot(e.x, e.z) > NPC_RANGE) return null;
        const marker = story.hints.length === 0 || !story.elders.includes(e.id);
        return (
          <StoryNpc key={e.id} name={e.name} color="#d6b36a" x={e.x} z={e.z} yaw={e.yaw} clip="Idle_A" talkClip="Idle_Talking" talking={talking === e.id} marker={marker} watch />
        );
      })}
      {showCrystal && world.ruin && (
        <group ref={crystal} position={[world.ruin.x, 2, world.ruin.z]}>
          <mesh>
            <octahedronGeometry args={[0.55, 0]} />
            <meshStandardMaterial color="#9ff3ff" emissive="#4de1ff" emissiveIntensity={2.2} roughness={0.15} metalness={0.2} />
          </mesh>
          <mesh scale={1.7}>
            <octahedronGeometry args={[0.55, 0]} />
            <meshBasicMaterial color="#7cf0ff" wireframe transparent opacity={0.35} depthWrite={false} />
          </mesh>
          <pointLight color="#6fe6ff" intensity={6} distance={14} />
        </group>
      )}
    </>
  );
};

export default MainStory;
