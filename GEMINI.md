# Sketchbook AI Guide & Architecture

Questo documento serve come riferimento rapido per le IA che interagiscono con questo repository.

## Panoramica del Progetto
Sketchbook è un motore di gioco 3D basato su **Three.js** (grafica) e **Cannon-es** (fisica), scritto in TypeScript. Utilizza Vite per il build e Express/Socket.io per la parte multiplayer.

## Architettura Core (`src/ts/core/`)
- **World.ts**: Il punto di ingresso principale. Coordina tutti i manager.
- **InputManager.ts**: Gestisce tastiera, mouse e gamepad. Instrada i comandi all'oggetto che implementa `IInputReceiver`.
- **PhysicsManager.ts**: Gestisce il mondo fisico Cannon.js e la sincronizzazione con gli oggetti Three.js.
- **EntityManager.ts**: Gestisce il ciclo di vita (update) di tutte le entità nel mondo.

## Flusso di Inizializzazione
1. `sketchbook.ts` crea un'istanza di `World`.
2. `WorldBuilder` carica la scena (procedurale o GLTF).
3. `WorldBuilder` mostra il popup di benvenuto (`Swal`) per il nome e il metodo di input.
4. `World.onJoin` inizializza la connessione socket.

## Entità e Personaggi (`src/ts/characters/`)
- I personaggi utilizzano una Macchina a Stati (FSM) situata in `character_states/`.
- `Character.ts` è la classe base per il giocatore locale e gli NPC.
- `NetworkPlayer.ts` gestisce la rappresentazione remota degli altri giocatori.

## Veicoli (`src/ts/vehicles/`)
- Architettura gerarchica: `Vehicle` -> `Car`/`Airplane`/`Helicopter`.
- I veicoli hanno sedili (`VehicleSeat`) che i personaggi possono occupare.

## Convenzioni di Codifica
- **Integrità Fisica**: Le trasformazioni Three.js devono essere derivate dal corpo fisico Cannon.js, non viceversa (tranne per gli oggetti cinematici).
- **Update Loop**: Tutti gli oggetti che necessitano di aggiornamenti costanti devono essere registrati in `EntityManager`.
- **UI**: Gestita principalmente in `WorldUIManager.ts` (HTML dinamico) e `UIManager.ts` (gestione stati).

## Punti di Estensione Comuni
- **Nuovi Stati**: Aggiungere classi in `src/ts/characters/character_states/`.
- **Nuovi Veicoli**: Estendere `Vehicle.ts` e definire i collider fisici in `src/ts/physics/colliders/`.
