import * as THREE from "three";
import { World } from "./World";

export class Cloud {
  public group: THREE.Group;

  constructor(world: World, size: number = 100, opacity: number = 1) {
    this.group = new THREE.Group();
    world.sceneManager.graphicsWorld.add(this.group);

    const texture = this.createCloudTexture(opacity);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });

    for (let i = 0; i < 10; i++) {
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        material
      );
      plane.position.set(
        (Math.random() - 0.5) * (size * 0.8),
        (Math.random() - 0.5) * (size * 0.3),
        (Math.random() - 0.5) * (size * 0.8)
      );
      plane.rotation.x = Math.random() * Math.PI;
      plane.rotation.y = Math.random() * Math.PI;
      plane.rotation.z = Math.random() * Math.PI;
      this.group.add(plane);
    }
  }

  private createCloudTexture(opacity: number): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Failed to get 2d context");
    }

    const gradient = context.createRadialGradient(
      canvas.width / 2,
      canvas.height / 2,
      0,
      canvas.width / 2,
      canvas.height / 2,
      canvas.width / 2
    );
    gradient.addColorStop(0, `rgba(255,255,255,${opacity})`);
    gradient.addColorStop(1, "rgba(255,255,255,0)");

    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    return new THREE.CanvasTexture(canvas);
  }
}
