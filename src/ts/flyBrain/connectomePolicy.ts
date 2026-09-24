// "Il cervello della mosca" -- la RETE che comanda il corpo (flyBody.ts).
//
// Struttura = sottografo del connettoma di Drosophila (FlyWire v783,
// public/fly-brain, vedi CREDITS.txt), come in FlyGM (arXiv 2602.17997):
//  - AFFERENTI = neuroni ascendenti: nella mosca portano al cervello lo
//    stato del corpo dal cordone ventrale; qui ricevono la propriocezione
//    del corpo UMANO (la mosca "si crede un umano").
//  - INTERMEDI = neuroni centrali che collegano ascendenti -> discendenti.
//  - EFFERENTI = neuroni discendenti: nella mosca comandano le zampe; qui
//    la loro attivita' viene letta come correzione degli angoli articolari.
// Le SINAPSI (chi e' collegato a chi, con che segno e quanti contatti)
// sono quelle vere e restano FISSE. Si addestrano solo i parametri che il
// connettoma non dice: guadagno e soglia di ogni neurone, come ogni
// ascendente legge il suo canale sensoriale e come le azioni leggono i
// discendenti.
//
// Dinamica (tasso di scarica, tempo discreto): ad ogni passo di controllo
// K passaggi di messaggi  h <- tanh(gain * (W h) + bias + ingresso), con lo
// stato h che resta da un passo all'altro (memoria ricorrente).
// Uscita: azione = riferimento dell'animazione + 0.6 rad * tanh(D h_DN):
// con i parametri a zero il corpo insegue esattamente l'animazione, e la
// rete impara solo le CORREZIONI che servono a stare in equilibrio.

export interface FlyGraph {
  N: number;
  nAff: number;
  nInt: number;
  nEff: number;
  roles: Uint8Array; // 0 afferente, 1 intermedio, 2 efferente
  types: string[];
  // archi ordinati per neurone post: rowStart[post]..rowStart[post+1]
  rowStart: Int32Array;
  pre: Int32Array;
  w: Float32Array; // peso normalizzato per neurone post
}

export function parseFlyGraph(json: { neurons: { role: number; type: string }[] }, edges: ArrayBuffer): FlyGraph {
  const dv = new DataView(edges);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'FLYE') throw new Error('fly-brain-edges.bin non valido');
  const n = dv.getUint32(4, true);
  const pre = new Int32Array(edges.slice(8, 8 + 4 * n));
  const post = new Int32Array(edges.slice(8 + 4 * n, 8 + 8 * n));
  const wRaw = new Int16Array(edges.slice(8 + 8 * n, 8 + 10 * n));
  const N = json.neurons.length;
  const roles = new Uint8Array(N);
  const types: string[] = [];
  json.neurons.forEach((ne, i) => {
    roles[i] = ne.role;
    types.push(ne.type);
  });
  const rowStart = new Int32Array(N + 1);
  for (let e = 0; e < n; e++) rowStart[post[e] + 1]++;
  for (let i = 0; i < N; i++) rowStart[i + 1] += rowStart[i];
  // normalizzazione: somma dei quadrati dei pesi in ingresso = 1 per ogni
  // neurone (cosi' un neurone con 2000 sinapsi non satura e uno con 3 non
  // resta muto); segno e proporzioni restano quelli del connettoma
  const w = new Float32Array(n);
  for (let i = 0; i < N; i++) {
    let ss = 0;
    for (let e = rowStart[i]; e < rowStart[i + 1]; e++) ss += wRaw[e] * wRaw[e];
    const s = ss > 0 ? 1 / Math.sqrt(ss) : 0;
    for (let e = rowStart[i]; e < rowStart[i + 1]; e++) w[e] = wRaw[e] * s;
  }
  let nAff = 0, nInt = 0, nEff = 0;
  for (let i = 0; i < N; i++) roles[i] === 0 ? nAff++ : roles[i] === 1 ? nInt++ : nEff++;
  return { N, nAff, nInt, nEff, roles, types, rowStart, pre, w };
}

export interface PolicyLayout {
  nIn: number; // canali d'ingresso (osservazioni + comando)
  nOut: number; // azioni
  fanIn: number; // discendenti letti da ogni azione
  passes: number; // passaggi di messaggi per passo di controllo
  // offset dei blocchi nel vettore dei parametri
  oEncGain: number;
  oEncBias: number;
  oGain: number;
  oBias: number;
  oDec: number;
  oDecBias: number;
  nParams: number;
  // canale letto da ogni afferente, discendenti letti da ogni azione
  affChannel: Int32Array;
  affIndex: Int32Array;
  decIndex: Int32Array; // nOut * fanIn indici di neuroni efferenti
}

// Assegnazioni FISSE e deterministiche (non addestrate): stesso layout nel
// gioco e nell'addestramento.
export function makeLayout(g: FlyGraph, nIn: number, nOut: number, fanIn = 16, passes = 3): PolicyLayout {
  const aff: number[] = [];
  const eff: number[] = [];
  for (let i = 0; i < g.N; i++) {
    if (g.roles[i] === 0) aff.push(i);
    else if (g.roles[i] === 2) eff.push(i);
  }
  const affChannel = new Int32Array(aff.length);
  for (let k = 0; k < aff.length; k++) affChannel[k] = k % nIn;
  // generatore deterministico (mulberry32) per scegliere i discendenti
  let seed = 0x5eed;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const decIndex = new Int32Array(nOut * fanIn);
  for (let j = 0; j < decIndex.length; j++) decIndex[j] = eff[Math.floor(rnd() * eff.length)];
  let o = 0;
  const oEncGain = o; o += aff.length;
  const oEncBias = o; o += aff.length;
  const oGain = o; o += g.N;
  const oBias = o; o += g.N;
  const oDec = o; o += nOut * fanIn;
  const oDecBias = o; o += nOut;
  return { nIn, nOut, fanIn, passes, oEncGain, oEncBias, oGain, oBias, oDec, oDecBias, nParams: o, affChannel, affIndex: Int32Array.from(aff), decIndex };
}

// Parametri iniziali: ingresso e neuroni "accesi" in modo moderato, uscita
// a zero (= il corpo insegue esattamente l'animazione).
export function initialParams(L: PolicyLayout): Float32Array {
  const p = new Float32Array(L.nParams);
  for (let k = 0; k < L.affIndex.length; k++) p[L.oEncGain + k] = 1;
  // gain e' parametrizzato come 1 + p (vedi step), bias 0
  return p;
}

export class ConnectomeBrain {
  g: FlyGraph;
  L: PolicyLayout;
  p: Float32Array;
  h: Float32Array;
  private m: Float32Array;
  private inj: Float32Array;
  constructor(g: FlyGraph, L: PolicyLayout, params: Float32Array) {
    this.g = g;
    this.L = L;
    this.p = params;
    this.h = new Float32Array(g.N);
    this.m = new Float32Array(g.N);
    this.inj = new Float32Array(g.N);
  }
  reset() {
    this.h.fill(0);
  }
  // input: nIn canali; out: nOut valori in [-1, 1]
  step(input: Float32Array, out: Float32Array) {
    const { g, L, p, h, m, inj } = this;
    inj.fill(0);
    for (let k = 0; k < L.affIndex.length; k++) {
      inj[L.affIndex[k]] = Math.tanh(p[L.oEncGain + k] * input[L.affChannel[k]] + p[L.oEncBias + k]);
    }
    const { rowStart, pre, w } = g;
    for (let pass = 0; pass < L.passes; pass++) {
      for (let i = 0; i < g.N; i++) {
        let s = 0;
        for (let e = rowStart[i]; e < rowStart[i + 1]; e++) s += w[e] * h[pre[e]];
        m[i] = s;
      }
      for (let i = 0; i < g.N; i++) {
        h[i] = Math.tanh((1 + p[L.oGain + i]) * m[i] + p[L.oBias + i] + inj[i]);
      }
    }
    for (let j = 0; j < L.nOut; j++) {
      let s = p[L.oDecBias + j];
      const base = j * L.fanIn;
      for (let f = 0; f < L.fanIn; f++) s += p[L.oDec + base + f] * h[L.decIndex[base + f]];
      out[j] = Math.tanh(DECODER_GAIN * s);
    }
  }
}

export const RESIDUAL_SCALE_RAD = 0.6;
// amplifica la lettura dei discendenti: con le attivita' tipiche (~0.4) e
// 16 discendenti per azione, una piccola mutazione dei pesi deve poter
// cambiare l'angolo di qualche decimo di radiante, altrimenti
// l'evoluzione non "sente" l'effetto delle correzioni di equilibrio
const DECODER_GAIN = 5;

// Pesi addestrati: JSON con i parametri in base64 (Float32 little endian)
export interface FlyWeightsFile {
  task: string;
  nIn: number;
  nOut: number;
  fanIn: number;
  passes: number;
  generation: number;
  score: number;
  params: string;
}

export function encodeParams(p: Float32Array): string {
  const bytes = new Uint8Array(p.buffer, p.byteOffset, p.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
export function decodeParams(b64: string): Float32Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}
