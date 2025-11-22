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
import { IUpdatable } from "~/interfaces/IUpdatable";
import { WorldUIManager } from "~/ui/WorldUIManager";
import { Vehicle } from "~/vehicles/Vehicle";
import { Cloud } from "~/world/Cloud";
import { Grass } from "~/world/Grass";
import { Path } from "~/world/Path";
import { Road } from "~/world/Road";
import { Scenario } from "~/world/Scenario";
import { Sky } from "~/world/Sky";
import { Streetlight } from "~/world/Streetlight";
import { WorldEventSpawner } from "~/world/WorldEventSpawner";
import { NetworkManager } from "../network/NetworkManager";
import { CloudsGenerator } from "./CloudsGenerator";
import { InterstellarVortex } from "./InterstellarVortex";
import { Planet } from "./Planet";
import { PlanetsGenerator } from "./PlanetsGenerator";
import { PsychedelicParticles } from "./PsychedelicParticles";
import { WorldBuilder } from "./WorldBuilder";

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
  public entityManager: EntityManager;
  public inputManager: InputManager;
  public cameraOperator: CameraOperator;
  public timeScaleTarget: number = 1;

  public scenarios: Scenario[] = [];
  public characters: Character[] = [];
  public vehicles: Vehicle[] = [];
  public paths: Path[] = [];
  public updatables: IUpdatable[] = [];

  public sceneManager: SceneManager;
  public physicsManager: PhysicsManager;
  public gameManager: GameManager;
  public scenarioManager: ScenarioManager;
  public worldEventSpawner: WorldEventSpawner;
  public worldUIManager: WorldUIManager;
  public worldGUI: WorldGUI;
  public cannonDebugRenderer: any;
  public interstellarVortex: InterstellarVortex;
  public player: Character; // Reference to the local player character
  public networkPlayers: Map<string, NetworkPlayer> = new Map(); // Map to store other players by their socket ID
  public weatherManager: WeatherManager;
  public streetlights: Streetlight[] = [];

  public terrainHeights: number[] = [];
  public groundPositionAttribute: THREE.BufferAttribute;
  public terrainSegments: number; // New property for terrain segments

  public loadingManager: LoadingManager; // New property to store the loading manager
  public onJoin: (name: string) => void;
  public onSendMessage: (message: string) => void; // New property
  public networkManager: NetworkManager;
  public worldBuilder: WorldBuilder;

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

    this.sky = new Sky(this);

    // Initialize Sky and Clouds
    const cloudsGenerator = new CloudsGenerator(this);
    cloudsGenerator.generate();

    // Initialize Planets
    const planetsGenerator = new PlanetsGenerator(this);
    planetsGenerator.generate();
    this.interstellarVortex = new InterstellarVortex(
      this,
      new THREE.Vector3(0, 500, 0),
      2000
    );
    new PsychedelicParticles(this, 5000, this.interstellarVortex);

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

    this.streetlights.forEach((light) => light.update(this.sky.timeOfDay));

    if (this.worldGUI.params.Debug_Physics) {
      this.cannonDebugRenderer.update();
    }

    // Spawn UFOs
    if (Math.random() < 0.002) {
      this.worldEventSpawner.spawnUFO();
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
