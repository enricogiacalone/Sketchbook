import * as THREE from "three";
import { IUpdatable } from "~/interfaces/IUpdatable";
import { World } from "~/world/World";
import { createNoise3D } from "simplex-noise";
import { InterstellarVortex } from "./InterstellarVortex";

export class PsychedelicParticles extends THREE.Object3D implements IUpdatable {
  public updateOrder: number = 10;

  private world: World;
  private particles: THREE.Points;
  private velocities: THREE.Vector3[] = [];
  private simplex: any;
  private vortex: InterstellarVortex | null;

  constructor(world: World, count: number, vortex: InterstellarVortex | null) {
    super();
    this.world = world;
    this.simplex = createNoise3D();
    this.vortex = vortex;

    const vertexShader = `
            attribute float size;
            attribute vec3 velocity;
            varying vec3 vVelocity;
            void main() {
                vVelocity = velocity;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = size * (300.0 / -mvPosition.z);
                gl_Position = projectionMatrix * mvPosition;
            }
        `;

    const fragmentShader = `
            varying vec3 vVelocity;
            uniform float time;
            void main() {
                float speed = length(vVelocity);
                vec3 color = vec3(
                    0.5 + 0.5 * sin(speed * 0.05 + time * 0.1),
                    0.5 + 0.5 * sin(speed * 0.05 + time * 0.2),
                    0.5 + 0.5 * sin(speed * 0.05 + time * 0.3)
                );
                gl_FragColor = vec4(color, 1.0);
            }
        `;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0.0 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
    });

    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const velocities = [];
    const sizes = [];

    for (let i = 0; i < count; i++) {
      positions.push(
        (Math.random() - 0.5) * 400,
        Math.random() * 200,
        (Math.random() - 0.5) * 400
      );
      velocities.push(0, 0, 0);
      this.velocities.push(new THREE.Vector3());
      sizes.push(Math.random() * 5 + 2);
    }

    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );
    geometry.setAttribute(
      "velocity",
      new THREE.Float32BufferAttribute(velocities, 3)
    );
    geometry.setAttribute("size", new THREE.Float32BufferAttribute(sizes, 1));

    this.particles = new THREE.Points(geometry, material);
    this.add(this.particles);

    this.world.sceneManager.graphicsWorld.add(this);
    this.world.entityManager.registerUpdatable(this);
  }

  public update(timeStep: number): void {
    const positions = this.particles.geometry.attributes
      .position as THREE.BufferAttribute;
    const velocities = this.particles.geometry.attributes
      .velocity as THREE.BufferAttribute;
    const sizes = this.particles.geometry.attributes
      .size as THREE.BufferAttribute;
    const time = this.world.clock.getElapsedTime();
    (this.particles.material as THREE.ShaderMaterial).uniforms.time.value =
      time;

    const player = this.world.characters[0];
    // const vortexCenter = this.vortex.position; // Assuming vortex position is its center

    for (let i = 0; i < positions.count; i++) {
      const pos = new THREE.Vector3(
        positions.getX(i),
        positions.getY(i),
        positions.getZ(i)
      );

      // Noise
      const noise = this.simplex(pos.x * 0.005, pos.y * 0.005, time * 0.2) * 50;
      this.velocities[i].add(
        new THREE.Vector3(
          Math.sin(noise),
          Math.cos(noise),
          Math.sin(noise * 0.5)
        ).multiplyScalar(timeStep * 30)
      );

      // Gravity
      const gravity = new THREE.Vector3(0, -0.1, 0);
      this.velocities[i].add(gravity.multiplyScalar(timeStep));

      // Anti-gravity burst
      if (Math.random() < 0.001) {
        this.velocities[i].add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 50,
            Math.random() * 50,
            (Math.random() - 0.5) * 50
          )
        );
      }

      // Repulsion from player
      if (player) {
        const distance = pos.distanceTo(player.position);
        if (distance < 30) {
          const repulsion = new THREE.Vector3()
            .subVectors(pos, player.position)
            .normalize()
            .multiplyScalar(100 / distance);
          this.velocities[i].add(repulsion.multiplyScalar(timeStep));
        }
      }

      // // Attraction to vortex
      // const distanceToVortex = pos.distanceTo(vortexCenter);
      // if (distanceToVortex > 5) { // Don't attract if too close to avoid extreme forces
      //     const attraction = new THREE.Vector3().subVectors(vortexCenter, pos).normalize().multiplyScalar(200 / (distanceToVortex * distanceToVortex));
      //     this.velocities[i].add(attraction.multiplyScalar(timeStep));
      // } else {
      //     // Absorb and re-emit
      //     positions.setXYZ(
      //         i,
      //         (Math.random() - 0.5) * 400,
      //         Math.random() * 200,
      //         (Math.random() - 0.5) * 400
      //     );
      //     this.velocities[i].set(0, 0, 0); // Reset velocity
      // }

      // Update position and velocity
      positions.setXYZ(
        i,
        pos.x + this.velocities[i].x * timeStep,
        pos.y + this.velocities[i].y * timeStep,
        pos.z + this.velocities[i].z * timeStep
      );
      velocities.setXYZ(
        i,
        this.velocities[i].x,
        this.velocities[i].y,
        this.velocities[i].z
      );

      // Update size
      sizes.setX(i, (Math.sin(time * 3 + i) * 0.5 + 0.5) * 4 + 1);

      // Damping
      this.velocities[i].multiplyScalar(1 - 0.3 * timeStep);
    }

    positions.needsUpdate = true;
    velocities.needsUpdate = true;
    sizes.needsUpdate = true;
  }
}
