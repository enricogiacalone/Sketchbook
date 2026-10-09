import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import {
  texture,
  uv,
  Fn,
  vec2,
  vec3,
  vec4,
  float,
  uniform,
  mix,
  max,
  abs,
  dot,
  smoothstep,
  step,
  perspectiveDepthToViewZ,
} from 'three/tsl';
import { MeshBasicNodeMaterial, QuadMesh } from 'three/webgpu';

const ToonOutline: React.FC = () => {
  const gl = useThree((s) => s.gl);
  const _size = useMemo(() => new THREE.Vector2(), []);

  const rt = useMemo(() => {
    const depth = new THREE.DepthTexture(1, 1, THREE.FloatType);
    return new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthTexture: depth,
      depthBuffer: true,
    });
  }, []);

  const uniforms = useMemo(
    () => ({
      texel: uniform(new THREE.Vector2(1 / window.innerWidth, 1 / window.innerHeight)),
      cameraNear: uniform(0.1),
      cameraFar: uniform(1000),
      thickness: uniform(1),
      lineWidth: uniform(1.5),
      silMin: uniform(0.03),
      silMax: uniform(0.08),
      creaseMin: uniform(0.6),
      creaseMax: uniform(1.2),
      creaseFar: uniform(45),
      lineFar: uniform(160),
      saturation: uniform(1.25),
      inkDark: uniform(0.18),
    }),
    []
  );

  const quadMesh = useMemo(() => {
    const mat = new MeshBasicNodeMaterial() as any;
    mat.depthTest = false;
    mat.depthWrite = false;

    const viewDist = Fn(([d]: any) => {
      return perspectiveDepthToViewZ(d, uniforms.cameraNear, uniforms.cameraFar).negate();
    });

    mat.colorNode = Fn(() => {
      const uvCoord = uv();
      const col = texture(rt.texture, uvCoord);
      const d = texture(rt.depthTexture, uvCoord).r;

      const ox = vec2(uniforms.texel.x.mul(uniforms.thickness), 0.0);
      const oy = vec2(0.0, uniforms.texel.y.mul(uniforms.thickness));

      const z = viewDist(d);
      const zl = viewDist(texture(rt.depthTexture, uvCoord.sub(ox)).r);
      const zr = viewDist(texture(rt.depthTexture, uvCoord.add(ox)).r);
      const zd = viewDist(texture(rt.depthTexture, uvCoord.sub(oy)).r);
      const zu = viewDist(texture(rt.depthTexture, uvCoord.add(oy)).r);

      const far4 = max(max(zl.sub(z), zr.sub(z)), max(zd.sub(z), zu.sub(z)));
      const sil = smoothstep(uniforms.silMin, uniforms.silMax, far4.div(z));

      const w = float(1.0).div(z);
      const invZl = float(1.0).div(zl);
      const invZr = float(1.0).div(zr);
      const invZd = float(1.0).div(zd);
      const invZu = float(1.0).div(zu);

      const lap = max(abs(invZl.add(invZr).sub(w.mul(2.0))), abs(invZd.add(invZu).sub(w.mul(2.0))));
      const creaseDenom = uniforms.texel.y.mul(uniforms.thickness);
      const crease = smoothstep(uniforms.creaseMin, uniforms.creaseMax, lap.div(w).div(creaseDenom));
      const creaseFade = float(1.0).sub(smoothstep(uniforms.creaseFar.mul(0.5), uniforms.creaseFar, z));
      const creaseFinal = crease.mul(creaseFade);

      const lineFade = float(1.0).sub(smoothstep(uniforms.lineFar.mul(0.4), uniforms.lineFar, z));
      const edge = max(sil, creaseFinal).mul(lineFade);

      const isRendered = step(d, 0.9999);
      const finalEdge = mix(0.0, edge, isRendered);

      const l = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
      const mixedCol = max(mix(vec3(l), col.rgb, uniforms.saturation), vec3(0.0));
      const inkedCol = mix(mixedCol, mixedCol.mul(uniforms.inkDark), finalEdge);

      return vec4(inkedCol, col.a);
    })();

    return new QuadMesh(mat);
  }, [rt, uniforms]);

  useEffect(() => {
    if (import.meta.env.DEV) (window as any).__toonOutline = uniforms;
    return () => {
      rt.depthTexture?.dispose();
      rt.dispose();
      quadMesh.material.dispose();
      if (import.meta.env.DEV) delete (window as any).__toonOutline;
    };
  }, [rt, quadMesh, uniforms]);

  useFrame((state) => {
    const { scene, camera } = state;
    gl.getDrawingBufferSize(_size);
    if (_size.x > 0 && _size.y > 0 && (rt.width !== _size.x || rt.height !== _size.y)) {
      rt.setSize(_size.x, _size.y);
    }

    if (_size.x > 0 && _size.y > 0) {
      uniforms.texel.value.set(1 / _size.x, 1 / _size.y);
    }
    uniforms.thickness.value = Math.max(1.5, gl.getPixelRatio() * (uniforms.lineWidth.value as number));

    const cam = camera as THREE.PerspectiveCamera;
    if (cam.near !== undefined) uniforms.cameraNear.value = cam.near;
    if (cam.far !== undefined) uniforms.cameraFar.value = cam.far;

    // 1. Render main scene into render target
    const currentRenderTarget = gl.getRenderTarget();
    gl.setRenderTarget(rt);
    gl.render(scene, camera);

    // 2. Render post-processing quad pass to screen
    gl.setRenderTarget(currentRenderTarget);
    quadMesh.render(gl);
  }, 1);

  return null;
};

export default ToonOutline;
