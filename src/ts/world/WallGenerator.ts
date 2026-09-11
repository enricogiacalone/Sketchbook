import * as THREE from "three";
import { World } from "./World"; // Import World

export class WallGenerator {
  private world: World;

  constructor(world: World) {
    this.world = world;
  }

  public generateWalls(terrainSize: number): void {
    // Add boundary walls
    const wallHeight = 50;
    const wallThickness = 1;
    const halfSize = terrainSize / 2;

    const wallMaterial = new THREE.MeshBasicMaterial({
      color: 0x888888,
      transparent: true,
      opacity: 0.5,
    });

    // Wall X+
    const wallXP = new THREE.Mesh(
      new THREE.BoxGeometry(
        wallThickness,
        wallHeight,
        terrainSize + wallThickness
      ),
      wallMaterial
    );
    wallXP.position.set(halfSize, wallHeight / 2, 0);
    wallXP.receiveShadow = false;
    this.world.sceneManager.graphicsWorld.add(wallXP);

    // Wall X-
    const wallXN = new THREE.Mesh(
      new THREE.BoxGeometry(
        wallThickness,
        wallHeight,
        terrainSize + wallThickness
      ),
      wallMaterial
    );
    wallXN.position.set(-halfSize, wallHeight / 2, 0);
    wallXN.receiveShadow = false;
    this.world.sceneManager.graphicsWorld.add(wallXN);

    // Wall Z+
    const wallZP = new THREE.Mesh(
      new THREE.BoxGeometry(
        terrainSize + wallThickness,
        wallHeight,
        wallThickness
      ),
      wallMaterial
    );
    wallZP.position.set(0, wallHeight / 2, halfSize);
    wallZP.receiveShadow = false;
    this.world.sceneManager.graphicsWorld.add(wallZP);

    // Wall Z-
    const wallZN = new THREE.Mesh(
      new THREE.BoxGeometry(
        terrainSize + wallThickness,
        wallHeight,
        wallThickness
      ),
      wallMaterial
    );
    wallZN.position.set(0, wallHeight / 2, -halfSize);
    wallZN.receiveShadow = false;
    this.world.sceneManager.graphicsWorld.add(wallZN);
  }
}
