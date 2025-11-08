import * as THREE from "three";
import { World } from "~/world/World";

export class GameManager {
  public world: World;

  constructor(world: World) {
    this.world = world;
  }

  public update(timeStep: number, unscaledTimeStep: number): void {
    this.world.updatables.forEach((entity) => {
      entity.update(timeStep, unscaledTimeStep);
    });

    // Lerp time scale
    this.world.params.Time_Scale = THREE.MathUtils.lerp(
      this.world.params.Time_Scale,
      this.world.timeScaleTarget,
      0.2
    );
  }
}
