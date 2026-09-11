import * as THREE from "three";
import { IUpdatable } from "~/interfaces/IUpdatable";
import { World } from "~/world/World";

export class BulletTrail extends THREE.Object3D implements IUpdatable {
  public updateOrder: number = 4; // Update before bullet, after impact effect

  private world: World;
  private trailLength: number = 0.5; // seconds
  private age: number = 0;
  private points: THREE.Vector3[] = [];
  private line: THREE.Line;
  private maxPoints: number = 20; // Number of segments in the trail
  private pointInterval: number = 0.02; // Time between adding new points
  private lastPointTime: number = 0;

  constructor(world: World, initialPosition: THREE.Vector3) {
    super();
    this.world = world;

    // Initialize with the bullet's starting position
    this.points.push(initialPosition.clone());

    const material = new THREE.LineBasicMaterial({
      color: 0xffff00, // Yellow trail
      transparent: true,
      opacity: 1,
      linewidth: 2, // This might not work on all platforms/renderers
    });
    const geometry = new THREE.BufferGeometry();
    this.line = new THREE.Line(geometry, material);
    this.add(this.line);

    this.world.sceneManager.graphicsWorld.add(this);
    this.world.entityManager.registerUpdatable(this);
  }

  public addPoint(position: THREE.Vector3): void {
    this.points.push(position.clone());
    if (this.points.length > this.maxPoints) {
      this.points.shift(); // Remove the oldest point
    }
    this.updateGeometry();
  }

  private updateGeometry(): void {
    const positions = [];
    const colors = [];
    const color = new THREE.Color(0xffff00); // Yellow

    for (let i = 0; i < this.points.length; i++) {
      const point = this.points[i];
      positions.push(point.x, point.y, point.z);

      // Fade color along the trail
      const alpha = i / this.points.length;
      colors.push(color.r, color.g, color.b, alpha);
    }

    const geometry = this.line.geometry as THREE.BufferGeometry;
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
    geometry.setDrawRange(0, this.points.length);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  }

  public update(timeStep: number): void {
    this.age += timeStep;

    // Fade out the entire trail over its lifetime
    const material = this.line.material as THREE.LineBasicMaterial;
    material.opacity = 1 - this.age / this.trailLength;

    if (this.age > this.trailLength) {
      this.removeTrail();
    }
  }

  public removeTrail(): void {
    this.world.sceneManager.graphicsWorld.remove(this);
    this.world.entityManager.unregisterUpdatable(this);
    this.line.geometry.dispose();
    if (this.line.material instanceof THREE.Material) {
      this.line.material.dispose();
    }
  }
}
