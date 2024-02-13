import * as CANNON from "cannon-es";
import * as THREE from "three";
import { Character } from "../characters/Character";
import { CameraOperator } from "../core/CameraOperator";
import { InfoStack } from "../core/InfoStack";
import { InputManager } from "../core/InputManager";
import { LoadingManager } from "../core/LoadingManager";
import { IUpdatable } from "../interfaces/IUpdatable";
import { IWorldEntity } from "../interfaces/IWorldEntity";
import { Vehicle } from "../vehicles/Vehicle";
import { Path } from "./Path";
import { Scenario } from "./Scenario";
import { Sky } from "./Sky";
export declare class World {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  composer: any;
  // stats: Stats;
  graphicsWorld: THREE.Scene;
  sky: Sky;
  physicsWorld: CANNON.World;
  parallelPairs: any[];
  physicsFrameRate: number;
  physicsFrameTime: number;
  physicsMaxPrediction: number;
  clock: THREE.Clock;
  renderDelta: number;
  logicDelta: number;
  requestDelta: number;
  sinceLastFrame: number;
  justRendered: boolean;
  params: any;
  inputManager: InputManager;
  cameraOperator: CameraOperator;
  timeScaleTarget: number;
  console: InfoStack;
  scenarios: Scenario[];
  characters: Character[];
  vehicles: Vehicle[];
  paths: Path[];
  scenarioGUIFolder: any;
  updatables: IUpdatable[];
  private lastScenarioID;
  constructor(worldScenePath?: any);
  update(timeStep: number, unscaledTimeStep: number): void;
  updatePhysics(timeStep: number): void;
  isOutOfBounds(position: CANNON.Vec3): boolean;
  outOfBoundsRespawn(body: CANNON.Body, position?: CANNON.Vec3): void;
  /**
   * Rendering loop.
   * Implements fps limiter and frame-skipping
   * Calls world's "update" function before rendering.
   * @param {World} world
   */
  render(world: World): void;
  setTimeScale(value: number): void;
  add(worldEntity: IWorldEntity): void;
  registerUpdatable(registree: IUpdatable): void;
  remove(worldEntity: IWorldEntity): void;
  unregisterUpdatable(registree: IUpdatable): void;
  loadScene(loadingManager: LoadingManager, gltf: any): void;
  launchScenario(scenarioID: string, loadingManager?: LoadingManager): void;
  restartScenario(): void;
  clearEntities(): void;
  scrollTheTimeScale(scrollAmount: number): void;
  updateControls(controls: any): void;
  private generateHTML;
  private createParamsGUI;
}
