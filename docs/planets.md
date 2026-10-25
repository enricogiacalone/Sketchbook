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

## Droni nemici interstellari

- `components/SpaceEnemies.tsx` (montato in `App.tsx` accanto a `SpaceController`): 8 droni nemici che pattugliano il sistema solare, come i bersagli di droneWorld (blaze33: modello clonato, 100 di vita, escono dal gioco in esplosione e rinascono). Simulazione nell'UNIVERSO (stabile ai cambi di sito), convertita ogni frame nel riferimento del sito con `univToSite` / `siteToUniv` / `planetCenterUniv` (`lib/space.ts`).
- Comportamento: **transito** da un pianeta all'altro a 7 km/s (rallentano in arrivo), **orbita** attorno al pianeta (2.4 raggi, 45-95 s) poi nuova rotta a caso; **inseguimento** se il drone del giocatore e' entro 7 km (gli girano intorno a ~170 m e sparano raffiche di 3 colpi rossi a 650 m con anticipo, 2.5 di danno a colpo, niente danno sotto il 30% di vita), lo perdono oltre 18 km. A piedi li ignorano.
- Sono bersagli del drone: `cityActors.spaceFlyers` / `getDroneTargets()` (HUD "nemico", aggancio, mitragliatrice, missili; `chestOf` usa la posizione vera, raggio di colpo 3.2 m). Non stanno in `cityOpponents` (alleati e minimappa non li vedono). Nell'HUD compaiono solo entro 9 km. I missili li colpiscono come bersaglio registrato in `lib/explosions.ts` (danno x1.4: due missili uccidono); a vita < 50 il bagliore diventa arancio e lampeggia. Morti: esplosione e rinascono dopo 25 s su una rotta a caso.
- Da lontano si vedono come un punto rosso luminoso (dimensione minima sullo schermo). Prove: `window.__spaceEnemies` (dev) per posizioni e modo.

## L'acqua di droneWorld

- `lib/waterMaterial.ts` (`makeWaterMaterial`, usato da `PlanetQuadtree` e `PlanetNearField` al posto del vecchio `MeshStandardMaterial`): l'acqua di blaze33/droneWorld (`src/ocean`: Water2 di three + shader subacqueo) portata in TSL. Due rumori 3D che scorrono in direzioni diverse (piu' uno largo e lento) danno la normale delle onde (si spianano da 120 a 1400 m per non sfarfallare); riflesso del cielo alla Fresnel (`emissiveNode`, colore del cielo del pianeta: foschia di giorno, scuro di notte); rugosita' 0.12, quindi il sole fa le scintille nette; creste piu' chiare. Il colore del fondo e' sempre il colore per vertice di prima (tinta per profondita'). Niente render target di riflesso/rifrazione di droneWorld: sono un secondo passaggio di scena, troppo caro per un gioco limitato dalla CPU.
- Sott'acqua (camera sotto R + 0.02 e non dentro la terra): `spaceState.underwater` (0..1, smussato), `WorldFog` vira a foschia fitta azzurro-verde (densita' 0.035) e `UI/UnderwaterOverlay.tsx` mette il velo con vignettatura e bande di luce che scorrono (il "wiggle" di droneWorld non e' stato portato). La superficie e' `DoubleSide`: da sotto si vede come un soffitto del colore dell'acqua. Prova: `window.__forceUnder = true`.
- Verificato: fiume visto dal drone a ~30 m (onde che scorrono e scintille), laghi dall'alto, effetto subacqueo forzato. Non provato: tuffarsi davvero sotto la superficie di un lago (la soglia `dist < R + 0.02` non e' stata misurata dal vivo).

## Vegetazione e sentieri del pianeta

- **Copertura del suolo** (`components/Environment/groundCover.ts`, `PlanetNearField.tsx`): il prato non e' piu' un solo ciuffo di 7 triangoli: 4 tipi (campo `t` dei 'tufts': `COVER_GRASS/FLOWER/FERN/BUSH`, `lib/nearTile.ts`), ognuno una `InstancedMesh` per tessera. Erba: 8 lame ricurve e affusolate (scure alla base, chiare in punta) con verdi vari e chiazze secche; fiori: 6 steli con foglia e coroncina di petali, un colore per macchia (6 tinte); felci (9 fronde ad arco); cespugli (4 blocchi sfaccettati). Celle da 3.8 m (erano 6 m), soglia piu' bassa e ~3x piu' erba; nel bosco felci e cespugli, nei prati macchie di fiori e cespugli sparsi. Tetti per tessera: 7000 / 1800 / 1500 / 900. Erba, fiori e felci ondeggiano col vento (`positionNode`: l'altezza della lama pesa lo spostamento, la posizione sul pianeta da' la fase: onde di vento che passano). Nota: dopo l'istanziazione `positionLocal` e' gia' la posizione sul pianeta, il peso va preso da `positionGeometry`.
- **Alberi**: `TREE_CELL` 12 -> 9.5 m e probabilita' del bosco 0.85 -> 0.92; in piu' alberi sparsi nei prati (a gruppetti, piu' piccoli, solo su pendenze lievi).
- **Sentieri** (`pathMask`, `pathMix`, `lib/nearTile.ts`): linee di livello di un rumore sul pianeta; la distanza dalla linea in metri si stima da valore/gradiente, quindi la larghezza e' vera. Sentieri principali (scala 520 m, ~3-5 m di larghezza con bordo morbido) e viottoli piu' sottili a tratti (190 m). Il colore (terra) si applica ai nodi del quadtree da livello 3 (`quadNode.ts`), non sull'acqua, sulla roccia o sopra i 150 m; alberi, rocce e prato non nascono sul sentiero e si diradano ai bordi.
- Prova: erba e sentiero visti dal drone a 50 m (percorso di terra in mezzo al prato, erba piu' fitta, cespugli, alberi sparsi); 60 fps fermi, ~2.3 M triangoli instanziati visibili.

### Seconda passata: piu' ricco (stile Red Dead Redemption)

- **Specie di alberi vere** (`usePlanetTreeTemplates`, `PLANET_TREE_SPECIES`, `ParkTrees.tsx`): prima i 3 modelli del pianeta erano lo stesso albero di default ripetuto (stesso seme). Ora 12 modelli dai preset di ez-tree: frassino, pioppo tremulo, quercia media e grande, pino medio e grande, due semi ciascuno. `speciesAt` (`nearTile.ts`) li sceglie per quota: pini in alto, querce in basso, frassini e pioppi in mezzo. Le chiome hanno un po' di luce propria verde e colore +20% (prima andavano al nero nell'ombra).
- **Sottobosco**: nel bosco 24% felci e 10% cespugli (prima 14% e 6%); nei prati macchie di fiori piu' grandi (`fl > 0.5`, 60%) e cespugli al 6% (prima 3.5%). Erba piu' alta e varia (scala 0.9-2.6, con molti ciuffi bassi e pochi alti), celle da 3.3 m, fino a 9000 ciuffi per tessera. I fiori hanno le corolle piu' grandi (i contorni scuri mangiavano quelli piccoli).
- I contorni del toon spariscono oltre 110 m (prima 160): le chiome lontane non diventano una massa nera.
- Costo: la generazione dei 12 modelli di albero e' una tantum al montaggio del pianeta (`[alberi] N modelli in X ms` nella console in sviluppo).

### Terza passata: piu' prato e piu' natura

- Celle del prato da 2.7 m (erano 3.3 e prima 6), soglia piu' bassa e coefficiente 3.9: il prato copre quasi tutto lo spazio aperto. Nuovo tipo `COVER_TALL` (erba alta da prateria, 11 lame lunghe con spighe, a macchie larghe di ~28 m; `tallGrassGeometry`). Tetti per tessera: erba 14000, alta 6000, fiori 2600, felci 2600, cespugli 1400.
- Alberi: `TREE_CELL` 8.4 m (era 12), alberi sparsi nei prati 6%; piu' rocce (soglia 0.86, anche sulle pendenze lievi).
- Suolo (`quadNode.ts`): chiazze piu' chiare e scure a 38 m e 9 m, erba che vira al secco a macchie larghe, nel bosco lettiera scura e muschio. I fiori sono pastello (con i colori saturi sul prato scuro diventavano marroni).
- Prestazioni: la copertura e' la parte piu' pesante da disegnare (all'inizio 5 M triangoli, ~30 fps). Ora le tessere oltre `COVER_SHOW` = 190 m (+ raggio tessera) restano caricate ma non si disegnano, e la distanza di carico e' `TUFT_RANGE` = 250 m: 1.75 M triangoli e ~25 ms a frame nel prato (p95 37 ms) in questo computer, che e' molto rumoroso. Se serve ancora: `COVER_SHOW`, `cap` per tipo in `groundCover.ts`, `TREE_CELL`.

## Civilta': casali, villaggi, paesi, citta' (urbanistica)
Sostituisce la vecchia sezione "Villaggi" (6 villaggi uguali su piano tangente). Stile e cultura: `docs/stile.md`.
- **Siti** (`villagesOf`, `lib/planetSurface.ts`): ogni pianeta ha 3 citta' (raggio 500 m), 6 paesi (262 m), 14 villaggi (106 m) e 28 casali (46 m). Si provano molti candidati per taglia (terra asciutta, dislivello sui campioni a 0,7 del raggio piatto <= 26/40/62/90 m) e si scelgono i piu' piani rispettando le distanze (`TIER_DEF`); la citta' di partenza al polo e' un'altra cosa (`City.tsx`). Ogni sito ha tipo (`tier`), `radius`, `flat`, `blend` (cresce col dislivello tagliato), la cultura della sua regione (`regionsOf`/`cultureAtDir`: 5 centri culturali per pianeta, vince il piu' vicino) e gli assi A, B.
- **Terrazzamento a calotta**: dentro `flat` la quota e' fissa (piano appena inclinato `h + gx u + gw w`, raggio costante: segue la curvatura del pianeta, a differenza del vecchio piano tangente che a 500 m sarebbe 41 m fuori); oltre si raccorda con smoothstep su `blend`. Coordinate locali gnomoniche (`siteLocal`): punto = normalize(c R + A u + B w). Indice a celle del cubo (96 x 96 per faccia) per `villageNear`/`siteNear` (surfaceHeight e' molto chiamata).
- **Posizionamento**: `villageItemPos/Matrix` (`lib/village.ts`) mettono ogni pezzo sulla sfera alla quota del piano, con la verticale locale; `villageTileItems` li divide per tessera (una volta per abitato). Nel sito (siti selvatici) `siteFrameOf/toSiteXZ/fromSiteXZ` usano la trasformazione esatta (non lineare).
- **Generatori** (`lib/settlement.ts`, `lib/town.ts`): casale (sentiero curvo con 3-6 case, pozzo, orti), villaggio (le quattro piante di prima, per cultura), **paese/citta'** (`generateTown`): forma radiale, a griglia (ruotata e piegata), organica, lineare o medina scelta da cultura e seme; arterie curve dalla piazza alle porte (`gateAnglesOf`, usate anche dalle strade tra abitati); anelli; crescita di strade secondarie e vicoli (distanza minima per zona, innesti a T); rotonde agli incroci tra arterie; mura storiche con porte dove le strade le attraversano (Mag sempre, Med 70%, Asia nelle citta'); piazza principale con fontana, tempio e torre piu' piazze minori; parchi con alberi e panchine; lotti lungo le strade per zona (centro storico a schiera, cintura di palazzi, villette, centro direzionale con grattacieli, zona industriale con capannoni e ciminiere); riempimento degli isolati (orti, capanni, alberi); lampioni e viali alberati; campagna ai margini; nelle citta' una **sopraelevata** rialzata di 7,6 m con rampe di 150 m che scavalca arterie e anelli (sotto passano le strade) con pile (`Role.Pier`). Costo: ~250-320 ms per citta' (3700 pezzi), ~50 ms per paese; cache per abitato.
- **Strade vere** (`lib/roadMesh.ts`): nastri sul terreno (marciapiede, asfalto o selciato per cultura, asse tratteggiato, righe di bordo; la sopraelevata ha impalcato, sottofondo, fianchi e new jersey) generati nei worker insieme a `houses` (`Vegetation.roads`, un mesh per tessera in `PlanetNearField.tsx`, senza ombra propria). Colliders dell'impalcato e delle sponde in `Wilderness.tsx` (`deckSegments`). Il colore del suolo (`villageGroundTint`) resta come sottofondo (selciato dei centri, strade, piazze, lastricato che cala verso la periferia).
- **Strade tra abitati** (`lib/roads.ts`): ogni abitato si collega al piu' vicino di taglia pari o maggiore, paesi e citta' fra loro (autostrade, 8,4 m) e un secondo collegamento per i villaggi; tracciato per programmazione dinamica su 17 posizioni laterali ogni 36 m (costo salita al quadrato, acqua, cime, curve strette) poi spline Catmull-Rom ogni ~12 m; lazy (`roadPts`). Ponti: la logica esistente (`findBridge`) dove la maschera attraversa acqua stretta.
- **Disegno**: nuovi ruoli moderni in `lib/culture.ts` (`Block`, `Skyscraper` 3 famiglie, `Warehouse`, `Chimney`, `Pier`, `Bench`); `HOUSE_CAP` 400 per tipo e tessera; `InstancedMesh` con sfera dei limiti (frustum culling attivo: in citta' le istanze sono migliaia).
- **Abitanti** (`VillageFolk.tsx`): 5/9/16/26 per taglia, scelti tra le case piu' vicine al punto d'atterraggio; fumo dei camini e campane (`AmbientSounds`) solo per gli abitati entro raggio; anziani solo da villaggio in su.
- **Verificato dal vivo**: camera sopra gli abitati (citta' asiatica radiale con anelli e grattacieli, citta' mediterranea a griglia con diagonali, rotonda con isola e sopraelevata che la scavalca, medina su promontorio, villaggio alpino, casale, autostrada con segnaletica) e **atterraggi veri col drone** (B, `requestDroneShift`, B) nel centro di due citta' (pianeta 101, ids 0 e 1): il giocatore cammina; 60 su 60 palazzi/righe testati con un raggio orizzontale trovano il collider; i raggi verticali sull'impalcato della sopraelevata danno la quota attesa in 4 punti su 4 entro 220 m; 52 abitanti attivi in giro. Prestazioni nel cuore della citta' mediterranea: ~39 fps nel pannello di prova (era 25 con 1200 mesh istanziate: le varianti dei ruoli che non le usano restano a 0, `variantFor`, e i pezzi piccoli non fanno ombra) e frustum culling sulle istanze. Non verificato: salire a piedi sulla rampa e sull'impalcato, notte, ponti sulle autostrade, i paesi dal vivo, sbalzi di prestazioni su macchine lente, l'atterraggio esatto sulla fontana (il sito nasce al centro della piazza: si e' in mezzo alla fontana).
- Rovine (`ruinsOf` in `planetSurface.ts`, `ruinItems`/`ruinItemPlacement` in `village.ts`): fino a 5 per pianeta su terra asciutta e piana lontano da villaggi e citta': pianta 16x11 con muri spezzati, colonne, un arco all'ingresso, blocchi e colonne cadute, ognuno alla quota vera del terreno (non spianano); niente alberi nel raggio di 16 m. Collider a scatola per muri, colonne, blocchi e colonne cadute (l'arco si attraversa).
- Alberi: collider dei tronchi con raggio e altezza dei modelli ez-tree (`TRUNKS` in Wilderness.tsx), non piu' sottili 7-10 cm.
- Mancano ancora: interni, sottopassi veri con trincea (la sopraelevata li simula), ferrovie, abitati vicini fusi (conurbazioni), strade con sterri/rilevati sui pendii.

## Droni nemici (interruttore)
- I droni nemici interstellari (`SpaceEnemies.tsx`) sono spenti di default: `store.enemyDrones` (ricordato nel browser, `false` se mai impostato). Si accendono dalla casella "Droni nemici nello spazio" nel menu iniziale (sezione Grafica) o nel pannello Debug (cartella grafica); spegnendo si smontano e spariscono anche dai bersagli del drone (`cityActors.spaceFlyers`). Provato: di default 0 droni, acceso 8, spento di nuovo 0.

## Ponti
- Dove un sentiero (`pathMask`) attraversa l'acqua c'e' un ponte di legno (`findBridge` in `lib/nearTile.ts`, per tessera nel worker, insieme a alberi e case). Griglia di 10 m: dove il sentiero e' forte (> 0.3) e il terreno e' sotto il livello del mare (< -0.3 m) si prende la direzione del sentiero, si provano 5 angoli (±30°) e si sceglie l'attraversamento piu' corto fino alla terra (> 1.4 m, passi da 2.5 m); se il tratto e' tra 6 e 78 m si piazza un ponte al centro, che appartiene alla tessera che contiene il centro. Dentro la citta' e a meno di 100 m da un altro ponte della tessera non se ne fanno.
- Il ponte e' un `houses` con `t = BRIDGE_BASE (100) + b` (lunghezza 4*b m, b da 3 a 22; `villageModels.ts`: piano, travi, parapetti con montanti, pile che scendono sotto l'acqua, spalle di pietra, larghezza 4,2 m). Piano alla quota della riva piu' alta + 0,4 m (almeno 2,2 m sull'acqua), orientato sulla tangente.
- Fisica (`Wilderness.tsx`): un cuboide per il piano e uno per ciascun parapetto, a quota vera (non quella del terreno).
- Visto dall'alto sul seme di partenza: ponti dritti a cavallo di fiumi, sui sentieri. Entro 0,5 rad dalla citta' ce ne sono 14 (un fiume con molti sentieri ne ha anche 4-5 in 250 m). Non verificato: camminarci sopra (collider), le rive (i capi del ponte possono restare a mezzo metro dal terreno), l'aspetto di notte.

## Muri invisibili col drone (collider del terreno trasposto, corretto)
- Causa: il `HeightfieldCollider` di `Terrain.tsx` riceveva `heights` con riga = x e colonna = z, ma Rapier legge la colonna come x e la riga come z: il suolo fisico era lo specchio del terreno visibile rispetto alla diagonale x = z. Misurato dal vivo con raycast dall'alto su una griglia nel sito selvaggio del villaggio 3 (seme di partenza): colpi uguali a `getTerrainHeight(z, x)` con errore 0, contro errori medi di ~26 m con (x, z) (decine di metri di scarto: pareti e buchi dove il visibile e' liscio, soprattutto volando bassi col drone).
- Correzione: al collider va la trasposta (`colliderHeights`, `Terrain.tsx`). Stessa prova dopo: scarto medio 0,00 m (citta') e 0,01 m (sito selvaggio, peggiore 0,7 m su 1500 punti). `TerrainData.heights` e i vertici restano com'erano (riga = x).
- Prova rifacibile: `window.__physicsDebug.world.castRay` dall'alto contro `getTerrainHeight(x, z)` (solo dev).

## Meteo (pioggia e nebbia mattutina)
- `lib/weather.ts` (stato `weather`, aggiornato ogni frame da `components/Environment/Weather.tsx`, montato in `App.tsx`): pioggia a perturbazioni (`rainTarget`: periodi di 420 s di gioco, 72% hanno pioggia, inizio, durata (18-48%) e forza dal seme del pianeta; sfuma in ~4 s e con la quota fino a sparire sopra 1,8 km) e nebbia del mattino (`morningFogAt`: 4,8-10,2 h, picco 6,4-8,2, forza diversa da un giorno all'altro, piu' fitta sotto i 30-120 m e vicino al mare). Con la giornata ferma (`dayCycle` spento, ora 10,5) non c'e' nebbia mattutina; la pioggia c'e' comunque.
- Effetti: nebbia piu' densa e grigia (`WorldFog.tsx`, `fogMul` fino a ~x7), sole piu' debole (`SunLight.tsx`, fino a -55%), cielo piu' torbido e meno blu (`Sky.tsx`) e nuvole grigie (`Clouds.tsx`); pioggia a collisione (`WeatherRain.tsx`, la stessa di `ZombieRain`, gocce 900-4000 e intensita' dalla pioggia, mappa delle altezze a frame alterni; si crea alla prima pioggia e poi si spegne/riaccende), audio della pioggia (`public/sounds/light-rain.mp3`) e tuoni col temporale; gli abitanti dei villaggi stanno in casa con pioggia > 0,6.
- Casella "Meteo: pioggia e nebbia del mattino" (menu iniziale, Grafica; Debug > Grafica "Meteo (pioggia e nebbia)"): `store.weatherOn`, acceso di default, ricordato. Spento in modalita' zombi notturna (ha gia' il suo temporale). Prove dal vivo (solo dev): `window.__forceRain` e `window.__forceFog` (0..1).
- Misura (sito selvaggio, pioggia 0,9): frame p50 24,6 -> 24,3 ms, p90 30,5 -> 39,2 ms prima di far girare la mappa delle altezze a frame alterni (non rimisurato dopo).

## Suoni posizionali
- Tutti sintetizzati con WebAudio (`lib/proceduralAudio.ts`, nessun file), sull'ascoltatore condiviso (`lib/sharedAudioListener.ts`): `components/Environment/AmbientSounds.tsx` (montato in `App.tsx`) fa il vento (rumore filtrato con raffiche: piu' forte in quota, con la pioggia, ovattato in citta'), l'acqua (fiumi, laghi e mare entro 100 m: una sorgente posizionale sul punto d'acqua piu' vicino, cercata ogni 0,7 s con `wildInfo`), le campane (ogni chiesa entro 420 m dal sito, sorgente in cima al campanile: ogni 3 ore di gioco, o ogni 150 s con la giornata ferma; tanti rintocchi quante le ore, al massimo 6) e i passi del giocatore sull'erba nei siti selvaggi.
- In `VillageFolk.tsx`: galline (coccodè ogni 8-26 s entro 60 m), cani (abbaio ogni 35-95 s) e uccelli (cinguettio ogni 5-14 s entro 200 m), con una sorgente posizionale sull'animale.
- Il contesto audio parte al primo click o tasto (regola dei browser). Provato con un analizzatore sull'uscita: vento, campana (da 70 m), acqua (a 16 m), coccodè, abbaio, cinguettio e passo alzano il livello sopra il fondo; non ascoltati a orecchio.
- Tolto `OllamaProps` (le cinque forme colorate al centro di ogni sito): non servivano piu'.
