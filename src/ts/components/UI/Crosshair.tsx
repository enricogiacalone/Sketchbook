import React from 'react';
import { useStore } from '../../store';

const Crosshair: React.FC = () => {
  const isCrosshairVisible = useStore((state) => state.isCrosshairVisible);
  // pilotando il drone c'e' il mirino di droneWorld (DroneHUD.tsx)
  const isDrone = useStore((state) => state.isDrone);

  if (!isCrosshairVisible || isDrone) return null;

  return (
    <div id="crosshair" style={{ display: 'block' }}></div>
  );
};

export default Crosshair;
