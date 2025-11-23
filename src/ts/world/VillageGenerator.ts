import * as THREE from "three";
import { TerrainGrid, TerrainCellType } from "./TerrainGrid"; // New: Import TerrainGrid and TerrainCellType
import { Streetlight } from "./Streetlight";
import { EntityManager } from "~/core/EntityManager"; // Assuming EntityManager is used for adding entities
import { PhysicsManager } from "~/core/PhysicsManager"; // Assuming PhysicsManager for materials
import * as CANNON from "cannon-es";

export class VillageGenerator {
  private world: World;
  private entityManager: EntityManager;
  private physicsManager: PhysicsManager;
  private groundGeometry: THREE.PlaneGeometry; // Add groundGeometry property
  private terrainGrid: TerrainGrid; // New: Store terrainGrid

  constructor(
    world: World,
    entityManager: EntityManager,
    physicsManager: PhysicsManager,
    groundGeometry: THREE.PlaneGeometry,
    terrainGrid: TerrainGrid // New: Accept terrainGrid
  ) {
    this.world = world;
    this.entityManager = entityManager;
    this.physicsManager = physicsManager;
    this.groundGeometry = groundGeometry; // Assign groundGeometry
    this.terrainGrid = terrainGrid; // Store terrainGrid
  }

  public generateVillage(terrainMaxHeight: number): void {
    const villageCenter = new THREE.Vector3(0, 0, 0);
    const villageRadius = 40;
    const buildingCount = 8;

    const houseBodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x8b4513,
    }); // Brown walls
    const houseRoofMaterial = new THREE.MeshStandardMaterial({
      color: 0xa00000,
    }); // Red roof
    const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x5a2d0c }); // Dark wood
    const windowMaterial = new THREE.MeshStandardMaterial({
      color: 0x87ceeb,
      transparent: true,
      opacity: 0.8,
    });

    for (let i = 0; i < buildingCount; i++) {
      // Random position within village radius
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * villageRadius;
      const x = villageCenter.x + Math.cos(angle) * radius;
      const z = villageCenter.z + Math.sin(angle) * radius;

      // House dimensions
      const houseWidth = THREE.MathUtils.randFloat(4, 7);
      const houseDepth = THREE.MathUtils.randFloat(4, 7);
      const houseHeight = THREE.MathUtils.randFloat(5, 8);

      // Check if the area for the house is clear before placing
      const halfHouseWidth = houseWidth / 2;
      const halfHouseDepth = houseDepth / 2;

      // Define a small bounding box for the house for grid check
      let houseMinX = x - halfHouseWidth;
      let houseMaxX = x + halfHouseWidth;
      let houseMinZ = z - halfHouseDepth;
      let houseMaxZ = z + halfHouseDepth;

      if (!this.terrainGrid.isOccupied(x, z)) { // Check only center for simplicity
        // Mark the area as Building
        this.terrainGrid.markArea(houseMinX, houseMinZ, houseMaxX, houseMaxZ, TerrainCellType.Building);

        const baseHeight = Math.sin(x / 30) * Math.cos(z / 20) * terrainMaxHeight;
        const roofHeight = THREE.MathUtils.randFloat(2, 4);

        // House Body (Visual)
        const houseBodyGeometry = new THREE.BoxGeometry(
          houseWidth,
          houseHeight,
          houseDepth
        );
        const houseBodyMesh = new THREE.Mesh(
          houseBodyGeometry,
          houseBodyMaterial
        );
        houseBodyMesh.position.set(x, baseHeight + houseHeight / 2, z);
        houseBodyMesh.castShadow = true;
        houseBodyMesh.receiveShadow = true;
        this.world.sceneManager.graphicsWorld.add(houseBodyMesh);

        // House Roof (Visual)
        const houseRoofGeometry = new THREE.ConeGeometry(
          Math.max(houseWidth, houseDepth) / 1.5,
          roofHeight,
          4
        ); // Square pyramid
        const houseRoofMesh = new THREE.Mesh(
          houseRoofGeometry,
          houseRoofMaterial
        );
        houseRoofMesh.position.set(
          x,
          baseHeight + houseHeight + roofHeight / 2,
          z
        );
        houseRoofMesh.rotation.y = Math.PI / 4; // Rotate by 45 degrees
        houseRoofMesh.castShadow = true;
        houseRoofMesh.receiveShadow = true;
        this.world.sceneManager.graphicsWorld.add(houseRoofMesh);

        // House Body (Physics)
        const physicsBodyShape = new CANNON.Box(
          new CANNON.Vec3(houseWidth / 2, houseHeight / 2, houseDepth / 2)
        );
        const physicsBody = new CANNON.Body({
          mass: 0,
          material: this.physicsManager.trimeshMaterial,
        });
        physicsBody.addShape(physicsBodyShape);
        physicsBody.position.set(x, baseHeight + houseHeight / 2, z);
        this.physicsManager.physicsWorld.addBody(physicsBody);
      }
    }

    // Add Streetlights around the village
    const streetlightCount = 8;
    for (let i = 0; i < streetlightCount; i++) {
      const angle = (i / streetlightCount) * Math.PI * 2;
      const radius = villageRadius + 15; // Place streetlights outside the village
      const x = villageCenter.x + Math.cos(angle) * radius;
      const z = villageCenter.z + Math.sin(angle) * radius;
      const y = this.world.worldBuilder.getTerrainHeightAt(
        x,
        z,
        this.groundGeometry,
        terrainMaxHeight
      ); // Get terrain height

      const streetlight = new Streetlight(
        this.world,
        new THREE.Vector3(x, y, z)
      );
      this.entityManager.add(streetlight);
    }

    // Add a Well to the village
    const wellRadius = 1.5;
    const wellHeight = 2;
    const wellSupportHeight = 3;
    const wellRoofWidth = 4;
    const wellRoofDepth = 2;
    const wellRoofThickness = 0.2;

    const wellMaterial = new THREE.MeshStandardMaterial({ color: 0x6e6e6e }); // Stone color
    const wellWoodMaterial = new THREE.MeshStandardMaterial({
      color: 0x8b4513,
    }); // Wood color

    const wellX = villageCenter.x + Math.random() * 5 - 2.5; // Slightly randomized central position
    const wellZ = villageCenter.z + Math.random() * 5 - 2.5;
    const wellY = this.world.worldBuilder.getTerrainHeightAt(
      wellX,
      wellZ,
      this.groundGeometry,
      terrainMaxHeight
    );

    // Well Base (Visual)
    const wellBaseGeometry = new THREE.CylinderGeometry(
      wellRadius,
      wellRadius,
      wellHeight,
      16
    );
    const wellBaseMesh = new THREE.Mesh(wellBaseGeometry, wellMaterial);
    wellBaseMesh.position.set(wellX, wellY + wellHeight / 2, wellZ);
    wellBaseMesh.castShadow = true;
    wellBaseMesh.receiveShadow = true;
    this.world.sceneManager.graphicsWorld.add(wellBaseMesh);

    // Well Supports (Visual)
    const supportGeometry = new THREE.BoxGeometry(0.3, wellSupportHeight, 0.3);
    const support1 = new THREE.Mesh(supportGeometry, wellWoodMaterial);
    support1.position.set(
      wellX - wellRadius,
      wellY + wellHeight + wellSupportHeight / 2,
      wellZ
    );
    support1.castShadow = true;
    support1.receiveShadow = true;
    this.world.sceneManager.graphicsWorld.add(support1);

    const support2 = new THREE.Mesh(supportGeometry, wellWoodMaterial);
    support2.position.set(
      wellX + wellRadius,
      wellY + wellHeight + wellSupportHeight / 2,
      wellZ
    );
    support2.castShadow = true;
    support2.receiveShadow = true;
    this.world.sceneManager.graphicsWorld.add(support2);

    // Well Roof (Visual)
    const roofGeometry = new THREE.BoxGeometry(
      wellRoofWidth,
      wellRoofThickness,
      wellRoofDepth
    );
    const wellRoofMesh = new THREE.Mesh(roofGeometry, wellWoodMaterial);
    wellRoofMesh.position.set(
      wellX,
      wellY + wellHeight + wellSupportHeight + wellRoofThickness / 2,
      wellZ
    );
    wellRoofMesh.castShadow = true;
    wellRoofMesh.receiveShadow = true;
    this.world.sceneManager.graphicsWorld.add(wellRoofMesh);

    // Well Physics Body (simplified as a single box for the whole structure)
    const totalWellHeight = wellHeight + wellSupportHeight + wellRoofThickness;
    const wellPhysicsShape = new CANNON.Box(
      new CANNON.Vec3(wellRadius, totalWellHeight / 2, wellRadius)
    );
    const wellPhysicsBody = new CANNON.Body({
      mass: 0,
      material: this.physicsManager.trimeshMaterial,
    });
    wellPhysicsBody.addShape(wellPhysicsShape);
    wellPhysicsBody.position.set(wellX, wellY + totalWellHeight / 2, wellZ);
    this.physicsManager.physicsWorld.addBody(wellPhysicsBody);

    // Irregular Circular Wall enclosing the village
    const irregularCircleRadius = villageRadius + 25; // Base radius for the irregular circle, slightly larger than village
    const irregularityFactor = 8; // Controls how much the circle deviates from perfect
    const numWallSegments = 40; // Number of segments to make up the irregular circle
    const wallThickness = 1; // Define wallThickness here

    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x777777 }); // Grey stone

    // Define consistent Y coordinates for the wall
    const wallTopY = terrainMaxHeight + 10; // Consistent top for walking
    const wallBottomY = -(terrainMaxHeight + 5); // Fixed bottom to avoid holes, extending below lowest terrain point
    const consistentWallHeight = wallTopY - wallBottomY;

    const irregularPoints: THREE.Vector3[] = [];

    for (let i = 0; i < numWallSegments; i++) {
      const angle = (i / numWallSegments) * Math.PI * 2;
      const baseRadius = irregularCircleRadius;
      const currentRadius =
        baseRadius + (Math.random() - 0.5) * irregularityFactor * 2; // Add random offset

      const x = villageCenter.x + currentRadius * Math.cos(angle);
      const z = villageCenter.z + currentRadius * Math.sin(angle);

      // Points are generated at wallBottomY for the base of the wall segments
      irregularPoints.push(new THREE.Vector3(x, wallBottomY, z));
    }

    // Connect points to form the irregular wall
    for (let i = 0; i < numWallSegments; i++) {
      const startPoint = irregularPoints[i];
      const endPoint = irregularPoints[(i + 1) % numWallSegments]; // Connect last point to first

      const midX = (startPoint.x + endPoint.x) / 2;
      const midZ = (startPoint.z + endPoint.z) / 2;

      const segmentLength = startPoint.distanceTo(endPoint);
      const rotationY = Math.atan2(
        endPoint.x - startPoint.x,
        endPoint.z - startPoint.z
      );

      // Wall segment geometry uses consistent height
      const wallSegmentGeometry = new THREE.BoxGeometry(
        wallThickness,
        consistentWallHeight,
        segmentLength
      );
      const wallSegmentMesh = new THREE.Mesh(wallSegmentGeometry, wallMaterial);
      // Positioned such that its bottom is at wallBottomY and top at wallTopY
      wallSegmentMesh.position.set(
        midX,
        wallBottomY + consistentWallHeight / 2,
        midZ
      );
      wallSegmentMesh.rotation.y = rotationY;
      wallSegmentMesh.castShadow = true;
      wallSegmentMesh.receiveShadow = true;
      this.world.sceneManager.graphicsWorld.add(wallSegmentMesh);

      // Physics for wall segment
      const wallPhysicsShape = new CANNON.Box(
        new CANNON.Vec3(
          wallThickness / 2,
          consistentWallHeight / 2,
          segmentLength / 2
        )
      );
      const wallPhysicsBody = new CANNON.Body({
        mass: 0,
        material: this.physicsManager.trimeshMaterial,
      });
      wallPhysicsBody.addShape(wallPhysicsShape);
      wallPhysicsBody.position.copy(
        new CANNON.Vec3(midX, wallBottomY + consistentWallHeight / 2, midZ)
      );
      wallPhysicsBody.quaternion.setFromAxisAngle(
        new CANNON.Vec3(0, 1, 0),
        rotationY
      );
      this.world.physicsManager.physicsWorld.addBody(wallPhysicsBody);
    }

    // Generate towers along the irregular wall
    const numTowers = 8; // Number of towers
    const towerHeight = consistentWallHeight + 5; // Towers taller than wall
    const towerRadius = 3; // Radius of the towers
    const towerMaterial = new THREE.MeshStandardMaterial({ color: 0x666666 }); // Darker grey stone

    for (let i = 0; i < numTowers; i++) {
      const angle = (i / numTowers) * Math.PI * 2;
      const towerX = villageCenter.x + irregularCircleRadius * Math.cos(angle);
      const towerZ = villageCenter.z + irregularCircleRadius * Math.sin(angle);

      // Tower Base (Visual)
      const towerBaseGeometry = new THREE.CylinderGeometry(
        towerRadius,
        towerRadius,
        towerHeight,
        16
      );
      const towerBaseMesh = new THREE.Mesh(towerBaseGeometry, towerMaterial);
      towerBaseMesh.position.set(towerX, wallBottomY + towerHeight / 2, towerZ); // Positioned on wallBottomY
      towerBaseMesh.castShadow = true;
      towerBaseMesh.receiveShadow = true;
      this.world.sceneManager.graphicsWorld.add(towerBaseMesh);

      // Tower Top Platform (Visual) - simple box
      const platformHeight = 1;
      const platformGeometry = new THREE.BoxGeometry(
        towerRadius * 2.2,
        platformHeight,
        towerRadius * 2.2
      );
      const platformMesh = new THREE.Mesh(platformGeometry, towerMaterial);
      platformMesh.position.set(
        towerX,
        wallBottomY + towerHeight + platformHeight / 2,
        towerZ
      );
      platformMesh.castShadow = true;
      platformMesh.receiveShadow = true;
      this.world.sceneManager.graphicsWorld.add(platformMesh);

      // Tower Physics Body (simplified as a single cylinder for the base)
      const towerPhysicsShape = new CANNON.Cylinder(
        towerRadius,
        towerRadius,
        towerHeight,
        16
      );
      const towerPhysicsBody = new CANNON.Body({
        mass: 0,
        material: this.physicsManager.trimeshMaterial,
      });
      towerPhysicsBody.addShape(towerPhysicsShape);
      towerPhysicsBody.position.copy(
        new CANNON.Vec3(towerX, wallBottomY + towerHeight / 2, towerZ)
      );
      this.world.physicsManager.physicsWorld.addBody(towerPhysicsBody);
    }
  }
}
