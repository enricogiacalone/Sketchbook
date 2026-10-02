import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import SpeechBubble from './UI/SpeechBubble';
import { getTerrainHeight } from './Environment/Terrain';
import { getRoadOffset } from './Environment/Road';
import Bullet from './Bullet';
import EnemyHealthBar from './Environment/EnemyHealthBar';
import { useMannequinActor } from './city/useMannequinActor';
import { usePistolModel } from './Environment/weapons/usePistolModel';
import { RUN_CLIP, timeScaleFor } from './Environment/locomotion';

// Nemico della citta' -- "sostituisci i nemici della citta' con il nostro
// manichino.. basta boxman": lo stesso manichino del giocatore
// (useMannequinActor: capsule per segmento, colpi veri, ragdoll alla
// morte), con la pistola in mano. Ti insegue di corsa, a tiro si ferma,
// mira e spara (proiettili fisici, Bullet.tsx, al petto); se per un po' non
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
}

const ENEMY_COLOR = '#c62828';
const MAX_HP = 100;
const RUN_SPEED = 3.8; // m/s
const FIRE_RANGE = 12; // oltre torna a inseguire
const STOP_RANGE = 8; // entro si ferma a sparare
const FIRE_COOLDOWN_S = 1.1;
const BULLET_SPEED = 50;
const SPREAD_RAD = 0.06;
const GIVE_UP_TIME = 15;
const CORPSE_S = 25;
// altezza del petto del giocatore (manichino) sopra i piedi: dove si mira.
// playerPos e' 0.5 m sopra i piedi (PlayerCombatSoldier.tsx).
const PLAYER_CHEST_HEIGHT = 1.25;

const PHRASES = ['Fermo!', 'Non scappi!', 'Ti ho visto!', 'Eccolo!', 'Preso!'];

const _muzzle = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _perp = new THREE.Vector3();

const Enemy: React.FC<EnemyProps> = ({ id, initialPosition, onGiveUp, initialHp }) => {
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
  const [bullets, setBullets] = useState<{ id: string; pos: [number, number, number]; vel: [number, number, number] }[]>([]);
  const removeBullet = useCallback((bulletId: string) => {
    setBullets((prev) => prev.filter((b) => b.id !== bulletId));
  }, []);
  const [message, setMessage] = useState('');
  const [gone, setGone] = useState(false);

  const st = useRef({
    mode: 'chase' as 'chase' | 'shoot',
    fireCd: 0.6 + Math.random() * 0.6,
    shootAnim: 0,
    giveUp: 0,
    gaveUp: false,
    deadHandled: false,
    corpseDone: false,
    entityT: 0,
    serial: 0,
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

    pistol.setVisible(true);
    pistol.update(delta);

    const store = useStore.getState();
    const pp = store.playerPos;
    const dx = pp[0] - data.position.x;
    const dz = pp[2] - data.position.z;
    const dist = Math.hypot(dx, dz);

    // si gira verso il giocatore
    if (dist > 0.01) {
      const want = Math.atan2(dx, dz);
      let a = want - g.rotation.y;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      g.rotation.y += a * Math.min(1, delta * (s.mode === 'shoot' ? 10 : 6));
    }

    if (s.mode === 'chase' && dist < STOP_RANGE) s.mode = 'shoot';
    else if (s.mode === 'shoot' && dist > FIRE_RANGE) s.mode = 'chase';
    if (res === 'hurt' && s.mode === 'chase' && dist < FIRE_RANGE) s.mode = 'shoot';

    if (s.mode === 'chase' && dist > 0.01) {
      const step = RUN_SPEED * delta;
      const c = actor.ragdoll.resolveBodyMovement((dx / dist) * step, (dz / dist) * step, null);
      data.position.x += c.x;
      data.position.z += c.z;
      actor.play(RUN_CLIP, 0.2, true, timeScaleFor(RUN_CLIP, RUN_SPEED));
    } else {
      s.fireCd -= delta;
      if (s.shootAnim > 0) s.shootAnim -= delta;
      else actor.play(actor.hasClip('Pistol_Aim_Neutral') ? 'Pistol_Aim_Neutral' : 'Pistol_Idle', 0.2);
      // spara quando ha girato il busto verso il bersaglio
      const facingErr = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - g.rotation.y), Math.cos(Math.atan2(dx, dz) - g.rotation.y)));
      // non si spara a un giocatore gia' a terra
      const playerDown = store.health <= 0;
      if (s.fireCd <= 0 && facingErr < 0.35 && dist <= FIRE_RANGE && !playerDown) {
        s.fireCd = FIRE_COOLDOWN_S + Math.random() * 0.5;
        pistol.getMuzzleWorld(_muzzle);
        const onFoot = store.currentControllable === 'player';
        const targetY = onFoot ? pp[1] - 0.5 + PLAYER_CHEST_HEIGHT : pp[1];
        _aim.set(pp[0], targetY, pp[2]).sub(_muzzle).normalize();
        // un po' di dispersione
        _perp.set(-_aim.z, 0, _aim.x).normalize();
        _aim.addScaledVector(_perp, (Math.random() * 2 - 1) * SPREAD_RAD);
        _aim.y += (Math.random() * 2 - 1) * SPREAD_RAD;
        _aim.normalize();
        // parte oltre la propria mano (le proprie capsule fermerebbero il colpo)
        const o = _muzzle.clone().addScaledVector(_aim, 0.3);
        const bid = `enemy-bullet-${id}-${s.serial++}`;
        setBullets((prev) => [
          ...prev,
          { id: bid, pos: [o.x, o.y, o.z], vel: [_aim.x * BULLET_SPEED, _aim.y * BULLET_SPEED, _aim.z * BULLET_SPEED] },
        ]);
        pistol.kick();
        pistol.playShot();
        if (actor.hasClip('Pistol_Shoot')) {
          actor.play('Pistol_Shoot', 0.05, false);
          s.shootAnim = Math.min(0.45, actor.clipDuration('Pistol_Shoot'));
        }
      }
    }

    // rinuncia se non riesce a starti a tiro
    if (dist <= FIRE_RANGE) s.giveUp = 0;
    else {
      s.giveUp += delta;
      if (s.giveUp >= GIVE_UP_TIME && !s.gaveUp) {
        s.gaveUp = true;
        onGiveUp(id);
        return;
      }
    }

    if (Math.random() < 0.002 && !message) {
      setMessage(PHRASES[Math.floor(Math.random() * PHRASES.length)]);
      setTimeout(() => setMessage(''), 2500);
    }

    const groundY = getTerrainHeight(data.position.x, data.position.z) + getRoadOffset(data.position.x, data.position.z);
    g.position.set(data.position.x, groundY, data.position.z);
    // convenzione dei combattenti: avanti = (-sin, -cos)
    data.rotation = g.rotation.y + Math.PI;

    s.entityT -= delta;
    if (s.entityT <= 0) {
      s.entityT = 0.2;
      store.updateEntity(id, {
        type: 'enemy',
        position: [data.position.x, groundY + 1, data.position.z],
        rotation: g.rotation.y,
      });
    }
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
      {bullets.map((b) => (
        <Bullet key={b.id} id={b.id} position={b.pos} velocity={b.vel} owner="enemy" onKill={removeBullet} />
      ))}
    </>
  );
};

export default Enemy;
