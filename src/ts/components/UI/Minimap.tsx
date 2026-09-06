import React, { useMemo } from 'react';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';

const Minimap: React.FC = () => {
  const { playerPos, playerYaw, entities, health, maxHealth, armor } = useStore(
    useShallow((state) => ({
      playerPos: state.playerPos,
      playerYaw: state.playerYaw,
      entities: state.entities,
      health: state.health,
      maxHealth: state.maxHealth,
      armor: state.armor,
    }))
  );

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
                // Just the entity's own absolute heading -- #minimap-container's
                // own rotate(-playerYaw) (below) already reorients everything
                // inside it, this icon included, to keep "the way you're
                // facing" pointing up. Subtracting playerYaw again here on
                // top of that was double-counting it, so vehicle icons spun
                // twice as fast (and the wrong way) as you turned.
                transform: `translate(-50%, -50%) rotate(${entity.rotation * (180 / Math.PI)}deg)`
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
    // Bottom-left, GTA5-style (also frees up the bottom-right corner, which
    // ChatInput already occupies).
    <div style={{ position: 'absolute', bottom: 20, left: 20, width: mapSize, height: mapSize, pointerEvents: 'auto' }}>
      <div id="minimap-container" style={{ transform: `rotate(${-playerYaw}rad)` }}>
        <div id="minimap-north" style={{ transform: `translateX(-50%) rotate(${playerYaw}rad)` }}>N</div>
        {enemyDots}
        {vehicleIcons}
      </div>

      {/* GTA-style radar: the world rotates underneath (minimap-container's
          rotate(-playerYaw) above), so the player's own arrow always points
          straight up and never rotates itself -- it used to spin with
          playerYaw on top of that, which fought the map rotation instead of
          matching it. */}
      <div id="minimap-player" style={{ left: mapSize / 2, top: mapSize / 2, transform: 'translate(-50%, -50%)' }} />

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
