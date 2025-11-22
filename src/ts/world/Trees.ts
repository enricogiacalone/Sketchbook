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
      tree.options.branch = tree.options.branch || {};

      // Randomize tree properties
      tree.options.seed = Math.random(); // Unique seed for each tree
      tree.options.trunk.length = 3 + Math.random() * 4; // Trunk length between 3 and 7
      tree.options.branch.levels = 1 + Math.floor(Math.random() * 3); // Branch levels between 1 and 3

      tree.generate();

      // Randomize scale
      const scale = 0.75 + Math.random() * 0.5; // Scale between 0.75 and 1.25
      tree.scale.set(scale, scale, scale);

      // Randomize rotation
      tree.rotation.y = Math.random() * Math.PI * 2; // Random rotation around Y-axis

      tree.position.set(x, y, z);

      this.world.sceneManager.graphicsWorld.add(tree);

      // Adjust physics body to match randomized scale and position
      const trunkPhysicsHeight = tree.options.trunk.length * scale; // Scale trunk height
      const treePhysicsBody = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Cylinder(
          0.5 * scale,
          0.5 * scale,
          trunkPhysicsHeight,
          8
        ), // Scale radius too
        position: new CANNON.Vec3(x, y + trunkPhysicsHeight / 2, z),
      });
      this.world.physicsManager.physicsWorld.addBody(treePhysicsBody);
    }
  }
}
