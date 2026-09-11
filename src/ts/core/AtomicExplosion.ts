import * as THREE from "three";
import { World } from "~/world/World";
import { IUpdatable } from "~/interfaces/IUpdatable";
import { Explosion } from "./Explosion";

type AtomicExplosionState = "flash" | "rising" | "mushroom" | "done";

export class AtomicExplosion extends THREE.Group implements IUpdatable {
  public updateOrder: number = 7;

  private world: World;
  private state: AtomicExplosionState = "flash";
  private age: number = 0;

  // Flash
  private flashMesh: THREE.Mesh;
  private flashDuration: number = 0.5;
  private flashMaxSize: number = 500;

  // Rising stalk
  private riseDuration: number = 5;
  private riseHeight: number = 600;
  private stalkParticlesPerSecond: number = 200;
  private timeSinceLastStalkParticle: number = 0;

  constructor(world: World, position: THREE.Vector3) {
    super();
    this.world = world;
    this.position.copy(position);

    // Initial flash
    const flashGeometry = new THREE.SphereGeometry(1, 32, 32);
    const flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
    });
    this.flashMesh = new THREE.Mesh(flashGeometry, flashMaterial);
    this.flashMesh.position.copy(position);
    this.world.sceneManager.graphicsWorld.add(this.flashMesh);

    this.world.entityManager.registerUpdatable(this);
  }

  public update(timeStep: number): void {
    this.age += timeStep;

    if (this.state === "flash") {
      const progress = this.age / this.flashDuration;
      if (progress < 1) {
        const scale = this.flashMaxSize * progress;
        this.flashMesh.scale.set(scale, scale, scale);
        (this.flashMesh.material as THREE.MeshBasicMaterial).opacity =
          0.9 * (1 - progress);
      } else {
        this.world.sceneManager.graphicsWorld.remove(this.flashMesh);
        this.state = "rising";
        this.age = 0; // Reset age for next stage
      }
    } else if (this.state === "rising") {
      this.timeSinceLastStalkParticle += timeStep;
      const timeBetweenParticles = 1 / this.stalkParticlesPerSecond;

      while (this.timeSinceLastStalkParticle > timeBetweenParticles) {
        const particlePosition = this.position.clone();
        const riseProgress = this.age / this.riseDuration;
        particlePosition.y += this.riseHeight * riseProgress;
        particlePosition.x += (Math.random() - 0.5) * 50;
        particlePosition.z += (Math.random() - 0.5) * 50;

        new Explosion(this.world, particlePosition, 2 + riseProgress * 4); // Particles get bigger as they rise
        this.timeSinceLastStalkParticle -= timeBetweenParticles;
      }

      if (this.age > this.riseDuration) {
        this.state = "mushroom";
        this.age = 0;
        const mushroomPosition = this.position.clone();
        mushroomPosition.y += this.riseHeight;
        new Explosion(this.world, mushroomPosition, 30); // The big mushroom head
      }
    } else if (this.state === "mushroom") {
      // The mushroom head explosion is self-managing.
      // We just wait a bit before cleaning up this manager.
      if (this.age > 5) {
        // Wait 5 seconds after mushroom head
        this.state = "done";
      }
    } else if (this.state === "done") {
      this.world.entityManager.unregisterUpdatable(this);
    }
  }
}
