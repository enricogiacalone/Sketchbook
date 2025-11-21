import * as THREE from "three";
import { IUpdatable } from "~/interfaces/IUpdatable";
import { World } from "~/world/World";

export class BulletImpactEffect extends THREE.Mesh implements IUpdatable {
  public updateOrder: number = 2; // Update after characters

  private world: World;
  private lifetime: number = 0.2; // seconds
  private age: number = 0;
  private initialScale: number = 0.1;

  constructor(world: World, position: THREE.Vector3, normal: THREE.Vector3) {
    super(
      new THREE.SphereGeometry(0.05, 8, 8), // Small sphere for impact
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 1,
      }) // White, fading effect
    );

    this.world = world;
    this.position.copy(position);
    this.scale.set(this.initialScale, this.initialScale, this.initialScale);

    // Orient the effect to face away from the impact normal
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      normal
    );
    this.setRotationFromQuaternion(quaternion);

    this.world.sceneManager.graphicsWorld.add(this);
    this.world.entityManager.registerUpdatable(this);
  }

  public update(timeStep: number): void {
    this.age += timeStep;

    // Fade out and scale down
    const progress = this.age / this.lifetime;
    if (this.material instanceof THREE.MeshBasicMaterial) {
      this.material.opacity = 1 - progress;
    }
    const scale = this.initialScale * (1 - progress);
    this.scale.set(scale, scale, scale);

    if (this.age > this.lifetime) {
      this.removeEffect();
    }
  }

  private removeEffect(): void {
    this.world.sceneManager.graphicsWorld.remove(this);
    this.world.entityManager.unregisterUpdatable(this);
    this.geometry.dispose();
    if (this.material instanceof THREE.Material) {
      this.material.dispose();
    }
  }
}
