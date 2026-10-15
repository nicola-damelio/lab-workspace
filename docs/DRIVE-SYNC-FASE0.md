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

| fattore | gemelle | assenti | fuori piano | esperienze perdute | divergenza 2 PC | non idempotente | scenari sporchi |
|---|---|---|---|---|---|---|---|
| **controllo** (1 PC, nessun ritardo, nessun errore) | 0 | 15 | 0 | 20 | 0 | 0 | 20/20 |
| **controllo 2 PC** (idem, due posti) | 0 | 17 | 15 | 19 | 19 | 0 | 19/20 |
| **ritardo di coerenza 1 s** | **20** | 0 | 15 | 19 | 19 | 19 | 20/20 |
| **ritardo di coerenza 10 s** | **20** | 0 | 15 | 19 | 19 | 19 | 20/20 |
| **errori Drive 1 su 5** | 1 | 18 | 11 | 19 | 19 | 15 | 19/20 |
| **scheda chiusa a metà** | 0 | 17 | 16 | 20 | 20 | 0 | 20/20 |
| **rinomine lente** | 1 | 15 | 17 | 19 | 19 | 3 | 19/20 |

Lettura: **il solo controllo è già sporco** (assenti/perduti) — quindi non è una
corsa fra posti, è il **percorso di pubblicazione** (N1). Il **ritardo di
coerenza** è ciò che rende i **gemelli sistematici** (0 → 20/20). Gli errori
peggiorano gli "assenti". La scheda chiusa a metà e le due postazioni rendono la
divergenza fra i due schermi **certa**.

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

**FASE 1 — protezioni immediate (basso rischio).** Prima di tutto il *fermo* su
N1, perché è quello che crea i doppioni:
1. **`publishDatasetStructure` non deve creare un dossier quando un oggetto
   equivalente esiste già** sotto un altro nome: o adotta-rinomina per
   identificativo (`extra.id`, come già fa `pickRenamedSibling`), o **non fa
   nulla** su un oggetto che non riconosce — mai un secondo dossier. È il punto
   che ferma «cartelle doppie» e «esperimenti che spariscono».
2. Nome di default del nuovo esperimento = primo `Test N` **libero**; rifiuto (o
   suffisso) di un nome già usato nello stesso progetto; slug unico nel genitore.
3. Cancellazione: conferma che elenca **cosa** sparisce (mai per solo nome).
4. Il nome entra nel modello **alla conferma** (blur/Invio), non a ogni tasto.
5. Stato di sincronizzazione sempre visibile + banner persistente oltre 8 MB;
   nessun `.catch(() => {})` sulle operazioni Drive (log + messaggio).
6. Prima di tutto: `--strict` diventa il default dei due test nuovi.
   *Riferimenti:* sezione «R» e ①④⑥ di `_drive_sync_repro_test.mjs`.

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
