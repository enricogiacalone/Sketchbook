import React, { useEffect } from 'react';
import { useRapier } from '@react-three/rapier';
import { getPlanetStyle, usePlanetEpoch, usePlanetMounted } from '../lib/planet';

// Cambio pianeta (lib/planet.ts, lib/warp.ts): smonta davvero i figli (scena,
// giocatore, drone: i loro corpi Rapier escono dal mondo) e li rimonta nuovi.
// Il gate sta DENTRO l'albero di R3F e legge lo stato da solo: un cambio di
// props dell'App non basta a far smontare i figli di <Canvas>.
const WorldGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const mounted = usePlanetMounted();
  const epoch = usePlanetEpoch();
  const { world } = useRapier();
  // gravita' del pianeta
  useEffect(() => {
    world.gravity = { x: 0, y: -20 * getPlanetStyle().gravity, z: 0 };
  }, [world, epoch]);
  if (!mounted) return null;
  // dispose={null}: R3F non libera geometrie e materiali dei figli allo smontaggio.
  // Molti sono condivisi a livello di modulo (sharedMaterials, geometrie delle
  // strade...) e il renderer WebGPU, se li ritrova liberati, smette di disegnare
  // ("Buffer used in submit while destroyed"). Costo: la memoria GPU del mondo
  // vecchio non si libera.
  return (
    <group key={epoch} dispose={null}>
      {children}
    </group>
  );
};

export default WorldGate;
