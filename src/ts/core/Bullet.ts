import * as THREE from "three";
import { IUpdatable } from "~/interfaces/IUpdatable";
import { World } from "~/world/World";

export class Bullet extends THREE.Mesh implements IUpdatable {
  public updateOrder: number = 5; // Update after camera and characters

  private world: World;
  private velocity: THREE.Vector3;
  private lifetime: number = 2; // seconds
  private age: number = 0;

  constructor(world: World, position: THREE.Vector3, direction: THREE.Vector3) {
    super(
      new THREE.SphereGeometry(0.05, 8, 8), // Small sphere for bullet
      new THREE.MeshBasicMaterial({ color: 0xffff00 }) // Yellow bullet
    );

    this.world = world;
    this.position.copy(position);
    this.velocity = direction.clone().multiplyScalar(50); // Bullet speed

    this.world.sceneManager.graphicsWorld.add(this);
    this.world.registerUpdatable(this);
  }

  public update(timeStep: number): void {
    this.age += timeStep;

    // Move the bullet
    this.position.add(this.velocity.clone().multiplyScalar(timeStep));

    // Remove if lifetime expired
    if (this.age > this.lifetime) {
      this.world.sceneManager.graphicsWorld.remove(this);
      this.world.unregisterUpdatable(this);
    }
  }
}
