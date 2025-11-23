import * as THREE from "three";
import { Cloud } from "./Cloud";
import { Sky } from "./Sky"; // Import Sky

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

export class CloudsGenerator {
  constructor(private sky: Sky) {}

  public generate(): void {
    for (let i = 0; i < CLOUD_BANK_COUNT; i++) {
      const bankCenter = new THREE.Vector3(
        (Math.random() - 0.5) * CLOUD_BANK_SPREAD_X,
        CLOUD_BANK_BASE_Y + (Math.random() - 0.5) * CLOUD_BANK_RANDOM_Y,
        (Math.random() - 0.5) * CLOUD_BANK_SPREAD_Z
      );

      for (let j = 0; j < CLOUDS_PER_BANK; j++) {
        const cloud = new Cloud(
          this.sky.world, // Pass the world from the sky instance
          CLOUD_SIZE_BASE + Math.random() * CLOUD_SIZE_RANDOM,
          CLOUD_OPACITY_BASE + Math.random() * CLOUD_OPACITY_RANDOM
        );
        cloud.group.position.set(
          bankCenter.x + (Math.random() - 0.5) * CLOUD_POSITION_RANDOM_X,
          bankCenter.y + (Math.random() - 0.5) * CLOUD_POSITION_RANDOM_Y,
          bankCenter.z + (Math.random() - 0.5) * CLOUD_POSITION_RANDOM_Z
        );
        this.sky.clouds.push(cloud);
      }
    }
  }
}
