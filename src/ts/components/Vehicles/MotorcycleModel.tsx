import React from 'react';
import * as THREE from 'three';
import { MOTO } from '../../lib/motorcycleGeometry';

// Modello della moto, fatto di forme semplici (nessun file). Nel sistema della moto (lib/motorcycleGeometry.ts):
// +Z avanti, +X a sinistra, y = 0 sotto le ruote.
//
// Con le sospensioni (lib/motoSuspension.ts) il modello e' diviso in due:
//  - NON sospeso: le due ruote, la parte bassa della forcella (gli steli, che scorrono dentro i foderi) e il fulcro delle
//    ruote; restano sempre sul terreno;
//  - SOSPESO (`sprungRef`): telaio, motore, serbatoio, sella, scarico, pedane, testa di sterzo con foderi della
//    forcella, manubrio, faro, forcellone e mono-ammortizzatore posteriore. Si muove (sobbalzo + beccheggio) e porta
//    con se' i nodi `seat_1` e il pilota.
// Chi muove la moto aggiorna le ref ogni frame (`setSuspension` in Motorcycle.tsx / TrafficMoto.tsx).

const BODY_DEFAULT = '#c62828';
const DARK = '#1f2328';
const METAL = '#b9bfc7';
const TIRE = '#16181b';
const GLASS = '#fff4cc';
const GOLD = '#d9a520';
const SPRING = '#2b6cb0';

export const rake = THREE.MathUtils.degToRad(MOTO.rakeDeg);
// asse della forcella: dalla testa di sterzo al mozzo (verso il basso e un po' avanti)
export const FORK_DIR = new THREE.Vector3(
  MOTO.frontWheel[0] - MOTO.steerHead[0],
  MOTO.frontWheel[1] - MOTO.steerHead[1],
  MOTO.frontWheel[2] - MOTO.steerHead[2]
).normalize();
export const FORK_LEN = Math.hypot(
  MOTO.frontWheel[0] - MOTO.steerHead[0],
  MOTO.frontWheel[1] - MOTO.steerHead[1],
  MOTO.frontWheel[2] - MOTO.steerHead[2]
);
// fulcro del forcellone e attacco alto del mono (nel sistema sospeso)
export const SWING_PIVOT = new THREE.Vector3(0, 0.5, -0.22);
export const SHOCK_TOP = new THREE.Vector3(0, 0.8, -0.36);
// il mono si attacca al forcellone a questa frazione della sua lunghezza
export const SHOCK_ARM_FRAC = 0.6;
// punto attorno a cui beccheggia il telaio
export const PITCH_PIVOT = new THREE.Vector3(0, 0.45, 0);

const Wheel = React.forwardRef<THREE.Group, { position?: [number, number, number] }>(({ position }, ref) => {
  const r = MOTO.wheelRadius;
  return (
    <group ref={ref} position={position}>
      {/* pneumatico: un toro, con asse lungo X */}
      <mesh rotation={[0, Math.PI / 2, 0]} castShadow>
        <torusGeometry args={[r - 0.07, 0.085, 10, 28]} />
        <meshStandardMaterial color={TIRE} roughness={0.9} />
      </mesh>
      {/* cerchio e mozzo */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[r - 0.09, r - 0.09, 0.07, 20]} />
        <meshStandardMaterial color={METAL} metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.05, 0.05, 0.14, 12]} />
        <meshStandardMaterial color={DARK} />
      </mesh>
      {/* freno a disco: le razze si vedono girare */}
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} rotation={[(i * Math.PI) / 5, 0, 0]}>
          <boxGeometry args={[0.075, 0.03, (r - 0.1) * 2]} />
          <meshStandardMaterial color={DARK} />
        </mesh>
      ))}
    </group>
  );
});
Wheel.displayName = 'MotoWheel';

export interface MotorcycleModelRefs {
  rearWheelRef?: React.Ref<THREE.Group>;
  frontWheelRef?: React.Ref<THREE.Group>;
  // sterzo: la testa (sospesa) e il gruppo della ruota anteriore con gli steli (non sospeso) girano insieme
  forkRef?: React.Ref<THREE.Group>;
  frontSteerRef?: React.Ref<THREE.Group>;
  // massa sospesa, forcellone e mono (aggiornati dalle sospensioni)
  sprungRef?: React.Ref<THREE.Group>;
  swingarmRef?: React.Ref<THREE.Mesh>;
  shockRef?: React.Ref<THREE.Group>;
  // steli della forcella (parte bassa): scorrono lungo l'asse
  sliderRef?: React.Ref<THREE.Group>;
  // colore della carrozzeria (serbatoio, codino, parafanghi)
  color?: string;
  // nodi e figli nella massa sospesa (la sella, il pilota)
  children?: React.ReactNode;
}

const MotorcycleModel: React.FC<MotorcycleModelRefs> = ({
  rearWheelRef,
  frontWheelRef,
  forkRef,
  frontSteerRef,
  sprungRef,
  swingarmRef,
  shockRef,
  sliderRef,
  color = BODY_DEFAULT,
  children,
}) => {
  const BODY = color;
  const [hx, hy, hz] = MOTO.steerHead;
  // i foderi (parte alta, sospesa) e gli steli (parte bassa, non sospesa) si sovrappongono: ~0,18 m di corsa utile
  const UPPER = FORK_LEN * 0.72;
  const LOWER = FORK_LEN * 0.55;
  // inclinazione del cilindro lungo l'asse della forcella (il cilindro e' lungo Y)
  const forkQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), FORK_DIR);
  const forkEuler = new THREE.Euler().setFromQuaternion(forkQuat);
  return (
    <group>
      {/* ------------------------------------------------------------ NON SOSPESO */}
      <Wheel ref={rearWheelRef} position={MOTO.rearWheel} />
      <group position={MOTO.frontWheel}>
        <group ref={frontSteerRef}>
          <Wheel ref={frontWheelRef} />
          {/* parafango anteriore (segue la ruota) */}
          <mesh position={[0, 0.32, 0.02]}>
            <boxGeometry args={[0.16, 0.03, 0.46]} />
            <meshStandardMaterial color={BODY} metalness={0.3} roughness={0.4} />
          </mesh>
          {/* steli: dal mozzo verso la testa di sterzo, dorati come gli ammortizzatori di una sportiva */}
          <group ref={sliderRef} rotation={[forkEuler.x, forkEuler.y, forkEuler.z]}>
            {[1, -1].map((s) => (
              <mesh key={s} position={[s * 0.09, LOWER / 2, 0]} castShadow>
                <cylinderGeometry args={[0.032, 0.032, LOWER, 10]} />
                <meshStandardMaterial color={GOLD} metalness={0.85} roughness={0.25} />
              </mesh>
            ))}
          </group>
        </group>
      </group>

      {/* ------------------------------------------------------------ SOSPESO */}
      <group ref={sprungRef}>
        {/* telaio: tubo dalla testa di sterzo verso la ruota posteriore + culla del motore */}
        <mesh position={[0, 0.74, -0.05]} rotation={[-0.12, 0, 0]} castShadow>
          <boxGeometry args={[0.1, 0.1, 1.0]} />
          <meshStandardMaterial color={DARK} metalness={0.4} roughness={0.5} />
        </mesh>
        {/* motore */}
        <mesh position={[0, 0.47, 0.02]} castShadow>
          <boxGeometry args={[0.3, 0.34, 0.5]} />
          <meshStandardMaterial color="#3a3f46" metalness={0.6} roughness={0.45} />
        </mesh>
        <mesh position={[0, 0.5, 0.0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.13, 0.13, 0.42, 16]} />
          <meshStandardMaterial color={METAL} metalness={0.7} roughness={0.4} />
        </mesh>
        {/* serbatoio */}
        <mesh position={[0, 0.9, 0.23]} scale={[0.5, 0.34, 0.95]} castShadow>
          <sphereGeometry args={[0.3, 18, 14]} />
          <meshStandardMaterial color={BODY} metalness={0.3} roughness={0.35} />
        </mesh>
        {/* sella e codino */}
        <mesh position={[0, MOTO.saddle[1] - 0.05, MOTO.saddle[2]]} castShadow>
          <boxGeometry args={[0.3, 0.1, 0.62]} />
          <meshStandardMaterial color="#222" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.84, -0.72]} rotation={[0.35, 0, 0]} castShadow>
          <boxGeometry args={[0.24, 0.08, 0.5]} />
          <meshStandardMaterial color={BODY} metalness={0.3} roughness={0.35} />
        </mesh>
        {/* parafango posteriore e fanale */}
        <mesh position={[0, 0.66, -0.9]} rotation={[0.5, 0, 0]}>
          <boxGeometry args={[0.18, 0.03, 0.34]} />
          <meshStandardMaterial color={DARK} />
        </mesh>
        <mesh position={[0, 0.72, -1.03]}>
          <boxGeometry args={[0.14, 0.05, 0.03]} />
          <meshStandardMaterial color="#ff2a2a" emissive="#ff1010" emissiveIntensity={1.2} />
        </mesh>
        {/* scarichi */}
        {[1, -1].map((s) => (
          <mesh key={s} position={[s * 0.2, 0.36, -0.55]} rotation={[Math.PI / 2 + 0.05, 0, 0]} castShadow>
            <cylinderGeometry args={[0.045, 0.06, 0.95, 12]} />
            <meshStandardMaterial color={METAL} metalness={0.8} roughness={0.3} />
          </mesh>
        ))}
        {/* pedane */}
        {[1, -1].map((s) => (
          <mesh key={s} position={[s * MOTO.pegL[0], MOTO.pegL[1], MOTO.pegL[2]]}>
            <boxGeometry args={[0.16, 0.035, 0.07]} />
            <meshStandardMaterial color={DARK} />
          </mesh>
        ))}

        {/* testa di sterzo + foderi della forcella + manubrio + faro: sterzano insieme intorno al cannotto */}
        <group position={[hx, hy, hz]}>
          <group ref={forkRef}>
            <group rotation={[forkEuler.x, forkEuler.y, forkEuler.z]}>
              {[1, -1].map((s) => (
                <mesh key={s} position={[s * 0.09, -UPPER / 2, 0]} castShadow>
                  <cylinderGeometry args={[0.042, 0.042, UPPER, 10]} />
                  <meshStandardMaterial color={METAL} metalness={0.8} roughness={0.3} />
                </mesh>
              ))}
              {/* molle visibili sopra la testa: due cilindri blu attorno ai foderi */}
              {[1, -1].map((s) => (
                <mesh key={`m${s}`} position={[s * 0.09, 0.04, 0]}>
                  <cylinderGeometry args={[0.05, 0.05, 0.1, 10]} />
                  <meshStandardMaterial color={SPRING} metalness={0.5} roughness={0.4} />
                </mesh>
              ))}
            </group>
            {/* manubrio e manopole (relative al cannotto) */}
            <mesh position={[0, MOTO.gripL[1] - hy, MOTO.gripL[2] - hz]} rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.016, 0.016, MOTO.gripL[0] * 2, 8]} />
              <meshStandardMaterial color={METAL} metalness={0.8} roughness={0.3} />
            </mesh>
            {[1, -1].map((s) => (
              <mesh key={s} position={[s * (MOTO.gripL[0] - 0.05), MOTO.gripL[1] - hy, MOTO.gripL[2] - hz]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.022, 0.022, 0.13, 10]} />
                <meshStandardMaterial color={DARK} roughness={0.9} />
              </mesh>
            ))}
            {/* faro */}
            <mesh position={[0, 0.02, 0.16]}>
              <sphereGeometry args={[0.1, 14, 12]} />
              <meshStandardMaterial color={GLASS} emissive={GLASS} emissiveIntensity={0.8} />
            </mesh>
            <mesh position={[0, 0.02, 0.09]}>
              <cylinderGeometry args={[0.115, 0.115, 0.12, 14]} />
              <meshStandardMaterial color={DARK} metalness={0.5} />
            </mesh>
          </group>
        </group>

        {/* forcellone: dal fulcro al mozzo posteriore (orientato ogni frame dalle sospensioni) */}
        <group position={[SWING_PIVOT.x, SWING_PIVOT.y, SWING_PIVOT.z]}>
          <mesh ref={swingarmRef} castShadow>
            <boxGeometry args={[0.1, 0.07, 1]} />
            <meshStandardMaterial color={DARK} metalness={0.5} roughness={0.45} />
          </mesh>
        </group>
        {/* mono-ammortizzatore: asta e molla, dal telaio al forcellone (lunghezza e verso ogni frame) */}
        <group ref={shockRef} position={[SHOCK_TOP.x, SHOCK_TOP.y, SHOCK_TOP.z]}>
          <mesh position={[0, 0.5, 0]} castShadow>
            <cylinderGeometry args={[0.022, 0.022, 1, 8]} />
            <meshStandardMaterial color={METAL} metalness={0.85} roughness={0.25} />
          </mesh>
          <mesh position={[0, 0.5, 0]}>
            <cylinderGeometry args={[0.04, 0.04, 0.62, 12]} />
            <meshStandardMaterial color={SPRING} metalness={0.4} roughness={0.45} />
          </mesh>
        </group>

        {children}
      </group>
    </group>
  );
};

export interface MotoSuspensionRefs {
  sprung: THREE.Group | null;
  swingarm: THREE.Mesh | null;
  shock: THREE.Group | null;
  fork: THREE.Group | null;
  frontSteer: THREE.Group | null;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _Y = new THREE.Vector3(0, 1, 0);
const _Z = new THREE.Vector3(0, 0, 1);

// Applica lo stato delle sospensioni (lib/motoSuspension.ts) al modello: massa sospesa, forcellone, mono, sterzo.
export function applyMotoSuspension(r: MotoSuspensionRefs, h: number, q: number, rearExt: number, steer: number) {
  if (r.sprung) {
    // beccheggio attorno al punto PITCH_PIVOT (muso in alto = rotazione negativa attorno a X) + sobbalzo
    r.sprung.rotation.x = -q;
    r.sprung.position.set(0, PITCH_PIVOT.y - PITCH_PIVOT.y * Math.cos(-q) + h, PITCH_PIVOT.y * Math.sin(-q));
  }
  if (r.fork) r.fork.rotation.y = steer;
  if (r.frontSteer) r.frontSteer.rotation.y = steer;
  // il mozzo posteriore, nel sistema della massa sospesa, scende di quanto il telaio sale
  _a.set(MOTO.rearWheel[0], MOTO.rearWheel[1] - rearExt, MOTO.rearWheel[2]).sub(SWING_PIVOT);
  const len = _a.length();
  if (r.swingarm) {
    r.swingarm.position.copy(_a).multiplyScalar(0.5);
    r.swingarm.scale.set(1, 1, len);
    r.swingarm.quaternion.setFromUnitVectors(_Z, _b.copy(_a).normalize());
  }
  if (r.shock) {
    // dal fissaggio sul telaio a un punto del forcellone
    _b.copy(_a).multiplyScalar(SHOCK_ARM_FRAC).add(SWING_PIVOT).sub(SHOCK_TOP);
    r.shock.scale.set(1, _b.length(), 1);
    r.shock.quaternion.copy(_q.setFromUnitVectors(_Y, _b.normalize()));
  }
}

export default MotorcycleModel;
