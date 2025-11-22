import * as THREE from "three";
import { IUpdatable } from "~/interfaces/IUpdatable";
import { World } from "./World"; // Import World for context
import { IWorldEntity } from "~/interfaces/IWorldEntity"; // Import IWorldEntity

import grassFragment from "../../lib/shaders/procedural_grass_fragment.glsl?raw";
import grassVertex from "../../lib/shaders/procedural_grass_vertex.glsl?raw";

export class Grass implements IUpdatable, IWorldEntity {
  // Implement IWorldEntity
  public updateOrder: number = 2; // Sky is 1, so grass can be 2
  private grassMaterial: THREE.ShaderMaterial;
  private grassMesh: THREE.InstancedMesh;

  constructor(
    world: World,
    terrainSize: number,
    terrainMaxHeight: number,
    terrainSegments: number
  ) {
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

    for (let i = 0; i < grassCount; i++) {
      const x = Math.random() * terrainSize - terrainSize / 2;
      const z = Math.random() * terrainSize - terrainSize / 2;
      const y = Math.sin(x / 30) * Math.cos(z / 20) * terrainMaxHeight; // Using terrain height calculation from World

      dummy.position.set(x, y, z);
      dummy.updateMatrix();
      this.grassMesh.setMatrixAt(i, dummy.matrix);
    }
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
