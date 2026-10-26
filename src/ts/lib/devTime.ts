// cronometro per le prove (solo dev): window.__dt = [[etichetta, ms, istante]]
export function devTime<T>(label: string, fn: () => T): T {
  if (!import.meta.env.DEV) return fn();
  const t = performance.now();
  const r = fn();
  const ms = performance.now() - t;
  if (ms > 8) (((window as any).__dt ??= []) as any[]).push([label, Math.round(ms), Math.round(t)]);
  return r;
}
