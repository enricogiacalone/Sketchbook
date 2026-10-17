# Calibrazione dei tre scheletri

Rigenerabile con:

```sh
node scripts/skeleton-audit.mjs                 # manichino contro SOMA (proporzioni, riposo, fedelta' del retarget)
node --experimental-strip-types --no-warnings scripts/ragdoll-fit.mjs   # ragdoll contro la mesh
```

I tre scheletri:

| | Dove | Giunti |
|---|---|---|
| **Manichino** (rig + animazioni di base) | `public/soldier-citizen.glb` | 67 ossa (con `neck_02` aggiunto) |
| **SOMA** (Kimodo) | `scripts/lib/skeletons.mjs` | 30 giunti |
| **Ragdoll** | `ragdoll/ragdollConfig.ts` | 13 capsule (+4 nel layer attivo) |

Corrispondenza manichino-SOMA (tutta in `scripts/lib/skeletons.mjs`): bacino↔Hips, spine_01↔Spine1, spine_02↔Spine2, spine_03↔Chest,
neck_01↔Neck1, neck_02↔Neck2, head↔Head, clavicole↔Shoulder, braccia↔Arm/ForeArm/Hand, gambe↔Leg/Shin/Foot/ToeBase. Mancano a noi
Jaw e gli occhi (non servono). Le dita di SOMA si fermano a pollice e medio (due punti): il resto e' ferma da `Idle_A`.

## 1. Proporzioni (K = 1.0307: altezza anche 0.932 m contro 0.904 m)

Lunghezza manichino / SOMA scalato:

| Misura | Nostro | SOMA | Rapporto |
|---|---|---|---|
| gamba (anca → caviglia) | 83.6 cm | 88.1 | **0.95** |
| coscia | 40.7 | 44.6 | 0.91 |
| stinco | 43.3 | 43.6 | 0.99 |
| piede (caviglia → punta) | 18.1 | 14.6 | **1.24** |
| braccio (spalla → polso) | 57.6 | 57.5 | 1.00 |
| clavicola | 20.2 | 16.4 | 1.23 |
| busto (bacino → collo) | 53.6 | 47.4 | **1.13** |
| larghezza spalle | 34.7 | 34.0 | 1.02 |
| larghezza fianchi | 17.8 | 20.7 | **0.86** |
| collo → testa | 13.2 | 14.9 | 0.89 |

Cioe': braccia identiche, **gambe 5% piu' corte** (coscia −9%), **busto 13% piu' lungo**, **fianchi 14% piu' stretti**, piedi 24% piu' lunghi.
Le tre ossa della schiena a noi sono 10/12/14 cm, in SOMA 5/7/8 con il torace (`Chest → Neck1`) lungo 27 cm: stessa colonna, giunti messi
in punti diversi.

## 2. Posa di riposo (angolo tra la direzione di ogni osso e quella di SOMA)

clavicole **20°** (le nostre salgono e vanno indietro, quelle di SOMA sono orizzontali), bacino 15°, mano 12°, collo 11.8°,
spine_03 11.3°, spine_01 7°, piedi 6°, il resto sotto 4.5° (braccia e avambracci 1.5°). Il retarget copia la rotazione rispetto al riposo
per schiena/collo/testa (`NO_ALIGN`) e allinea le altre ossa; per questo le clavicole si allineano solo in orizzontale (vedi il commento in
`kimodo-retarget.mjs`).

## 3. Fedelta' del retarget Kimodo → manichino

Per ogni clip non in loop si confrontano le distanze tra tutte le coppie di 21 giunti (non dipendono da dove sta il corpo) tra la posa SOMA
(FK dai dati grezzi, scalata K) e la posa del manichino con la clip adattata. Errore medio per giunto, in cm:

| Giunto | Solo proporzioni (riposo) | Con le clip | Picco |
|---|---|---|---|
| bacino | 8.5 | 9.0 | 10.2 |
| spine_01 / 02 / 03 | 5.2 / 3.2 / 5.6 | 5.6 / 3.8 / 5.9 | 7.0 |
| collo / testa | 3.9 / 4.9 / 5.3 | 4.5 / 4.6 / 4.5 | 6.4 |
| braccia (spalla / gomito / mano) | 2.7 / 2.2 / 2.0 | 3.8 / 3.8 / 3.7 | 4.9 |
| coscia | 3.1 | 3.2 | 3.7 |
| stinco / piede | 5.1 / 5.8 | 4.5 / 4.9 | 5.8 |

**Conclusione: la rotazione e' copiata bene. L'errore e' quasi tutto il "pavimento" delle proporzioni.** Con la sola posa di riposo, senza
nessuna animazione, l'errore e' gia' 2-8.5 cm; con le clip aumenta al massimo di ~1 cm. Quindi i piedi non cadono dove SOMA li mette (4.5-5.8 cm) e il
corpo non e' dove SOMA lo vuole (bacino 9 cm): e' la causa dello scivolamento dei piedi e di quella sensazione "un po' sbilenca" nelle clip,
non un errore di assi o di rotazioni.

Nota: la media delle clip e' 3.7-4.8 cm (per clip); le clip in loop (`panic_run`, `out_of_breath`...) sono ritagliate dai dati grezzi e si
confrontano solo a mano.

## 3b. IK sulle proporzioni (fatto) e scivolamento dei piedi (nuovo risultato)

`kimodo-retarget.mjs` ora, dopo aver copiato le rotazioni, rifa' ogni arto con una IK a due ossa: l'estremo (piede, mano) va dov'e' in SOMA
rispetto alla sua anca/spalla, scalato sulla lunghezza dell'arto (gambe 0.982, braccia 1.032), con il piano di piegatura copiato; la
traiettoria del bacino, e quindi le velocita' e i `motion` delle clip, si scala come le gambe (0.981 invece di 1.031). Prova con
`KIMODO_NO_IK=1` (e `KIMODO_OUT`/`KIMODO_META` per non toccare i file veri).

| Metrica (audit, sezione 4) | Senza IK | Con IK |
|---|---|---|
| estremo della gamba contro il bersaglio SOMA (medio / picco) | 0.54 / 3.5 cm | **0.00 / 0.06 cm** |
| estremo del braccio | 0.00 / 0.03 cm | 0.00 / 0.10 cm |
| scivolamento medio dei piedi a terra, clip con root motion | 17.8 cm/s | 15.7 cm/s |
| (le stesse clip, dati grezzi SOMA senza nessun adattamento) | 14.2 cm/s | |

**Il punto importante:** i piedi scivolano anche nei dati grezzi di Kimodo (14.2 cm/s in media): e' il modello che non ha il vincolo del
contatto con il terreno. L'IK sulle proporzioni porta il manichino da 17.8 a 15.7 (la camminata che si ferma, `walk_stop`, da 13.7/21.4 a
4.5/11.6), ma non puo' scendere sotto la qualita' dei dati di partenza. **Per togliere davvero lo scivolamento serve un passaggio di
pulizia dei contatti** (individuare i piedi a terra, bloccarli con IK e compensare il bacino): fatta, vedi sotto.

## 3c. Pulizia dei contatti dei piedi (fatta)

`cleanFeet()` in `kimodo-retarget.mjs`, prima di appoggiare i piedi al suolo:

1. **Appoggi:** tratti in cui la punta del piede sta bassa (isteresi 3/5.5 cm sul suo minimo, durata minima 4 fotogrammi) **e** si muove
   poco (< 0.6 m/s nel mondo, con la traccia di movimento): un passo o un giro sul posto non e' un appoggio.
2. **Punto piantato:** media della posizione della punta nell'appoggio; si molla se in un fotogramma il piede e' a piu' di 14 cm
   (dissolvenza da 7 cm), cioe' se la clip lo muove davvero.
3. **Bacino:** lo spostamento orizzontale minimo perche' le gambe arrivino ai punti piantati, levigato (media mobile ±5 fotogrammi, due passate).
4. **IK a due ossa** sulle gambe: la punta va al punto piantato (la caviglia di tanto meno lo scarto punta-caviglia), con dissolvenza di
   2 fotogrammi in entrata e in uscita; l'orientazione del piede resta quella della clip; piano del ginocchio copiato.
5. Continuita' del segno dei quaternioni su tutta la clip.

Parametri in `LOCK` (si provano con `KIMODO_LOCK='{"ramp":1}'`; `KIMODO_NO_LOCK=1` la spegne).

**Misura** (audit 4b; scivolamento medio dei piedi nelle clip con root motion; "a terra" = punta entro X cm dal suo minimo):

| A terra entro | Dati grezzi SOMA | IK senza blocco | **IK + blocco** |
|---|---|---|---|
| 3.5 cm (include il rotolamento tallone-punta) | 14.2 cm/s | 15.7 | **9.8** |
| 2 cm | 7.5 | 9.3 | **3.5** |
| 1 cm (appoggio pieno) | 6.0 | 7.6 | **2.3** |

Sugli appoggi pieni lo scivolamento scende di circa il 65% (da 7.6 a 2.3 cm/s, sotto i dati grezzi di Kimodo). Le gambe restano fedeli a SOMA
(estremo della gamba contro il bersaglio: medio 1.1-1.4 cm, picco 7 cm, dovuto alla correzione). Il resto dello scivolamento sta
nella zona in cui il piede rotola (tallone-punta) e nei fotogrammi di entrata e uscita dell'appoggio.


## 3d. Estremi legati all'idle (fatto per il busto, non per le gambe)

Misura: tra `Idle_A` e il primo o ultimo fotogramma delle clip Kimodo di partenza, arresto e svolta c'erano **17-20 gradi** di scarto
medio (clavicole fino a 48, braccio destro 40, gamba destra `calf_r` 43). `blendToIdle()` in `kimodo-retarget.mjs` porta tutte le
ossa del busto, collo, spalle e braccia esattamente sulla posa di `Idle_A` nel fotogramma di confine, con una correzione che sfuma in
0.4 s (`KIMODO_IDLE_BLEND`); clip interessate in `IDLE_ENDS` (walk/run start-stop, turn_*, wait_impatient, look_around, stretch,
saluto, point_shout). `KIMODO_NO_IDLE=1` la spegne.

| | Scarto medio da `Idle_A` | Scivolamento piedi (2 cm) |
|---|---|---|
| Prima | 17-20 gradi | 3.5 cm/s |
| Busto e braccia sull'idle (**attivo**) | **8-9 gradi** (resta la gamba destra, 43) | 3.5 cm/s |
| Anche le gambe (`KIMODO_IDLE_LEGS=1`) | 0.8 gradi | **41.5 cm/s** (i piedi vengono trascinati) |

Le gambe non si possono portare sull'idle correggendo solo le rotazioni: `Idle_A` ha il piede destro dietro e Kimodo parte a piedi
pari, quindi serve spostare i piedi (IK a runtime o un idle con i piedi pari) e non basta piegare le gambe.

## 3e. Kimodo con vincolo di posa e famiglia di idle (fatto)

`tools/kimodo/kimodo.cpp` (copia locale) ora accetta pose da rispettare: `kmd-generate ... --start DIR:FRAME[:TENUTA[:GRADI]] --end DIR:FRAME[:...]`
(`sample_motion_with_pose_keys` in `src/sequence.cpp`: stesso campionatore condizionato che il port usava solo per `--sequence`, ma con la
posa del manichino SOMA codificata nella rappresentazione del modello: posizioni di tutti i giunti e rotazioni di mani e piedi; l'arrivo ha
la posizione sul terreno libera). In `animations.json` una voce puo' avere `start` e `end`; `kimodo.sh` li passa al generatore.
`scripts/kimodo-posecheck.mjs` misura il rispetto della posa.

Posa canonica dell'idle = fotogramma 0 di `walk_start`. Generati `idle_breathe`, `idle_shift_weight`, `idle_fidget` (e `idle_look`, poi rinominata `side_step`: faceva un passo laterale, non e' un riposo; si usa per muoversi lungo un muro in copertura) con inizio e
fine vincolati a quella posa (loop):

| | Scarto medio dalla posa canonica (grezzo) | Dopo il retarget (busto portato su `Idle_A` come `walk_start`) |
|---|---|---|
| inizio / fine | 2.9-5.1 / 3.8-5.7 gradi (clip non vincolate: 4.4-9.5; arresti e svolte fino a 23) | busto 0.0, gambe 3.8-7.1 |
| cucitura del loop | | 0.0 |
| bacino che si sposta nel loop | | 0 cm |

Le svolte `turn_left_90` e `turn_right_90` sono tornate alle versioni generate senza vincolo di posa (piacevano di piu'); `turn_180`, `walk_stop`, `run_stop`, `run_start` restano quelle vincolate.

**Uso nel gioco (giocatore):** `K.idleBase` (`Kimodo_idle_breathe`) e' il riposo di `PlayerCombatSoldier` (prima `Idle_A`, che resta di
riserva); ogni 6-12 s da fermo parte una variazione (`K.idleVariations`: peso, sguardo, spalle) per un giro e si torna al respiro
(`kimodoIdle`). Non su scale (li' resta `Idle_Subtle`). Provato nel laboratorio: respiro, poi fidget e shift_weight a ~11-15 s l'uno
dall'altro. Alleati, poliziotti, nemici e folla usano ancora `Idle_A`.

Il vincolo e' morbido (non azzera), ma toglie la gran parte dello scarto dove serve (arresti, svolte).

## 4. Ragdoll contro la mesh (`ragdoll-fit.mjs`, riposo a T)

Prima: avambracci 3.7% (le mani, 2 523 vertici ciascuna, il 34% della mesh, non avevano capsula e sporgevano fino a 22 cm).
**Fatto:** `Hand_L/R` (polso → `middle_01`, raggio 4.5 cm, lunghezza 19.6 cm con le dita, genitore l'avambraccio) in `ragdollData.ts`,
con massa (Winter: avambraccio 1.6% + mano 0.6%), limiti del polso (+-60/40/70), frequenza del motore (28) e tono KO (0.5).
`SpineHigh` accorciata da 40 a 38 cm (x +-0.19, raggio 0.15) a parita' di copertura (70% / 74%).

| Pezzo | Prima | Dopo |
|---|---|---|
| avambraccio, mesh propria dentro | 3.7% | **78.6%** |
| mano (nessun pezzo → Hand), dentro | 0% (sporge p95 19.6 cm) | **60.3%** (p95 5.5 cm, max 7.2) |
| SpineHigh, dentro / qualunque | 70.9 / 75.6% | 69.8 / 74.4% |
| SpineHigh, capsula fuori dalla mesh | 33.7% | 31.6% |

SpineHigh: accorciare oltre 2 cm toglie copertura (le spalle sono vertici di `spine_03`; a +-0.17 si scende al 35%), quindi non si e'
andati oltre. Non verificato in gioco (solo `ragdoll-fit` e controllo dei tipi).

## Cosa serve (in ordine)

1. **Retarget con IK sulle proporzioni** (offline, in `kimodo-retarget.mjs`): bacino e arti seguono le posizioni SOMA scalate per arto
   (gambe 0.95, braccia 1.00, fianchi 0.86) invece di copiare solo le rotazioni. Metrica di verifica: l'audit sopra; obiettivo piedi e mani
   sotto 1.5 cm.
2. **Libreria di retarget a due direzioni** (`scripts/lib/`): serve anche manichino → SOMA per dare a Kimodo pose di partenza e di arrivo
   prese dalle nostre clip di base (`Walk`, `Run_Female`).
3. ~~Ragdoll: una capsula per mano e `SpineHigh` accorciata~~ (fatto, sezione 4).
4. Poi la locomozione avanzata (vedi la risposta nel thread: famiglia generata in un colpo solo, pose imposte, aggancio per fase, motion
   matching leggero, inerzializzazione, IK dei piedi).
