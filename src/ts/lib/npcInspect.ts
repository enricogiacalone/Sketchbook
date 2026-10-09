// Registro dell'ispettore NPC (UI/NpcInspector.tsx): chi si puo' scegliere
// col clic e cosa dice di se'. Ogni personaggio si iscrive con una
// funzione che dice dov'e' (per la scelta col raggio del mouse) e una che
// descrive il suo stato (animazioni in corso, comportamento...), chiamate
// solo mentre l'ispettore e' acceso.

export interface InspectAnim {
  clip: string;
  weight: number; // peso effettivo nel mixer (0-1)
  time: number; // s dentro la clip
  duration: number;
  timeScale: number;
  loop: boolean;
}

export interface InspectInfo {
  title: string;
  // righe "chiave: valore"
  rows: [string, string][];
  anims?: InspectAnim[];
}

export interface Inspectable {
  // piedi del personaggio (mondo) e altezza: la scelta usa questo segmento
  where: (out: { x: number; y: number; z: number; h: number }) => boolean;
  info: () => InspectInfo;
}

export const inspectables = new Map<string, Inspectable>();

export function registerInspectable(id: string, item: Inspectable): () => void {
  inspectables.set(id, item);
  return () => {
    if (inspectables.get(id) === item) inspectables.delete(id);
  };
}

// le azioni del mixer che contano adesso (peso > 0), la piu' pesante prima
export function mixerAnims(mixer: { _actions?: any[] }): InspectAnim[] {
  const out: InspectAnim[] = [];
  for (const a of (mixer as any)._actions ?? []) {
    if (!a.isRunning() && a.getEffectiveWeight() <= 0) continue;
    const w = a.getEffectiveWeight();
    if (w <= 0.001) continue;
    const clip = a.getClip();
    out.push({
      clip: clip.name,
      weight: w,
      time: a.time,
      duration: clip.duration,
      timeScale: a.getEffectiveTimeScale(),
      loop: a.loop !== 2200, // THREE.LoopOnce
    });
  }
  return out.sort((x, y) => y.weight - x.weight);
}
