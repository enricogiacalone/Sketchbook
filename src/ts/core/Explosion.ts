import * as THREE from "three";
import { World } from "~/world/World";
import { IUpdatable } from "~/interfaces/IUpdatable";
import { Character } from "../characters/Character";
import { EntityType } from "../enums/EntityType";

interface ExplosionParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  lifetime: number; // seconds
  age: number;
  initialScale: number;
}

export class Explosion extends THREE.Group implements IUpdatable {
  public updateOrder: number = 6; // Update after bullets

  private world: World;
  private particles: ExplosionParticle[] = [];
  private particleCount: number = 100;
  private maxParticleSpeed: number = 60;
  private maxParticleLifetime: number = 3.0; // seconds
  private radius: number = 20;
  private damage: number = 50;
  private explosionScale: number;

  constructor(
    world: World,
    position: THREE.Vector3,
    explosionScale: number = 1
  ) {
    super();
    this.world = world;
    this.position.copy(position);
    this.explosionScale = explosionScale;

    this.particleCount = Math.floor(this.particleCount * explosionScale);
    this.maxParticleSpeed *= explosionScale;
    this.maxParticleLifetime *= explosionScale;
    this.radius *= explosionScale;
    this.damage *= explosionScale;

    this.world.sceneManager.graphicsWorld.add(this);
    this.world.entityManager.registerUpdatable(this);

    this.createParticles();
    this.applyRadiusDamage();
  }

  private applyRadiusDamage(): void {
    this.world.physicsManager.physicsWorld.bodies.forEach((body) => {
      if (body.userData instanceof Character) {
        const character = body.userData as Character;
        const distance = character.position.distanceTo(this.position);

        if (distance < this.radius) {
          const damage = this.damage * (1 - distance / this.radius);
          character.takeDamage(damage);
        }
      }
    });
  }

  private createParticles(): void {
    const fireParticleCount = this.particleCount * 0.6;
    const smokeParticleCount = this.particleCount * 0.4;

    // Create fire particles
    for (let i = 0; i < fireParticleCount; i++) {
      const size = (Math.random() * 1.0 + 0.5) * this.explosionScale; // 0.5 to 1.5
      const geometry = new THREE.SphereGeometry(size, 8, 8);
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(1, Math.random() * 0.5, 0), // Red-Orange-Yellow
        transparent: true,
        opacity: 1,
      });

      const mesh = new THREE.Mesh(geometry, material);
      this.add(mesh);

      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2
      )
        .normalize()
        .multiplyScalar(Math.random() * this.maxParticleSpeed);

      this.particles.push({
        mesh,
        velocity,
        lifetime: Math.random() * this.maxParticleLifetime * 0.5 + 0.1, // Shorter lifetime for fire
        age: 0,
        initialScale: size,
      });
    }

    // Create smoke particles
    for (let i = 0; i < smokeParticleCount; i++) {
      const size = (Math.random() * 2.0 + 1.0) * this.explosionScale; // 1.0 to 3.0
      const geometry = new THREE.SphereGeometry(size, 8, 8);
      const grey = Math.random() * 0.2 + 0.1; // Dark grey
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(grey, grey, grey),
        transparent: true,
        opacity: 0.7,
      });

      const mesh = new THREE.Mesh(geometry, material);
      this.add(mesh);

      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2
      )
        .normalize()
        .multiplyScalar(Math.random() * this.maxParticleSpeed * 0.5); // Slower speed for smoke

      this.particles.push({
        mesh,
        velocity,
        lifetime: Math.random() * this.maxParticleLifetime + 0.5, // Longer lifetime for smoke
        age: 0,
        initialScale: size,
      });
    }
  }

  public update(timeStep: number): void {
    let allParticlesDead = true;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      particle.age += timeStep;

      if (particle.age < particle.lifetime) {
        allParticlesDead = false;

        // Move particle
        particle.mesh.position.add(
          particle.velocity.clone().multiplyScalar(timeStep)
        );

        // Fade out
        const progress = particle.age / particle.lifetime;
        (particle.mesh.material as THREE.MeshBasicMaterial).opacity =
          1 - progress;

        // Optional: shrink particle
        const currentScale = particle.initialScale * (1 - progress);
        particle.mesh.scale.set(currentScale, currentScale, currentScale);
      } else {
        // Remove dead particle
        this.remove(particle.mesh);
        particle.mesh.geometry.dispose();
        (particle.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
      }
    }

    // If all particles are dead, remove the explosion group itself
    if (allParticlesDead && this.particles.length === 0) {
      this.world.sceneManager.graphicsWorld.remove(this);
      this.world.entityManager.unregisterUpdatable(this);
    }
  }
}
