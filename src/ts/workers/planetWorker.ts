/// <reference lib="webworker" />
import { buildNodeMesh, makeNodeBuffers } from '../lib/quadNode';
import { buildTileVegetation, type Vegetation, type VegItem } from '../lib/nearTile';
import { profileFromSeed, setPlanet } from '../lib/planet';

// Genera terreno e vegetazione del pianeta FUORI dal thread principale: il calcolo (rumore procedurale per ogni vertice) non
// toglie piu' frame al rendering. Riceve richieste {type, id, ...} e risponde con array tipizzati (trasferiti, senza copia).
let lastSeed = -1;
const ensureProfile = (seed: number, gridRadius: number) => {
  // inCityRect (lib/nearTile.ts) legge la taglia della citta' dal catalogo dei pianeti
  if (lastSeed !== seed) {
    setPlanet(profileFromSeed(seed, gridRadius));
    lastSeed = seed;
  }
};

const pack = (items: VegItem[], withColor: boolean) => {
  const m = new Float32Array(items.length * 16);
  const t = new Int32Array(items.length);
  const c = withColor ? new Uint32Array(items.length) : null;
  items.forEach((it, i) => {
    m.set(it.m.elements, i * 16);
    t[i] = it.t;
    if (c) c[i] = it.color ?? 0;
  });
  return { m, t, c };
};

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  try {
    if (msg.type === 'node') {
      ensureProfile(msg.seed, msg.gridRadius);
      const buf = makeNodeBuffers();
      const g = buildNodeMesh(msg.face, msg.level, msg.i, msg.j, msg.seed, buf);
      while (!g.next().done);
      (self as unknown as Worker).postMessage({ type: 'node', id: msg.id, buf }, [buf.pos.buffer, buf.nor.buffer, buf.col.buffer, buf.mpos.buffer, buf.mnor.buffer, buf.mcol.buffer, buf.wpos.buffer, buf.wcol.buffer]);
    } else if (msg.type === 'veg') {
      ensureProfile(msg.seed, msg.gridRadius);
      const veg: Vegetation = { trees: [], rocks: [], tufts: [], houses: [] };
      const g = buildTileVegetation(msg.key, msg.seed, msg.what, veg);
      while (!g.next().done);
      const trees = pack(veg.trees, false), rocks = pack(veg.rocks, false), tufts = pack(veg.tufts, true), houses = pack(veg.houses, true);
      const tr: Transferable[] = [trees.m.buffer, trees.t.buffer, rocks.m.buffer, rocks.t.buffer, tufts.m.buffer, tufts.t.buffer, houses.m.buffer, houses.t.buffer];
      if (houses.c) tr.push(houses.c.buffer);
      if (tufts.c) tr.push(tufts.c.buffer);
      (self as unknown as Worker).postMessage({ type: 'veg', id: msg.id, trees, rocks, tufts, houses }, tr);
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', id: msg.id, error: String(err) });
  }
};
