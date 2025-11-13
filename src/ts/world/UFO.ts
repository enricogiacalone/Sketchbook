import * as THREE from "three";
import { World } from "./World";
import { IWorldEntity } from "../interfaces/IWorldEntity";
import { IUpdatable } from "../interfaces/IUpdatable";
import { EntityType } from "../enums/EntityType";
import { LaserBeam } from "../core/LaserBeam"; // Import LaserBeam

export class UFO implements IWorldEntity, IUpdatable {
  public entityType: EntityType = EntityType.System; // Or a new EntityType.UFO
  public updateOrder: number = 2;

  public mesh: THREE.Mesh;

  private world: World;
  private speed: number = 5;
  private direction: THREE.Vector3;
  private targetPosition: THREE.Vector3;

  private laserFireInterval: number = 3; // Seconds between laser fires
  private laserFireTimer: number = 0;

  constructor(world: World, position: THREE.Vector3) {
    this.world = world;

    // Model (simple disc for now)
    const geometry = new THREE.CylinderGeometry(5, 5, 1, 32);
    const material = new THREE.MeshStandardMaterial({
      color: 0x888888,
      metalness: 0.8,
      roughness: 0.2,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(position);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    this.direction = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5
    ).normalize();
    this.targetPosition = this.getRandomTargetPosition();

    this.world.sceneManager.graphicsWorld.add(this.mesh);
    this.world.registerUpdatable(this);
  }

  public update(timeStep: number): void {
    const distanceToTarget = this.mesh.position.distanceTo(this.targetPosition);

    if (distanceToTarget < 10) {
      // If close to target, get a new one
      this.targetPosition = this.getRandomTargetPosition();
    }

    // Move towards target
    this.direction
      .subVectors(this.targetPosition, this.mesh.position)
      .normalize();
    this.mesh.position.add(
      this.direction.clone().multiplyScalar(this.speed * timeStep)
    );

    // Simple rotation
    this.mesh.rotation.y += 0.5 * timeStep;

    // Laser firing logic
    this.laserFireTimer += timeStep;
    if (this.laserFireTimer >= this.laserFireInterval) {
      this.fireLaser();
      this.laserFireTimer = 0;
    }
  }

  public removeFromWorld(): void {
    this.world.sceneManager.graphicsWorld.remove(this.mesh);
    this.world.unregisterUpdatable(this);
  }

  private getRandomTargetPosition(): THREE.Vector3 {
    const x = (Math.random() - 0.5) * 1000;
    const y = 100 + Math.random() * 100; // Keep it in the air
    const z = (Math.random() - 0.5) * 1000;
    return new THREE.Vector3(x, y, z);
  }

  private fireLaser(): void {
    const start = this.mesh.position.clone();
    const end = this.getRandomGroundPosition();
    this.world.registerUpdatable(new LaserBeam(this.world, start, end));
  }

  private getRandomGroundPosition(): THREE.Vector3 {
    const x = (Math.random() - 0.5) * 500; // Random X within a range
    const z = (Math.random() - 0.5) * 500; // Random Z within a range
    const y = 0; // Ground level
    return new THREE.Vector3(x, y, z);
  }
}
