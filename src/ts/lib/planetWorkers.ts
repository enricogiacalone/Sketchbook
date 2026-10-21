import * as THREE from 'three';
import type { NodeBuffers } from './quadNode';
import type { Vegetation, VegItem } from './nearTile';

// Pool di worker che generano terreno e vegetazione del pianeta (workers/planetWorker.ts). Le richieste vanno al worker meno
// occupato; la risposta arriva come promessa. Se i worker non ci sono (ambiente senza Worker) `available` e' falso e chi chiama
// ripiega sul calcolo nel thread principale.
const SIZE = Math.max(1, Math.min(3, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4) - 2));

interface Slot {
  worker: Worker;
  busy: number;
}
let slots: Slot[] | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: unknown) => void; slot: Slot }>();

function init(): Slot[] {
  if (slots) return slots;
  slots = [];
  try {
    for (let k = 0; k < SIZE; k++) {
      const worker = new Worker(new URL('../workers/planetWorker.ts', import.meta.url), { type: 'module' });
      const slot: Slot = { worker, busy: 0 };
      worker.onmessage = (e: MessageEvent) => {
        const m = e.data;
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        p.slot.busy--;
        if (m.type === 'error') p.reject(new Error(m.error));
        else p.resolve(m);
      };
      worker.onerror = (err) => console.warn('[planetWorker]', err.message);
      slots.push(slot);
    }
  } catch (e) {
    console.warn('[planetWorkers] worker non disponibili, calcolo nel thread principale', e);
    slots = [];
  }
  return slots;
}

export const workersAvailable = (): boolean => init().length > 0;
// quante richieste possono essere in corso insieme
export const workerCapacity = (): number => init().length * 2;
export const workersBusy = (): number => (slots ?? []).reduce((a, s) => a + s.busy, 0);

function send<T>(msg: Record<string, unknown>): Promise<T> {
  const ss = init();
  const slot = ss.reduce((a, b) => (b.busy < a.busy ? b : a));
  const id = nextId++;
  slot.busy++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject, slot });
    slot.worker.postMessage({ ...msg, id });
  });
}

export async function requestNode(face: number, level: number, i: number, j: number, seed: number, gridRadius: number): Promise<NodeBuffers> {
  const r = await send<{ buf: NodeBuffers }>({ type: 'node', face, level, i, j, seed, gridRadius });
  return r.buf;
}

const toItems = (p: { m: Float32Array; t: Int32Array; c?: Uint32Array | null }): VegItem[] => {
  const n = p.t.length;
  const out: VegItem[] = new Array(n);
  for (let k = 0; k < n; k++) {
    const m = new THREE.Matrix4().fromArray(p.m, k * 16);
    const e = m.elements;
    out[k] = { m, x: e[12], y: e[13], z: e[14], t: p.t[k], color: p.c ? p.c[k] : undefined };
  }
  return out;
};

export async function requestVegetation(key: number, seed: number, gridRadius: number, what: 'base' | 'tufts'): Promise<Vegetation> {
  const r = await send<{ trees: any; rocks: any; tufts: any }>({ type: 'veg', key, seed, gridRadius, what });
  return { trees: toItems(r.trees), rocks: toItems(r.rocks), tufts: toItems(r.tufts) };
}
