import * as THREE from "three";
import { World } from "../world/World";

export class WeatherManager {
  private world: World;
  private rainParticles: THREE.Points | null = null;
  private isRaining: boolean = false;

  private isThunderstorming: boolean = false;
  private lightningLight: THREE.DirectionalLight | null = null;
  private lightningTimer: number = 0;
  private lightningDuration: number = 0.1; // seconds
  private lightningInterval: number = 3; // seconds between flashes
  private fog: THREE.FogExp2 | null = null;

  constructor(world: World) {
    this.world = world;
  }

  public startRain(): void {
    if (this.isRaining) return;

    const rainGeometry = new THREE.BufferGeometry();
    const positions: number[] = [];

    for (let i = 0; i < 10000; i++) {
      const x = Math.random() * 400 - 200;
      const y = Math.random() * 400 - 200;
      const z = Math.random() * 400 - 200;
      positions.push(x, y, z);
    }

    rainGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );

    const rainMaterial = new THREE.PointsMaterial({
      color: 0xaaaaaa,
      size: 0.5,
      transparent: true,
      opacity: 0.6,
      map: this.createRainDropTexture(),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.rainParticles = new THREE.Points(rainGeometry, rainMaterial);
    this.world.sceneManager.graphicsWorld.add(this.rainParticles);
    this.isRaining = true;
  }

  public stopRain(): void {
    if (!this.isRaining || !this.rainParticles) return;

    this.world.sceneManager.graphicsWorld.remove(this.rainParticles);
    this.rainParticles.geometry.dispose();
    (this.rainParticles.material as THREE.Material).dispose();
    this.rainParticles = null;
    this.isRaining = false;
  }

  public startThunderstorm(): void {
    if (this.isThunderstorming) return;

    this.isThunderstorming = true;
    this.startRain(); // Thunderstorms usually have rain

    // Add a lightning light source
    this.lightningLight = new THREE.DirectionalLight(0xffffff, 0); // Start with intensity 0
    this.lightningLight.position.set(0, 500, 0);
    this.world.sceneManager.graphicsWorld.add(this.lightningLight);

    // Add fog
    this.fog = new THREE.FogExp2(0x333333, 0.008);
    this.world.sceneManager.graphicsWorld.fog = this.fog;

    this.lightningTimer = this.lightningInterval; // Initial delay before first lightning
  }

  public stopThunderstorm(): void {
    if (!this.isThunderstorming) return;

    this.isThunderstorming = false;
    this.stopRain();

    // Remove lightning light
    if (this.lightningLight) {
      this.world.sceneManager.graphicsWorld.remove(this.lightningLight);
      this.lightningLight = null;
    }

    // Remove fog
    this.world.sceneManager.graphicsWorld.fog = null;
    this.fog = null;
  }

  public update(deltaTime: number): void {
    if (this.isRaining && this.rainParticles) {
      this.rainParticles.position.y -= 50 * deltaTime; // Rain falls
      if (this.rainParticles.position.y < -200) {
        this.rainParticles.position.y = 200; // Reset position
      }
    }

    if (this.isThunderstorming && this.lightningLight) {
      this.lightningTimer -= deltaTime;

      if (this.lightningTimer <= 0) {
        // Trigger lightning flash
        this.lightningLight.intensity = 1.5 + Math.random() * 2; // Random intensity
        this.lightningTimer = this.lightningInterval + Math.random() * 5; // Next flash interval
        setTimeout(() => {
          if (this.lightningLight) {
            this.lightningLight.intensity = 0; // Turn off after a short duration
          }
        }, this.lightningDuration * 1000);
      }
    }
  }

  private createRainDropTexture(): THREE.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const context = canvas.getContext("2d");
    if (context) {
      context.beginPath();
      context.arc(8, 8, 8, 0, Math.PI * 2);
      context.fillStyle = "#FFFFFF";
      context.fill();
    }
    return new THREE.CanvasTexture(canvas);
  }
}
