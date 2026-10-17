import React, { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import * as THREE from 'three';
import { useStore } from '../store';
import SpeechBubble from './UI/SpeechBubble';
import { getTerrainHeight } from './Environment/Terrain';
import { getRoadOffset } from './Environment/Road';
import EnemyHealthBar from './Environment/EnemyHealthBar';
import { useMannequinActor } from './city/useMannequinActor';
import { usePistolModel } from './Environment/weapons/usePistolModel';
import { ENEMY_COLOR, ENEMY_MAX_HP as MAX_HP, newHostileState, stepHostile } from './city/brains/hostile';

// Nemico della citta' -- "sostituisci i nemici della citta' con il nostro
// manichino.. basta boxman": lo stesso manichino del giocatore
// (useMannequinActor: capsule per segmento, colpi veri, ragdoll alla
// morte), con la pistola in mano. Ti insegue di corsa, a tiro si ferma,
// mira e spara al petto; se per un po' non
// riesce a starti vicino rinuncia e torna un passante (onGiveUp).

interface EnemyProps {
  id: string;
  initialPosition: [number, number, number];
  // Called once this enemy has spent GIVE_UP_TIME straight without ever
  // getting within firing range of the player (CityDetails.tsx turns it
  // back into the pedestrian it came from), and again after its corpse
  // has lain on the ground for CORPSE_S.
  onGiveUp: (id: string) => void;
  // vita con cui parte (un passante gia' ferito resta ferito)
  initialHp?: number;
  // di guardia (missioni, StoryMission.tsx): fermo dov'e', rivolto verso
  // `facing`, finche' non ti vede da vicino, non viene colpito o qualcuno
  // del suo gruppo da' l'allarme (alert condiviso tra le guardie)
  guard?: { alert: { on: boolean }; facing?: number };
  // chiamato una volta quando muore
  onDeath?: (id: string) => void;
  // con la pistola (default) o a mani nude: i passanti arrabbiati di solito
  // fanno a pugni, la pistola ce l'hanno in pochi
  armed?: boolean;
  // cacciatore: non rinuncia mai, senza tracce ti cerca in giro (laboratorio personaggi)
  hunt?: boolean;
}

const CORPSE_S = 25;

const Enemy: React.FC<EnemyProps> = ({ id, initialPosition, onGiveUp, initialHp, guard, onDeath, armed = true, hunt = false }) => {
  const actor = useMannequinActor({
    id,
    name: 'Nemico',
    team: 'CITY_ENEMY',
    color: ENEMY_COLOR,
    hp: MAX_HP,
    x: initialPosition[0],
    z: initialPosition[2],
  });
  const { data } = actor;
  useEffect(() => {
    if (initialHp !== undefined) data.hp = Math.max(1, Math.min(MAX_HP, initialHp));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pistol = usePistolModel(actor.modelRootRef);

  const groupRef = useRef<THREE.Group>(null);
  const { world, rapier } = useRapier();
  const [message, setMessage] = useState('');
  const [gone, setGone] = useState(false);

  const st = useRef({
    brain: newHostileState(!!guard),
    deadHandled: false,
    corpseDone: false,
  });

  useEffect(() => {
    const { removeEntity } = useStore.getState();
    return () => removeEntity(id);
  }, [id]);

  useFrame((_state, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const s = st.current;
    const res = actor.beginFrame(delta, data.position);

    if (res === 'dead') {
      if (!s.deadHandled) {
        s.deadHandled = true;
        pistol.setVisible(false);
        // fuori dalla minimappa e dagli obiettivi delle missioni subito
        useStore.getState().removeEntity(id);
        onDeath?.(id);
      }
      if (!s.corpseDone && actor.deadFor() > CORPSE_S) {
        s.corpseDone = true;
        // via il corpo (rig del ragdoll) e il modello
        actor.ragdoll.deactivate();
        setGone(true);
        onGiveUp(id);
      }
      return;
    }

    if (res === 'down') {
      // KO: a terra e poi si rialza, niente IA intanto
      pistol.setVisible(false);
      actor.holdRoot(g);
      return;
    }

    const out = stepHostile(s.brain, { armed, guard, persistent: hunt }, {
      id,
      actor,
      g,
      pistol,
      world,
      rapier,
      delta,
      res: res === 'hurt' ? 'hurt' : null,
      say: (msg) => {
        if (message) return;
        setMessage(msg);
        setTimeout(() => setMessage(''), 2500);
      },
    });
    if (out === 'gaveUp') onGiveUp(id);
  });

  if (gone) return null;

  return (
    <>
      <group
        ref={groupRef}
        position={[
          initialPosition[0],
          getTerrainHeight(initialPosition[0], initialPosition[2]) + getRoadOffset(initialPosition[0], initialPosition[2]),
          initialPosition[2],
        ]}
      >
        <primitive object={actor.clone} />
        <SpeechBubble message={message} position={[0, 2.4, 0]} />
      </group>
      <EnemyHealthBar data={data} maxHp={MAX_HP} />
    </>
  );
};

export default Enemy;
