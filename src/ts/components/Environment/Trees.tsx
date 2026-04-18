import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useCylinder } from '@react-three/cannon';
import { Tree } from "@dgreenheck/ez-tree";
import { getTerrainHeight } from './Terrain';

const TreeInstances: React.FC = () => {
    const treeCount = 30; // Reduced tree count
    const terrainSize = 400;
  
    const { treeTemplates, instancesByTemplate } = useMemo(() => {
      const templates = [];
      const variationCount = 3; 
  
      for (let i = 0; i < variationCount; i++) {
        try {
            const t = new Tree();
            t.generate(); 
            
            const parts: { geometry: THREE.BufferGeometry, material: THREE.Material }[] = [];
            t.traverse((child) => {
              if (child instanceof THREE.Mesh && child.geometry && child.material) {
                parts.push({ 
                  geometry: child.geometry.clone(), 
                  material: (child.material as THREE.Material).clone()
                });
              }
            });
            
            if (parts.length > 0) {
                templates.push({ parts, trunkHeight: 5 }); 
            }
        } catch (e) {
            console.warn("Failed to generate tree template:", e);
        }
      }
  
      const byTemplate: any[][] = templates.map(() => []);
      
      if (templates.length > 0) {
          for (let i = 0; i < treeCount; i++) {
            const x = (Math.random() - 0.5) * terrainSize;
            const z = (Math.random() - 0.5) * terrainSize;
            const y = getTerrainHeight(x, z);
            const scale = 0.8 + Math.random() * 0.4;
            const tIdx = Math.floor(Math.random() * templates.length);
            
            byTemplate[tIdx].push({
                position: [x, y, z],
                rotation: [0, Math.random() * Math.PI * 2, 0],
                scale: [scale, scale, scale],
                trunkHeight: templates[tIdx].trunkHeight * scale
            });
          }
      }
  
      return { treeTemplates: templates, instancesByTemplate: byTemplate };
    }, [treeCount, terrainSize]);
  
    const allInstances = useMemo(() => instancesByTemplate.flat(), [instancesByTemplate]);
    
    useCylinder(() => allInstances.map((inst) => ({
      mass: 0,
      position: [inst.position[0], inst.position[1] + inst.trunkHeight / 2, inst.position[2]],
      args: [0.5 * inst.scale[0], 0.5 * inst.scale[0], inst.trunkHeight, 8],
      type: 'Static'
    })));
  
    return (
      <group>
        {treeTemplates.map((template, tIdx) => (
          <TemplateGroup 
            key={tIdx} 
            parts={template.parts} 
            instances={instancesByTemplate[tIdx]} 
          />
        ))}
      </group>
    );
};

const TemplateGroup: React.FC<{ parts: any[], instances: any[] }> = ({ parts, instances }) => {
    const dummy = useMemo(() => new THREE.Object3D(), []);

    return (
        <>
            {parts.map((part, pIdx) => (
                <instancedMesh 
                    key={pIdx} 
                    args={[part.geometry, part.material, instances.length]}
                    castShadow
                    onUpdate={(self) => {
                        instances.forEach((inst, i) => {
                            if (inst && inst.position) {
                                dummy.position.set(...inst.position as [number, number, number]);
                                dummy.rotation.set(...inst.rotation as [number, number, number]);
                                dummy.scale.set(...inst.scale as [number, number, number]);
                                dummy.updateMatrix();
                                self.setMatrixAt(i, dummy.matrix);
                            }
                        });
                        self.instanceMatrix.needsUpdate = true;
                    }}
                />
            ))}
        </>
    );
};

export default TreeInstances;
