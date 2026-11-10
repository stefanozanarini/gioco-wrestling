# Animazioni da Mixamo (Adobe, gratuito)

Le animazioni scaricate qui sostituiscono le pose fatte a mano del gioco: pugni, calci, cadute, rialzate, esultanze vere,
registrate con motion capture. I lottatori restano quelli attuali (misure, corporatura, costumi), cambia solo come si muovono.

## 1. Account
Accedi a https://www.mixamo.com con un account Adobe (gratuito).
Licenza: utilizzabili gratis nel gioco; non si possono ridistribuire i file grezzi da soli.

## 2. Come scaricare ogni animazione
1. Scheda **Animations**, cerca il termine della tabella e scegli quella che ti piace di più.
2. Se c'è la casella **In Place**, spuntala (il lottatore non deve spostarsi da solo).
3. **Download** → Format `FBX Binary (.fbx)`, Skin **Without Skin**, Frames per second **30**, Keyframe Reduction **none**.
4. Rinomina il file come nella prima colonna e mettilo in questa cartella (`public/models/mixamo/`).

Non serve cambiare personaggio su Mixamo: va bene quello predefinito (Y Bot).

## 3. Elenco
Indispensabili:

| File | Cerca su Mixamo | Uso nel gioco |
|---|---|---|
| `guardia.fbx` | fighting idle / boxing idle | lottatore fermo in guardia |
| `camminata.fbx` | walking (In Place) | camminata |
| `corsa.fbx` | running (In Place) | corsa |
| `pugno.fbx` | punching / cross punch | pugno |
| `calcio.fbx` | kick / mma kick | calcio |
| `colpito.fbx` | hit reaction / head hit | colpo subito |
| `caduta.fbx` | falling back / knocked out | finire a terra |
| `rialzata.fbx` | getting up / stand up | rialzarsi da terra |

Consigliate (se mancano il gioco usa le pose attuali):

| File | Cerca su Mixamo | Uso nel gioco |
|---|---|---|
| `parata.fbx` | block / boxing block | parata |
| `stordito.fbx` | dizzy / stunned | stordito dopo una combo |
| `provocazione.fbx` | taunt | provocare il pubblico |
| `esultanza.fbx` | victory / fist pump | vittoria |
| `pestone.fbx` | stomping | calcio all'avversario a terra |
| `presa.fbx` | grab / reaching | tentativo di presa |
| `a_terra.fbx` | lying / laying idle | steso sul ring |
| `presentatore.fbx` | talking / pointing | Liam Rangoni che annuncia |
| `applauso.fbx` | clapping / cheering | Malpensa che esulta a bordo ring |

## 4. Conversione
Dopo aver aggiunto o cambiato un file, dalla cartella del progetto:
```bash
node tools/build-mixamo.mjs
```
Riadatta le animazioni allo scheletro dei nostri lottatori e le salva in `mixamo.json` (l'unico file usato dal gioco).
I nomi dei file possono essere quelli della tabella o quelli originali di Mixamo ("Fighting Idle.fbx", "Mma Kick.fbx"…).
I file `.fbx` non vengono pubblicati sulla VPS. Le mosse a due (suplex, slam, powerbomb) restano costruite dal gioco.
