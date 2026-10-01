import { useEffect } from 'react';
import { useRapier } from '@react-three/rapier';

// "impostare la vista in modo da avere dei test empirici.. sia per te
// che per me" -- un crollo reale dura meno di un secondo (misurato dal
// vivo: un giunto puo' passare da 0 a oltre 170 gradi in una frazione di
// secondo), troppo veloce per essere seguito a occhio in tempo reale.
// Questo componente non disegna nulla: espone `world`/`rapier`/`step`
// del mondo fisico Rapier su window (stesso pattern gia' in uso in
// questo progetto per window.__gameStore/__r3fState/__sim -- vedi
// App.tsx/debug/simDebug.ts), cosi' un test dal vivo puo' mettere in
// pausa la fisica (store.ts's isPaused/setPaused, gia' collegato a
// <Physics paused> in App.tsx) e avanzare UN singolo step alla volta
// (CombatArenaGUI.tsx's pulsante "Passo singolo fisica") per vedere
// ESATTAMENTE il frame in cui un giunto sfora il proprio limite, invece
// di doverlo dedurre da una manciata di campioni presi a intervalli
// regolari. Dev-only (import.meta.env.DEV), nessun overhead/rischio in
// produzione. Va montato DENTRO <Physics> (App.tsx) -- useRapier()
// richiede quel context provider.
const RagdollPhysicsDebugBridge: React.FC = () => {
  const { world, rapier, step } = useRapier();

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as any).__physicsDebug = {
      world,
      rapier,
      // Un singolo step alla dimensione di tick fissa del mondo (vedi
      // App.tsx's <Physics timeStep={1/120}>) -- passare un valore
      // diverso simulerebbe un delta-time diverso da quello reale del
      // gioco, quindi il default e' sempre quello giusto per un test
      // fedele.
      step: (dt: number = 1 / 120) => step(dt),
    };
    return () => {
      if ((window as any).__physicsDebug) {
        delete (window as any).__physicsDebug;
      }
    };
  }, [world, rapier, step]);

  return null;
};

export default RagdollPhysicsDebugBridge;
