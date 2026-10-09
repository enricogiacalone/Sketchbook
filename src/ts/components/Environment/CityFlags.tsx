import React from 'react';
import PeaceFlag from '../../flyLab/PeaceFlag';
import { CITY_LAYOUT } from './City';
import { getTerrainHeight } from './Terrain';

const CityFlags: React.FC = () => {
  return (
    <group>
      {/* Central park flags */}
      <PeaceFlag position={[-8, getTerrainHeight(-8, -8), -8]} />
      <PeaceFlag position={[8, getTerrainHeight(8, 8), 8]} />

      {/* Flags at plazas */}
      {CITY_LAYOUT.plazas.map((p, i) => (
        <React.Fragment key={`plaza-flag-${i}`}>
          <PeaceFlag position={[p.x + 12, getTerrainHeight(p.x + 12, p.z + 12), p.z + 12]} />
          <PeaceFlag position={[p.x - 12, getTerrainHeight(p.x - 12, p.z - 12), p.z - 12]} />
        </React.Fragment>
      ))}

      {/* Perimeter / corner flags across the expanded city */}
      <PeaceFlag position={[-120, getTerrainHeight(-120, -120), -120]} />
      <PeaceFlag position={[120, getTerrainHeight(120, 120), 120]} />
      <PeaceFlag position={[-120, getTerrainHeight(-120, 120), 120]} />
      <PeaceFlag position={[120, getTerrainHeight(120, -120), -120]} />
    </group>
  );
};

export default CityFlags;
