import * as THREE from "three";
import * as CANNON from "cannon-es";
import { TerrainGrid, TerrainCellType } from "./TerrainGrid"; // New: Import TerrainGrid and TerrainCellType
import * as Utils from "~/core/FunctionLibrary"; // Assuming Utils is needed for cannonVector/cannonQuat

export class Road implements IWorldEntity {
  private roadMeshes: THREE.Mesh[] = [];
  private roadPhysicsBodies: CANNON.Body[] = [];
  private world: World; // Store world reference to access getTerrainHeightAt
  private terrainGrid: TerrainGrid; // New: Store terrainGrid

  constructor(
    world: World,
    terrainSize: number,
    terrainSegments: number,
    groundGeometry: THREE.PlaneGeometry,
    terrainMaxHeight: number,
    terrainGrid: TerrainGrid // New: Accept terrainGrid
  ) {
    this.world = world;
    this.terrainGrid = terrainGrid; // Store terrainGrid
    const roadWidth = 8;
    const roadMaterial = new THREE.MeshStandardMaterial({
      color: 0x555555, // Darker, stone-like grey
      roughness: 0.8, // Make it look a bit rougher
      metalness: 0.1,
    });
    const roadSegmentsAlongLength = terrainSegments * 2; // More segments for smoother roads
    const roadSegmentsAcrossWidth = 10; // Increased for better terrain conformity

    const yOffset = 0.1; // Increased offset to keep road slightly above terrain

    // Function to generate a road section along a given axis
    const generateRoadSection = (
      axis: "x" | "z",
      length: number,
      positionOffset: THREE.Vector3
    ): void => {
      const roadGeometry = new THREE.PlaneGeometry(
        axis === "x" ? length : roadWidth,
        axis === "z" ? length : roadWidth,
        axis === "x" ? roadSegmentsAlongLength : roadSegmentsAcrossWidth,
        axis === "z" ? roadSegmentsAlongLength : roadSegmentsAcrossWidth
      );

      // Rotate geometry if along Z-axis
      if (axis === "z") {
        roadGeometry.rotateY(Math.PI / 2); // Rotate to align with Z-axis
      }
      roadGeometry.rotateX(-Math.PI / 2); // Lay flat on XZ plane

      const positionAttribute = roadGeometry.attributes.position;
      const tempVector = new THREE.Vector3();

      // Determine road bounds for marking terrainGrid
      let minX_road = Infinity;
      let maxX_road = -Infinity;
      let minZ_road = Infinity;
      let maxZ_road = -Infinity;

      for (let i = 0; i < positionAttribute.count; i++) {
        tempVector.fromBufferAttribute(positionAttribute, i);

        // Apply global position offset to tempVector before sampling terrain height
        const globalX = tempVector.x + positionOffset.x;
        const globalZ = tempVector.z + positionOffset.z;

        // Update road bounds
        minX_road = Math.min(minX_road, globalX);
        maxX_road = Math.max(maxX_road, globalX);
        minZ_road = Math.min(minZ_road, globalZ);
        maxZ_road = Math.max(maxZ_road, globalZ);


        const y = this.world.worldBuilder.getTerrainHeightAt(
          globalX,
          globalZ,
          groundGeometry,
          terrainMaxHeight
        );

        positionAttribute.setY(i, y + yOffset);
      }
      positionAttribute.needsUpdate = true; // Mark as updated

      roadGeometry.computeVertexNormals(); // Recalculate normals after Y-adjustments

      const roadMesh = new THREE.Mesh(roadGeometry, roadMaterial);
      roadMesh.position.copy(positionOffset); // Apply main offset
      roadMesh.receiveShadow = true;
      roadMesh.castShadow = true;
      this.roadMeshes.push(roadMesh);

      // Create physics body from the same geometry
      const physicsVertices = (roadGeometry.attributes.position as THREE.BufferAttribute).array;
      const physicsIndices = (roadGeometry.index as THREE.BufferAttribute).array;

      const trimeshShape = new CANNON.Trimesh(
        physicsVertices as any,
        physicsIndices as any
      );
      const roadBody = new CANNON.Body({
        mass: 0,
        material: world.physicsManager.trimeshMaterial,
      });
      roadBody.addShape(trimeshShape);
      roadBody.position.copy(Utils.cannonVector(positionOffset));
      this.roadPhysicsBodies.push(roadBody);

      // Mark area in terrain grid as Road
      this.terrainGrid.markArea(minX_road, minZ_road, maxX_road, maxZ_road, TerrainCellType.Road);
    };

    // Generate Main road along X-axis
    generateRoadSection("x", terrainSize, new THREE.Vector3(0, 0, 0));

    // Generate Main road along Z-axis
    generateRoadSection("z", terrainSize, new THREE.Vector3(0, 0, 0));
  }

  public addToWorld(world: World): void {
    this.roadMeshes.forEach((mesh) =>
      world.sceneManager.graphicsWorld.add(mesh)
    );
    this.roadPhysicsBodies.forEach((body) =>
      world.physicsManager.physicsWorld.addBody(body)
    );
  }

  public removeFromWorld(world: World): void {
    this.roadMeshes.forEach((mesh) =>
      world.sceneManager.graphicsWorld.remove(mesh)
    );
    this.roadPhysicsBodies.forEach((body) =>
      world.physicsManager.physicsWorld.removeBody(body)
    );
    this.roadMeshes = [];
    this.roadPhysicsBodies = [];
  }
}
