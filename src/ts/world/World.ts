import * as CANNON from "cannon-es";
import { NetworkPlayer } from "~/characters/NetworkPlayer";

import * as _ from "lodash";
import Swal from "sweetalert2";
import * as THREE from "three";

import CannonDebugger from "cannon-es-debugger";
import { GUI } from "lil-gui";
import Stats from "stats.js";
import { Character } from "~/characters/Character";
import { CameraOperator } from "~/core/CameraOperator";
import * as Utils from "~/core/FunctionLibrary";
import { GameManager } from "~/core/GameManager";
import { EntityManager } from "~/core/EntityManager";
import { ScenarioManager } from "~/game/ScenarioManager";
import { InfoStack } from "~/core/InfoStack";
import { InputManager } from "~/core/InputManager";
import { LoadingManager } from "~/core/LoadingManager";
import { PhysicsManager } from "~/core/PhysicsManager";
import { SceneManager } from "~/core/SceneManager";
import { UIManager } from "~/core/UIManager";
import { CollisionGroups } from "~/enums/CollisionGroups";
import { EntityType } from "~/enums/EntityType"; // Added import for EntityType
import { IUpdatable } from "~/interfaces/IUpdatable";
import { IWorldEntity } from "~/interfaces/IWorldEntity";
import { BoxCollider } from "~/physics/colliders/BoxCollider";
import { TrimeshCollider } from "~/physics/colliders/TrimeshCollider";
import { Vehicle } from "~/vehicles/Vehicle";
import { CharacterSpawnPoint } from "~/world/CharacterSpawnPoint";
import { Cloud } from "~/world/Cloud";
import { Ocean } from "~/world/Ocean";
import { Path } from "~/world/Path";
import { Scenario } from "~/world/Scenario";
import { Sky } from "~/world/Sky";
import { Streetlight } from "~/world/Streetlight";
import { Trees } from "~/world/Trees";
import { VehicleSpawnPoint } from "~/world/VehicleSpawnPoint";
import { Grass } from "~/world/Grass";
import { Road } from "~/world/Road";

import { FollowTarget } from "~/characters/character_ai/FollowTarget";
import { WeatherManager } from "~/core/WeatherManager";
import { Tornado } from "~/world/Tornado";
import { AtomicExplosion } from "../core/AtomicExplosion";
import { InterstellarVortex } from "./InterstellarVortex";
import { Meteorite } from "./Meteorite";
import { Planet } from "./Planet";
import { PsychedelicParticles } from "./PsychedelicParticles";
import { UFO } from "./UFO";

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
  public proceduralWorldActive: boolean = false;
  public terrainSize: number;
  public stats: Stats;
  public sky: Sky;
  public grass: Grass;
  public road: Road;
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
  public updatables: IUpdatable[] = [];


  public sceneManager: SceneManager;
  public physicsManager: PhysicsManager;
  public gameManager: GameManager;
  public scenarioManager: ScenarioManager;

  public interstellarVortex: InterstellarVortex;
  public player: Character; // Reference to the local player character
  public networkPlayers: Map<string, NetworkPlayer> = new Map(); // Map to store other players by their socket ID
  public weatherManager: WeatherManager;
  public tornadoes: Tornado[] = [];
  public streetlights: Streetlight[] = [];

  private terrainHeights: number[] = [];
  private groundPositionAttribute: THREE.BufferAttribute;
  private terrainSegments: number; // New property for terrain segments

  public loadingManager: LoadingManager; // New property to store the loading manager
  private meteoriteInterval: any;
  private onSendMessage: (message: string) => void; // New property

  constructor(
    worldScenePath?: any,
    private onJoin?: (name: string) => void,
    onSendMessage?: (message: string) => void // New parameter
  ) {
    console.log("World constructor called.");
    this.onSendMessage = onSendMessage; // Store the callback
    console.log("Calling _initializeCoreManagers...");
    this._initializeCoreManagers();
    console.log("Calling _initializePhysicsSettings...");
    this.weatherManager = new WeatherManager(this);
    this._initializePhysicsSettings();
    console.log("Calling _initializeRenderLoop...");
    this._initializeRenderLoop();
    console.log("Calling _initializeStatsAndGUI...");
    this._initializeStatsAndGUI();
    this._initializeCannonDebugger(); // Call the new method here
    const axesHelper = new THREE.AxesHelper(10); // Visual aid for world origin
    this.sceneManager.graphicsWorld.add(axesHelper);
    this._initializeInputAndCamera();
    UIManager.createChatInput(); // Create chat input
    this._initializeChatInput(); // Initialize chat input event listeners
    this._initializeSkyAndClouds();
    this._initializePlanets();
    this._loadWorldScene(worldScenePath);

    this.render(this);

    // this.meteoriteInterval = setInterval(
    //   () => this.spawnMeteorShower(2, new THREE.Vector3(0, 200, 0)),
    //   2000
    // );

    this.interstellarVortex = new InterstellarVortex(
      this,
      new THREE.Vector3(0, 500, 0),
      2000
    );
    new PsychedelicParticles(this, 1000, this.interstellarVortex);
  }

  public sendMessage(message: string): void {
    if (this.onSendMessage) {
      this.onSendMessage(message); // Send message via the provided callback
    }
    // Display message in local player's speech bubble
    if (this.player && this.player.speechBubble) {
      this.player.speechBubble.show(message);
    }
  }

  public async addNetworkPlayer(id: string, playerData: any): Promise<void> {
    console.log(`Attempting to add network player with ID: ${id}`);
    try {
      // If a player with this ID already exists, remove it first to prevent duplicates
      if (this.networkPlayers.has(id)) {
        console.warn(
          `Network player with ID ${id} already exists. Removing old instance.`
        );
        this.removeNetworkPlayer(id);
      }

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

      this.entityManager.add(networkCharacter); // This calls networkCharacter.addToWorld(this)
      this.networkPlayers.set(id, networkCharacter); // Store the actual NetworkPlayer instance
      networkCharacter.createHealthBar(); // Create health bar for network players
      console.log(`Successfully added network player with ID: ${id}`);
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
    console.log(`Attempting to remove network player with ID: ${id}`);
    const networkCharacter = this.networkPlayers.get(id);
    if (networkCharacter) {
      // Remove from world.characters array
      _.remove(
        this.characters,
        (char) => (char as NetworkPlayer).socketId === id
      );
      this.entityManager.remove(networkCharacter); // This calls networkCharacter.removeFromWorld(this)
      this.networkPlayers.delete(id);
      console.log(`Successfully removed network player with ID: ${id}`);
    } else {
      console.warn(
        `Attempted to remove non-existent network player with ID: ${id}`
      );
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

  public startRain(): void {
    this.weatherManager.startRain();
  }

  public stopRain(): void {
    this.weatherManager.stopRain();
  }

  public startThunderstorm(): void {
    this.weatherManager.startThunderstorm();
  }

  public stopThunderstorm(): void {
    this.weatherManager.stopThunderstorm();
  }

  public spawnTornado(position?: THREE.Vector3): void {
    const spawnPosition = position || new THREE.Vector3(0, 50, 0); // Default position if none provided
    const tornado = new Tornado(this, spawnPosition);
    this.tornadoes.push(tornado);
    console.log("Tornado spawned at:", spawnPosition);
  }

  public removeTornado(tornado: Tornado): void {
    tornado.dispose();
    _.pull(this.tornadoes, tornado);
    console.log("Tornado removed.");
  }

  public removeLastTornado(): void {
    if (this.tornadoes.length > 0) {
      const lastTornado = this.tornadoes[this.tornadoes.length - 1];
      this.removeTornado(lastTornado);
    } else {
      console.warn("No tornadoes to remove.");
    }
  }

  /**
   * Returns the terrain height at a given (x, z) coordinate.
   * Interpolates from the generated terrain geometry.
   * @param x World X coordinate
   * @param z World Z coordinate
   * @returns Terrain height (Y coordinate)
   */
  public getTerrainHeightAt(x: number, z: number): number {
    if (
      !this.proceduralWorldActive ||
      !this.groundPositionAttribute ||
      !this.terrainHeights
    ) {
      return 0; // Fallback or error if not in procedural world or terrain data not available
    }

    const halfSize = this.terrainSize / 2;

    // Normalize world coordinates to terrain grid (0 to terrainSegments)
    // Map world X from [-halfSize, halfSize] to [0, terrainSize]
    // Map world Z from [-halfSize, halfSize] to [0, terrainSize]
    const mappedX = x + halfSize;
    const mappedZ = z + halfSize;

    // Convert to grid coordinates
    const gridX = Math.floor(
      (mappedX / this.terrainSize) * this.terrainSegments
    );
    const gridZ = Math.floor(
      (mappedZ / this.terrainSize) * this.terrainSegments
    );

    // Clamp to ensure we are within bounds
    const clampedGridX = THREE.MathUtils.clamp(gridX, 0, this.terrainSegments);
    const clampedGridZ = THREE.MathUtils.clamp(gridZ, 0, this.terrainSegments);

    // Calculate index in the 1D heights array
    // Assuming vertices are stored row by row (z-major or x-major depending on generation)
    // and the PlaneGeometry creates (segments + 1) vertices per side.
    const index = clampedGridZ * (this.terrainSegments + 1) + clampedGridX;

    // Direct lookup. For smoother results, bilinear interpolation across the 4 nearest grid points would be needed.
    return this.terrainHeights[index] || 0;
  }

  private _initializeChatInput(): void {
    document.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        const chatInput = UIManager.getChatInput();
        if (!chatInput) return;

        const chatContainer = document.getElementById("chat-input-container");
        if (chatContainer && chatContainer.classList.contains("expanded")) {
          // Chat input is visible, send message
          event.preventDefault();
          const message = chatInput.value.trim();
          if (message.length > 0) {
            this.sendMessage(message);
          }
          chatInput.value = "";
          UIManager.setChatInputExpanded(false); // Collapse the chat input
          this.inputManager.setPointerLock(true); // Re-enable game input
        } else {
          // Chat input is hidden, show it
          event.preventDefault();
          UIManager.setChatInputExpanded(true); // Expand the chat input
          this.inputManager.setPointerLock(false); // Disable game input
        }
      } else if (event.key === "Escape") {
        const chatContainer = document.getElementById("chat-input-container");
        if (chatContainer && chatContainer.classList.contains("expanded")) {
          event.preventDefault();
          UIManager.setChatInputExpanded(false); // Collapse the chat input
          this.inputManager.setPointerLock(true); // Re-enable game input
        }
      }
    });
  }

  /**
   * Initializes Cannon Debugger if Debug_Physics is true.
   */
  private _initializeCannonDebugger(): void {
    if (this.params.Debug_Physics) {
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
    this.entityManager = new EntityManager(this);

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
    const gui = this.createParamsGUI(this); // Pass 'this' (World instance) as scope and store the gui object

    // Scenario GUI folder initialization
    const scenarioGUIFolder = gui.addFolder("Scenarios");
    scenarioGUIFolder.open();

    this.scenarioManager = new ScenarioManager(this, scenarioGUIFolder); // Instantiate ScenarioManager here
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

  private _postLoadingSetup(worldScenePath?: any): void {
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
        return null;
      },
    }).then((result) => {
      if (result.isConfirmed) {
        UIManager.setUserInterfaceVisible(true);
        UIManager.setLoadingScreenVisible(false); // Hide loading screen after user joins

        // Load GLTF or create procedural world based on worldScenePath
        if (worldScenePath !== undefined) {
          this.loadingManager
            .loadGLTFPromise(worldScenePath)
            .then((gltf) => {
              this.loadScene(this.loadingManager, gltf);
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

        // Handle onJoin logic
        if (this.onJoin) {
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
          }, 10);
        }
      }
    });
  }

  /**
   * Handles loading the world scene, if a path is provided.
   * @param worldScenePath Optional path to the GLTF scene to load.
   */
  private _loadWorldScene(worldScenePath?: any): void {
    this.loadingManager = new LoadingManager(this); // Initialize loadingManager unconditionally

    this._postLoadingSetup(worldScenePath); // Call the new method
  }

  private createProceduralWorld(): void {
    console.log("createProceduralWorld called.");
    // Terrain dimensions
    const terrainSize = 300;
    const terrainSegments = 20; // Reduced for performance
    const terrainMaxHeight = 10;

    this.terrainSize = terrainSize;
    this.terrainSegments = terrainSegments; // Store terrainSegments
    this.proceduralWorldActive = true;

    // Create terrain geometry
    const groundGeometry = new THREE.PlaneGeometry(
      terrainSize,
      terrainSize,
      terrainSegments,
      terrainSegments
    );
    groundGeometry.rotateX(-Math.PI / 2);

    // Generate heightmap data using a simple noise function
    const heights = [];
    const positionAttribute = groundGeometry.attributes.position;
    for (let i = 0; i < positionAttribute.count; i++) {
      const x = positionAttribute.getX(i);
      const z = positionAttribute.getZ(i);
      // Simple sine-based noise for rolling hills
      const y = Math.sin(x / 30) * Math.cos(z / 20) * terrainMaxHeight;
      positionAttribute.setY(i, y);
      heights.push(y);
    }
    this.terrainHeights = heights; // Store for lookup
    this.groundPositionAttribute = positionAttribute as THREE.BufferAttribute; // Store for lookup
    groundGeometry.computeVertexNormals();

    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x33691e, // A grassy green color
    });
    const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.receiveShadow = true;
    this.sceneManager.graphicsWorld.add(groundMesh);

    // Create physics for the terrain using a Trimesh
    const vertices = (
      groundGeometry.attributes.position as THREE.BufferAttribute
    ).array;
    const indices = (groundGeometry.index as THREE.BufferAttribute).array;
    const trimeshShape = new CANNON.Trimesh(vertices as any, indices as any);
    const groundBody = new CANNON.Body({
      mass: 0,
      material: this.physicsManager.trimeshMaterial,
    });
    groundBody.addShape(trimeshShape);
    this.physicsManager.physicsWorld.addBody(groundBody);

    this.grass = new Grass(
      this,
      terrainSize,
      terrainMaxHeight,
      terrainSegments
    );
    this.entityManager.add(this.grass);

    this.road = new Road(this, terrainSize, terrainSegments);
    this.entityManager.add(this.road);

    // Create trees
    const trees = new Trees(this, terrainSize);
    trees.generateTrees();

    // Add Village

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

      const baseHeight = Math.sin(x / 30) * Math.cos(z / 20) * terrainMaxHeight;

      // House dimensions

      const houseWidth = THREE.MathUtils.randFloat(4, 7);

      const houseDepth = THREE.MathUtils.randFloat(4, 7);

      const houseHeight = THREE.MathUtils.randFloat(5, 8);

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

      this.sceneManager.graphicsWorld.add(houseBodyMesh);

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

      houseRoofMesh.castShadow = true;

      houseRoofMesh.receiveShadow = true;

      this.sceneManager.graphicsWorld.add(houseRoofMesh);

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

    // Add Streetlights around the village
    const streetlightCount = 6;
    for (let i = 0; i < streetlightCount; i++) {
      const angle = (i / streetlightCount) * Math.PI * 2;
      const radius = villageRadius + 15; // Place streetlights outside the village
      const x = villageCenter.x + Math.cos(angle) * radius;
      const z = villageCenter.z + Math.sin(angle) * radius;
      const y = Math.sin(x / 30) * Math.cos(z / 20) * terrainMaxHeight; // Get terrain height

      const streetlight = new Streetlight(this, new THREE.Vector3(x, y, z));
      this.streetlights.push(streetlight);
    }

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
    this.sceneManager.graphicsWorld.add(wallXP);

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
    this.sceneManager.graphicsWorld.add(wallXN);

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
    this.sceneManager.graphicsWorld.add(wallZP);

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
    this.sceneManager.graphicsWorld.add(wallZN);

    // Spawn player (using the existing raycast logic which will now work with the new terrain)
    const playerSpawnObject = new THREE.Object3D();
    playerSpawnObject.position.set(0, terrainMaxHeight + 10, 0); // Spawn high above the max height
    const playerSpawnPoint = new CharacterSpawnPoint(playerSpawnObject);
    playerSpawnPoint.spawn(this.loadingManager, this, (player: Character) => {
      player.setColor(new THREE.Color(0x0000ff));
      this.player = player;
      this.entityManager.add(player); // Add player through entity manager
      // Now that the player is spawned, spawn enemies
      this.scenarioManager.spawnEnemies(5); // Re-enable enemies
    });

    // Spawn vehicles
    const carSpawnObject = new THREE.Object3D();
    carSpawnObject.position.set(10, terrainMaxHeight + 10, 0);
    const carSpawnPoint = new VehicleSpawnPoint(carSpawnObject);
    carSpawnPoint.type = "car";
    carSpawnPoint.spawn(this.loadingManager, this);
  }

  // Update
  // Handles all logic updates.
  public update(timeStep: number, unscaledTimeStep: number): void {
    this.physicsManager.update(timeStep);
    this.gameManager.update(timeStep, unscaledTimeStep);
    this.weatherManager.update(timeStep);

    this.streetlights.forEach((light) => light.update(this.sky.timeOfDay));

    this.planets.forEach((planet) => {
      planet.update();
    });

    this.tornadoes.forEach((tornado) => {
      tornado.update(timeStep);
    });

    if (this.params.Debug_Physics) {
      this.cannonDebugRenderer.update();
    }

    // Spawn UFOs
    // if (Math.random() < 0.002) {
    //   this.spawnUFO();
    // }

    // Spawn Atomic Bombs
    // if (Math.random() < 0.001) {
    //   this.spawnAtomicBomb();
    // }
  }

  public isOutOfBounds(position: CANNON.Vec3): boolean {
    let insideX, insideZ;
    let belowSeaLevel;

    if (this.proceduralWorldActive) {
      const halfSize = this.terrainSize / 2;
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













  public loadScene(loadingManager: LoadingManager, gltf: any): void {
    gltf.scene.traverse((child) => {
      this._processSceneChild(child);
    });

    // Measure ground height at origin (0,0,0)
    const raycastResult = new CANNON.RaycastResult();
    this.physicsManager.physicsWorld.raycastClosest(
      new CANNON.Vec3(0, 100, 0),
      new CANNON.Vec3(0, -100, 0),
      {},
      raycastResult
    );

    let groundYOffset = 0;
    if (raycastResult.hasHit) {
      groundYOffset = raycastResult.hitPointWorld.y;
    }

    // Apply offset to all static physics bodies
    this.physicsManager.physicsWorld.bodies.forEach((body) => {
      if (body.mass === 0) {
        body.position.y -= groundYOffset;
      }
    });

    // Apply offset to visual scene
    gltf.scene.position.y -= groundYOffset;

    this.sceneManager.graphicsWorld.add(gltf.scene);

    // Launch default scenario - This is now handled after name input in _loadWorldScene
    // let defaultScenarioID: string;
    // for (const scenario of this.scenarios) {
    //   if (scenario.default) {
    //     defaultScenarioID = scenario.id;
    //     break;
    //   }
    // }
    // if (defaultScenarioID !== undefined) this.launchScenario(defaultScenarioID);
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
          this.entityManager.registerUpdatable(new Ocean(child, this));
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

  private createParamsGUI(scope: World): GUI {
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

    gui.close();

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
        this.cannonDebugRenderer = CannonDebugger(
          this.sceneManager.graphicsWorld,

          this.physicsManager.physicsWorld
        );
      } else {
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

    // Weather

    let weatherFolder = gui.addFolder("Weather");

    weatherFolder.add(this, "startRain").name("Start Rain");

    weatherFolder.add(this, "stopRain").name("Stop Rain");

    weatherFolder.add(this, "startThunderstorm").name("Start Thunderstorm");

    weatherFolder.add(this, "stopThunderstorm").name("Stop Thunderstorm");

    // Tornadoes

    let tornadoFolder = gui.addFolder("Tornadoes");

    tornadoFolder.add(this, "spawnTornado").name("Spawn Tornado");

    tornadoFolder.add(this, "removeLastTornado").name("Remove Last Tornado");

    return gui;
  }
}
