import { NetworkPlayer } from "~/characters/NetworkPlayer";
import * as CANNON from "cannon-es";

import * as _ from "lodash";
import Swal from "sweetalert2";
import * as THREE from "three";

import Stats from "stats.js";
import { GUI } from "lil-gui";
import { Character } from "~/characters/Character";
import { CameraOperator } from "~/core/CameraOperator";
import * as Utils from "~/core/FunctionLibrary";
import { InfoStack } from "~/core/InfoStack";
import { InputManager } from "~/core/InputManager";
import { LoadingManager } from "~/core/LoadingManager";
import { UIManager } from "~/core/UIManager";
import { CollisionGroups } from "~/enums/CollisionGroups";
import { EntityType } from "~/enums/EntityType"; // Added import for EntityType
import { IUpdatable } from "~/interfaces/IUpdatable";
import { IWorldEntity } from "~/interfaces/IWorldEntity";
import { BoxCollider } from "~/physics/colliders/BoxCollider";
import { TrimeshCollider } from "~/physics/colliders/TrimeshCollider";
import { Vehicle } from "~/vehicles/Vehicle";
import { Ocean } from "~/world/Ocean";
import { Path } from "~/world/Path";
import { Scenario } from "~/world/Scenario";
import { CharacterSpawnPoint } from "~/world/CharacterSpawnPoint";
import { Sky } from "~/world/Sky";
import { Cloud } from "~/world/Cloud";
import { SceneManager } from "~/core/SceneManager";
import { PhysicsManager } from "~/core/PhysicsManager";
import { GameManager } from "~/core/GameManager";
import CannonDebugger from "cannon-es-debugger";

import { FollowTarget } from "~/characters/character_ai/FollowTarget";
import { RandomBehaviour } from "~/characters/character_ai/RandomBehaviour";
import { Planet } from "./Planet";
import { Meteorite } from "./Meteorite";
import { PsychedelicParticles } from "./PsychedelicParticles";
import { InterstellarVortex } from "./InterstellarVortex";
import { UFO } from "./UFO";
import { Explosion } from "../core/Explosion";
import { AtomicExplosion } from "../core/AtomicExplosion";

// Constants for cloud generation
const CLOUD_BANK_COUNT = 4;
const CLOUDS_PER_BANK = 10;
const CLOUD_BANK_SPREAD_X = 1500;
const CLOUD_BANK_SPREAD_Z = 1500;
const CLOUD_BANK_BASE_Y = 100;
const CLOUD_BANK_RANDOM_Y = 100;
const CLOUD_POSITION_RANDOM_X = 500;
const CLOUD_POSITION_RANDOM_Y = 50;
const CLOUD_POSITION_RANDOM_Z = 500;
const CLOUD_SIZE_BASE = 100;
const CLOUD_SIZE_RANDOM = 100;
const CLOUD_OPACITY_BASE = 0.5;
const CLOUD_OPACITY_RANDOM = 0.5;

// Constants for planet generation
const PLANET_COUNT = 3;
const PLANET_SIZE_BASE = 50;
const PLANET_SIZE_RANDOM = 50;
const PLANET_POSITION_RANDOM_X = 1500;
const PLANET_POSITION_BASE_Y = 200;
const PLANET_POSITION_RANDOM_Y = 200;
const PLANET_POSITION_RANDOM_Z = 1500;

// Constants for GLTF userData
const USER_DATA_PHYSICS = "physics";
const USER_DATA_TYPE_BOX = "box";
const USER_DATA_TYPE_TRIMESH = "trimesh";
const USER_DATA_PATH = "path";
const USER_DATA_SCENARIO = "scenario";
const MATERIAL_NAME_OCEAN = "ocean";

export class World {
  public stats: Stats;
  public sky: Sky;
  public clouds: Cloud[] = [];
  public planets: Planet[] = [];
  public parallelPairs: any[];
  public physicsFrameRate: number;
  public physicsFrameTime: number;
  public physicsMaxPrediction: number;
  public clock: THREE.Clock;
  public renderDelta: number;
  public logicDelta: number;
  public requestDelta: number;
  public sinceLastFrame: number;
  public justRendered: boolean;
  public params: any;
  public inputManager: InputManager;
  public cameraOperator: CameraOperator;
  public timeScaleTarget: number = 1;
  public console: InfoStack;
  public cannonDebugRenderer: any;
  public scenarios: Scenario[] = [];
  public characters: Character[] = [];
  public vehicles: Vehicle[] = [];
  public paths: Path[] = [];
  public scenarioGUIFolder: any;
  public updatables: IUpdatable[] = [];
  public sceneManager: SceneManager;
  public physicsManager: PhysicsManager;
  public gameManager: GameManager;
  public interstellarVortex: InterstellarVortex;
  public player: Character; // Reference to the local player character
  public networkPlayers: Map<string, NetworkPlayer> = new Map(); // Map to store other players by their socket ID

  private lastScenarioID: string;
  private initialEnemyCount: number = 0; // New property to store the initial count of enemies in a wave
  private currentEnemyCount: number = 0; // New property to track active enemies
  public loadingManager: LoadingManager; // New property to store the loading manager
  private meteoriteInterval: any;

  constructor(
    worldScenePath?: any,
    private onJoin?: (name: string) => void
  ) {
    this._initializeCoreManagers();
    this._initializePhysicsSettings();
    this._initializeRenderLoop();
    this._initializeStatsAndGUI();
    this._initializeCannonDebugger(); // Call the new method here
    this._initializeInputAndCamera();
    this._initializeSkyAndClouds();
    this._initializePlanets();
    this._loadWorldScene(worldScenePath);

    this.render(this);

    this.meteoriteInterval = setInterval(
      () => this.spawnMeteorShower(2, new THREE.Vector3(0, 200, 0)),
      2000
    );

    this.interstellarVortex = new InterstellarVortex(
      this,
      new THREE.Vector3(0, 500, 0),
      2000
    );
    new PsychedelicParticles(this, 1000, this.interstellarVortex);
  }

  public async addNetworkPlayer(id: string, playerData: any): Promise<void> {
    console.log(`World: Attempting to add network player ${id} with data:`, playerData);

    try {
      // Load the character model for the network player
      const gltf = await this.loadingManager.loadGLTFPromise("boxman.glb");

      const networkCharacter = new NetworkPlayer(gltf, this, id, playerData);

      networkCharacter.position.set(
        playerData.position_x,
        playerData.position_y,
        playerData.position_z
      );
      networkCharacter.quaternion.set(
        playerData.quaternion_x,
        playerData.quaternion_y,
        playerData.quaternion_z,
        playerData.quaternion_w
      );

      // Also initialize target state
      networkCharacter.targetPosition.copy(networkCharacter.position);
      networkCharacter.targetQuaternion.copy(networkCharacter.quaternion);

      this.add(networkCharacter); // This calls networkCharacter.addToWorld(this)
      this.networkPlayers.set(id, networkCharacter); // Store the actual NetworkPlayer instance

      console.log(`NetworkPlayer ${id} (${playerData.name}) added to world.`);
    } catch (error) {
      console.error(`Failed to add network player ${id}:`, error);
    }
  }

  public updateNetworkPlayer(id: string, playerData: any): void {
    const networkCharacter = this.networkPlayers.get(id);
    if (networkCharacter) {
      networkCharacter.updateState(playerData);
    }
  }

  public removeNetworkPlayer(id: string): void {
    const networkCharacter = this.networkPlayers.get(id);
    if (networkCharacter) {
      console.log(`World: Removing network player ${id}`);
      this.remove(networkCharacter); // This calls networkCharacter.removeFromWorld(this)
      this.networkPlayers.delete(id);
    }
  }

  public spawnMeteorShower(
    showerSize: number,
    basePosition: THREE.Vector3
  ): void {
    for (let i = 0; i < showerSize; i++) {
      const position = basePosition.clone();
      position.x += (Math.random() - 0.5) * 150;
      position.z += (Math.random() - 0.5) * 150;

      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 100,
        -100,
        (Math.random() - 0.5) * 100
      );
      new Meteorite(this, position, velocity);
    }
  }

  public spawnAtomicBomb(): void {
    const position = new THREE.Vector3(
      (Math.random() - 0.5) * 8000, // Farther away
      0, // On the ground
      (Math.random() - 0.5) * 8000
    );
    new AtomicExplosion(this, position);
  }

  public spawnUFO(): void {
    const position = new THREE.Vector3(
      (Math.random() - 0.5) * 1000,
      150 + Math.random() * 100, // High in the sky
      (Math.random() - 0.5) * 1000
    );
    new UFO(this, position);
  }

  /**
   * Initializes Cannon Debugger if Debug_Physics is true.
   */
  private _initializeCannonDebugger(): void {
    if (this.params.Debug_Physics) {
      console.log("Cannon Debugger: Enabling on startup");
      this.cannonDebugRenderer = CannonDebugger(
        this.sceneManager.graphicsWorld,
        this.physicsManager.physicsWorld
      );
    }
  }

  /**
   * Initializes core managers (Scene, Physics, Game) and generates initial HTML.
   */
  private _initializeCoreManagers(): void {
    this.sceneManager = new SceneManager(this);
    this.physicsManager = new PhysicsManager(this);
    this.gameManager = new GameManager(this);
    this.generateHTML();
  }

  /**
   * Sets up physics-related parameters.
   */
  private _initializePhysicsSettings(): void {
    this.parallelPairs = [];
    this.physicsFrameRate = 60;
    this.physicsFrameTime = 1 / this.physicsFrameRate;
    this.physicsMaxPrediction = this.physicsFrameRate;
  }

  /**
   * Initializes render loop related properties.
   */
  private _initializeRenderLoop(): void {
    this.clock = new THREE.Clock();
    this.renderDelta = 0;
    this.logicDelta = 0;
    this.sinceLastFrame = 0;
    this.justRendered = false;
  }

  /**
   * Initializes performance stats and the GUI.
   */
  private _initializeStatsAndGUI(): void {
    this.stats = new Stats();
    this.stats.dom.id = "stats";
    document.getElementById("ui-container").appendChild(this.stats.dom);
    this.createParamsGUI(this); // Pass 'this' (World instance) as scope
  }

  /**
   * Initializes input management and camera operation.
   */
  private _initializeInputAndCamera(): void {
    this.inputManager = new InputManager(
      this,
      this.sceneManager.renderer.domElement
    );
    this.cameraOperator = new CameraOperator(
      this,
      this.sceneManager.camera,
      this.params.Mouse_Sensitivity
    );
  }

  /**
   * Initializes the sky and creates cloud banks.
   */
  private _initializeSkyAndClouds(): void {
    this.sky = new Sky(this);

    // Create multiple cloud banks
    for (let i = 0; i < CLOUD_BANK_COUNT; i++) {
      const bankCenter = new THREE.Vector3(
        (Math.random() - 0.5) * CLOUD_BANK_SPREAD_X,
        CLOUD_BANK_BASE_Y + (Math.random() - 0.5) * CLOUD_BANK_RANDOM_Y,
        (Math.random() - 0.5) * CLOUD_BANK_SPREAD_Z
      );

      for (let j = 0; j < CLOUDS_PER_BANK; j++) {
        const cloud = new Cloud(
          this,
          CLOUD_SIZE_BASE + Math.random() * CLOUD_SIZE_RANDOM,
          CLOUD_OPACITY_BASE + Math.random() * CLOUD_OPACITY_RANDOM
        );
        cloud.group.position.set(
          bankCenter.x + (Math.random() - 0.5) * CLOUD_POSITION_RANDOM_X,
          bankCenter.y + (Math.random() - 0.5) * CLOUD_POSITION_RANDOM_Y,
          bankCenter.z + (Math.random() - 0.5) * CLOUD_POSITION_RANDOM_Z
        );
        this.clouds.push(cloud);
      }
    }
  }

  /**
   * Creates and positions planets in the world.
   */
  private _initializePlanets(): void {
    for (let i = 0; i < PLANET_COUNT; i++) {
      const color = new THREE.Color(
        Math.random(),
        Math.random(),
        Math.random()
      );
      const size = PLANET_SIZE_BASE + Math.random() * PLANET_SIZE_RANDOM;
      const planet = new Planet(this, this.physicsManager, color, size);
      planet.setPosition(
        (Math.random() - 0.5) * PLANET_POSITION_RANDOM_X,
        PLANET_POSITION_BASE_Y + Math.random() * PLANET_POSITION_RANDOM_Y,
        (Math.random() - 0.5) * PLANET_POSITION_RANDOM_Z
      );
      planet.mesh.renderOrder = -1; // Render planets behind clouds
      this.planets.push(planet);
    }
  }

  /**
   * Handles loading the world scene, if a path is provided.
   * @param worldScenePath Optional path to the GLTF scene to load.
   */
  private _loadWorldScene(worldScenePath?: any): void {
    this.loadingManager = new LoadingManager(this); // Initialize loadingManager unconditionally

    if (worldScenePath !== undefined) {
      this.loadingManager.onFinishedCallback = () => {
        this.update(1, 1);
        this.setTimeScale(1);

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
            return null; // Explicitly return null on successful validation
          },
        }).then((result) => {
          if (result.isConfirmed) {
            UIManager.setUserInterfaceVisible(true);
            this.updateEnemyCountDisplay();
            if (this.onJoin) {
              // Decouple the socket connection from the modal's promise chain
              setTimeout(() => {
                try {
                  this.onJoin(result.value);
                } catch (error) {
                  console.error("Error initiating socket connection:", error);
                  Swal.fire({
                    icon: "error",
                    title: "Connection Error",
                    text: `An error occurred: ${error.message}`,
                  });
                }
              }, 10); // Use a small delay
            }
          }
        });
      };
      this.loadingManager
        .loadGLTFPromise(worldScenePath)
        .then((gltf) => {
          this.loadScene(this.loadingManager, gltf);
          // Call launchScenario with the provided callback
          let defaultScenarioID: string;
          for (const scenario of this.scenarios) {
            if (scenario.default) {
              defaultScenarioID = scenario.id;
              break;
            }
          }
          if (defaultScenarioID !== undefined)
            this.launchScenario(defaultScenarioID);
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
      UIManager.setUserInterfaceVisible(true);
      UIManager.setLoadingScreenVisible(false);
      Swal.fire({
        icon: "success",
        title: "Hello world!",
        buttonsStyling: false,
      });
      this.updateEnemyCountDisplay(); // Update counter after UI is visible
    }
  }

  // Update
  // Handles all logic updates.
  public update(timeStep: number, unscaledTimeStep: number): void {
    this.physicsManager.update(timeStep);
    this.gameManager.update(timeStep, unscaledTimeStep);

    this.planets.forEach((planet) => {
      planet.update();
    });

    if (this.params.Debug_Physics) {
      console.log("Cannon Debugger: Updating");
      this.cannonDebugRenderer.update();
    }

    // Spawn UFOs
    if (Math.random() < 0.002) {
      this.spawnUFO();
    }

    // Spawn Atomic Bombs
    // if (Math.random() < 0.001) {
    //   this.spawnAtomicBomb();
    // }
  }

  public isOutOfBounds(position: CANNON.Vec3): boolean {
    let inside =
      position.x > -211.882 &&
      position.x < 211.882 &&
      position.z > -169.098 &&
      position.z < 153.232 &&
      position.y > 0.107;
    let belowSeaLevel = position.y < 14.989;

    return !inside && belowSeaLevel;
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

  /**
   * Rendering loop.
   * Implements fps limiter and frame-skipping
   * Calls world's "update" function before rendering.
   * @param {World} world
   */
  public render(world: World): void {
    this.requestDelta = this.clock.getDelta();

    requestAnimationFrame(() => {
      world.render(world);
    });

    // Getting timeStep
    let unscaledTimeStep =
      this.requestDelta + this.renderDelta + this.logicDelta;
    let timeStep = unscaledTimeStep * this.params.Time_Scale;
    timeStep = Math.min(timeStep, 1 / 30); // min 30 fps

    // Logic
    world.update(timeStep, unscaledTimeStep);

    // Measuring logic time
    this.logicDelta = this.clock.getDelta();

    // Frame limiting
    let interval = 1 / 60;
    this.sinceLastFrame +=
      this.requestDelta + this.renderDelta + this.logicDelta;
    this.sinceLastFrame %= interval;

    // Stats end
    this.stats.end();
    this.stats.begin();

    // Actual rendering with a FXAA ON/OFF switch
    this.sceneManager.render();

    // Measuring render time
    this.renderDelta = this.clock.getDelta();
  }

  public setTimeScale(value: number): void {
    this.params.Time_Scale = value;
    this.timeScaleTarget = value;
  }

  public add(worldEntity: IWorldEntity): void {
    worldEntity.addToWorld(this);
    this.registerUpdatable(worldEntity);
  }

  public registerUpdatable(registree: IUpdatable): void {
    this.updatables.push(registree);
    this.updatables.sort((a, b) => (a.updateOrder > b.updateOrder ? 1 : -1));
  }

  public remove(worldEntity: IWorldEntity): void {
    // Special handling for local player death
    if (worldEntity === this.player) {
      document.exitPointerLock();
      this.player = undefined;

      // Immediately remove player from the world
      this.performRemoval(worldEntity);

      // Then, show respawn modal
      Swal.fire({
        title: "You Died",
        text: "You can rejoin the game.",
        confirmButtonText: "Respawn",
        buttonsStyling: false,
        allowOutsideClick: false,
        allowEscapeKey: false,
      }).then(() => {
        this.restartScenario();
      });

      // Stop further execution for local player death
      return;
    }

    this.performRemoval(worldEntity);
  }

  private performRemoval(worldEntity: IWorldEntity): void {
    console.log("Performing removal for entity:", (worldEntity as any).uuid);

    // Check if the removed entity is an enemy character
    if (worldEntity instanceof Character) {
      if (worldEntity.entityType === EntityType.Enemy) {
        this.currentEnemyCount--;
        this.updateEnemyCountDisplay(); // Update UI using helper method
        if (this.currentEnemyCount <= 0) {
          this.spawnEnemies(this.initialEnemyCount * 2);
        }
      }

      if (this.inputManager.inputReceiver === worldEntity) {
        this.inputManager.inputReceiver = undefined;
      }

      _.pull(this.characters, worldEntity as Character);

      if (
        (worldEntity as Character).characterCapsule &&
        (worldEntity as Character).characterCapsule.body
      ) {
        (
          worldEntity as Character
        ).characterCapsule.body.collisionResponse = false;
        (worldEntity as Character).characterCapsule.body.mass = 0;
        (worldEntity as Character).characterCapsule.body.sleep();
        this.physicsManager.bodiesToRemove.push(
          (worldEntity as Character).characterCapsule.body
        );
      }

      this.sceneManager.graphicsWorld.remove(worldEntity as Character);
      console.log(
        `Entity ${(worldEntity as any).uuid} removed from scene graph.`
      );
      if ((worldEntity as Character).raycastBox) {
        this.sceneManager.graphicsWorld.remove(
          (worldEntity as Character).raycastBox
        );
      }
      if (
        (worldEntity as Character).healthBarContainer &&
        (worldEntity as Character).healthBarContainer.parent
      ) {
        (worldEntity as Character).healthBarContainer.parent.remove(
          (worldEntity as Character).healthBarContainer
        );
      }
    } else if (worldEntity instanceof Vehicle) {
      worldEntity.removeFromWorld(this);
    } else {
      console.log("Entity is not a Character. Type:", typeof worldEntity);
    }

    this.unregisterUpdatable(worldEntity);
  }

  public unregisterUpdatable(registree: IUpdatable): void {
    _.pull(this.updatables, registree);
  }

  public loadScene(loadingManager: LoadingManager, gltf: any): void {
    gltf.scene.traverse((child) => {
      this._processSceneChild(child);
    });

    this.sceneManager.graphicsWorld.add(gltf.scene);

    // Launch default scenario
    let defaultScenarioID: string;
    for (const scenario of this.scenarios) {
      if (scenario.default) {
        defaultScenarioID = scenario.id;
        break;
      }
    }
    if (defaultScenarioID !== undefined) this.launchScenario(defaultScenarioID);
  }

  /**
   * Processes a single child object from the loaded GLTF scene.
   * @param child The THREE.Object3D child to process.
   */
  private _processSceneChild(child: THREE.Object3D): void {
    if (child.hasOwnProperty("userData")) {
      if (child.type === "Mesh") {
        Utils.setupMeshProperties(child);
        this.sky.csm.setupMaterial(child.material);

        if (child.material.name === MATERIAL_NAME_OCEAN) {
          this.registerUpdatable(new Ocean(child, this));
        }
      }

      if (child.userData.hasOwnProperty("data")) {
        if (child.userData.data === USER_DATA_PHYSICS) {
          if (child.userData.hasOwnProperty("type")) {
            // Convex doesn't work! Stick to boxes!
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

              this.physicsManager.physicsWorld.addBody(phys.body);
            } else if (child.userData.type === USER_DATA_TYPE_TRIMESH) {
              let phys = new TrimeshCollider(child, {
                material: this.physicsManager.trimeshMaterial, // Assign trimesh material
              });
              this.physicsManager.physicsWorld.addBody(phys.body);
            }

            child.visible = false;
          }
        }

        if (child.userData.data === USER_DATA_PATH) {
          this.paths.push(new Path(child));
        }

        if (child.userData.data === USER_DATA_SCENARIO) {
          this.scenarios.push(new Scenario(child, this));
        }
      }
    }
  }

  public launchScenario(scenarioID: string): void {
    this.lastScenarioID = scenarioID;

    this.clearEntities();
    this.updateEnemyCountDisplay(); // Initialize enemy count display

    // Launch default scenario
    for (const scenario of this.scenarios) {
      if (scenario.id === scenarioID || scenario.spawnAlways) {
        // If it's the default scenario, use hard-coded spawn points for variety
        if (scenario.default) {
          const customSpawnPointsData = [
            { position: new THREE.Vector3(0, 10, 0) },
            { position: new THREE.Vector3(50, 10, 20) },
            { position: new THREE.Vector3(-30, 10, -40) },
            { position: new THREE.Vector3(20, 10, 60) },
            { position: new THREE.Vector3(-60, 10, 10) },
          ];

          const spawnPoints = customSpawnPointsData.map((sp) => {
            const object = new THREE.Object3D();
            object.position.copy(sp.position);
            return new CharacterSpawnPoint(object);
          });

          const randomSpawnPoint =
            spawnPoints[Math.floor(Math.random() * spawnPoints.length)];

          randomSpawnPoint.spawn(
            this.loadingManager,
            this,
            (player: Character) => {
              player.setColor(new THREE.Color(0x0000ff)); // Set main character color to blue
              this.player = player; // Assign the local player
              this.spawnEnemies(5);
            }
          );
        } else {
          // For other scenarios, use the spawn points from the GLTF file
          const playerSpawnPoints: CharacterSpawnPoint[] = [];
          scenario.spawnPoints.forEach((sp) => {
            if (sp instanceof CharacterSpawnPoint) {
              playerSpawnPoints.push(sp);
            }
          });

          if (playerSpawnPoints.length > 0) {
            const randomSpawnPoint =
              playerSpawnPoints[
                Math.floor(Math.random() * playerSpawnPoints.length)
              ];
            randomSpawnPoint.spawn(
              this.loadingManager,
              this,
              (player: Character) => {
                player.setColor(new THREE.Color(0x0000ff));
                this.player = player;
                this.spawnEnemies(5);
              }
            );
          } else {
            scenario.launch(this.loadingManager, this);
          }
        }
      }
    }
  }

  public restartScenario(): void {
    if (this.lastScenarioID !== undefined) {
      document.exitPointerLock();
      this.launchScenario(this.lastScenarioID);
    } else {
      console.warn("Can't restart scenario. Last scenarioID is undefined.");
    }
  }

  public clearEntities(): void {
    const networkPlayers: NetworkPlayer[] = [];
    for (const character of this.characters) {
      if (character instanceof NetworkPlayer) {
        networkPlayers.push(character);
      } else {
        this.unregisterUpdatable(character);
        if (character.characterCapsule?.body) {
          this.physicsManager.bodiesToRemove.push(
            character.characterCapsule.body
          );
        }
        this.sceneManager.graphicsWorld.remove(character);
        if (this.inputManager.inputReceiver === character) {
          this.inputManager.inputReceiver = undefined;
        }
      }
    }
    this.characters = networkPlayers;

    for (const vehicle of this.vehicles) {
      this.remove(vehicle);
    }
    this.vehicles = [];
  }

  public scrollTheTimeScale(scrollAmount: number): void {
    // Changing time scale with scroll wheel
    const timeScaleBottomLimit = 0.003;
    const timeScaleChangeSpeed = 1.3;

    if (scrollAmount > 0) {
      this.timeScaleTarget /= timeScaleChangeSpeed;
      if (this.timeScaleTarget < timeScaleBottomLimit) this.timeScaleTarget = 0;
    } else {
      this.timeScaleTarget *= timeScaleChangeSpeed;
      if (this.timeScaleTarget < timeScaleBottomLimit)
        this.timeScaleTarget = timeScaleBottomLimit;
      this.timeScaleTarget = Math.min(this.timeScaleTarget, 1);
    }
  }

  public updateControls(controls: any): void {
    let html = "";
    html += '<h2 class="controls-title">Controls:</h2>';

    controls.forEach((row) => {
      html += '<div class="ctrl-row">';
      row.keys.forEach((key) => {
        if (key === "+" || key === "and" || key === "or" || key === "&")
          html += "&nbsp;" + key + "&nbsp;";
        else html += '<span class="ctrl-key">' + key + "</span>";
      });

      html += '<span class="ctrl-desc">' + row.desc + "</span></div>";
    });

    document.getElementById("controls").innerHTML = html;
  }

  private updateEnemyCountDisplay(): void {
    let enemyCountElement = document.getElementById("dynamic-enemy-count");

    if (!enemyCountElement) {
      console.log("Creating dynamic enemy count element.");
      enemyCountElement = document.createElement("div");
      enemyCountElement.id = "dynamic-enemy-count";
      enemyCountElement.style.position = "absolute";
      enemyCountElement.style.top = "10px";
      enemyCountElement.style.left = "10px";
      enemyCountElement.style.color = "white";
      enemyCountElement.style.fontSize = "24px";
      enemyCountElement.style.zIndex = "100000";
      enemyCountElement.style.backgroundColor = "rgba(0,0,0,0.5)";
      enemyCountElement.style.padding = "5px";
      enemyCountElement.style.borderRadius = "5px";

      const uiContainer = document.getElementById("ui-container");
      if (uiContainer) {
        uiContainer.appendChild(enemyCountElement);
        console.log("Dynamic enemy count element appended to ui-container.");
      } else {
        console.warn(
          "UI container not found, cannot append dynamic enemy count element."
        );
        return;
      }
    }

    if (enemyCountElement) {
      enemyCountElement.innerHTML = `Enemies: ${this.currentEnemyCount}`;
    }
  }

  public spawnEnemies(count: number): void {
    this.initialEnemyCount = count; // Update initial count for the new wave
    this.currentEnemyCount = count; // Reset current count
    this.updateEnemyCountDisplay(); // Update UI using helper method

    for (let i = 0; i < count; i++) {
      this.loadingManager.loadGLTFPromise("boxman.glb")
        .then((model) => {
          let character = new Character(model);
          character.name = `Enemy ${i}`; // Assign a name for debugging
          character.entityType = EntityType.Enemy; // Assign Enemy EntityType
          character.setBehaviour(new FollowTarget(this.characters[0])); // this.characters[0] is the player
          character.setColor(new THREE.Color(0xff0000)); // Set enemy character color to red
          character.createHealthBar(); // Create health bar for enemies

          // Get a random spawn position
          const x = Math.random() * 200 - 100;
          const z = Math.random() * 100 - 50;
          character.setPosition(x, 20, z);

          this.add(character);
        })
        .catch((error) => {
          console.error("Error loading enemy character model:", error);
        });
    }
  }

  private generateHTML(): void {
    // Fonts
    const fontLink1 = document.createElement("link");
    fontLink1.href =
      "https://fonts.googleapis.com/css2?family=Alfa+Slab+One&display=swap";
    fontLink1.rel = "stylesheet";
    document.head.appendChild(fontLink1);

    const fontLink2 = document.createElement("link");
    fontLink2.href =
      "https://fonts.googleapis.com/css2?family=Solway:wght@400;500;700&display=swap";
    fontLink2.rel = "stylesheet";
    document.head.appendChild(fontLink2);

    const fontLink3 = document.createElement("link");
    fontLink3.href =
      "https://fonts.googleapis.com/css2?family=Cutive+Mono&display=swap";
    fontLink3.rel = "stylesheet";
    document.head.appendChild(fontLink3);

    // Loader
    const loadingScreenDiv = document.createElement("div");
    loadingScreenDiv.id = "loading-screen";
    loadingScreenDiv.innerHTML = `
      <div id="loading-screen-background"></div>
      <h1 id="main-title" class="sb-font">Sketchbook 0.4</h1>
      <div class="cubeWrap">
        <div class="cube">
          <div class="faces1"></div>
          <div class="faces2"></div>     
        </div> 
      </div> 
      <div id="loading-text">Loading...</div>
    `;
    document.body.appendChild(loadingScreenDiv);

    // UI
    const uiContainerDiv = document.createElement("div");
    uiContainerDiv.id = "ui-container";
    uiContainerDiv.style.display = "none";
    uiContainerDiv.innerHTML = `
      <div class="github-corner">
        <a href="https://github.com/swift502/Sketchbook" target="_blank" title="Fork me on GitHub">
          <svg viewbox="0 0 100 100" fill="currentColor">
            <title>Fork me on GitHub</title>
            <path d="M0 0v100h100V0H0zm60 70.2h.2c1 2.7.3 4.7 0 5.2 1.4 1.4 2 3 2 5.2 0 7.4-4.4 9-8.7 9.5.7.7 1.3 2
            1.3 3.7V99c0 .5 1.4 1 1.4 1H44s1.2-.5 1.2-1v-3.8c-3.5 1.4-5.2-.8-5.2-.8-1.5-2-3-2-3-2-2-.5-.2-1-.2-1
            2-.7 3.5.8 3.5.8 2 1.7 4 1 5 .3.2-1.2.7-2 1.2-2.4-4.3-.4-8.8-2-8.8-9.4 0-2 .7-4 2-5.2-.2-.5-1-2.5.2-5
            0 0 1.5-.6 5.2 1.8 1.5-.4 3.2-.6 4.8-.6 1.6 0 3.3.2 4.8.7 2.8-2 4.4-2 5-2z"></path>
          </svg>
        </a>
      </div>
      <div class="left-panel">
        <div id="controls" class="panel-segment flex-bottom"></div>
      </div>
    `;
    document.body.appendChild(uiContainerDiv);
  }

  private createParamsGUI(scope: World): void {
    this.params = {
      Pointer_Lock: true,
      Mouse_Sensitivity: 0.3,
      Time_Scale: 1,
      Shadows: true,
      FXAA: true,
      Debug_Physics: false,
      Debug_FPS: false,
      Sun_Elevation: 50,
      Sun_Rotation: 145,
    };

    const gui = new GUI();

    // Scenario
    this.scenarioGUIFolder = gui.addFolder("Scenarios");
    this.scenarioGUIFolder.open();

    // World
    let worldFolder = gui.addFolder("World");
    worldFolder
      .add(this.params, "Time_Scale", 0, 1)
      .listen()
      .onChange((value) => {
        scope.timeScaleTarget = value;
      });
    worldFolder
      .add(this.params, "Sun_Elevation", 0, 180)
      .listen()
      .onChange((value) => {
        scope.sky.phi = value;
      });
    worldFolder
      .add(this.params, "Sun_Rotation", 0, 360)
      .listen()
      .onChange((value) => {
        scope.sky.theta = value;
      });

    // Input
    let settingsFolder = gui.addFolder("Settings");
    settingsFolder.add(this.params, "FXAA");
    settingsFolder.add(this.params, "Shadows").onChange((enabled) => {
      if (enabled) {
        this.sky.csm.lights.forEach((light) => {
          light.castShadow = true;
        });
      } else {
        this.sky.csm.lights.forEach((light) => {
          light.castShadow = false;
        });
      }
    });
    settingsFolder.add(this.params, "Pointer_Lock").onChange((enabled) => {
      scope.inputManager.setPointerLock(enabled);
    });
    settingsFolder
      .add(this.params, "Mouse_Sensitivity", 0, 1)
      .onChange((value) => {
        scope.cameraOperator.setSensitivity(value, value * 0.8);
      });
    settingsFolder.add(this.params, "Debug_Physics").onChange((enabled) => {
      if (enabled) {
        console.log("Cannon Debugger: Enabling");
        this.cannonDebugRenderer = CannonDebugger(
          this.sceneManager.graphicsWorld,
          this.physicsManager.physicsWorld
        );
      } else {
        console.log("Cannon Debugger: Disabling");
        this.cannonDebugRenderer.destroy();
        this.cannonDebugRenderer = undefined;
      }

      scope.characters.forEach((char) => {
        char.raycastBox.visible = enabled;
      });
    });
    settingsFolder.add(this.params, "Debug_FPS").onChange((enabled) => {
      UIManager.setFPSVisible(enabled);
    });

    gui.open();
  }
}
