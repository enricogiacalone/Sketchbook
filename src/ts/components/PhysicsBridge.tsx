import { useEffect } from 'react';
import { useRapier } from '@react-three/rapier';
import type RAPIER from '@dimforge/rapier3d-compat';
import { physicsBridge } from '../lib/physicsBridge';

// Passa il mondo fisico a lib/physicsBridge.ts (per chi sta fuori da <Physics>)
const PhysicsBridge: React.FC = () => {
  const { world, rapier } = useRapier();
  useEffect(() => {
    physicsBridge.world = world;
    physicsBridge.rapier = rapier as unknown as typeof RAPIER;
    return () => {
      if (physicsBridge.world === world) {
        physicsBridge.world = null;
        physicsBridge.rapier = null;
      }
    };
  }, [world, rapier]);
  return null;
};

export default PhysicsBridge;
