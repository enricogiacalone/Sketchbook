import React, { useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { SkyMesh } from 'three/examples/jsm/objects/SkyMesh.js';
import { getSunDirection } from '../../lib/SunCycle';

const SUN_DISTANCE = 400000;

const Sky: React.FC = () => {
  const { camera } = useThree();

  // Creiamo l'istanza di SkyMesh nativa per WebGPU
  const sky = useMemo(() => {
    const skyMesh = new SkyMesh();

    // Scaliamo la mesh del cielo
    skyMesh.scale.setScalar(1000);

    // I parametri sono UniformNode: si aggiornano modificando .value
    skyMesh.turbidity.value = 10;
    skyMesh.rayleigh.value = 3;
    skyMesh.mieCoefficient.value = 0.005;
    skyMesh.mieDirectionalG.value = 0.7;

    // Opzionale: SkyMesh in WebGPU supporta anche le nuvole procedurali
    // skyMesh.cloudCoverage.value = 0.4;

    return skyMesh;
  }, []);

  useFrame((state) => {
    const dir = getSunDirection(state.clock.elapsedTime);

    // Aggiorniamo la posizione del sole sulla UniformNode di SkyMesh
    sky.sunPosition.value.copy(dir).multiplyScalar(SUN_DISTANCE);

    // Manteniamo la cupola del cielo centrata sulla telecamera
    sky.position.copy(camera.position);
  });

  return <primitive object={sky} />;
};

export default Sky;
