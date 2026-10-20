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

## Siti, terreno e acqua (atterraggio ovunque)
- Il mondo e' montato su UN "sito" alla volta (`lib/site.ts`): la citta' (polo nord) o un punto selvaggio qualunque. Il riferimento di gioco ha origine sul sito e +Y lungo la normale; lo spostamento tra siti e' un rebase con rotazione (`siteTransform`, `requestDroneRebase`).
- La superficie viene da `lib/planetSurface.ts` (`surfaceHeight/surfaceInfo`), la stessa per la sfera vista dallo spazio e per il terreno camminabile (`Terrain.tsx`, finestra a griglia costruita a pezzetti). Boschi e rocce: `Wilderness.tsx`.
- Acqua: mari, laghi e fiumi sono una sola superficie al livello del mare (quota 0). Laghi e fiumi sono scavati in `surfaceHeight` sotto quota 0 sulla terra bassa (spariscono in montagna e nella pianura della citta'); `Water.tsx` disegna la toppa della sfera di mare attorno al sito. Non si nuota: si cammina sul fondale.
- Nota di test: con il pannello browser nascosto `requestAnimationFrame` scende a 1 fps e il montaggio dei siti sembra bloccato (warmTerrain avanza a frame).

## Dettaglio continuo (niente salto all'atterraggio)
- Una sola superficie: `surfaceHeight` (lib/planetSurface.ts) comprende anche la zolla piatta della citta' (piano tangente al polo, raccordato al rilievo) e il lago/fiume vicino alla citta'. Sfera, livelli di dettaglio e terreno del sito la campionano tutti.
- Il terreno del sito e' la vera superficie sferica vista dal sito (`solveSite` in lib/site.ts: (R+h) sin(phi) = r), non una proiezione verticale: coincide con la sfera e con l'acqua (Water.tsx).
- `PlanetLOD.tsx`: quadrati a passo 90/36/12/4 m centrati sul punto sotto la camera, rigenerati a pezzetti (6 ms a frame) mentre ci si muove; sovrapposti, abbassati del 12% del passo (i piu' fini sopra), con il bordo che scende verso il livello piu' grossolano. La sfera di base (120 m) e' abbassata del suo passo.
- Resta un comparire improvviso di alberi, rocce e prato quando il mondo del sito si monta (sotto 1500 m).

## Mappatura lat/lon fissa
- `lib/globalGrid.ts`: griglia in latitudine/longitudine del PIANETA (fasce di latitudine, celle in longitudine per fascia). Alberi, rocce, prato e nuvole si piazzano per cella del pianeta, non del sito: cambiando sito (rebase) non si sposta niente. Da cella a locale: `localFromDir` (stessa mappa del terreno); da locale a direzione: `wildDir`/`solveSite` (3 iterazioni, errore < 4 cm in pianta e 12 cm in quota).
- Le nuvole stanno su uno strato a 300 m sul livello del mare e scorrono col vento come rotazione del pianeta attorno a un asse orizzontale (dal seme).

## Cambio sito senza buchi (mondo visivo fisso sul pianeta)
- Il cambio di sito (SpaceController.handoff) smonta e rimonta solo il mondo di GIOCO (fisica, citta', collider). Cio' che si vede del pianeta resta sempre montato e fisso sul pianeta (`PlanetNearField.tsx`, dentro SpacePlanets): terreno a tessere, acqua, alberi, rocce, prato. Nuvole (`Clouds.tsx`), nebbia (`WorldFog.tsx`) e cielo stanno fuori dal gate.
- Tessere (`lib/cubeTiles.ts`): cubo-sfera 6 facce x 16x16 tessere (~295 m), griglia 64x64 (~4.6 m), vertici condivisi sul bordo (niente fessure), citta' al centro della faccia +Y. Si caricano a pezzetti (4 ms a frame) entro 850 m dal punto sotto la camera e si scaricano oltre 1150 m; geometrie e mesh si riusano (pool), mai distrutti. Costruzione in `lib/nearTile.ts` (terreno, normali con giro di bordo, acqua opaca piu' chiara dove il fondale e' basso, vegetazione per celle lat/lon).
- Il gruppo del pianeta segue `siteFrame.quat` e il centro del pianeta: al cambio di sito cambia solo la trasformazione. Alla stessa mossa la camera e la posizione salvata passano subito al riferimento nuovo (il drone, smontato, non lo fa): prima il mondo "saltava" e il cielo diventava nero per qualche secondo.
- Terrain.tsx: nei siti selvaggi solo le quote per il collider; la mesh serve solo alla citta'. Wilderness.tsx: solo i tronchi (fisica) entro 220 m, calcolati con la stessa funzione delle tessere. PlanetLOD: il livello a 4 m e' sostituito dalle tessere. La nebbia dipende dalla distanza angolare dal polo, non dal sito.

### Rifiniture del dettaglio continuo
- `PlanetLOD.tsx` ora sta su un reticolo fisso della faccia della cubo-sfera (passi 18 m e 73 m, multipli del passo delle tessere): il centro si aggancia al reticolo, quindi rigenerare un livello non sposta i punti che restano e ogni vertice coincide con uno della tessera piu' fine (stessa quota e stesso colore). Abbassamento 6% del passo.
- Le tessere nuove salgono da 16 m sotto i livelli di dettaglio in 1,4 s (`EMERGE_S`); alberi, rocce e prato nuovi crescono in 1,6 s (`GROW_S`, `StaticInstances.tsx` per gli alberi). Raggio di caricamento delle tessere 1000 m.
- Colore indipendente dalla risoluzione: la roccia sulle pendenze (`rockMix` in lib/nearTile.ts) usa la pendenza analitica su 3 m, non le normali della mesh, ed e' la stessa per sfera di base, livelli di dettaglio e tessere. Livelli di dettaglio con stessa rugosita' e ombre delle tessere. Il colore del suolo della citta' sfuma nel colore del pianeta su 300 m (`COLOR_BLEND` in Terrain.tsx), le quote su 60 m.

## Quadtree a geomorphing (sostituisce livelli a reticolo e tessere fisse)
- `PlanetQuadtree.tsx` + `lib/quadNode.ts`: ogni faccia della cubo-sfera e' un albero di nodi 64x64 (livello 0 = faccia intera, ~73 m di passo; livello 4 = ~4.6 m). Un nodo si divide in 4 quando la camera e' a meno di K=2.6 volte la sua taglia (isteresi 1.15) e si ricompone quando si allontana. I figli compaiono solo quando tutti e 4 sono pronti (niente buchi) e nascono "morfati" sulla forma del padre.
- Geomorphing sulla CPU: per ogni vertice il nodo tiene posizione, normale e colore del padre (i vertici dispari stanno sulla media dei pari: lati = media dei due estremi, centro cella = diagonale b-d della triangolazione); il fattore va da 1 a 0 in funzione della distanza del padre / (K x taglia padre), tra 1.0 e 0.7. I nodi appena mostrati si morfano subito, gli altri a gruppi di 24 per frame.
- Gonna (skirt) lungo i bordi per le fessure tra livelli; acqua opaca per nodo (piu' chiara dove il fondale e' basso); costruzione a pezzetti (3 ms a frame, il nodo piu' vicino per primo); riuso di geometrie e buffer, eviction a gruppi di 4 fratelli quando i nodi superano 200.
- `PlanetNearField.tsx` ora fa solo la vegetazione (alberi, rocce, prato) per tessere del livello 4. La sfera di base (120 m) sta sotto (abbassata di 7.2 m) e si vede sopra i 9 km.
- Cache locale (IndexedDB): valutata e non fatta. Ogni nodo costa ~20 ms di calcolo, la lettura asincrona non e' molto piu' veloce e il resto e' deterministico dal seme.

## Orientamento di camera e drone al cambio di sito
- `<Drone />` sta dentro `<Physics>` (che si ricrea in `recreatePhysics`) ma fuori dal gate del mondo: durante lo smontaggio il drone continua a volare (a centinaia di m/s) e poi si rimonta. Prima il drone nuovo ripartiva livellato e dietro al corpo (si perdevano inclinazione e velocita') e il sito era scelto prima del volo (arrivava a >1 km dal centro).
- Ora: subito prima di ricreare la fisica lo stato di volo (`droneLive`, lib/space.ts) passa a `droneResume` e il drone nuovo lo riprende identico (telaio, inclinazione, velocita'). Il sito si sceglie DOPO, sotto il drone (`resolveUnderDrone`). Al rebase camera e posizione salvata passano subito al riferimento nuovo e il drone applica lo stesso rebase.
- Il "su" del drone (`WORLD_UP` in Drone.tsx) e' la normale del pianeta sotto di lui, non +Y fisso, e il telaio segue la curvatura (trasporto parallelo, congelato sopra 3 km di quota). Al rebase il "su" precedente passa al riferimento nuovo (non e' curvatura da seguire). Misurato: volando 30 s attraverso un cambio di sito, in coordinate del pianeta nessun salto di direzione >1 grado ne' di posizione >40 m per frame.

## Il giocatore resta dove l'hai lasciato
- `lib/playerParking.ts`: salendo sul drone si memorizza il punto del giocatore sul pianeta (direzione dal centro, dove guardava, quota sul suolo). Cambiando sito (il mondo si ricrea) il giocatore non si sposta: se il suo punto sta entro 600 m dal centro del nuovo sito riappare li', altrimenti e' "dormiente" (`<CityPlayer>` non montato, App.tsx) finche' non si torna vicino o si preme B.
- B: se serve cambiare sito si fa come prima (il giocatore scende sotto il drone); altrimenti il giocatore si rimonta subito sul posto (anche se dormiente), a terra sotto il drone (`respawnPlayer`). L'evento di uscita dal drone ora e' ricordato (`exitPending`) e non si perde se avviene durante un montaggio.

## La citta' da lontano (CityProxy)
- `CityProxy.tsx` (in SpacePlanets, fisso sul pianeta, entro 9 km dalla citta'): la pianta vista dall'alto (isolati, strade, parco, piazze: `buildCityImage` con una palette propria, bordo che sfuma nel terreno) e i palazzi come scatole con le finestre dello shader di `FarBuildings` (`getCityProxyItems` in City.tsx, senza collider ne' crescita da terra). Avvicinandosi, quando il sito diventa la citta' e il mondo e' montato (palazzi dettagliati, strade, arredo) il proxy si spegne; durante il rimontaggio resta visibile.
- Citta' degli altri pianeti: avvicinandosi a un pianeta (< 14 km, senza mondo montato) i dati del mondo si costruiscono in anteprima (`previewWorldSeed` + `rebuildPlanetData`), senza salvare il pianeta. `getPersistedSeed` (seme salvato) e `getDataSeed` (pianeta dei dati costruiti) sono ora distinti.
