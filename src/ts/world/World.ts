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
import { VehicleSpawnPoint } from "./VehicleSpawnPoint"; // Added import
import { LoadingTrackerEntry } from "~/core/LoadingTrackerEntry";

import { FollowTarget } from "~/characters/character_ai/FollowTarget";
import { RandomBehaviour } from "~/characters/character_ai/RandomBehaviour";
import { Planet } from "./Planet";
import { Meteorite } from "./Meteorite";
import { PsychedelicParticles } from "./PsychedelicParticles";
import { InterstellarVortex } from "./InterstellarVortex";
import { UFO } from "./UFO";
import { Explosion } from "../core/Explosion";
import { AtomicExplosion } from "../core/AtomicExplosion";
import { WeatherManager } from "~/core/WeatherManager";
import { Tornado } from "~/world/Tornado";
import { Tree } from "@dgreenheck/ez-tree";
import { Streetlight } from "./Streetlight";

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
  public weatherManager: WeatherManager;
  public tornadoes: Tornado[] = [];

  public terrainSize: number = 300;
  public terrainMaxHeight: number = 20;
  public proceduralWorldActive: boolean = false; // Initialize as false, set to true when procedural world is loaded
  public streetlights: any[] = []; // Assuming Streetlight class will be created/imported later
  public grassMaterial: THREE.ShaderMaterial; // Assuming this will be initialized later

  public loadingManager: LoadingManager; // New property to store the loading manager

  private lastScenarioID: string;
  private meteoriteInterval: any;
  private onSendMessage: (message: string) => void; // New property

  constructor(
    worldScenePath?: any,
    private onJoin?: (name: string) => void,
    onSendMessage?: (message: string) => void // New parameter
  ) {
    this.onSendMessage = onSendMessage; // Store the callback
    this._initializeCoreManagers();
    this.weatherManager = new WeatherManager(this);
    this._initializePhysicsSettings();
    this._initializeRenderLoop();
    this._initializeStatsAndGUI(); // Initialize params first
    this._initializeCannonDebugger(); // Call the new method here
    this._initializeInputAndCamera();
    UIManager.createChatInput(); // Create chat input
    this._initializeChatInput(); // Initialize chat input event listeners
    this._initializeSkyAndClouds();
    this._initializePlanets();
    this.loadingManager = new LoadingManager(this); // Then initialize loadingManager

    // Check if a specific worldScenePath is provided.
    // If not, activate procedural world generation.
    if (worldScenePath === undefined) {
      this.proceduralWorldActive = true;
      this._initializeTerrain();
      this._initializeRoads();
      this._initializeVillage();
      // Manually signal loading completion for procedural world
      this.loadingManager.onFinishedCallback = () => {
        this.update(1, 1);
        this.setTimeScale(1);
        UIManager.setUserInterfaceVisible(true);
        UIManager.setLoadingScreenVisible(false); // Hide loading screen
        Swal.fire({
          icon: "success",
          title: "Hello procedural world!",
          buttonsStyling: false,
        });
        this.updateEnemyCountDisplay();
      };
      this.loadingManager.doneLoading(new LoadingTrackerEntry("procedural_world")); // Signal done loading
    } else {
      this._loadWorldScene(worldScenePath);
    }

    this.render(this); // This should be called after world initialization

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

      this.add(networkCharacter); // This calls networkCharacter.addToWorld(this)
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
      this.remove(networkCharacter); // This calls networkCharacter.removeFromWorld(this)
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

  public getTerrainHeightAt(x: number, z: number): number {
    const scale = 50; // Controls the "zoom" of the noise
    const strength = this.terrainMaxHeight; // Controls the height of the hills
    return (
      (Utils.perlin.noise(x / scale, z / scale, 0) +
        0.5 * Utils.perlin.noise(x / (scale / 2), z / (scale / 2), 0) +
        0.25 * Utils.perlin.noise(x / (scale / 4), z / (scale / 4), 0)) *
      strength
    );
  }

  private _initializeTerrain(): void {
    const terrainResolution = 256;
    const terrainWidth = this.terrainSize;
    const terrainDepth = this.terrainSize;

    const geometry = new THREE.PlaneGeometry(
      terrainWidth,
      terrainDepth,
      terrainResolution - 1,
      terrainResolution - 1
    );
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position.array as Float32Array;
    const heights: number[][] = [];

    for (let i = 0; i < terrainResolution; i++) {
      heights.push([]);
      for (let j = 0; j < terrainResolution; j++) {
        const x = positions[i * terrainResolution * 3 + j * 3];
        const z = positions[i * terrainResolution * 3 + j * 3 + 2];
        const y = this.getTerrainHeightAt(x, z);
        positions[i * terrainResolution * 3 + j * 3 + 1] = y;
        heights[i].push(y);
      }
    }
    geometry.computeVertexNormals();

    // Create custom grass material
    this.grassMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uGrassColor: { value: new THREE.Color(0x7c9b5f) },
        uDirtColor: { value: new THREE.Color(0x8b5a2b) },
        uSnowColor: { value: new THREE.Color(0xffffff) },
        uRockyColor: { value: new THREE.Color(0x808080) },
        uGrassHeight: { value: this.terrainMaxHeight * 0.2 },
        uDirtHeight: { value: this.terrainMaxHeight * 0.1 },
        uSnowHeight: { value: this.terrainMaxHeight * 0.8 },
        uRockyHeight: { value: this.terrainMaxHeight * 0.4 },
        uTime: { value: 0.0 }, // For potential animation
      },
      vertexShader: `
            varying vec3 vNormal;
            varying vec3 vPosition;
            void main() {
                vNormal = normal;
                vPosition = position;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
      fragmentShader: `
            uniform vec3 uGrassColor;
            uniform vec3 uDirtColor;
            uniform vec3 uSnowColor;
            uniform vec3 uRockyColor;
            uniform float uGrassHeight;
            uniform float uDirtHeight;
            uniform float uSnowHeight;
            uniform float uRockyHeight;
            uniform float uTime; // For potential animation

            varying vec3 vNormal;
            varying vec3 vPosition;

            void main() {
                vec3 color;
                float height = vPosition.y;

                if (height > uSnowHeight) {
                    color = uSnowColor; // Snow on highest peaks
                } else if (height > uRockyHeight && dot(vNormal, vec3(0,1,0)) < 0.7) {
                    color = uRockyColor; // Rocky slopes
                } else if (height > uGrassHeight) {
                    color = uGrassColor; // Grass on mid-height
                } else if (height > uDirtHeight) {
                    color = uDirtColor; // Dirt in lower areas
                } else {
                    color = uDirtColor; // Base dirt
                }

                gl_FragColor = vec4(color, 1.0);
            }
        `,
    });

    const terrainMesh = new THREE.Mesh(geometry, this.grassMaterial);
    terrainMesh.receiveShadow = true;
    terrainMesh.castShadow = true;
    this.sceneManager.graphicsWorld.add(terrainMesh);

    // Physics
    const hfShape = new CANNON.Heightfield(heights, {
      elementSize: terrainWidth / (terrainResolution - 1),
    });
    const hfBody = new CANNON.Body({ mass: 0 });
    hfBody.addShape(hfShape);
    hfBody.position.set(
      -terrainWidth / 2,
      -1, // Adjust as needed to align with visual mesh
      -terrainDepth / 2
    );
    this.physicsManager.physicsWorld.addBody(hfBody);
  }

  private _initializeRoads(): void {
    const roadWidth = 8;
    const roadSegments = 10;
    const roadPhysicsBodies: CANNON.Body[] = [];

    const createRoadSegment = (x1, z1, x2, z2) => {
      const roadMaterial = new THREE.MeshStandardMaterial({
        color: 0x3a3a3a,
        roughness: 0.8,
        metalness: 0.1,
      });

      // Calculate segment direction and normal
      const dir = new THREE.Vector3(x2 - x1, 0, z2 - z1).normalize();
      const perp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(
        roadWidth / 2
      );

      // Get terrain heights for all four corners
      const y1 = this.getTerrainHeightAt(x1, z1);
      const y2 = this.getTerrainHeightAt(x2, z2);

      // Vertices for the road segment, adjusted for terrain height
      const v0 = new THREE.Vector3(x1 - perp.x, y1, z1 - perp.z);
      const v1 = new THREE.Vector3(x1 + perp.x, y1, z1 + perp.z);
      const v2 = new THREE.Vector3(x2 - perp.x, y2, z2 - perp.z);
      const v3 = new THREE.Vector3(x2 + perp.x, y2, z2 + perp.z);

      const roadGeometry = new THREE.BufferGeometry();
      const vertices = new Float32Array([
        v0.x,
        v0.y,
        v0.z, // 0
        v1.x,
        v1.y,
        v1.z, // 1
        v2.x,
        v2.y,
        v2.z, // 2
        v3.x,
        v3.y,
        v3.z, // 3
      ]);

      const indices = new Uint32Array([0, 1, 2, 2, 1, 3]);

      roadGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(vertices, 3)
      );
      roadGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
      roadGeometry.computeVertexNormals();

      const roadMesh = new THREE.Mesh(roadGeometry, roadMaterial);
      roadMesh.castShadow = true; // Roads can cast shadows too
      this.sceneManager.graphicsWorld.add(roadMesh);

      // Create physics body for the road segment
      const physicsVertices = new Float32Array([
        v0.x,
        v0.y,
        v0.z,
        v1.x,
        v1.y,
        v1.z,
        v2.x,
        v2.y,
        v2.z,
        v3.x,
        v3.y,
        v3.z,
      ]);
      const physicsIndices = new Uint16Array([0, 1, 2, 2, 1, 3]);
      const trimeshShape = new CANNON.Trimesh(
        physicsVertices as any,
        physicsIndices as any
      );
      const roadBody = new CANNON.Body({
        mass: 0,
        material: this.physicsManager.trimeshMaterial,
      });
      roadBody.addShape(trimeshShape);
      roadPhysicsBodies.push(roadBody);

      return roadMesh;
    };

    // Main road along X-axis
    for (let i = -roadSegments / 2; i < roadSegments / 2; i++) {
      const x1 = (i / roadSegments) * this.terrainSize;
      const x2 = ((i + 1) / roadSegments) * this.terrainSize;
      createRoadSegment(x1, 0, x2, 0);
    }

    // Main road along Z-axis
    for (let i = -roadSegments / 2; i < roadSegments / 2; i++) {
      const z1 = (i / roadSegments) * this.terrainSize;
      const z2 = ((i + 1) / roadSegments) * this.terrainSize;
      createRoadSegment(0, z1, 0, z2);
    }

    roadPhysicsBodies.forEach((body) =>
      this.physicsManager.physicsWorld.addBody(body)
    );
  }

  private _initializeVillage(): void {
    // Create trees using @dgreenheck/ez-tree
    const ezTreeCount = 75; // Same count as before for now

    for (let i = 0; i < ezTreeCount; i++) {
      const x = Math.random() * this.terrainSize - this.terrainSize / 2;
      const z = Math.random() * this.terrainSize - this.terrainSize / 2;
      const y = this.getTerrainHeightAt(x, z); // Use terrain height

      const tree = new Tree();
      tree.options = tree.options || {}; // Initialize options if undefined
      tree.options.trunk = tree.options.trunk || {}; // Initialize trunk options if undefined
      tree.options.seed = 1; // Fixed seed for debugging
      tree.options.trunk.length = 5; // Fixed trunk length for debugging
      tree.options.branch.levels = 2; // Fixed branch levels for debugging
      tree.generate(); // Generate the Three.js objects

      // Position the tree
      tree.position.set(x, y, z); // Adjust y to be above ground

      // Add to scene
      this.sceneManager.graphicsWorld.add(tree);

      // Add physics body for the tree (simplified for now, using a cylinder for the main trunk)
      const trunkPhysicsHeight = tree.options.trunk.length;
      const trunkPhysicsRadius = 0.7; // Fixed radius to avoid NaN issues

      const trunkPhysicsShape = new CANNON.Cylinder(
        trunkPhysicsRadius,
        trunkPhysicsRadius,
        trunkPhysicsHeight,
        12
      );
      const trunkPhysicsBody = new CANNON.Body({
        mass: 0, // Static tree
        material: this.physicsManager.trimeshMaterial,
        collisionFilterGroup: CollisionGroups.TrimeshColliders, // Explicitly assign to TrimeshColliders group
      });
      trunkPhysicsBody.addShape(trunkPhysicsShape);
      trunkPhysicsBody.position.set(x, y + trunkPhysicsHeight / 2, z); // Center of the physics body at y + half_height
      this.physicsManager.physicsWorld.addBody(trunkPhysicsBody);
    }

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

      const baseHeight = this.getTerrainHeightAt(x, z);

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
      const y = this.getTerrainHeightAt(x, z); // Get terrain height

      const streetlight = new Streetlight(this, new THREE.Vector3(x, y, z));
      this.streetlights.push(streetlight);
    }

    // Add boundary walls
    const wallHeight = 50;
    const wallThickness = 1;
    const halfSize = this.terrainSize / 2;

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
        this.terrainSize + wallThickness
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
        this.terrainSize + wallThickness
      ),
      wallMaterial
    );
    wallXN.position.set(-halfSize, wallHeight / 2, 0);
    wallXN.receiveShadow = false;
    this.sceneManager.graphicsWorld.add(wallXN);

    // Wall Z+
    const wallZP = new THREE.Mesh(
      new THREE.BoxGeometry(
        this.terrainSize + wallThickness,
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
        this.terrainSize + wallThickness,
        wallHeight,
        wallThickness
      ),
      wallMaterial
    );
    wallZN.position.set(0, wallHeight / 2, -halfSize);
    wallZN.receiveShadow = false;
    this.sceneManager.graphicsWorld.add(wallZN);
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
            // Launch default scenario after user confirms name
            let defaultScenarioID: string;
            for (const scenario of this.scenarios) {
              if (scenario.default) {
                defaultScenarioID = scenario.id;
                break;
              }
            }
            if (defaultScenarioID !== undefined) {
              this.launchScenario(defaultScenarioID);
            }
            this.updateEnemyCountDisplay(); // Update after scenario launch

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
    }
  }

  // Update
  // Handles all logic updates.
  public update(timeStep: number, unscaledTimeStep: number): void {
    this.physicsManager.update(timeStep);
    this.gameManager.update(timeStep, unscaledTimeStep);
    this.weatherManager.update(timeStep);

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
    if (Math.random() < 0.002) {
      this.spawnUFO();
    }

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

    if (worldEntity instanceof NetworkPlayer) {
      worldEntity.removeFromWorld(this);
    } else if (worldEntity instanceof Character) {
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
        (worldEntity as Character).characterCapsule.body.collisionResponse =
          false;
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
    if (this.proceduralWorldActive) return;

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
    if (!this.player) {
      console.warn("Cannot spawn enemies: local player is not defined.");
      return;
    }

    this.initialEnemyCount = count;
    this.currentEnemyCount = count;
    this.updateEnemyCountDisplay(); // Initialize enemy count display

    for (let i = 0; i < count; i++) {
      this.loadingManager
        .loadGLTFPromise("boxman.glb")
        .then((model) => {
          let character = new Character(model);
          character.name = `Enemy ${i}`; // Assign a name for debugging
          character.entityType = EntityType.Enemy; // Assign Enemy EntityType
          character.setBehaviour(new FollowTarget(this.player)); // Target the local player
          character.setColor(new THREE.Color(0xff0000)); // Set enemy character color to red
          character.createHealthBar(); // Create health bar for enemies

          let spawnPosition = new THREE.Vector3();
          if (this.paths.length > 0) {
            const randomPath =
              this.paths[Math.floor(Math.random() * this.paths.length)];
            const nodeKeys = Object.keys(randomPath.nodes);
            const randomNodeKey =
              nodeKeys[Math.floor(Math.random() * nodeKeys.length)];
            const randomNode = randomPath.nodes[randomNodeKey];
            randomNode.object.getWorldPosition(spawnPosition);
          } else {
            // Fallback to broader random range if no paths are defined
            spawnPosition.x = Math.random() * 800 - 400; // Wider range
            spawnPosition.z = Math.random() * 800 - 400; // Wider range
            spawnPosition.y = 20; // Keep fixed y for now, assume falling into place
          }
          character.setPosition(
            spawnPosition.x,
            spawnPosition.y,
            spawnPosition.z
          );

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
    gui.close();

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
  }
}
