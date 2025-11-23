import * as THREE from "three";
import { Planet } from "./Planet";
import { Sky } from "./Sky"; // Import Sky

// Constants for planet generation
const PLANET_COUNT = 3;
const PLANET_SIZE_BASE = 50;
const PLANET_SIZE_RANDOM = 50;
const PLANET_POSITION_RANDOM_X = 1500;
const PLANET_POSITION_BASE_Y = 200;
const PLANET_POSITION_RANDOM_Y = 200;
const PLANET_POSITION_RANDOM_Z = 1500;

export class PlanetsGenerator {
  constructor(private sky: Sky) {}

  public generate(): void {
    for (let i = 0; i < PLANET_COUNT; i++) {
      const color = new THREE.Color(
        Math.random(),
        Math.random(),
        Math.random()
      );
      const size = PLANET_SIZE_BASE + Math.random() * PLANET_SIZE_RANDOM;
      const planet = new Planet(
        this.sky.world, // Pass the world from the sky instance
        this.sky.world.physicsManager,
        color,
        size
      );
      planet.setPosition(
        (Math.random() - 0.5) * PLANET_POSITION_RANDOM_X,
        PLANET_POSITION_BASE_Y + Math.random() * PLANET_POSITION_RANDOM_Y,
        (Math.random() - 0.5) * PLANET_POSITION_RANDOM_Z
      );
      planet.mesh.renderOrder = -1; // Render planets behind clouds
      this.sky.planets.push(planet);
      this.sky.world.entityManager.add(planet);
    }
  }
}
