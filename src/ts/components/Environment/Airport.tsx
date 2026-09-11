import React, { useRef } from "react";
import * as THREE from "three";
import { getTerrainHeight } from "./Terrain";

// Placed well south of the city grid (which spans roughly x/z in
// [-120, 180], see City.tsx's gridRadius=2 blocks) and well clear of the
// road grid (whose outermost lines sit at +/-180, see Road.tsx's
// ROAD_OFFSETS), but still safely inside the flat terrain's own bounds
// (+/-300, see Terrain.tsx) -- open ground with nothing else built on it.
// Exported so Scene.tsx can spawn the Airplane/Helicopter directly on top
// of their own pad instead of at their old, somewhat arbitrary in-city
// coordinates.
export const RUNWAY_CENTER: [number, number] = [0, -260];
export const RUNWAY_LENGTH = 200;
export const RUNWAY_WIDTH = 18;
export const HELIPORT_CENTER: [number, number] = [140, -260];
export const HELIPORT_RADIUS = 14;

const _dashDummy = new THREE.Object3D();

// -- Airplane landing strip --------------------------------------------------
// Purely a visual overlay flush with the (flat, maxHeight=0) terrain, same
// convention as City.tsx's plaza/courtyard floors -- no separate collider
// needed, the terrain's own heightfield collider already sits right under
// it. Same asphalt/marking colors as Road.tsx ("#222"/"#fff") for visual
// consistency with the rest of the world.
const Runway: React.FC = () => {
  const [cx, cz] = RUNWAY_CENTER;
  const y = getTerrainHeight(cx, cz);
  const dashCount = 16;
  const dashRef = useRef<THREE.InstancedMesh>(null);

  return (
    <group position={[cx, y, cz]}>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[RUNWAY_LENGTH, RUNWAY_WIDTH]} />
        <meshStandardMaterial color="#222" roughness={0.85} />
      </mesh>

      {/* Threshold stripes at both ends. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (RUNWAY_LENGTH / 2 - 6), 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[2, RUNWAY_WIDTH * 0.8]} />
          <meshStandardMaterial color="#fff" />
        </mesh>
      ))}

      {/* Dashed centerline -- same instanced-dash technique as Road.tsx's
          own lane markings. */}
      <instancedMesh
        ref={dashRef}
        args={[null as any, null as any, dashCount]}
        onUpdate={(self) => {
          const step = RUNWAY_LENGTH / dashCount;
          for (let i = 0; i < dashCount; i++) {
            const x = -RUNWAY_LENGTH / 2 + i * step + step / 2;
            _dashDummy.position.set(x, 0.01, 0);
            _dashDummy.rotation.set(-Math.PI / 2, 0, 0);
            _dashDummy.scale.set(step * 0.5, 1.2, 1);
            _dashDummy.updateMatrix();
            self.setMatrixAt(i, _dashDummy.matrix);
          }
          self.instanceMatrix.needsUpdate = true;
        }}
      >
        <planeGeometry args={[1, 1]} />
        <meshStandardMaterial color="#fff" />
      </instancedMesh>

      {/* Edge lights, same warm emissive-sphere look as the street lamps
          in CityDetails.tsx. */}
      {[-1, 1].map((zSide) =>
        [-1, -0.5, 0, 0.5, 1].map((t) => (
          <mesh key={`${zSide}-${t}`} position={[t * (RUNWAY_LENGTH / 2 - 4), 0.15, zSide * (RUNWAY_WIDTH / 2 + 0.5)]}>
            <sphereGeometry args={[0.15, 6, 6]} />
            <meshStandardMaterial color="#fff" emissive="#ffffaa" emissiveIntensity={2} />
          </mesh>
        ))
      )}
    </group>
  );
};

// -- Helicopter pad -----------------------------------------------------
const Heliport: React.FC = () => {
  const [cx, cz] = HELIPORT_CENTER;
  const y = getTerrainHeight(cx, cz);

  return (
    <group position={[cx, y, cz]}>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[HELIPORT_RADIUS, 32]} />
        <meshStandardMaterial color="#222" roughness={0.85} />
      </mesh>

      {/* Outer ring marking. */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[HELIPORT_RADIUS - 1, HELIPORT_RADIUS - 0.6, 32]} />
        <meshStandardMaterial color="#fff" side={THREE.DoubleSide} />
      </mesh>

      {/* "H" marking, built from three flat planes (two verticals + a
          crossbar) -- the parent group's own -90deg X rotation is what
          lays all three flat, same trick as Road.tsx's dash instances. */}
      <group position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <mesh position={[-2, 0, 0]}>
          <planeGeometry args={[1.2, 6]} />
          <meshStandardMaterial color="#fff" />
        </mesh>
        <mesh position={[2, 0, 0]}>
          <planeGeometry args={[1.2, 6]} />
          <meshStandardMaterial color="#fff" />
        </mesh>
        <mesh>
          <planeGeometry args={[5.2, 1.2]} />
          <meshStandardMaterial color="#fff" />
        </mesh>
      </group>

      {/* Perimeter lights. */}
      {[...Array(8)].map((_, i) => {
        const angle = (i / 8) * Math.PI * 2;
        return (
          <mesh
            key={i}
            position={[Math.cos(angle) * (HELIPORT_RADIUS - 0.5), 0.15, Math.sin(angle) * (HELIPORT_RADIUS - 0.5)]}
          >
            <sphereGeometry args={[0.15, 6, 6]} />
            <meshStandardMaterial color="#fff" emissive="#ffaa00" emissiveIntensity={2} />
          </mesh>
        );
      })}
    </group>
  );
};

const Airport: React.FC = () => (
  <group>
    <Runway />
    <Heliport />
  </group>
);

export default Airport;
export { Runway, Heliport };
