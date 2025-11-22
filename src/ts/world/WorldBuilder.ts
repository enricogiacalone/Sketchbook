import * as CANNON from "cannon-es";
import * as THREE from "three";
import Swal from "sweetalert2";

import { BoxCollider } from "../physics/colliders/BoxCollider";
import { TrimeshCollider } from "../physics/colliders/TrimeshCollider";
import { World } from "./World";
import { Character } from "../characters/Character";
import { CharacterSpawnPoint } from "./CharacterSpawnPoint";
import { Ocean } from "./Ocean";
import { Path } from "./Path";
import { Scenario } from "./Scenario";
import { Trees } from "./Trees";
import { VehicleSpawnPoint } from "./VehicleSpawnPoint";
import { VillageGenerator } from "./VillageGenerator";
import { WallGenerator } from "./WallGenerator";
import { Grass } from "./Grass";
import { Road } from "./Road";
import { UIManager } from "../core/UIManager";
import * as Utils from "../core/FunctionLibrary";
import { CollisionGroups } from "../enums/CollisionGroups";

// Constants for GLTF userData
const USER_DATA_PHYSICS = "physics";
const USER_DATA_TYPE_BOX = "box";
const USER_DATA_TYPE_TRIMESH = "trimesh";
const USER_DATA_PATH = "path";
const USER_DATA_SCENARIO = "scenario";
const MATERIAL_NAME_OCEAN = "ocean";

export class WorldBuilder {
  constructor(private world: World) {}

  public load(worldScenePath?: any) {
    this._postLoadingSetup(worldScenePath);
  }

  private _postLoadingSetup(worldScenePath?: any): void {
    this.world.update(1, 1);
    this.world.setTimeScale(1);

    Swal.fire({
      title: "Welcome to Sketchbook!",
      text: "Feel free to explore the world and interact with available vehicles. There are also various scenarios ready to launch from the right panel.",
      footer:
        '<a href="https://github.com/swift502/Sketchbook" target="_blank">GitHub page</a><a href="https://discord.gg/fGuEqCe" target="_blank">Discord server</a>',
      input: "text",
      inputLabel: "Your Name",
      inputPlaceholder: "Enter your name...",
      confirmButtonText: "Join",
      buttonsStyling: false,
      allowOutsideClick: false,
      allowEscapeKey: false,
      inputValidator: (value) => {
        if (!value) {
          return "You need to write something!";
        }
        return null;
      },
    }).then((result) => {
      if (result.isConfirmed) {
        UIManager.setUserInterfaceVisible(true);
        UIManager.setLoadingScreenVisible(false);

        if (worldScenePath !== undefined) {
          this.world.loadingManager
            .loadGLTFPromise(worldScenePath)
            .then((gltf) => {
              this.loadScene(gltf);
            })
            .catch((error) => {
              console.error("Error loading world scene:", error);
              Swal.fire({
                icon: "error",
                title: "Failed to load world",
                text: error.message,
                footer: "Please check the browser console for more details.",
              });
            });
        } else {
          console.log(
            "worldScenePath is undefined, creating procedural world."
          );
          this.createProceduralWorld();
        }

        if (this.world.onJoin) {
          setTimeout(() => {
            try {
              this.world.onJoin(result.value);
            } catch (error) {
              console.error("Error initiating socket connection:", error);
              Swal.fire({
                icon: "error",
                title: "Connection Error",
                text: `An error occurred: ${error.message}`,
              });
            }
          }, 10);
        }
      }
    });
  }

  private getTerrainHeightAt(
    x: number,
    z: number,
    groundGeometry?: THREE.PlaneGeometry,
    terrainMaxHeight?: number
  ): number {
    // Simple sine-based noise for rolling hills

    const y = Math.sin(x / 30) * Math.cos(z / 20) * terrainMaxHeight;

    return y;
  }

  private createProceduralWorld(): void {
    const terrainSize = 400;

    const terrainSegments = 20;

    const terrainMaxHeight = 10;

    this.world.terrainSize = terrainSize;

    this.world.proceduralWorldActive = true;

    const groundGeometry = new THREE.PlaneGeometry(
      terrainSize,

      terrainSize,

      terrainSegments,

      terrainSegments
    );

    groundGeometry.rotateX(-Math.PI / 2);

    const heights = [];

    const positionAttribute = groundGeometry.attributes.position;

    for (let i = 0; i < positionAttribute.count; i++) {
      const x = positionAttribute.getX(i);

      const z = positionAttribute.getZ(i);

      const y = this.getTerrainHeightAt(
        x,

        z,

        groundGeometry,

        terrainMaxHeight
      );

      positionAttribute.setY(i, y);

      heights.push(y);
    }

    this.world.terrainHeights = heights;

    this.world.groundPositionAttribute =
      positionAttribute as THREE.BufferAttribute;

    groundGeometry.computeVertexNormals();

    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x33691e,
    });

    const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);

    groundMesh.receiveShadow = true;

    this.world.sceneManager.graphicsWorld.add(groundMesh);

    const vertices = (
      groundGeometry.attributes.position as THREE.BufferAttribute
    ).array;

    const indices = (groundGeometry.index as THREE.BufferAttribute).array;

    const trimeshShape = new CANNON.Trimesh(vertices as any, indices as any);

    const groundBody = new CANNON.Body({
      mass: 0,

      material: this.world.physicsManager.trimeshMaterial,
    });

    groundBody.addShape(trimeshShape);

    this.world.physicsManager.physicsWorld.addBody(groundBody);

    this.world.grass = new Grass(
      this.world,

      terrainSize,

      terrainMaxHeight,

      terrainSegments
    );

    this.world.entityManager.add(this.world.grass);

    this.world.road = new Road(
      this.world,

      terrainSize,

      terrainSegments,

      groundGeometry,

      terrainMaxHeight
    );

    this.world.entityManager.add(this.world.road);

    const trees = new Trees(
      this.world,

      terrainSize,

      groundGeometry,

      terrainMaxHeight
    );

    trees.generateTrees();

    const villageGenerator = new VillageGenerator(
      this.world,

      this.world.entityManager,

      this.world.physicsManager,

      groundGeometry
    );

    villageGenerator.generateVillage(terrainMaxHeight);

    const wallGenerator = new WallGenerator(this.world);

    wallGenerator.generateWalls(terrainSize);

    const playerSpawnObject = new THREE.Object3D();

    playerSpawnObject.position.set(0, terrainMaxHeight + 10, 0);

    const playerSpawnPoint = new CharacterSpawnPoint(playerSpawnObject);

    playerSpawnPoint.spawn(
      this.world.loadingManager,

      this.world,

      (player: Character) => {
        player.setColor(new THREE.Color(0x0000ff));

        this.world.player = player;

        this.world.entityManager.add(player);

        this.world.scenarioManager.spawnEnemies(5);
      }
    );

    const carSpawnObject = new THREE.Object3D();

    carSpawnObject.position.set(10, terrainMaxHeight + 10, 0);

    const carSpawnPoint = new VehicleSpawnPoint(carSpawnObject);

    carSpawnPoint.type = "car";

    carSpawnPoint.spawn(this.world.loadingManager, this.world);
  }

  private loadScene(gltf: any): void {
    gltf.scene.traverse((child) => {
      this._processSceneChild(child);
    });

    const raycastResult = new CANNON.RaycastResult();
    this.world.physicsManager.physicsWorld.raycastClosest(
      new CANNON.Vec3(0, 100, 0),
      new CANNON.Vec3(0, -100, 0),
      {},
      raycastResult
    );

    let groundYOffset = 0;
    if (raycastResult.hasHit) {
      groundYOffset = raycastResult.hitPointWorld.y;
    }

    this.world.physicsManager.physicsWorld.bodies.forEach((body) => {
      if (body.mass === 0) {
        body.position.y -= groundYOffset;
      }
    });

    gltf.scene.position.y -= groundYOffset;

    this.world.sceneManager.graphicsWorld.add(gltf.scene);
  }

  private _processSceneChild(child: THREE.Object3D): void {
    if (child.hasOwnProperty("userData")) {
      if (child.type === "Mesh") {
        Utils.setupMeshProperties(child);
        this.world.sky.csm.setupMaterial(child.material);

        if (child.material.name === MATERIAL_NAME_OCEAN) {
          this.world.entityManager.registerUpdatable(
            new Ocean(child, this.world)
          );
        }
      }

      if (child.userData.hasOwnProperty("data")) {
        if (child.userData.data === USER_DATA_PHYSICS) {
          if (child.userData.hasOwnProperty("type")) {
            if (child.userData.type === USER_DATA_TYPE_BOX) {
              let phys = new BoxCollider({
                size: new THREE.Vector3(
                  child.scale.x,
                  child.scale.y,
                  child.scale.z
                ),
              });
              phys.body.position.copy(Utils.cannonVector(child.position));
              phys.body.quaternion.copy(Utils.cannonQuat(child.quaternion));
              phys.body.updateAABB();

              phys.body.shapes.forEach((shape) => {
                shape.collisionFilterMask = ~CollisionGroups.TrimeshColliders;
              });

              this.world.physicsManager.physicsWorld.addBody(phys.body);
            } else if (child.userData.type === USER_DATA_TYPE_TRIMESH) {
              let phys = new TrimeshCollider(child, {
                material: this.world.physicsManager.trimeshMaterial,
              });
              this.world.physicsManager.physicsWorld.addBody(phys.body);
            }

            child.visible = false;
          }
        }

        if (child.userData.data === USER_DATA_PATH) {
          this.world.paths.push(new Path(child));
        }

        if (child.userData.data === USER_DATA_SCENARIO) {
          this.world.scenarios.push(new Scenario(child, this.world));
        }
      }
    }
  }

  public isOutOfBounds(position: CANNON.Vec3): boolean {
    let insideX, insideZ;
    let belowSeaLevel;

    if (this.world.proceduralWorldActive) {
      const halfSize = this.world.terrainSize / 2;
      insideX = position.x > -halfSize && position.x < halfSize;
      insideZ = position.z > -halfSize && position.z < halfSize;
      belowSeaLevel = position.y < 0; // Procedural world ground is at y=0
    } else {
      // Original hardcoded values for GLTF world
      insideX = position.x > -211.882 && position.x < 211.882;
      insideZ = position.z > -169.098 && position.z < 153.232;
      belowSeaLevel = position.y < 14.989;
    }

    return !(insideX && insideZ) && belowSeaLevel;
  }

  public outOfBoundsRespawn(body: CANNON.Body, position?: CANNON.Vec3): void {
    let newPos = position || new CANNON.Vec3(0, 16, 0);
    let newQuat = new CANNON.Quaternion(0, 0, 0, 1);

    body.position.copy(newPos);
    body.interpolatedPosition.copy(newPos);
    body.quaternion.copy(newQuat);
    body.interpolatedQuaternion.copy(newQuat);
    body.velocity.setZero();
    body.angularVelocity.setZero();
  }
}
