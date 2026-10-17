# Pianeti (citta' procedurali di taglia diversa)

Obiettivo: stile No Man's Sky. Ogni pianeta = un seme + una taglia di mappa.

## Dove stavano le misure (prima)
Costanti sparse, tutte legate alla citta' 5x5 isolati / strade a +-180 / terreno 600:
- `Road.tsx`: `ROAD_SIZE=600`, `ROAD_OFFSETS` (raggio 3)
- `City.tsx`: `gridRadius=2`, piazze a (-2,2) e (2,-2)
- `Terrain.tsx`: `size=600`, `COURT_BLOCKS` (loop -2..2)
- `CityDetails.tsx`, `CityMonuments.tsx`: loop -2..2; `crowdSim.ts`: `GRID_RADIUS=1`
- `Airport.tsx`: pista a z=-260; `PauseMap.tsx`: griglia -300..300
- `streetPropsData.ts` / `ParkingLots.tsx`: ospedale, polizia, banca, parcheggi nel blocco vuoto a ovest (x -180..-120)
- Gia' derivate da `ROAD_OFFSETS`/`ROAD_SIZE`: traffico (`Traffic.tsx`), `gps.ts`, `cityMapImage.ts`, `Collectibles`, `CityCrowd`.
- `lib/nav.ts` e' gia' guidata da dati (`setNav`), nessuna misura fissa.

## Dopo
- `lib/planet.ts`: `PlanetProfile {seed, gridRadius, name}`, `planetGeometry()` (isolati, strade, terreno),
  `isPlazaBlock`, `serviceShiftX`. Unica fonte delle misure.
- Il profilo si imposta in `main.tsx` (`initWorldSeed`) PRIMA di importare il gioco; i moduli del mondo
  leggono la geometria all'import. Taglie: 2 (5x5 isolati, la citta' di sempre) e 3 (7x7).
- Scelte di compatibilita': le piazze (mercato, deposito, tutta la storia) restano a (-2,2)/(2,-2);
  il blocco servizi a ovest e l'aeroporto scalano con la taglia.
- La folla cammina negli isolati interni (raggio-1); il traffico segue `ROAD_OFFSETS`.

## Viaggio nello spazio, col drone (senza ricaricare, senza animazioni)
Tutti i pianeti stanno nello stesso universo (`lib/space.ts`). Ogni citta' e' al polo nord (+Y) del suo
pianeta; il pianeta e' una sfera di raggio 3000 m (`SpacePlanets.tsx`, texture procedurale dal seme, colonna
di luce sulla citta'). Il riferimento di gioco ha l'origine nella citta' del pianeta corrente, quindi
cambiare pianeta e' solo una traslazione (rebase) di tutto: il drone resta dov'e' nel mondo.
- Si decolla col drone (B): sopra le nuvole l'atmosfera si dirada (`spaceState.t`: cielo nero, stelle,
  niente nebbia/nuvole), la spinta cresce con la quota (fino a 60x) e la camera passa a near=1/far=90000.
- `SpaceController.tsx` (sempre montato) tiene montata la citta' di UN pianeta: si smonta allontanandosi
  (>4800 m dal polo), si genera e si monta avvicinandosi (<2600 m dal polo di un altro). Le citta' escono
  dalla nebbia a poco a poco man mano che si scende; i palazzi lontani crescono da terra (`FarBuildings`,
  `worldBornAt`); quelli dettagliati arrivano con lo streaming per distanza che c'era gia'.
- Montaggio: `unmountWorld()` (scena e giocatore fuori, `WorldGate`) -> `recreatePhysics()` (mondo Rapier NUOVO
  via `PhysicsHost`, key dentro l'albero R3F) -> rebase del drone -> `rebuildPlanet()`. Un mondo Rapier nuovo
  per ogni citta' evita i panici 'unreachable' che comparivano riusando lo stesso mondo (circa 1 handoff su 3).
- Strati dell'atmosfera continui in funzione della quota (`spaceState`: `fog` 200-3000 m, `cloud` 500-3200 m,
  `t` 400-9000 m per la luce, `dark` 1500-11000 m per il cielo). Il cielo non si nasconde: una cupola nera lontana
  (`Sky.tsx`, sotto pianeti e sole che la occludono) lo scurisce piano fino al nero; stelle, sole vero e aloni
  compaiono mentre scurisce, cosi' il disco del sole dello shader e il sole vero non si sovrappongono.
- Sistema solare vivo: ogni pianeta orbita attorno al sole (`orbitOf` in `lib/space.ts`: orbita circolare inclinata,
  periodo alla Keplero T = 900 s x (r/9 km)^1.5, fase e inclinazione dal seme). Il riferimento di gioco resta attaccato
  alla citta' del pianeta corrente, quindi gli altri pianeti e il sole si muovono in esso (`spacePlanets()`/`sunPos()`
  si aggiornano da soli); i pianeti ruotano sul loro asse (la citta' sta sul polo), anelli sottili ne mostrano le orbite
  (`OrbitRings`, visibili dallo spazio). Il rebase usa le posizioni allo stesso istante.
- Cielo: lo shader di Preetham da' valori HDR (nell'esempio di three: ACES con esposizione 0.5): senza tone mapping saturava
  a bianco ("troppo luminoso"). Ora `Sky.tsx` lo mappa con ACES ed esposizione 0.035 (regolabile: `sky.userData.exposure`),
  senza le nuvole dello shader (`cloudCoverage` 0; ci sono quelle del gioco).
- Montaggio progressivo di una citta' nuova: (1) i dati procedurali si "scaldano" a pezzetti tra un frame e l'altro a mondo
  ancora smontato (`lib/worldWarmup.ts`, dopo `rebuildPlanetData`), (2) `Scene.tsx` monta il mondo a stadi (terreno, strade,
  palazzi, parco e arredo, traffico e missioni, uno ogni 450 ms), (3) i palazzi lontani spuntano da terra con la distanza
  dal giocatore (`FarBuildings`: interi entro 800 m, schiacciati oltre 1800 m), (4) la foschia cala con la quota in modo
  esponenziale (`spaceState.fog = exp(-alt/350)`), cosi' la citta' esce dalla nebbia scendendo. Gli scatti di montaggio sono
  passati da ~1.2 s a <0.4 s al massimo. Mount a 1900 m dal polo, smontaggio oltre 3800 m.
- Il sole dello shader del cielo e della luce (`getSunDirection`) si fonde col sole vero con `spaceState.sunBlend`
  (800-4500 m): sopra ~4.5 km coincidono esattamente, prima che il sole vero compaia (dark > 0.3, sopra ~5 km).
  Sotto, il sole del cielo segue ancora il ciclo giorno/notte del gioco.
- Scala: pianeti di 3 km (la citta' e' una zolla piatta, piu' piccoli non reggono), sole di 16 km, orbite a 120-400 km (periodo
  2400 s a 120 km, Keplero), camera far = 1.000 km nello spazio, stelle e cupola scalate. Un punto-guida di dimensione fissa
  sullo schermo segna ogni pianeta da qualsiasi distanza. Spinta del drone fino a ~1000x lontano dai pianeti (~30 km/s):
  da un pianeta all'altro ~20-30 s.
- Velocita' legata alla quota: `spaceState.vmax = 40 + 0.4 x quota` (m/s, max 35 km/s) sul corpo piu' vicino (pianeta o
  sole); `Drone.tsx` taglia la velocita' al limite e la spinta (`boost`) si adegua. Decollando la velocita' sale a poco a poco,
  atterrando cala da sola (discesa esponenziale, ~2.5 s di costante di tempo). A terra il limite (>=40 m/s) non cambia nulla.
- Sole al centro del sistema (`SpaceSun`, sfera luminosa + bagliore, raggio 1800 m, origine dell'universo): nello spazio
  e' anche la luce (`getSunDirection` si fonde con `spaceState.sunDir`), e' solido per il drone. Stelle lontane + fascia
  (`SpaceStars`), alone atmosferico colorato attorno a ogni pianeta (`PlanetHalo`).
- Spinta del drone nello spazio fino a 300x (circa 10 km/s lontano dai pianeti, cala avvicinandosi alla superficie).
- I pianeti non-residenti sono solidi per il drone (`Drone.tsx`), quello residente no.
- HUD: `UI/SpaceHud.tsx` (distanza e direzione dei poli); menu di pausa: elenco dei pianeti.
- B sul pianeta nuovo: giocatore al polo (0,0). `droneExit` evita che il giocatore riprenda subito il drone.
- GPU: allo smontaggio `GPUBuffer/GPUTexture.destroy` e' sospeso 4 s (geometrie/materiali condivisi: senza,
  il renderer WebGPU smette di disegnare). Costo: un po' di memoria GPU persa a ogni cambio di mondo.
- Niente piu' muri invisibili ai bordi della citta' (`Terrain.tsx`); chi a piedi cade nel vuoto (y < -150)
  rinasce (`SpaceController`).
- Limiti: la citta' e' una zolla piatta sul polo, NON un pianeta sferico camminabile (fisica, strade, folla
  e traffico restano piatti); camminare oltre i bordi del terreno porta nel vuoto.
- Dev: dopo modifiche a moduli del mondo con HMR attivo riavviare vite (`--open false` per non aprire Chrome).
  `window.__tl` registra la cronologia dei cambi di mondo.

## Prossimi passi
- Fase 3 (parziale, fatta): `styleFromSeed` in `lib/planet.ts` -> cielo (Sky: rayleigh/turbidity), nebbia (WorldFog: densita' e colore), altezza e densita' palazzi (City), gravita' (App, Physics). Poi anche traffico (N_CARS in Traffic.tsx), alberi del parco (Park) e nuvole (Clouds). Mancano acqua e pioggia. Vista dallo spazio: PlanetMenu.
- Taglie piu' piccole di 2 o piu' grandi di 3 richiedono di spostare anche RaceTrack e le coordinate della missione.
- Dev: con HMR attivo (moduli con `?t=`) le costanti del mondo possono mescolare istanze di `planet.ts`: dopo modifiche a `lib/planet.ts` riavviare vite.
