import React from 'react';
import { useStore } from '../../store';

const Crosshair: React.FC = () => {
  const { isCrosshairVisible } = useStore();

  if (!isCrosshairVisible) return null;

  return (
    <div id="crosshair" style={{ display: 'block' }}></div>
  );
};

export default Crosshair;
