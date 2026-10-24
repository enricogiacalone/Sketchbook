# Personaggi della citta': un corpo, piu' comportamenti

## Come e' fatto

- **Corpo comune**: `components/city/useMannequinActor.ts` (clone del manichino, mixer, ragdoll, KO, `play()`, `beginFrame`).
- **Comportamenti** come funzioni pure sul corpo, in `components/city/brains/`:
  - `hostile.ts` (`stepHostile`): insegue, a tiro si ferma e spara (o picchia a mani nude), di guardia sta fermo finche' non ti vede,
    rinuncia dopo 15 s senza stargli a tiro. Usato da `Enemy.tsx` (guardie delle missioni, nemici "veri") e da `CrowdPedestrian.tsx`.
  - `PistolGear.tsx`: la pistola si monta solo quando un passante la tira fuori (non una per corpo del pool).
- **Passante che si arrabbia** (`CrowdPedestrian.tsx`): non c'e' piu' il rimontaggio (prima: l'agente usciva dalla folla, compariva un
  `<Enemy>` con un corpo nuovo, e a fine rinuncia tornava passante). Ora il corpo del pool resta, l'agente si segna `gone` (la simulazione
  della folla lo salta, lo slot resta suo) e il corpo gira `stepHostile`. Rinuncia: `reviveCrowdAgent` + `release()`. Morte: come per ogni
  passante (cadavere, poi l'agente torna). `agent.forceHostile = 'fists' | 'armed'` fa arrabbiare un agente al prossimo colpo (missioni, prove).
- Ancora separati (da portare nello stesso schema, in quest'ordine): `AllyNpc` (alleato), `PoliceOfficer`, `Zombie`.

## Laboratorio personaggi

Quarta voce del menu iniziale, o in sviluppo `http://localhost:5173/?lab=char`. Piazza vuota (150, -90), giocatore blu (WASD, Maiusc corre)
colpibile come quello vero, pulsanti per far comparire passanti (con il vero pool e la vera simulazione della folla), nemici, polizia,
alleati e zombi, "Colpisci un passante" (pugni o pistola). A destra: ogni personaggio con la clip in corso e l'avviso di posa a T.
Per i test automatici: `window.__charLab` (`spawn(kind)`, `provoke(armed)`, `clear()`, `rows()`, `agents()`).
Nota: il browser integrato va emulato a una dimensione fissa (`resize_window`), altrimenti la pagina ha dimensione 0 e non disegna.
Il laboratorio fa comparire i personaggi a 1,2 s l'uno dall'altro per prudenza (il blocco reciproco era il bug delle ossa in cache, ora corretto).

## Navigazione e personaggi "intelligenti"

- `lib/nav.ts`: griglia di navigazione (ostacoli rettangolari ingranditi del raggio di chi cammina), A* a 8 direzioni senza angoli
  tagliati, percorso accorciato, linea di vista (`lineClear`). Si registra con `setNav(grid)`; senza griglia i comportamenti vanno
  dritti come prima (la citta' non ne ha ancora una: va costruita dai suoi edifici).
- `brains/pathFollow.ts` (`steerTo`): segue il percorso, lo rifa' ogni ~secondo o quando l'obiettivo si sposta, prende scorciatoie.
- `brains/hostile.ts` con navigazione: vede solo con la linea d'aria libera (22 m), sente da vicino anche dietro i muri (7 m), va
  dove l'ha visto l'ultima volta, poi lo cerca in giro (raggio che cresce col tempo); `persistent` (cacciatore) non rinuncia mai.
  Se resta incastrato rifa' il percorso e cambia zona di ricerca.
- Laboratorio: labirinto 25x25 su 3 livelli con piazza al centro e un'uscita nel muro esterno (faro verde), cacciatori (i tre pulsanti "+ 3
  cacciatori"), e il **giocatore vero** (`CityPlayer` -> `PlayerCombatSoldier`, con la sua locomozione Kimodo, i pugni, la fisica)
  guidato da un **pilota automatico**.
- Pilota automatico: `lib/playerAutopilot.ts` e' un comando in coordinate del mondo (direzione, andatura, lock-on, pugno) che
  `PlayerCombatSoldier` legge al posto dei tasti quando `playerAuto.active` (input avvolto in un Proxy, `_moveDir` e `_tMove`
  sostituiti, `faceForAttack` senza il vincolo della camera). A tasti spenti non cambia niente. Chi lo guida e'
  `charLab/autopilot.ts`: non conosce l'uscita, esplora la cella piu' vicina non visitata (si impegna su una cella finche' non la
  raggiunge), scappa da ogni cacciatore che vede o sente (verso la cella che raggiunge prima di lui), combatte solo in trappola,
  riprende fiato quando e' al sicuro. WASD lo scavalcano; il pulsante lo spegne; "Telecamera: segue il giocatore".
- Telecamera: con "segue il giocatore" il busto del giocatore non e' piu' allacciato alla telecamera (`playerAuto.freeTorso`, in
  `PlayerCombatSoldier` il peso di `applySpineLean` scende a 0 piano; senza il laboratorio non cambia niente). Un clic su un
  cacciatore o sul giocatore porta la telecamera nella sua testa (prima persona: la testa si rimpicciolisce per non vederla
  dall'interno); Esc o un clic nel vuoto tornano all'orbita.
- Cacciatori: la loro griglia ha il varco dell'uscita tappato e tutto l'esterno bloccato (non escono e non cercano fuori); quella
  del giocatore no. La linea di vista usa i muri veri (`NavGrid.lineOfSight`), non il loro ingombro per camminare.
- Risultato provato: senza nemici trova l'uscita in 2-3 minuti; con tre cacciatori a volte li semina e continua (tutti dentro il
  labirinto in 100 s di prova), a volte lo raggiungono in un angolo e lo sconfiggono.
- Trovato dalle prove (non corretto, e' del gioco): in mischia a mani nude il giocatore vero perde sempre contro un nemico a pugni.
  Il pugno del nemico fa danno subito e il suo braccio, corpo cinematico, urta il giocatore e lo mette a terra (`resolveObstacleContacts`
  -> `startKnockdown`), che cancella il pugno del giocatore prima del contatto. Per questo il pilota scappa invece di combattere.

### Bug trovati col laboratorio (corretti)

- `useRagdollBones`: le ossa in cache restavano quelle di un clone scartato da `React.StrictMode` (`main.tsx`, doppia chiamata di
  `useMemo`), fermo all'origine in posa a T; i collider del corpo solido stavano li' e, con due personaggi vivi, si bloccavano
  a vicenda. Ora la cache vale solo per il modello corrente.
- `useRagdollSolidBodies`: `Foot_L/R` compaiono due volte in `SOLID_BODY_SEGMENTS` e il primo corpo creato restava orfano (2 collider per
  personaggio, mai mossi). Ora il duplicato si salta.

## Prossimi passi

1. Alleato (`AllyNpc`) e zombi nello stesso modello (un passante reclutato o infettato non cambia corpo).
2. Il combattimento comune (colpi, danno) di `Enemy`, `PoliceOfficer` e `AllyNpc` in `npcCombat`: oggi `hostile.ts` ha la sua copia.
3. Un solo controllore di locomozione (idle, partenze, svolte, IK dei piedi) che legge l'intenzione di qualunque comportamento.

## Pannello Debug: animazioni Kimodo

`Debug > Animazioni Kimodo` (sezione di primo livello, `lib/debugGui.ts`; costruita da `RagdollBenchGUI.tsx`), divisa per gruppo (quello di
`tools/kimodo/animations.json`, ora scritto in `kimodoClips.json` dal retarget): **Idle**, Locomozione, Stati, Folla, Ragdoll.
Ogni gruppo ha un menu "Prova" che fa ripetere la clip al manichino. La cartella **Idle (riposo del giocatore)** configura quello
vero (`idleConfig` in `lib/kimodo.ts`, letto ogni frame da `PlayerCombatSoldier`): riposo di base, variazioni on/off, ogni quanti
secondi (da/fino a), peso di ogni clip (0 = mai) e prova. Predefinito: respiro di base, variazioni shift_weight x2 e fidget.
Tra una clip di prova e l'altra (e quando si toglie la prova) il manichino torna al riposo vero del giocatore (`benchRestClip`: il respiro configurato), non alla guardia da combattimento (`Fighting Idle`).

## Moto

- `components/Vehicles/Motorcycle.tsx` (fisica e comandi), `MotorcycleModel.tsx` (modello fatto di forme semplici, nessun file),
  `lib/motorcycleGeometry.ts` (misure: interasse 1,44 m, sella a 0,8 m, manopole, pedane, ingresso a sinistra).
- Fisica "arcade": corpo rigido con le rotazioni bloccate a velocita' comandata (gas W, freno S, sterzo A/D, Spazio = freno a mano), sterzo
  "a bicicletta" (v * tan(sterzo) / interasse, meno efficace ad alta velocita'), massimo ~115 km/h; inclinazione in curva e beccheggio
  solo nel disegno (gruppo interno), quindi il pilota si inclina con la moto (la sella e' lo stesso gruppo). Attrito con `Min` a zero:
  con la media col terreno le sfere-ruota si inchiodavano.
- Entrata/uscita: stesso meccanismo delle auto in `PlayerCombatSoldier` (F vicino all'ingresso, nodi `seat_1` / `entrance_1`); sulla moto
  niente portiera, e le capsule solide del pilota si parcheggiano finche' e' in sella (`ragdoll.park()`), altrimenti urtano la moto.
  Entita' di tipo `motorcycle` (`store.ts`), `currentControllable` resta `car`. Nella citta' c'e' una moto (`moto-1`) vicino al punto di
  partenza (`Scene.tsx`); nel laboratorio il pulsante "+ Moto".
- **Animazioni del pilota: da generare con Kimodo** (a unita' collegata). I prompt sono in `tools/kimodo/animations.json`, gruppo `moto`:
  `moto_ride`, `moto_stopped` (loop), `moto_mount` (parte dalla posa canonica), `moto_dismount` (finisce sulla posa canonica),
  `moto_lean_left`, `moto_lean_right` (loop). Comando: `for n in moto_ride moto_stopped moto_mount moto_dismount moto_lean_left moto_lean_right; do npm run kimodo -- gen $n; done`.
  Riferimento dell'origine del personaggio: come `Driving` dell'auto (`VEH_SEAT.motorcycle`: 0,45 m sotto la sella). Finche' le clip
  mancano il giocatore usa `Driving` / `Sitting_Enter` / `Sitting_Exit`; con le clip presenti (nomi in `K.moto`) usa ride/stopped (a
  velocita' 1,5 m/s), mount e dismount. Le due clip di inclinazione non sono ancora collegate.
- Laboratorio: pavimento a quadretti da 1 m; il labirinto parte acceso (pulsante "Labirinto").

### Moto in citta'

- Ferme: 3 vicino al punto di partenza (`Scene.tsx`: moto-1..3) e 12 lungo il corsello centrale dei tre parcheggi (`ParkingLots.tsx`: city-moto-0..11),
  tutte guidabili (`Motorcycle.tsx`).
- Nel traffico: 8 moto (`N_MOTOS` in `Traffic.tsx`), con un pilota seduto e un colore a testa. Sono "auto" della stessa simulazione (corsie,
  semafori, code, svolte, panico agli spari, rinnovo lontano dal giocatore) ma non entrano nel pool delle auto fisiche e non sono disegnate in blocco:
  le disegna `TrafficMoto.tsx` (inclinata in curva dalla velocita' di rotazione, ruote e sterzo che girano, nascosta oltre 170 m) con un corpo
  cinematico per urtare i personaggi. Il pilota usa `Kimodo_moto_ride` se c'e', altrimenti `Driving`.

## Sospensioni della moto

`lib/motoSuspension.ts`: massa sospesa (telaio, sella, pilota) con due gradi di liberta' (sobbalzo e beccheggio), molla + smorzatore come la macchina ma piu' dure (`HEAVE_W`, `PITCH_W`, smorzamento ~0,35). Frenando la moto si abbassa sull'avantreno, accelerando si impenna un po'; dossi e salti la fanno rimbalzare. `MotorcycleModel` separa parte sospesa (telaio, foderi forcella, forcellone, mono) e non sospesa (ruote, steli dorati); `applyMotoSuspension()` aggiorna forcellone e mono-ammortizzatore. Usato da `Motorcycle.tsx` e `TrafficMoto.tsx`; la sella (`seat_1`) e' sulla massa sospesa, quindi il pilota segue.

- Nemici a pugni della folla (`city/brains/hostile.ts`): si fermano a 0.8 m dal bersaglio (`BRAWL_STOP`) e colpiscono entro 1.15 m (`BRAWL_RANGE`); prima 1.3 m / 1.5 m, troppo lontano perche' il pugno frontale arrivasse.

## Scavalcare i muri del labirinto (laboratorio)

- I muri interni sono alti 2.2 m (`WALL_H`, `charLab/maze.ts`) e hanno il collider `CLIMBABLE_GROUPS`: il giocatore li scavalca come nell'arena parkour (Spazio vicino al muro: `traversal.ts` ci si tira su, attraversa la cima e scende dall'altra parte). Il muro esterno resta invalicabile.
- `lib/nav.ts`: `NavLink` = passaggio a salto (A, B, altezza, costo). `NavGrid.setLinks` li aggiunge all'A*; il percorso li riporta come punti con `vault` (non si accorciano mai) e `steerTo` (`brains/pathFollow.ts`) restituisce `vault` quando si e' arrivati alla partenza. `charLab/vault.ts` genera un link per verso su ogni muro interno (partenza e atterraggio a 1.3 m dal muro, costo 7 m).
- Cacciatori (`brains/hostile.ts`, `S.vault`): traiettoria scriptata da A a B in 1.7 s in tre tempi come il giocatore: si tira su (Climb Wall), scavalca la cima (ClimbUp_1m__ip, la copia in-place di ClimbUp_1m_RM creata in `useMannequinActor`), cade dall'altra parte (Jump_air, Jump_Land). Non e' fisica: il corpo e' tenuto da un solo punto.
- Pilota automatico (`charLab/autopilot.ts`): le distanze per scappare contano anche i muri superabili (costo `VAULT_COST / MAZE_CELL` celle) per se' e per chi lo insegue; quando il percorso dice "scavalca" va dritto al muro e preme Spazio (`playerAuto.jump`) quando e' a portata delle mani (< 0.8 m dalla faccia), poi spinge avanti fino a essere oltre. Prove dalla console: `window.__pilot.vaultLog` (esiti 'ok' / 'scaduto').
- Prova (3 cacciatori + pilota): i cacciatori scavalcano per inseguire, il pilota scavalca per scappare (3 scavalchi su 3 riusciti prima di essere raggiunto).

## Livelli e scale del labirinto (laboratorio)

- `charLab/maze.ts`: 25x25 celle in 5 fasce di 5 colonne (`BAND_LEVELS = [2,1,0,1,2]`, `LEVEL_STEP = 2.8` m): al centro il piano terra con la piazza, verso i lati fasce a +2.8 m e +5.6 m su blocchi pieni (`slabs`). Ogni fascia e' un labirinto per conto suo; le fasce vicine si collegano con 2 scale per confine (`stairs`: due celle di rampa, larghe una cella, sempre lungo x, 15 gradini). Il muro tra due fasce e' la parete del blocco (non si scavalca); i muri dentro una fascia si scavalcano (`canVault`). Le uscite e i punti di comparsa stanno sempre a terra. Il labirinto si rigenera (seme + 7919 k) finche' tutte le celle sono raggiungibili dalla piazza.
- Fisica (`CharLab.tsx`, `MazeLevels`): blocchi `CLIMBABLE_GROUPS`, rampa di collisione liscia `STAIR_RAMP_GROUPS` come nell'arena parkour (si cammina sulla rampa; i gradini sono visibili e per l'IK dei piedi, `registerStepFlights`). Il giocatore sale con la solita locomozione (`supportHeight`).
- Chi cammina senza fisica verticale (`brains/hostile.ts`: cacciatori e nemici della folla) prende la quota da `lib/floors.ts` (`setFloorLift`, registrata dal laboratorio con `maze.heightAt`); lo scavalco usa quella quota come base. Il percorso A* e' gia' 2D e le scale sono celle libere, quindi inseguono e scappano anche su per le scale.
- Prova: il giocatore (pilota) sale la rampa fino a 2.8 m; i cacciatori inseguono su per le scale fino al livello +5.6 m (quota letta dalle ossa radice 4.2 / 5.9 m a meta' rampa).
- Poliziotti, alleati e zombi (`npcCombat.ts`, `stepToward`): dove c'e' una griglia di navigazione seguono il percorso A* (`steerTo`) e scavalcano i muri come i cacciatori. La traiettoria dello scavalco e' in `brains/vaultMove.ts` (`stepVaultRun`, condivisa con `hostile.ts`); `StepState` porta `path`, `vault` e `lift`. Il chiamante somma `floorLift` (quota dei livelli) e `step.lift` (sollevamento dello scavalco) alla quota del terreno e non sovrascrive l'animazione mentre `step.vault` e' attivo. `PoliceOfficer.tsx` ora usa `stepToward` (prima aveva il passo inline). Senza griglia (citta') il comportamento e' quello di prima.

## Copertura dietro i muri (laboratorio)

- `brains/cover.ts`: `findCover(nav, x, z, tx, tz)` cerca (a anelli di 1.2..8 m, 16 settori) un punto libero e raggiungibile in linea d'aria da cui il tiratore non si vede (`NavGrid.lineOfSight`), piu' un punto "da sporgersi" a 0.8..1.7 m da cui invece lo si vede. `armedShooters` / `liveShooters()` e' il registro dei tiratori armati che si aggiornano (`hostile.ts`), ignorando quelli fermi da piu' di 0.5 s.
- Nemici armati (`hostile.ts`, `stepCover`, `S.cover`): in modo 'shoot' con la griglia, vanno dietro il muro piu' vicino, aspettano 1-2.5 s, si sporgono, sparano 1-2 colpi (solo da sporti, `cv.canShoot`) e rientrano; se vengono feriti rientrano subito; se il giocatore si e' spostato di piu' di 3 m o la copertura non copre piu' ne cercano un'altra. Senza copertura trovata sparano allo scoperto come prima.
- Pilota automatico (`charLab/autopilot.ts`): se un armato lo vede (e nessun nemico e' a meno di 2.5 m) va alla copertura piu' vicina, ci resta 2.5-4 s (`coverHold`), poi riparte (`coverCd` 2 s); `mode` = 'scappa'. Prove: `window.__pilot.coverLog` (coperture prese).
- Non verificato nel browser: durante questa sessione il browser integrato non ha potuto aprire localhost (navigazione negata), quindi la copertura e l'inseguimento di poliziotti/zombi su per le scale sono solo controllati dal compilatore.

## Laboratorio cervello mosca: corpo con 17 pezzi

- `flyBrain/flyBody.ts`: `FLY_SEGMENTS` prende solo i pezzi che hanno una forma in `FLY_LEGACY_SHAPES` (i 17 con cui sono stati addestrati i cervelli). Il commit "locomotion" (17 ottobre 2026) ha aggiunto `Hand_L` e `Hand_R` a `ACTIVE_RAGDOLL_SEGMENTS`: nel corpo della mosca diventavano due pezzi in piu', con i loro giunti, e al primo passo di fisica Rapier andava in panico (`RuntimeError: unreachable`, poi "recursive use of an object"): il laboratorio non partiva piu'. Trovato per bisezione dei commit (funziona fino a 0685d11, rotto da 3b633d2). Regola: se si aggiungono pezzi al ragdoll del gioco, il corpo della mosca non li prende finche' non si aggiungono anche a `FLY_LEGACY_SHAPES` e si riaddestrano i cervelli (`FLY_BODY_VERSION`).

## Laboratorio cervello mosca: aiuto per camminare (ottobre 2026)

La mosca faceva fatica a camminare da zero (senza aiuto cade in ~1 s, punteggio ~0.08). Ora l'aiuto ("bretelle": molle su bacino e petto verso le altezze dell'animazione di riferimento) vale per tutti i compiti, non solo per l'alzarsi:

- **Aiuto**: `assist` 0..1. Default: stare in piedi 0, camminare 1, alzarsi 1. Cala di 0.05 quando almeno il 66% degli episodi riesce, risale di 0.05 se non ne riesce nessuno (per stare in piedi non risale da 0). Per `stand` il baricentro e' anche tirato sopra il centro dei piedi (`centre`).
- **Velocita'**: `walkScale` (solo camminare), parte a 0.5 e sale di 0.1 quando riescono ≥66% degli episodi, scende di 0.1 se nessuno (minimo 0.3, massimo 1). `FlyController.setWalkScale` scala sia la velocita' comandata sia il tempo dell'animazione.
- **"Riuscito" camminando**: non caduta, testa >1.1 m, inclinazione <50°, avanzato ≥40% di `velocita'*secondi`.
- Partenza da pesi di 'stand' (gia' c'era) e fase del passo come input (gia' c'era).
- I file pesi salvano `assist` e `walkScale`; la tabella mostra "aiuto% / vel%".
- Prova senza cervello (`npm run mosca:walkassist`): camminare a vel 0.5 aiuto 0 → cade sempre (0.08), aiuto 0.5 → cade (0.15), aiuto 1 → non cade (0.68). In piedi: aiuto 0 cade (0.13), aiuto 0.5 sta (0.89).
- Non verificato: l'effetto sull'addestramento lungo (in browser ~20 s a generazione).

Aggiornamento (dopo 290 generazioni senza differenza vero/rimescolato): l'aiuto per stare in piedi/camminare ora cala di 3 punti solo dopo due misure di fila riuscite (misura ogni 5 generazioni, 5 prove, soglia 60%), risale di 5 se non riesce mai; nella ricompensa del cammino l'avanzamento pesa 0.25 (posa 0.4, estremita' 0.2, altezza 0.15). I punteggi non sono confrontabili con quelli di prima: ripartire "Da zero".

Camminavano piegate in avanti ("in obliquo"): le molle dell'aiuto controllavano solo l'altezza di bacino e petto, e la ricompensa non guardava il busto. Ora per il cammino l'aiuto tira anche il petto sopra il bacino (`assistUp(..., straight)`), la ricompensa ha un termine d'inclinazione del busto rispetto al riferimento (0.25) e il criterio "riuscito" accetta al massimo 35 gradi. Prova senza cervello a velocita' 0.5, aiuto 1: testa 1.36 m, 3 riusciti su 3 (prima testa 1.24, 0 su 3).

Gambe che non si attraversano: `FLY_BODY_VERSION` 3. Coscia, stinco e piede di un lato ora urtano quelli dell'altro lato (`legGroups`/`groupsFor` in `flyBody.ts`: bit 10 per la sinistra, 11 per la destra, ognuno vede solo l'altro); tutti gli altri pezzi del ragdoll continuano a non toccarsi. I pesi salvati con versione 2 vengono ignorati (anche dalla mosca che combatte nel gioco, che senza pesi validi non usa il cervello): serve riaddestrare. Prova senza cervello invariata nell'ordine di grandezza (cammino aiuto 1: 0.70, 3/3 riusciti; in piedi aiuto 0.5: 0.89).
