import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { RigidBody, CuboidCollider } from '@react-three/rapier';
import * as THREE from 'three';
import { SimplexNoise } from 'three-stdlib';
import { getPlaylist, type SpeakerId, type Track } from './musicLibrary';
import { setFlatGroundOverride } from '../Road';
import { useInput } from '../../../hooks/useInput';
import { acquireDebugGui, releaseDebugGui } from '../../../lib/debugGui';
import { acquireAudioListener, releaseAudioListener } from '../../../lib/sharedAudioListener';
import { CollisionGroups, groupsExcluding } from '../../../enums/CollisionGroups';

// "Immersive 3D Audio and Visualization" -- porting nel duello della demo di
// SimonDev (https://github.com/simondevyoutube/ThreeJS_Tutorial_3DSound,
// MIT (c) 2022 simondevyoutube; video https://www.youtube.com/watch?v=1S7ke6F8sV4):
//  - sala con pavimento in ferro arrugginito e muri di cemento (texture
//    freepbr.com di Emil Persson, CC BY 3.0 -- public/audio-arena/CREDITS.txt);
//  - cassa OVEST: muro di 11x16 cubetti che fa da spettrogramma a scorrimento
//    (FFT a 16 bande, bassi al centro, colonne = ultimi 11 frame), cubi che
//    escono dalla cassa + colore blu->rosso->giallo + bagliore;
//  - cassa EST: schermo con 64 barre circolari disegnate nello shader
//    (FFT a 64 bande in una DataTexture), come l'originale;
//  - audio POSIZIONALE 3D (THREE.PositionalAudio, ascoltatore sulla camera):
//    ogni cassa suona il suo brano e lo senti da dove sta la cassa.
// Differenze volute rispetto all'originale: i brani vengono dalle cartelle
// musica/cassa-cubi e musica/cassa-schermo (playlist, vedi musicLibrary.ts)
// via <audio> in streaming invece di decodificare tutto in memoria, e le FFT
// leggono il segnale PRIMA dell'attenuazione con la distanza, cosi' i
// visualizzatori reagiscono uguale da vicino e da lontano.

export const AUDIO_ARENA_FLOOR_Y = 0.15; // = altezza della strada al centro del duello
const ROOM_HALF = 30;
const WALL_H = 12;
const WALL_T = 2;
const SPEAKER_X = 14;
const SPEAKER_W = 1; // spessore (x)
const SPEAKER_H = 8;
const SPEAKER_D = 4; // larghezza (z)
const SPEAKER_Y = AUDIO_ARENA_FLOOR_Y + SPEAKER_H / 2;
const DEFAULT_REF_DISTANCE = 4;
const TEX = '/audio-arena/textures/';

// muri e casse bloccano anche i combattenti (gruppo Characters, vedi
// SOLID_BODY_GROUPS), il pavimento no (i piedi ci poggiano sopra)
const SOLID_GROUPS = groupsExcluding([CollisionGroups.Default, CollisionGroups.Characters]);

// --- cassa a cubi (spettrogramma) ------------------------------------------
const CUBE_COLS = 11; // x = -5..5 nell'originale: storia degli ultimi 11 frame
const CUBE_ROWS = 16; // 16 bande (fftSize 32)
const CUBE_REMAP = [15, 13, 11, 9, 7, 5, 3, 1, 0, 2, 4, 6, 8, 10, 12, 14];
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const SPLINE: [number, THREE.Color][] = [
  [0.0, new THREE.Color(0x4040ff)],
  [0.25, new THREE.Color(0xff4040)],
  [1.0, new THREE.Color(0xffff80)],
];
function splineColor(t: number, out: THREE.Color) {
  for (let i = 0; i < SPLINE.length - 1; i++) {
    const [t0, c0] = SPLINE[i];
    const [t1, c1] = SPLINE[i + 1];
    if (t <= t1 || i === SPLINE.length - 2) {
      const k = THREE.MathUtils.clamp((t - t0) / (t1 - t0), 0, 1);
      return out.copy(c0).lerp(c1, k);
    }
  }
  return out.copy(SPLINE[0][1]);
}
const smootherstep = (x: number) => x * x * x * (x * (x * 6 - 15) + 10);

// fbm come noise.js dell'originale (octaves 3, persistence .5, lacunarity 1.6, scale .1)
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const simplex = new SimplexNoise({ random: mulberry32(1) });
function fbm(x: number, y: number, z: number) {
  const G = 2 ** -0.5;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  let total = 0;
  for (let o = 0; o < 3; o++) {
    total += (simplex.noise4d(x * 10 * freq, y * 10 * freq, z * 10 * freq, 0) * 0.5 + 0.5) * amp;
    norm += amp;
    amp *= G;
    freq *= 1.6;
  }
  return total / norm;
}

// --- schermo a barre circolari (shader dell'originale, Inigo Quilez SDF) ----
const SCREEN_FS = /* glsl */ `
uniform sampler2D audioDataTexture;
uniform vec2 iResolution;
uniform float iTime;
varying vec2 vVisUv;
#define M_PI 3.14159
#define NUM_BARS 64.0
#define CIRCLE_RADIUS 0.15
#define BAR_HEIGHT 0.125
vec3 pal( in float t, in vec3 a, in vec3 b, in vec3 c, in vec3 d) { return a + b*cos( 6.28318*(c*t+d) ); }
float dot2v(in vec2 v ) { return dot(v,v); }
float sdfTrapezoid(in vec2 p, in float r1, float r2, float he) {
  vec2 k1 = vec2(r2,he);
  vec2 k2 = vec2(r2-r1,2.0*he);
  p.x = abs(p.x);
  vec2 ca = vec2(p.x-min(p.x,(p.y<0.0)?r1:r2), abs(p.y)-he);
  vec2 cb = p - k1 + k2*clamp( dot(k1-p,k2)/dot2v(k2), 0.0, 1.0 );
  float s = (cb.x<0.0 && ca.y<0.0) ? -1.0 : 1.0;
  return s*sqrt( min(dot2v(ca),dot2v(cb)) );
}
float sdfBar(vec2 position, vec2 dimensions, vec2 uv, float frequencySample) {
  float w = mix(dimensions.x * 0.5, dimensions.x, smoothstep(0.0, 1.0, frequencySample));
  vec2 basePosition = uv - position + vec2(0.0, -dimensions.y * 0.5 - frequencySample * 0.05);
  float d = sdfTrapezoid(basePosition, dimensions.x * 0.5, w, dimensions.y * 0.5);
  return (d > 0.0 ? 0.0 : 1.0);
}
vec2 rotate2D(vec2 pt, float a) { float c = cos(a); float s = sin(a); return mat2(c, s, -s, c) * pt; }
vec4 DrawBars(vec2 center, vec2 uv) {
  float barWidth = 2.0 * M_PI * CIRCLE_RADIUS / (NUM_BARS * 1.25);
  vec4 resultColour = vec4(1.0, 1.0, 1.0, 0.0);
  vec2 position = vec2(center.x, center.y + CIRCLE_RADIUS);
  for (int i = 0; i < int(NUM_BARS); i++) {
    float frequencyUV = float(i) >= NUM_BARS * 0.5
      ? 1.0 - ((float(i) - (NUM_BARS * 0.5)) / (NUM_BARS * 0.5))
      : float(i) / (NUM_BARS * 0.5);
    float frequencyData = texture2D(audioDataTexture, vec2(frequencyUV, 0.0)).x;
    float barFinalHeight = BAR_HEIGHT * (0.1 + 0.9 * frequencyData);
    vec2 barDimensions = vec2(barWidth, barFinalHeight);
    vec2 barUvs = rotate2D(uv - center, (2.0 * M_PI * float(i)) / NUM_BARS) + center;
    resultColour.w += sdfBar(position, barDimensions, barUvs, frequencyData);
  }
  float d = saturate(1.1 * ((distance(uv, center) - CIRCLE_RADIUS) / BAR_HEIGHT));
  d = smoothstep(0.0, 1.0, d);
  d = 0.45 + 0.55 * d;
  resultColour.xyz *= pal(d, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.20, 0.30));
  resultColour.xyz *= resultColour.w;
  return saturate(resultColour);
}
vec4 AudioVisualizer() {
  float aspect = iResolution.x / iResolution.y;
  vec2 uv = vVisUv * vec2(aspect, 1.0);
  return DrawBars(vec2(aspect * 0.5, 0.5), uv);
}
`;

// --- audio ------------------------------------------------------------------
interface SpeakerAudio {
  id: SpeakerId;
  el: HTMLAudioElement;
  pa: THREE.PositionalAudio;
  analyser: AnalyserNode;
  data: Uint8Array<ArrayBuffer>;
  tracks: Track[];
  isDemo: boolean;
  index: number;
}

export interface AudioArenaApi {
  togglePlay: () => void;
  toggleSpeaker: (id: SpeakerId, force?: boolean) => void;
  next: (id: SpeakerId) => void;
}
// per il pannello e gli script di verifica
export const audioArenaApi: { current: AudioArenaApi | null } = { current: null };

function makePbr(
  t: Record<string, THREE.Texture>,
  prefix: string,
  repeatX: number,
  repeatY: number,
  anisotropy: number
): THREE.MeshStandardMaterial {
  const prep = (tex: THREE.Texture | undefined, srgb: boolean) => {
    if (!tex) return null;
    const c = tex.clone();
    c.wrapS = c.wrapT = THREE.RepeatWrapping;
    c.repeat.set(repeatX, repeatY);
    c.anisotropy = anisotropy;
    c.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    c.needsUpdate = true;
    return c;
  };
  return new THREE.MeshStandardMaterial({
    map: prep(t[prefix + 'Map'], true),
    normalMap: prep(t[prefix + 'Normal'], false),
    roughnessMap: prep(t[prefix + 'Rough'], false),
    metalnessMap: prep(t[prefix + 'Metal'], false),
    metalness: 1,
    roughness: 1,
  });
}

const AudioArena: React.FC = () => {
  const { camera, gl } = useThree();
  const input = useInput();

  const tex = useTexture({
    floorMap: TEX + 'rustediron2_albedo.jpg',
    floorNormal: TEX + 'rustediron2_normal.jpg',
    floorRough: TEX + 'rustediron2_roughness.jpg',
    floorMetal: TEX + 'rustediron2_metallic.jpg',
    wallMap: TEX + 'concrete3-albedo.jpg',
    wallNormal: TEX + 'concrete3-normal.jpg',
    wallRough: TEX + 'concrete3-roughness.jpg',
    wallMetal: TEX + 'concrete3-metallic.jpg',
    spkMap: TEX + 'worn_metal4_albedo.jpg',
    spkNormal: TEX + 'worn_metal4_normal.jpg',
    spkRough: TEX + 'worn_metal4_roughness.jpg',
    spkMetal: TEX + 'worn_metal4_metallic.jpg',
    cubeMap: TEX + 'broken_down_concrete2_albedo.jpg',
    cubeNormal: TEX + 'broken_down_concrete2_normal.jpg',
    cubeRough: TEX + 'broken_down_concrete2_roughness.jpg',
    cubeMetal: TEX + 'broken_down_concrete2_metallic.jpg',
    screenMap: TEX + 'background-grey-dots.jpg',
    screenNormal: TEX + 'flaking-plaster_normal-ogl.jpg',
    screenRough: TEX + 'flaking-plaster_roughness.jpg',
    screenMetal: TEX + 'flaking-plaster_metallic.jpg',
  }) as unknown as Record<string, THREE.Texture>;

  const mats = useMemo(() => {
    const an = Math.min(8, gl.capabilities.getMaxAnisotropy());
    const floor = makePbr(tex, 'floor', (ROOM_HALF * 2) / 25 * 1.5, (ROOM_HALF * 2) / 25 * 1.5, an);
    const wallLong = makePbr(tex, 'wall', (ROOM_HALF * 2 + WALL_T * 2) / 25 * 2, (WALL_H / 25) * 2, an);
    const speaker = makePbr(tex, 'spk', 1, 1, an);
    const cube = makePbr(tex, 'cube', 1, 1, an);
    // bagliore per-cubo: colore d'istanza * aGlow (l'emissive di un
    // MeshStandardMaterial e' uno solo per tutte le istanze)
    cube.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vGlow;')
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance += vColor.rgb * vGlow;\n#endif'
        );
    };
    cube.customProgramCacheKey = () => 'audioArenaCubes';

    const screenData = new Uint8Array(64);
    const screenTex = new THREE.DataTexture(screenData, 64, 1, THREE.RedFormat);
    screenTex.magFilter = THREE.LinearFilter;
    screenTex.needsUpdate = true;
    const screenUniforms = {
      audioDataTexture: { value: screenTex as THREE.Texture },
      iResolution: { value: new THREE.Vector2(128, 256) },
      iTime: { value: 0 },
    };
    const screen = makePbr(tex, 'screen', 1, 1, an);
    screen.metalness = 1;
    screen.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, screenUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vVisUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVisUv = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', SCREEN_FS + '\nvoid main() {')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += AudioVisualizer().xyz;');
    };
    screen.customProgramCacheKey = () => 'audioArenaScreen';
    const screenBody = new THREE.MeshStandardMaterial({ color: 0x404040, roughness: 0.1, metalness: 0 });
    return { floor, wallLong, speaker, cube, screen, screenBody, screenTex, screenData, screenUniforms };
  }, [tex, gl]);

  // --- cubi: InstancedMesh -------------------------------------------------
  const cubes = useMemo(() => {
    const geo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
    const glow = new THREE.InstancedBufferAttribute(new Float32Array(CUBE_COLS * CUBE_ROWS), 1);
    glow.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aGlow', glow);
    const mesh = new THREE.InstancedMesh(geo, mats.cube, CUBE_COLS * CUBE_ROWS);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    for (let c = 0; c < CUBE_COLS; c++) {
      for (let r = 0; r < CUBE_ROWS; r++) {
        const i = c * CUBE_ROWS + r;
        _m.makeTranslation(0, r * 0.35 - 3, (c - 5) * 0.35);
        mesh.setMatrixAt(i, _m);
        mesh.setColorAt(i, splineColor(0, _c));
      }
    }
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return { mesh, glow, history: [] as Uint8Array[], timer: 0 };
  }, [mats]);

  // --- audio -----------------------------------------------------------------
  const cubiSpeakerRef = useRef<THREE.Group>(null);
  const schermoSpeakerRef = useRef<THREE.Group>(null);
  const audioRef = useRef<{ listener: THREE.AudioListener; speakers: Record<SpeakerId, SpeakerAudio> } | null>(null);
  // play/pausa indipendente per cassa
  const playingRef = useRef<Record<SpeakerId, boolean>>({ cubi: true, schermo: true });
  const settingsRef = useRef({ 'suona cubi': true, 'suona schermo': true, volume: 1, attenuazione: DEFAULT_REF_DISTANCE, 'brano cubi': '-', 'brano schermo': '-' });

  const playlists = { cubi: getPlaylist('cubi'), schermo: getPlaylist('schermo') };
  const playlistKey = playlists.cubi.tracks.map((t) => t.url).join('|') + '#' + playlists.schermo.tracks.map((t) => t.url).join('|');

  useEffect(() => {
    setFlatGroundOverride({ minX: -ROOM_HALF, maxX: ROOM_HALF, minZ: -ROOM_HALF, maxZ: ROOM_HALF, y: AUDIO_ARENA_FLOOR_Y });
    return () => setFlatGroundOverride(null);
  }, []);

  useEffect(() => {
    const listener = acquireAudioListener(camera);
    const ctx = listener.context;
    const make = (id: SpeakerId, fft: number, parent: THREE.Object3D | null): SpeakerAudio => {
      const el = new Audio();
      el.preload = 'auto';
      const pa = new THREE.PositionalAudio(listener);
      pa.setMediaElementSource(el);
      pa.setRefDistance(settingsRef.current.attenuazione);
      pa.setRolloffFactor(1);
      pa.setVolume(settingsRef.current.volume);
      parent?.add(pa);
      // FFT sul segnale della sorgente (prima dell'attenuazione con la distanza)
      const analyser = ctx.createAnalyser();
      analyser.fftSize = fft;
      if (id === 'cubi') {
        // L'originale misurava DOPO l'attenuazione (a 10-30 m dalla cassa
        // il segnale e' 20-30 dB piu' basso): qui si legge la sorgente
        // piena, quindi la finestra in dB e' spostata di ~20 dB per avere
        // lo stesso aspetto (bassi gialli, medi rossi, acuti blu) invece
        // di un muro tutto giallo. Misurato dal vivo sul brano demo.
        analyser.minDecibels = -85;
        analyser.maxDecibels = -10;
      }
      (pa.source as AudioNode).connect(analyser);
      return { id, el, pa, analyser, data: new Uint8Array(analyser.frequencyBinCount), tracks: [], isDemo: true, index: 0 };
    };
    const speakers = {
      cubi: make('cubi', 32, cubiSpeakerRef.current),
      schermo: make('schermo', 128, schermoSpeakerRef.current),
    };
    for (const sp of Object.values(speakers)) {
      sp.el.addEventListener('ended', () => {
        if (sp.tracks.length > 1) startTrack(sp, (sp.index + 1) % sp.tracks.length);
      });
    }
    audioRef.current = { listener, speakers };

    const resume = () => {
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      for (const sp of Object.values(speakers)) {
        if (playingRef.current[sp.id] && sp.el.paused && sp.el.src) sp.el.play().catch(() => {});
      }
    };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
    return () => {
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
      for (const sp of Object.values(speakers)) {
        sp.el.pause();
        sp.el.removeAttribute('src');
        sp.el.load();
        try {
          sp.pa.disconnect();
        } catch {
          /* gia' scollegato */
        }
        sp.analyser.disconnect();
        sp.pa.parent?.remove(sp.pa);
      }
      releaseAudioListener();
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  const startTrack = (sp: SpeakerAudio, index: number) => {
    if (!sp.tracks.length) return;
    sp.index = index;
    const tr = sp.tracks[index];
    sp.el.src = tr.url;
    sp.el.loop = sp.tracks.length === 1;
    settingsRef.current[sp.id === 'cubi' ? 'brano cubi' : 'brano schermo'] = tr.name;
    if (playingRef.current[sp.id]) {
      const ctx = audioRef.current?.listener.context;
      if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
      sp.el.play().catch(() => {});
    }
  };

  // (ri)carica le playlist all'avvio e quando cambiano i file nelle cartelle
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    for (const id of ['cubi', 'schermo'] as SpeakerId[]) {
      const sp = a.speakers[id];
      sp.tracks = playlists[id].tracks;
      sp.isDemo = playlists[id].isDemo;
      startTrack(sp, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistKey, camera]);

  // una cassa sola
  const toggleSpeaker = (id: SpeakerId, force?: boolean) => {
    const on = force ?? !playingRef.current[id];
    playingRef.current[id] = on;
    settingsRef.current[id === 'cubi' ? 'suona cubi' : 'suona schermo'] = on;
    const a = audioRef.current;
    if (!a) return;
    if (on && a.listener.context.state !== 'running') a.listener.context.resume().catch(() => {});
    const sp = a.speakers[id];
    if (on) sp.el.play().catch(() => {});
    else sp.el.pause();
  };
  // tutte e due (tasto M): se almeno una suona le mette in pausa entrambe,
  // altrimenti le fa ripartire entrambe
  const togglePlay = () => {
    const anyOn = playingRef.current.cubi || playingRef.current.schermo;
    toggleSpeaker('cubi', !anyOn);
    toggleSpeaker('schermo', !anyOn);
  };
  const next = (id: SpeakerId) => {
    const sp = audioRef.current?.speakers[id];
    if (sp) startTrack(sp, (sp.index + 1) % Math.max(1, sp.tracks.length));
  };

  useEffect(() => {
    audioArenaApi.current = { togglePlay, toggleSpeaker, next };
    return () => {
      audioArenaApi.current = null;
    };
  });

  // pannello "Musica"
  useEffect(() => {
    const gui = acquireDebugGui();
    const folder = gui.addFolder('Musica (casse arena)');
    const s = settingsRef.current;
    folder.add({ f: () => togglePlay() }, 'f').name('Play / pausa tutte (M)');
    folder.add(s, 'suona cubi').name('Cassa cubi: suona (J)').listen().onChange((v: boolean) => toggleSpeaker('cubi', v));
    folder.add({ f: () => next('cubi') }, 'f').name('Cassa cubi: brano successivo');
    folder.add(s, 'suona schermo').name('Cassa schermo: suona (K)').listen().onChange((v: boolean) => toggleSpeaker('schermo', v));
    folder.add({ f: () => next('schermo') }, 'f').name('Cassa schermo: brano successivo');
    // solo la musica (l'ascoltatore e' condiviso anche con la pistola)
    folder.add(s, 'volume', 0, 2, 0.05).name('Volume musica').onChange((v: number) => {
      const a = audioRef.current;
      if (a) for (const sp of Object.values(a.speakers)) sp.pa.setVolume(v);
    });
    folder
      .add(s, 'attenuazione', 1, 30, 0.5)
      .name('Distanza piena (m)')
      .onChange((v: number) => {
        const a = audioRef.current;
        if (a) for (const sp of Object.values(a.speakers)) sp.pa.setRefDistance(v);
      });
    folder.add(s, 'brano cubi').name('Cassa cubi (ovest)').listen().disable();
    folder.add(s, 'brano schermo').name('Cassa schermo (est)').listen().disable();
    return () => {
      folder.destroy();
      releaseDebugGui();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // luci: due spot dall'alto puntati sulle casse, come nell'originale
  const spotTargets = useMemo(() => {
    const a = new THREE.Object3D();
    a.position.set(-SPEAKER_X, SPEAKER_Y, 0);
    const b = new THREE.Object3D();
    b.position.set(SPEAKER_X, SPEAKER_Y, 0);
    return [a, b];
  }, []);

  useFrame((_st, delta) => {
    if (input.consumeJustPressed('music')) togglePlay();
    if (input.consumeJustPressed('musicCubi')) toggleSpeaker('cubi');
    if (input.consumeJustPressed('musicSchermo')) toggleSpeaker('schermo');
    const a = audioRef.current;
    const dt = Math.min(delta, 0.1);

    // cassa a cubi
    const cub = cubes;
    const spC = a?.speakers.cubi;
    if (spC) {
      spC.analyser.getByteFrequencyData(spC.data);
      cub.history.push(spC.data.slice());
      if (cub.history.length > CUBE_COLS) cub.history.shift();
      cub.timer += dt * 0.1;
      const colorAttr = cub.mesh.instanceColor!;
      for (let c = 0; c < cub.history.length; c++) {
        const d = cub.history[c];
        for (let r = 0; r < CUBE_ROWS; r++) {
          const i = c * CUBE_ROWS + r;
          const f = smootherstep(Math.sqrt(d[CUBE_REMAP[r]] / 255));
          const sc = 1 + 6 * f + fbm(cub.timer, c * 0.42142, r * 0.3455);
          _p.set(0, r * 0.35 - 3, (c - 5) * 0.35);
          _s.set(sc, 1, 1);
          _m.compose(_p, _q, _s);
          cub.mesh.setMatrixAt(i, _m);
          cub.mesh.setColorAt(i, splineColor(f, _c));
          cub.glow.setX(i, f * f * 1.5);
        }
      }
      cub.mesh.instanceMatrix.needsUpdate = true;
      colorAttr.needsUpdate = true;
      cub.glow.needsUpdate = true;
    }

    // cassa a schermo
    const spS = a?.speakers.schermo;
    if (spS) {
      spS.analyser.getByteFrequencyData(spS.data);
      mats.screenData.set(spS.data.subarray(0, 64));
      mats.screenTex.needsUpdate = true;
    }
    mats.screenUniforms.iTime.value += dt;
  });

  const wallProps = { castShadow: true, receiveShadow: true, material: mats.wallLong };
  const outer = ROOM_HALF + WALL_T / 2;
  return (
    <group>
      {/* pavimento: lastra visiva + collider per ragdoll/proiettili */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, AUDIO_ARENA_FLOOR_Y + 0.002, 0]} receiveShadow material={mats.floor}>
        <planeGeometry args={[ROOM_HALF * 2, ROOM_HALF * 2]} />
      </mesh>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[ROOM_HALF, 0.5, ROOM_HALF]} position={[0, AUDIO_ARENA_FLOOR_Y - 0.5, 0]} />
        {/* muri */}
        <CuboidCollider args={[outer + WALL_T / 2, WALL_H / 2, WALL_T / 2]} position={[0, AUDIO_ARENA_FLOOR_Y + WALL_H / 2, -outer]} collisionGroups={SOLID_GROUPS} />
        <CuboidCollider args={[outer + WALL_T / 2, WALL_H / 2, WALL_T / 2]} position={[0, AUDIO_ARENA_FLOOR_Y + WALL_H / 2, outer]} collisionGroups={SOLID_GROUPS} />
        <CuboidCollider args={[WALL_T / 2, WALL_H / 2, outer + WALL_T / 2]} position={[-outer, AUDIO_ARENA_FLOOR_Y + WALL_H / 2, 0]} collisionGroups={SOLID_GROUPS} />
        <CuboidCollider args={[WALL_T / 2, WALL_H / 2, outer + WALL_T / 2]} position={[outer, AUDIO_ARENA_FLOOR_Y + WALL_H / 2, 0]} collisionGroups={SOLID_GROUPS} />
        {/* casse */}
        <CuboidCollider args={[SPEAKER_W / 2, SPEAKER_H / 2, SPEAKER_D / 2]} position={[-SPEAKER_X, SPEAKER_Y, 0]} collisionGroups={SOLID_GROUPS} />
        <CuboidCollider args={[SPEAKER_W / 2, SPEAKER_H / 2, SPEAKER_D / 2]} position={[SPEAKER_X, SPEAKER_Y, 0]} collisionGroups={SOLID_GROUPS} />
      </RigidBody>
      <mesh position={[0, AUDIO_ARENA_FLOOR_Y + WALL_H / 2, -outer]} {...wallProps}>
        <boxGeometry args={[(outer + WALL_T / 2) * 2, WALL_H, WALL_T]} />
      </mesh>
      <mesh position={[0, AUDIO_ARENA_FLOOR_Y + WALL_H / 2, outer]} {...wallProps}>
        <boxGeometry args={[(outer + WALL_T / 2) * 2, WALL_H, WALL_T]} />
      </mesh>
      <mesh position={[-outer, AUDIO_ARENA_FLOOR_Y + WALL_H / 2, 0]} rotation={[0, Math.PI / 2, 0]} {...wallProps}>
        <boxGeometry args={[(outer + WALL_T / 2) * 2, WALL_H, WALL_T]} />
      </mesh>
      <mesh position={[outer, AUDIO_ARENA_FLOOR_Y + WALL_H / 2, 0]} rotation={[0, Math.PI / 2, 0]} {...wallProps}>
        <boxGeometry args={[(outer + WALL_T / 2) * 2, WALL_H, WALL_T]} />
      </mesh>

      {/* cassa OVEST: spettrogramma a cubi, rivolta verso il centro (+X) */}
      <group ref={cubiSpeakerRef} position={[-SPEAKER_X, SPEAKER_Y, 0]}>
        <mesh castShadow receiveShadow material={mats.speaker}>
          <boxGeometry args={[SPEAKER_W, SPEAKER_H, SPEAKER_D]} />
        </mesh>
        <group position={[SPEAKER_W / 2 + 0.125, 0, 0]}>
          <primitive object={cubes.mesh} />
        </group>
      </group>

      {/* cassa EST: schermo con barre circolari, rivolto verso il centro (-X) */}
      <group ref={schermoSpeakerRef} position={[SPEAKER_X, SPEAKER_Y, 0]}>
        <mesh castShadow receiveShadow material={mats.screenBody}>
          <boxGeometry args={[SPEAKER_W, SPEAKER_H, SPEAKER_D]} />
        </mesh>
        <mesh position={[-(SPEAKER_W / 2 + 0.01), 0, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow material={mats.screen}>
          <planeGeometry args={[SPEAKER_D, SPEAKER_H]} />
        </mesh>
      </group>

      <primitive object={spotTargets[0]} />
      <primitive object={spotTargets[1]} />
      <spotLight
        position={[-SPEAKER_X + 5, AUDIO_ARENA_FLOOR_Y + 21, 0]}
        target={spotTargets[0]}
        intensity={250}
        distance={50}
        angle={Math.PI / 4}
        penumbra={0.5}
        decay={1.5}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0001}
      />
      <spotLight
        position={[SPEAKER_X - 5, AUDIO_ARENA_FLOOR_Y + 21, 0]}
        target={spotTargets[1]}
        intensity={250}
        distance={50}
        angle={Math.PI / 4}
        penumbra={0.5}
        decay={1.5}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0001}
      />
    </group>
  );
};

export default AudioArena;
