import React, { useMemo } from 'react';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { ROAD_OFFSETS, ROAD_WIDTH } from '../Environment/Road';
import { CITY_LAYOUT, CITY_BLOCK_SIZE } from '../Environment/City';

// "sistema la minimappa come in gta 5, mi raccomando il funzionamento e i
// riferimenti al player nemici e veicoli" -- the radar itself (circular,
// rotates so the player always points up, GTA-style health/armor arcs
// around the rim) was already right; what it was actually missing was any
// spatial reference at all -- it rendered as a plain black circle with
// dots floating on it, so "near" vs "far" and "which street" had no
// visual anchor. This adds the same block/road layout the city was
// actually generated from (CITY_LAYOUT / ROAD_OFFSETS, single source of
// truth, not redrawn from scratch here) as a rotating backdrop, and
// tightens up the player/enemy/vehicle blips to read clearly against it.
const mapSize = 200;
const worldSize = 140; // Visible world diameter, in world units

const worldToMap = (x: number, z: number, playerPos: [number, number, number]) => ({
  mapX: ((x - playerPos[0]) / worldSize) * mapSize + mapSize / 2,
  mapY: ((z - playerPos[2]) / worldSize) * mapSize + mapSize / 2,
});

// Rotation-invariant visibility test -- distance from the CONTAINER's own
// center is unchanged by the container's own CSS rotate() (it's a rigid
// transform around that same center), so this is correct at any playerYaw,
// unlike a naive axis-aligned box check against the current (unrotated)
// mapX/mapY.
const isNearCircle = (mapX: number, mapY: number, margin: number) =>
  Math.hypot(mapX - mapSize / 2, mapY - mapSize / 2) < mapSize / 2 + margin;

const PARK_CENTER = { x: CITY_BLOCK_SIZE / 2, z: CITY_BLOCK_SIZE / 2 };
const BLOCK_PX = (CITY_BLOCK_SIZE / worldSize) * mapSize;
const ROAD_PX = (ROAD_WIDTH / worldSize) * mapSize;
const ROAD_LINE_LENGTH = mapSize * 1.6; // overshoots the circle at any rotation

const Minimap: React.FC = () => {
  const { playerPos, playerYaw, entities, health, maxHealth, armor, missionTargetPos } = useStore(
    useShallow((state) => ({
      playerPos: state.playerPos,
      playerYaw: state.playerYaw,
      entities: state.entities,
      health: state.health,
      maxHealth: state.maxHealth,
      armor: state.armor,
      missionTargetPos: state.missionTargetPos,
    }))
  );

  // District blocks -- park (green), plazas (paved tan) and ordinary
  // courtyard/building blocks (slate), each the same CITY_BLOCK_SIZE
  // square City.tsx actually placed them as. Purely a backdrop -- no
  // interaction, so plain divs with no per-instance state.
  const districtBlocks = useMemo(() => {
    type Block = { key: string; x: number; z: number; className: string };
    const blocks: Block[] = [{ key: 'park', x: PARK_CENTER.x, z: PARK_CENTER.z, className: 'minimap-block-park' }];
    CITY_LAYOUT.plazas.forEach((p, i) => blocks.push({ key: `plaza-${i}`, x: p.x, z: p.z, className: 'minimap-block-plaza' }));
    CITY_LAYOUT.courtyards.forEach((c, i) => blocks.push({ key: `courtyard-${i}`, x: c.x, z: c.z, className: 'minimap-block-city' }));

    return blocks
      .map(({ key, x, z, className }) => {
        const { mapX, mapY } = worldToMap(x, z, playerPos);
        return { key, mapX, mapY, className };
      })
      .filter(({ mapX, mapY }) => isNearCircle(mapX, mapY, BLOCK_PX))
      .map(({ key, mapX, mapY, className }) => (
        <div
          key={key}
          className={`minimap-block ${className}`}
          style={{ left: mapX, top: mapY, width: BLOCK_PX, height: BLOCK_PX }}
        />
      ));
  }, [playerPos]);

  // Road grid -- each offset is a full road running the whole map (600
  // units, effectively "infinite" against this radar's ~140-unit view), so
  // only the offset ALONG the line's own perpendicular axis matters; the
  // line itself is drawn long enough to always cross the whole circle
  // regardless of the current rotation.
  const roadLines = useMemo(() => {
    const horizontals = ROAD_OFFSETS.map((oz) => worldToMap(playerPos[0], oz, playerPos).mapY)
      .filter((mapY) => mapY > -ROAD_PX && mapY < mapSize + ROAD_PX)
      .map((mapY, i) => (
        <div
          key={`h-${i}`}
          className="minimap-road minimap-road-h"
          style={{ top: mapY, width: ROAD_LINE_LENGTH, height: ROAD_PX }}
        />
      ));
    const verticals = ROAD_OFFSETS.map((ox) => worldToMap(ox, playerPos[2], playerPos).mapX)
      .filter((mapX) => mapX > -ROAD_PX && mapX < mapSize + ROAD_PX)
      .map((mapX, i) => (
        <div
          key={`v-${i}`}
          className="minimap-road minimap-road-v"
          style={{ left: mapX, width: ROAD_PX, height: ROAD_LINE_LENGTH }}
        />
      ));
    return [...horizontals, ...verticals];
  }, [playerPos]);

  const enemyDots = useMemo(() => {
    const dots: React.ReactNode[] = [];
    entities.forEach((entity, id) => {
      if (entity.type === 'enemy') {
        const { mapX, mapY } = worldToMap(entity.position[0], entity.position[2], playerPos);
        if (isNearCircle(mapX, mapY, 8)) {
          dots.push(<div key={id} className="minimap-enemy" style={{ left: mapX, top: mapY }} />);
        }
      }
    });
    return dots;
  }, [entities, playerPos]);

  const vehicleIcons = useMemo(() => {
    const icons: React.ReactNode[] = [];
    entities.forEach((entity, id) => {
      if (entity.type === 'car' || entity.type === 'airplane' || entity.type === 'helicopter') {
        const { mapX, mapY } = worldToMap(entity.position[0], entity.position[2], playerPos);
        if (isNearCircle(mapX, mapY, 12)) {
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
                transform: `translate(-50%, -50%) rotate(${entity.rotation * (180 / Math.PI)}deg)`,
              }}
            />
          );
        }
      }
    });
    return icons;
  }, [entities, playerPos]);

  // Mission-target blip -- yellow diamond, wherever the active mission
  // stage's targetPos currently points (drive destination or elimination
  // target); null when no stage is active, so nothing renders then.
  const missionTargetBlip = useMemo(() => {
    if (!missionTargetPos) return null;
    const { mapX, mapY } = worldToMap(missionTargetPos[0], missionTargetPos[1], playerPos);
    if (!isNearCircle(mapX, mapY, 10)) return null;
    return <div className="minimap-mission-target" style={{ left: mapX, top: mapY }} />;
  }, [missionTargetPos, playerPos]);

  // Health and Armor Bar rotations
  const healthRotation = 45 + 180 * (health / (maxHealth || 100));
  const armorRotation = 225 + 180 * (armor / 100);

  return (
    // Bottom-left, GTA5-style (also frees up the bottom-right corner, which
    // ChatInput already occupies).
    <div style={{ position: 'absolute', bottom: 20, left: 20, width: mapSize, height: mapSize, pointerEvents: 'auto' }}>
      <div id="minimap-container" style={{ transform: `rotate(${-playerYaw}rad)` }}>
        {districtBlocks}
        {roadLines}
        <div id="minimap-north" style={{ transform: `translateX(-50%) rotate(${playerYaw}rad)` }}>N</div>
        {enemyDots}
        {vehicleIcons}
        {missionTargetBlip}
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
