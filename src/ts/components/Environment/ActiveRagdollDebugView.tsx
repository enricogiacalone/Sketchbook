import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../../store';
import type { ActiveRagdollSegmentDebug } from './ragdoll/useRagdoll';

// "impostare la vista in modo da avere dei test empirici.. sia per te
// che per me.. cosi' almeno capiamo cosa nn va" -- stesso identico
// meccanismo di SolidBodyDebugView.tsx (pool fisso di mesh riusate,
// ma con un proprio flag separato (showActiveRagdollDebug, non
// showPhysicsDebug) -- vedi il commento su quel flag in store.ts per il
// perche'. Disegna i corpi VERI del layer
// attivo (activeBodiesRef in useRagdollActive.ts -- 17 segmenti,
// inclusi SpineMid/SpineHigh/ClavicleL/ClavicleR che il layer
// solid-body qui sopra non separa).
//
// "osserva bene questo collider ragdoll attivo.. mi pare nn
// corrispondere molto al personaggio.. fai le ossa di colori diversi
// per identificarli meglio" -- prima ogni capsula aveva solo 2 colori
// possibili (ciano/rosso in base a overLimit), quindi 17 capsule quasi
// tutte cianio erano indistinguibili tra loro a schermo: impossibile
// dire "questa e' SpineMid o Torso?" solo guardando. Ora ogni segmento
// ha un colore FISSO e distinto (SEGMENT_COLORS, sinistra=blu/viola,
// destra=rosso/rosa, tronco=oro->magenta dal bacino alla testa) cosi'
// si puo' seguire il singolo segmento nel tempo mentre si muove.
// overLimit resta segnalato, ma sovrascrive temporaneamente il colore
// del segmento con rosso acceso (COLOR_OVER_LIMIT) solo quando quel
// giunto sta davvero sforando il proprio cono -- il colore di identita'
// torna appena rientra nel limite.
const MAX_ACTIVE_SEGMENTS = 20; // margine sopra i 17 di ACTIVE_RAGDOLL_SEGMENTS -- vedi ragdollConfig.ts
const COLOR_OVER_LIMIT = new THREE.Color('#ff2222');
const COLOR_FALLBACK = new THREE.Color('#ffffff'); // segmento non elencato sotto (non dovrebbe succedere, ma niente capsule invisibili per errore)

// Palette fissa per nome segmento -- famiglie di colore per riconoscere
// a colpo d'occhio lato/regione: blu/viola per il braccio sinistro,
// rosso/rosa per il braccio destro, viola per la gamba sinistra,
// arancio/rosso per la gamba destra, oro->magenta per la catena del
// tronco dal bacino alla testa.
const SEGMENT_COLORS: Record<string, THREE.Color> = {
  Hips: new THREE.Color('#ffcc00'),
  Torso: new THREE.Color('#ff9900'),
  SpineMid: new THREE.Color('#99ff33'),
  SpineHigh: new THREE.Color('#33ff99'),
  Head: new THREE.Color('#ff00ff'),
  ClavicleL: new THREE.Color('#3366ff'),
  UpperArm_L: new THREE.Color('#3399ff'),
  ForeArm_L: new THREE.Color('#33ccff'),
  ClavicleR: new THREE.Color('#ff3366'),
  UpperArm_R: new THREE.Color('#ff6699'),
  ForeArm_R: new THREE.Color('#ff99cc'),
  Thigh_L: new THREE.Color('#6633ff'),
  Shin_L: new THREE.Color('#9966ff'),
  Foot_L: new THREE.Color('#cc99ff'),
  Thigh_R: new THREE.Color('#ff3300'),
  Shin_R: new THREE.Color('#ff6633'),
  Foot_R: new THREE.Color('#ff9966'),
};

interface ActiveRagdollDebugViewProps {
  // Pull-based, stesso pattern di SolidBodyDebugView.tsx -- niente
  // re-render React ogni frame, si legge lo stato fisico live da dentro
  // useFrame.
  getSegments: () => ActiveRagdollSegmentDebug[];
}

const COLOR_TARGET = new THREE.Color('#ffffff');

const ActiveRagdollDebugView: React.FC<ActiveRagdollDebugViewProps> = ({ getSegments }) => {
  const meshRefs = useRef<(THREE.Mesh | null)[]>([]);
  const materialRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  // "sistema l'ambiente per fare i test come si deve" -- secondo pool:
  // le capsule BERSAGLIO (dove l'animazione vuole ogni corpo), bianche e
  // trasparenti. Se il ragdoll segue bene l'animazione coincidono con
  // quelle colorate; lo scarto si vede a occhio.
  const targetMeshRefs = useRef<(THREE.Mesh | null)[]>([]);
  // Keyed by segment NAME -- raggio/halfHeight non cambiano per tutta la
  // vita del rig, la geometria si costruisce una volta sola.
  const geomCache = useRef<Record<string, THREE.CapsuleGeometry>>({});
  const geomKeyPerSlot = useRef<(string | null)[]>(new Array(MAX_ACTIVE_SEGMENTS).fill(null));
  const targetGeomKeyPerSlot = useRef<(string | null)[]>(new Array(MAX_ACTIVE_SEGMENTS).fill(null));

  const geomFor = (name: string, radius: number, halfHeight: number) => {
    const key = `${name}:${radius.toFixed(4)}:${halfHeight.toFixed(4)}`;
    let geom = geomCache.current[key];
    if (!geom) {
      geom = new THREE.CapsuleGeometry(radius, halfHeight * 2, 4, 10);
      geomCache.current[key] = geom;
    }
    return { key, geom };
  };

  useFrame(() => {
    const state = useStore.getState();
    const show = state.showActiveRagdollDebug;
    const showTargets = show && state.ragdollBench.showTargets;
    if (!show) {
      for (const mesh of meshRefs.current) if (mesh && mesh.visible) mesh.visible = false;
      for (const mesh of targetMeshRefs.current) if (mesh && mesh.visible) mesh.visible = false;
      return;
    }

    const segments = getSegments();
    for (let i = 0; i < MAX_ACTIVE_SEGMENTS; i++) {
      const mesh = meshRefs.current[i];
      const material = materialRefs.current[i];
      const tMesh = targetMeshRefs.current[i];
      const seg = segments[i];
      if (!seg) {
        if (mesh) mesh.visible = false;
        if (tMesh) tMesh.visible = false;
        continue;
      }
      // Stessa corrispondenza 1:1 col collider Rapier: capsule(halfHeight,
      // radius) <-> THREE.CapsuleGeometry(radius, halfHeight*2), gia'
      // orientata/posizionata come il COLLIDER (non come il perno del
      // giunto -- era il bug della vecchia vista).
      const { key, geom } = geomFor(seg.name, seg.radius, seg.halfHeight);
      if (mesh && material) {
        mesh.visible = true;
        mesh.position.set(seg.x, seg.y, seg.z);
        mesh.quaternion.set(seg.qx, seg.qy, seg.qz, seg.qw);
        material.color.copy(seg.overLimit ? COLOR_OVER_LIMIT : (SEGMENT_COLORS[seg.name] ?? COLOR_FALLBACK));
        if (geomKeyPerSlot.current[i] !== key) {
          mesh.geometry = geom;
          geomKeyPerSlot.current[i] = key;
        }
      }
      if (tMesh) {
        tMesh.visible = showTargets && seg.hasTarget;
        if (tMesh.visible) {
          tMesh.position.set(seg.tx, seg.ty, seg.tz);
          tMesh.quaternion.set(seg.tqx, seg.tqy, seg.tqz, seg.tqw);
          if (targetGeomKeyPerSlot.current[i] !== key) {
            tMesh.geometry = geom;
            targetGeomKeyPerSlot.current[i] = key;
          }
        }
      }
    }
  });

  return (
    <group>
      {Array.from({ length: MAX_ACTIVE_SEGMENTS }).map((_, i) => (
        <mesh
          key={`p${i}`}
          ref={(m) => {
            meshRefs.current[i] = m;
          }}
          visible={false}
          renderOrder={1000}
          frustumCulled={false}
        >
          <meshBasicMaterial
            ref={(mat) => {
              materialRefs.current[i] = mat;
            }}
            color={COLOR_FALLBACK}
            wireframe
            transparent
            opacity={0.9}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      ))}
      {Array.from({ length: MAX_ACTIVE_SEGMENTS }).map((_, i) => (
        <mesh
          key={`t${i}`}
          ref={(m) => {
            targetMeshRefs.current[i] = m;
          }}
          visible={false}
          renderOrder={999}
          frustumCulled={false}
        >
          <meshBasicMaterial color={COLOR_TARGET} wireframe transparent opacity={0.3} depthTest={false} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
};

export default ActiveRagdollDebugView;
