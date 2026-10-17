import React, { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { SkyMesh } from 'three/examples/jsm/objects/SkyMesh.js';
// @ts-ignore (i tipi di three/tsl del progetto non elencano questi export)
import { toneMapping, uniform as tslUniform, vec4 as tslVec4 } from 'three/tsl';
import { getSunDirection } from '../../lib/SunCycle';
import { getPlanetStyle, usePlanetEpoch } from '../../lib/planet';
import { skySettings, spaceState } from '../../lib/space';
import { getDayFactor } from '../../lib/SunCycle';

const SUN_DISTANCE = 400000;

const SPACE_BG = new THREE.Color('#01020a');
const FLAT_BG = new THREE.Color();
const FLAT_DAY = new THREE.Color();
const FLAT_NIGHT = new THREE.Color('#05060d');

const Sky: React.FC = () => {
  const { camera } = useThree();
  const inSpace = React.useRef(false);
  const flat = React.useRef(false);
  const domeRef = React.useRef<THREE.Mesh>(null);

  // Creiamo l'istanza di SkyMesh nativa per WebGPU
  const sky = useMemo(() => {
    const skyMesh = new SkyMesh();

    // Scaliamo la mesh del cielo
    skyMesh.scale.setScalar(1000);

    // I parametri sono UniformNode: si aggiornano modificando .value
    const style = getPlanetStyle(); // cielo del pianeta
    skyMesh.turbidity.value = style.skyTurbidity;
    skyMesh.rayleigh.value = style.skyRayleigh;
    skyMesh.mieCoefficient.value = 0.005;
    skyMesh.mieDirectionalG.value = 0.7;

    // niente nuvole dello shader: il gioco ha le sue (Clouds.tsx), che seguono gli strati dell'atmosfera
    skyMesh.cloudCoverage.value = 0;

    // Il modello di Preetham da' valori HDR (nell'esempio di three: ACES con esposizione 0.5): senza
    // tone mapping il cielo saturava a bianco. Lo mappiamo noi, con un'esposizione regolabile.
    const mat = skyMesh.material as any;
    const exposure = tslUniform(0.035); // (0.5 e' per un mondo con tone mapping: qui il cielo saturava a bianco)
    mat.colorNode = tslVec4(toneMapping(THREE.ACESFilmicToneMapping, exposure, mat.colorNode.rgb), 1.0);
    mat.needsUpdate = true;
    (skyMesh as any).userData.exposure = exposure;

    return skyMesh;
  }, []);

  // cambio pianeta: nuovo cielo
  const epoch = usePlanetEpoch();
  useEffect(() => {
    const st = getPlanetStyle();
    sky.turbidity.value = st.skyTurbidity;
    sky.rayleigh.value = st.skyRayleigh;
  }, [epoch, sky]);

  useFrame((state) => {
    const dir = getSunDirection(state.clock.elapsedTime);

    // l'atmosfera si dirada con la quota (lib/space.ts): cielo nero nello spazio
    // (salendo il cielo perde diffusione e la cupola nera lo copre a poco a poco)
    const dark = spaceState.dark;
    const air = 1 - dark;
    const space = dark > 0.995;
    const shader = skySettings.shader;
    sky.visible = shader && !space;
    if (shader) {
      if (space !== inSpace.current || flat.current) {
        inSpace.current = space;
        flat.current = false;
        state.scene.background = space ? SPACE_BG : null;
      }
    } else {
      // shader spento: colore piatto (foschia del pianeta di giorno, scuro di notte e nello spazio)
      flat.current = true;
      if (!(state.scene.background instanceof THREE.Color) || state.scene.background === SPACE_BG) state.scene.background = FLAT_BG;
      const dayF = getDayFactor(dir.y);
      FLAT_BG.copy(FLAT_NIGHT).lerp(FLAT_DAY.set(getPlanetStyle().fogTint), dayF).lerp(SPACE_BG, dark);
    }
    const st = getPlanetStyle();
    sky.rayleigh.value = st.skyRayleigh * (0.15 + 0.85 * air);
    sky.mieCoefficient.value = 0.005 * (0.1 + 0.9 * air);
    if (domeRef.current) {
      domeRef.current.position.copy(camera.position);
      domeRef.current.visible = dark > 0.002;
      (domeRef.current.material as THREE.MeshBasicMaterial).opacity = Math.pow(dark, 0.85);
    }

    // Aggiorniamo la posizione del sole sulla UniformNode di SkyMesh
    sky.sunPosition.value.copy(dir).multiplyScalar(SUN_DISTANCE);

    // Manteniamo la cupola del cielo centrata sulla telecamera
    sky.position.copy(camera.position);
  });

  return (
    <>
      <primitive object={sky} />
      {/* cupola nera lontana (sopra il cielo, sotto pianeti e sole che la occludono): fa il
          cielo sempre piu' scuro con la quota, senza stacchi */}
      <mesh ref={domeRef} renderOrder={-10} frustumCulled={false} visible={false}>
        <sphereGeometry args={[800000, 32, 16]} />
        <meshBasicMaterial color="#000208" side={THREE.BackSide} transparent opacity={0} depthWrite={false} fog={false} toneMapped={false} />
      </mesh>
    </>
  );
};

export default Sky;
