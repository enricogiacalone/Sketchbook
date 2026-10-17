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
- Laboratorio: labirinto 11x11 con piazza al centro e un'uscita nel muro esterno (faro verde), cacciatori (i tre pulsanti "+ 3
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
- Laboratorio: pavimento a quadretti da 1 m; il labirinto parte spento (pulsante "Labirinto").

### Moto in citta'

- Ferme: 3 vicino al punto di partenza (`Scene.tsx`: moto-1..3) e 12 lungo il corsello centrale dei tre parcheggi (`ParkingLots.tsx`: city-moto-0..11),
  tutte guidabili (`Motorcycle.tsx`).
- Nel traffico: 8 moto (`N_MOTOS` in `Traffic.tsx`), con un pilota seduto e un colore a testa. Sono "auto" della stessa simulazione (corsie,
  semafori, code, svolte, panico agli spari, rinnovo lontano dal giocatore) ma non entrano nel pool delle auto fisiche e non sono disegnate in blocco:
  le disegna `TrafficMoto.tsx` (inclinata in curva dalla velocita' di rotazione, ruote e sterzo che girano, nascosta oltre 170 m) con un corpo
  cinematico per urtare i personaggi. Il pilota usa `Kimodo_moto_ride` se c'e', altrimenti `Driving`.

## Sospensioni della moto

`lib/motoSuspension.ts`: massa sospesa (telaio, sella, pilota) con due gradi di liberta' (sobbalzo e beccheggio), molla + smorzatore come la macchina ma piu' dure (`HEAVE_W`, `PITCH_W`, smorzamento ~0,35). Frenando la moto si abbassa sull'avantreno, accelerando si impenna un po'; dossi e salti la fanno rimbalzare. `MotorcycleModel` separa parte sospesa (telaio, foderi forcella, forcellone, mono) e non sospesa (ruote, steli dorati); `applyMotoSuspension()` aggiorna forcellone e mono-ammortizzatore. Usato da `Motorcycle.tsx` e `TrafficMoto.tsx`; la sella (`seat_1`) e' sulla massa sospesa, quindi il pilota segue.
