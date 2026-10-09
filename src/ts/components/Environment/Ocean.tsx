import React, { useMemo } from 'react';
import { color, cos, float, mix, positionLocal, sin, time, vec3 } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';

const Ocean: React.FC = () => {
  const material = useMemo(() => {
    const mat = new MeshStandardNodeMaterial();

    // Nodo di tempo gestito direttamente dalla GPU (nessun loop JS / useFrame necessario!)

    const posX = positionLocal.x;
    const posY = positionLocal.y;

    // 1. Calcolo onde procedurali (combinazione di frequenze e direzioni diverse)
    const wave1 = sin(posX.mul(0.05).add(time.mul(1.5))).mul(0.8);
    const wave2 = cos(posY.mul(0.08).add(time.mul(2.0))).mul(0.5);
    const wave3 = sin(posX.mul(0.02).add(posY.mul(0.03)).add(time.mul(0.8))).mul(1.2);

    const totalWaveHeight = wave1.add(wave2).add(wave3);

    // 2. Vertex Displacement: spostiamo i vertici sull'asse Z locale (che diventerà l'altezza Y)
    mat.positionNode = positionLocal.add(vec3(0, 0, totalWaveHeight));

    // 3. Shading dinamico basato sull'altezza dell'onda
    const deepWater = color(0x0a2540); // Blu scuro profondo
    const shallowWater = color(0x1a6b8c); // Turchese di superficie
    const foamColor = color(0xd4f1f9); // Schiuma bianca per le creste

    // Normalizziamo l'altezza dell'onda tra ~0 e 1
    const waveFactor = totalWaveHeight.add(2.0).div(4.0);
    const waterColor = mix(deepWater, shallowWater, waveFactor);

    // Applichiamo un tocco di schiuma solo sulle creste più alte
    const finalColor = mix(waterColor, foamColor, waveFactor.pow(4.0));

    // 4. Assegnazione nodi al materiale WebGPU
    mat.colorNode = finalColor;
    mat.roughnessNode = float(0.1);
    mat.metalnessNode = float(0.1);
    mat.transparent = true;
    mat.opacity = 0.88;

    return mat;
  }, []);

  return (
    <mesh material={material} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
      {/* Portati i segmenti a 128x128 per permettere alla GPU di piegare i vertici delle onde */}
      <planeGeometry args={[1000, 1000, 128, 128]} />
    </mesh>
  );
};

export default Ocean;
