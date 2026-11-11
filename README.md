# BWT · Bologna Wrestling Team · videogioco web

Gioco di wrestling 3D nel browser (Three.js + Vite), 1 contro 1 o 2 contro 2, contro il computer o online contro un amico;
vittoria per schienamento o count-out. Si combatte anche fuori dal ring, con sedie e tavoli da spaccare.
Stessa base tecnica del gioco di basket LGS: personaggi CC0 di Quaternius con abiti "dipinti" da uno shader
e mosse costruite come pose procedurali sopra le animazioni.

## Sviluppo
```bash
npm install
npm run dev        # http://localhost:5173, stanze multiplayer comprese (WebSocket /ws)
npm run build      # versione da pubblicare in dist/ (percorsi relativi)
npm start          # server di produzione: dist/ + stanze, porta 8080 (PORT per cambiarla)
```

## Multiplayer online
- Dal menu: **M** (o "Gioca online con un amico") → **Crea una stanza**: si ottiene un codice di 5 caratteri e un link `?invito=CODICE`
  da mandare con Copia link, WhatsApp o Condividi (telefono). L'amico apre il link, oppure inserisce il codice in "Entra".
- Nella stanza ognuno sceglie il proprio lottatore (non lo stesso dell'avversario); chi ha creato la stanza avvia l'incontro.
  L'host è l'angolo rosso, l'ospite l'angolo blu; i comandi sono gli stessi della partita singola.
  L'host sceglie anche **1 contro 1** o **2 contro 2** (T): nel 2 contro 2 ognuno sceglie anche un compagno, guidato dal computer.
- A fine incontro l'host decide: **INVIO** rivincita, **Q** ritorno alla stanza per cambiare lottatori. Esc apre un menu senza fermare l'incontro.
- Architettura (come nel basket): il browser dell'host simula l'incontro e invia lo stato 25 volte al secondo con scritte, suoni e scosse;
  l'ospite invia solo i comandi. Il server (`server/rooms.js`) inoltra i messaggi e non simula.
  Con la scheda dell'host in secondo piano la simulazione continua su un timer in un Worker.
- Connessione persa o pagina ricaricata: si rientra nello stesso posto entro 10 minuti. Se l'host ricarica la pagina l'incontro
  riparte dalla stanza; se l'host esce dalla stanza la partita finisce per entrambi.

## Pubblicazione sulla VPS (stessa del basket e di bicio-F1)
Il container (server Node: file del gioco + WebSocket delle stanze) si collega al proxy condiviso della VPS,
che gli dà dominio e HTTPS, WebSocket compresi.

1. DNS: record **A** `bwt` → `144.217.165.74` (su Cloudflare in modalità "DNS only" finché non c'è il certificato).
2. Dal PC, nella cartella del progetto (lo stesso comando aggiorna il gioco):
   ```bash
   deploy/deploy.sh ubuntu@144.217.165.74 bwt.sbagiuzza.it
   ```

## Comandi
| Tasto | Azione |
|---|---|
| WASD / frecce · Shift | movimento · corsa |
| J · K · L · I | pugno · calcio (a terra: calcio all'avversario steso) · presa · parata |
| In presa: J · K · L · F | suplex · body slam · irish whip · **powerbomb** (con la barra SPECIAL piena) |
| Spazio | schienamento sull'avversario a terra · premuto velocemente: liberarsi da uno schienamento |
| E | provoca il pubblico (carica lo SPECIAL) |
| Spingere contro le corde | uscire dal ring; da fuori, spingendo contro il bordo del ring, si rientra |
| Fuori dal ring: L · J | prendi una sedia · colpisci con la sedia (L di nuovo per posarla) |
| Esc / P · H | pausa · mostra/nasconde i comandi |

**Telefono e tablet** (in orizzontale): joystick a sinistra (compare dove appoggi il pollice; spinto fino in fondo = corsa),
pulsanti a destra con la lettera del tasto corrispondente. In presa PUGNO/CALCIO/PRESA diventano SUPLEX/SLAM/WHIP e FINISHER si illumina
con lo SPECIAL pieno; per liberarsi da uno schienamento si toccano velocemente i pulsanti. Pausa con il tasto ❚❚ in alto.

Meccaniche: colpire con la corsa = clothesline; chi rimbalza sulle corde dopo un irish whip va colpito al ritorno
(clothesline o dropkick), altrimenti travolge chi è fermo (a meno che non pari); quattro colpi di fila mandano a terra;
più energia ha chi è schienato, più è facile che si liberi.

**Fuori dal ring**: un colpo che manda a terra vicino alle corde fa volare l'avversario oltre la terza corda. Fuori non si schiena:
l'arbitro conta fino a 10 e chi non rientra in tempo perde per **count-out** (con la sua squadra). Sedie pieghevoli e tavoli
(`src/game/props.js`) sono a bordo ring: la sedia si spacca sull'avversario, un body slam o una powerbomb su un tavolo lo fa a pezzi;
i rottami restano a terra fino al prossimo incontro. Irish whip fuori dal ring: contro le transenne o contro il bordo del ring.

**2 contro 2** (tasto **T** nella schermata iniziale): si scelgono il proprio lottatore, il compagno e i due avversari
(INVIO completa a caso). Si combatte tutti insieme sul ring; il compagno, guidato dal computer, corre a interrompere gli schienamenti
colpendo chi schiena. Vince la squadra che schiena un avversario.

## Lottatori e staff
Sono in `src/data/roster.js`, presi dalle schede del sito BWT: Trucker, Guido, Nico Narciso, Jason, VP Dozer, Zodiac, Leonardo Bulgari Jr, El Mosquito;
staff: Liam Rangoni (presentatore, annuncia il match sul ring e poi resta a bordo ring) e Max Malpensa (dirigente, a bordo ring, esulta per le mosse spettacolari; a fine incontro sale sul ring e chiede di pulire tutto).

- **Altezza** → dimensione del modello. **Peso** → corporatura (tronco più massiccio, pancia, muscoli meno scolpiti) e stile: i pesi massimi sono più lenti ma colpiscono più forte.
- **Volti** dalle foto in `public/foto/`: `tools/build-faces.py` ritaglia il viso allineando gli occhi (posizioni scritte nello script)
  e genera `public/models/volti/`; lo shader lo proietta sul davanti della testa e il resto della pelle prende il colorito della foto.
  Le carte della schermata iniziale e della stanza online mostrano un ritratto dell'avatar 3D, generato dal gioco al caricamento (`makePortraits` in `src/main.js`).
  Per una foto nuova: aggiungi il file, scrivi in `EYES` dove sono gli occhi e rilancia lo script.
  Sopracciglia troppo scure o espressione accigliata (Jason, Zodiac): `SOFT_BROWS` nello script le schiarisce.
- **El Mosquito** ha la maschera (`mask`): il disegno viene dalla foto, ingrandito (`FACE_SCALE` nello script dei volti), con le antenne 3D (`antennae`).
- Capelli `medi` (Guido, con la fascia dorata `headband`): i capelli lunghi tagliati al mento. Ai capelli lunghi si tolgono le ciocche davanti agli occhi.
- Logo: `public/img/logo.png` (bianco su trasparente, ricavato da `tools/logo-bwt.png`), usato su schermate, barra in alto, tappeto, grembiule e maxischermo.
- `lean: true` nel roster: fisico asciutto e poco muscoloso indipendentemente dal peso (Zodiac).
- Liam Rangoni porta sempre il cappello da cowboy (`hat` nel roster).
- Arbitro e staff hanno un fisico normale (`slim`): arbitro con camicia a righe, colletto e pantaloni lunghi; staff in giacca e cravatta.
  Il completo ha una giacca 3D rigida e squadrata (`jacketMesh`, agganciata alla schiena) con risvolti in raso; maniche e pantaloni larghi
  sono un secondo strato del corpo sullo stesso scheletro; scarpe nere.
- Leonardo Bulgari Jr: fascia nera sul braccio (`armband`). La sua foto (`leonardo.png`) è di tre quarti: lo script dei volti ricostruisce
  un viso frontale specchiando la metà visibile (`MIRROR`), corregge le luci colorate (`COLOR_FIX`), schiarisce l'ombra sul mento (`SOFT_CHIN`)
  e sfuma la fronte sotto i capelli (`TOP_FADE`).
- Abbigliamento disponibile: slip o pantaloncini, calzamaglia (con arcobaleno o fiamme), canotta, body da lotta, completo con cravatta,
  stivali, ginocchiere, polsini, barba, cappellino, occhiali, maschera. Gli accappatoi e le giacche d'ingresso (Dozer, Zodiac, Nico) non ci sono ancora.

## Personaggi 3D
In `public/models/quaternius/` (~5 MB), **CC0** di [Quaternius](https://quaternius.com): *Universal Base Characters* e
*Universal Animation Library* (fermo, corsa, scatto, guardia). Per rigenerarli: `tools/build-assets.py` e `tools/build-anims.mjs`.
Animazioni **Mixamo** (guardia, camminata, corsa, pugno, calcio, colpo subito, caduta, rialzata, esultanza): convertite da
`tools/build-mixamo.mjs` in `public/models/mixamo/mixamo.json`; dove mancano il gioco usa le pose fatte a mano. Vedi `public/models/mixamo/LEGGIMI.md`.

## Struttura
| File | Contenuto |
|---|---|
| `src/data/roster.js` | Lottatori, arbitro e staff: misure, colori, abbigliamento |
| `src/game/wrestlerModel.js` | Caricamento dei modelli, shader dell'abbigliamento, pose delle ossa sopra le animazioni |
| `src/game/wrestler.js` | Stati del lottatore e relative pose (pugno, calcio, presa, a terra, schienamento…) |
| `src/game/match.js` | Regole (1 contro 1 e 2 contro 2): colpi, prese, proiezioni, irish whip, uscite dal ring, schienamento, count-out, arbitro, staff |
| `src/game/props.js` | Sedie e tavoli: prenderli, spaccarli, rottami |
| `src/game/ai.js` | Lottatori controllati dal computer (avversari e compagni) |
| `src/game/arena.js` | Ring BWT, corde che vibrano, fari con fasci di luce, LED, rampa, maxischermo, pubblico con flash |
| `src/game/graphics.js` | Post-processing (bagliore, vignettatura) e riflessi d'ambiente |
| `src/ui/hud.js` · `src/audio/sfx.js` · `src/input/controls.js` | Barre e scritte · suoni sintetizzati · tastiera, joystick e pulsanti touch |
| `src/net/net.js` · `src/net/sync.js` | Client delle stanze (con rientro automatico) · stato dell'incontro inviato dall'host all'ospite |
| `server/server.js` · `server/rooms.js` | Server di produzione (file compressi al volo) · stanze multiplayer, usate anche da `npm run dev` |

## Prossimi passi possibili
Ingresso dei lottatori dalla rampa con accappatoio/giacca, finisher personali per ogni lottatore,
mosse dall'angolo (paletto), tag team classico (cambio sull'angolo), due giocatori sulla stessa tastiera, 2 contro 2 online con 4 persone, spettatori nelle stanze online,
musiche d'ingresso, foto più grandi e frontali per volti più nitidi.
