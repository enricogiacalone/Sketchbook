import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';

// "stilizza il gioco in stile toon" -- la parte sull'IMMAGINE: contorni
// d'inchiostro e colori piu' pieni. La scena si disegna in un'immagine a
// parte (con la profondita'), poi un passaggio a schermo intero:
//  - sagome: dove il pixel accanto e' molto piu' lontano (bordo di un
//    oggetto contro quello che c'e' dietro) -- linea sul lato vicino;
//  - spigoli: dove la superficie piega (la profondita' smette di variare
//    in modo lineare: su un piano 1/z varia linearmente sullo schermo,
//    su uno spigolo no) -- solo da vicino, da lontano sarebbe rumore;
//  - le linee svaniscono con la distanza (la nebbia fa il resto).
// Montato solo con lo stile toon acceso: prende il posto del disegno
// automatico di react-three-fiber (useFrame con priorita' 1).
// Spessori/soglie modificabili dal vivo in DEV: window.__toonOutline.

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 texel;
uniform float cameraNear;
uniform float cameraFar;
uniform float thickness;
uniform float lineWidth;
uniform float silMin;
uniform float silMax;
uniform float creaseMin;
uniform float creaseMax;
uniform float creaseFar;
uniform float lineFar;
uniform float saturation;
uniform float inkDark;
varying vec2 vUv;

float viewDist( float d ) { return -perspectiveDepthToViewZ( d, cameraNear, cameraFar ); }

void main() {
  vec4 col = texture2D( tColor, vUv );
  float d = texture2D( tDepth, vUv ).x;
  float edge = 0.0;
  if ( d < 1.0 ) {
    vec2 ox = vec2( texel.x * thickness, 0.0 );
    vec2 oy = vec2( 0.0, texel.y * thickness );
    float z = viewDist( d );
    float zl = viewDist( texture2D( tDepth, vUv - ox ).x );
    float zr = viewDist( texture2D( tDepth, vUv + ox ).x );
    float zd = viewDist( texture2D( tDepth, vUv - oy ).x );
    float zu = viewDist( texture2D( tDepth, vUv + oy ).x );
    // sagoma: un vicino molto piu' lontano di questo pixel
    float far4 = max( max( zl - z, zr - z ), max( zd - z, zu - z ) );
    float sil = smoothstep( silMin, silMax, far4 / z );
    // spigolo: derivata seconda di 1/z, relativa a 1/z (vale uguale a
    // ogni distanza), in "pixel"
    float w = 1.0 / z;
    float lap = max( abs( 1.0 / zl + 1.0 / zr - 2.0 * w ), abs( 1.0 / zd + 1.0 / zu - 2.0 * w ) );
    float crease = smoothstep( creaseMin, creaseMax, lap / w / ( texel.y * thickness ) );
    crease *= 1.0 - smoothstep( creaseFar * 0.5, creaseFar, z );
    edge = max( sil, crease ) * ( 1.0 - smoothstep( lineFar * 0.4, lineFar, z ) );
  }
  // colori piu' pieni
  float l = dot( col.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  col.rgb = max( mix( vec3( l ), col.rgb, saturation ), 0.0 );
  // inchiostro: lo stesso colore molto scuro (piu' morbido del nero puro)
  col.rgb = mix( col.rgb, col.rgb * inkDark, edge );
  gl_FragColor = col;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const ToonOutline: React.FC = () => {
  const gl = useThree((s) => s.gl);

  const rt = useMemo(() => {
    const depth = new THREE.DepthTexture(1, 1, THREE.FloatType);
    return new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthTexture: depth,
      depthBuffer: true,
    });
  }, []);

  const pass = useMemo(() => {
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        tColor: { value: rt.texture },
        tDepth: { value: rt.depthTexture },
        texel: { value: new THREE.Vector2(1, 1) },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
        thickness: { value: 1 },
        lineWidth: { value: 1.5 },
        silMin: { value: 0.03 },
        silMax: { value: 0.08 },
        creaseMin: { value: 0.6 },
        creaseMax: { value: 1.2 },
        creaseFar: { value: 45 },
        lineFar: { value: 160 },
        saturation: { value: 1.25 },
        inkDark: { value: 0.18 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { material, scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), mesh };
  }, [rt]);

  useEffect(() => {
    if (import.meta.env.DEV) (window as any).__toonOutline = pass.material.uniforms;
    return () => {
      rt.depthTexture?.dispose();
      rt.dispose();
      pass.material.dispose();
      pass.mesh.geometry.dispose();
      if (import.meta.env.DEV) delete (window as any).__toonOutline;
    };
  }, [rt, pass]);

  const _size = useMemo(() => new THREE.Vector2(), []);
  useFrame((state) => {
    const { scene, camera } = state;
    gl.getDrawingBufferSize(_size);
    if (rt.width !== _size.x || rt.height !== _size.y) rt.setSize(_size.x, _size.y);
    const u = pass.material.uniforms;
    u.texel.value.set(1 / _size.x, 1 / _size.y);
    // linee di ~1.5 px "logici" (su Retina 3 px veri), regolabili in DEV
    u.thickness.value = Math.max(1.5, gl.getPixelRatio() * u.lineWidth.value);
    const cam = camera as THREE.PerspectiveCamera;
    u.cameraNear.value = cam.near;
    u.cameraFar.value = cam.far;

    gl.setRenderTarget(rt);
    gl.render(scene, camera);
    gl.setRenderTarget(null);
    gl.render(pass.scene, pass.camera);
  }, 1);

  return null;
};

export default ToonOutline;
