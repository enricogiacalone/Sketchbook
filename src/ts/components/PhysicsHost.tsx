import React from 'react';
import { Physics } from '@react-three/rapier';
import { usePhysicsEpoch } from '../lib/planet';

// <Physics> che si ricrea (mondo Rapier nuovo di zecca) a ogni cambio di
// pianeta, DOPO che i figli del mondo sono stati smontati (lib/planet.ts,
// recreatePhysics): un mondo nuovo per ogni citta' evita che lo stato di
// Rapier accumulato da montaggi e smontaggi ripetuti vada in panico. La key sta
// dentro l'albero di R3F perche' dall'App non si propaga.
const PhysicsHost: React.FC<React.ComponentProps<typeof Physics>> = (props) => {
  const epoch = usePhysicsEpoch();
  return <Physics key={epoch} {...props} />;
};

export default PhysicsHost;
