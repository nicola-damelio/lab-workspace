# FASE 0 — Rapporto dell'indagine (15/10/2026)

Consegna della **Fase 0**: cosa succede davvero su Google Drive quando si
rinomina o si elimina, con le prove. Ogni affermazione è marcata:

* **[eseguito]** — l'ho fatto girare: il codice VERO dell'app, su un Drive finto,
  con due PC. Comando indicato.
* **[letto]** — verificato nel codice, con file:riga. Non eseguito.
* **[non dimostrabile qui]** — dipende dal browser o dal Drive reale.

Nessuna riga dell'app (`src/`) è stata toccata. Prova:
`git diff --stat pre-sync-hardening-2026-10-15 -- src/` → vuoto.

---

## 1. Gli strumenti consegnati (e come si eseguono)

| File | Cosa fa | Comando |
|---|---|---|
| `_harness/fake-drive.mjs` | Finto Drive in memoria: `files.list` (con `pageSize`/`nextPageToken`), create (metadati e multipart), update (nome, `trashed`, `addParents`, `appProperties`), trash, **`generateIds`**, nomi doppi ammessi, **ritardo di coerenza** sulle ricerche, errori 401/403/429/5xx e latenza **con seed**, panne di rete vere (`fetch` che rifiuta), **DELETE definitiva contata** | `node _drive_sync_repro_test.mjs` |
| `_harness/two-pc.mjs` | Due posti (PC A / PC B) con magazzini locali separati, jeton distinti (scadibili) e la **replica letterale dell'autosave** di `App.jsx:4071-4239` (minutore 1,5 s, `pagehide`, flush) | idem |
| `_harness/real-upload-hook.mjs` | Carica `src/utils/driveUpload.js` **VERO** (il crochet dei test esistenti lo sostituisce con un bouchon; questo no) | — |
| `_drive_sync_repro_test.mjs` | **Le 8 domande** + lo scenario minimo «R». `--strict` = exit 1 se qualcosa non torna | `node _drive_sync_repro_test.mjs [--strict]` |
| `_drive_two_pc_random_test.mjs` | Scenari casuali **con seed** su 2 PC e **matrice fattore → sintomo** | `node _drive_two_pc_random_test.mjs [--seeds=200] [--factor=lag-1s] [--strict]` |
| `scripts/drive-audit-live.mjs` | Audit in **sola lettura** sul Drive reale (7 controlli). **Piano di default**: non tocca la rete finché non aggiungi `--go` | `node scripts/drive-audit-live.mjs --dataset="NOME ESATTO" [--go]` |
| `_harness/README.md` | Cosa è fedele nel finto Drive e **cosa non lo è** | — |

L'audit sta in `scripts/` di proposito: `_run_all.cjs` raccoglie solo i `_*.mjs`
della RADICE, quindi **la suite non toccherà mai il tuo Drive**. Un garde-fou
dentro il file stesso lo rifiuta se qualcuno ci aggiunge una scrittura (non-GET
verso l'API, `uploadType`, `trashed=true`).

---

## 2. Le otto domande — risposte

**① Due esperienze con lo stesso nome sono una sola?** **SÌ.** [eseguito] Due
esperienze (`t1`, `t2`) con `name: 'Test 1'` → **una** cartella `Test_1` e **un
solo** `Test_1.json`: il secondo ha sovrascritto il primo. `Test N` viene da
`tests.length + 1` (`App.jsx:1142-1145`, chiamato da `testsModule.jsx:259` e
`projectDetailModule.jsx:1816`): dopo una cancellazione il numero si ripete —
riprodotto: 2 esperienze «Test 3» → 1 cartella. E **cancellarne una cancella
l'altra**: il gesto conosce solo il nome e porta via il dossier comune.

**② Dove vivono la lista progetti e il legame esperienza→progetto?** [eseguito]
Il legame è un **percorso** su Drive più `projectNames` sull'esperienza
(`driveStructure.experimentCtxOf:493-505`); la lista progetti viaggia **dentro
la copia del dataset** (`_workspace/datasets/ds_<id>.json`): un secondo posto la
rilegge per identificativo. [letto] La lista viva dell'interfaccia viene invece
dal magazzino del poste, fusa nella carica al salvataggio (`App.jsx:4100`).

**③ All'apertura cosa legge, in che ordine, e come fonde?** [eseguito] La copia
`ds_<id>.json` si rilegge per identificativo da un altro poste; l'**indice**
dell'area (`state.json`) si **fonde per identificativo** (`mergeWorkspaceStates`,
`workspaceDrive.js:182-206`: il più recente `updatedAt` descrive). Non è quindi
l'indice a essere sostituito: è il **contenuto** (④).

**④ `writeDatasetCopy` rilegge e fonde prima di sovrascrivere?** **NO.**
[eseguito] `workspaceDrive.js:421-442` scrive la carica così com'è; PC A scrive,
poi PC B scrive → **il lavoro di A è sparito**, senza un avviso. Con 5 s di
ritardo di coerenza nascono **due gemelli** dello stesso file, e la rilettura può
tornare alla versione **vecchia**.

**⑤ Quali errori vengono inghiottiti, quali ritentati?** [eseguito] Ritenta solo
**la panne di rete** (una volta, con jeton fresco — `driveUpload.js:272-278`) e
il **401** (rinnovo silenzioso + replay, `287-306`: misurato, il dossier viene
creato). 403/429/5xx **non** vengono ritentati: sollevano, e chi ha un
`.catch(() => {})` li inghiotte. Conteggio nella fonte: `driveUpload.js` 6 ·
`activeTestModule.jsx` 11 · `testsModule.jsx` 3. 401 irrecuperabile (server
jetons spento): avviso `Drive access expired` che l'app **non mostra**.

**⑥ Il nome entra nel modello a ogni tasto? L'autosave pubblica un nome
parziale?** **SÌ a entrambe.** [eseguito] Pubblicando «Exp» → «Exp 1» → «Exp 10»
(lo stesso oggetto, tre stati) restano **più cartelle d'esperienza vive** per un
solo oggetto, e il gesto di conferma (`renameDriveFilesFor`) non le riprende.
[letto] Le scritture del nome a ogni battuta sono elencate dal test (16 punti,
es. `projectDetailModule.jsx:3502`); il ritardo è `setTimeout(runSave, 1500)`
(`App.jsx:4199`) e la chiusura non lo aspetta (`App.jsx:4200-4220`).

**⑦ ricerche con `trashed=false`, paginazione, gemello canonico, adozione?**
[eseguito] Nessuna ricerca per nome senza `trashed=false` (il finto Drive le
conta a ogni esecuzione: zero). Paginazione intera (1 200 figli, 2 pagine).
Gemello canonico **deterministico** (indipendente dall'ordine d'arrivo,
`datasetDirTwins.pickCanonicalFolder`). Cartella nel cestino: nella STESSA
sessione la pubblicazione **fallisce** sopra di essa («The target folder is
gone») e l'esperienza sparisce dal Drive; in una **sessione nuova** il dossier
torna vivo con lo **stesso identificativo**.

**⑧ Perimetro, account, Drive condivisi, >8 MB, flush su `pagehide`?** [eseguito]
Perimetro `drive.file` (+ `gmail.send`), un solo account; i Drive condivisi non
sono aperti (`supportsAllDrives` assente). Oltre **8 MB**
(`MAX_DATASET_COPY_BYTES`, `workspaceDrive.js:416`) la copia NON si scrive e
**solo un avviso di console** lo dice: niente di persistente a schermo.
`pagehide`: **[non dimostrabile qui]** è il browser a scatenarlo; ho provato che
la funzione che esso chiama (`flushPendingSave → runSave(true) → pubblicazione +
copia`) scrive davvero.

---

## 3. Ipotesi della diagnosi → verdetto

| Ipotesi | Verdetto | Come |
|---|---|---|
| **D1** L'esperienza non ha identità: è l'insieme delle righe `tests` con lo stesso nome; il progetto è referenziato per nome e il legame sta in due posti; `Test N` usa `tests.length+1`; cancellare toglie tutte le righe con lo stesso nome | **CONFERMATA** | [eseguito] ① (nome doppio = una sola cartella, un solo JSON; cancellazione per nome = entrambe perse); [letto] `App.jsx:1142-1145` + chiamanti |
| **D2** Due scrittori non coordinati: gesto immediato best-effort e autosave che ricrea ciò che non trova; l'autosave può pubblicare nomi scritti a metà | **CONFERMATA** | [eseguito] ⑥ (tre stati dello stesso oggetto → più cartelle); ⑥-bis il gesto di conferma non ripara; [letto] `.catch(() => {})` = 6+11+3 punti |
| **D3** Drive ammette nomi doppi, la create non è idempotente, la ricerca non vede subito, i lock valgono solo dentro una scheda | **CONFERMATA e QUANTIFICATA** | [eseguito] matrice: con ritardo di coerenza 1 s o 10 s → **20/20 seed hanno cartelle gemelle** (0/20 nel controllo senza ritardo); `generateIds` esiste nell'API e non è usato [letto] |
| **D4** Troppe fonti di verità e "vince l'ultimo" sulla copia intera del dataset (1,5 s + 8 s, flush su `pagehide`, oltre 8 MB saltata) | **CONFERMATA** | [eseguito] ④ (sovrascrittura in blocco, gemelli nella finestra di coerenza, "perdus" 19-20/20 seed); ⑧ (>8 MB: solo console) |
| Ipotesi implicita: "basta rinominare il dossier" | **SMENTITA** | [eseguito] sezione **R**: rinominando per sola pubblicazione nasce una cartella **VUOTA** al nome nuovo, la vecchia resta con tutti i file (compreso il JSON del nuovo stato), e lo **spostamento non produce nulla** |

### Nuovi difetti trovati (non erano nella diagnosi)

**N1 — rinominare duplica, spostare non fa nulla (il difetto centrale).**
[eseguito] Sezione «R»: quattro gesti, nessun caso, nessun secondo PC:
`Proj/Alpha/` (con `Alpha.json`, `Beta.json`, `i1/`, `Data.html`) **resta**, nasce
`Proj/Beta/` **vuota**, e il dossier del nuovo stato viene scritto **dentro la
vecchia**. Dopo uno spostamento verso un altro progetto: **niente** (nessun
dossier creato né spostato). Una sessione nuova **non** ripara: il dossier vuoto
viene ripreso e il vecchio resta. È esattamente «cartelle doppie» + «esperimenti
che spariscono».

**N2 — copia del dataset: un solo file, l'ultimo vince.** [eseguito] ④. E il
numero di esperienze "perdute" (create e mai cancellate, assenti dalla copia) è
19-20 su 20 seed **in ogni configurazione**.

**N3 — cestino: nella stessa sessione la pubblicazione fallisce sopra il dossier
cestinato** («The target folder is gone»): l'esperienza resta fuori dal Drive
finché l'app non viene ricaricata. [eseguito] ⑦.

**N4 — oltre 8 MB la copia non parte e lo dice solo la console.** [eseguito] ⑧.

**N5 — «i due PC hanno gli stessi esperimenti» è sistematicamente falso.**
[eseguito] matrice: con due PC, la divergenza fra i due schermi è 19-20 su 20.

---

## 4. La matrice fattore → sintomo (20 seed per fattore, 15 s)

Comando: `node _drive_two_pc_random_test.mjs --seeds=20`

> ⚠ **Questa tabella è stata RIFATTA il 16/10/2026**, dopo aver corretto un difetto
> del **finto** Drive (vedi §8.0): il suo lettore di query perdeva tutte le clausole
> dopo la prima, quindi `name='x' and '<dossier>' in parents` **ignorava il
> dossier** e l'adozione per identità leggeva il `_meta.json` di un altro dossier.
> I numeri qui sotto sono quelli corretti; le differenze rispetto alla prima
> versione sono nell'elenco che segue la tabella.

| fattore | gemelle | assenti | fuori piano | perdute | copia illeggibile | perse in locale | divergenza 2 PC | resto di rinomina | non idempotente | scenari sporchi |
|---|---|---|---|---|---|---|---|---|---|---|
| **controllo** (1 PC, nessun ritardo, nessun errore) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **0/20** |
| **controllo 2 PC** (idem, due posti) | 0 | 0 | 15 | 18 | 0 | 0 | **19** | 0 | 0 | 19/20 |
| **ritardo di coerenza 1 s** | **20** | 0 | 15 | 0 | 20 | 0 | 19 | 0 | **19** | 20/20 |
| **ritardo di coerenza 10 s** | **20** | 0 | 15 | 0 | 20 | 0 | 19 | 0 | **19** | 20/20 |
| **errori Drive 1 su 5** | 0 | **17** | 13 | 5 | 15 | 0 | 19 | 0 | 17 | 19/20 |
| **scheda chiusa a metà** | 0 | 0 | 16 | 18 | 0 | 0 | **20** | 0 | 0 | 20/20 |
| **rinomine lente** (modello solo) | 1 | 0 | 17 | 11 | 7 | 0 | 18 | 0 | 3 | 19/20 |
| **rinomine lente + uscita dal campo** (il gesto vero) | 2 | 2 | 17 | 17 | 1 | 0 | 18 | 0 | 3 | 19/20 |
| **scheda chiusa PRIMA dell'autosave** (attese reali) | 0 | 20 | 0 | 0 | 20 | **20** | 0 | 0 | 20 | 20/20 |
| **A ha modifiche non inviate, B salva** | 0 | 0 | 16 | **20** | 0 | 0 | **20** | 0 | 0 | 20/20 |

Lettura (dopo la correzione):

* **il controllo è PULITO (0/20)**: il percorso di pubblicazione *da solo*, con un
  solo poste e senza ritardi, **non** crea più nulla. La conclusione precedente
  («il controllo è già sporco, quindi il difetto è nel percorso di pubblicazione»)
  **non vale più**: era un artefatto del finto Drive.
* **il ritardo di coerenza** è ciò che rende i **gemelli sistematici** (0 → 20/20):
  è la causa misurata dei doppioni, non il rinominare in sé.
* **due postazioni** rendono certa la **divergenza fra i due schermi** (19–20/20) e
  la **perdita di esperienze dalla copia** (18–20/20 quando la copia è leggibile):
  è il «vince l'ultimo» della copia (§N2), non una corsa sul nome.
* **il gesto vero di rinomina** (uscita dal campo, `activeTestModule.jsx:545-591`)
  **non migliora nulla**: gemelle 2/20 invece di 1/20, assenti 2/20 invece di 0.
  Quindi NON è «il gesto che mancava al harnais» a spiegare il Drive reale (§8.2).
* **la scheda chiusa prima dell'autosave perde l'esperienza ANCHE nel magazzino
  locale: 20/20** (§8.4).
* **A con modifiche non inviate mentre B salva**: 20/20 di esperienze assenti dalla
  copia e 20/20 di divergenza fra i due schermi (§8.4).
* la colonna **«copia illeggibile»** è nuova e dice quando la misura «perdute» non è
  stata fatta (col ritardo di coerenza la ricerca del file appena scritto non lo
  vede ancora: la lettura va dichiarata, non contata come perdita).

---

## 5. Cosa NON è dimostrabile qui (e chi lo prova)

1. **`pagehide` reale**: è il browser a scatenarlo. Qui ho provato la funzione che
   esso chiama. → da provare a mano (chiudi la scheda subito dopo una modifica e
   guarda il Drive).
2. **I tempi veri di Google** (ritardo di propagazione, 429 reali): il finto Drive
   usa un orologio virtuale. Le soglie scelte (0 / 1 s / 10 s) sono scenari, non
   misure del tuo Drive.
3. **La dimensione reale dei tuoi `ds_<id>.json`** e **i gemelli che hai già**:
   li legge l'audit `scripts/drive-audit-live.mjs`, che NON ho eseguito: aspetta il
   tuo OK (`--go`).
4. **Definizione di «due dossiers gemelli» su Drive reale**: qui è "stesso
   genitore + stesso nome", che è la definizione richiesta.

---

## 6. Piano delle fasi successive (ricalibrato su ciò che ho trovato)

L'ordine cambia rispetto alla diagnosi iniziale, perché **N1** (rinominare
duplica) è più grave di quanto previsto ed è nel percorso di **ogni**
salvataggio, mentre D4 (merge fra posti) si vede meno spesso.

**FASE 1 — protezioni immediate (basso rischio).** Ordine **A → G** (richiesto il
16/10/2026). **A–F invariati**; **G** è NUOVO, in fondo, e si implementa **solo se
il punto 4 dimostra una perdita di dati** (dimostrata: §8.4, 20/20 seed).

* **A.** **`publishDatasetStructure` non deve creare un dossier quando un oggetto
  equivalente esiste già** sotto un altro nome: o adotta-rinomina per
  identificativo (`extra.id`, come già fa `pickRenamedSibling`), o **non fa
  nulla** su un oggetto che non riconosce — mai un secondo dossier. È il punto
  che ferma «cartelle doppie» e «esperimenti che spariscono».
  *Precisazione del 16/10/2026 (§8.2):* l'identità è scritta **solo sull'ultimo
  livello** del piano (`driveStructure.js:643-646`), quindi **un'esperienza con
  istanza o sezione NON ha identità**: A deve scriverla sul dossier
  dell'esperienza (o su ogni livello), altrimenti l'adozione non può funzionare
  per la forma più comune.
* **B.** Nome di default del nuovo esperimento = primo `Test N` **libero**; rifiuto
  (o suffisso) di un nome già usato nello stesso progetto; slug unico nel genitore.
* **C.** Cancellazione: conferma che elenca **cosa** sparisce (mai per solo nome).
* **D.** Il nome entra nel modello **alla conferma** (blur/Invio), non a ogni tasto.
* **E.** **Stato di sincronizzazione sempre visibile**: «N modifiche da inviare» e
  **avviso alla chiusura solo se ci sono operazioni in sospeso** (nel frattempo è
  questo che basta, come richiesto); banner persistente oltre 8 MB oltre 8 MB
  (oggi solo un `console.warn`, §Q8) e **nessun `.catch(() => {})`** sulle
  operazioni Drive (log + messaggio). *Precisazione:* la copia reale pesa qualche
  kB (§8.1), quindi il banner oltre 8 MB è una rete di sicurezza teorica, non il
  punto urgente.
* **F.** `--strict` diventa il default dei due test nuovi.
  *Riferimenti:* sezione «R» e ①④⑥ di `_drive_sync_repro_test.mjs`.
* **G.** **Persistenza delle modifiche non ancora inviate** — *solo se il punto 4
  dimostra una perdita*, e la dimostra (§8.4: scheda chiusa durante le attese →
  perdita **anche locale**, 20/20 seed). Quindi: flag «da pubblicare» + scrittura
  del magazzino locale **prima** delle attese di `runSave` (o scrittura sincrona su
  `pagehide`), coda persistente (IndexedDB), `keepalive` sulle POST di chiusura.
  *Prova:* fattore `chiusura-precoce` di `_drive_two_pc_random_test.mjs`.

**FASE 2 — identità stabili e un solo riconciliatore.** Come da tua traccia:
`experimentId` e `projectId` stabili, `appProperties {portalId, kind, datasetId}`
su ogni cartella/file, `driveFolderId` nel modello, create idempotente con
`files.generateIds` (l'API c'è, [letto]), coda persistente su IndexedDB,
tombstone con data/autore, l'albero come vista a senso unico.
*Aggiunta dalla Fase 0:* il riconciliatore deve saper **rinominare per
identificativo** e **spostare** (oggi non accade: N1), e la ricerca per
identificativo deve precedere quella per nome.

**FASE 3 — sincronizzazione fra PC.** Unità = entità (un file per esperimento /
istanza) invece del blob intero (N2), `updatedAt`/`rev`/`deviceId`, merge per
identificativo, copia di conflitto `*_conflitto_<pc>_<data>`, verifica della
versione remota prima di scrivere. Il "vince l'ultimo" sparisce.

**FASE 4 — riparazione dei dati esistenti + chiusura.** Piano in dry-run
(gemelli, cartelle fuori piano, `_<vecchio nome>.json`, tombe con cartella
ancora viva) → approvazione → esecuzione con soli spostamenti e cestino;
`docs/SYNC.md`; paragrafo finale sul backend.

### Comandi di verifica (Fase 0 e successive)

```bash
node _drive_sync_repro_test.mjs            # 8 domande + scenario R (baseline)
node _drive_sync_repro_test.mjs --strict   # exit 1 se un difetto resta
node _drive_two_pc_random_test.mjs --seeds=200
node scripts/drive-audit-live.mjs --dataset="NOME"        # piano, nessuna rete
node scripts/drive-audit-live.mjs --dataset="NOME" --go   # sola lettura
node _run_all.cjs                          # la suite intera resta verde
npx vite build                             # nessuna riga di src/ toccata ⇒ identico
```

---

## 7. Cosa ho cambiato (e cosa no)

* **Aggiunto**: `_harness/` (fake-drive, two-pc, hook, README),
  `_drive_sync_repro_test.mjs`, `_drive_two_pc_random_test.mjs`,
  `scripts/drive-audit-live.mjs`, questo documento.
* **Non toccato**: nessuna riga di `src/`. Niente backend. Nessuna dipendenza
  nuova. Il Drive reale non è stato interrogato.
* **Su tua richiesta (punto 5)**: i file temporanei della ricognizione sono stati
  eliminati solo dopo averli verificati **non tracciati** (`git ls-files`), senza
  glob larghi. `_z_tok.txt` è sparito; l'audit non stampa alcuna credenziale.
* **16/10/2026 — corretto un difetto del FINTO Drive** (`_harness/fake-drive.mjs`,
  `splitClauses`: `String(...)` rendeva l'indice una stringa e la scansione si
  fermava alla prima clausola) e rimisurato tutto; aggiunti i fattori
  `renommage-champ`, `chiusura-precoce`, `a-non-inviato-b-salva` e, nella réplica
  dell'autosave, il **magazzino locale** (App.jsx:4177-4185) con la finestra
  d'attesa prima dell'eccezione (`hooksBeforeWrite` / `killDuringSave` /
  `reopenSession`). Sempre **nessuna riga di `src/` toccata**. Vedi §8.

---

## 8. Prove manuali sul Drive reale (16/10/2026) — risposte

### 8.0 Prima di tutto: un difetto del **finto** Drive (e cosa invalida)

Il lettore delle query del finto Drive (`_harness/fake-drive.mjs`, funzione
`splitClauses`) faceva `i += String(lunghezza - 1)`: `i` diventava la **stringa**
`"174"` e la scansione si fermava lì. **Tutte le clausole dopo la prima erano
perse**: `name='_meta.json' and '<dossier>' in parents and trashed=false` veniva
letto come *solo* `name='_meta.json'` ⇒ la ricerca **ignorava il dossier** e
rendeva «il primo del nome» **ovunque sul Drive**.

Conseguenza diretta: `readMeta`/`findFolder` (driveStructure.js:920-934, 1263,
1266) leggevano il `_meta.json` di un **altro** dossier ⇒ l'adozione per identità
(`pickRenamedSibling`, 878-885) poteva adottare o mancare l'oggetto sbagliato.
Corretto il 16/10/2026 (una riga, senza `String(...)`); le prove che seguono sono
**rifatte** con il finto Drive corretto. Cosa cambia, in breve:

| prova | prima (finto Drive rotto) | dopo la correzione |
|---|---|---|
| run di **controllo** (1 poste, nessun ritardo) | 20/20 scenari sporchi | **0/20 — pulito** |
| scenario «R» (rinomina) | nuovo dossier **VUOTO**, JSON del nuovo stato **nell'anziano** | nuovo dossier **con i suoi file**; l'anziano resta (duplicato) |
| spostamento d'esperienza (R) | «non produce nulla» | **funziona** (`projects/Autre/Beta` esiste) |
| cassetto sulla stessa sessione (Q7, ①) | `_meta` condivisi, esiti falsati | letto il `_meta.json` giusto |

La conclusione «il difetto è nel percorso di pubblicazione» **non regge più**: con
un poste e senza ritardi la pubblicazione non produce difetti. Restano veri (e
rimisurati, §4): **ritardo di coerenza → gemelle 20/20**, **due postazioni →
divergenza 19–20/20 e copia che perde 18–20/20**, **rinomina → doppioni per gli
oggetti senza identità nel piano** (§8.2).

### 8.1 (punto 1) La copia pesa qualche kB — e cosa contiene

* La copia è **un solo file per dataset**, scritta **in blocco**: `writeDatasetCopy`
  (`workspaceDrive.js:421-442`) non rilegge né fonde; oltre
  `MAX_DATASET_COPY_BYTES = 8 MB` (`workspaceDrive.js:416`) **non scrive** e lo dice
  **solo** nella console. Con qualche kB di copia reale, la soglia degli 8 MB è
  **teorica**: non è il punto urgente della FASE 1 (E resta, come rete).
* **Contiene il nome dell'esperimento creato in fretta?** SÌ, **se** un
  salvataggio è arrivato in fondo: la copia porta `updatedPayload.payload =
  JSON.stringify(rawData)` con `rawData = { ...latestDataRef.current,
  ...cloudProjectsPayload() }` (`App.jsx:4100-4128`), cioè **il modello del
  momento**. Quindi: nome nella copia ⇒ il salvataggio è stato completato dopo la
  creazione; nome assente ⇒ o il salvataggio non è mai partito (vedi §8.4) o la
  copia è stata **sovrascritta da un altro poste** (N2, §4).

### 8.2 (punto 2) Rinomina lenta: perché sul Drive reale NON resta «Prov» — **punto declassato**

**Declassato a «non confermato»** come richiesto. Ecco il perché misurato, che è
più preciso della spiegazione «mancava il gesto di uscita dal campo»:

1. **Il gesto c'è già nel harnais** (Q6): l'app scrive il nome nel modello a ogni
   battuta (16 punti, es. `definitionsManagers.jsx:104,216,964,972`,
   `projectDetailModule.jsx:3502`) e l'autosave pubblica quel che il modello porta.
   Misurato: tre nomi parziali (`Exp`, `Exp 1`, `Exp 10`) ⇒ **tre dossier** per un
   solo oggetto, e il gesto di conferma (`renameDriveFilesFor`, `onBlur` di
   `activeTestModule.jsx:545-591`, `projectDetailModule.jsx:4613-4622`) **non li
   riprende**. Aggiunto come fattore `renommage-champ`: **non migliora** (gemelle
   2/20 contro 1/20).
2. **L'identità è scritta SOLO sull'ULTIMO livello del piano.** In
   `driveStructure.js:639-648`, `addLevels(levels, extra)` mette `extra` (quindi
   `extra.id`) **solo** su `isLast ? extra : null`. Provato (§8.0, sonda):
   `projects/Proj/Alpha` (esperienza **con istanza `i1` + sezione `data`)` →
   `extraId = —` (nessuna identità!), mentre `projects/Proj/Alpha/i1` → `extraId =
   e1` (l'id dell'**esperienza**, scritto sul dossier dell'**istanza**) e
   `projects/Proj/Gamma` (**senza istanza né sezione**) → `extraId = e2`.
3. Quindi **due comportamenti diversi**, tutti e due riprodotti:
   * oggetto **senza** istanza/sezione (o **progetto**, `driveStructure.js:662`):
     il dossier porta l'identità ⇒ alla rinomina viene **adottato e rinominato in
     place** ⇒ **non resta nulla** dell'oggetto parziale (misurato: `Gamma → Delta`,
     un solo dossier);
   * esperienza **con** istanza o sezione (la forma più comune): nessuna identità ⇒
     **un dossier nuovo a ogni nome pubblicato** (misurato: `Alpha`+`Beta`, e Q6
     `Exp`+`Exp_1`+`Exp_10`).

**Conclusione**: la tua prova manuale (nessun «Prov» rimasto) è compatibile con il
caso 1 (oggetto che porta l'identità), non con il caso 2. Il difetto «un nome
parziale lascia un dossier» **resta aperto** per il caso 2 e va riprovato su
un'esperienza **con istanza o sezione** prima di dichiararlo risolto. La causa
meccanica è nella riga 645 (`isLast ? extra : null`), ed è la precisazione del
punto **A** della FASE 1.

### 8.3 (punto 3) Gli esperimenti comparsi «dopo un po'»: cosa li completa e con che ritardo

Misure e letture, in ordine di certezza:

1. **Il percorso che scrive è uno solo**: `runSave` (`App.jsx:4083-4197`) è chiamato
   dal **minutore di 1,5 s** (`App.jsx:4199`) e, alla chiusura della scheda, da
   `flushPendingSave` (`App.jsx:4205-4216`) che è agganciato a
   `pagehide` e a `visibilitychange` (`App.jsx:4220-4221`): dentro ci sono la
   pubblicazione dell'albero (`4147`), la copia del dataset (`4134`, che ha un
   **proprio ritardo di ~8 s**, `App.jsx:5420-5429`, e un proprio flush a
   `5436-5447`) e la scrittura del **magazzino locale** (`4185`).
2. **Nel `runSave` ci sono DUE attese PRIMA di qualunque scrittura**:
   `guardDistantExperiments` (`4110` — una **lettura di rete** su Firestore) e
   `compressDatasetForSave` (`4116` — compressione fuori dal filo principale,
   0,9 s per 6 MB). Quindi la chiusura non «ripulisce» in modo sincrono.
3. **Non c'è nessun `keepalive` in tutto `src/`** (grep: **0 occorrenze**): le
   richieste partite non sono protette dalla morte della pagina. Il browser è
   libero di interromperle.
4. **Ritardi possibili** (limiti, non statistiche del tuo Drive): pubblicazione
   **≥ 1,5 s** dopo l'ultima modifica (minutore) **+** la lettura condivisa **+** la
   compressione **+** il tempo delle N richieste della pubblicazione; copia
   **≤ ~8 s** dall'ultima modifica (più il suo flush alla chiusura).

Perciò «sono comparsi dopo» può avere **tre cause distinte**, e il tuo dubbio
(«portale riaperto nel frattempo ?») è esattamente la variabile da sciogliere:

* **richieste già partite** che il browser ha lasciato finire (possibile, non
  garantito: punto 3);
* **una nuova sessione** che risalva: la pubblicazione esiste **solo** dentro
  `runSave` (unico chiamante: `App.jsx:4147`), quindi nulla «ripara» all'apertura
  se nessuna modifica avviene; ma l'apertura di un dataset può riportare in stato
  comunque una modifica (fusione/guardie) e far ripartire il minutore;
* **solo l'interfaccia di Drive** che si aggiorna in ritardo (non misurabile da
  qui).

### 8.4 (punto 4) Il caso peggiore: scheda chiusa entro 1,5 s — **perdita dimostrata**

* **Dove viene scritto lo store locale**: **solo dentro `runSave`**, alla riga
  `App.jsx:4185` (`localStorage.setItem(LOCAL_STORAGE_KEY, …)`, con
  `LOCAL_STORAGE_KEY = 'lab_datasets_local_v2'`, `src/data/constants.js:13`) e,
  per le basi di amministrazione, in un effetto separato (`4292-4300`). Le altre
  scritture del medesimo store (`5258/5263`, `5370/5378`, `5809/5813`, `5937/5939`,
  `6045/6052`) riguardano **voci** (creazione/rinomina/permessi), non il contenuto.
  ⇒ **Lo store non è scritto «subito»**: è scritto **dopo le due attese** del
  `runSave`.
* **Prova eseguita** (nuovo fattore `chiusura-precoce`, 20 seed): si crea
  un'esperienza, la scheda muore **durante le attese** che precedono la scrittura;
  poi si riapre. Risultato: **20/20 seed** con l'esperienza **assente anche dal
  magazzino locale** (`magazzino locale: []`) e **copia Drive `null`**. Cioè: la
  perdita è **totale**, locale compresa — non solo «non ancora pubblicata».
* **Secondo caso** (fattore `a-non-inviato-b-salva`, 20 seed): A tiene due
  esperienze **non inviate** (minutore annullato), B salva e pubblica la sua copia,
  poi A riparte. Risultato: **20/20** con esperienze **assenti dalla copia** e
  **20/20** con i **due schermi divergenti**. La copia è un file solo, scritto in
  blocco (`workspaceDrive.js:421-442`): **chi scrive per ultimo vince**, senza
  avviso.
* ⇒ **Il punto 4 dimostra una perdita** (dati non inviati persi alla chiusura, e
  sovrascrittura della copia fra poste): la **G** della FASE 1 è giustificata. Nel
  frattempo — come da tua indicazione — basta **E**: stato di sincronizzazione
  visibile («N modifiche da inviare») e avviso alla chiusura **solo** se ci sono
  operazioni in sospeso.

### 8.5 (punto 5) L'audit esteso: ⑦ e ⑧ (sempre in sola lettura)

`scripts/drive-audit-live.mjs` ora, per **ogni** `_workspace/datasets/ds_<id>.json`:

* **⑦** — dimensione reale, **numero di esperimenti**, **numero di progetti**,
  **data più recente portata dalla copia** (`at` del file, `updatedAt` del
  documento, `savedAt`/`date` più recente fra le esperienze), e se la carica è
  **compressa** (`lz-string`, come il documento Firestore). Una copia **illeggibile**
  è **detta** («il contenuto di questa copia non è affermato»), non contata come zero;
* **⑧** — **quante esperienze dell'albero Drive mancano nella copia**: per ogni
  dossier di esperienza si legge il suo `<oggetto>.json` (o quello della prima
  istanza) e si confronta il campo `id` con quelli della copia.
  Le letture sono **plafonate** (`--exp-json=N`, default 40) e il conteggio residuo
  è stampato; il verdetto finale tiene conto anche di questo numero.
* Il file resta **senza scritture** (guardia interna: nessun POST/PATCH/DELETE,
  nessuna query sulla corba) e in `scripts/` (mai eseguito da `_run_all.cjs`).
  Comando: `node scripts/drive-audit-live.mjs --dataset="NOME ESATTO"` (piano) e
  `--go` per la lettura reale — **attende ancora il tuo OK**.

### 8.6 (punto 6) FASE 1 in ordine A–G

Vedi §6: **A–F invariati**, **G** nuovo in fondo (persistenza delle modifiche non
inviate), da fare **solo se il punto 4 dimostra una perdita** — dimostrata (20/20).
Nel frattempo: **stato di sincronizzazione visibile** con «N modifiche da inviare»
e **avviso alla chiusura solo se ci sono operazioni in sospeso** (entrambi dentro
**E**).

