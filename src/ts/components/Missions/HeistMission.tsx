import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../../store';
import Enemy from '../Enemy';
import { allyRegistry } from '../city/npcCombat';
import { getTerrainHeight } from '../Environment/Terrain';
import { clearWanted, setWantedLevel, wanted } from '../../lib/wanted';
import { fateEvents } from '../../lib/playerControl';
import {
  BANK_GUARDS,
  CREW_BONUS,
  CREW_NEEDED,
  DRILL_S,
  HEIST_OBJECTIVES,
  HIDEOUT,
  LOOT,
  MISSION_3,
  MISSION_3_TITLE,
  VAULT,
  heistBus,
  type HeistStep,
} from '../../missions/heist';

// "Il colpo del secolo" (testi e luoghi in missions/heist.ts): auto, due
// complici reclutati in chat (gli alleati), le guardie della banca, la
// cassaforte da forzare mentre arriva la polizia, la fuga con quattro stelle
// attraverso il traffico e il rifugio. Usa il ricercato (lib/wanted.ts), gli
// alleati (city/AllyNpc) e le stesse guardie delle altre missioni (Enemy).

const BANNER_S = 4.5;
const VAULT_DIST = 4;
const DRILL_RANGE = 9;
const HIDEOUT_DIST = 6;

interface Guard {
  id: string;
  pos: [number, number, number];
  guard: { alert: { on: boolean }; facing?: number };
}

const HeistMission: React.FC = () => {
  const [step, setStepState] = useState<HeistStep>('idle');
  const [guards, setGuards] = useState<Guard[]>([]);
  const S = useRef({
    step: 'idle' as HeistStep,
    drill: DRILL_S,
    gen: 0,
    failed: false,
    busted0: 0,
    alert: { on: false },
    obj: '',
    crew: -1,
    loot: false,
    hintedBank: false,
    escalated: false,
  });
  const beam = useRef<THREE.Group>(null);
  const noop = useCallback(() => {}, []);

  const banner = (title: string, subtitle: string, color: string) =>
    useStore.getState().setStoryBanner({ title, subtitle, color, until: performance.now() + BANNER_S * 1000 });

  const setObj = (text: string) => {
    if (S.current.obj === text) return;
    S.current.obj = text;
    useStore.getState().setMissionInfo(MISSION_3_TITLE, text);
  };

  const spawnGuards = useCallback(() => {
    const s = S.current;
    s.gen++;
    s.alert = { on: false };
    setGuards(
      BANK_GUARDS.map((g, i) => ({
        id: `banca-${s.gen}-${i}`,
        pos: [g.x, 0, g.z] as [number, number, number],
        guard: { alert: s.alert, facing: g.facing },
      }))
    );
  }, []);

  const setStep = useCallback(
    (next: HeistStep) => {
      const s = S.current;
      s.step = next;
      setStepState(next);
      s.obj = '';
      s.crew = -1;
      const st = useStore.getState();
      st.setMissionTimeRemaining(0);
      if (next === 'h_bank') {
        s.drill = DRILL_S;
        s.escalated = false;
        s.loot = false;
        s.hintedBank = false;
        spawnGuards();
      }
      if (next === 'h_done' || next === 'idle') {
        st.setMissionTargetPos(null);
        heistBus.prompt = null;
      }
      if (next !== 'h_crew' && next !== 'h_escape') setObj(HEIST_OBJECTIVES[next]);
    },
    [spawnGuards]
  );

  if (import.meta.env.DEV) (window as any).__heist = { S, setStep };

  useEffect(
    () => () => {
      const st = useStore.getState();
      if (S.current.step !== 'idle' && S.current.step !== 'h_done') {
        st.setMissionTargetPos(null);
        st.setMissionInfo('', '');
      }
      heistBus.prompt = null;
    },
    []
  );

  const failAttempt = (why: string) => {
    const s = S.current;
    banner('COLPO FALLITO', why, '#ff5252');
    s.failed = false;
    s.busted0 = fateEvents.busted;
    heistBus.prompt = null;
    setStep('h_bank');
  };

  useFrame((state, delta) => {
    const st = useStore.getState();
    if (st.isPaused) return;
    const s = S.current;
    if (heistBus.start && (s.step === 'idle' || s.step === 'h_done')) {
      heistBus.start = false;
      s.busted0 = fateEvents.busted;
      s.failed = false;
      banner('IL COLPO DEL SECOLO', 'Procurati un\'auto per la fuga', '#ffd54a');
      setStep('h_car');
    }
    if (s.step === 'idle' || s.step === 'h_done') return;

    const pp = st.playerPos;
    const onFoot = st.currentControllable === 'player';
    heistBus.prompt = null;

    // morto o arrestato: da capo dalla banca (il bottino e' perso)
    if (st.health <= 0) s.failed = true;
    if (s.failed && st.health > 0 && (s.step === 'h_bank' || s.step === 'h_drill' || s.step === 'h_escape')) {
      failAttempt("Sei stato ucciso. Si ricomincia dalla banca.");
      return;
    }
    if (fateEvents.busted !== s.busted0 && (s.step === 'h_drill' || s.step === 'h_escape')) {
      failAttempt("Ti hanno arrestato col bottino. Si ricomincia dalla banca.");
      return;
    }

    // dove e' il segnale sulla minimappa (e il fascio in citta')
    let target: [number, number] | null = null;
    if (s.step === 'h_car') {
      const e = st.entities.get('car-1');
      target = e ? [e.position[0], e.position[2]] : null;
    } else if (s.step === 'h_bank' || s.step === 'h_drill') target = VAULT;
    else if (s.step === 'h_escape') target = HIDEOUT;
    st.setMissionTargetPos(target);
    if (beam.current) {
      beam.current.visible = !!target;
      if (target) {
        beam.current.position.set(target[0], getTerrainHeight(target[0], target[1]), target[1]);
        const k = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.08;
        beam.current.scale.set(k, 1, k);
      }
    }

    const dVault = Math.hypot(VAULT[0] - pp[0], VAULT[1] - pp[2]);

    if (s.step === 'h_car') {
      if (st.currentControllable === 'car') {
        banner('AUTO PRONTA', 'Ora i complici: reclutali in chat', '#76ff03');
        setStep('h_crew');
      }
    } else if (s.step === 'h_crew') {
      const n = allyRegistry.size;
      if (n !== s.crew) {
        s.crew = n;
        setObj(`${HEIST_OBJECTIVES.h_crew} (${Math.min(n, CREW_NEEDED)}/${CREW_NEEDED})`);
      }
      if (n >= CREW_NEEDED) {
        banner('SQUADRA PRONTA', 'Alla banca: elimina le guardie', '#76ff03');
        // i complici ti coprono: lo stesso ordine che daresti in chat
        st.setPlayerMessage(`difendimi ${Math.random()}`);
        setStep('h_bank');
      }
    } else if (s.step === 'h_bank') {
      if (!s.hintedBank && dVault < 70) {
        s.hintedBank = true;
        banner('BANCA CENTRALE', 'Guardie armate all\'ingresso', '#ffd54a');
      }
      if (onFoot && dVault < VAULT_DIST) {
        heistBus.prompt = 'Forza la cassaforte (T)';
        if (heistBus.talk) {
          heistBus.talk = false;
          s.drill = DRILL_S;
          s.escalated = false;
          s.alert.on = true;
          setWantedLevel(2);
          banner('ALLARME!', 'Resisti: la polizia sta arrivando', '#ff5252');
          setStep('h_drill');
        }
      }
      heistBus.talk = false;
    } else if (s.step === 'h_drill') {
      if (dVault < DRILL_RANGE) {
        s.drill -= delta;
        if (s.drill < DRILL_S / 2 && !s.escalated) {
          s.escalated = true;
          setWantedLevel(3);
        }
      } else heistBus.prompt = 'Torna alla cassaforte!';
      const sec = Math.ceil(Math.max(0, s.drill));
      if (st.missionTimeRemaining !== sec) st.setMissionTimeRemaining(sec);
      if (s.drill <= 0) {
        s.loot = true;
        setWantedLevel(4);
        banner('CASSAFORTE APERTA', 'Hai il bottino! Quattro stelle: scappa!', '#ffd54a');
        setStep('h_escape');
      }
    } else if (s.step === 'h_escape') {
      const dH = Math.hypot(HIDEOUT[0] - pp[0], HIDEOUT[1] - pp[2]);
      setObj(
        wanted.level > 0
          ? 'Semina la polizia! (stelle fisse: ti vedono; lampeggianti: ti cercano). Poi il rifugio, a sud-est.'
          : 'Hai seminato la polizia! Raggiungi il rifugio, a sud-est.'
      );
      if (dH < 14 && wanted.level > 0) heistBus.prompt = 'Non portare la polizia al rifugio!';
      if (dH < HIDEOUT_DIST && wanted.level === 0) {
        const crew = allyRegistry.size;
        const reward = LOOT + crew * CREW_BONUS;
        st.addCash(reward);
        st.addCompletedMission(MISSION_3);
        heistBus.active = false;
        clearWanted();
        banner('MISSIONE COMPIUTA', `${MISSION_3_TITLE}   +${reward}$${crew ? `  (squadra: +${crew * CREW_BONUS}$)` : ''}`, '#ffd54a');
        setStep('h_done');
      }
    }
  });

  return (
    <>
      {/* fascio di luce sull'obiettivo */}
      <group ref={beam} visible={false}>
        <mesh position={[0, 18, 0]}>
          <cylinderGeometry args={[0.55, 0.55, 36, 16, 1, true]} />
          <meshBasicMaterial color="#ffd54a" transparent opacity={0.28} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.6, 2.1, 32]} />
          <meshBasicMaterial color="#ffd54a" transparent opacity={0.8} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
      {step !== 'idle' && step !== 'h_done' && guards.map((e) => <Enemy key={e.id} id={e.id} initialPosition={e.pos} onGiveUp={noop} guard={e.guard} />)}
    </>
  );
};

export default HeistMission;
