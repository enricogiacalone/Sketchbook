import * as THREE from "three";
import { CSM } from "three/addons/csm/CSM.js";
import { SkyShader } from "~/lib/shaders/SkyShader";
import { IUpdatable } from "~/interfaces/IUpdatable";
import { World } from "~/world/World";

export class Sky extends THREE.Object3D implements IUpdatable {
  public updateOrder: number = 5;

  public sunPosition: THREE.Vector3 = new THREE.Vector3();
  public csm: CSM;

  public timeOfDay: number = 12; // 0-24 hours

  // Constants for day/night cycle
  private readonly DAY_LENGTH: number = 240; // seconds for a full day (24 hours) - Longer day
  private readonly SUNRISE_HOUR: number = 6;
  private readonly SUNSET_HOUR: number = 18;
  private readonly NOON_HOUR: number = 12;
  private readonly MIDNIGHT_HOUR: number = 0;

  set theta(value: number) {
    this._theta = value;
    this.refreshSunPosition();
  }

  set phi(value: number) {
    this._phi = value;
    this.refreshSunPosition();
    this.refreshHemiIntensity();
  }

  private _phi: number = 50;
  private _theta: number = 145;

  private hemiLight: THREE.HemisphereLight;
  private maxHemiIntensity: number = 0.9;
  private minHemiIntensity: number = 0.05; // Decreased for darker night

  private skyMesh: THREE.Mesh;
  private skyMaterial: THREE.ShaderMaterial;

  private world: World;

  constructor(world: World) {
    super();

    this.world = world;

    // Sky material
    this.skyMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(SkyShader.uniforms),
      fragmentShader: SkyShader.fragmentShader,
      vertexShader: SkyShader.vertexShader,
      side: THREE.BackSide,
    });

    // Mesh
    this.skyMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1000, 24, 12),
      this.skyMaterial
    );
    this.attach(this.skyMesh);

    // Ambient light
    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 1.0);
    this.refreshHemiIntensity();
    this.hemiLight.color.setHSL(0.59, 0.4, 0.6); // Default daytime colors
    this.hemiLight.groundColor.setHSL(0.095, 0.2, 0.75);
    this.hemiLight.position.set(0, 50, 0);
    this.world.sceneManager.graphicsWorld.add(this.hemiLight);

    // CSM
    this.csm = new CSM({
      lightIntensity: 2.5,
      cascades: 3,
      shadowMapSize: 1024,
      camera: world.sceneManager.camera,
      parent: world.sceneManager.graphicsWorld,
    });
    this.csm.fade = true;
    this.csm.updateFrustums();

    // Initial sun position and light settings based on initial timeOfDay
    this.updateSunAndLighting();

    world.sceneManager.graphicsWorld.add(this);
    this.world.entityManager.registerUpdatable(this);
  }

  public update(timeScale: number): void {
    // Update time of day
    this.timeOfDay = (this.timeOfDay + (timeScale / this.DAY_LENGTH) * 24) % 24;

    this.updateSunAndLighting();

    this.position.copy(this.world.sceneManager.camera.position);

    this.csm.update();
    this.csm.lightDirection = new THREE.Vector3(
      -this.sunPosition.x,
      -this.sunPosition.y,
      -this.sunPosition.z
    ).normalize();
  }

  private updateSunAndLighting(): void {
    // Calculate sun elevation (_phi) based on timeOfDay
    // _phi goes from 0 (midnight) to 180 (noon) and back to 0 (midnight)
    // A simplified sine wave can approximate this
    const hourFactor = (this.timeOfDay - this.NOON_HOUR) / 12; // -1 at midnight, 0 at noon, 1 at next midnight
    this._phi = 90 - Math.sin(hourFactor * Math.PI) * 90; // 0-180 degrees, 90 is directly overhead

    // Calculate sun azimuth (_theta) - roughly based on time of day
    // This makes the sun move across the sky
    this._theta = 270 + (this.timeOfDay / 24) * 360; // Full circle over 24 hours

    this.refreshSunPosition();
    this.refreshHemiIntensity();
    this.refreshDirectionalLight();
  }

  public refreshSunPosition(): void {
    const sunDistance = 10;

    this.sunPosition.x =
      sunDistance *
      Math.sin((this._theta * Math.PI) / 180) *
      Math.cos((this._phi * Math.PI) / 180);
    this.sunPosition.y = sunDistance * Math.sin((this._phi * Math.PI) / 180);
    this.sunPosition.z =
      sunDistance *
      Math.cos((this._theta * Math.PI) / 180) *
      Math.cos((this._phi * Math.PI) / 180);

    this.skyMaterial.uniforms.sunPosition.value.copy(this.sunPosition);
    this.skyMaterial.uniforms.cameraPos.value.copy(
      this.world.sceneManager.camera.position
    );
  }

  public refreshHemiIntensity(): void {
    // Adjust hemisphere light intensity based on sun elevation
    // Brighter during day, darker at night
    const elevationFactor = Math.max(0, Math.sin((this._phi * Math.PI) / 180)); // 0-1 based on sun elevation
    this.hemiLight.intensity =
      this.minHemiIntensity +
      elevationFactor * (this.maxHemiIntensity - this.minHemiIntensity);

    // Adjust hemisphere light color for sunset/sunrise
    const sunsetFactor =
      1 - Math.max(0, (Math.abs(this.timeOfDay - this.NOON_HOUR) - 3) / 9); // Peaks at sunset/sunrise hours (e.g., 6 and 18)
    const nightFactor =
      1 - Math.max(0, (Math.abs(this.timeOfDay - this.MIDNIGHT_HOUR) - 3) / 9); // Peaks at midnight

    // Daytime color
    let r = 0.59;
    let g = 0.4;
    let b = 0.6;
    let groundR = 0.095;
    let groundG = 0.2;
    let groundB = 0.75;

    // Sunset/sunrise colors
    if (
      this.timeOfDay > this.SUNRISE_HOUR - 3 &&
      this.timeOfDay < this.SUNRISE_HOUR + 3
    ) {
      // Sunrise window
      const factor = 1 - Math.abs(this.timeOfDay - this.SUNRISE_HOUR) / 3;
      r = THREE.MathUtils.lerp(r, 0.9, factor); // More red
      g = THREE.MathUtils.lerp(g, 0.5, factor); // Warmer
      b = THREE.MathUtils.lerp(b, 0.3, factor);
      groundR = THREE.MathUtils.lerp(groundR, 0.3, factor);
      groundG = THREE.MathUtils.lerp(groundG, 0.1, factor);
      groundB = THREE.MathUtils.lerp(groundB, 0.05, factor);
    } else if (
      this.timeOfDay > this.SUNSET_HOUR - 3 &&
      this.timeOfDay < this.SUNSET_HOUR + 3
    ) {
      // Sunset window
      const factor = 1 - Math.abs(this.timeOfDay - this.SUNSET_HOUR) / 3;
      r = THREE.MathUtils.lerp(r, 0.9, factor); // More red
      g = THREE.MathUtils.lerp(g, 0.5, factor); // Warmer
      b = THREE.MathUtils.lerp(b, 0.3, factor);
      groundR = THREE.MathUtils.lerp(groundR, 0.3, factor);
      groundG = THREE.MathUtils.lerp(groundG, 0.1, factor);
      groundB = THREE.MathUtils.lerp(groundB, 0.05, factor);
    } else if (
      this.timeOfDay < this.SUNRISE_HOUR - 3 ||
      this.timeOfDay > this.SUNSET_HOUR + 3
    ) {
      // Nighttime
      const nightStrength = Math.max(
        0,
        Math.min(
          1,
          Math.pow(Math.abs(this.timeOfDay - this.NOON_HOUR) - 6, 2) / 36 // Quadratic falloff from night to day
        )
      );
      r = THREE.MathUtils.lerp(r, 0.05, nightStrength);
      g = THREE.MathUtils.lerp(g, 0.05, nightStrength);
      b = THREE.MathUtils.lerp(b, 0.15, nightStrength);
      groundR = THREE.MathUtils.lerp(groundR, 0.01, nightStrength);
      groundG = THREE.MathUtils.lerp(groundG, 0.01, nightStrength);
      groundB = THREE.MathUtils.lerp(groundB, 0.05, nightStrength);
    }

    this.hemiLight.color.setHSL(r, g, b);
    this.hemiLight.groundColor.setHSL(groundR, groundG, groundB);
  }

  private refreshDirectionalLight(): void {
    // Get the main directional light from CSM
    const mainLight = this.csm.lights[0];
    if (mainLight) {
      const elevationFactor = Math.max(
        0,
        Math.sin((this._phi * Math.PI) / 180)
      ); // 0-1 based on sun elevation

      // Adjust intensity
      mainLight.intensity =
        this.csm.lightIntensity * elevationFactor * 0.75 + 0.25; // Never goes completely dark

      // Adjust color for sunset/sunrise
      let r = 1.0;
      let g = 1.0;
      let b = 1.0;

      if (
        this.timeOfDay > this.SUNRISE_HOUR - 3 &&
        this.timeOfDay < this.SUNRISE_HOUR + 3
      ) {
        // Sunrise window
        const factor = 1 - Math.abs(this.timeOfDay - this.SUNRISE_HOUR) / 3;
        r = THREE.MathUtils.lerp(r, 1.0, factor);
        g = THREE.MathUtils.lerp(g, 0.7, factor);
        b = THREE.MathUtils.lerp(b, 0.4, factor);
      } else if (
        this.timeOfDay > this.SUNSET_HOUR - 3 &&
        this.timeOfDay < this.SUNSET_HOUR + 3
      ) {
        // Sunset window
        const factor = 1 - Math.abs(this.timeOfDay - this.SUNSET_HOUR) / 3;
        r = THREE.MathUtils.lerp(r, 1.0, factor);
        g = THREE.MathUtils.lerp(g, 0.7, factor);
        b = THREE.MathUtils.lerp(b, 0.4, factor);
      } else if (
        this.timeOfDay < this.SUNRISE_HOUR - 3 ||
        this.timeOfDay > this.SUNSET_HOUR + 3
      ) {
        // Nighttime
        const nightStrength = Math.max(
          0,
          Math.min(
            1,
            Math.pow(Math.abs(this.timeOfDay - this.NOON_HOUR) - 6, 2) / 36
          )
        );
        r = THREE.MathUtils.lerp(r, 0.1, nightStrength);
        g = THREE.MathUtils.lerp(g, 0.1, nightStrength);
        b = THREE.MathUtils.lerp(b, 0.2, nightStrength);
      }
      mainLight.color.setRGB(r, g, b);
      mainLight.castShadow = elevationFactor > 0.1; // Only cast shadows during day/twilight
    }
  }
}
