# CLAUDE.md

Fork di Sketchbook (swift502) riscritto da zero: il vecchio motore (`src/ts/core`, `characters`, `vehicles`, cannon-es) **non esiste piu'**; `GEMINI.md` lo descrive ancora ed e' obsoleto. Oggi e' un gioco 3D in **React 19 + React Three Fiber + Rapier** (`@react-three/rapier`), stato in **zustand**, build con **Vite**, backend Express/Socket.io/SQLite per il multiplayer. Commenti e documenti sono in italiano.

## Comandi

```sh
npm run dev              # vite (5173) + server.js (3000) insieme
npx vite --port 5174     # solo frontend per i test nel browser integrato: MAI passare --open (apre /false)
npx tsc --noEmit         # controllo tipi (non ci sono test automatici)
npm run format           # prettier
npm run models           # ottimizza i .glb (scripts/optimize-models.mjs)
npm run kimodo           # genera animazioni (tools/kimodo): job lungo, vedi sotto
npm run mosca:train -- --task stand|walk|getup [--from <pesi>]   # addestra il cervello-mosca (Node >= 22.6)
npm run mosca:eval | mosca:test | mosca:walkassist
```

Job lunghi (Kimodo, addestramento mosca): proponi il comando e lascia che sia l'utente a lanciarlo, o lancialo in background solo dopo il suo ok.

## Struttura

- `src/main.tsx` -> `initWorldSeed()` (sceglie il pianeta) **prima** di importare `App`: i moduli del mondo leggono la geometria all'import.
- `src/ts/App.tsx`: `<Canvas>` + `<Physics>`, HUD/GUI, laboratori lazy. `Scene.tsx`: contenuto del mondo. `store.ts`: stato globale zustand.
- `src/ts/components/`
  - `Environment/`: citta', terreno, cielo, erba, alberi, arene, ragdoll (`ragdoll/`), locomozione, armi, meteo, pianeti (`PlanetQuadtree`, `PlanetNearField`, `Wilderness`, `VillageFolk`, `SpacePlanets`)
  - `city/`: NPC (folla, polizia, alleati, zombie). Corpo comune `useMannequinActor.ts`, comportamenti puri in `brains/`
  - `Vehicles/`: auto, moto, aereo, elicottero (`vehicleRegistry.ts`)
  - `UI/`: HUD e pannelli lil-gui; `Missions/`; `multiplayer/`
  - `WorldGate`, `PhysicsHost`, `SpaceController`: montaggio/smontaggio della citta' e del mondo Rapier nel viaggio tra pianeti
- `src/ts/lib/`: logica non-React (pianeta e geometria `planet.ts`, terreno `terrainData.ts`/`planetSurface.ts`/`nearTile.ts`/`quadNode.ts`, villaggi `village.ts`, nav, traffico, salvataggi, animazione, Kimodo, Ollama NPC)
- `src/ts/workers/`: web worker (generazione pianeta). `src/ts/generated/`: JSON generati dagli script, non modificare a mano.
- `src/ts/flyBrain/` + `src/ts/flyLab/` + `training/fly-brain/`: connettoma di Drosophila che comanda il ragdoll fisico (vedi `training/fly-brain/LEGGIMI.md`). Vite espone `/__flybrain/load|save` per i pesi in `public/fly-brain/`.
- `src/ts/charLab/`: laboratorio personaggi.
- `scripts/`: retarget Kimodo, audit scheletri, ragdoll fit, LOD folla, props.
- Alias import: `~/*` -> `src/ts/*`.

## Documenti da leggere prima di toccare le aree

- `docs/characters.md`: architettura NPC (corpo + cervelli)
- `docs/planets.md`: pianeti procedurali, viaggio nello spazio, rebase, ricreazione del mondo Rapier
- `docs/skeleton-calibration.md`: manichino / SOMA (Kimodo) / ragdoll
- `training/fly-brain/LEGGIMI.md`: cervello-mosca

## Convenzioni e trappole

- Misure di citta'/pianeta: un'unica fonte in `lib/planet.ts` (`planetGeometry()`); non reintrodurre costanti fisse (600, +-180, raggio 2...).
- Cambiare pianeta = rebase + **nuovo** mondo Rapier (`recreatePhysics()` via `PhysicsHost`): riusare lo stesso mondo causava panici `unreachable`.
- Comportamenti NPC come funzioni pure in `components/city/brains/`, non dentro i componenti.
- I pesi della mosca e `training/` sono esclusi dal watcher di Vite apposta (cambiano ogni pochi secondi).

## Testare nel browser

- Gioco completo: `http://localhost:5174/?autojoin=Claude` salta il menu.
- Personaggi/NPC: `?lab=char` (solo in dev). `window.__charLab` espone `spawn(kind)`, `provoke(armed)`, `clear()`, `rows()`, `agents()`; spawna i personaggi ad almeno ~1 s di distanza.
- Il pannello browser integrato parte a 0x0: chiama `resize_window` (es. 1200x720) prima di guardare, poi ripristina "desktop".
