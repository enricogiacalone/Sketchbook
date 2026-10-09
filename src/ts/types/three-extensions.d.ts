declare module 'three/tsl' {
  export * from 'three';
  export function Fn(fn: Function): any;
  export function uv(...args: any[]): any;
  export function texture(...args: any[]): any;
  export function viewportTexture(...args: any[]): any;
  export function viewportDepthTexture(...args: any[]): any;
  export function uniform(...args: any[]): any;
  export function color(...args: any[]): any;
  export function attribute(...args: any[]): any;
  export function cross(...args: any[]): any;
  export function normalize(...args: any[]): any;
  export const positionLocal: any;
  export const positionWorld: any;
  export const cameraPosition: any;
  export function vec2(...args: any[]): any;
  export function vec3(...args: any[]): any;
  export function vec4(...args: any[]): any;
  export function float(...args: any[]): any;
  export function mix(...args: any[]): any;
  export function max(...args: any[]): any;
  export function min(...args: any[]): any;
  export function abs(...args: any[]): any;
  export function dot(...args: any[]): any;
  export function smoothstep(...args: any[]): any;
  export function step(...args: any[]): any;
  export function acos(...args: any[]): any;
  export function cos(...args: any[]): any;
  export function sin(...args: any[]): any;
  export function exp(...args: any[]): any;
  export function pow(...args: any[]): any;
  export function clamp(...args: any[]): any;
  export function perspectiveDepthToViewZ(...args: any[]): any;
  export function orthographicDepthToViewZ(...args: any[]): any;
}

declare module 'three/webgpu' {
  export * from 'three';
  export class WebGPURenderer extends THREE.WebGLRenderer {
    constructor(parameters?: THREE.WebGLRendererParameters);
  }
  export class MeshBasicNodeMaterial extends THREE.MeshBasicMaterial {
    colorNode: any;
    fragmentNode: any;
    vertexNode: any;
    dispose(): void;
  }
  export class MeshStandardNodeMaterial extends THREE.MeshStandardMaterial {
    colorNode: any;
    fragmentNode: any;
    vertexNode: any;
    dispose(): void;
  }
  export class NodeMaterial extends THREE.Material {
    colorNode: any;
    fragmentNode: any;
    vertexNode: any;
    dispose(): void;
  }
}
