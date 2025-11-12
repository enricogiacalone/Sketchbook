import * as THREE from "three";
import { IUpdatable } from "~/interfaces/IUpdatable";
import { World } from "~/world/World";
import { Meteorite } from "./Meteorite";

export class MeteoriteTrail extends THREE.Object3D implements IUpdatable {
  public updateOrder: number = 5;

  private world: World;
  private meteorite: Meteorite;
  private trailLength: number = 2; // seconds
  private points: { position: THREE.Vector3; time: number }[] = [];
  private particles: THREE.Points;

  constructor(world: World, meteorite: Meteorite) {
    super();
    this.world = world;
    this.meteorite = meteorite;

    const vertexShader = `
            attribute float size;
            varying vec4 vColor;
            void main() {
                vColor = color;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = size * (300.0 / -mvPosition.z);
                gl_Position = projectionMatrix * mvPosition;
            }
        `;

    const fragmentShader = `
            varying vec4 vColor;
            void main() {
                gl_FragColor = vColor;
            }
        `;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(0xffffff) },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      vertexColors: true,
    });

    const geometry = new THREE.BufferGeometry();
    this.particles = new THREE.Points(geometry, material);
    this.add(this.particles);

    this.world.sceneManager.graphicsWorld.add(this);
    this.world.registerUpdatable(this);
  }

  public update(timeStep: number): void {
    const now = this.world.clock.getElapsedTime();

    // Add new point
    this.points.push({ position: this.meteorite.position.clone(), time: now });

    // Remove old points
    while (
      this.points.length > 0 &&
      now - this.points[0].time > this.trailLength
    ) {
      this.points.shift();
    }

    // Update geometry
    const positions = [];
    const colors = [];
    const sizes = [];

    for (const point of this.points) {
      const age = now - point.time;
      const alpha = 1 - age / this.trailLength;

      positions.push(point.position.x, point.position.y, point.position.z);
      colors.push(1, 1, 1, alpha);
      sizes.push(0.1);
    }

    const geometry = this.particles.geometry as THREE.BufferGeometry;
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
    geometry.setAttribute("size", new THREE.Float32BufferAttribute(sizes, 1));
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    geometry.attributes.size.needsUpdate = true;

    if (this.meteorite.isRemoved && this.points.length === 0) {
      this.removeFromWorld();
    }
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
