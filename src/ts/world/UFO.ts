import * as THREE from "three";
import { World } from "./World";
import { IWorldEntity } from "../interfaces/IWorldEntity";
import { IUpdatable } from "../interfaces/IUpdatable";
import { EntityType } from "../enums/EntityType";

export class UFO implements IWorldEntity, IUpdatable {
  public entityType: EntityType = EntityType.System; // Or a new EntityType.UFO
  public updateOrder: number = 2;

  public mesh: THREE.Mesh;

  private world: World;
  private speed: number = 5;
  private direction: THREE.Vector3;
  private targetPosition: THREE.Vector3;

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
}
