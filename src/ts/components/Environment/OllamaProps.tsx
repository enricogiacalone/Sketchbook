import React from 'react';
import { getTerrainHeight } from './Terrain';
import { getRoadOffset } from './Road';

export interface OllamaProp {
  name: string;
  x: number;
  z: number;
  shape: 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus';
  color: string;
  scale: [number, number, number];
}

export const OLLAMA_PROPS: OllamaProp[] = [
  { "name": "Monolite", "x": 10, "z": 20, "shape": "box", "color": "#38bdf8", "scale": [3, 10, 3] },
  { "name": "CityHall", "x": 15, "z": 25, "shape": "cylinder", "color": "#ff5733", "scale": [5, 20, 5] },
  { "name": "Park", "x": 30, "z": 40, "shape": "sphere", "color": "#33ff57", "scale": [10, 10, 10] },
  { "name": "Museum", "x": 45, "z": 55, "shape": "cone", "color": "#f838df", "scale": [4, 15, 4] },
  { "name": "Bridge", "x": 60, "z": 70, "shape": "torus", "color": "#33ffff", "scale": [7, 2, 7] }
];

export const OllamaProps: React.FC = () => {
  return (
    <group name="ollama-props">
      {OLLAMA_PROPS.map((p, i) => {
        const y = getTerrainHeight(p.x, p.z) + getRoadOffset(p.x, p.z) + (p.shape === 'sphere' ? p.scale[1] / 2 : p.scale[1] / 2);
        return (
          <group key={i} position={[p.x, y, p.z]}>
            <mesh castShadow receiveShadow>
              {p.shape === 'box' && <boxGeometry args={p.scale} />}
              {p.shape === 'cylinder' && <cylinderGeometry args={[p.scale[0]/2, p.scale[0]/2, p.scale[1], 16]} />}
              {p.shape === 'sphere' && <sphereGeometry args={[p.scale[0]/2, 16, 16]} />}
              {p.shape === 'cone' && <coneGeometry args={[p.scale[0]/2, p.scale[1], 16]} />}
              {p.shape === 'torus' && <torusGeometry args={[p.scale[0]/2, p.scale[0]/6, 16, 32]} />}
              <meshStandardMaterial color={p.color} emissive={p.color} emissiveIntensity={0.6} roughness={0.2} metalness={0.8} />
            </mesh>
            <pointLight color={p.color} intensity={3} distance={20} />
          </group>
        );
      })}
    </group>
  );
};

export default OllamaProps;
