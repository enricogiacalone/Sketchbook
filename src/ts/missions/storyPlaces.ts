// Luoghi della missione "La ricetta di nonna Rosa" (Missions/StoryMission.tsx),
// disegnati da Environment/StoryPlaces.tsx. Coordinate del mondo [x, z].
//
//  - Bar Da Vito: sul bordo del parco (blocco 0,0), affacciato sulla strada
//    z = 0, a una trentina di metri da dove si parte
//  - Piazza del Mercato: la piazza a nord-ovest (blocco -2,2), bancarelle,
//    edicola di Lucky, gente da cui comprare e con cui parlare
//  - Deposito dei Serpenti: la piazza a sud-est (blocco 2,-2), recintata,
//    container e casse, le guardie e il pacco

// bar: 10 x 6 m, facciata (con la porta) verso -z, cioe' verso la strada
export const BAR = { x: 38, z: 11.5, w: 10, d: 6, h: 4 };
export const BAR_FRONT_Z = BAR.z - BAR.d / 2; // 8.5
// tavolini davanti al bar (centri)
export const BAR_TABLES: Array<[number, number]> = [
  [34.6, 6.9],
  [41.4, 6.9],
];

export const MARKET = { x: -90, z: 150 };
// bancarelle intorno alla statua: centro e verso (yaw: dove guarda il banco)
export const MARKET_STALLS: Array<{ x: number; z: number; yaw: number; color: string; goods: string }> = [
  { x: MARKET.x - 8, z: MARKET.z - 4, yaw: Math.PI / 2, color: '#e53935', goods: '#ff9800' },
  { x: MARKET.x - 8, z: MARKET.z + 5, yaw: Math.PI / 2, color: '#43a047', goods: '#ffeb3b' },
  { x: MARKET.x + 8, z: MARKET.z - 4, yaw: -Math.PI / 2, color: '#1e88e5', goods: '#8bc34a' },
  { x: MARKET.x + 8, z: MARKET.z + 5, yaw: -Math.PI / 2, color: '#fb8c00', goods: '#e91e63' },
];
// edicola di Lucky (chiosco), con il banco verso -z
export const KIOSK = { x: MARKET.x + 4, z: MARKET.z - 12 };
export const MARKET_BENCHES: Array<{ x: number; z: number; yaw: number }> = [
  { x: MARKET.x - 4, z: MARKET.z + 13, yaw: Math.PI },
  { x: MARKET.x + 5, z: MARKET.z + 13, yaw: Math.PI },
];

export const YARD = { x: 150, z: -90 };
export const YARD_HALF = 20; // recinto a +-20 m dal centro
export const YARD_GATE_HALF = 5; // varco sul lato -x (verso la citta')
// casse e container (centro, dimensioni, colore): ripari dalle pallottole
export const YARD_BOXES: Array<{ x: number; z: number; w: number; h: number; d: number; color: string; yaw?: number }> = [
  { x: YARD.x - 6, z: YARD.z - 9, w: 6, h: 2.6, d: 2.4, color: '#c62828' },
  { x: YARD.x + 2, z: YARD.z + 10, w: 6, h: 2.6, d: 2.4, color: '#1565c0', yaw: 0.3 },
  { x: YARD.x + 12, z: YARD.z - 6, w: 2.4, h: 2.6, d: 6, color: '#2e7d32' },
  { x: YARD.x - 10, z: YARD.z + 4, w: 1.2, h: 1.2, d: 1.2, color: '#8d6e63' },
  { x: YARD.x - 9.6, z: YARD.z + 5.4, w: 1.2, h: 1.2, d: 1.2, color: '#795548' },
  { x: YARD.x - 9.8, z: YARD.z + 4.6, w: 1.1, h: 1.1, d: 1.1, color: '#8d6e63' },
  { x: YARD.x - 2, z: YARD.z - 1, w: 1.2, h: 1.2, d: 1.2, color: '#8d6e63' },
  { x: YARD.x - 1, z: YARD.z + 0.2, w: 1.2, h: 2.4, d: 1.2, color: '#6d4c41' },
  { x: YARD.x + 5, z: YARD.z + 1, w: 1.2, h: 1.2, d: 1.2, color: '#8d6e63' },
];
// baracca dei Serpenti (il pacco e' sulla cassa davanti)
export const YARD_SHED = { x: YARD.x + 12, z: YARD.z + 9, w: 6, h: 3, d: 5 };
export const PACKAGE_POS: [number, number] = [YARD.x + 9, YARD.z + 5];
// furgone parcheggiato
export const YARD_VAN = { x: YARD.x - 2, z: YARD.z - 14, yaw: 0.2 };

// guardie: posizione e verso in cui guardano
export const GUARDS: Array<{ x: number; z: number; facing: number }> = [
  { x: YARD.x - 15, z: YARD.z - 3, facing: -Math.PI / 2 },
  { x: YARD.x - 15, z: YARD.z + 3, facing: -Math.PI / 2 },
  { x: YARD.x + 3, z: YARD.z - 5, facing: -Math.PI / 2 },
  { x: YARD.x + 7, z: YARD.z + 6, facing: -Math.PI / 2 },
];
// in piu' se Lucky ha fatto la spia: aspettano gia' fuori dal cancello
export const AMBUSH: Array<{ x: number; z: number; facing: number }> = [
  { x: YARD.x - 24, z: YARD.z - 7, facing: -Math.PI / 2 },
  { x: YARD.x - 24, z: YARD.z + 7, facing: -Math.PI / 2 },
];
// rinforzi quando prendi il pacco: arrivano di corsa dalla strada
export const REINFORCEMENTS: Array<[number, number]> = [
  [YARD.x - 30, YARD.z - 4],
  [YARD.x - 31, YARD.z + 2],
  [YARD.x + 2, YARD.z - 27],
];
