import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { RigidBody, CuboidCollider, interactionGroups } from '@react-three/rapier';
import { useStore } from '../../../store';
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  Fn,
  attribute,
  instanceColor, // <--- Nodo nativo TSL per InstancedMesh
  texture,
  uv,
  vec2,
  vec3,
  vec4,
  float,
  mix,
  smoothstep,
  clamp,
  min,
  abs,
  sqrt,
  dot,
  cos,
  sin,
  mat2,
  distance,
  saturate,
  Loop,
} from 'three/tsl';
import { SimplexNoise } from 'three-stdlib';
import { getPlaylist, type SpeakerId, type Track } from './musicLibrary';
import { setFlatGroundOverride } from '../Road';
import { useInput } from '../../../hooks/useInput';
import { acquireDebugGui, releaseDebugGui } from '../../../lib/debugGui';
import { acquireAudioListener, releaseAudioListener } from '../../../lib/sharedAudioListener';
import { CollisionGroups, groupsExcluding } from '../../../enums/CollisionGroups';

export const AUDIO_ARENA_FLOOR_Y = 0.15;
const ROOM_HALF = 30;
const WALL_H = 12;
const WALL_T = 2;
const SPEAKER_X = 14;
const SPEAKER_W = 1;
const SPEAKER_H = 8;
const SPEAKER_D = 4;
const SPEAKER_Y = AUDIO_ARENA_FLOOR_Y + SPEAKER_H / 2;
const DEFAULT_REF_DISTANCE = 4;
const TEX = '/audio-arena/textures/';

const SOLID_GROUPS = groupsExcluding([CollisionGroups.Default, CollisionGroups.Characters, CollisionGroups.RagdollWorld]);
const FLOOR_GROUPS = interactionGroups(
  [0, 1, 2, 3, 4, 5, 6],
  Array.from({ length: 16 }, (_, i) => i)
);

// --- Cassa a cubi (Spettrogramma) ------------------------------------------
const CUBE_COLS = 11;
const CUBE_ROWS = 16;
const CUBE_REMAP = [15, 13, 11, 9, 7, 5, 3, 1, 0, 2, 4, 6, 8, 10, 12, 14];
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

// Palette cromatica satura
const SPLINE: [number, THREE.Color][] = [
  [0.0, new THREE.Color(0x0011ff)], // Blu saturo
  [0.35, new THREE.Color(0xff0055)], // Magenta / Rosso vivace
  [0.7, new THREE.Color(0xff5500)], // Arancio intenso
  [1.0, new THREE.Color(0xffaa00)], // Giallo-Arancio caldo
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

// --- Schermo a barre circolari (Nodi TSL / WebGPU) -----------------------
const pal = Fn(([t, a, b, c, d]: any[]) => {
  return a.add(b.mul(cos(float(6.28318).mul(c.mul(t).add(d)))));
});

const rotate2D = Fn(([pt, angle]: any[]) => {
  const c = cos(angle);
  const s = sin(angle);
  const m = mat2(c, s, s.negate(), c);
  return m.mul(pt);
});

const sdfTrapezoid = Fn(([p_in, r1, r2, he]: any[]) => {
  const p = vec2(abs(p_in.x), p_in.y);
  const k1 = vec2(r2, he);
  const k2 = vec2(r2.sub(r1), float(2.0).mul(he));

  const ca = vec2(p.x.sub(min(p.x, p.y.lessThan(0.0).select(r1, r2))), abs(p.y).sub(he));
  const cb = p.sub(k1).add(k2.mul(clamp(dot(k1.sub(p), k2).div(dot(k2, k2)), 0.0, 1.0)));
  const s = cb.x.lessThan(0.0).and(ca.y.lessThan(0.0)).select(-1.0, 1.0);
  return s.mul(sqrt(min(dot(ca, ca), dot(cb, cb))));
});

const createAudioVisualizerNode = (audioTex: THREE.DataTexture) => {
  return Fn(() => {
    const iResolution = vec2(128, 256);
    const aspect = iResolution.x.div(iResolution.y);
    const vVisUv = uv();
    const currentUv = vVisUv.mul(vec2(aspect, 1.0));
    const center = vec2(aspect.mul(0.5), 0.5);

    const numBars = float(64);
    const circleRadius = float(0.15);
    const barHeight = float(0.125);
    const barWidth = float(2.0 * Math.PI)
      .mul(circleRadius)
      .div(numBars.mul(1.25));

    const resultColour = vec4(1.0, 1.0, 1.0, 0.0).toVar();
    const position = vec2(center.x, center.y.add(circleRadius));

    Loop(64, ({ i }: { i: any }) => {
      const fi = float(i);
      const freqUV = fi.greaterThanEqual(32.0).select(float(1.0).sub(fi.sub(32.0).div(32.0)), fi.div(32.0));

      const frequencyData = texture(audioTex, vec2(freqUV, 0.0)).r;
      const barFinalHeight = barHeight.mul(float(0.1).add(float(0.9).mul(frequencyData)));
      const barDimensions = vec2(barWidth, barFinalHeight);

      const barAngle = float(2.0 * Math.PI)
        .mul(fi)
        .div(numBars);
      const barUvs = rotate2D(currentUv.sub(center), barAngle).add(center);

      const basePos = barUvs.sub(position).add(vec2(0.0, barDimensions.y.mul(-0.5).sub(frequencyData.mul(0.05))));
      const w = mix(barDimensions.x.mul(0.5), barDimensions.x, smoothstep(0.0, 1.0, frequencyData));
      const d = sdfTrapezoid(basePos, barDimensions.x.mul(0.5), w, barDimensions.y.mul(0.5));
      const barValue = d.greaterThan(0.0).select(0.0, 1.0);

      resultColour.w.assign(resultColour.w.add(barValue));
    });

    const d = saturate(float(1.1).mul(distance(currentUv, center).sub(circleRadius).div(barHeight)));
    const dSmooth = smoothstep(0.0, 1.0, d);
    const dFinal = float(0.45).add(float(0.55).mul(dSmooth));

    const colorPal = pal(dFinal, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.2, 0.3));

    return colorPal.mul(resultColour.w);
  })();
};

// --- Helper Materiali Node --------------------------------------------------
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
export const audioArenaApi: { current: AudioArenaApi | null } = { current: null };

function makePbrNode(
  t: Record<string, THREE.Texture>,
  prefix: string,
  repeatX: number,
  repeatY: number,
  anisotropy: number
): MeshStandardNodeMaterial {
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
  return new MeshStandardNodeMaterial({
    map: prep(t[prefix + 'Map'], true),
    normalMap: prep(t[prefix + 'Normal'], false),
    roughnessMap: prep(t[prefix + 'Rough'], false),
    metalnessMap: prep(t[prefix + 'Metal'], false),
    metalness: 0.1,
    roughness: 0.4,
  });
}

const ARENA_TEXTURES = {
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
};

const AudioArena: React.FC = () => {
  const { camera, gl } = useThree();
  const input = useInput();

  const tex = useTexture(ARENA_TEXTURES) as unknown as Record<string, THREE.Texture>;

  const mats = useMemo(() => {
    const an = Math.min(8, (gl as any).getMaxAnisotropy?.() ?? (gl as any).capabilities?.getMaxAnisotropy?.() ?? 4);
    const floor = makePbrNode(tex, 'floor', ((ROOM_HALF * 2) / 25) * 1.5, ((ROOM_HALF * 2) / 25) * 1.5, an);
    const wallLong = makePbrNode(tex, 'wall', ((ROOM_HALF * 2 + WALL_T * 2) / 25) * 2, (WALL_H / 25) * 2, an);
    const speaker = makePbrNode(tex, 'spk', 1, 1, an);

    // --- CUBI: Collegamento con il nodo integrato instanceColor ---------------
    const cube = makePbrNode(tex, 'cube', 1, 1, an);
    cube.metalness = 0.1;
    cube.roughness = 0.3;

    const aGlowNode = attribute('aGlow', 'float');

    // Usiamo il nodo instanceColor fornito da TSL per leggere mesh.instanceColor
    cube.colorNode = instanceColor;
    cube.emissiveNode = instanceColor.rgb.mul(aGlowNode);

    // Materiale Schermo
    const screenData = new Uint8Array(64);
    const screenTex = new THREE.DataTexture(screenData, 64, 1, THREE.RedFormat);
    screenTex.magFilter = THREE.LinearFilter;
    screenTex.needsUpdate = true;

    const screen = makePbrNode(tex, 'screen', 1, 1, an);
    screen.metalness = 1;
    screen.emissiveNode = createAudioVisualizerNode(screenTex);

    const screenBody = new MeshStandardNodeMaterial({ color: 0x404040, roughness: 0.1, metalness: 0 });
    return { floor, wallLong, speaker, cube, screen, screenBody, screenTex, screenData };
  }, [tex, gl]);

  // --- InstancedMesh Cubi --------------------------------------------------
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
    if (mesh.instanceColor) mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    return { mesh, glow, history: [] as Uint8Array[], timer: 0 };
  }, [mats]);

  // --- Audio -----------------------------------------------------------------
  const cubiSpeakerRef = useRef<THREE.Group>(null);
  const schermoSpeakerRef = useRef<THREE.Group>(null);
  const audioRef = useRef<{ listener: THREE.AudioListener; speakers: Record<SpeakerId, SpeakerAudio> } | null>(null);
  const playingRef = useRef<Record<SpeakerId, boolean>>({ cubi: false, schermo: false });
  const settingsRef = useRef({
    'suona cubi': false,
    'suona schermo': false,
    volume: 1,
    attenuazione: DEFAULT_REF_DISTANCE,
    'brano cubi': '-',
    'brano schermo': '-',
  });

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

      const analyser = ctx.createAnalyser();
      analyser.fftSize = fft;
      if (id === 'cubi') {
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

  useEffect(() => {
    const gui = acquireDebugGui();
    const folder = gui.addFolder('Musica (casse arena)');
    const s = settingsRef.current;
    folder.add({ f: () => togglePlay() }, 'f').name('Play / pausa tutte (M)');
    folder
      .add(s, 'suona cubi')
      .name('Cassa cubi: suona (J)')
      .listen()
      .onChange((v: boolean) => toggleSpeaker('cubi', v));
    folder.add({ f: () => next('cubi') }, 'f').name('Cassa cubi: brano successivo');
    folder
      .add(s, 'suona schermo')
      .name('Cassa schermo: suona (K)')
      .listen()
      .onChange((v: boolean) => toggleSpeaker('schermo', v));
    folder.add({ f: () => next('schermo') }, 'f').name('Cassa schermo: brano successivo');
    folder
      .add(s, 'volume', 0, 2, 0.05)
      .name('Volume musica')
      .onChange((v: number) => {
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

    // Cassa a cubi
    const cub = cubes;
    const spC = a?.speakers.cubi;
    if (spC) {
      spC.analyser.getByteFrequencyData(spC.data);
      cub.history.push(spC.data.slice());
      if (cub.history.length > CUBE_COLS) cub.history.shift();
      cub.timer += dt * 0.1;

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
          cub.glow.setX(i, f * 0.8);
        }
      }
      cub.mesh.instanceMatrix.needsUpdate = true;
      if (cub.mesh.instanceColor) cub.mesh.instanceColor.needsUpdate = true;
      cub.glow.needsUpdate = true;
    }

    // Cassa a schermo
    const spS = a?.speakers.schermo;
    if (spS) {
      spS.analyser.getByteFrequencyData(spS.data);
      mats.screenData.set(spS.data.subarray(0, 64));
      mats.screenTex.needsUpdate = true;
    }
  });

  const scene = useStore((st) => st.arenaScene);
  const wallProps = { castShadow: true, receiveShadow: true, material: mats.wallLong, visible: scene.walls };
  const outer = ROOM_HALF + WALL_T / 2;

  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, AUDIO_ARENA_FLOOR_Y + 0.002, 0]}
        receiveShadow
        material={mats.floor}
        visible={scene.floor}
      >
        <planeGeometry args={[ROOM_HALF * 2, ROOM_HALF * 2]} />
      </mesh>
      {scene.floor && (
        <RigidBody type="fixed" colliders={false}>
          <CuboidCollider args={[ROOM_HALF, 0.5, ROOM_HALF]} position={[0, AUDIO_ARENA_FLOOR_Y - 0.5, 0]} collisionGroups={FLOOR_GROUPS} />
        </RigidBody>
      )}
      {scene.walls && (
        <RigidBody type="fixed" colliders={false}>
          <CuboidCollider
            args={[outer + WALL_T / 2, WALL_H / 2, WALL_T / 2]}
            position={[0, AUDIO_ARENA_FLOOR_Y + WALL_H / 2, -outer]}
            collisionGroups={SOLID_GROUPS}
          />
          <CuboidCollider
            args={[outer + WALL_T / 2, WALL_H / 2, WALL_T / 2]}
            position={[0, AUDIO_ARENA_FLOOR_Y + WALL_H / 2, outer]}
            collisionGroups={SOLID_GROUPS}
          />
          <CuboidCollider
            args={[WALL_T / 2, WALL_H / 2, outer + WALL_T / 2]}
            position={[-outer, AUDIO_ARENA_FLOOR_Y + WALL_H / 2, 0]}
            collisionGroups={SOLID_GROUPS}
          />
          <CuboidCollider
            args={[WALL_T / 2, WALL_H / 2, outer + WALL_T / 2]}
            position={[outer, AUDIO_ARENA_FLOOR_Y + WALL_H / 2, 0]}
            collisionGroups={SOLID_GROUPS}
          />
        </RigidBody>
      )}
      {scene.speakers && (
        <RigidBody type="fixed" colliders={false}>
          <CuboidCollider
            args={[SPEAKER_W / 2, SPEAKER_H / 2, SPEAKER_D / 2]}
            position={[-SPEAKER_X, SPEAKER_Y, 0]}
            collisionGroups={SOLID_GROUPS}
          />
          <CuboidCollider
            args={[SPEAKER_W / 2, SPEAKER_H / 2, SPEAKER_D / 2]}
            position={[SPEAKER_X, SPEAKER_Y, 0]}
            collisionGroups={SOLID_GROUPS}
          />
        </RigidBody>
      )}
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

      <group ref={cubiSpeakerRef} position={[-SPEAKER_X, SPEAKER_Y, 0]} visible={scene.speakers}>
        <mesh castShadow receiveShadow material={mats.speaker}>
          <boxGeometry args={[SPEAKER_W, SPEAKER_H, SPEAKER_D]} />
        </mesh>
        <group position={[SPEAKER_W / 2 + 0.125, 0, 0]}>
          <primitive object={cubes.mesh} />
        </group>
      </group>

      <group ref={schermoSpeakerRef} position={[SPEAKER_X, SPEAKER_Y, 0]} visible={scene.speakers}>
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
