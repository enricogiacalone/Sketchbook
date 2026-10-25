# Il Seme (storia principale)

Il gioco ha ora una storia principale che lega i pezzi che c'erano gia': la citta', i pianeti con i loro villaggi e le rovine, il drone, la mosca del laboratorio.

## Premessa
Il mondo non e' nato: e' stato sognato. I Costruttori trascrissero una mente piccolissima, quella di una mosca (i 5165 neuroni del connettoma di *Drosophila* che il Laboratorio cervello mosca fa muovere in un corpo umano) e le diedero un sogno: un universo di pianeti generati da un *seme*. La mosca "si crede umana". Ma il sogno si sta spegnendo: la mente e' stata spezzata in **frammenti**, uno nascosto nelle rovine di ogni pianeta, e gli anziani dei villaggi ne custodiscono la memoria.

Il giocatore e' un viaggiatore con un drone. Il Laboratorio (nella citta') gli affida l'incarico: **raccogliere tutti i frammenti e riportarli al Laboratorio per risvegliare la mosca**.

## Obiettivo finale
Raccogliere un frammento per ogni pianeta (i cinque pianeti di destinazione piu' quello da cui si parte: 6 frammenti in tutto) e aprire il **Laboratorio cervello mosca** dal menu: con tutti i frammenti compare la scelta finale.
- **Risvegliarla**: la mosca si rialza, il sogno finisce (finale "risveglio").
- **Lasciarla sognare**: il sogno continua, i pianeti restano com'e' (finale "sogno").

## Capitoli (in gioco)
1. **Il messaggio** (citta'): all'inizio un banner spiega l'incarico; obiettivo: raggiungere il villaggio piu' vicino (le strade tra citta' e villaggi ci arrivano).
2. **L'anziano** (villaggio): ogni villaggio ha il suo anziano; parlarci racconta la leggenda e, chiedendo, *segna sulla bussola* la rovina del pianeta.
3. **La rovina**: raggiunta, il frammento brilla; si prende premendo il tasto di dialogo vicino ad esso.
4. **Oltre il cielo**: finito il pianeta, l'obiettivo indica il prossimo (si va col drone nello spazio, menu pianeti).
5. **Il risveglio**: con tutti i frammenti, tornare al Laboratorio (menu iniziale) per il finale.

## HUD
In alto a sinistra sotto i soldi: titolo "IL SEME", frammenti n/N, obiettivo, distanza e freccia verso il bersaglio (villaggio o rovina). Si salva nel salvataggio del giocatore (`story` in `lib/saveGame.ts`).

## Dove sta il codice
`src/ts/story/mainStory.ts` (dati, testi, obiettivo corrente, dialoghi degli anziani), `src/ts/components/Missions/MainStory.tsx` (anziani, frammenti, dialogo, bussola), `src/ts/components/UI/MainStoryHUD.tsx` (pannello), `src/ts/flyLab/FlyLab.tsx` (finale).

## Stato e verifica
- Provato dal vivo: pannello e bussola (distanza e freccia), banner d'avvio, obiettivi che cambiano con lo stato (anziano -> rovina -> prossimo pianeta -> laboratorio), dialogo con l'anziano di un villaggio (apre, risponde, segna la rovina, banner), salvataggio e ripresa dello stato.
- Non provato fino in fondo: prendere il frammento nella rovina (la logica c'e' ma il giro completo a piedi non e' riuscito nei test: la finestra si nascondeva e il sito si ricentrava), il suono del frammento, il pannello e i finali nel Laboratorio.
- Il pianeta di partenza e' quello del mondo al primo avvio della storia (`home`): se e' uno dei cinque di destinazione i frammenti sono 5, altrimenti 6.
- Per riazzerare la storia di un giocatore: `useStore.getState().setMainStory({started:false, home:0, elders:[], hints:[], fragments:[], ending:null})`.

## Non ancora fatto (direzione)
- **Missioni dei villici**: incarichi piccoli (consegne, ritrovamenti) che l'anziano chiede prima di rivelare la rovina; ricompensa in soldi e reputazione.
- **Commercio tra pianeti**: merci diverse per pianeta, prezzi che cambiano, il drone come mezzo.
- **Difesa**: guardiani alle rovine (droni nemici, zombi) e razzie ai villaggi.
- **Progressione**: reputazione per villaggio (sconti, informazioni), potenziamenti di drone e armi, base propria in un villaggio, diario e mappa dei pianeti.
