import { useStore } from '../store';

// Chat degli NPC con Ollama, tenuta leggera: spenta di default (casella nella
// welcome), una sola richiesta alla volta (il modello e' locale e uno solo:
// accodarne tante lo blocca e rallenta tutto), i saluti spontanei solo ogni
// tanto e mai se il modello e' gia' occupato, timeout per non restare appesi.

const GREET_COOLDOWN_S = 40;
const TIMEOUT_MS = 25000;

let inFlight = 0;
let lastGreetAt = -999;

export const ollamaEnabled = () => useStore.getState().ollamaNpcChat;

// null = niente risposta (spento, occupato, errore, timeout)
export async function askOllama(prompt: string, kind: 'greet' | 'chat', maxTokens = kind === 'greet' ? 24 : 48): Promise<string | null> {
  if (!ollamaEnabled() || inFlight > 0) return null;
  const now = performance.now() / 1000;
  if (kind === 'greet') {
    if (now - lastGreetAt < GREET_COOLDOWN_S) return null;
    lastGreetAt = now;
  }
  inFlight++;
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('/api/ollama', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, maxTokens }),
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.response === 'string' && data.response.trim() ? data.response.trim() : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
    inFlight--;
  }
}
