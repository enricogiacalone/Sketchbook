// Tipi condivisi della rete del manichino (vedi useMannequinNetwork.ts)

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

// Stato di gioco inviato con la posa, 20 volte al secondo
export interface MannequinExt {
  hp: number;
  maxHp: number;
  dead: boolean;
  // in parata: chi colpisce fa meno danno (come nel duello)
  blocking: boolean;
  // arma: 0 = pronto basso, 1 = in mira (fucile/pistola)
  raise: number;
  reloading: boolean;
  // auto guidata (id dell'auto nella citta' + posa del telaio)
  veh: { id: string; p: Vec3; q: Quat } | null;
  // drone compagno (posa del modello)
  drone: { p: Vec3; q: Quat; flying: boolean } | null;
}

// Colpo su un altro giocatore: lo decide chi colpisce, lo applica il colpito
export interface NetHit {
  target: string;
  from?: string;
  damage: number;
  triggerHit: string | null;
  fromX: number;
  fromZ: number;
  knockdown: { dirX: number; dirZ: number; speed: number } | null;
  // proiettile: spinta nel punto esatto sul ragdoll attivo del colpito
  shot: { seg: string; dir: Vec3; speed: number; point: Vec3 } | null;
}

// Effetto di uno sparo (tracciante/lampo/scintille), solo visivo
export interface NetShot {
  from?: string;
  weapon: string;
  a: Vec3;
  b: Vec3;
  n: Vec3 | null;
  surface: 'world' | 'body' | 'bag' | 'none';
  decal: boolean;
}
