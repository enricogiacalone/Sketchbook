import * as THREE from "three";
import { World } from "~/world/World";
import { WorldGUI } from "~/debug/WorldGUI";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass";
import { FXAAShader } from "three/examples/jsm/shaders/FXAAShader";

const MAX_DEVICE_PIXEL_RATIO = 1.5;

// Camera Constants
const CAMERA_FOV = 80;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 1010;

// Renderer Constants
const TONE_MAPPING_EXPOSURE = 1.0;
const SHADOW_MAP_TYPE = THREE.PCFShadowMap; // Changed from PCFSoftShadowMap to PCFShadowMap

export class SceneManager {
  public world: World;
  public renderer: THREE.WebGLRenderer;
  public camera: THREE.PerspectiveCamera;
  public graphicsWorld: THREE.Scene;
  public composer: EffectComposer;
  private worldGUI: WorldGUI; // Add worldGUI property

  constructor(world: World, worldGUI: WorldGUI) {
    this.world = world;
    this.worldGUI = worldGUI; // Assign worldGUI
    this.graphicsWorld = new THREE.Scene();

    this._initializeRenderer();
    this._initializeCamera();
    this._initializePostProcessing();
    this._setupCanvas();

    // Auto window resize
    window.addEventListener("resize", () => this.onWindowResize(), false);
  }

  /**
   * Initializes the WebGLRenderer.
   */
  private _initializeRenderer(): void {
    this.renderer = new THREE.WebGLRenderer();
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, MAX_DEVICE_PIXEL_RATIO)
    );
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = SHADOW_MAP_TYPE;
  }

  /**
   * Initializes the PerspectiveCamera.
   */
  private _initializeCamera(): void {
    this.camera = new THREE.PerspectiveCamera(
      CAMERA_FOV,
      window.innerWidth / window.innerHeight,
      CAMERA_NEAR,
      CAMERA_FAR
    );
  }

  /**
   * Initializes the post-processing effects.
   */
  private _initializePostProcessing(): void {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.graphicsWorld, this.camera));

    const fxaaPass = new ShaderPass(FXAAShader);
    fxaaPass.uniforms.resolution.value.set(
      1 / (window.innerWidth * this.renderer.getPixelRatio()),
      1 / (window.innerHeight * this.renderer.getPixelRatio())
    );
    this.composer.addPass(fxaaPass);
  }

  /**
   * Sets up the canvas element.
   */
  private _setupCanvas(): void {
    const container = document.getElementById("canvas");
    if (container) {
      container.appendChild(this.renderer.domElement);
    } else {
      document.body.appendChild(this.renderer.domElement);
    }
  }

  /**
   * Renders the scene.
   */
  public render(): void {
    this.composer.render();
  }

  /**
   * Handles the window resize event.
   */
  public onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }
}
