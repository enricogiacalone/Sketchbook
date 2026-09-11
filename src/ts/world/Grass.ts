import * as THREE from "three";
import { IWorldEntity } from "~/interfaces/IWorldEntity"; // Import IWorldEntity
import { TerrainGrid, TerrainCellType } from "./TerrainGrid"; // New: Import TerrainGrid and TerrainCellType

import grassFragment from "../../lib/shaders/procedural_grass_fragment.glsl?raw";
import grassVertex from "../../lib/shaders/procedural_grass_vertex.glsl?raw";

export class Grass implements IUpdatable, IWorldEntity {
  // Implement IWorldEntity
  public updateOrder: number = 2; // Sky is 1, so grass can be 2
  private grassMaterial: THREE.ShaderMaterial;
  private grassMesh: THREE.InstancedMesh;
  private terrainGrid: TerrainGrid; // New: Store terrainGrid

  constructor(
    world: World,
    terrainSize: number,
    terrainMaxHeight: number,
    terrainSegments: number,
    terrainGrid: TerrainGrid // New: Accept terrainGrid
  ) {
    this.terrainGrid = terrainGrid; // Store terrainGrid
    const grassCount = 60000; // Reduced for performance

    const grassBaseGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);

    this.grassMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: grassVertex,
      fragmentShader: grassFragment,
      side: THREE.DoubleSide,
    });

    this.grassMesh = new THREE.InstancedMesh(
      grassBaseGeometry,
      this.grassMaterial,
      grassCount
    );

    // world.sceneManager.graphicsWorld.add(this.grassMesh); // This is now done in addToWorld

    const dummy = new THREE.Object3D();
    let placedGrassCount = 0; // Track actual placed grass instances

    for (let i = 0; i < grassCount && placedGrassCount < grassCount; i++) {
      const x = Math.random() * terrainSize - terrainSize / 2;
      const z = Math.random() * terrainSize - terrainSize / 2;

      // Only place grass if the cell is empty
      if (!this.terrainGrid.isOccupied(x, z)) {
        const y = Math.sin(x / 30) * Math.cos(z / 20) * terrainMaxHeight; // Using terrain height calculation from World

        dummy.position.set(x, y, z);
        dummy.updateMatrix();
        this.grassMesh.setMatrixAt(placedGrassCount, dummy.matrix);
        this.terrainGrid.mark(x, z, TerrainCellType.Grass); // Mark as Grass
        placedGrassCount++;
      }
    }
    this.grassMesh.count = placedGrassCount; // Set actual count of instances
    this.grassMesh.instanceMatrix.needsUpdate = true;
  }

  public addToWorld(world: World): void {
    world.sceneManager.graphicsWorld.add(this.grassMesh);
  }

  public removeFromWorld(world: World): void {
    world.sceneManager.graphicsWorld.remove(this.grassMesh);
  }

  public update(timeStep: number, unscaledTimeStep: number): void {
    if (this.grassMaterial) {
      this.grassMaterial.uniforms.uTime.value += unscaledTimeStep;
    }
  }
}
