import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../../store';

// "aggiungi la possibilita' di attivare la vista ortogonale.. analizza i
// vari scheletri ad uno ad uno" -- una camera prospettica distorce
// leggermente l'inquadratura (le parti piu' vicine sembrano piu' grandi),
// il che rende difficile giudicare ad occhio se una capsula di debug e'
// davvero allineata alla mesh o solo sembra esserlo per via
// dell'angolazione. Questa camera ortogonale (nessuna distorsione
// prospettica, come un disegno tecnico) prende il controllo del Canvas
// via drei's makeDefault quando store.ts's debugOrthoCamera e' true --
// vedi anche useThirdPersonCamera.ts, che smette di muovere la camera
// mentre questa e' attiva, altrimenti i due si contenderebbero lo stesso
// oggetto camera ogni frame.
//
// Orbita a raggio/altezza fissi attorno al bersaglio -- il giocatore del
// duello (DUEL_PLAYER_ID), trovato per nome nella scena, stesso pattern
// gia' usato da useThirdPersonCamera.ts -- all'angolo scelto in
// store.ts's debugOrthoCameraAngleDeg (0=frontale, 90/180/270=laterale/
// retro/laterale opposto, vedi CombatArenaGUI.tsx's pulsante "Ruota
// vista 90'"), cosi' si puo' girare attorno al personaggio un lato alla
// volta per confrontare i vari "scheletri" di debug (collider solid-body
// vs collider ragdoll attivo, vedi ActiveRagdollDebugView.tsx/
// SolidBodyDebugView.tsx) da piu' angolazioni.
const ORBIT_RADIUS = 3;
const TARGET_HEIGHT_OFFSET = 1.0; // punta al petto, non ai piedi (groupRef.position e' a livello del suolo)
const DUEL_PLAYER_NAME = 'duel-player';

const _camTarget = new THREE.Vector3();
const _camPos = new THREE.Vector3();

const DebugOrthoCamera: React.FC = () => {
  const camRef = useRef<THREE.OrthographicCamera>(null);
  const { scene } = useThree();
  const targetObjRef = useRef<THREE.Object3D | null>(null);
  const lastLookupAtRef = useRef(0);
  // Prop reattiva (non letta dentro useFrame) -- drei's makeDefault fa
  // lo swap di state.camera in un proprio effect quando questa prop
  // CAMBIA a livello di render React, non se solo mutassimo qualcosa
  // dentro il loop di useFrame.
  const debugOrthoCamera = useStore((state) => state.debugOrthoCamera);

  useFrame((state) => {
    if (!useStore.getState().debugOrthoCamera) return;
    const cam = camRef.current;
    if (!cam) return;

    // Stesso schema di cache-e-ricontrolla-ogni-tanto di
    // useThirdPersonCamera.ts (riga ~165 li') -- niente scene.traverse()
    // completo ogni singolo frame.
    const now = state.clock.elapsedTime;
    if (!targetObjRef.current || now - lastLookupAtRef.current > 0.5) {
      targetObjRef.current = scene.getObjectByName(DUEL_PLAYER_NAME) ?? null;
      lastLookupAtRef.current = now;
    }
    const target = targetObjRef.current;
    if (!target) return;

    target.getWorldPosition(_camTarget);
    _camTarget.y += TARGET_HEIGHT_OFFSET;

    const angleRad = THREE.MathUtils.degToRad(useStore.getState().debugOrthoCameraAngleDeg);
    _camPos.set(
      _camTarget.x + ORBIT_RADIUS * Math.sin(angleRad),
      _camTarget.y,
      _camTarget.z + ORBIT_RADIUS * Math.cos(angleRad)
    );
    cam.position.copy(_camPos);
    cam.lookAt(_camTarget);
  });

  return (
    <OrthographicCamera
      ref={camRef}
      makeDefault={debugOrthoCamera}
      near={0.1}
      far={50}
      zoom={230}
    />
  );
};

export default DebugOrthoCamera;
