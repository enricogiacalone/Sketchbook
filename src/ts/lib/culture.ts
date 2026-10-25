import { hashKey } from './globalGrid';

// Le civilta' dei pianeti: ognuna prende ispirazione da un angolo del mondo vero (docs/stile.md). Qui solo dati: la cultura di un
// pianeta, i ruoli degli edifici e dei pezzi di arredo, le loro dimensioni (le leggono sia i modelli sia i collider) e i colori.
export enum Culture { Med, Alp, Mag, Asia }
export const CULTURE_NAMES = ['mediterranea', 'alpina', 'maghrebina', 'asiatica'] as const;
export const cultureName = (c: number) => CULTURE_NAMES[c] ?? CULTURE_NAMES[0];

// pianeti noti: una cultura a testa (il giocatore le incontra tutte), gli altri dal seme
const FIXED: Record<number, Culture> = { 101: Culture.Med, 202: Culture.Alp, 303: Culture.Mag, 404: Culture.Asia, 505: Culture.Med, 1: Culture.Alp };
export function cultureOfPlanet(seed: number): Culture {
  const w = typeof window !== 'undefined' ? (window as any).__forceCulture : undefined;
  if (import.meta.env.DEV && typeof w === 'number') return w as Culture;
  if (FIXED[seed] !== undefined) return FIXED[seed];
  return Math.floor(hashKey(seed | 0, 41, 9) * 4) % 4;
}

// ruoli: cosa e' il pezzo; la cultura decide com'e' fatto. (40+: le rovine, lib/village.ts)
export enum Role {
  HouseS, HouseM, HouseL, RowLow, RowMid, RowHigh, Temple, Tower, Fountain, Stall, Lamp, Fence, Wall, Gate, Granary, Stack,
  Archway, Cart, Barrels, Woodpile, Garden, Laundry, Shed, Pillar, Lantern, TreeA, TreeB, Well, Trough,
  // citta' moderne e infrastrutture: palazzo, grattacielo, capannone, ciminiera, pila della sopraelevata (alta 1 m, si allunga), panchina
  Block, Skyscraper, Warehouse, Chimney, Pier, Bench,
  RuinWall = 40, RuinColumn, RuinBlock, RuinArch, RuinFallen,
}
export const ROLE_VARIANTS = 8;
// il tipo salvato (`t`): ruolo (6 bit) | variante del tetto/colore (3 bit) | cultura (2 bit)
export const encodeKind = (role: number, variant: number, culture: number) => role | (variant << 6) | (culture << 9);
export const roleOf = (t: number) => t & 63;
export const variantOf = (t: number) => (t >> 6) & 7;
export const cultureOfKind = (t: number) => (t >> 9) & 3;
// quante varianti distinte ha davvero un ruolo (colore del tetto, dettagli): ogni variante e' un modello e una mesh istanziata in piu'
// per tessera, quindi i ruoli che non le usano restano a 0 (meno chiamate di disegno nelle citta'); `town` ne limita le case
const VARIANT_COUNT: Record<number, number> = {
  [Role.HouseS]: 5, [Role.HouseM]: 5, [Role.HouseL]: 4, [Role.RowLow]: 4, [Role.RowMid]: 4, [Role.RowHigh]: 4, [Role.Granary]: 3, [Role.Stack]: 3,
  [Role.TreeA]: 2, [Role.TreeB]: 3, [Role.Block]: 4, [Role.Skyscraper]: 4, [Role.Warehouse]: 2, [Role.Shed]: 2,
};
export const variantFor = (role: number, r: number, town = false): number => Math.floor(r * Math.min(VARIANT_COUNT[role] ?? 1, town && role <= Role.RowHigh ? 3 : 9));
export const BRIDGE_BASE = 2048; // ponti: BRIDGE_BASE + b (lunghezza 4*b m)

export interface Dim { w: number; h: number; d: number; solid: boolean; chimney?: [number, number, number]; door?: number }
// dimensioni (m) [larghezza x, altezza, profondita' z] del volume intero (fronte = +z), per cultura e ruolo.
// Dove una cultura non ha il ruolo, vale quello della prima (Med).
const D = (w: number, h: number, d: number, solid = true, extra: Partial<Dim> = {}): Dim => ({ w, h, d, solid, ...extra });
const MED: Record<number, Dim> = {
  [Role.HouseS]: D(6.5, 6.6, 6, true, { chimney: [1.8, 7.3, -0.8] }), [Role.HouseM]: D(8.5, 7.6, 7.5, true, { chimney: [-2.4, 8.3, -1] }), [Role.HouseL]: D(12, 8.2, 10, true, { chimney: [3, 9, -2] }),
  [Role.RowLow]: D(6, 4.4, 7.5), [Role.RowMid]: D(6, 7.2, 8, true, { chimney: [1.5, 8, -1.5] }), [Role.RowHigh]: D(6, 9.8, 8),
  [Role.Temple]: D(10, 12.5, 18), [Role.Tower]: D(4.6, 21, 4.6), [Role.Fountain]: D(5, 3.6, 5), [Role.Stall]: D(3, 2.8, 2.2), [Role.Lamp]: D(0.5, 4.3, 0.5),
  [Role.Fence]: D(4, 1.1, 0.5), [Role.Wall]: D(6, 4.6, 1.1), [Role.Gate]: D(7.2, 7, 2.8, false), [Role.Granary]: D(10, 6.4, 8, true), [Role.Stack]: D(3, 3.2, 3),
  [Role.Archway]: D(4.4, 6, 1.4, false), [Role.Cart]: D(1.8, 1.2, 3.2), [Role.Barrels]: D(2, 1.1, 1.4), [Role.Woodpile]: D(3, 1.4, 1.2), [Role.Garden]: D(5, 0.5, 3.5, false),
  [Role.Laundry]: D(4, 2.2, 0.3, false), [Role.Shed]: D(3.4, 2.8, 3), [Role.Pillar]: D(2, 7, 2), [Role.Lantern]: D(0.5, 1, 0.5), [Role.TreeA]: D(1, 12, 1, true), [Role.TreeB]: D(1.2, 6, 1.2, true),
  [Role.Well]: D(2.2, 1.2, 2.2), [Role.Trough]: D(3, 1, 1.2),
  [Role.Block]: D(16, 21, 12), [Role.Skyscraper]: D(20, 56, 20), [Role.Warehouse]: D(30, 9, 18), [Role.Chimney]: D(5, 38, 5), [Role.Pier]: D(1.8, 1, 1.4), [Role.Bench]: D(1.8, 0.9, 0.6, false),
};
const ALP: Record<number, Dim> = {
  ...MED,
  [Role.HouseS]: D(7.5, 7.4, 8.5, true, { chimney: [2, 8.4, -1.5] }), [Role.HouseM]: D(10, 8.6, 9.5, true, { chimney: [-2.8, 9.6, -2] }), [Role.HouseL]: D(14, 9.4, 11, true, { chimney: [3.5, 10.4, -2.5] }),
  [Role.RowLow]: D(6, 4.8, 8), [Role.RowMid]: D(6.5, 7.8, 8.5, true, { chimney: [1.5, 8.8, -1.5] }), [Role.RowHigh]: D(6.5, 9.6, 8.5),
  [Role.Temple]: D(8, 11, 16), [Role.Tower]: D(5, 24, 5), [Role.Granary]: D(10.5, 8.6, 8.5), [Role.Wall]: D(5, 1.3, 0.8), [Role.Gate]: D(5, 3.5, 1, false),
  [Role.Fountain]: D(4.5, 2.6, 2.4), [Role.Pillar]: D(1.4, 3, 1.4),
};
const MAG: Record<number, Dim> = {
  ...MED,
  [Role.HouseS]: D(6.5, 5.2, 6.5), [Role.HouseM]: D(8, 6.8, 8), [Role.HouseL]: D(13, 7.2, 13, true, { chimney: undefined }),
  [Role.RowLow]: D(6, 3.8, 7), [Role.RowMid]: D(6, 6.4, 7.5), [Role.RowHigh]: D(6.5, 9, 8),
  [Role.Temple]: D(14, 9, 16), [Role.Tower]: D(5, 28, 5), [Role.Fountain]: D(4.5, 2.6, 4.5), [Role.Stall]: D(3.2, 3, 2.6), [Role.Lamp]: D(0.5, 3.4, 0.5),
  [Role.Wall]: D(6, 6.2, 1.3), [Role.Gate]: D(7, 8, 3, false), [Role.Granary]: D(9, 5, 8), [Role.Archway]: D(3.6, 5.2, 1.6, false), [Role.Pillar]: D(2.6, 9, 2.6),
  [Role.TreeA]: D(1, 13, 1, true), [Role.TreeB]: D(1.2, 5, 1.2, true),
};
const ASIA: Record<number, Dim> = {
  ...MED,
  [Role.HouseS]: D(7, 5.6, 6.5), [Role.HouseM]: D(9, 6.8, 8), [Role.HouseL]: D(13, 7.6, 10.5),
  [Role.RowLow]: D(6, 5, 7), [Role.RowMid]: D(6, 7.4, 7.5), [Role.RowHigh]: D(6.5, 9.4, 7.5),
  [Role.Temple]: D(12, 10.5, 12), [Role.Tower]: D(7, 22, 7), [Role.Fountain]: D(3.2, 1.8, 3.2), [Role.Lamp]: D(0.5, 3.6, 0.5), [Role.Wall]: D(6, 2.1, 0.9),
  [Role.Gate]: D(5.2, 6, 1.8, false), [Role.Granary]: D(7, 6, 6.5), [Role.Pillar]: D(0.7, 6, 0.7), [Role.Lantern]: D(0.6, 1.9, 0.6),
  [Role.Block]: D(14, 22, 11), [Role.Skyscraper]: D(18, 64, 18),
};
const RUINS: Record<number, Dim> = {
  [Role.RuinWall]: D(4, 2.2, 0.7), [Role.RuinColumn]: D(1, 3.2, 1), [Role.RuinBlock]: D(1.4, 0.9, 1.4), [Role.RuinArch]: D(5.4, 5.3, 1.1, false), [Role.RuinFallen]: D(0.9, 0.9, 4),
};
export const KIT: Record<number, Record<number, Dim>> = { [Culture.Med]: { ...MED, ...RUINS }, [Culture.Alp]: { ...ALP, ...RUINS }, [Culture.Mag]: { ...MAG, ...RUINS }, [Culture.Asia]: { ...ASIA, ...RUINS } };
export const dimOf = (culture: number, role: number): Dim => KIT[culture]?.[role] ?? KIT[0][role] ?? D(1, 1, 1);

export interface Palette {
  walls: number[]; // colori delle pareti (moltiplicano il bianco dei modelli)
  roofs: string[]; // varianti del tetto (indice = variante)
  street: string; // fondo delle strade
  plaza: string; // fondo della piazza
  trim: string;
  shirts: string[]; // magliette/abiti degli abitanti
}
export const PALETTE: Record<number, Palette> = {
  [Culture.Med]: {
    walls: [0xf4e9d4, 0xeadbb8, 0xf1deae, 0xdcae82, 0xcf9573, 0xf7f1e6, 0xe6c9a0],
    roofs: ['#b5523b', '#a8472f', '#c1673f', '#9d4a35', '#bd5f40', '#a95a3c', '#b8553a', '#c47a50'],
    street: '#b7ab9a', plaza: '#cfc5b3', trim: '#dcd3c2',
    shirts: ['#8d6e63', '#6d7b8d', '#a1887f', '#7e8f5c', '#9c7a5b', '#b0a090', '#5d6d7a', '#a68a5b'],
  },
  [Culture.Alp]: {
    walls: [0xeadfce, 0xd8cdb8, 0xc7b79a, 0xb59d78, 0xa68a62, 0xcfc4b0, 0xe3d6bd],
    roofs: ['#4a3a2e', '#5a6168', '#8a4e36', '#3f342b', '#6b5a48', '#555b61', '#7a4a34', '#463a30'],
    street: '#8d8374', plaza: '#a29786', trim: '#6b4a30',
    shirts: ['#6f5a46', '#4d5d46', '#7a3d36', '#5d6f7d', '#8a7a5a', '#394a3a', '#7d6350', '#4a4f5a'],
  },
  [Culture.Mag]: {
    walls: [0xe9d6b6, 0xdcc6a0, 0xd9ba8a, 0xcfae7f, 0xf0e4cb, 0xd8b890, 0xc9a273],
    roofs: ['#d6c29c', '#cdb58a', '#dfcfae', '#c8ae82', '#d9c6a0', '#cdbb94', '#d2bd92', '#e0d2b4'],
    street: '#c4a674', plaza: '#d3b98a', trim: '#2f6fa3',
    shirts: ['#e8e0d0', '#c9b99a', '#3d6f94', '#8a5a3a', '#b8442f', '#e6d9b8', '#5d7a5a', '#a89060'],
  },
  [Culture.Asia]: {
    walls: [0xf4efe6, 0xe9e2d3, 0xddd2bd, 0xd3c4a8, 0xf0e9db, 0xcfc3ae, 0xe6dcc6],
    roofs: ['#50555a', '#434950', '#5a5f66', '#3f444a', '#6a5a4c', '#4a525a', '#575c61', '#3a4046'],
    street: '#9b958a', plaza: '#b3ada1', trim: '#b8312f',
    shirts: ['#3d5a80', '#7a8b6a', '#a8553b', '#4a4f5a', '#c9b37a', '#5b3f6b', '#8a8f9a', '#2f4f4f'],
  },
};

// colori dei campi attorno al villaggio (lavori): per cultura, a rettangoli
export const FIELD_COLORS: Record<number, string[]> = {
  [Culture.Med]: ['#8a7b4a', '#6f8a4a', '#a89458', '#7d6a45', '#5f7a45', '#b09a64'], // grano secco, vigna, ulivi, terra arata
  [Culture.Alp]: ['#6aa04a', '#7bb055', '#5e9443', '#a8b86a', '#6a9a50', '#8aab5a'], // prati da sfalcio e pascolo
  [Culture.Mag]: ['#3f7a3a', '#c9a96c', '#4a8540', '#b8955c', '#2f6a35', '#d0b57a'], // palmeto, orti irrigati, sabbia
  [Culture.Asia]: ['#7fae4a', '#5f9a58', '#6a9fa0', '#8bbd55', '#58936a', '#74a8a8'], // risaie (verde e acqua)
};
