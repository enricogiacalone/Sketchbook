import React, { useMemo } from 'react';
import { useStore } from '../../store';

const Minimap: React.FC = () => {
  const { playerPos, playerYaw, entities, health, maxHealth, armor } = useStore();

  const mapSize = 200;
  const worldSize = 100; // Visible area size

  const enemyDots = useMemo(() => {
    const dots: React.ReactNode[] = [];
    entities.forEach((entity, id) => {
      if (entity.type === 'enemy') {
        const relativeX = entity.position[0] - playerPos[0];
        const relativeZ = entity.position[2] - playerPos[2];
        const mapX = (relativeX / worldSize) * mapSize + mapSize / 2;
        const mapY = (relativeZ / worldSize) * mapSize + mapSize / 2;

        if (mapX >= 0 && mapX <= mapSize && mapY >= 0 && mapY <= mapSize) {
          dots.push(
            <div 
              key={id} 
              className="minimap-enemy" 
              style={{ left: mapX, top: mapY }} 
            />
          );
        }
      }
    });
    return dots;
  }, [entities, playerPos, worldSize, mapSize]);

  const vehicleIcons = useMemo(() => {
    const icons: React.ReactNode[] = [];
    entities.forEach((entity, id) => {
      if (entity.type === 'car' || entity.type === 'airplane' || entity.type === 'helicopter') {
        const relativeX = entity.position[0] - playerPos[0];
        const relativeZ = entity.position[2] - playerPos[2];
        const mapX = (relativeX / worldSize) * mapSize + mapSize / 2;
        const mapY = (relativeZ / worldSize) * mapSize + mapSize / 2;

        if (mapX >= 0 && mapX <= mapSize && mapY >= 0 && mapY <= mapSize) {
          const typeClass = `minimap-${entity.type}`;
          icons.push(
            <div 
              key={id} 
              className={`minimap-vehicle ${typeClass}`} 
              style={{ 
                left: mapX, 
                top: mapY,
                transform: `translate(-50%, -50%) rotate(${(entity.rotation - playerYaw) * (180 / Math.PI)}deg)`
              }} 
            />
          );
        }
      }
    });
    return icons;
  }, [entities, playerPos, playerYaw, worldSize, mapSize]);

  // Health and Armor Bar rotations
  const healthRotation = 45 + 180 * (health / (maxHealth || 100));
  const armorRotation = 225 + 180 * (armor / 100);

  return (
    <div style={{ position: 'absolute', bottom: 20, right: 20, width: mapSize, height: mapSize, pointerEvents: 'auto' }}>
      <div id="minimap-container" style={{ transform: `rotate(${-playerYaw}rad)` }}>
        <div id="minimap-north" style={{ transform: `translateX(-50%) rotate(${playerYaw}rad)` }}>N</div>
        {enemyDots}
        {vehicleIcons}
      </div>

      <div id="minimap-player" style={{ left: mapSize / 2, top: mapSize / 2, transform: `translate(-50%, -50%) rotate(${playerYaw}rad)` }} />

      <div id="health-bar-container">
        <div id="health-bar" className="bar-arc">
          <div className="bar-arc-fill" style={{ transform: `rotate(${healthRotation}deg)` }} />
        </div>
      </div>

      <div id="armor-bar-container">
        <div id="armor-bar" className="bar-arc">
          <div className="bar-arc-fill" style={{ transform: `rotate(${armorRotation}deg)` }} />
        </div>
      </div>
    </div>
  );
};

export default Minimap;
