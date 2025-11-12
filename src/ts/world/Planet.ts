import * as THREE from "three";
import * as CANNON from "cannon-es";
import { World } from "./World";
import { PhysicsManager } from "../core/PhysicsManager";

export class Planet {
  public mesh: THREE.Mesh;
  public body: CANNON.Body;

  constructor(
    world: World,
    physicsManager: PhysicsManager,
    textureColor: THREE.Color,
    size: number
  ) {
    const texture = this.createPlanetTexture(textureColor);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
    });
    const geometry = new THREE.SphereGeometry(size, 32, 32);
    this.mesh = new THREE.Mesh(geometry, material);
    world.sceneManager.graphicsWorld.add(this.mesh);

    // Create CANNON.Body
    const shape = new CANNON.Sphere(size);
    this.body = new CANNON.Body({
      mass: 0, // Static body
      shape: shape,
      material: physicsManager.solidMaterial, // Use a generic solid material for now
    });
    physicsManager.physicsWorld.addBody(this.body);
  }

  public setPosition(x: number, y: number, z: number): void {
    this.mesh.position.set(x, y, z);
    this.body.position.set(x, y, z);
  }

  public update(): void {
    this.mesh.position.copy(this.body.position as any);
    this.mesh.quaternion.copy(this.body.quaternion as any);
  }

  private createPlanetTexture(color: THREE.Color): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Failed to get 2d context");
    }

    // Ensure 'color' is a proper THREE.Color instance
    const safeColor = new THREE.Color().copy(color);

    // Base color
    context.fillStyle = "#" + safeColor.getHexString();
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Add some noise
    for (let i = 0; i < 1000; i++) {
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height;
      const alpha = Math.random() * 0.2;
      context.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      context.beginPath();
      context.arc(x, y, Math.random() * 2, 0, Math.PI * 2);
      context.fill();
    }

    return new THREE.CanvasTexture(canvas);
  }
}
