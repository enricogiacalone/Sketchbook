import React, { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGLTF } from '../../lib/gltf';

const ISLAND_POSITION: [number, number, number] = [350, 0, 350];
const ISLAND_SCALE = 1.0;

export const FluffyIsland: React.FC = () => {
  const gltf = useGLTF('landscape-glb.glb');
  const canopyMaterialsRef = useRef<THREE.Material[]>([]);
  const windUniforms = useRef({ uTime: { value: 0.0 } });

  useEffect(() => {
    const canopyMats: THREE.Material[] = [];
    gltf.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;

      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach((mat) => (mat.side = THREE.FrontSide));
        } else {
          object.material.side = THREE.FrontSide;
        }
      }

      if (object.name === 'Landscape005_1') {
        const origMat = object.material as THREE.MeshStandardMaterial;
        const mat = new THREE.MeshLambertMaterial({
          side: THREE.DoubleSide,
          transparent: true,
          alphaTest: 0.5,
          depthWrite: true,
          map: origMat?.map || null,
        });
        mat.onBeforeCompile = (shader) => {
          if (!shader.vertexShader || !shader.fragmentShader) return;
          shader.uniforms.uTime = windUniforms.current.uTime;
          shader.vertexShader = `
            uniform float uTime;
            varying vec2 vUv;
            ${shader.vertexShader}
          `
          .replace('#include <begin_vertex>', `
            #include <begin_vertex>
            float swayFactor = 1.0 - uv.y;
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            float wind = sin(worldPos.x * 0.5 + uTime * 1.2) + sin(worldPos.z * 0.3 + uTime * 0.8);
            transformed.xz += vec2(0.8, 0.6) * wind * 0.06 * swayFactor;
          `)
          .replace('#include <uv_vertex>', `
            #include <uv_vertex>
            vUv = uv;
          `);

          shader.fragmentShader = `
            varying vec2 vUv;
            ${shader.fragmentShader}
          `
          .replace('#include <dithering_fragment>', `
            vec4 texColor = texture2D(map, vUv);
            if (texColor.a < 0.5) discard;
            vec3 grad = mix(vec3(0.0, 0.6, 0.0), vec3(0.0, 1.0, 0.29), 1.0 - vUv.y);
            gl_FragColor.rgb = grad * (gl_FragColor.rgb / max(texColor.rgb, vec3(0.001)));
            #include <dithering_fragment>
          `);
        };
        object.material = mat;
      } else if (object.name.startsWith('NOVA_COPA')) {
        object.geometry.computeBoundingBox();
        const boundingBox = object.geometry.boundingBox;
        const treeCenter = new THREE.Vector3();
        if (boundingBox) boundingBox.getCenter(treeCenter);
        object.updateWorldMatrix(true, false);
        treeCenter.applyMatrix4(object.matrixWorld);

        const origMat = object.material as THREE.MeshStandardMaterial;
        const mat = new THREE.MeshLambertMaterial({
          map: origMat?.map || null,
          alphaMap: origMat?.map || null,
          transparent: true,
          alphaTest: 0.5,
          side: THREE.DoubleSide,
          depthWrite: true,
        });

        mat.onBeforeCompile = (shader) => {
          if (!shader.vertexShader || !shader.fragmentShader) return;
          mat.userData.shader = shader;
          shader.uniforms.uTime = windUniforms.current.uTime;

          Object.assign(shader.uniforms, {
            uLightDirection: { value: new THREE.Vector3(0.5, 1.0, 0.5).normalize() },
            uTreeCenter: { value: treeCenter },
            uGradientStart: { value: -1.0 },
            uGradientEnd: { value: 2.7 },
            uLitColor: { value: new THREE.Color(0x21ff08) },
            uShadowColor: { value: new THREE.Color(0x001d33) },
            uHighlightColor: { value: new THREE.Color(0x8cff00) },
            uHighlightStart: { value: 0.5 },
            uHighlightEnd: { value: 1.8 },
            uLeafShadowDarkness: { value: 0.2 },
            uWindStrength: { value: 0.05 },
            uWindFrequency: { value: 5.0 },
            uWindSpeed: { value: 0.4 },
          });

          shader.vertexShader = `
            varying vec3 vWorldPosition;
            uniform float uTime;
            uniform float uWindStrength;
            uniform float uWindFrequency;
            uniform float uWindSpeed;
            ${shader.vertexShader}
          `
          .replace('#include <begin_vertex>', `
            #include <begin_vertex>
            float time = uTime * uWindSpeed;
            float disp = sin(position.x * uWindFrequency + time) * uWindStrength * (position.y / 8.0);
            transformed.xz += vec2(1.0, 1.0) * disp;
            vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
          `);

          shader.fragmentShader = `
            varying vec3 vWorldPosition;
            uniform vec3 uLightDirection;
            uniform vec3 uTreeCenter;
            uniform float uGradientStart;
            uniform float uGradientEnd;
            uniform vec3 uLitColor;
            uniform vec3 uShadowColor;
            uniform vec3 uHighlightColor;
            uniform float uHighlightStart;
            uniform float uHighlightEnd;
            uniform float uLeafShadowDarkness;
            ${shader.fragmentShader}
          `
          .replace('#include <color_fragment>', `
            #include <color_fragment>
            vec3 fromCenterToSurface = normalize(vWorldPosition - uTreeCenter);
            float lightAlignment = dot(fromCenterToSurface, uLightDirection);
            float baseGradientFactor = smoothstep(uGradientStart, uGradientEnd, lightAlignment);
            vec3 baseColor = mix(uShadowColor, uLitColor, baseGradientFactor);
            float highlightFactor = smoothstep(uHighlightStart, uHighlightEnd, lightAlignment);
            vec3 gradientColor = mix(baseColor, uHighlightColor, highlightFactor);
            diffuseColor.rgb = gradientColor;
          `)
          .replace('#include <normal_fragment_begin>', `
            #include <normal_fragment_begin>
            vec3 worldUp = vec3(0.0, 1.0, 0.0);
            vec3 viewUp = normalize(mat3(viewMatrix) * worldUp);
            normal = viewUp;
          `);
        };
        object.material = mat;
        canopyMats.push(mat);
      }
    });
    canopyMaterialsRef.current = canopyMats;
  }, [gltf]);

  useFrame(({ clock }) => {
    windUniforms.current.uTime.value = clock.getElapsedTime();
    canopyMaterialsRef.current.forEach((mat) => {
      if (mat.userData.shader) {
        mat.userData.shader.uniforms.uTime.value = windUniforms.current.uTime.value;
      }
    });
  });

  return (
    <group position={ISLAND_POSITION} scale={ISLAND_SCALE}>
      <primitive object={gltf.scene} />
    </group>
  );
};

export default FluffyIsland;
