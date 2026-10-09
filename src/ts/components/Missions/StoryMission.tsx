import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../../store';
import { useInput } from '../../hooks/useInput';
import { getTerrainHeight } from '../Environment/Terrain';
import Enemy from '../Enemy';
import StoryNpc, { type StoryNpcProps } from './StoryNpc';
import { setDialogueHandlers, talkState, type DialogueTree } from '../../lib/dialogue';
import {
  ESCAPE_TIME_S,
  FRANCO_REWARD,
  MISSION_1,
  MISSION_2,
  MISSION_TITLES,
  OBJECTIVES,
  STORY_TITLE,
  missionOfStep,
  stepFromCompleted,
  storyDialogue,
  type StoryActions,
  type StoryState,
  type StoryStep,
} from '../../missions/storyMission';
import { RUNWAY_CENTER } from '../Environment/Airport';
import {
  AMBUSH,
  BAR,
  BAR_FRONT_Z,
  BAR_TABLES,
  GUARDS,
  KIOSK,
  MARKET,
  MARKET_BENCHES,
  MARKET_STALLS,
  PACKAGE_POS,
  REINFORCEMENTS,
} from '../../missions/storyPlaces';

// La missione "La ricetta di nonna Rosa" (testi e scelte in
// missions/storyMission.ts, luoghi in missions/storyPlaces.ts): i
// personaggi, il parlare (T / Triangolo vicino a qualcuno), il pacco, le
// guardie e i rinforzi, l'obiettivo e il segnale sulla minimappa, il
// fallimento (morto o tempo scaduto: si riparte dal deposito).

const TALK_DIST = 2.3; // m
const PACKAGE_DIST = 1.8;
const DIALOGUE_LEAVE_DIST = 4.5; // allontanandosi il dialogo si chiude
const BANNER_S = 4.5;

type NpcDef = Omit<StoryNpcProps, 'talking' | 'marker'> & { id: string };

// seduto: il bacino della clip Sitting_* sta ~0.25 m davanti ai piedi del
// personaggio, cosi' la sedia va sotto il bacino
const SEAT_OFFSET = 0.25;
const gina = BAR_TABLES[0];
const bench = MARKET_BENCHES[0];
const stall = MARKET_STALLS[0];

const NPCS: NpcDef[] = [
  {
    id: 'vito',
    name: 'Vito',
    color: '#6a1b9a',
    x: BAR.x,
    z: BAR_FRONT_Z - 1.7,
    yaw: Math.PI,
    clip: 'Idle_FoldArms',
    talkClip: 'Idle_Talking',
    watch: true,
  },
  {
    id: 'gina',
    name: 'Gina',
    color: '#ad1457',
    x: gina[0] - 0.78 + SEAT_OFFSET,
    z: gina[1],
    yaw: Math.PI / 2,
    clip: 'Sitting_Idle',
    talkClip: 'Sitting_Talking',
    seated: true,
  },
  {
    id: 'lucky',
    name: 'Lucky',
    color: '#f9a825',
    x: KIOSK.x,
    z: KIOSK.z - 1.7,
    yaw: Math.PI,
    clip: 'Idle_TalkingPhone',
    talkClip: 'Idle_Talking',
    watch: true,
  },
  {
    id: 'salvo',
    name: 'Salvo',
    color: '#2e7d32',
    x: stall.x - 0.95,
    z: stall.z,
    yaw: stall.yaw,
    clip: 'Idle_A',
    talkClip: 'Idle_Talking',
    watch: true,
  },
  {
    id: 'aldo',
    name: 'Aldo',
    color: '#5d4037',
    x: bench.x,
    z: bench.z - SEAT_OFFSET,
    yaw: bench.yaw,
    clip: 'Sitting_Idle',
    talkClip: 'Sitting_Talking',
    seated: true,
  },
  {
    id: 'marco',
    name: 'Marco',
    color: '#1565c0',
    x: MARKET.x + 3.2,
    z: MARKET.z + 3.2,
    yaw: 2.4,
    clip: 'Kimodo_phone_talk',
    talkClip: 'Idle_Talking',
  },
];
const NPC_BY_ID: Record<string, NpcDef> = Object.fromEntries(NPCS.map((n) => [n.id, n]));

// --- Missione 2: Franco, il ragioniere in fuga, all'aeroporto -------------
const FRANCO_START: [number, number] = [RUNWAY_CENTER[0] + 34, RUNWAY_CENTER[1] + 15];
const FRANCO_SEE_DIST = 16; // m: ti vede e scappa
const FRANCO_CATCH_DIST = 1.7;
const FRANCO_LOST_DIST = 75; // piu' lontano di cosi': e' scappato
// corre piu' della corsa leggera (3.2), meno dello scatto pieno (4.8): per
// prenderlo si preme X piu' volte; dopo un po' si stanca
const FRANCO_SPEED = 4.3;
const FRANCO_TIRED_SPEED = 3.3;
const FRANCO_LEAVE_SPEED = 1.4; // dopo: se ne va camminando
const FRANCO_GONE_DIST = 30;
const FRANCO_TIRED_AFTER_S = 22;
// dove puo' correre: il prato dell'aeroporto (non torna in citta')
const FRANCO_BOUNDS = { minX: -95, maxX: 95, minZ: -305, maxZ: -222 };
// i Serpenti che arrivano quando hai il libro
const FRANCO_SERPENTI: Array<[number, number]> = [
  [-22, 26],
  [22, 26],
  [0, 32],
];
const FRANCO_DEF: NpcDef = {
  id: 'franco',
  name: 'Franco',
  color: '#00838f',
  x: FRANCO_START[0],
  z: FRANCO_START[1],
  yaw: -Math.PI / 2,
  clip: 'Kimodo_wait_impatient',
  talkClip: 'Idle_Talking',
};
NPC_BY_ID.franco = FRANCO_DEF;

// a chi va la freccia gialla (il prossimo personaggio da cercare)
const MARKER_NPC: Partial<Record<StoryStep, string>> = {
  meetVito: 'vito',
  findLucky: 'lucky',
  escape: 'vito',
  m2_offer: 'vito',
  m2_airport: 'franco',
  m2_chase: 'franco',
  m2_return: 'vito',
};
const VITO_SPOT: [number, number] = [BAR.x, BAR_FRONT_Z - 1];
const TARGET: Record<StoryStep, [number, number] | null> = {
  meetVito: VITO_SPOT,
  findLucky: [KIOSK.x, KIOSK.z - 2],
  warehouse: PACKAGE_POS,
  escape: VITO_SPOT,
  m2_offer: VITO_SPOT,
  m2_airport: FRANCO_START,
  m2_chase: null, // (il segnale segue Franco, vedi useFrame)
  m2_return: VITO_SPOT,
  m2_done: null,
};

interface SpawnedEnemy {
  id: string;
  pos: [number, number, number];
  guard?: { alert: { on: boolean }; facing?: number };
}

const StoryMission: React.FC = () => {
  const input = useInput();
  // si riparte dalla missione non ancora finita (salvataggio, lib/saveGame.ts)
  const [step, setStepState] = useState<StoryStep>(() => stepFromCompleted(useStore.getState().completedMissions));
  const [talking, setTalking] = useState<string | null>(null);
  const [enemies, setEnemies] = useState<SpawnedEnemy[]>([]);
  const [hasPackage, setHasPackage] = useState(false);
  const story = useRef({
    step: stepFromCompleted(useStore.getState().completedMissions),
    reward: 300,
    greedy: false,
    snitched: false,
    gen: 0,
    francoFate: null as 'free' | 'robbed' | null,
  });
  // Franco: posizione (la legge StoryNpc a ogni frame), cosa fa, da quanto corre
  const franco = useRef({ x: FRANCO_START[0], z: FRANCO_START[1], yaw: FRANCO_DEF.yaw, run: 0 });
  const [francoMode, setFrancoMode] = useState<'wait' | 'flee' | 'caught' | 'leave' | 'gone'>('wait');
  const lastTargetT = useRef(-1);
  const timerRef = useRef(0);
  const failRef = useRef<{ t: number } | null>(null);
  const dlg = useRef<{ npc: string; tree: DialogueTree; node: string } | null>(null);
  const pkgRef = useRef<THREE.Group>(null);
  const lastSecond = useRef(-1);

  const setObjective = useCallback((s: StoryStep) => {
    const st = useStore.getState();
    // Lucky ha fatto la spia: lo si dice (i Serpenti aspettano fuori)
    const extra = s === 'warehouse' && story.current.snitched ? ' Lucky ha avvisato i Serpenti: ti aspettano al cancello.' : '';
    st.setMissionInfo(MISSION_TITLES[missionOfStep(s)] ?? STORY_TITLE, OBJECTIVES[s] + extra);
    st.setMissionTargetPos(TARGET[s]);
  }, []);

  const banner = (title: string, subtitle: string, color: string) =>
    useStore.getState().setStoryBanner({ title, subtitle, color, until: performance.now() + BANNER_S * 1000 });

  // guardie del deposito (piu' quelle dell'agguato se Lucky ha fatto la spia)
  const spawnGuards = useCallback(() => {
    const s = story.current;
    s.gen++;
    const alert = { on: false };
    const list: SpawnedEnemy[] = GUARDS.map((g, i) => ({
      id: `serpente-${s.gen}-${i}`,
      pos: [g.x, 0, g.z],
      guard: { alert, facing: g.facing },
    }));
    if (s.snitched)
      AMBUSH.forEach((g, i) => list.push({ id: `serpente-${s.gen}-a${i}`, pos: [g.x, 0, g.z], guard: { alert, facing: g.facing } }));
    setEnemies(list);
  }, []);

  const setStep = useCallback(
    (next: StoryStep) => {
      story.current.step = next;
      setStepState(next);
      setObjective(next);
      if (next === 'warehouse') {
        spawnGuards();
        setHasPackage(false);
      }
      if (next === 'escape') {
        timerRef.current = ESCAPE_TIME_S;
        // allarme: chi e' ancora vivo ti insegue, e arrivano i rinforzi
        setEnemies((prev) => {
          prev.forEach((e) => e.guard && (e.guard.alert.on = true));
          const s = story.current;
          return [
            ...prev,
            ...REINFORCEMENTS.map(([x, z], i) => ({ id: `serpente-${s.gen}-r${i}`, pos: [x, 0, z] as [number, number, number] })),
          ];
        });
      } else {
        timerRef.current = 0;
        useStore.getState().setMissionTimeRemaining(0);
      }
      if (next === 'm2_offer' || next === 'm2_done') setEnemies([]);
      if (next === 'm2_airport') {
        // Franco al suo posto, che aspetta
        franco.current.x = FRANCO_START[0];
        franco.current.z = FRANCO_START[1];
        franco.current.yaw = FRANCO_DEF.yaw;
        franco.current.run = 0;
        lastTargetT.current = -1;
        story.current.francoFate = null;
        setFrancoMode('wait');
        setEnemies([]);
      }
      if (next === 'm2_return') {
        // col libro arrivano i Serpenti
        const s = story.current;
        s.gen++;
        const fx = franco.current.x;
        const fz = franco.current.z;
        setEnemies(
          FRANCO_SERPENTI.map(([ox, oz], i) => ({ id: `serpente-${s.gen}-f${i}`, pos: [fx + ox, 0, fz + oz] as [number, number, number] }))
        );
      }
    },
    [setObjective, spawnGuards]
  );

  useEffect(() => {
    setObjective(story.current.step);
    return () => {
      const st = useStore.getState();
      st.setMissionTargetPos(null);
      st.setMissionInfo('', '');
      st.setDialogueView(null);
      st.setTalkPrompt(null);
      talkState.open = false;
      talkState.near = null;
    };
  }, [setObjective]);

  // --- dialoghi ------------------------------------------------------------
  const actions: StoryActions = useMemo(
    () => ({
      setStep: (s) => setStep(s),
      setReward: (amount, greedy) => {
        story.current.reward = amount;
        story.current.greedy = greedy;
      },
      pay: (amount) => useStore.getState().addCash(-amount),
      heal: (amount) => {
        const st = useStore.getState();
        st.setHealth(Math.min(100, st.health + amount));
      },
      setSnitched: () => {
        story.current.snitched = true;
      },
      complete: () => {
        const s = story.current;
        const st = useStore.getState();
        st.addCash(s.reward);
        st.addCompletedMission(MISSION_1);
        setHasPackage(false);
        setStep('m2_offer');
        banner('MISSIONE COMPIUTA', `${STORY_TITLE}   +${s.reward}$`, '#ffd54a');
      },
      setFrancoFate: (f) => {
        story.current.francoFate = f;
        // "Sparisco": se ne va a piedi e, lontano, non si vede piu'
        setFrancoMode('leave');
        setStep('m2_return');
        banner('HAI IL LIBRO DEI CONTI', 'Arrivano i Serpenti!', '#76ff03');
      },
      complete2: () => {
        const st = useStore.getState();
        st.addCash(FRANCO_REWARD);
        st.addCompletedMission(MISSION_2);
        setStep('m2_done');
        banner('MISSIONE COMPIUTA', `${MISSION_TITLES[MISSION_2]}   +${FRANCO_REWARD}$`, '#ffd54a');
      },
    }),
    [setStep]
  );

  const show = useCallback((nodeId: string | null | undefined) => {
    const d = dlg.current;
    const st = useStore.getState();
    const node = d && nodeId ? d.tree[nodeId] : null;
    if (!d || !node) {
      dlg.current = null;
      talkState.open = false;
      st.setDialogueView(null);
      setTalking(null);
      return;
    }
    d.node = nodeId!;
    node.onEnter?.();
    const npc = NPC_BY_ID[d.npc];
    st.setDialogueView({
      speaker: node.speaker ?? npc?.name ?? '',
      color: npc?.color ?? '#fff',
      text: node.text,
      options: (node.options ?? []).map((o) => ({ label: o.label, disabled: o.disabled })),
    });
  }, []);

  const openDialogue = useCallback(
    (npc: string) => {
      const st = useStore.getState();
      const s: StoryState = {
        step: story.current.step,
        reward: story.current.reward,
        greedy: story.current.greedy,
        snitched: story.current.snitched,
        cash: st.cash,
        health: st.health,
        m1Done: st.completedMissions.includes(MISSION_1),
        francoFate: story.current.francoFate,
      };
      const tree = storyDialogue(npc, s, actions);
      if (!tree) return;
      dlg.current = { npc, tree, node: 'start' };
      talkState.open = true;
      setTalking(npc);
      // il mouse libero per cliccare le risposte
      if (document.pointerLockElement) document.exitPointerLock();
      show('start');
    },
    [actions, show]
  );

  useEffect(() => {
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
    return () => setDialogueHandlers(null);
  }, [show]);

  // --- ogni frame -----------------------------------------------------------
  useFrame((state, delta) => {
    const st = useStore.getState();
    if (st.isPaused) return;
    const pp = st.playerPos;
    const onFoot = st.currentControllable === 'player';
    const s = story.current;

    // chi e' a portata di mano
    let near: string | null = null;
    let best = Infinity;
    if (onFoot && !failRef.current) {
      for (const n of NPCS) {
        const d = Math.hypot(n.x - pp[0], n.z - pp[2]);
        if (d < TALK_DIST && d < best) {
          best = d;
          near = n.id;
        }
      }
      // (preso ma col dialogo chiuso: ci si riparla)
      if (s.step.startsWith('m2_') && s.step !== 'm2_offer' && francoMode === 'caught') {
        const d = Math.hypot(franco.current.x - pp[0], franco.current.z - pp[2]);
        if (d < TALK_DIST && d < best) {
          best = d;
          near = 'franco';
        }
      }
      if (s.step === 'warehouse' && !hasPackage) {
        const d = Math.hypot(PACKAGE_POS[0] - pp[0], PACKAGE_POS[1] - pp[2]);
        if (d < PACKAGE_DIST && d < best) near = 'package';
      }
    }
    talkState.near = near;
    st.setTalkPrompt(talkState.open || !near ? null : near === 'package' ? 'Prendi il pacco' : `Parla con ${NPC_BY_ID[near].name}`);
    if (input.consumeJustPressed('talk') && near && !talkState.open) {
      if (near === 'package') {
        setHasPackage(true);
        setStep('escape');
        banner('HAI IL PACCO', 'Arrivano i rinforzi dei Serpenti!', '#76ff03');
      } else openDialogue(near);
    }
    // allontanandosi il dialogo si chiude
    if (dlg.current) {
      const n = NPC_BY_ID[dlg.current.npc];
      const nx = dlg.current.npc === 'franco' ? franco.current.x : n?.x;
      const nz = dlg.current.npc === 'franco' ? franco.current.z : n?.z;
      if (nx !== undefined && nz !== undefined && Math.hypot(nx - pp[0], nz - pp[2]) > DIALOGUE_LEAVE_DIST) show(null);
    }

    // --- Franco ---
    const fr = franco.current;
    const fd = Math.hypot(fr.x - pp[0], fr.z - pp[2]);
    if (s.step === 'm2_airport' && !failRef.current && fd < FRANCO_SEE_DIST) {
      // ti ha visto: scappa
      setFrancoMode('flee');
      setStep('m2_chase');
      banner('FRANCO SCAPPA!', 'Premi X più volte per scattare', '#ffd54a');
    }
    if (francoMode === 'leave') {
      // cammina via dal giocatore, dentro il prato; a 30 m sparisce
      let dx = fr.x - pp[0];
      let dz = fr.z - pp[2];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const B = FRANCO_BOUNDS;
      fr.x = Math.min(B.maxX, Math.max(B.minX, fr.x + dx * FRANCO_LEAVE_SPEED * delta));
      fr.z = Math.min(B.maxZ, Math.max(B.minZ, fr.z + dz * FRANCO_LEAVE_SPEED * delta));
      fr.yaw = Math.atan2(dx, dz);
      if (fd > FRANCO_GONE_DIST) setFrancoMode('gone');
    }
    if (s.step === 'm2_chase' && !failRef.current) {
      if (fd < FRANCO_CATCH_DIST && onFoot && francoMode === 'flee') {
        setFrancoMode('caught');
        openDialogue('franco');
      } else if (francoMode === 'flee') {
        fr.run += delta;
        const speed = fr.run > FRANCO_TIRED_AFTER_S ? FRANCO_TIRED_SPEED : FRANCO_SPEED;
        // via dal giocatore, con un po' di zig-zag, dentro il prato
        let dx = fr.x - pp[0];
        let dz = fr.z - pp[2];
        const l = Math.hypot(dx, dz) || 1;
        dx /= l;
        dz /= l;
        const wig = Math.sin(fr.run * 1.3) * 0.35;
        let mx = dx - dz * wig;
        let mz = dz + dx * wig;
        const B = FRANCO_BOUNDS;
        const edge = 12;
        if (fr.x < B.minX + edge) mx += (B.minX + edge - fr.x) / edge;
        if (fr.x > B.maxX - edge) mx -= (fr.x - (B.maxX - edge)) / edge;
        if (fr.z < B.minZ + edge) mz += (B.minZ + edge - fr.z) / edge;
        if (fr.z > B.maxZ - edge) mz -= (fr.z - (B.maxZ - edge)) / edge;
        // l'aereo parcheggiato in mezzo alla pista: ci gira intorno
        const ax = fr.x - RUNWAY_CENTER[0];
        const az = fr.z - RUNWAY_CENTER[1];
        const ad = Math.hypot(ax, az);
        if (ad < 14) {
          mx += (ax / (ad || 1)) * (14 - ad) * 0.3;
          mz += (az / (ad || 1)) * (14 - ad) * 0.3;
        }
        const ml = Math.hypot(mx, mz) || 1;
        fr.x = Math.min(B.maxX, Math.max(B.minX, fr.x + (mx / ml) * speed * delta));
        fr.z = Math.min(B.maxZ, Math.max(B.minZ, fr.z + (mz / ml) * speed * delta));
        fr.yaw = Math.atan2(mx, mz);
        // (il segnale sulla minimappa lo segue, 4 volte al secondo)
        if (fr.run - lastTargetT.current > 0.25) {
          lastTargetT.current = fr.run;
          st.setMissionTargetPos([fr.x, fr.z]);
        }
        if (fd > FRANCO_LOST_DIST) {
          failRef.current = { t: 3 };
          banner('MISSIONE FALLITA', "Franco è scappato. Torna all'aeroporto e riprova.", '#ff5252');
        }
      }
    }

    // fallimento: morto durante il colpo, o tempo scaduto con il pacco
    if (failRef.current) {
      failRef.current.t -= delta;
      // si riparte quando ci si e' rialzati
      if (failRef.current.t <= 0 && st.health > 0) {
        failRef.current = null;
        setStep(s.step.startsWith('m2_') ? 'm2_airport' : 'warehouse');
      }
    } else if ((s.step === 'm2_chase' || s.step === 'm2_return') && st.health <= 0) {
      failRef.current = { t: 4 };
      setEnemies([]);
      banner('MISSIONE FALLITA', "Sei stato ucciso. Si ricomincia dall'aeroporto.", '#ff5252');
    } else if (s.step === 'warehouse' || s.step === 'escape') {
      let why = '';
      if (st.health <= 0) why = 'Sei stato ucciso. Si ricomincia dal deposito.';
      if (s.step === 'escape') {
        timerRef.current = Math.max(0, timerRef.current - delta);
        const sec = Math.ceil(timerRef.current);
        if (sec !== lastSecond.current) {
          lastSecond.current = sec;
          st.setMissionTimeRemaining(timerRef.current);
        }
        if (timerRef.current <= 0) why = 'I Serpenti hanno ripreso il pacco. Si ricomincia dal deposito.';
      }
      if (why) {
        failRef.current = { t: 4 };
        setEnemies([]);
        setHasPackage(false);
        timerRef.current = 0;
        st.setMissionTimeRemaining(0);
        banner('MISSIONE FALLITA', why, '#ff5252');
      }
    }

    // il pacco gira piano (si vede da lontano)
    if (pkgRef.current) pkgRef.current.rotation.y = state.clock.elapsedTime * 0.8;
  });

  const markerNpc = MARKER_NPC[step];
  const py = getTerrainHeight(PACKAGE_POS[0], PACKAGE_POS[1]);
  const noop = useCallback(() => {}, []);

  return (
    <>
      {NPCS.map(({ id, ...n }) => (
        <StoryNpc key={id} {...n} talking={talking === id} marker={markerNpc === id && talking !== id} />
      ))}
      {/* Franco: solo nella missione 2 (dopo il libro se ne va a piedi) */}
      {step.startsWith('m2_') && step !== 'm2_offer' && (
        <StoryNpc
          {...FRANCO_DEF}
          follow={franco.current}
          clip={
            francoMode === 'flee'
              ? 'Kimodo_panic_run'
              : francoMode === 'caught'
                ? 'Kimodo_out_of_breath'
                : francoMode === 'leave' || francoMode === 'gone'
                  ? 'Walk'
                  : FRANCO_DEF.clip
          }
          clipSpeed={francoMode === 'flee' ? 1.15 : 1}
          talking={talking === 'franco'}
          marker={markerNpc === 'franco' && talking !== 'franco'}
          hidden={step === 'm2_done' || francoMode === 'gone'}
        />
      )}
      {step === 'warehouse' && !hasPackage && (
        <group position={[PACKAGE_POS[0], py, PACKAGE_POS[1]]}>
          {/* la cassa con sopra il pacco */}
          <mesh castShadow position={[0, 0.4, 0]}>
            <boxGeometry args={[0.8, 0.8, 0.8]} />
            <meshStandardMaterial color="#8d6e63" />
          </mesh>
          <group ref={pkgRef} position={[0, 0.98, 0]}>
            <mesh castShadow>
              <boxGeometry args={[0.45, 0.32, 0.35]} />
              <meshStandardMaterial color="#c8a165" />
            </mesh>
            <mesh>
              <boxGeometry args={[0.47, 0.06, 0.37]} />
              <meshStandardMaterial color="#d32f2f" />
            </mesh>
          </group>
          <mesh position={[0, 2, 0]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.2, 0.45, 4]} />
            <meshBasicMaterial color="#ffd54a" />
          </mesh>
        </group>
      )}
      {enemies.map((e) => (
        <Enemy key={e.id} id={e.id} initialPosition={e.pos} onGiveUp={noop} guard={e.guard} />
      ))}
    </>
  );
};

export default StoryMission;
