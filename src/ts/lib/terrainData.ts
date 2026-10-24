// Dati del terreno del sito corrente (components/Environment/Terrain.tsx li costruisce a pezzetti,
// lib/worldWarmup.ts): quote, vertici, normali, colori. Stanno qui perche' li leggono anche il
// drone (finestra di terreno) e le funzioni di altezza.
export const TERRAIN_STEP = 4; // m tra un punto e l'altro
export let TERRAIN_WINDOW_HALF = 1100; // mezzo lato (m) della finestra di terreno del sito corrente

export interface TerrainData {
  siteId: string;
  size: number;
  segments: number;
  heights: Float32Array; // heights[col * (segments+1) + row], row = x, col = z (come i vertici). Al collider Rapier va la TRASPOSTA (Terrain.tsx)
  vertices: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

let data: TerrainData | null = null;
export const getTerrainData = (siteId?: string): TerrainData | null => (data && (!siteId || data.siteId === siteId) ? data : null);
export const setTerrainData = (d: TerrainData | null) => {
  data = d;
  if (d) TERRAIN_WINDOW_HALF = d.size / 2;
};
export const setTerrainWindowHalf = (h: number) => {
  TERRAIN_WINDOW_HALF = h;
};
