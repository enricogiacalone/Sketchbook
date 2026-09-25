# Cervello della mosca → corpo umano

La "mosca che si crede un umano": un sottografo del connettoma di *Drosophila*
(FlyWire v783, `public/fly-brain/`) comanda il ragdoll **completamente fisico**
del personaggio. L'animazione (Idle_A, Walk, LayToIdle) è solo il riferimento
da imitare. Il corpo sta in piedi e si sposta solo se i motori delle
articolazioni, comandati dai neuroni discendenti, spingono bene sul pavimento.

## Pezzi

| file | cosa fa |
|---|---|
| `public/fly-brain/fly-brain.json`, `fly-brain-edges.bin` | 5165 neuroni (2362 ascendenti → ingressi, 1500 centrali, 1303 discendenti → uscite), 108 081 sinapsi con segno |
| `src/ts/flyBrain/flyBody.ts` | il corpo: stessi segmenti, masse, limiti e motori del ragdoll attivo del gioco, senza servo del bacino |
| `src/ts/flyBrain/connectomePolicy.ts` | la rete: sinapsi del connettoma fisse; si addestrano guadagno e soglia di ogni neurone, lettura dei sensi e dei discendenti |
| `src/ts/flyBrain/flyController.ts` | riferimento animato + ingressi + correzioni ai motori (uguale in gioco e in addestramento) |
| `training/fly-brain/train.ts` | addestramento con Evolution Strategies su tutti i core |
| `src/ts/components/Environment/FlyBrainFighter.tsx` | la mosca-umano nell'arena (pannello debug → "Cervello mosca") |
| `src/ts/flyLab/` | il laboratorio (terza voce del menu): addestramento nel browser, vero vs rimescolato |

## Addestrare sul Mac

Serve Node ≥ 22.6. Dalla cartella del progetto:

```
npm run mosca:train -- --task stand            # stare in piedi (primo passo)
npm run mosca:train -- --task getup --from public/fly-brain/weights-stand.json
npm run mosca:train -- --task walk  --from public/fly-brain/weights-stand.json
```

Opzioni: `--gens 1000 --pop 96 --sigma 0.01 --lr 0.003 --workers N`.

**Esperimento di controllo** (connettoma rimescolato: stessi neuroni, stessi pesi,
stesso numero di sinapsi per neurone, ma collegamenti casuali):

```
npm run mosca:train -- --task stand --brain shuffled
```

scrive `public/fly-brain/weights-<compito>-shuffled.json` e `log-<compito>-shuffled.csv`.
Più comodo: il **Laboratorio cervello mosca** (menu iniziale) addestra i due cervelli
in contemporanea e li mostra affiancati, con le due curve sullo stesso grafico.
Riparte da `public/fly-brain/weights-<compito>.json` se esiste. Il log è in
`training/fly-brain/log-<compito>.csv` (colonna "centro" = punteggio 0..1 dei pesi attuali).

Mentre addestra, nel gioco: pannello **Cervello mosca → Ricarica pesi addestrati**.

## Punteggio (stile DeepMimic)

Per ogni passo: somiglianza della posa col riferimento, posizione di testa, piedi
e mani, altezza del bacino (e, camminando, velocità in avanti). L'episodio finisce
se la testa scende sotto 0,9 m. 1,0 = imita perfettamente per 6 s.
Il corpo senza cervello (solo l'animazione) fa ~0,14 e cade in ~1,5 s.

Dati FlyWire: CC BY-NC 4.0, vedi `public/fly-brain/CREDITS.txt`.
