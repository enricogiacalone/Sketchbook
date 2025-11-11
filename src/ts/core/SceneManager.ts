import * as THREE from "three";
import { World } from "~/world/World";
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
const SHADOW_MAP_TYPE = THREE.PCFSoftShadowMap;

export class SceneManager {
  public world: World;
  public renderer: THREE.WebGLRenderer;
  public camera: THREE.PerspectiveCamera;
  public graphicsWorld: THREE.Scene;
  public composer: EffectComposer;

  constructor(world: World) {
    this.world = world;
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DEVICE_PIXEL_RATIO));
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
   * Initializes post-processing effects (EffectComposer, RenderPass, FXAAShader).
   */
  private _initializePostProcessing(): void {
    let renderPass = new RenderPass(this.graphicsWorld, this.camera);
    let fxaaPass = new ShaderPass(FXAAShader);

    // FXAA
    let pixelRatio = this.renderer.getPixelRatio();
    fxaaPass.material["uniforms"].resolution.value.x =
      1 / (window.innerWidth * pixelRatio);
    fxaaPass.material["uniforms"].resolution.value.y =
      1 / (window.innerHeight * pixelRatio);

    // Composer
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(fxaaPass);
  }

  /**
   * Appends the renderer's DOM element to the document body and sets its ID.
   */
  private _setupCanvas(): void {
    document.body.appendChild(this.renderer.domElement);
    this.renderer.domElement.id = "canvas";
  }

  public onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    let pixelRatio = this.renderer.getPixelRatio();
    // Ensure fxaaPass is a ShaderPass before accessing its uniforms
    const fxaaPass = this.composer.passes[1] as ShaderPass;
    if (fxaaPass && fxaaPass.uniforms && fxaaPass.uniforms["resolution"]) {
      fxaaPass.uniforms["resolution"].value.set(
        1 / (window.innerWidth * pixelRatio),
        1 / (window.innerHeight * pixelRatio)
      );
    }
    this.composer.setSize(
      window.innerWidth * pixelRatio,
      window.innerHeight * pixelRatio
    );
  }

  public render(): void {
    if (this.world.params.FXAA) this.composer.render();
    else this.renderer.render(this.graphicsWorld, this.camera);
  }
}
