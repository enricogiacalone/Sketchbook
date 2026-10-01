import * as THREE from 'three';

// "stilizza il gioco in stile toon" -- la parte dei MATERIALI: la luce del
// sole non sfuma piu' ma va a gradini (ombra propria / mezzatinta / luce),
// le ombre portate hanno il bordo netto e i riflessi sono macchie nette.
// Si fa modificando i pezzi di shader comuni di three (ShaderChunk), cosi'
// vale per TUTTI i materiali illuminati del gioco (anche quelli fatti con
// onBeforeCompile), senza toccarli uno per uno. I contorni e la
// saturazione sono un passaggio a parte sull'immagine (ToonOutline.tsx).
//
// Accendere/spegnere: i pezzi di shader cambiano, la chiave della cache
// dei programmi cambia (toonCacheKey) e ogni materiale si ricompila al
// suo prossimo disegno (Material.onBeforeRender, sotto) -- anche quelli
// che in quel momento non sono in scena (edifici scaricati, auto lontane).

let toonOn = false;
let toonVersion = 0;

const RAMP_GLSL = /* glsl */ `
#ifndef TOON_RAMP
#define TOON_RAMP
// luce del sole a gradini (bordi appena ammorbiditi contro le scalette)
float toonRamp( float x ) {
	return smoothstep( 0.0, 0.035, x ) * 0.6 + smoothstep( 0.42, 0.47, x ) * 0.4;
}
// ombre portate col bordo netto
float toonShadow( float s ) {
	return smoothstep( 0.35, 0.65, s );
}
#endif
`;

type Patch = { chunk: string; from: string | RegExp; to: string };

const PATCHES: Patch[] = [
  { chunk: 'common', from: /$/, to: RAMP_GLSL },
  // fisico/standard: diffusa a gradini...
  {
    chunk: 'lights_physical_pars_fragment',
    from: 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n\n\tvec3 irradiance = dotNL * directLight.color;',
    to: 'float dotNL = toonRamp( dot( geometryNormal, directLight.direction ) );\n\n\tvec3 irradiance = dotNL * directLight.color;',
  },
  // ...e riflesso: un po' di quello vero (i metalli vivono di riflesso)
  // piu' una macchia netta dove e' forte
  {
    chunk: 'lights_physical_pars_fragment',
    from: 'reflectedLight.directSpecular += irradiance * specularBRDF * material.multiScatteringCompensation;',
    to: `vec3 toonSp = specularBRDF * material.multiScatteringCompensation;
	float toonSpMax = max3( toonSp );
	reflectedLight.directSpecular += irradiance * ( toonSp * 0.35 + toonSp / max( toonSpMax, 1e-3 ) * smoothstep( 0.45, 0.5, toonSpMax ) * 0.6 );`,
  },
  {
    chunk: 'lights_lambert_pars_fragment',
    from: 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
    to: 'float dotNL = toonRamp( dot( geometryNormal, directLight.direction ) );',
  },
  {
    chunk: 'lights_phong_pars_fragment',
    from: 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
    to: 'float dotNL = toonRamp( dot( geometryNormal, directLight.direction ) );',
  },
  // texture "dipinte": lette da un livello di mipmap piu' piccolo (niente
  // grana fine: roccia, cemento, asfalto diventano macchie di colore)
  {
    chunk: 'map_fragment',
    from: 'vec4 sampledDiffuseColor = texture2D( map, vMapUv );',
    to: 'vec4 sampledDiffuseColor = texture2D( map, vMapUv, 2.0 );',
  },
  // rilievi delle normal map attenuati (superfici piu' piatte, da cartone)
  {
    chunk: 'normal_fragment_maps',
    from: 'mapN.xy *= normalScale;',
    to: 'mapN.xy *= normalScale * 0.35;',
  },
  // luce del cielo (emisfero): da sfumatura continua a due toni
  {
    chunk: 'lights_pars_begin',
    from: 'float hemiDiffuseWeight = 0.5 * dotNL + 0.5;',
    to: 'float hemiDiffuseWeight = smoothstep( 0.3, 0.7, 0.5 * dotNL + 0.5 );',
  },
  {
    chunk: 'lights_fragment_begin',
    from: /\? getShadow\( directionalShadowMap\[ i \],([^;]*?)\) : 1\.0;/,
    to: '? toonShadow( getShadow( directionalShadowMap[ i ],$1) ) : 1.0;',
  },
];

const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
const original: Record<string, string> = {};
const toonText: Record<string, string> = {};

function build() {
  if (Object.keys(toonText).length) return;
  for (const p of PATCHES) {
    if (!(p.chunk in original)) original[p.chunk] = chunks[p.chunk];
    const src = toonText[p.chunk] ?? original[p.chunk];
    const out = typeof p.from === 'string' ? src.replace(p.from, p.to) : src.replace(p.from, p.to);
    // una versione di three diversa: il pezzo non c'e' -> si salta (meglio
    // un toon parziale che uno shader rotto)
    if (out === src) console.warn(`[toon] pezzo di shader non trovato in ${p.chunk}`);
    toonText[p.chunk] = out;
  }
}

// I materiali con una chiave di cache propria (FarBuildings...) la
// concatenano a questa, altrimenti non si ricompilerebbero.
export const toonCacheKey = () => (toonOn ? '|toon' : '');

const origKey = THREE.Material.prototype.customProgramCacheKey;
THREE.Material.prototype.customProgramCacheKey = function (this: THREE.Material) {
  return origKey.call(this) + toonCacheKey();
};
const origBeforeRender = THREE.Material.prototype.onBeforeRender;
THREE.Material.prototype.onBeforeRender = function (this: THREE.Material & { __toonV?: number }, ...args: any[]) {
  if (this.__toonV !== toonVersion) {
    this.__toonV = toonVersion;
    if (toonVersion > 0) this.needsUpdate = true;
  }
  (origBeforeRender as any).apply(this, args);
};

export function setToonShading(on: boolean) {
  if (on === toonOn) return;
  build();
  toonOn = on;
  for (const name of Object.keys(original)) chunks[name] = on ? toonText[name] : original[name];
  toonVersion++;
}

export const isToonShading = () => toonOn;
