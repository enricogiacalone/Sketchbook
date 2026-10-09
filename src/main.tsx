import React from 'react';
import ReactDOM from 'react-dom/client';
import './css/main.css';
import { initWorldSeed } from './ts/lib/worldSeed';

// Prima il seme della citta' (dal database, lib/worldSeed.ts), poi il gioco:
// la citta' si genera quando il suo modulo viene importato, e deve venire
// sempre uguale a parita' di seme.
initWorldSeed().then(async () => {
  const { default: App } = await import('./ts/App');
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
