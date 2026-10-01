import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { radarState } from '../../lib/radarState';

const _dir = new THREE.Vector3();

// Dentro il Canvas: pubblica la direzione della camera per la minimappa.
const RadarCameraBridge: React.FC = () => {
  useFrame(({ camera }) => {
    camera.getWorldDirection(_dir);
    if (_dir.x * _dir.x + _dir.z * _dir.z < 1e-6) return; // guarda dritto in basso/alto: tiene l'ultima
    radarState.camHeading = Math.atan2(_dir.x, -_dir.z);
    radarState.valid = true;
  });
  return null;
};

export default RadarCameraBridge;
