import React, { useMemo } from 'react';
import * as THREE from 'three';
import { RigidBody, CuboidCollider } from '@react-three/rapier';
import { getTerrainHeight } from './Terrain';
import { getRoadOffset } from './Road';
import { CollisionGroups, groupsExcluding } from '../../enums/CollisionGroups';
import { useTreeTemplates, TreeInstance, TreeTemplate, GrassPatch, Flowers } from './ParkTrees';

const _windowDummy = new THREE.Object3D();
const _windowColor = new THREE.Color();

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

  // All the randomized "detail" decisions for this building are picked
  // ONCE per mount instead of directly in the render body (the roof-detail
  // flags used to call Math.random() straight in render, which would
  // silently reshuffle on every re-render -- fine for a flag no one
  // noticed, not fine now that windowInstances below computes a whole
  // array of transforms per re-render otherwise). "aggiungi dettagli,
  // rendilo più reale":
  //  - real punched windows (instanced, lit/unlit) on modern/brick towers
  //  - glass towers stay clean/reflective with only a subtle mullion grid
  //  - a darker ground-floor plinth band (retail/lobby facade)
  //  - an entrance canopy on wider, non-glass buildings
  //  - an occasional smaller side annex so not every building is one pure box
  const details = useMemo(() => {
    const hasGreenRoof = height > 40 && Math.random() > 0.5;
    const hasSetbackTier = !hasGreenRoof && height > 70 && Math.random() > 0.4;
    const hasRoofUnits = !hasGreenRoof && !hasSetbackTier && height > 25 && Math.random() > 0.55;
    const hasCanopy = style !== 'glass' && width >= 14 && Math.random() > 0.4;
    const hasAnnex = width >= 14 && depth >= 14 && height > 25 && Math.random() > 0.7;

    let annex: { w: number; d: number; h: number; ox: number; oz: number } | null = null;
    if (hasAnnex) {
      const annexW = width * (0.35 + Math.random() * 0.15);
      const annexD = depth * (0.35 + Math.random() * 0.15);
      const annexH = height * (0.3 + Math.random() * 0.3);
      // Tuck it against one corner so it reads as an attached wing rather
      // than a floating box.
      const corner = Math.floor(Math.random() * 4);
      const sx = corner % 2 === 0 ? 1 : -1;
      const sz = corner < 2 ? 1 : -1;
      annex = {
        w: annexW,
        d: annexD,
        h: annexH,
        ox: sx * (width / 2 + annexW / 2 - 0.5),
        oz: sz * (depth / 2 + annexD / 2 - 0.5),
      };
    }

    // Real per-floor windows, punched into the two long faces (+/-Z) and
    // two short faces (+/-X). Skipped for 'glass' towers -- a full glass
    // curtain wall doesn't have individual punched windows, it gets a
    // subtle mullion overlay instead (see the emissive wireframe below).
    const windowInstances: Array<{ x: number; y: number; z: number; rotationY: number; lit: boolean }> = [];
    if (style !== 'glass') {
      const floorHeight = 4.2;
      const spacing = 3.4;
      // Skip the ground floor (plinth/entrance sits there instead) and
      // cap floor/column counts so the tallest towers don't blow up the
      // instance count.
      const numFloors = Math.min(22, Math.max(0, Math.floor(height / floorHeight) - 1));
      const countW = Math.min(6, Math.max(1, Math.floor(width / spacing) - 1));
      const countD = Math.min(6, Math.max(1, Math.floor(depth / spacing) - 1));
      for (let f = 0; f < numFloors; f++) {
        const wy = floorHeight * 1.5 + floorHeight * f;
        for (let c = 0; c < countW; c++) {
          const wx = (c - (countW - 1) / 2) * spacing;
          windowInstances.push({ x: wx, y: wy, z: depth / 2 + 0.04, rotationY: 0, lit: Math.random() > 0.65 });
          windowInstances.push({ x: wx, y: wy, z: -depth / 2 - 0.04, rotationY: Math.PI, lit: Math.random() > 0.65 });
        }
        for (let r = 0; r < countD; r++) {
          const wz = (r - (countD - 1) / 2) * spacing;
          windowInstances.push({ x: width / 2 + 0.04, y: wy, z: wz, rotationY: Math.PI / 2, lit: Math.random() > 0.65 });
          windowInstances.push({ x: -width / 2 - 0.04, y: wy, z: wz, rotationY: -Math.PI / 2, lit: Math.random() > 0.65 });
        }
      }
    }

    return { hasGreenRoof, hasSetbackTier, hasRoofUnits, hasCanopy, annex, windowInstances };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { hasGreenRoof, hasSetbackTier, hasRoofUnits, hasCanopy, annex, windowInstances } = details;

  return (
    <group>
      {/* Main Structure -- migrated from cannon's useBox({type:'Static',
          args:[width,height,depth] (full dims)}) to a fixed RigidBody with
          an explicit CuboidCollider (Rapier args are half-extents). No ref
          needed: nothing ever reads a building's transform back out. */}
      <RigidBody
        type="fixed"
        colliders={false}
        position={[x, y + height / 2, z]}
        collisionGroups={groupsExcluding(CollisionGroups.Default)}
      >
        <CuboidCollider args={[width / 2, height / 2, depth / 2]} />
        <mesh castShadow receiveShadow>
          <boxGeometry args={[width, height, depth]} />
          {/* Color now comes pre-picked from a style-matched palette (see
              the buildingColors object in City's generation loop) instead
              of always overriding to the same flat gray/blue/brick-red --
              "aspetto/densità della città" was partly just every building
              looking identical. Roughness/metalness per style unchanged. */}
          <meshStandardMaterial 
              color={color} 
              roughness={style === 'glass' ? 0.1 : style === 'brick' ? 0.85 : 0.6} 
              metalness={style === 'glass' ? 0.9 : style === 'brick' ? 0.05 : 0.25}
          />
        </mesh>
      </RigidBody>

      {/* Real punched windows (modern/brick) -- one instanced mesh per
          building, lit (warm) vs unlit (dark) per-instance color, replaces
          the old flat random-wireframe-box fake. Positions are absolute
          world coords (x/z/y-from-ground) like every other sibling here,
          since this <group> carries no transform of its own. */}
      {windowInstances.length > 0 && (
        <instancedMesh
          args={[null as any, null as any, windowInstances.length]}
          onUpdate={(self) => {
            for (let i = 0; i < windowInstances.length; i++) {
              const w = windowInstances[i];
              _windowDummy.position.set(x + w.x, y + w.y, z + w.z);
              _windowDummy.rotation.set(0, w.rotationY, 0);
              _windowDummy.updateMatrix();
              self.setMatrixAt(i, _windowDummy.matrix);
              _windowColor.set(w.lit ? (Math.random() > 0.5 ? '#ffdb8c' : '#ffb37a') : '#131b24');
              self.setColorAt(i, _windowColor);
            }
            self.instanceMatrix.needsUpdate = true;
            if (self.instanceColor) self.instanceColor.needsUpdate = true;
          }}
        >
          <planeGeometry args={[1.3, 1.9]} />
          <meshBasicMaterial vertexColors toneMapped={false} />
        </instancedMesh>
      )}

      {/* Glass towers keep a subtle mullion/reflection grid instead of
          punched windows -- real curtain-wall glass reads as one
          continuous surface with thin frame lines, not individual holes. */}
      {style === 'glass' && (
        <mesh position={[x, y + height / 2, z]} scale={[1.005, 0.95, 1.005]}>
           <boxGeometry args={[width, height, depth]} />
           <meshStandardMaterial 
              color="#111" 
              emissive="#113344" 
              emissiveIntensity={0.35}
              wireframe 
           />
        </mesh>
      )}

      {/* Ground-floor plinth -- a darker, slightly wider band at street
          level standing in for a stone base / storefront glazing, so
          buildings don't look like they're extruded uniformly all the way
          down to the sidewalk. */}
      <mesh position={[x, y + 1.6, z]} castShadow receiveShadow>
        <boxGeometry args={[width + 0.3, 3.2, depth + 0.3]} />
        <meshStandardMaterial
          color={style === 'brick' ? '#3d2c24' : '#1c1f22'}
          roughness={0.6}
          metalness={style === 'glass' ? 0.4 : 0.15}
        />
      </mesh>

      {/* Entrance canopy -- thin overhang + two support posts over the
          main doors, only on wider non-glass buildings. */}
      {hasCanopy && (
        <group position={[x, y + 3.4, z - depth / 2 - 1.1]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[Math.min(width * 0.5, 8), 0.2, 2.2]} />
            <meshStandardMaterial color="#2a2a2a" roughness={0.5} metalness={0.4} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * Math.min(width * 0.5, 8) * 0.4, -1.6, 0.9]} castShadow>
              <cylinderGeometry args={[0.06, 0.06, 3.2, 6]} />
              <meshStandardMaterial color="#333" metalness={0.6} roughness={0.4} />
            </mesh>
          ))}
        </group>
      )}

      {/* Attached side annex/wing -- keeps every building from reading as
          one perfect extruded box. */}
      {annex && (
        <RigidBody
          type="fixed"
          colliders={false}
          position={[x + annex.ox, y + annex.h / 2, z + annex.oz]}
          collisionGroups={groupsExcluding(CollisionGroups.Default)}
        >
          <CuboidCollider args={[annex.w / 2, annex.h / 2, annex.d / 2]} />
          <mesh castShadow receiveShadow>
            <boxGeometry args={[annex.w, annex.h, annex.d]} />
            <meshStandardMaterial
              color={color}
              roughness={style === 'glass' ? 0.1 : style === 'brick' ? 0.85 : 0.6}
              metalness={style === 'glass' ? 0.9 : style === 'brick' ? 0.05 : 0.25}
            />
          </mesh>
        </RigidBody>
      )}

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

      {/* Tiered setback + spire -- breaks up the silhouette of the tallest
          towers instead of every skyscraper being one plain extruded box. */}
      {hasSetbackTier && (
        <group position={[x, y + height, z]}>
            <mesh castShadow receiveShadow position={[0, height * 0.06, 0]}>
                <boxGeometry args={[width * 0.6, height * 0.12, depth * 0.6]} />
                <meshStandardMaterial color={color} roughness={0.5} metalness={0.3} />
            </mesh>
            <mesh position={[0, height * 0.12 + height * 0.08, 0]}>
                <cylinderGeometry args={[0.15, 0.3, height * 0.16, 6]} />
                <meshStandardMaterial color="#999" roughness={0.4} metalness={0.6} />
            </mesh>
            <mesh position={[0, height * 0.12 + height * 0.16 + 0.4, 0]}>
                <sphereGeometry args={[0.25, 8, 8]} />
                <meshStandardMaterial color="#ff3333" emissive="#ff2222" emissiveIntensity={1.2} />
            </mesh>
        </group>
      )}

      {/* Rooftop water tank / AC units -- cheap variety for mid-height
          buildings that get neither the green roof nor the setback tier. */}
      {hasRoofUnits && (
        <group position={[x, y + height + 0.1, z]}>
            <mesh position={[width * 0.25, height * 0.05, depth * 0.2]} castShadow>
                <cylinderGeometry args={[width * 0.12, width * 0.12, height * 0.1, 8]} />
                <meshStandardMaterial color="#6b6b6b" roughness={0.7} metalness={0.3} />
            </mesh>
            <mesh position={[-width * 0.22, height * 0.025, -depth * 0.18]} castShadow>
                <boxGeometry args={[width * 0.18, height * 0.05, depth * 0.18]} />
                <meshStandardMaterial color="#444" roughness={0.6} />
            </mesh>
        </group>
      )}
    </group>
  );
};

const GreenCourtyard: React.FC<{ x: number, z: number, treeTemplates: TreeTemplate[] }> = ({ x, z, treeTemplates }) => {
    const y = getTerrainHeight(x, z);
    // Real ez-tree trees, same as Park.tsx's own -- "le aree verdi devono
    // avere la vegetazione del parco". Placed here (world x/z = courtyard
    // center + a small random offset) rather than nested inside the local
    // <group> below, since TreeInstance looks its own ground height up by
    // absolute world position (see ParkTrees.tsx). Stable per courtyard
    // (keyed on x/z) so trees don't reshuffle every re-render.
    const trees = useMemo(() => {
        if (treeTemplates.length === 0) return [];
        const count = 3 + Math.floor(Math.random() * 2); // 3-4 per courtyard
        const result: Array<{ x: number; z: number; rotationY: number; scale: number; templateIndex: number }> = [];
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2 + Math.random() * 0.6;
            const dist = 5 + Math.random() * 2.5;
            result.push({
                x: x + Math.cos(angle) * dist,
                z: z + Math.sin(angle) * dist,
                rotationY: Math.random() * Math.PI * 2,
                scale: 0.22 * (0.8 + Math.random() * 0.5),
                templateIndex: Math.floor(Math.random() * treeTemplates.length),
            });
        }
        return result;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [x, z, treeTemplates.length]);

    return (
        <>
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
            {/* Real grass + flowers, same deal as the trees above -- "le
                aree verdi devono avere la vegetazione del parco" (and
                "hai dimenticato l'erba e i fiori"). Bounds match the 20x20
                courtyard plane above; counts scaled down proportionally
                from Park's own 51x51 area. */}
            <GrassPatch
                minX={x - 10}
                maxX={x + 10}
                minZ={z - 10}
                maxZ={z + 10}
                count={700}
            />
            <Flowers
                minX={x - 10}
                maxX={x + 10}
                minZ={z - 10}
                maxZ={z + 10}
                count={12}
            />
            {trees.map((t, i) => (
                <TreeInstance
                    key={i}
                    x={t.x}
                    z={t.z}
                    rotationY={t.rotationY}
                    scale={t.scale}
                    template={treeTemplates[t.templateIndex]}
                />
            ))}
        </>
    );
};

const City: React.FC = () => {
  // Generated ONCE here and reused across every courtyard/plaza below --
  // ez-tree generation is the expensive part, not placement.
  const treeTemplates = useTreeTemplates();

  const { buildings, courtyards, plazas } = useMemo(() => {
    const bArr = [];
    const cArr = [];
    const pArr = [];
    const gridSpacing = 60;
    // Style-matched color palettes instead of one shared list of flat
    // grays overridden per-style anyway -- "aspetto/densità della città":
    // every building used to end up gray/blue/brick-red regardless of
    // this pick, which is a big part of why the skyline looked monotone.
    const buildingColorsByStyle: Record<'modern' | 'glass' | 'brick', string[]> = {
        modern: ['#c9c9c9', '#a3b1bf', '#8fa0ad', '#5a6b7a', '#3d4f5c', '#d9cdbb', '#8a8a8a'],
        glass: ['#88ccff', '#7fd8d8', '#a0e0ff', '#6fb8d9', '#9fc9e8'],
        brick: ['#8b3a2c', '#a0522d', '#7a4a3a', '#9c5b45', '#6b3f36', '#b06040'],
    };
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

        // Add buildings around the edges -- nudged back up from 2-3 to
        // 3-4 per block for a denser skyline (still well short of the
        // original 3-5 @ 7x7 grid this was shrunk from, to keep the mesh/
        // physics-body count in check).
        const count = 3 + Math.floor(Math.random() * 2);
        for (let k = 0; k < count; k++) {
            const w = 10 + Math.random() * 12;
            const d = 10 + Math.random() * 12;
            const h = 20 + Math.random() * 90;
            const style = styles[Math.floor(Math.random() * styles.length)];
            const palette = buildingColorsByStyle[style];
            const color = palette[Math.floor(Math.random() * palette.length)];

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
        <GreenCourtyard key={`court-${i}`} x={c.x} z={c.z} treeTemplates={treeTemplates} />
      ))}
      {plazas.map((p, i) => (
        <React.Fragment key={`plaza-${i}`}>
          <group position={[p.x, getTerrainHeight(p.x, p.z), p.z]}>
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
          {/* Real grass + flowers, same deal as GreenCourtyard above --
              bounds match the 45x45 plaza plane, avoiding the central
              monument box. Density closer to Park's own (51x51 / 4000
              grass / 60 flowers) since plazas are nearly as big. */}
          <GrassPatch
              minX={p.x - 22}
              maxX={p.x + 22}
              minZ={p.z - 22}
              maxZ={p.z + 22}
              count={3200}
              avoid={[{ x: p.x, z: p.z, radius: 4 }]}
          />
          <Flowers
              minX={p.x - 22}
              maxX={p.x + 22}
              minZ={p.z - 22}
              maxZ={p.z + 22}
              count={45}
              avoid={[{ x: p.x, z: p.z, radius: 4 }]}
          />
          {/* Real trees, same deal as GreenCourtyard above -- placed in
              absolute world coords (plaza center + offset), as siblings of
              the local group rather than nested inside it. */}
          {treeTemplates.length > 0 && [...Array(6)].map((_, i) => {
              const angle = (i / 6) * Math.PI * 2;
              const dist = 10 + (i % 2) * 4;
              return (
                  <TreeInstance
                      key={i}
                      x={p.x + Math.cos(angle) * dist}
                      z={p.z + Math.sin(angle) * dist}
                      rotationY={(angle * 3) % (Math.PI * 2)}
                      scale={0.22 * (0.8 + ((i * 37) % 10) / 10 * 0.5)}
                      template={treeTemplates[i % treeTemplates.length]}
                  />
              );
          })}
        </React.Fragment>
      ))}
      {buildings.map((b, i) => (
        <Building key={i} x={b.x} z={b.z} width={b.w} depth={b.d} height={b.h} color={b.color} style={b.style} />
      ))}
    </group>
  );
};

export default City;

