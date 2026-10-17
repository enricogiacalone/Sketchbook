import React, { useEffect } from 'react';
import * as THREE from 'three';
import { usePistolModel, type PistolModelApi } from '../../Environment/weapons/usePistolModel';

// La pistola di un personaggio che la impugna solo ogni tanto (un passante
// della folla che tira fuori un'arma): si monta il componente solo quando
// serve, invece di tenere una pistola per ogni corpo del pool.
export const PistolGear: React.FC<{
  modelRootRef: React.RefObject<THREE.Object3D | null>;
  apiRef: React.MutableRefObject<PistolModelApi | null>;
}> = ({ modelRootRef, apiRef }) => {
  const pistol = usePistolModel(modelRootRef);
  apiRef.current = pistol;
  useEffect(
    () => () => {
      pistol.setVisible(false);
      apiRef.current = null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  return null;
};

// A mani nude (o prima che la pistola sia pronta): stesse chiamate, nessun effetto
export const NO_PISTOL: PistolModelApi = {
  setVisible: () => {},
  getMuzzleWorld: (out) => out,
  getBoreDirWorld: (out) => out,
  getSupportWorld: () => false,
  getGripWorld: (out) => out,
  setRaise: () => {},
  setWorldPose: () => {},
  getRearLocal: (out) => out,
  kick: () => {},
  setReloadProgress: () => {},
  playShot: () => {},
  playReload: () => {},
  stopReload: () => {},
  update: () => {},
};
