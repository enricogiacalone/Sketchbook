import * as THREE from 'three';

// "un giorno potrei avere un fucile di precisione e colpire obiettivi
// lontani": i colpi si risolvono sul mondo fisico (hitscan.ts), ma da
// lontano i personaggi non ci sono -- le sagome della folla non hanno
// fisica, e i corpi veri oltre ~45 m parcheggiano le loro capsule (vedi
// useMannequinActor). Qui ognuno di loro offre una forma di colpo "a
// conti" (capsule verticali: gambe, busto, testa), provata dopo il raggio
// fisico: se la prende prima di quello che il raggio ha colpito, il colpo
// e' suo. Costa qualche moltiplicazione per personaggio, solo quando si spara.

export interface ProxyHit {
  ownerId: string;
  segment: string;
  distance: number;
  // per le sagome della folla: l'agente da far diventare un corpo vero
  crowdAgentId?: number;
}

export type ShotProxyProvider = (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => ProxyHit | null;

const providers = new Set<ShotProxyProvider>();

export function registerShotProxy(fn: ShotProxyProvider): () => void {
  providers.add(fn);
  return () => {
    providers.delete(fn);
  };
}

export function raycastProxies(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, shooterId: string): ProxyHit | null {
  let best: ProxyHit | null = null;
  for (const p of providers) {
    const h = p(origin, dir, best ? best.distance : maxDist);
    if (h && h.ownerId !== shooterId && h.distance <= maxDist && (!best || h.distance < best.distance)) best = h;
  }
  return best;
}

if (import.meta.env.DEV) (window as any).__raycastProxies = raycastProxies;
