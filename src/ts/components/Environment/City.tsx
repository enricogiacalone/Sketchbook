import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useBox } from '@react-three/cannon';
import { getTerrainHeight } from './Terrain';
import { getRoadOffset } from './Road';
import { CollisionGroups } from '../../enums/CollisionGroups';

const footprintOverlapsRoad = (x: number, z: number, width: number, depth: number): boolean => {
  const halfW = width / 2;
  const halfD = depth / 2;
  const samplePoints: [number, number][] = [
    [x, z],
    [x - halfW, z - halfD], [x + halfW, z - halfD],
    [x - halfW, z + halfD], [x + halfW, z + halfD],
    [x, z - halfD], [x, z + halfD], [x - halfW, z], [x + halfW, z],
  ];
  return samplePoints.some(([px, pz]) => getRoadOffset(px, pz) > 0);
};

const Building: React.FC<{ x: number, z: number, width: number, depth: number, height: number, color: string, style: 'modern' | 'glass' | 'brick' }> = ({ x, z, width, depth, height, color, style }) => {
  const y = getTerrainHeight(x, z);
  const hasGreenRoof = height > 40 && Math.random() > 0.5;

  const [ref] = useBox<THREE.Mesh>(() => ({
    type: 'Static',
    args: [width, height, depth],
    position: [x, y + height / 2, z],
    collisionFilterGroup: CollisionGroups.Default,
    collisionFilterMask: -1,
  }));

  return (
    <group>
      {/* Main Structure */}
      <mesh ref={ref} castShadow receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        {/* "glass" buildings keep their blue tint and shininess but are no
            longer alpha-blended -- transparent materials force three.js to
            sort and render them back-to-front with depth-write off, which
            gets expensive fast with this many overlapping buildings. Opaque
            (with high metalness/low roughness) still reads as glass. */}
        <meshStandardMaterial 
            color={style === 'glass' ? '#88ccff' : style === 'brick' ? '#a52a2a' : color} 
            roughness={style === 'glass' ? 0.1 : 0.7} 
            metalness={style === 'glass' ? 0.9 : 0.2}
        />
      </mesh>
      
      {/* Windows / Emissive Detail */}
      <mesh position={[x, y + height / 2, z]} scale={[1.005, 0.95, 1.005]}>
         <boxGeometry args={[width, height, depth]} />
         <meshStandardMaterial 
            color="#111" 
            emissive={Math.random() > 0.5 ? "#554400" : "#111"} 
            emissiveIntensity={0.5}
            wireframe 
         />
      </mesh>

      {/* Green Roof */}
      {hasGreenRoof && (
        <group position={[x, y + height + 0.1, z]}>
            <mesh receiveShadow>
                <boxGeometry args={[width * 0.9, 0.2, depth * 0.9]} />
                <meshStandardMaterial color="#3a5a2a" />
            </mesh>
            {/* Small trees on roof */}
            <mesh position={[0, 1, 0]}>
                <cylinderGeometry args={[0, 1.5, 3, 4]} />
                <meshStandardMaterial color="#2d4a1e" />
            </mesh>
        </group>
      )}
    </group>
  );
};

const GreenCourtyard: React.FC<{ x: number, z: number }> = ({ x, z }) => {
    const y = getTerrainHeight(x, z);
    return (
        <group position={[x, y, z]}>
            <mesh receiveShadow rotation={[-Math.PI/2, 0, 0]}>
                <planeGeometry args={[20, 20]} />
                <meshStandardMaterial color="#2d4a1e" />
            </mesh>
            {/* Some bushes */}
            {[...Array(5)].map((_, i) => (
                <mesh key={i} position={[Math.sin(i) * 6, 0.5, Math.cos(i) * 6]}>
                    <sphereGeometry args={[1, 8, 8]} />
                    <meshStandardMaterial color="#1d3a0e" />
                </mesh>
            ))}
        </group>
    );
};

const City: React.FC = () => {
  const { buildings, courtyards, plazas } = useMemo(() => {
    const bArr = [];
    const cArr = [];
    const pArr = [];
    const gridSpacing = 60;
    const buildingColors = ['#222', '#333', '#444', '#111', '#555'];
    const styles: ('modern' | 'glass' | 'brick')[] = ['modern', 'glass', 'brick'];
    
    // Shrunk from a 7x7 block grid (+/-3) to 5x5 (+/-2) -- fewer blocks
    // means fewer buildings, fewer meshes, and fewer physics bodies, which
    // is where the real performance cost was (each building spins up its
    // own useBox compound body in the physics worker on top of its own
    // draw calls).
    const gridRadius = 2;
    for (let i = -gridRadius; i <= gridRadius; i++) {
      for (let j = -gridRadius; j <= gridRadius; j++) {
        const blockX = i * gridSpacing + gridSpacing / 2;
        const blockZ = j * gridSpacing + gridSpacing / 2;

        if (i === 0 && j === 0) continue;

        // Chance to be a Green Plaza instead of buildings
        if ((i === -2 && j === 1) || (i === 2 && j === -2)) {
            pArr.push({ x: blockX, z: blockZ });
            continue;
        }

        // Add Courtyard in the center
        cArr.push({ x: blockX, z: blockZ });

        // Add buildings around the edges -- fewer per block (2-3 instead
        // of 3-5) for the same performance reason as the smaller grid above.
        const count = 2 + Math.floor(Math.random() * 2);
        for (let k = 0; k < count; k++) {
            const w = 10 + Math.random() * 12;
            const d = 10 + Math.random() * 12;
            const h = 20 + Math.random() * 90;
            const color = buildingColors[Math.floor(Math.random() * buildingColors.length)];
            const style = styles[Math.floor(Math.random() * styles.length)];

            for (let attempt = 0; attempt < 12; attempt++) {
                // Favor edges by using a distribution that pushes to +/- 20
                const angle = Math.random() * Math.PI * 2;
                const dist = 18 + Math.random() * 7;
                const x = blockX + Math.cos(angle) * dist;
                const z = blockZ + Math.sin(angle) * dist;
                
                if (!footprintOverlapsRoad(x, z, w, d)) {
                    bArr.push({ x, z, w, d, h, color, style });
                    break;
                }
            }
        }
      }
    }
    return { buildings: bArr, courtyards: cArr, plazas: pArr };
  }, []);

  return (
    <group>
      {courtyards.map((c, i) => (
        <GreenCourtyard key={`court-${i}`} x={c.x} z={c.z} />
      ))}
      {plazas.map((p, i) => (
        <group key={`plaza-${i}`} position={[p.x, getTerrainHeight(p.x, p.z), p.z]}>
            <mesh receiveShadow rotation={[-Math.PI/2, 0, 0]}>
                <planeGeometry args={[45, 45]} />
                <meshStandardMaterial color="#3a5a2a" />
            </mesh>
            {/* Plaza details */}
            <mesh position={[0, 1, 0]}>
                <boxGeometry args={[4, 2, 4]} />
                <meshStandardMaterial color="#555" />
            </mesh>
            {[...Array(8)].map((_, i) => (
                <mesh key={i} position={[Math.sin(i * Math.PI/4) * 15, 2, Math.cos(i * Math.PI/4) * 15]}>
                    <sphereGeometry args={[2, 12, 12]} />
                    <meshStandardMaterial color="#2d4a1e" />
                </mesh>
            ))}
        </group>
      ))}
      {buildings.map((b, i) => (
        <Building key={i} x={b.x} z={b.z} width={b.w} depth={b.d} height={b.h} color={b.color} style={b.style} />
      ))}
    </group>
  );
};

export default City;

