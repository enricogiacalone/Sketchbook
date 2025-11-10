import * as CANNON from "cannon-es";
import $ from "jquery";
import * as _ from "lodash";
import Swal from "sweetalert2";
import * as THREE from "three";
import { Detector } from "$lib/utils/Detector";
import { Stats } from "$lib/utils/Stats";
import * as dat from "dat.gui";
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

  private lastScenarioID: string;
  private initialEnemyCount: number = 0; // New property to store the initial count of enemies in a wave
  private currentEnemyCount: number = 0; // New property to track active enemies
  private loadingManager: LoadingManager; // New property to store the loading manager

  constructor(worldScenePath?: any) {
    const scope = this;

    // WebGL not supported
    if (!Detector.webgl) {
      Swal.fire({
        icon: "warning",
        title: "WebGL compatibility",
        text: "This browser doesn't seem to have the required WebGL capabilities. The application may not work correctly.",
        footer:
          '<a href="https://get.webgl.org/" target="_blank">Click here for more information</a>',
        showConfirmButton: false,
        buttonsStyling: false,
      });
    }

    this.sceneManager = new SceneManager(this);
    this.physicsManager = new PhysicsManager(this);
    this.gameManager = new GameManager(this);
    this.generateHTML();

    this.parallelPairs = [];
    this.physicsFrameRate = 60;
    this.physicsFrameTime = 1 / this.physicsFrameRate;
    this.physicsMaxPrediction = this.physicsFrameRate;

    // RenderLoop
    this.clock = new THREE.Clock();
    this.renderDelta = 0;
    this.logicDelta = 0;
    this.sinceLastFrame = 0;
    this.justRendered = false;

    // Stats (FPS, Frame time, Memory)
    this.stats = Stats();
    // Create right panel GUI
    this.createParamsGUI(scope);

    // Initialize Cannon Debugger if Debug_Physics is true
    if (this.params.Debug_Physics) {
      console.log("Cannon Debugger: Enabling on startup");
      this.cannonDebugRenderer = CannonDebugger(
        this.sceneManager.graphicsWorld,
        this.physicsManager.physicsWorld
      );
    }

    // Initialization
    this.inputManager = new InputManager(
      this,
      this.sceneManager.renderer.domElement
    );
    this.cameraOperator = new CameraOperator(
      this,
      this.sceneManager.camera,
      this.params.Mouse_Sensitivity
    );
    this.sky = new Sky(this);

    // Create multiple cloud banks
    for (let i = 0; i < 4; i++) {
      const bankCenter = new THREE.Vector3(
        (Math.random() - 0.5) * 1500,
        100 + (Math.random() - 0.5) * 100,
        (Math.random() - 0.5) * 1500
      );

      for (let j = 0; j < 10; j++) {
        const cloud = new Cloud(
          this,
          100 + Math.random() * 100,
          Math.random() * 0.5 + 0.5
        );
        cloud.group.position.set(
          bankCenter.x + (Math.random() - 0.5) * 500,
          bankCenter.y + (Math.random() - 0.5) * 50,
          bankCenter.z + (Math.random() - 0.5) * 500
        );
        this.clouds.push(cloud);
      }
    }

    // Create a few planets
    for (let i = 0; i < 3; i++) {
      const color = new THREE.Color(
        Math.random(),
        Math.random(),
        Math.random()
      );
      const size = 50 + Math.random() * 50;
      const planet = new Planet(this, color, size);
      planet.setPosition(
        (Math.random() - 0.5) * 1500,
        200 + Math.random() * 200,
        (Math.random() - 0.5) * 1500
      );
      planet.mesh.renderOrder = -1; // Render planets behind clouds
      this.planets.push(planet);
    }

    this.loadingManager = new LoadingManager(this); // Initialize loadingManager unconditionally

    // Load scene if path is supplied
    if (worldScenePath !== undefined) {
      this.loadingManager.onFinishedCallback = () => {
        this.update(1, 1);
        this.setTimeScale(1);

        Swal.fire({
          title: "Welcome to Sketchbook!",
          text: "Feel free to explore the world and interact with available vehicles. There are also various scenarios ready to launch from the right panel.",
          footer:
            '<a href="https://github.com/swift502/Sketchbook" target="_blank">GitHub page</a><a href="https://discord.gg/fGuEqCe" target="_blank">Discord server</a>',
          confirmButtonText: "Okay",
          buttonsStyling: false,
        }).then((result) => {
          if (result.isConfirmed) {
            UIManager.setUserInterfaceVisible(true);
            this.updateEnemyCountDisplay(); // Update counter after UI is visible
          }
        });
      };
      this.loadingManager.loadGLTF(worldScenePath, (gltf) => {
        this.loadScene(this.loadingManager, gltf);
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

    this.render(this);
  }

  // Update
  // Handles all logic updates.
  public update(timeStep: number, unscaledTimeStep: number): void {
    this.physicsManager.update(timeStep);
    this.gameManager.update(timeStep, unscaledTimeStep);

    if (this.params.Debug_Physics) {
      console.log("Cannon Debugger: Updating");
      this.cannonDebugRenderer.update();
    }
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
    console.log("World.remove called for entity:", worldEntity);

    // Check if the removed entity is an enemy character
    if (worldEntity instanceof Character) {
      console.log(
        "Entity is a Character. EntityType:",
        worldEntity.entityType,
        "Expected EntityType.Enemy:",
        EntityType.Enemy
      );
      if (worldEntity.entityType === EntityType.Enemy) {
        this.currentEnemyCount--;
        console.log(
          `Enemy removed. Remaining enemies: ${this.currentEnemyCount}`
        );
        this.updateEnemyCountDisplay(); // Update UI using helper method

        if (this.currentEnemyCount <= 0) {
          console.log("All enemies defeated! Spawning new wave.");
          this.spawnEnemies(this.initialEnemyCount * 2);
        }
      } else {
        console.log(
          "Entity is a Character but not an Enemy. EntityType:",
          worldEntity.entityType
        );
      }

      // --- Moved logic from Character.removeFromWorld ---
      if (this.inputManager.inputReceiver === worldEntity) {
        this.inputManager.inputReceiver = undefined;
      }

      // Remove from characters
      _.pull(this.characters, worldEntity);

      // Remove physics
      // Make the body completely non-interactive and static before removing it
      worldEntity.characterCapsule.body.collisionResponse = 0;
      worldEntity.characterCapsule.body.mass = 0;
      worldEntity.characterCapsule.body.sleep(); // Put the body to sleep
      this.physicsManager.bodiesToRemove.push(worldEntity.characterCapsule.body); // Add to deferred removal list

      // Remove visuals
      this.sceneManager.graphicsWorld.remove(worldEntity);
      this.sceneManager.graphicsWorld.remove(worldEntity.raycastBox);
      if (worldEntity.healthBarContainer && worldEntity.healthBarContainer.parent) {
        worldEntity.healthBarContainer.parent.remove(worldEntity.healthBarContainer);
      }
      // --- End of moved logic ---

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
      if (child.hasOwnProperty("userData")) {
        if (child.type === "Mesh") {
          Utils.setupMeshProperties(child);
          this.sky.csm.setupMaterial(child.material);

          if (child.material.name === "ocean") {
            this.registerUpdatable(new Ocean(child, this));
          }
        }

        if (child.userData.hasOwnProperty("data")) {
          if (child.userData.data === "physics") {
            if (child.userData.hasOwnProperty("type")) {
              // Convex doesn't work! Stick to boxes!
              if (child.userData.type === "box") {
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
              } else if (child.userData.type === "trimesh") {
                let phys = new TrimeshCollider(child, {
                  material: this.physicsManager.trimeshMaterial, // Assign trimesh material
                });
                this.physicsManager.physicsWorld.addBody(phys.body);
              }

              child.visible = false;
            }
          }

          if (child.userData.data === "path") {
            this.paths.push(new Path(child));
          }

          if (child.userData.data === "scenario") {
            this.scenarios.push(new Scenario(child, this));
          }
        }
      }
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

  public launchScenario(scenarioID: string): void {
    this.lastScenarioID = scenarioID;

    this.clearEntities();
    this.updateEnemyCountDisplay(); // Initialize enemy count display

    // Launch default scenario
    for (const scenario of this.scenarios) {
      if (scenario.id === scenarioID || scenario.spawnAlways) {
        // Find the player spawn point
        let playerSpawnPoint: CharacterSpawnPoint | undefined;
        scenario.spawnPoints.forEach((sp) => {
          if (sp instanceof CharacterSpawnPoint) {
            playerSpawnPoint = sp;
          }
        });

        if (playerSpawnPoint) {
          // Spawn the player character first
          playerSpawnPoint.spawn(this.loadingManager, this, () => {
            // After player is spawned, then spawn AI characters
            this.characters[0].setColor(new THREE.Color(0x0000ff)); // Set main character color to blue
            this.spawnEnemies(5);
          });
        } else {
          // No player spawn point found, just launch the scenario normally
          scenario.launch(this.loadingManager, this);
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
    for (let i = 0; i < this.characters.length; i++) {
      this.remove(this.characters[i]);
      i--;
    }

    for (let i = 0; i < this.vehicles.length; i++) {
      this.remove(this.vehicles[i]);
      i--;
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

  private updateEnemyCountDisplay(): void {
    console.log(
      "updateEnemyCountDisplay called. currentEnemyCount:",
      this.currentEnemyCount
    );
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
      console.log(
        "Updated #dynamic-enemy-count. Current innerHTML:",
        enemyCountElement.innerHTML,
        "Display style:",
        enemyCountElement.style.display
      );
    }
  }

  public spawnEnemies(count: number): void {
    this.initialEnemyCount = count; // Update initial count for the new wave
    this.currentEnemyCount = count; // Reset current count
    this.updateEnemyCountDisplay(); // Update UI using helper method

    for (let i = 0; i < count; i++) {
      this.loadingManager.loadGLTF("boxman.glb", (model) => {
        let character = new Character(model);
        character.name = `Enemy ${i}`; // Assign a name for debugging
        character.entityType = EntityType.Enemy; // Assign Enemy EntityType
        character.setBehaviour(new FollowTarget(this.characters[0])); // this.characters[0] is the player
        character.setColor(new THREE.Color(0xff0000)); // Set enemy character color to red
        character.createHealthBar(); // Create health bar for enemies
        console.log(`Spawned ${character.name} with health: ${character.health}`);

        // Get a random spawn position
        const x = Math.random() * 200 - 100;
        const z = Math.random() * 100 - 50;
        character.setPosition(x, 20, z);

        this.add(character);
      });
    }
  }

  private generateHTML(): void {
    // Fonts
    $("head").append(
      '<link href="https://fonts.googleapis.com/css2?family=Alfa+Slab+One&display=swap" rel="stylesheet">'
    );
    $("head").append(
      '<link href="https://fonts.googleapis.com/css2?family=Solway:wght@400;500;700&display=swap" rel="stylesheet">'
    );
    $("head").append(
      '<link href="https://fonts.googleapis.com/css2?family=Cutive+Mono&display=swap" rel="stylesheet">'
    );

    // Loader
    $(`	<div id="loading-screen">
				<div id="loading-screen-background"></div>
				<h1 id="main-title" class="sb-font">Sketchbook 0.4</h1>
				<div class="cubeWrap">
					<div class="cube">
						<div class="faces1"></div>
						<div class="faces2"></div>     
					</div> 
				</div> 
				<div id="loading-text">Loading...</div>
			</div>
		`).appendTo("body");

    // UI
    $(`	<div id="ui-container" style="display: none;">
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
			</div>
		`).appendTo("body");
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

    const gui = new dat.GUI();

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
