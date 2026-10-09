// "ruba il grass da qui https://pmndrs.github.io/examples/grass-shader/ e
// mettilo nel parco" -- vertex/fragment GLSL lifted verbatim from that
// example (pmndrs/examples, MIT licensed, (c) 2024 Poimandres; example
// author Paul Henschel, published 2020-06-10, source
// https://codesandbox.io/s/5xho4). Exported here as plain shader strings +
// a uniforms factory rather than through drei's shaderMaterial()/extend()
// (which the original example uses) to match this project's own existing
// convention for custom shaders -- see ParkTrees.tsx's GrassPatch /
// Grass.tsx, which both already just hand vertexShader/fragmentShader
// strings straight to a plain <shaderMaterial>.
//
// Credits baked into the original source, preserved here:
//   - Base technique: https://codepen.io/al-ro/pen/jJJygQ by al-ro
//   - Blade bend/orientation approach: "Realistic real-time grass
//     rendering", Eddie Lee, 2010
//   - 2D simplex noise (wind): WEBGL-NOISE,
//     https://github.com/stegu/webgl-noise -- Author: Ian McEwan, Ashima
//     Arts. Copyright (C) 2011 Ashima Arts. Distributed under the MIT
//     License. https://github.com/ashima/webgl-noise
//   - Quaternion rotation:
//     https://www.geeks3d.com/20141201/how-to-rotate-a-vertex-by-a-quaternion-in-glsl/
//   - Slerp: https://en.wikipedia.org/wiki/Slerp
import * as THREE from "three";

export const grassBladeVertexShader = `
  precision mediump float;
  attribute vec3 offset;
  attribute vec4 orientation;
  attribute float halfRootAngleSin;
  attribute float halfRootAngleCos;
  attribute float stretch;
  uniform float time;
  uniform float bladeHeight;
  varying vec2 vUv;
  varying float frc;

  //WEBGL-NOISE FROM https://github.com/stegu/webgl-noise
  //Description : Array and textureless GLSL 2D simplex noise function. Author : Ian McEwan, Ashima Arts. Maintainer : stegu Lastmod : 20110822 (ijm) License : Copyright (C) 2011 Ashima Arts. All rights reserved. Distributed under the MIT License. See LICENSE file. https://github.com/ashima/webgl-noise https://github.com/stegu/webgl-noise
  vec3 mod289(vec3 x) {return x - floor(x * (1.0 / 289.0)) * 289.0;} vec2 mod289(vec2 x) {return x - floor(x * (1.0 / 289.0)) * 289.0;} vec3 permute(vec3 x) {return mod289(((x*34.0)+1.0)*x);} float snoise(vec2 v){const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439); vec2 i  = floor(v + dot(v, C.yy) ); vec2 x0 = v -   i + dot(i, C.xx); vec2 i1; i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0); vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1; i = mod289(i); vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 )); vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0); m = m*m ; m = m*m ; vec3 x = 2.0 * fract(p * C.www) - 1.0; vec3 h = abs(x) - 0.5; vec3 ox = floor(x + 0.5); vec3 a0 = x - ox; m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h ); vec3 g; g.x  = a0.x  * x0.x  + h.x  * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw; return 130.0 * dot(m, g);}
  //END NOISE

  //https://www.geeks3d.com/20141201/how-to-rotate-a-vertex-by-a-quaternion-in-glsl/
  vec3 rotateVectorByQuaternion( vec3 v, vec4 q){
    return 2.0 * cross(q.xyz, v * q.w + cross(q.xyz, v)) + v;
  }

  //https://en.wikipedia.org/wiki/Slerp
  vec4 slerp(vec4 v0, vec4 v1, float t) {
    normalize(v0);
    normalize(v1);
    float dot_ = dot(v0, v1);
    if (dot_ < 0.0) {
      v1 = -v1;
      dot_ = -dot_;
    }
    const float DOT_THRESHOLD = 0.9995;
    if (dot_ > DOT_THRESHOLD) {
      vec4 result = t*(v1 - v0) + v0;
      normalize(result);
      return result;
    }
    float theta_0 = acos(dot_);
    float theta = theta_0*t;
    float sin_theta = sin(theta);
    float sin_theta_0 = sin(theta_0);
    float s0 = cos(theta) - dot_ * sin_theta / sin_theta_0;
    float s1 = sin_theta / sin_theta_0;
    return (s0 * v0) + (s1 * v1);
  }

  void main() {
    frc = position.y/float(bladeHeight);
    float noise = 1.0-(snoise(vec2((time-offset.x/50.0), (time-offset.z/50.0))));
    vec4 direction = vec4(0.0, halfRootAngleSin, 0.0, halfRootAngleCos);
    direction = slerp(direction, orientation, frc);
    vec3 vPosition = vec3(position.x, position.y + position.y * stretch, position.z);
    vPosition = rotateVectorByQuaternion(vPosition, direction);

    float halfAngle = noise * 0.15;
    vPosition = rotateVectorByQuaternion(vPosition, normalize(vec4(sin(halfAngle), 0.0, -sin(halfAngle), cos(halfAngle))));
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(offset + vPosition, 1.0 );
  }
`;

export const grassBladeFragmentShader = `
  precision mediump float;
  uniform sampler2D map;
  uniform sampler2D alphaMap;
  uniform vec3 tipColor;
  uniform vec3 bottomColor;
  varying vec2 vUv;
  varying float frc;

  void main() {
    float alpha = texture2D(alphaMap, vUv).r;
    if(alpha < 0.15) discard;
    vec4 col = vec4(texture2D(map, vUv));
    col = mix(vec4(tipColor, 1.0), col, frc);
    col = mix(vec4(bottomColor, 1.0), col, frc);
    gl_FragColor = col;

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const GRASS_TIP_COLOR = new THREE.Color(0.0, 0.6, 0.0).convertSRGBToLinear();
export const GRASS_BOTTOM_COLOR = new THREE.Color(0.0, 0.1, 0.0).convertSRGBToLinear();
