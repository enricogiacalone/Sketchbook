import CannonDebugger from "cannon-es-debugger";
import Stats from "stats.js";
import * as THREE from "three";
import { Character } from "~/characters/Character";
import { NetworkPlayer } from "~/characters/NetworkPlayer";
import { CameraOperator } from "~/core/CameraOperator";
import { EntityManager } from "~/core/EntityManager";
import { GameManager } from "~/core/GameManager";
import { InputManager } from "~/core/InputManager";
import { LoadingManager } from "~/core/LoadingManager";
import { PhysicsManager } from "~/core/PhysicsManager";
import { SceneManager } from "~/core/SceneManager";
import { UIManager } from "~/core/UIManager";
import { WeatherManager } from "~/core/WeatherManager";
import { WorldGUI } from "~/debug/WorldGUI";
import { ScenarioManager } from "~/game/ScenarioManager";
import { WorldUIManager } from "~/ui/WorldUIManager";
import { Sky } from "~/world/Sky";
import { WorldEventSpawner } from "~/world/WorldEventSpawner";
import { NetworkManager } from "../network/NetworkManager";
import { WorldBuilder } from "./WorldBuilder";

/**
 * The core engine class that coordinates all game subsystems.
 * Responsible for the render loop, physics step, and manager initialization.
 */
export class World {
  /** Flag to indicate if the current world was procedurally generated. */
  public proceduralWorldActive: boolean = false;
  /** Size of the terrain grid (if applicable). */
  public terrainSize: number;
  /** Performance monitor (FPS/Frame time). */
  public stats: Stats;
  /** Skybox and weather effects manager. */
  public sky: Sky;
  /** Parallel physics pairs for collision detection. */
  public parallelPairs: any[];
  /** Target physics updates per second. */
  public physicsFrameRate: number;
  /** Time delta for each physics step. */
  public physicsFrameTime: number;
  /** Maximum number of physics steps to predict per frame to maintain sync. */
  public physicsMaxPrediction: number;
  /** High-precision clock for frame delta calculation. */
  public clock: THREE.Clock;
  /** Render time delta of the current frame. */
  public renderDelta: number;
  /** Logic time delta for gameplay updates. */
  public logicDelta: number;
  public requestDelta: number;
  public sinceLastFrame: number;
  public justRendered: boolean;
  
  /** Manages all dynamic entities in the world. */
  public entityManager: EntityManager;
  /** Handles keyboard, mouse, and gamepad input. */
  public inputManager: InputManager;
  /** Controls camera behavior and positioning. */
  public cameraOperator: CameraOperator;
  /** Global time scale multiplier (useful for slow motion). */
  public timeScaleTarget: number = 1;

  /** Manages the Three.js scene, lights, and rendering. */
  public sceneManager: SceneManager;
  /** Manages the Cannon-es physics world and simulation. */
  public physicsManager: PhysicsManager;
  public gameManager: GameManager;
  public scenarioManager: ScenarioManager;
  public worldEventSpawner: WorldEventSpawner;
  public worldUIManager: WorldUIManager;
  public worldGUI: WorldGUI;
  public cannonDebugRenderer: any;
  /** Reference to the local player's character. */
  public player: Character; 
  /** Registry of all other players in the session. */
  public networkPlayers: Map<string, NetworkPlayer> = new Map(); 
  public weatherManager: WeatherManager;

  public loadingManager: LoadingManager; 
  /** Callback triggered when a player joins. */
  public onJoin: (name: string) => void;
  public onSendMessage: (message: string) => void; 
  public networkManager: NetworkManager;
  public worldBuilder: WorldBuilder;

  /**
   * Initializes a new Sketchbook World.
   * @param worldScenePath Optional path to a GLTF scene to load.
   * @param onJoin Optional callback for socket initialization.
   * @param onSendMessage Optional callback for chat messages.
   */
  constructor(
    worldScenePath?: any,
    onJoin?: (name: string) => void,
    onSendMessage?: (message: string) => void // New parameter
  ) {
    this.onJoin = onJoin;
    this.onSendMessage = onSendMessage; // Store the callback

    // Initialize physics settings
    this.parallelPairs = [];
    this.physicsFrameRate = 60;
    this.physicsFrameTime = 1 / this.physicsFrameRate;
    this.physicsMaxPrediction = this.physicsFrameRate;

    // Initialize render loop
    this.clock = new THREE.Clock();
    this.renderDelta = 0;
    this.logicDelta = 0;
    this.sinceLastFrame = 0;
    this.justRendered = false;

    // Initialize core managers in order of dependency
    this.physicsManager = new PhysicsManager(this);
    this.worldEventSpawner = new WorldEventSpawner(this);
    this.weatherManager = new WeatherManager(this); // Initialize weatherManager before WorldGUI

    // Initialize WorldGUI (requires sceneManager, inputManager, physicsManager, worldEventSpawner, weatherManager - inputManager will be updated)
    this.worldGUI = new WorldGUI(
      this,
      null,
      null,
      this.physicsManager,
      this.worldEventSpawner,
      this.weatherManager
    ); // Pass null for inputManager initially
    const gui = this.worldGUI.createParamsGUI(); // Create GUI and get params

    this.sceneManager = new SceneManager(this, this.worldGUI);
    this.worldGUI.setSceneManager(this.sceneManager);

    this.entityManager = new EntityManager(this);
    this.inputManager = new InputManager(
      this,
      this.sceneManager.renderer.domElement,
      this.worldGUI
    );
    this.worldGUI.setInputManager(this.inputManager); // Set inputManager in WorldGUI

    this.worldUIManager = new WorldUIManager(this, this.inputManager);
    this.worldUIManager.generateHTML(); // Generate initial HTML here
    this.loadingManager = new LoadingManager(this); // Initialize loadingManager unconditionally
    this.stats = new Stats();

    this.gameManager = new GameManager(this, this.worldGUI); // Now worldGUI is available
    this.networkManager = new NetworkManager(this);
    UIManager.createChatInput(); // Create chat input
    this.worldUIManager._initializeChatInput(); // Initialize chat input event listeners

    this.cameraOperator = new CameraOperator(
      this,
      this.sceneManager.camera,
      this.worldGUI,
      this.worldUIManager
    );

    this.weatherManager = new WeatherManager(this); // After SceneManager and PhysicsManager

    // Initialize Cannon Debugger (requires worldGUI.params)
    this._initializeCannonDebugger();

    const axesHelper = new THREE.AxesHelper(10); // Visual aid for world origin
    this.sceneManager.graphicsWorld.add(axesHelper);

    // Scenario GUI folder initialization
    const scenarioGUIFolder = gui.addFolder("Scenarios");
    scenarioGUIFolder.open();
    this.scenarioManager = new ScenarioManager(this, scenarioGUIFolder); // Instantiate ScenarioManager here
    this.gameManager.setWorldGUI(this.worldGUI); // Set worldGUI for GameManager here

    this.setTimeScale(1); // Set initial time scale after all managers are initialized

    this.worldBuilder = new WorldBuilder(this);
    this.worldBuilder.load(worldScenePath);

    this.render(this);

    // this.meteoriteInterval = setInterval(
    //   () => this.worldEventSpawner.spawnMeteorShower(2, new THREE.Vector3(0, 200, 0)),
    //   2000
    // );
  }

  /**
   * Initializes Cannon Debugger if Debug_Physics is true.
   */
  private _initializeCannonDebugger(): void {
    if (this.worldGUI.params.Debug_Physics) {
      this.cannonDebugRenderer = CannonDebugger(
        this.sceneManager.graphicsWorld,
        this.physicsManager.physicsWorld
      );
    }
  }

  // Update
  // Handles all logic updates.
  public update(timeStep: number, unscaledTimeStep: number): void {
    this.physicsManager.update(timeStep);
    this.gameManager.update(timeStep, unscaledTimeStep);
    this.weatherManager.update(timeStep);
    this.worldEventSpawner.update(timeStep);

    if (this.worldGUI.params.Debug_Physics) {
      this.cannonDebugRenderer.update();
    }
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
    let timeStep = unscaledTimeStep * this.worldGUI.params.Time_Scale;
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
    this.worldGUI.params.Time_Scale = value;
    this.timeScaleTarget = value;
  }
}
