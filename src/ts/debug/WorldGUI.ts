import { GUI } from "lil-gui";
import { World } from "~/world/World";
import { UIManager } from "~/core/UIManager";
import { SceneManager } from "~/core/SceneManager";
import { InputManager } from "~/core/InputManager";
import CannonDebugger from "cannon-es-debugger";
import { PhysicsManager } from "~/core/PhysicsManager";
import { WorldEventSpawner } from "~/world/WorldEventSpawner";
import { WeatherManager } from "~/core/WeatherManager";

export class WorldGUI {
  private world: World;
  private sceneManager: SceneManager;
  private inputManager: InputManager;
  private physicsManager: PhysicsManager;
  private worldEventSpawner: WorldEventSpawner;
  private weatherManager: WeatherManager; // Add weatherManager property
  public params: any; // Public so World can access it if needed

  constructor(
    world: World,
    sceneManager: SceneManager,
    inputManager: InputManager,
    physicsManager: PhysicsManager,
    worldEventSpawner: WorldEventSpawner,
    weatherManager: WeatherManager
  ) {
    this.world = world;
    this.sceneManager = sceneManager;
    this.inputManager = inputManager;
    this.physicsManager = physicsManager;
    this.worldEventSpawner = worldEventSpawner;
    this.weatherManager = weatherManager; // Assign weatherManager
  }

  public setSceneManager(sceneManager: SceneManager): void {
    this.sceneManager = sceneManager;
  }

  public setInputManager(inputManager: InputManager): void {
    this.inputManager = inputManager;
  }

  public createParamsGUI(): GUI {
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
        this.world.timeScaleTarget = value;
      });
    worldFolder
      .add(this.params, "Sun_Elevation", 0, 180)
      .listen()
      .onChange((value) => {
        this.world.sky.phi = value;
      });
    worldFolder
      .add(this.params, "Sun_Rotation", 0, 360)
      .listen()
      .onChange((value) => {
        this.world.sky.theta = value;
      });

    // Input
    let settingsFolder = gui.addFolder("Settings");
    settingsFolder.add(this.params, "FXAA");
    settingsFolder.add(this.params, "Shadows").onChange((enabled) => {
      if (enabled) {
        this.world.sky.csm.lights.forEach((light) => {
          light.castShadow = true;
        });
      } else {
        this.world.sky.csm.lights.forEach((light) => {
          light.castShadow = false;
        });
      }
    });
    settingsFolder.add(this.params, "Pointer_Lock").onChange((enabled) => {
      this.inputManager.setPointerLock(enabled);
    });
    settingsFolder
      .add(this.params, "Mouse_Sensitivity", 0, 1)
      .onChange((value) => {
        this.world.cameraOperator.setSensitivity(value, value * 0.8);
      });
    settingsFolder.add(this.params, "Debug_Physics").onChange((enabled) => {
      if (enabled) {
        this.world.cannonDebugRenderer = CannonDebugger(
          this.sceneManager.graphicsWorld,
          this.physicsManager.physicsWorld
        );
      } else {
        this.world.cannonDebugRenderer.destroy();
        this.world.cannonDebugRenderer = undefined;
      }

      this.world.entityManager.characters.forEach((char) => {
        char.raycastBox.visible = enabled;
      });
    });
    settingsFolder.add(this.params, "Debug_FPS").onChange((enabled) => {
      UIManager.setFPSVisible(enabled);
    });

    // Weather
    let weatherFolder = gui.addFolder("Weather");
    weatherFolder
      .add({ startRain: () => this.weatherManager.startRain() }, "startRain")
      .name("Start Rain");
    weatherFolder
      .add({ stopRain: () => this.weatherManager.stopRain() }, "stopRain")
      .name("Stop Rain");
    weatherFolder
      .add(
        { startThunderstorm: () => this.weatherManager.startThunderstorm() },
        "startThunderstorm"
      )
      .name("Start Thunderstorm");
    weatherFolder
      .add(
        { stopThunderstorm: () => this.weatherManager.stopThunderstorm() },
        "stopThunderstorm"
      )
      .name("Stop Thunderstorm");

    // Tornadoes
    let tornadoFolder = gui.addFolder("Tornadoes");
    tornadoFolder
      .add(this.worldEventSpawner, "spawnTornado")
      .name("Spawn Tornado");
    tornadoFolder
      .add(this.worldEventSpawner, "removeLastTornado")
      .name("Remove Last Tornado");

    return gui;
  }
}
