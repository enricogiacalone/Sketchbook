// Bersagli per l'aggancio della mira col pad (useThirdPersonCamera.ts):
// "falla come gta" -- premendo L2 con un'arma il mirino si aggancia al
// bersaglio piu' vicino al centro dello schermo, la levetta destra lo
// corregge di poco e un colpo deciso passa a quello accanto.
//
// Chi ha personaggi colpibili registra una funzione che li elenca (punto
// da mirare: il petto); la camera la chiama solo mentre si mira.

export interface AimTarget {
  id: string;
  x: number;
  y: number; // quota del punto da mirare (petto)
  z: number;
}

type Provider = (out: AimTarget[]) => void;
const providers = new Set<Provider>();

export function registerAimTargets(p: Provider): () => void {
  providers.add(p);
  return () => {
    providers.delete(p);
  };
}

export function collectAimTargets(out: AimTarget[]) {
  out.length = 0;
  for (const p of providers) p(out);
  return out;
}

export const AIM_CHEST_Y = 1.25; // m sopra i piedi

// stato dell'aggancio, letto dal mirino (WeaponHUD.tsx) e dai test
export const aimLock = {
  id: null as string | null,
  x: 0,
  y: 0,
  z: 0,
};
if (import.meta.env.DEV) (window as any).__aimLock = aimLock;
