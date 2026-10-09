import React, { useMemo } from 'react';
import { CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { getTerrainHeight } from './Terrain';
import {
  BAR,
  BAR_FRONT_Z,
  BAR_TABLES,
  KIOSK,
  MARKET,
  MARKET_BENCHES,
  MARKET_STALLS,
  YARD,
  YARD_BOXES,
  YARD_GATE_HALF,
  YARD_HALF,
  YARD_SHED,
  YARD_VAN,
} from '../../missions/storyPlaces';

// "modifica un po' la citta'": i luoghi della missione (missions/storyPlaces.ts)
// -- il Bar Da Vito sul bordo del parco, la Piazza del Mercato al posto di
// una delle due piazze verdi e il Deposito dei Serpenti al posto dell'altra.
// Tutto con collider fissi (ci si ripara dietro le casse, la telecamera ci
// sbatte contro) e forme semplici nello stile del resto della citta'.

// scritta su una tavola (insegne)
function useTextTexture(text: string, bg: string, fg: string, w = 512, h = 128) {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    g.font = `bold ${Math.floor(h * 0.55)}px Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 4);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [text, bg, fg, w, h]);
}

const Box: React.FC<{
  p: [number, number, number];
  s: [number, number, number];
  color: string;
  rot?: number;
  solid?: boolean;
  emissive?: string;
}> = ({ p, s, color, rot = 0, solid, emissive }) => {
  const mesh = (
    <mesh castShadow receiveShadow>
      <boxGeometry args={s} />
      <meshStandardMaterial color={color} emissive={emissive ?? '#000'} emissiveIntensity={emissive ? 0.6 : 0} />
    </mesh>
  );
  if (!solid)
    return (
      <group position={p} rotation={[0, rot, 0]}>
        {mesh}
      </group>
    );
  return (
    <RigidBody type="fixed" colliders={false} position={p} rotation={[0, rot, 0]}>
      <CuboidCollider args={[s[0] / 2, s[1] / 2, s[2] / 2]} />
      {mesh}
    </RigidBody>
  );
};

// tavolino rotondo con due sedie (una per lato lungo x) e ombrellone
const CafeTable: React.FC<{ x: number; z: number; umbrella?: string }> = ({ x, z, umbrella }) => {
  const y = getTerrainHeight(x, z);
  return (
    <group position={[x, y, z]}>
      <RigidBody type="fixed" colliders={false} position={[0, 0.38, 0]}>
        <CylinderCollider args={[0.38, 0.45]} />
        <mesh castShadow position={[0, 0.36, 0]}>
          <cylinderGeometry args={[0.45, 0.45, 0.04, 20]} />
          <meshStandardMaterial color="#f5f5f5" />
        </mesh>
        <mesh>
          <cylinderGeometry args={[0.04, 0.04, 0.72, 8]} />
          <meshStandardMaterial color="#333" />
        </mesh>
      </RigidBody>
      {[-1, 1].map((sx) => (
        <group key={sx} position={[sx * 0.78, 0, 0]} rotation={[0, sx > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}>
          <mesh castShadow position={[0, 0.45, 0]}>
            <boxGeometry args={[0.44, 0.05, 0.44]} />
            <meshStandardMaterial color="#6d4c41" />
          </mesh>
          <mesh castShadow position={[0, 0.72, -0.2]}>
            <boxGeometry args={[0.44, 0.5, 0.04]} />
            <meshStandardMaterial color="#6d4c41" />
          </mesh>
          {[-0.18, 0.18].map((lx) =>
            [-0.18, 0.18].map((lz) => (
              <mesh key={`${lx}${lz}`} position={[lx, 0.22, lz]}>
                <boxGeometry args={[0.04, 0.44, 0.04]} />
                <meshStandardMaterial color="#333" />
              </mesh>
            ))
          )}
        </group>
      ))}
      {umbrella && (
        <group>
          <mesh position={[0, 1.3, 0]}>
            <cylinderGeometry args={[0.025, 0.025, 1.9, 6]} />
            <meshStandardMaterial color="#ddd" />
          </mesh>
          <mesh castShadow position={[0, 2.25, 0]}>
            <coneGeometry args={[1.3, 0.45, 8, 1, true]} />
            <meshStandardMaterial color={umbrella} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}
    </group>
  );
};

export const BarDaVito: React.FC = () => {
  const sign = useTextTexture('BAR DA VITO', '#1b1b1b', '#ffd54a');
  const y = getTerrainHeight(BAR.x, BAR.z);
  const fy = getTerrainHeight(BAR.x, BAR_FRONT_Z - 1.5);
  const slats = 10;
  return (
    <group>
      {/* corpo del bar */}
      <Box p={[BAR.x, y + BAR.h / 2, BAR.z]} s={[BAR.w, BAR.h, BAR.d]} color="#efe3cf" solid />
      <Box p={[BAR.x, y + BAR.h + 0.15, BAR.z]} s={[BAR.w + 0.4, 0.3, BAR.d + 0.4]} color="#4e342e" />
      {/* vetrine e porta */}
      <Box p={[BAR.x - 2.7, y + 1.5, BAR_FRONT_Z - 0.02]} s={[3.2, 1.8, 0.05]} color="#1a2733" emissive="#ffb74d" />
      <Box p={[BAR.x + 2.7, y + 1.5, BAR_FRONT_Z - 0.02]} s={[3.2, 1.8, 0.05]} color="#1a2733" emissive="#ffb74d" />
      <Box p={[BAR.x, y + 1.1, BAR_FRONT_Z - 0.02]} s={[1.3, 2.2, 0.06]} color="#3e2723" />
      {/* tenda a strisce */}
      {Array.from({ length: slats }, (_, i) => (
        <mesh
          key={i}
          castShadow
          position={[BAR.x - BAR.w / 2 + (BAR.w / slats) * (i + 0.5), y + 2.75, BAR_FRONT_Z - 0.7]}
          rotation={[0.45, 0, 0]}
        >
          <boxGeometry args={[BAR.w / slats, 0.04, 1.5]} />
          <meshStandardMaterial color={i % 2 ? '#f5f5f5' : '#c62828'} />
        </mesh>
      ))}
      {/* insegna */}
      <mesh position={[BAR.x, y + 3.5, BAR_FRONT_Z - 0.05]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[4.4, 1.1]} />
        <meshStandardMaterial map={sign} emissive="#ffd54a" emissiveMap={sign} emissiveIntensity={0.5} />
      </mesh>
      {/* pedana del dehors */}
      <mesh receiveShadow position={[BAR.x, fy + 0.02, (BAR_FRONT_Z + 5.6) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[BAR.w + 1, BAR_FRONT_Z - 5.6]} />
        <meshStandardMaterial color="#9e8c78" />
      </mesh>
      {BAR_TABLES.map(([x, z], i) => (
        <CafeTable key={i} x={x} z={z} umbrella={i === 1 ? '#c62828' : undefined} />
      ))}
      {/* fioriere ai lati */}
      <Box p={[BAR.x - BAR.w / 2 - 0.3, fy + 0.35, 7]} s={[0.5, 0.7, 2.6]} color="#5d4037" solid />
      <Box p={[BAR.x + BAR.w / 2 + 0.3, fy + 0.35, 7]} s={[0.5, 0.7, 2.6]} color="#5d4037" solid />
    </group>
  );
};

// bancarella: banco, tettoia colorata, cassette di frutta
const Stall: React.FC<{ x: number; z: number; yaw: number; color: string; goods: string }> = ({ x, z, yaw, color, goods }) => {
  const y = getTerrainHeight(x, z);
  return (
    <group position={[x, y, z]} rotation={[0, yaw, 0]}>
      <RigidBody type="fixed" colliders={false} position={[0, 0.5, 0]}>
        <CuboidCollider args={[1.4, 0.5, 0.5]} />
        <mesh castShadow receiveShadow>
          <boxGeometry args={[2.8, 1, 1]} />
          <meshStandardMaterial color="#8d6e63" />
        </mesh>
      </RigidBody>
      {[-0.9, 0, 0.9].map((dx, i) => (
        <mesh key={i} castShadow position={[dx, 1.1, 0.1]}>
          <boxGeometry args={[0.75, 0.2, 0.6]} />
          <meshStandardMaterial color={i === 1 ? '#fdd835' : goods} />
        </mesh>
      ))}
      {[-1.3, 1.3].map((dx) => (
        <mesh key={dx} position={[dx, 1.2, -0.45]}>
          <boxGeometry args={[0.08, 2.4, 0.08]} />
          <meshStandardMaterial color="#555" />
        </mesh>
      ))}
      <mesh castShadow position={[0, 2.45, 0]} rotation={[-0.25, 0, 0]}>
        <boxGeometry args={[3.1, 0.06, 1.8]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  );
};

export const MarketPlaza: React.FC = () => {
  const y = getTerrainHeight(MARKET.x, MARKET.z);
  const kioskSign = useTextTexture('EDICOLA', '#0d47a1', '#ffffff', 256, 64);
  const ky = getTerrainHeight(KIOSK.x, KIOSK.z);
  return (
    <group>
      {/* lastricato */}
      <mesh receiveShadow position={[MARKET.x, y + 0.02, MARKET.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[45, 45]} />
        <meshStandardMaterial color="#b9ad9b" roughness={1} />
      </mesh>
      {/* statua al centro */}
      <Box p={[MARKET.x, y + 0.6, MARKET.z]} s={[3, 1.2, 3]} color="#8d8d8d" solid />
      <mesh castShadow position={[MARKET.x, y + 2.2, MARKET.z]}>
        <cylinderGeometry args={[0.35, 0.5, 2, 10]} />
        <meshStandardMaterial color="#b0a690" />
      </mesh>
      {MARKET_STALLS.map((s, i) => (
        <Stall key={i} {...s} />
      ))}
      {/* edicola di Lucky */}
      <group position={[KIOSK.x, ky, KIOSK.z]}>
        <RigidBody type="fixed" colliders={false} position={[0, 1.2, 0]}>
          <CuboidCollider args={[1.3, 1.2, 1]} />
          <mesh castShadow receiveShadow>
            <boxGeometry args={[2.6, 2.4, 2]} />
            <meshStandardMaterial color="#2e7d32" />
          </mesh>
        </RigidBody>
        <mesh position={[0, 1.1, -1.01]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[2.2, 1.2]} />
          <meshStandardMaterial color="#fafafa" emissive="#90caf9" emissiveIntensity={0.15} />
        </mesh>
        <mesh position={[0, 2.6, -1.02]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[2.4, 0.6]} />
          <meshStandardMaterial map={kioskSign} />
        </mesh>
        <mesh castShadow position={[0, 2.5, 0]}>
          <boxGeometry args={[3, 0.12, 2.6]} />
          <meshStandardMaterial color="#1b5e20" />
        </mesh>
      </group>
      {MARKET_BENCHES.map((b, i) => {
        const by = getTerrainHeight(b.x, b.z);
        return (
          <group key={i} position={[b.x, by, b.z]} rotation={[0, b.yaw, 0]}>
            <RigidBody type="fixed" colliders={false} position={[0, 0.25, 0]}>
              <CuboidCollider args={[1.1, 0.25, 0.3]} />
              <mesh castShadow position={[0, 0.2, 0]}>
                <boxGeometry args={[2.2, 0.08, 0.6]} />
                <meshStandardMaterial color="#5d4037" />
              </mesh>
            </RigidBody>
            <mesh castShadow position={[0, 0.65, -0.28]}>
              <boxGeometry args={[2.2, 0.5, 0.06]} />
              <meshStandardMaterial color="#5d4037" />
            </mesh>
          </group>
        );
      })}
    </group>
  );
};

export const WarehouseYard: React.FC = () => {
  const y = getTerrainHeight(YARD.x, YARD.z);
  const shedSign = useTextTexture('SERPENTI', '#111', '#76ff03', 256, 64);
  const H = YARD_HALF;
  // recinto: lati +x, +z, -z interi; lato -x con il varco al centro
  const fences: Array<{ x: number; z: number; len: number; alongX: boolean }> = [
    { x: YARD.x + H, z: YARD.z, len: 2 * H, alongX: false },
    { x: YARD.x, z: YARD.z + H, len: 2 * H, alongX: true },
    { x: YARD.x, z: YARD.z - H, len: 2 * H, alongX: true },
    { x: YARD.x - H, z: YARD.z - (H + YARD_GATE_HALF) / 2, len: H - YARD_GATE_HALF, alongX: false },
    { x: YARD.x - H, z: YARD.z + (H + YARD_GATE_HALF) / 2, len: H - YARD_GATE_HALF, alongX: false },
  ];
  const sy = getTerrainHeight(YARD_SHED.x, YARD_SHED.z);
  const vy = getTerrainHeight(YARD_VAN.x, YARD_VAN.z);
  return (
    <group>
      <mesh receiveShadow position={[YARD.x, y + 0.02, YARD.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[45, 45]} />
        <meshStandardMaterial color="#3b3b3b" roughness={1} />
      </mesh>
      {fences.map((f, i) => (
        <RigidBody key={i} type="fixed" colliders={false} position={[f.x, getTerrainHeight(f.x, f.z) + 1.1, f.z]}>
          <CuboidCollider args={f.alongX ? [f.len / 2, 1.1, 0.05] : [0.05, 1.1, f.len / 2]} />
          <mesh>
            <boxGeometry args={f.alongX ? [f.len, 2.2, 0.04] : [0.04, 2.2, f.len]} />
            <meshStandardMaterial color="#9e9e9e" transparent opacity={0.35} metalness={0.6} />
          </mesh>
          <mesh position={[0, 1.12, 0]}>
            <boxGeometry args={f.alongX ? [f.len, 0.06, 0.06] : [0.06, 0.06, f.len]} />
            <meshStandardMaterial color="#616161" />
          </mesh>
        </RigidBody>
      ))}
      {YARD_BOXES.map((b, i) => (
        <Box key={i} p={[b.x, getTerrainHeight(b.x, b.z) + b.h / 2, b.z]} s={[b.w, b.h, b.d]} color={b.color} rot={b.yaw} solid />
      ))}
      {/* baracca */}
      <Box p={[YARD_SHED.x, sy + YARD_SHED.h / 2, YARD_SHED.z]} s={[YARD_SHED.w, YARD_SHED.h, YARD_SHED.d]} color="#5d4037" solid />
      <mesh position={[YARD_SHED.x, sy + 2.5, YARD_SHED.z - YARD_SHED.d / 2 - 0.02]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[2.6, 0.65]} />
        <meshStandardMaterial map={shedSign} emissive="#76ff03" emissiveMap={shedSign} emissiveIntensity={0.6} />
      </mesh>
      {/* furgone */}
      <group position={[YARD_VAN.x, vy, YARD_VAN.z]} rotation={[0, YARD_VAN.yaw, 0]}>
        <Box p={[0, 1.3, 0]} s={[5, 2.2, 2.2]} color="#eceff1" solid />
        <Box p={[2.1, 1.25, 0]} s={[0.05, 0.8, 1.9]} color="#263238" />
        {[-1.6, 1.6].map((wx) =>
          [-1.1, 1.1].map((wz) => (
            <mesh key={`${wx}${wz}`} position={[wx, 0.4, wz]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.4, 0.4, 0.3, 12]} />
              <meshStandardMaterial color="#111" />
            </mesh>
          ))
        )}
      </group>
      {/* bidoni */}
      {[
        [YARD.x + 16, YARD.z + 15],
        [YARD.x + 16.8, YARD.z + 14.2],
        [YARD.x - 16, YARD.z - 15],
      ].map(([bx, bz], i) => (
        <RigidBody key={i} type="fixed" colliders={false} position={[bx, getTerrainHeight(bx, bz) + 0.5, bz]}>
          <CylinderCollider args={[0.5, 0.35]} />
          <mesh castShadow>
            <cylinderGeometry args={[0.35, 0.35, 1, 12]} />
            <meshStandardMaterial color={i === 1 ? '#1565c0' : '#b71c1c'} />
          </mesh>
        </RigidBody>
      ))}
    </group>
  );
};
