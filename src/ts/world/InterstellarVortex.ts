import * as THREE from "three";
import { IUpdatable } from "~/interfaces/IUpdatable";
import { World } from "~/world/World";
import { createNoise3D } from "simplex-noise";

export class InterstellarVortex extends THREE.Object3D implements IUpdatable {
  public updateOrder: number = 10;

  private world: World;
  private particles: THREE.Points;
  private velocities: THREE.Vector3[] = [];
  private simplex: any;
  public center: THREE.Vector3; // Made public for PsychedelicParticles
  private baseRadius: number = 10; // Narrower base
  private topRadius: number = 60; // Wider top
  private height: number = 150; // Taller
  private particleCount: number;

  constructor(
    world: World,
    center: THREE.Vector3,
    particleCount: number = 2000 // Revert particle count
  ) {
    super();
    this.world = world;
    this.center = center;
    this.particleCount = particleCount;
    this.simplex = createNoise3D();

    const vertexShader = `
            attribute float size;
            attribute vec3 customColor;
            varying vec3 vColor;
            void main() {
                vColor = customColor;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = size * (300.0 / -mvPosition.z);
                gl_Position = projectionMatrix * mvPosition;
            }
        `;

    const fragmentShader = `
            varying vec3 vColor;
            void main() {
                gl_FragColor = vec4(vColor, 1.0);
            }
        `;

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
    });

    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const colors = [];
    const sizes = [];

    for (let i = 0; i < this.particleCount; i++) {
      const y = (Math.random() - 0.5) * this.height;
      const currentRadius = THREE.MathUtils.lerp(
        this.baseRadius,
        this.topRadius,
        (y + this.height / 2) / this.height
      );
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * currentRadius;
      const x = r * Math.cos(angle);
      const z = r * Math.sin(angle);

      positions.push(this.center.x + x, this.center.y + y, this.center.z + z);
      colors.push(Math.random(), Math.random(), Math.random()); // Revert colors
      sizes.push(Math.random() * 3 + 1); // Revert sizes
      this.velocities.push(new THREE.Vector3());
    }

    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );
    geometry.setAttribute(
      "customColor",
      new THREE.Float32BufferAttribute(colors, 3)
    );
    geometry.setAttribute("size", new THREE.Float32BufferAttribute(sizes, 1));

    this.particles = new THREE.Points(geometry, material);
    this.add(this.particles);

    this.world.sceneManager.graphicsWorld.add(this);
    this.world.registerUpdatable(this);
  }

  public update(timeStep: number): void {
    const positions = this.particles.geometry.attributes
      .position as THREE.BufferAttribute;
    const colors = this.particles.geometry.attributes
      .customColor as THREE.BufferAttribute;
    const sizes = this.particles.geometry.attributes
      .size as THREE.BufferAttribute;
    const time = this.world.clock.getElapsedTime();

    for (let i = 0; i < this.particleCount; i++) {
      const pos = new THREE.Vector3(
        positions.getX(i),
        positions.getY(i),
        positions.getZ(i)
      );
      const localPos = pos.clone().sub(this.center);

      // Swirling motion
      const angle = Math.atan2(localPos.z, localPos.x);
      const r = localPos.length();
      const newAngle = angle + timeStep * 1.5; // Increased swirl speed
      const newX = r * Math.cos(newAngle);
      const newZ = r * Math.sin(newAngle);

      // Noise for turbulence
      const noise =
        this.simplex(pos.x * 0.01, pos.y * 0.01, pos.z * 0.01 + time * 0.1) *
        0.5;
      localPos.x = newX + noise;
      localPos.z = newZ + noise;

      // Vertical suction (stronger at the bottom)
      const yNormalized = (localPos.y + this.height / 2) / this.height; // 0 at bottom, 1 at top
      const suctionStrength = (1 - yNormalized) * 0.5; // Stronger at bottom
      this.velocities[i].y -= suctionStrength * timeStep * 20; // Pull downwards

      // Update position
      positions.setXYZ(
        i,
        this.center.x + localPos.x,
        this.center.y + localPos.y,
        this.center.z + localPos.z
      );

      // Dynamic colors
      colors.setXYZ(
        i,
        0.5 + 0.5 * Math.sin(time * 0.5 + i * 0.1),
        0.5 + 0.5 * Math.sin(time * 0.7 + i * 0.1),
        0.5 + 0.5 * Math.sin(time * 0.9 + i * 0.1)
      );

      // Size variation
      sizes.setX(i, (Math.sin(time * 3 + i) * 0.5 + 0.5) * 4 + 1);

      // Damping
      this.velocities[i].multiplyScalar(1 - 0.1 * timeStep);

      // Reset particles if they go too far or too low
      if (
        localPos.length() > this.topRadius * 2 ||
        localPos.y < -this.height / 2 - 20
      ) {
        const y = (Math.random() - 0.5) * this.height;
        const currentRadius = THREE.MathUtils.lerp(
          this.baseRadius,
          this.topRadius,
          (y + this.height / 2) / this.height
        );
        const angle = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * currentRadius;
        const x = r * Math.cos(angle);
        const z = r * Math.sin(angle);
        positions.setXYZ(
          i,
          this.center.x + x,
          this.center.y + y,
          this.center.z + z
        );
        this.velocities[i].set(0, 0, 0);
      }
    }

    positions.needsUpdate = true;
    colors.needsUpdate = true;
    sizes.needsUpdate = true;
  }

  public removeFromWorld(): void {
    this.world.sceneManager.graphicsWorld.remove(this);
    this.world.unregisterUpdatable(this);
    this.particles.geometry.dispose();
    if (this.particles.material instanceof THREE.Material) {
      this.particles.material.dispose();
    }
  }
}
