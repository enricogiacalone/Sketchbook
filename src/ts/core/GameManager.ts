import * as THREE from "three";
import { World } from "~/world/World";
import { WorldGUI } from "~/debug/WorldGUI"; // Import WorldGUI

export class GameManager {
  public world: World;
  public worldGUI: WorldGUI; // Make worldGUI public

  constructor(world: World, worldGUI: WorldGUI) {
    this.world = world;
    this.worldGUI = worldGUI; // Assign worldGUI
  }

  public setWorldGUI(worldGUI: WorldGUI): void {
    this.worldGUI = worldGUI;
  }

  public update(timeStep: number, unscaledTimeStep: number): void {
    this.world.updatables.forEach((entity) => {
      entity.update(timeStep, unscaledTimeStep);
    });

    // Lerp time scale
    this.worldGUI.params.Time_Scale = THREE.MathUtils.lerp(
      this.worldGUI.params.Time_Scale,
      this.world.timeScaleTarget,
      0.2
    );
  }
}
