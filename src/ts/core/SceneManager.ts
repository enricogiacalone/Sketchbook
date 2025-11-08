import * as THREE from "three";
import { World } from "~/world/World";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass";
import { FXAAShader } from "three/examples/jsm/shaders/FXAAShader";

export class SceneManager {
  public world: World;
  public renderer: THREE.WebGLRenderer;
  public camera: THREE.PerspectiveCamera;
  public graphicsWorld: THREE.Scene;
  public composer: EffectComposer;

  constructor(world: World) {
    this.world = world;

    // Renderer
    this.renderer = new THREE.WebGLRenderer();
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Auto window resize
    window.addEventListener("resize", () => this.onWindowResize(), false);

    // Three.js scene
    this.graphicsWorld = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      80,
      window.innerWidth / window.innerHeight,
      0.1,
      1010
    );

    // Passes
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

    document.body.appendChild(this.renderer.domElement);
    this.renderer.domElement.id = "canvas";
  }

  public onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    let pixelRatio = this.renderer.getPixelRatio();
    let fxaaPass = this.composer.passes[1] as ShaderPass;
    fxaaPass.uniforms["resolution"].value.set(
      1 / (window.innerWidth * pixelRatio),
      1 / (window.innerHeight * pixelRatio)
    );
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
