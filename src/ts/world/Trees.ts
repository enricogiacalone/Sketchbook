import * as THREE from "three";
import * as CANNON from "cannon-es";
import { World } from "~/world/World";
import { Tree } from "@dgreenheck/ez-tree";

export class Trees {
  private world: World;
  private terrainSize: number;
  private groundGeometry: THREE.PlaneGeometry;
  private terrainMaxHeight: number;

  constructor(
    world: World,
    terrainSize: number,
    groundGeometry: THREE.PlaneGeometry,
    terrainMaxHeight: number
  ) {
    this.world = world;
    this.terrainSize = terrainSize;
    this.groundGeometry = groundGeometry;
    this.terrainMaxHeight = terrainMaxHeight;
  }

  public generateTrees(): void {
    const ezTreeCount = 75;
    for (let i = 0; i < ezTreeCount; i++) {
      const x = Math.random() * this.terrainSize - this.terrainSize / 2;
      const z = Math.random() * this.terrainSize - this.terrainSize / 2;
      const y = this.world.worldBuilder.getTerrainHeightAt(
        x,
        z,
        this.groundGeometry,
        this.terrainMaxHeight
      ); // Assuming getHeightAt gives ground level

      const tree = new Tree();
      tree.options = tree.options || {};
      tree.options.trunk = tree.options.trunk || {};
      tree.options.seed = 1;
      tree.options.trunk.length = 5;
      tree.options.branch.levels = 2;
      tree.generate();

      tree.position.set(x, y, z);

      this.world.sceneManager.graphicsWorld.add(tree);

      const trunkPhysicsHeight = tree.options.trunk.length;
      const treePhysicsBody = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Cylinder(0.5, 0.5, trunkPhysicsHeight, 8),
        position: new CANNON.Vec3(x, y + trunkPhysicsHeight / 2, z),
      });
      this.world.physicsManager.physicsWorld.addBody(treePhysicsBody);
    }
  }
}
