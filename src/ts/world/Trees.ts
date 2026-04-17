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
    const totalTreeCount = 150; // Increased count because it's now more performant
    const variationCount = 5;
    const treesPerVariation = Math.floor(totalTreeCount / variationCount);

    for (let v = 0; v < variationCount; v++) {
      // Create a template tree to get its geometry and material
      const templateTree = new Tree();
      
      // Safely set options without overwriting defaults
      templateTree.options = templateTree.options || {};
      templateTree.options.trunk = templateTree.options.trunk || {};
      templateTree.options.branch = templateTree.options.branch || {};
      
      templateTree.options.seed = Math.random();
      templateTree.options.trunk.length = 3 + Math.random() * 4;
      templateTree.options.branch.levels = 1 + Math.floor(Math.random() * 3);
      
      templateTree.generate();

      // Extract geometry and material from the template
      const meshes: THREE.Mesh[] = [];
      templateTree.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          meshes.push(child);
        }
      });

      if (meshes.length === 0) continue;

      // Use the first mesh as a reference for physics (usually the trunk)
      const referenceMesh = meshes[0];

      // For simplicity in this architectural update, we'll instance each unique part of the tree
      meshes.forEach((mesh) => {
        const instancedMesh = new THREE.InstancedMesh(
          mesh.geometry,
          mesh.material,
          treesPerVariation
        );
        this.world.sceneManager.graphicsWorld.add(instancedMesh);

        const dummy = new THREE.Object3D();
        for (let i = 0; i < treesPerVariation; i++) {
          const x = Math.random() * this.terrainSize - this.terrainSize / 2;
          const z = Math.random() * this.terrainSize - this.terrainSize / 2;
          const y = this.world.worldBuilder.getTerrainHeightAt(
            x,
            z,
            this.groundGeometry,
            this.terrainMaxHeight
          );

          const scale = 0.75 + Math.random() * 0.5;
          dummy.position.set(x, y, z);
          dummy.rotation.y = Math.random() * Math.PI * 2;
          dummy.scale.set(scale, scale, scale);
          dummy.updateMatrix();

          instancedMesh.setMatrixAt(i, dummy.matrix);

          // Add physics body only once per tree (using the reference mesh)
          if (mesh === referenceMesh) {
            const trunkHeight = (templateTree.options.trunk.length || 5) * scale;
            const treePhysicsBody = new CANNON.Body({
              mass: 0,
              shape: new CANNON.Cylinder(0.5 * scale, 0.5 * scale, trunkHeight, 8),
              position: new CANNON.Vec3(x, y + trunkHeight / 2, z),
            });
            this.world.physicsManager.physicsWorld.addBody(treePhysicsBody);
          }
        }
        instancedMesh.instanceMatrix.needsUpdate = true;
      });
    }
  }
}
