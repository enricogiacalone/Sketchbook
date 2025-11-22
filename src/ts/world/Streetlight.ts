import * as THREE from "three";
import { World } from "./World";

export class Streetlight extends THREE.Object3D {
  private world: World;
  private pole: THREE.Mesh;
  private lamp: THREE.Mesh;
  public pointLight: THREE.PointLight;

  constructor(world: World, position: THREE.Vector3) {
    super();
    this.world = world;

    // Create pole
    const poleGeometry = new THREE.CylinderGeometry(0.1, 0.1, 5, 8);
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
    this.pole = new THREE.Mesh(poleGeometry, poleMaterial);
    this.pole.position.y = 2.5; // Half of height to sit on ground
    this.add(this.pole);

    // Create lamp housing
    const lampGeometry = new THREE.SphereGeometry(0.3, 16, 16);
    const lampMaterial = new THREE.MeshStandardMaterial({ color: 0xcccccc });
    this.lamp = new THREE.Mesh(lampGeometry, lampMaterial);
    this.lamp.position.y = 5.2; // Slightly above the pole
    this.add(this.lamp);

    // Create point light
    this.pointLight = new THREE.PointLight(0xffccaa, 0, 50, 2); // Warm light, initially off
    this.pointLight.position.set(0, 5.5, 0); // Position at the lamp
    this.add(this.pointLight);
    this.pointLight.castShadow = true;
    this.pointLight.shadow.mapSize.width = 1024;
    this.pointLight.shadow.mapSize.height = 1024;
    this.pointLight.shadow.camera.near = 0.5;
    this.pointLight.shadow.camera.far = 100; // Increased to match light distance

    this.position.copy(position);
    this.world.sceneManager.graphicsWorld.add(this);
  }

      public turnOn(): void {
          this.pointLight.intensity = 8; // Further increased intensity (to 8)
          this.pointLight.distance = 150; // Further increased reach
          this.pointLight.decay = 0.5; // Even slower falloff
          this.pointLight.shadow.camera.far = 150; // Updated to match new distance
          console.log('Streetlight turned ON');
      }
  public turnOff(): void {
    this.pointLight.intensity = 0;
    console.log('Streetlight turned OFF');
  }

  public update(timeOfDay: number): void {
    const isNightTime = timeOfDay >= 18 || timeOfDay < 6;
    if (isNightTime) {
      this.turnOn();
    } else {
      this.turnOff();
    }
  }
}
