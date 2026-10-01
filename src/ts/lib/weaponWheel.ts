// Ruota delle armi, "come in gta": 8 settori per categoria, in ognuno le
// armi di quel tipo (si scorrono con la rotella / croce sinistra-destra).
// Stato condiviso tra il controller (dentro il Canvas: tastiera, mouse,
// pad) e l'overlay (UI/WeaponWheel.tsx).

export type WheelWeapon = 'fists' | 'pistol' | 'rifle' | 'knife';

export interface WheelSlot {
  label: string;
  weapons: WheelWeapon[];
}

// in senso orario dall'alto (0 = in alto, 1 = alto-destra, ...)
export const WHEEL_SLOTS: WheelSlot[] = [
  { label: 'Pistole', weapons: ['pistol'] },
  { label: 'Mitragliette', weapons: [] },
  { label: "Fucili d'assalto", weapons: ['rifle'] },
  { label: 'Fucili di precisione', weapons: [] },
  { label: 'Armi pesanti', weapons: [] },
  { label: 'Da lancio', weapons: [] },
  { label: 'Corpo a corpo', weapons: ['fists', 'knife'] },
  { label: 'Fucili a pompa', weapons: [] },
];

export const WEAPON_NAMES: Record<WheelWeapon, string> = {
  fists: 'Pugni',
  knife: 'Coltello',
  pistol: 'Pistola',
  rifle: "Fucile d'assalto",
};

export const slotOfWeapon = (w: WheelWeapon) => WHEEL_SLOTS.findIndex((s) => s.weapons.includes(w));

export const weaponWheel = {
  open: false,
  slot: 0, // settore evidenziato
  // arma scelta in ogni settore (indice in weapons)
  pick: WHEEL_SLOTS.map(() => 0),
  // direzione del puntatore (per la lancetta), px dal centro
  aimX: 0,
  aimY: 0,
};

export const wheelWeaponAt = (slot: number): WheelWeapon | null => {
  const s = WHEEL_SLOTS[slot];
  if (!s || s.weapons.length === 0) return null;
  return s.weapons[Math.min(weaponWheel.pick[slot], s.weapons.length - 1)];
};
