import * as THREE from 'three';

// Suoni sintetizzati con WebAudio (nessun file): vento, acqua, campane, galline, cani, uccelli, passi. Sono sorgenti-nodo da
// collegare a un `THREE.PositionalAudio` (setNodeSource) o all'ingresso dell'ascoltatore condiviso (lib/sharedAudioListener.ts).
export const audioCtx = (): AudioContext => THREE.AudioContext.getContext() as AudioContext;

let noiseBuf: AudioBuffer | null = null;
// 3 s di rumore "marrone" (piu' grave del bianco) da ripetere in loop
export function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const len = ctx.sampleRate * 3;
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.04 * w) / 1.04;
    d[i] = last * 3.2 + w * 0.12;
  }
  noiseBuf = b;
  return b;
}
const whiteBuf = new WeakMap<AudioContext, AudioBuffer>();
export function whiteBuffer(ctx: AudioContext): AudioBuffer {
  let b = whiteBuf.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    whiteBuf.set(ctx, b);
  }
  return b;
}

// rumore in loop attraverso un filtro; ritorna i nodi per regolarli (gain e frequenza)
export function loopNoise(ctx: AudioContext, dest: AudioNode, type: BiquadFilterType, freq: number, q: number, white = false) {
  const src = ctx.createBufferSource();
  src.buffer = white ? whiteBuffer(ctx) : noiseBuffer(ctx);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = 0;
  src.connect(f);
  f.connect(g);
  g.connect(dest);
  src.start(0, Math.random() * 2);
  return { src, filter: f, gain: g, stop: () => { try { src.stop(); } catch { /* gia' fermo */ } src.disconnect(); f.disconnect(); g.disconnect(); } };
}

const env = (g: GainNode, t0: number, attack: number, peak: number, decay: number) => {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
};

// coccodè: due o tre "bok" squadrati con voce nasale che scende
export function playCluck(ctx: AudioContext, dest: AudioNode, vol = 0.5, pitch = 1) {
  const n = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const t0 = ctx.currentTime + i * (0.13 + Math.random() * 0.05);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(620 * pitch, t0);
    o.frequency.exponentialRampToValueAtTime(300 * pitch, t0 + 0.09);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1100;
    f.Q.value = 2.2;
    const g = ctx.createGain();
    env(g, t0, 0.008, vol, 0.09);
    o.connect(f); f.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + 0.16);
  }
}

// abbaio: raffica rauca (rumore + voce che scende), due colpi
export function playBark(ctx: AudioContext, dest: AudioNode, vol = 0.6, pitch = 1) {
  for (let i = 0; i < 2; i++) {
    const t0 = ctx.currentTime + i * 0.28;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(420 * pitch, t0);
    o.frequency.exponentialRampToValueAtTime(190 * pitch, t0 + 0.17);
    const nz = ctx.createBufferSource();
    nz.buffer = whiteBuffer(ctx);
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 900;
    nf.Q.value = 1;
    const g = ctx.createGain();
    env(g, t0, 0.012, vol, 0.16);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    o.connect(lp); nz.connect(nf); nf.connect(lp); lp.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + 0.24);
    nz.start(t0); nz.stop(t0 + 0.2);
  }
}

// cinguettio: due o tre note veloci che salgono
export function playChirp(ctx: AudioContext, dest: AudioNode, vol = 0.25) {
  const n = 2 + Math.floor(Math.random() * 3);
  let t = ctx.currentTime;
  for (let i = 0; i < n; i++) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f0 = 2600 + Math.random() * 900;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 1.45, t + 0.07);
    const g = ctx.createGain();
    env(g, t, 0.006, vol, 0.08);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + 0.12);
    t += 0.1 + Math.random() * 0.06;
  }
}

// un rintocco di campana: fondamentale + parziali inarmonici che si spengono a velocita' diverse
export function playBellStroke(ctx: AudioContext, dest: AudioNode, vol = 0.5, base = 392, at = 0) {
  const t0 = ctx.currentTime + at;
  const partials: Array<[number, number, number]> = [[0.5, 0.35, 5.5], [1, 1, 4.5], [1.2, 0.5, 3.5], [1.5, 0.28, 3], [2, 0.5, 2.6], [2.5, 0.22, 2], [3.1, 0.16, 1.5], [4.2, 0.1, 1]];
  for (const [ratio, amp, dec] of partials) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = base * ratio;
    const g = ctx.createGain();
    env(g, t0, 0.004, vol * amp * 0.35, dec);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + dec + 0.1);
  }
}

// passo sull'erba: soffio breve di rumore filtrato
export function playStep(ctx: AudioContext, dest: AudioNode, vol = 0.12, bright = 1) {
  const t0 = ctx.currentTime;
  const nz = ctx.createBufferSource();
  nz.buffer = whiteBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 1500 * bright;
  f.Q.value = 0.7;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 300;
  const g = ctx.createGain();
  env(g, t0, 0.006, vol, 0.075);
  nz.connect(f); f.connect(hp); hp.connect(g); g.connect(dest);
  nz.start(t0, Math.random() * 0.3); nz.stop(t0 + 0.12);
}

// emettitore posizionale (uno per fonte): un bus di guadagno da cui partono i suoni, agganciato a `parent`
export function makeEmitter(listener: THREE.AudioListener, parent: THREE.Object3D, ref: number, rolloff = 1.4, max = 120) {
  const ctx = audioCtx();
  const a = new THREE.PositionalAudio(listener);
  a.setRefDistance(ref);
  a.setRolloffFactor(rolloff);
  a.setMaxDistance(max);
  a.setDistanceModel('inverse');
  const bus = ctx.createGain();
  bus.gain.value = 1;
  a.setNodeSource(bus as unknown as AudioBufferSourceNode);
  parent.add(a);
  return { audio: a, bus, dispose: () => { parent.remove(a); try { a.disconnect(); } catch { /* gia' staccato */ } bus.disconnect(); } };
}
