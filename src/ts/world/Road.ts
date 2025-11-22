import * as CANNON from "cannon-es";
import * as THREE from "three";
import { IWorldEntity } from "~/interfaces/IWorldEntity";
import { World } from "./World";
import * as Utils from "~/core/FunctionLibrary"; // Assuming Utils is needed for cannonVector/cannonQuat

export class Road implements IWorldEntity {
  private roadMeshes: THREE.Mesh[] = [];
  private roadPhysicsBodies: CANNON.Body[] = [];
  private world: World; // Store world reference to access getTerrainHeightAt

  constructor(
    world: World,
    terrainSize: number,
    terrainSegments: number,
    groundGeometry: THREE.PlaneGeometry,
    terrainMaxHeight: number
  ) {
    this.world = world;
    const roadWidth = 8;
    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const roadSegments = terrainSegments * 2; // More segments for smoother roads

    // Helper function to create a road segment
    const createRoadSegment = (
      x1: number,
      z1: number,
      x2: number,
      z2: number
    ): void => {
      const y1 = this.world.worldBuilder.getTerrainHeightAt(
        x1,
        z1,
        groundGeometry,
        terrainMaxHeight
      );
      const y2 = this.world.worldBuilder.getTerrainHeightAt(
        x2,
        z2,
        groundGeometry,
        terrainMaxHeight
      );

      // Calculate perpendicular vector for road width
      const dir = new THREE.Vector3(x2 - x1, y2 - y1, z2 - z1).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const perp = new THREE.Vector3()
        .crossVectors(dir, up)
        .normalize()
        .multiplyScalar(roadWidth / 2);

      const rv0 = new THREE.Vector3(x1 - perp.x, y1, z1 - perp.z);
      const rv1 = new THREE.Vector3(x1 + perp.x, y1, z1 + perp.z);
      const rv2 = new THREE.Vector3(x2 - perp.x, y2, z2 - perp.z);
      const rv3 = new THREE.Vector3(x2 + perp.x, y2, z2 + perp.z);

      const positions = new Float32Array([
        rv0.x,
        rv0.y + 0.05,
        rv0.z, // Slightly above terrain to prevent z-fighting
        rv1.x,
        rv1.y + 0.05,
        rv1.z,
        rv2.x,
        rv2.y + 0.05,
        rv2.z,

        rv2.x,
        rv2.y + 0.05,
        rv2.z,
        rv1.x,
        rv1.y + 0.05,
        rv1.z,
        rv3.x,
        rv3.y + 0.05,
        rv3.z,
      ]);

      const normals = new Float32Array([
        0, 1, 0, 0, 1, 0, 0, 1, 0,

        0, 1, 0, 0, 1, 0, 0, 1, 0,
      ]);

      const uvs = new Float32Array([
        0, 0, 1, 0, 0, 1,

        0, 1, 1, 0, 1, 1,
      ]);

      const segmentGeometry = new THREE.BufferGeometry();
      segmentGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3)
      );
      segmentGeometry.setAttribute(
        "normal",
        new THREE.BufferAttribute(normals, 3)
      );
      segmentGeometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
      segmentGeometry.computeVertexNormals(); // Recalculate normals for smooth shading

      const roadMesh = new THREE.Mesh(segmentGeometry, roadMaterial);
      roadMesh.receiveShadow = true;
      roadMesh.castShadow = true; // Roads can cast shadows too
      this.roadMeshes.push(roadMesh); // Add to local array

      // Create physics body for the road segment
      const physicsVertices = new Float32Array([
        rv0.x,
        rv0.y,
        rv0.z,
        rv1.x,
        rv1.y,
        rv1.z,
        rv2.x,
        rv2.y,
        rv2.z,
        rv3.x,
        rv3.y,
        rv3.z,
      ]);
      const physicsIndices = new Uint16Array([0, 1, 2, 2, 1, 3]);
      const trimeshShape = new CANNON.Trimesh(
        physicsVertices as any,
        physicsIndices as any
      );
      const roadBody = new CANNON.Body({
        mass: 0,
        material: world.physicsManager.trimeshMaterial,
      });
      roadBody.addShape(trimeshShape);
      this.roadPhysicsBodies.push(roadBody); // Add to local array
    };

    // Main road along X-axis
    for (let i = -roadSegments / 2; i < roadSegments / 2; i++) {
      const x1 = (i / roadSegments) * terrainSize;
      const x2 = ((i + 1) / roadSegments) * terrainSize;
      createRoadSegment(x1, 0, x2, 0);
    }

    // Main road along Z-axis
    for (let i = -roadSegments / 2; i < roadSegments / 2; i++) {
      const z1 = (i / roadSegments) * terrainSize;
      const z2 = ((i + 1) / roadSegments) * terrainSize;
      createRoadSegment(0, z1, 0, z2);
    }
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
