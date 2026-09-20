import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../../store';
import type { SolidBodySegmentDebug } from './ragdoll/useRagdoll';

// "mettilo a forma di t e fammi vedere le giunzioni" -- gemello di
// SolidBodyDebugView.tsx, ma per il layer ragdoll ATTIVO (PD, sempre
// acceso) invece del layer solid-body kinematico: disegna un wireframe
// capsula per ognuno dei 16 segmenti di ACTIVE_RAGDOLL_SEGMENTS (gli 11
// originali + SpineMid/SpineHigh/ClavicleL/ClavicleR aggiunti in questa
// sessione + Neck, "collo come segmento fisico proprio", separato dalla
// Testa), cosi' si vede a occhio se raggio/lunghezza/posizionamento
// di ogni capsula sono anatomicamente sensati -- specialmente utile
// insieme al toggle "Forza T-Pose" (store's debugTPoseJoints), che
// ferma mixer/fisica e mette lo skeleton in bind pose per un'ispezione
// senza rumore di movimento. Colore diverso da SolidBodyDebugView (quel
// ciano e' gia' usato per gli 11+4 colliders kinematici del movimento)
// cosi' i due layer restano distinguibili se mai visualizzati insieme.
const MAX_ACTIVE_RAGDOLL_SEGMENTS = 16; // 11 originali + SpineMid/SpineHigh/ClavicleL/ClavicleR + Neck
const DEBUG_COLOR = '#ff9100';

interface ActiveRagdollDebugViewProps {
  // Stesso pattern pull-based di SolidBodyDebugView -- niente re-render
  // React ogni frame, si legge lo stato live da dentro useFrame.
  getSegments: () => SolidBodySegmentDebug[];
}

const ActiveRagdollDebugView: React.FC<ActiveRagdollDebugViewProps> = ({ getSegments }) => {
  const meshRefs = useRef<(THREE.Mesh | null)[]>([]);
  const geomCache = useRef<Record<string, THREE.CapsuleGeometry>>({});
  const geomKeyPerSlot = useRef<(string | null)[]>(new Array(MAX_ACTIVE_RAGDOLL_SEGMENTS).fill(null));

  useFrame(() => {
    const show = useStore.getState().debugTPoseJoints;
    if (!show) {
      for (const mesh of meshRefs.current) {
        if (mesh && mesh.visible) mesh.visible = false;
      }
      return;
    }

    const segments = getSegments();
    for (let i = 0; i < MAX_ACTIVE_RAGDOLL_SEGMENTS; i++) {
      const mesh = meshRefs.current[i];
      if (!mesh) continue;
      const seg = segments[i];
      if (!seg) {
        mesh.visible = false;
        continue;
      }

      mesh.visible = true;
      mesh.position.set(seg.x, seg.y, seg.z);
      mesh.quaternion.set(seg.qx, seg.qy, seg.qz, seg.qw);

      // "la testa nel ragdoll mi sembra piu' grande della mesh" / poi
      // "troppo alta esce dalla mesh" -- la causa vera di un rimbalzo di
      // segnalazioni durante il tuning della Testa: questa cache era
      // chiavata SOLO sul NOME del segmento, quindi un cambio live di
      // radius/lengthScale/offsetOverrideM in ragdollConfig.ts (ricaricato
      // da Vite via HMR SENZA un refresh completo della pagina) non
      // invalidava mai la geometria gia' costruita -- il wireframe restava
      // silenziosamente quello VECCHIO finche' non si ricaricava la pagina
      // a mano, facendo sembrare sbagliata una calibrazione che in realta'
      // era gia' stata corretta nel codice. Chiave ora comprensiva anche
      // di raggio/mezza-altezza, cosi' la cache si invalida da sola non
      // appena la geometria REALE del segmento cambia.
      const geomKey = `${seg.name}:${seg.radius.toFixed(4)}:${seg.halfHeight.toFixed(4)}`;
      if (geomKeyPerSlot.current[i] !== geomKey) {
        let geom = geomCache.current[geomKey];
        if (!geom) {
          geom = new THREE.CapsuleGeometry(seg.radius, seg.halfHeight * 2, 4, 8);
          geomCache.current[geomKey] = geom;
        }
        mesh.geometry = geom;
        geomKeyPerSlot.current[i] = geomKey;
      }
    }
  });

  return (
    <group>
      {Array.from({ length: MAX_ACTIVE_RAGDOLL_SEGMENTS }).map((_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            meshRefs.current[i] = m;
          }}
          visible={false}
        >
          <meshBasicMaterial color={DEBUG_COLOR} wireframe transparent opacity={0.9} depthTest={false} />
        </mesh>
      ))}
    </group>
  );
};

export default ActiveRagdollDebugView;
