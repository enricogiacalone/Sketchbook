import { useEffect, useState } from 'react';

// Monta le parti di un componente pesante UNA ALLA VOLTA: restituisce quanti passi sono scaduti (0..total), uno ogni `ms`.
// Ogni parte crea molte mesh e corpi fisici: tutte insieme congelavano il gioco per centinaia di millisecondi.
export function useStaggered(total: number, ms = 120, enabled = true): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled || n >= total) return;
    const id = window.setTimeout(() => setN((k) => k + 1), ms);
    return () => window.clearTimeout(id);
  }, [n, total, ms, enabled]);
  return Math.min(n, total);
}
