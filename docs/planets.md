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

## Prestazioni del pianeta e della citta'
- Il calcolo del terreno (`buildNodeMesh`) e della vegetazione (`buildTileVegetation`) gira in un pool di Web Worker (`workers/planetWorker.ts`, client `lib/planetWorkers.ts`, fino a 3 worker, 2 richieste ciascuno): i risultati tornano come array tipizzati trasferiti, senza copie. Senza Worker si ripiega sul calcolo a pezzetti nel thread principale. Il solo lavoro rimasto sul thread principale e' il caricamento sulla GPU e il geomorphing (24 nodi per frame).
- Quadtree: i nodi oltre l'orizzonte della camera non si dividono ne' si disegnano; l'ultima divisione (livello 3 -> 4) usa K = 1.8 invece di 2.6 (ogni divisione crea 4 nodi fini): a terra da ~167 a ~116 nodi disegnati.
- Montaggio della citta': 16 passi da 300 ms invece di 4 da 450 (Scene.tsx, `STAGES`): ogni componente pesante (strade, palazzi, parco, aeroporto, auto, spawner, missioni) arriva da solo.
- Collider del terreno piu' piccolo (`terrainWindowHalf` in Terrain.tsx: citta' strade + 420 m, siti selvaggi 560 m): meno punti da calcolare e da dare a Rapier a ogni rimontaggio (il calcolo di `warm` e' sceso da ~1.6 s a ~0.85 s). Il terreno che si vede e' tutto nel quadtree.
- `CityDetails.tsx` monta le sue 9 parti (arredo, parcheggi, props, servizi, scalate, scale antincendio, monumenti, folla, cartelloni) una ogni 220 ms: il passo che costava ~485 ms ne costa ~90. Misura per passo: in dev `window.__stageT` (Scene.tsx) + PerformanceObserver 'longtask'.
- Ancora pesanti al montaggio (long task): montaggio iniziale ~470 ms, strade ~350 ms, palazzi ~270 ms.
- `lib/useStaggered.ts`: hook che restituisce quanti passi (uno ogni `ms`) sono scaduti, per montare le parti di un componente pesante una alla volta. Usato da Road.tsx (una linea di strade alla volta, poi i dettagli), City.tsx (palazzi, poi un cortile alla volta, mercato, magazzino, piazze) e Scene.tsx (FarCars, 3 moto, traffico, 5 pattuglie, ciascuno nel suo passo, 250 ms).
- Misura (stessa prova: volo alla citta' da 1,7 km, 30 s): pause lunghe (>50 ms) 24 per ~2400 ms in totale, solo 6 oltre 100 ms nei primi 9 s (prima 28 per ~3300 ms, e 37 per ~4400 ms nella variante intermedia). Resta il montaggio iniziale (~450 ms: collider del terreno, giocatore) e l'attivita' continua a regime (folla, traffico: ~1 s in 20 s).
- Geomorphing sulla GPU (`PlanetQuadtree.tsx`): il terreno usa un `MeshStandardNodeMaterial` (TSL) con attributi fissi `aMorphPos/aMorphNor/aMorphCol` (forma del padre) e un uniform per OGGETTO (`uniform.onObjectUpdate` legge `mesh.userData.morph`): posizione, normale e colore si mescolano nel vertex shader. A frame resta solo l'assegnazione di un numero per nodo: niente piu' ricalcolo ne' caricamento di buffer (prima fino a 24 nodi x 3 array a frame).
- `LatePlayer` (App.tsx): se il mondo si monta mentre si pilota il drone, il giocatore (modello, corpo fisico, ragdoll: ~400 ms) si monta 2.5 s dopo invece che insieme al resto (o subito, appena si scende dal drone).
- Misura del rimontaggio del giocatore (B che scende dal drone / `respawnPlayer`): ~1.6 s di long task, dei quali il codice di PlayerCombatSoldier e' una frazione minima (il `useMemo` dei clip costa ~4 ms, il render React ~15 ms). Il resto e' il renderer WebGPU che ricostruisce il grafo dei nodi per i nuovi SkinnedMesh e la pass d'ombra (JS Self-Profiling: `vite.config.ts` manda `Document-Policy: js-profiling`, quindi nel browser integrato si puo' usare `new Profiler(...)`). Il materiale del giocatore ora si riusa tra i rimontaggi (`playerMaterialCache`) ma non basta: per eliminare il costo il giocatore non deve essere smontato a ogni cambio di sito.

## Riposo del giocatore: le spalle che "scattano" (clavicole)
- Le clip Kimodo del riposo (`Kimodo_idle_breathe`, `_fidget`, `_shift_weight`) partono e finiscono tutte nella stessa posa neutra e solo nel mezzo hanno il riposo vero. Misurato sulle tracce: tra posa neutra e riposo `upperarm_r` ~62 gradi, `upperarm_l` ~34, `hand_r` ~30, `clavicle_r` ~28, `lowerarm_r` ~26, `clavicle_l` ~22, `spine_02` ~17, `head` ~14. A ogni giro del loop (~2.7 s) spalle, braccia e testa tornavano verso la neutra in ~0.4 s e ripartivano; in gioco la rotazione locale di `clavicle_r` oscillava tra ~28 e ~0-3 gradi a ogni giro.
- `trimIdleClip` (PlayerCombatSoldier.tsx) tiene solo la parte centrale: dal primo fotogramma in cui la posa ha raggiunto l'85% del riposo all'ultimo in cui non e' ancora tornata alla neutra, scegliendo tra i fotogrammi vicini ai due estremi la coppia con la posa piu' simile (loop senza salto). Dopo: la clavicola varia 0-15 gradi (i gesti delle variazioni), senza gli scatti da 28.
- Scattino residuo tra un giro e l'altro del riposo: `closeLoopSeam` (PlayerCombatSoldier.tsx) fa coincidere l'ultimo fotogramma col primo di ogni traccia del clip tagliato (correzione che cresce su 10 fotogrammi, slerp per le rotazioni), e la dissolvenza respiro <-> variazione passa da 0.4/0.2 s a 0.7 s. Misura (36 s, 5 ossa guida, normalizzata a 16.7 ms): passo massimo per frame 5 gradi (prima fino a ~96), mediana 0.09.
- Riposo a variazioni additive: il "respiro" e' la clip base `Kimodo_idle_breathe` (in loop). Le variazioni (`_shift_weight`, `_fidget`, ogni 6-12 s) non sono piu' clip che sostituiscono il respiro con una dissolvenza: sono clip ADDITIVE (`makeClipAdditive` rispetto al loro primo fotogramma, `__add`) sommate al respiro, che non si ferma mai, con un peso a campana (smootherstep, 0.9 s di salita e di discesa, `updateIdleVariation` a ogni frame). Se arriva un'altra animazione (corsa, attacco...) la variazione scende dal peso che ha in quel momento (`stopIdleVariation`). Misura (40 s): passo massimo per frame 0.97 gradi (p95 0.4), nessun frame sopra 2 gradi.

## Busto verso la camera e laboratorio personaggi

- `lib/playerSettings.ts`: `torsoFollowsCamera` (salvato in localStorage, default acceso). Spento, `applySpineLean` non ruota piu' la spina in yaw verso la camera (resta l'inclinazione in pitch); la transizione e' smorzata (`torsoYawRef`). Comando: casella "Busto verso la camera" nel pannello debug "Camera (GTA IV)" e pulsante omonimo nel laboratorio.
- Laboratorio (`/?lab=char`): il pannello a sinistra era alto ~870 px e tagliava gli ultimi pulsanti (Svuota, Esci) e copriva la scena; ora ha altezza massima con scorrimento, sfondo e pulsanti di spawn su due colonne.

## Notte blu neon (stile grafico)

- Casella "Notte blu neon" (menu iniziale e pannello Grafica, `store.neonNight`, ricordata, spenta di default: il gioco parte di giorno): l'ora resta fissa a `NEON_NIGHT_HOUR` (22.5, `lib/SunCycle.ts`) per tutto il gioco (citta', pianeti, laboratorio); spenta, tornano giorno / giornata. La modalita' zombi notturna ha la precedenza.
- Luci (`SunLight.tsx`): di notte l'ambiente e la luna diventano blu e leggibili (emisfero fino a 2.4, luna blu 1.8) invece che neri. Nebbia blu (`WorldFog.tsx`, `NEON_FOG`).
- Contorni e bagliore (`ToonOutline.tsx`, uniform `neon`): inchiostro blu scuro invece che nero caldo, colori piu' accesi (+0.2 di saturazione), bagliore a due anelli di campioni solo dalle cose lontane (> 7 m: lampioni, neon, finestre), cosi' il giocatore e i passanti non hanno aloni. Le linee restano spesse 1.5 px: piu' sottili davano righe finte (falsi spigoli) sulle superfici in piano.
- Insegne al neon (`NeonSigns.tsx`): cartelli verticali luminosi (rosa, ciano, viola, arancio, verde) sulla facciata verso la strada di ~45% dei palazzi alti, una sola instancedMesh come `BuildingLeds`, accese di notte con sfarfallio raro.
- Passanti: manichini a tinta unita viola / verde / ciano (`CIVILIAN_COLORS`, `crowdSim.ts`).
- Laboratorio personaggi: monta anche `ToonStyle`; sfondo, nebbia e luci blu con la notte neon.

## Prestazioni della citta' (misure e interventi)

- Il gioco e' limitato dalla CPU nel render di three (non dalla GPU): nel profilo (JS Self-Profiling) ~40% e' `updateMatrixWorld`, `_projectObject`, chiavi di cache dei materiali e `writeBuffer`, cioe' costo per OGGETTO. In citta' ci sono ~8500 nodi e ~2300 mesh visibili; ogni mesh in meno conta piu' dei triangoli.
- Il bagliore della notte neon, fatto con 14 campioni a piena risoluzione per pixel, costava ~26 ms a frame (61 ms contro 35 ms, stesso punto). Ora il bagliore e' un passaggio a 1/4 di risoluzione (`rtBloom` in `ToonOutline.tsx`) letto con 5 campioni: costo ~2 ms.
- `lib/mergeMeshes.ts` (`mergeStaticMeshes`): i pezzi fermi di un modello con lo stesso materiale (anche oggetti materiale diversi con stesso colore e parametri) diventano una sola mesh; i nodi che si muovono (`keep`: nomi o oggetti) restano a se' e non si fonde mai sotto un osso. Usato in `MotorcycleModel.tsx` (ruote, forcella, testa, massa sospesa: 43 -> ~15 mesh per moto, 15 moto in citta': -443 mesh visibili, triangoli identici) e in `usePistolModel.ts` (carrello e caricatore restano mobili).
- Prove A/B: `window.__noMerge = true` prima di entrare in gioco spegne la fusione.
- Le misure di tempo di frame in questo ambiente sono molto rumorose (carico del computer, pannello del browser a volte non dipinge): confrontare solo nella stessa sessione, a coppie, e preferire conteggi (mesh visibili, nodi, campioni del profilo) ai millisecondi.

## Atmosfera, nuvole e salita dal pianeta

- Il gioco parte di giorno (`neonNight` spento di default).
- `PlanetSky.tsx` (dentro `PlanetBody`, per ogni pianeta): (1) guscio dell'atmosfera (raggio 1.16 R, `BackSide`, additivo): alone azzurro sul bordo del pianeta, piu' forte dal lato del sole, arancio al terminatore, colore mescolato con la foschia del pianeta; compare tra 0.6 e 1.8 km di quota. (2) strato di nuvole procedurali a R + 330 m (rumore frattale `mx_fractal_noise_float`: grandi masse + dettaglio, copertura dalla `cloudiness` del pianeta, ombra propria spostando il rumore verso il sole, lato notte scuro, bordo che sfuma); gira col vento come le nuvole a sprite (stesso asse e stessa velocita', da `hashKey` del seme). Compare quando la camera e' sopra lo strato (120-1100 m sopra).
- Le nuvole a sprite (`Clouds.tsx`, vicino al suolo) sfumano tra 450 e 1500 m (`spaceState.cloud`) e lo strato del pianeta prende il loro posto: dalla discesa si passa da puff veri a un tetto di nuvole senza stacchi. Sostituiscono l'alone a sprite (`PlanetHalo`, non piu' usato).
- Cielo (`Sky.tsx`, `SpaceController.tsx`): `spaceState.dark` sale tra 450 e 4500 m (prima 1500-11000) e la cupola scura passa dal blu profondo (#0d2c66) al nero: azzurro -> blu scuro con stelle (~3 km) -> nero (~4.5 km). Le stelle compaiono con `dark`.
- Verificato volando col drone: 0.3, 1.4, 2.9 e 4.3 km (pianeta con alone e nuvole visibili dall'alto), discesa fino a ~0.5 km. Prove: `window.__noSky = true` prima di entrare in gioco spegne `PlanetSky`.
- Errore noto, non nostro: una volta per ciclo salita/discesa la console mostra "WebGPU ... Buffer used in submit while destroyed" (rendercontext_2) alla smontatura del mondo; c'e' anche con `PlanetSky` spento.
