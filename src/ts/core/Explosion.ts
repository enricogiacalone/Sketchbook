import * as THREE from "three";
import { World } from "~/world/World";
import { IUpdatable } from "~/interfaces/IUpdatable";

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
    private particleCount: number = 15;
    private maxParticleSpeed: number = 10;
    private maxParticleLifetime: number = 1.0; // seconds

    constructor(world: World, position: THREE.Vector3) {
        super();
        this.world = world;
        this.position.copy(position);

        this.world.sceneManager.graphicsWorld.add(this);
        this.world.registerUpdatable(this);

        this.createParticles();
    }

    private createParticles(): void {
        for (let i = 0; i < this.particleCount; i++) {
            const size = Math.random() * 0.2 + 0.05; // Random size between 0.05 and 0.25
            const geometry = new THREE.SphereGeometry(size, 8, 8);
            const material = new THREE.MeshBasicMaterial({
                color: new THREE.Color(Math.random(), Math.random() * 0.5, 0), // Shades of orange/red/yellow
                transparent: true,
                opacity: 1,
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(
                (Math.random() - 0.5) * 0.5, // Random initial offset
                (Math.random() - 0.5) * 0.5,
                (Math.random() - 0.5) * 0.5
            );
            this.add(mesh);

            const velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2
            ).normalize().multiplyScalar(Math.random() * this.maxParticleSpeed);

            this.particles.push({
                mesh,
                velocity,
                lifetime: Math.random() * this.maxParticleLifetime + 0.2, // Random lifetime
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
                particle.mesh.position.add(particle.velocity.clone().multiplyScalar(timeStep));

                // Fade out
                const progress = particle.age / particle.lifetime;
                (particle.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - progress;

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
            this.world.unregisterUpdatable(this);
        }
    }
}