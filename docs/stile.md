# Stile e civilta' dei pianeti

Direzione: **realismo stilizzato**. Forme e proporzioni prese dal mondo vero (case con tetti, imposte, balconi, camini, campanili e minareti sulla piazza, pagode, mura e porte), ridotte a poche primitive con colore per vertice e finestre che si accendono di sera. La realta' e' la bussola: le strade hanno una gerarchia, gli isolati hanno una profondita', i palazzi alti stanno dove la citta' e' ricca, i capannoni dove c'e' spazio e rumore.

## Le quattro culture (`lib/culture.ts`)
| Cultura | Piante | Materiali e colori | Landmark |
|---|---|---|---|
| Mediterranea | borgo radiale con anelli, griglia romana, organica | intonaci caldi, tetti a coppi, imposte colorate | chiesa + campanile sulla piazza, fontana, cipressi e ulivi |
| Alpina (Nord Europa) | villaggio lineare lungo la via, a pettine | piano terra in pietra, legno scuro, tetti ripidi | chiesa con campanile a cuspide, fienili su palafitte, cataste |
| Maghrebina / Medio Oriente | medina murata, vicoli tortuosi, case a cortile | terra e sabbia, tetti piani, azulejo blu | moschea con minareto, suk, palme |
| Asiatica (Giappone/Himalaya) | griglia fitta o vicoli sinuosi | legno, tetti curvi grigi, shoji, bianco calce | santuario, pagoda, torii, lanterne |

Le regioni culturali di un pianeta sono 5 centri (`regionsOf`): un abitato prende la cultura del centro piu' vicino, quindi viaggiando si passa da un'architettura all'altra.

## Le taglie
casale (46 m) -> villaggio (106 m) -> paese (262 m) -> citta' (500 m). Ogni taglia ha la sua pianta (`lib/settlement.ts`, `lib/town.ts`) e la sua infrastruttura; vedi `docs/planets.md` (Civilta').

## Principi urbanistici usati
1. Una **gerarchia** di strade: arterie (8,5-11 m, alberate e con segnaletica), collettrici (6-7 m), strade locali, vicoli (2,4-4 m).
2. Le arterie arrivano alle **porte** (`gateAnglesOf`) e le strade tra abitati entrano da li'.
3. Incroci a T, **rotonde** dove si incontrano due arterie, anelli parziali.
4. **Mura** storiche attorno al centro antico, con una porta dove passa ogni strada importante; fuori, la citta' moderna.
5. **Zone**: centro storico a schiera -> cintura di palazzi -> villette con giardino -> campagna; centro direzionale con grattacieli; zona industriale (capannoni, ciminiere) in un settore periferico; parchi.
6. **Separazione dei livelli**: nelle citta' una sopraelevata scavalca arterie e anelli; la strada sotto e' un sottopasso.

## Colori e luce
Pareti bianche nei modelli, tinta per istanza dalla palette della cultura (`PALETTE`); tetti con 8 varianti; vetri dei grattacieli in 4 toni; asfalto grigio scuro con segni bianchi/gialli, selciato dei centri storici piu' caldo, sabbia nella cultura maghrebina. Le finestre brillano col buio (materiale emissivo legato a `getDayFactor`).

## Animazioni (placeholder finche' Kimodo non ha lo storage)
Gli abitanti usano le clip che ci sono (Idle_A, Walk, Greeting, Run_*, cower). Da generare con Kimodo, per ruolo: contadino (zappa, raccolta), fabbro (martello), mercante (offre merce, conta monete), pescatore (lancio e recupero), panettiere (impasta), guardia (ronda, saluto), bambino (corre, gioca), musicista (suona), preghiera (in piedi/in ginocchio per cultura). Nessuna e' ancora collegata.

## Da fare
Mestieri e attrezzi in mano, vestiti per cultura oltre al colore della maglietta, rituali e feste (processioni, mercato, preghiera del venerdi', matsuri), interni, ferrovie e stazioni.
