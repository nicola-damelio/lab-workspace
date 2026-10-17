# FASE 1 — Piano di lavoro e risposte ai quesiti (16/10/2026)

Consegna della **Fase 1**: l'audit del Drive **reale** rieseguito con il codice
d'oggi, le risposte ai quesiti 2a–2d, e il piano di lavoro proposto. Ogni
affermazione porta il suo marcatore, come in Fase 0:

* **[eseguito]** — l'ho fatto girare (codice vero, o audit in sola lettura).
* **[letto]** — verificato nel codice, con `file:riga`. Non eseguito.
* **[aperto]** — non ho ancora la prova: lo dico invece di supporlo.

**Nessuna riga di `src/` è stata toccata.** Prova [eseguito]:
`git status --porcelain` non contiene alcun percorso sotto `src/`.

---

## 0. Stato delle prove

| Prova | Comando | Esito |
|---|---|---|
| Audit sul Drive reale, sola lettura | `scripts/drive-audit-live.mjs --dataset="GEC-UPJV-projects" --go` | **[eseguito]** completato: 509 dossier, 2007 file, **603 GET, 0 scritture** |
| Suite completa | `_run_all.cjs` (PID 20808, avviata 11:52:26Z) | **[eseguito]** in corso: 298/447 file, 20 voci BAD (di cui 5 test veri) — vedi §3d |
| Contratto Drive vero ⟷ finto | `_drive_contract_test.mjs` | **[eseguito]** 32/32 identici su BG04 |
| Parser delle query Drive | `_harness_query_parser_test.mjs` | **[eseguito]** tutti ✓ |
| Prova a due posti (banco) | `_drive_two_pc_random_test.mjs` | **[eseguito]** fattori `renommage-*`: 0/20 reste, 1–2/20 jumeaux |
| Renommage a mano (2 posti, gesto reale) | — | **[aperto]** il tuo giro di prova non è ancora arrivato |

L'audit di `_audit_g1.txt` e `_audit_g2.txt` **non è utilizzabile**:
`_audit_g1.txt` è stato prodotto da una versione dell'audit che non leggeva
`name`/`parent` sui dossier (il difetto è annotato oggi in
`scripts/drive-audit-live.mjs:168-173`), e `_audit_g2.txt` è **un altro
dataset** (BG04, 65 dossier). L'autorità è il file appena prodotto.

---

## 1. L'audit — risultato autoritativo

`# AUDIT EN LECTURE SEULE — « GEC-UPJV-projects »`
`509 dossier, 2007 fichier(s) lus, 603 requêtes GET, 0 écriture.`

| # | Controllo | Esito |
|---|---|---|
| ① | Dossier gemelli (stesso padre, stesso nome) | **0** |
| ② | Dossier fuori piano con file | **113** — *falso positivo, vedi §2* |
| ③ | Gemelli sotto `projects/` | **0** |
| ④ | Esperienze senza progetto (direttamente sotto `projects/`) | **0** |
| ⑤ | File `<vecchio nome>.json` senza dossier vivo | **463** — *falso positivo, vedi §2* |
| ⑥ | Progetti in tomba il cui dossier esiste ancora | **0** |
| ⑦ | Copie `_workspace/datasets/ds_<id>.json` | **10+**, la più recente scritta **oggi 12:18:37Z** con **0 esperienze e 0 progetti** |
| ⑧ | Esperienze dell'albero assenti dalla copia | **39** (su 40/364 dossier letti: **plafone**) |
| ⑨ | Un solo oggetto dell'app, **più dossier** sul Drive | **7 oggetti**, da 2 a 5 dossier ciascuno (su 39/448 dossier letti: **plafone**) |

### 1.1 Ciò che è solido

* **①②③④⑥ dicono 0**, e stavolta lo dicono *dopo* la correzione del
  percorso (`walk` che porta `name` e `parent`, `drive-audit-live.mjs:174-192`):
  non ci sono due dossier fratelli con lo stesso nome **oggi**, non c'è
  un'esperienza appesa a `projects/` senza progetto, non c'è un progetto in
  tomba il cui dossier sopravvive.
* **⑨ è il cuore, e non è un sospetto**: 7 identificativi distinti, letti
  **dentro i `<oggetto>.json`** dei dossier, ognuno presente in più dossier.
  È la prova sul Drive reale di ciò che Fase 0 aveva riprodotto sul banco:
  **un oggetto dell'app, più dossier**. Esempi:

```
t17915016474816788 → 4 dossier : projects/cyclinA_H/pdb_CDK2_CyclinA | cyclinA_H/pdb | cyclinA_H/Test_87 | test/pdb-Bid-Bcl-xl
t17915013096201399 → 5 dossier : projects/BadH/pdb_BadH | pdb-BadH-Blc-XL | pdb_Bad_BCL-XL | pdb | Test_86
t1792068510771629  → 3 dossier : projects/BidH/prov | Test_83 | prova
t17915001326217901 → 4 dossier : projects/BidH/pdb | pdb-Bid-Bcl-xl | 4QVE | pdb_Bcl-XL_Bid
t17915023284364463 → 3 dossier : projects/PD1-PDL1/Pd1 | Test_88 | pdb_PD1_PDL1
t17912926671245015 → 3 dossier : projects/synuclein/prov | prova | Test_83
t17914952328471224 → 2 dossier : projects/p53H/pdb_Mdm2_p53 | pdb
```

  * quanto costa, in numero di dossier: **19 dossier per 7 oggetti**
    (4+5+3+4+3+3+2 = 24 posizioni, 7 dei quali sono quelli « giusti » →
    **17 dossier di troppo**).
  * **i nomi lo dicono da soli**: `Test_83`/`Test_86`/`Test_87`/`Test_88`
    (nomi di nascita, `tests.length + 1`, Fase 0 §2①) accanto a `prov`,
    `prova` (battute intermedie) accanto al nome finale — i tre stati del
    *campo del nome* che pubblicano **tre dossier**.
  * ogni oggetto è **ancora leggibile** (il suo `.json` porta il suo `id`):
    quindi **la riparazione è possibile senza inventare niente** (§5-F).

### 1.2 Ciò che va letto con prudenza

* **⑦ la copia di oggi 12:18:37Z non porta niente**: 229 680 ottocetti,
  `charge compressée : oui`, e `expériences : 0 · projets : 0`. Non è una
  copia vuota per caso: la carica è compressa, quindi qualcuno **ha scritto
  una carica**. Le altre copie portano invece 88 esperienze/15 progetti
  (0,92 Mo, oggi 11:06:56Z) o 81 esperienze (0,69 Mo). **[aperto]**: da
  spiegare prima di toccare il salvataggio — è il solo indizio, sul Drive
  reale, che una scrittura possa depositare una carica **senza entità**.
* **⑧ e ⑨ sono parziali per costruzione**: le letture sono plafonate
  (`--exp-json=40`, `--twin-json=40`, `drive-audit-live.mjs:334`); l'audit
  stesso dice « il reste 324 dossier non lus ». Il vero conto di ⑧/⑨ si ha
  solo con `--exp-json=364 --twin-json=448`.
* **①③⑥ = 0 non assolve il passato**: un dossier gemello può essere già
  stato unito a mano, o i suoi file già spostati. La prova del danno è ⑨
  (contenuto, non nome) e i nomi di §1.1.

---

## 2. I due controlli che mentono ancora (② e ⑤) — dimostrazione

Sono **falsi positivi per costruzione**, e lo si vede nel codice d'oggi: non
è l'audit vecchio, è la *domanda* che non corrisponde al piano.

**② — 113 dossier « fuori piano » che sono il piano.**
Il filtro è `folders.filter(f => filesIn(f.id).length > 0 && f.path.length > 4
&& !KNOWN_LEVELS.has(f.path[1]))` (`drive-audit-live.mjs:272`). Per un
percorso canonico `projects/<progetto>/<esperienza>/<istanza>/<sezione>`,
`f.path[1]` è il nome del **progetto**, che non è mai in `KNOWN_LEVELS`
(`projects`, `storage`, `protocols`, `backups`, `publications`,
`general_library_images` — riga 252): **la condizione è vera per ogni sezione
d'istanza**. E i 10 esempi stampati sono esattamente questo
(`.../Test_84/instance1/Experimental_Conditions`,
`.../instance1/Instrumental_Setup`, `.../instance1/Data`). Il piano dichiarato
dall'audit stesso (riga 109: `projects/<projet>/<expérience> puis
<instance>/<section>/<sous-section>`) **contiene** quei dossier.
→ Il conto vero dei dossier fuori piano resta **da fare**; 113 non significa
niente.

**⑤ — 463 « resti di file » che hanno il loro dossier vivo.**
`expFolders` è costruito con `f.path.length >= 4` (riga 285) e
`expNames` con i suoi nomi (riga 309); i file esaminati hanno `path.length >= 5`
(riga 310). Ma il dossier dell'esperienza sta **un livello sopra** il file:
`projects/cyclinA_H/pdb/instance1/pdb.json` (riga 23) — il dossier `pdb`
esiste, è `projects/cyclinA_H/pdb`, **lunghezza 3** → non entra in `expFolders`
→ il suo nome non entra in `expNames` → il file viene dichiarato « orfano »
**mentre il suo dossier è vivo**. Stessa cosa per
`projects/BadH/Test_86/instance1/Test_86.json` e
`projects/BadH/Test_86/2BZW/Test_86.json` (righe 30-31) — il dossier `Test_86`
esiste. **Il controllo confronta i nomi dei file con un insieme costruito alla
profondità sbagliata**: è lo stesso difetto di prima, spostato di un livello
(non più « insieme vuoto », ma « insieme che contiene solo i pronipoti »).
→ Il conto vero dei resti di renommage resta **da fare**; 463 non significa
niente. Il modo giusto, già presente e già sano nell'audit, è quello di ⑨:
**confrontare per `id` letto dentro il `<oggetto>.json`**, non per somiglianza
di nome (`drive-audit-live.mjs:353-364, 430+`).

**Cosa resta vero dei sette controlli**: ①③④⑥ (0), ⑦ (le copie, con
l'anomalia di oggi 12:18), ⑧ (39 esperienze assenti *sui 40 dossier letti*),
⑨ (7 oggetti su 2–5 dossier). Sono questi, e non ②/⑤, i numeri su cui si
può costruire.

---

## 3. Risposte ai quesiti

### 3a — Quale gesto tocca quale percorso

Tabella [letto] (file:riga del codice d'oggi). I nomi di dossier sono **slug**:
`sanitizeSlug(nome)` e, se lo slug è vuoto, il nome d'attesa
(`experiment`, `test`) — `driveNaming.js:26-33`, `:311`, `:297`.

| Gesto dell'app | Percorso Drive | Dove è scritto |
|---|---|---|
| Creazione esperienza | `projects/<progetto>/<slug(exp)>/` + `<slug>.json` + `_meta.json` | `driveNaming.js:362` (`canonicalExperimentPath`), `:311` (`DEFAULT_EXPERIMENT_NAME`) |
| Nome battuto **lettera per lettera** | pubblicazione della struttura a ogni battuta (`setTimeout(runSave, 1500)`) | `App.jsx:4071-4199` (il timer è rimesso a `:4199`, la pubblicazione parte a `:4147`) — *corretto in §5.0* |
| Uscita dal **campo del nome** (esperienza) | rinomina **in place** di `projects/<progetto>/<slug(exp)>`; se il nome d'arrivo è preso: contenuto spostato nel dossier esistente, vecchio (svuotato) **in corbeille** | `activeTestModule.jsx:546-591` → `driveUpload.js:2959` → `:2910-2944` |
| Nome progetto (uscita dal campo) | rinomina `projects/<progetto>` **+** `<progetto>_document.json` | `projectDetailModule.jsx:4617-4632`, `driveUpload.js:2959` |
| Bozza di storage (box) | `storage/<storage>/boxes/<nome>` + `tidyStorageFiles` | `activeTestModule.jsx:556-572` |
| Istanza / sezione / sottosezione | `<istanza>/<sezione>/<sottosezione>` sotto l'esperienza | `driveUpload.js:1234` (commento d'intestazione), `driveNaming.js:362` |
| Salvataggio (autosave) | `_workspace/datasets/ds_<id>.json` | `workspaceDrive.js:421-442` (Fase 0 §2④) |
| Indice dell'area | `_workspace/state.json`, **fuso per id** | `workspaceDrive.js:182-206` (`mergeWorkspaceStates`) |
| Pubblicazione di un file | `<...>/<titolo>_<scienziato>.<ext>` | `driveNaming.js:44-54` (`suggestDriveFileName`) |
| Eliminazione esperienza | **corbeille** del dossier dell'esperienza (con ripiego sul registro) | `driveUpload.js:1204-1232` |
| Eliminazione file / pubblicazione | **corbeille** del file + registro `deleted: true` | `driveUpload.js:2195-2214` |
| Rimozione « morbida » | **rinomina** con suffisso `_deleted` (**niente** corbeille) | `driveUpload.js:2171-2190` |

La ricerca del dossier d'esperienza, quando il registro non conosce i file,
prova **cinque** percorsi in quest'ordine (`driveUpload.js:1181-1198`):
`projects/<progetto>/<exp>`, `<progetto>/<exp>` (legacy),
`projects/test/<exp>`, `projects/_unassigned/<exp>`, `<exp>` (legacy isolato).

### 3b — Cosa significa « corbeille », e cosa significa « abbandonare »

**Tre gesti, tre semantiche diverse** — e solo il terzo cancella da sé:

1. `trashDriveFile(fileId)` — `PATCH { trashed: true }` (`driveUpload.js:2195-2214`).
   Va nella **corbeille di Drive** (recuperabile **solo a mano**, dall'utente);
   l'app segna `deleted: true` nel registro locale e **non lo rianima mai più**
   (`renameDriveFilesFor` salta le voci `deleted`, `driveUpload.js:2966`).
   *Dall'app: irreversibile.*
2. `markDriveFileDeleted(fileId)` — rinomina con suffisso `_deleted`
   (`driveUpload.js:2171-2190`): **non** va in corbeille, resta dov'è.
3. `renameTestFolderOnDrive` — quando il nome d'arrivo è già preso, sposta i
   figli nel dossier quotato e **manda in corbeille il vecchio dossier svuotato**
   (`driveUpload.js:2924-2941`). È l'**unico punto in cui l'app cancella senza
   che l'utente lo chieda**: è una riparazione, ma anche un rischio (se lo
   spostamento è parziale, il conto dei figli spostati è dichiarato
   `moved || 1`, riga ~2936).

**Progetti**: la tomba sta in `_workspace/state.json` (`deletedProjects`, letta
da ⑥) → oggi **0** progetti in tomba hanno ancora il loro dossier.

**Abbandono del lavoro di un altro posto** (`voluntaryForgetRef`,
`App.jsx:2026`): appena l'utente **scarta** la copia distante, l'app annota
l'identificativo e l'istante (`App.jsx:2053`) e per **10 secondi**
(`DISTANT_GUARD_SILENCE_MS`, `:2027`) **ignora** le esperienze distanti
(`App.jsx:2160-2161`) — così la versione scartata non rientra da sola.

**Nessun ripristino**: non esiste, in `src/`, un percorso che rimetta a posto
un file messo in corbeille o un dossier « dimenticato ». È il buco che
`_drive_restore_test.mjs` sorveglia (§3d) e che il punto E-iii del piano copre.

### 3c — Le latenze di coerenza, e il riuso degli identificativi di creazione

* **[eseguito]** Il banco a due posti esprime la latenza come `coherenceMs` per
  fattore; i fattori di renommage usano **1000 ms** (`_drive_two_pc_random_test.mjs:279,283`).
* **[eseguito]** Il gesto reale **non ripara**, peggiora:
  `renommage-lent` → reste **0/20**, gemelli **1/20**;
  `renommage-champ` (con l'uscita dal campo, cioè il gesto dell'app) → reste
  **0/20**, gemelli **2/20**.
* **[eseguito]** Chiusura anticipata dell'onglet: **20/20** esperienze perse
  **anche in locale**. Non è un problema di rete: è **ordine di scrittura**.
* **[aperto]** Le due latenze brevi (0,2 s e 0,5 s): il banco le esprime con lo
  stesso asse `coherenceMs`; i valori esatti dei due fattori brevi li confermo
  con la prossima esecuzione invece di attribuirli.
* **[letto]** Il riuso degli identificativi: l'audit **chiede già**
  `appProperties` nella lista dei figli (`drive-audit-live.mjs:162`), e ogni
  dossier porta il suo `<oggetto>.json` con dentro l'`id`
  (`drive-audit-live.mjs:353-364`; ⑨ lo usa). **[vedi §3c-bis]** per la
  verifica fatta sul codice d'oggi.

#### 3c-bis — `appProperties`: l'app **non** li scrive (verificato)

`appProperties` **non compare in `src/`**: la ricerca esauriente su tutto
l'albero (`findstr /s /i /c:"appProperties" src\*.js src\*.jsx`, file
`_z_appprops.txt`) ritorna **0 righe**. Le uniche occorrenze del progetto sono:

* l'**audit** che li *legge* (`drive-audit-live.mjs:162`),
* il **finto Drive** che li *sa* conservare (`_harness/fake-drive.mjs:13, 171, 235-257, 463`),
* il **piano** di Fase 2 che li *prevede* (`docs/DRIVE-SYNC-FASE0.md:241`).

**Conseguenza per il piano**: oggi il legame dossier↔entità **non esiste su
Drive**; l'unica traccia è il `<oggetto>.json` dentro il dossier (ed è per
questo che ⑨, che lo legge, è l'unico controllo affidabile). Dunque il punto A
del piano **deve cominciare dalla scrittura** di `appProperties` (e l'audit,
che già li chiede, li vedrà dal primo giorno) — non si può « contare su » un
legame che il codice non produce.

### 3d — La suite, file per file

447 file raccolti, avviati 11:52:26Z, **processo 20808 ancora vivo**, flusso che
continua a scrivere (`_suite_stream.txt`: 26 594 ott. alle 14:11 → **37 118
ott. alle 14:20**). Lo stato è **parziale**, e questo è ciò che si legge oggi:

| Categoria | Conteggio | File |
|---|---|---|
| Test veri dell'app **che falliscono** | **5** | `_cysteine_panel_layout_test.mjs`, `_distant_experiments_test.mjs`, `_docking_scatter_card_test.mjs`, `_drive_restore_test.mjs`, `_md_wall_test.mjs` |
| Sonde usa-e-getta raccolte **senza argomenti** | **11** | `_check_recover_file.mjs`, `_check_wip2.mjs`, `_dump_region.mjs`, `_q_scan.mjs`, `_resume_extract{,_2,_3,_4}.mjs`, `_resume_human2.mjs`, `_resume_msg{,2}.mjs` |
| Sonde rotte per costruzione (modulo assente / scadenza 300 s) | 3 | `_kf_library_render_run.mjs` (`ERR_MODULE_NOT_FOUND`), `_probe_folder.mjs`, `_run_all.mjs` |
| Guardia che **esce 1 di proposito** | 1 | `_recover_test_copies.mjs` (« 5 copie dubbie — NON caricate ») |

Natura dei 5 fallimenti veri:

* `_drive_restore_test.mjs` — « DockingSections passa per il meccanismo
  **GENERALE** (nessuna restaurazione in casa) »: **è il test del ripristino**,
  e dice che il meccanismo generale è ciò che si vuole. Va tenuto, non
  ammorbidito: è il guardiano di E-iii.
* `_distant_experiments_test.mjs` — « la forme rendue reste celle des autres
  verrous (tests / rescued / removed) »: il codice d'oggi restituisce **anche
  `collapsed`**, il test ne conosce **tre**: **test vecchio, codice nuovo**
  (da allineare il test, non da « riparare » il codice).
* `_cysteine_panel_layout_test.mjs`, `_docking_scatter_card_test.mjs`
  (errore di roldown, non un'asserzione), `_md_wall_test.mjs` — **fuori
  dall'ambito sync**: pannelli/grafici; vanno dichiarati come tali nella
  consegna « suite verde » (altrimenti « verde » non vuol dire niente).

**Da dire chiaro**: la suite **non** è verde, e non lo sarà finché (i) le 11
sonde senza argomenti non vengono escluse dalla raccolta o dotate di argomenti,
(ii) le 3 sonde a scadenza non smettono di far scadere il raccoglitore,
(iii) i 5 test veri non sono **classificati**. Nessuno dei 5 è stato toccato:
cambiare la prova per far passare il codice è esattamente ciò che non si fa.

---

## 4. Lo stato condiviso: chi è la fonte di verità, e dove resta locale

Quattro depositi, **una sola verità**, e ognuno con un orologio diverso:

| Deposito | Cosa contiene | Dove / con quale ritmo |
|---|---|---|
| **Documento del dataset (Firestore)** | la **verità**: `tests` (le esperienze), `projects`, `keys`, `deletedExperiments`… — carica **compressa** (LZString UTF-16) | scritto dall'autosave: **1,5 s** dopo l'ultima modifica, e svuotato a `pagehide` (`App.jsx:4071-4239` citato in Fase 0 §2④) |
| `_workspace/datasets/ds_<id>.json` (Drive) | la **copia del contenuto** del dataset — è ciò che rende un dataset leggibile su un poste nuovo | **8 s** dopo l'ultima modifica (`DATASET_COPY_DELAY_MS = 8000`, `datasetCopyMirror.js:35`), con **impronta** (contenuto identico ⇒ nessun invio, `:84-85`) e **`flush()`** a `pagehide` |
| `_workspace/state.json` (Drive) | l'**indice** comune: tombe di progetti, tombe/leonarde di esperienze, registri dei dossier | fuso **per id**, con le regole di `mergeDriveMirrors` |
| `labDriveMirror` + chiavi `lab*` (localStorage) | i **suggerimenti del poste**: id dei dossier (dataset, progetti, `imagesId`, contenitori canonici), tombe, registri | locale; le chiavi che viaggiano sono elencate in `workspaceKeyStore.js:57-61` |

Le regole di fusione sono **asimmetriche di proposito**:

* **Le tombe si sommano, mai si perdono** (`mergeDriveMirrors`, `driveMirrorStore.js:188-203`):
  la più recente vince, ma `folderId` e `purgedAt` **sopravvivono** alla tomba più
  recente di un altro poste. È la difesa contro « il dataset sparisce due volte ».
* **I registri: vince l'entrata più recente per `at`** (`:204-212`) — un poste non
  può « tornare indietro » il registro dell'altro.
* **Le esperienze**: `mergeExperimentsAddOnly` (una rilettura **non** cancella ciò
  che il poste sa), `protectUnrecordedDrops` (prima di scrivere, ciò che esce dalla
  lista **senza record** viene rimesso) e le tombe `deletedExperiments` (la
  soppressione è **un dato datato**, che viaggia nel payload **e** in `state.json`,
  con la sua **leva**) — `experimentTombstones.js:24-39`. L'identità è l'**`id`**;
  il nome serve solo per le voci scritte da versioni vecchie (`:41-44`).
* Il registro dei dossier conserva anche l'identificativo del dossier `images`
  **scelto** (`imagesId`, `:163-167`) perché « il primo del nome » può essere un
  **jumeau vuoto** — è la stessa lezione di ⑨ applicata alla lettura.

**Il punto debole, detto chiaro**: la copia su Drive è **best-effort e muta** —
`send()` cattura l'errore e rende `false` (`datasetCopyMirror.js:74-76`), quindi
**« non c'era niente da scrivere » e « l'iscrizione è andata persa » hanno la
stessa faccia**. Con due orologi diversi (1,5 s Firestore, 8 s Drive) c'è una
finestra di **8 s** in cui il documento è aggiornato e la copia no: se l'onglet
si chiude lì, il `flush()` di `pagehide` è l'unica rete — e il banco a due posti
mostra che quella rete **non tiene** (§3c, 20/20 perse). Questa è la ragione per
cui il punto **G** del piano (§5) mette **prima** la coda persistente e **poi**
qualsiasi altra cosa.

---

## 5. Il piano: da A a G — cosa si tocca, in che ordine, e come si prova

### 5.0 — La regola di marcia

**Un punto = un commit.** Ogni punto qui sotto si consegna **da solo**, con (i) la sua
**giuntura pura** estratta da `App.jsx` — una funzione senza effetti, in `src/utils/`,
sul modello di `datasetCopyMirror.js`, `experimentTombstones.js`, `driveNaming.js` —,
(ii) il suo test **dedicato** che gira **senza browser**, (iii) la sua prova
d'accettazione, (iv) la suite che **non peggiora** (baseline di §3d: 447 raccolti, 25
falliti, di cui **5 test veri** che non si toccano: *cambiare la prova per far passare
il codice è esattamente ciò che non si fa*).

**Niente merge, niente build di pubblicazione senza un OK.** Nessun punto si fonde su un
ramo condiviso e nessuno si costruisce per il deploy finché non lo dico io. Ogni punto
dichiara **come si torna indietro**: il commit da annullare, e se ciò che è stato scritto
su Drive o in `localStorage` si lascia com'è (regola: **si lascia** — il Drive non si
« disfa » per far tornare verde un test).

**I tag**: `[letto]` codice d'oggi · `[provato]` sonda o banco a due posti ·
`[eseguito]` test/audit eseguito in questa sessione · `[aperto]` da confermare. Un
punto `[aperto]` non diventa vero perché è scritto in questo documento.

**Nota di lettera — e due correzioni.** Le lettere sono quelle di Fase 0 §6: **A–F
invariate**, **G** appesa in coda (§8.6). Rispetto a quelle pagine, questo documento
corregge **due rimandi sbagliati** (li dichiaro qui perché nessuno li ricopi):

* §4 diceva « il punto **B** del piano (§5) mette prima la coda persistente »: è un
  **refuso** — la coda persistente è **G** (§8.6 di Fase 0). Corretto nel §4.
* §3a dava due ancore per « il nome battuto lettera per lettera »
  (`projectDetailModule.jsx:3502`, `App.jsx:5291`): la prima è un campo *documento*, la
  seconda è l'uscita da un dataset. La buona è `App.jsx:4071-4199` — l'effetto
  d'autosalvataggio, che rimette il timer a `:4199` e pubblica la struttura a `:4147`.
  Corretto nel §3a.

Ciò che invece **non** cambia rispetto a Fase 0 è il *nome* dei punti, ma il *momento*
di uno di essi: la metà leggera di G — **G-min**, §5.5 — si consegna **subito dopo D e
prima di E**, perché è lei che chiude la perdita misurata (§3c: **20/20**). La metà
pesante (coda su IndexedDB + `keepalive`) resta in fondo, dopo F.

| # | Punto | Cosa garantisce | Fase 0 | Dove si tocca |
|---|---|---|---|---|
| **A** | L'identità | un oggetto ⇒ **un** dossier, riconosciuto per `appProperties`; l'`id` su **ogni** livello | A | `driveStructure.js` (piano e `writeMeta`), `driveUpload.js` (IO) |
| **B** | Nomi di nascita | due oggetti nuovi non nascono con lo stesso nome | B | `App.jsx:1142` → `src/utils/emptyTest.js` |
| **C** | Cancellazione | la conferma **elenca** ciò che sparisce, e l'esito si **dice** | C | moduli di cancellazione → `src/utils/deletionImpact.js` |
| **D** | Il nome alla conferma | il nome entra nel modello a Invio/uscita dal campo, non a ogni battuta | D | `App.jsx:4071-4199` (è il bersaglio) |
| **G-min** | L'**ordine di scrittura** | il lavoro **sopravvive alla chiusura** dell'onglet | G (prima metà) | `App.jsx:4084-4239` → `src/utils/unsentChanges.js` |
| **E (i)** | Stato visibile | « N modifiche da inviare », sempre leggibile | E | sidebar di stato + `src/utils/pendingOps.js` |
| **E (ii)** | Avviso di chiusura | avviso **solo** se ci sono operazioni sospese | E | `pagehide` / `beforeunload` |
| **E (iii)** | Ripristino | una via per rimettere a posto ciò che è in corbeille | *nuovo* — il buco di §3b | `driveRestore.js`, `driveTidy.js` → `src/utils/driveRepairPlan.js` |
| **F** | Prova severa | `--strict` di **default** nei banchi Drive | F | solo test |
| **G** | Coda persistente | le modifiche non inviate non si perdono: né alla chiusura, né alla rete | G (seconda metà) | `src/utils/pendingQueue.js` + `keepalive` |

### 5.1 — A — L'identità: `appProperties` su ogni oggetto, l'`id` su ogni livello

> **CONSEGNATO IL 17/10/2026 — la parte « identità su ogni livello ».** `addLevels`
> écrit `extra.id` sur **chaque** niveau de l'objet (le projet garde le sien) et les
> textes de section le portent aussi (`addLevels(sLevels, { id })`) : la renommée d'une
> expérience AVEC instance+section est réparée — un seul dossier, le même identifiant
> Drive, l'ancien nom disparaît. Preuve : `node _drive_plan_identity_test.mjs --strict`
> → **0** ; voir `docs/DRIVE-MIRROR.md` (« FASE 1 A — l'identité va sur CHAQUE niveau »).
> **Reste ouvert** : la seconde moitié de A (`appProperties` écrits par l'app + l'IO
> `setProperties`), et le DÉPLACEMENT d'un projet à l'autre (l'adoption ne regarde que
> les frères du nouveau parent) — mesuré dans `_drive_sync_repro_test.mjs` §R.

**Cosa dice il codice d'oggi** `[letto]`. Il piano del mirror — `datasetMirrorPlan`
(`driveStructure.js:596`) — è una funzione **pura**: entra il dataset, escono `folders` e
`files` con i loro `extra`. L'identità la scrive **solo** nei tre punti in cui c'è
un'entità:

* il dataset: `addFolder([], STRUCTURE_TYPES.DATASET, folderSlug, { id: datasetId,
  name: datasetName })` (`:651`);
* il progetto: `addFolder(path, STRUCTURE_TYPES.PROJECT, sanitizeSlug(name), { id: p.id
  })` (`:662`);
* l'esperienza: `addLevels(levels, { id: t.id })` (`:675`).

Ma `addLevels` (`:639-648`) passa l'`extra` **solo all'ultimo livello del cammino**:
`addFolder(path.slice(0, i + 1 + offset), level.type, level.name, isLast ? extra : null)`
(`:643-646`). I livelli intermedi — contenitore, progetto, istanza, sezione,
sottosezione — nascono con `extra = null`. E i testi di sezione passano da
`addLevels(sLevels)` **senza** `extra` (`:689`). Quindi oggi: il dossier dell'esperienza
sa chi è, i suoi cinque antenati **no**. `writeMeta` (`:937-965`) fonde l'`extra` nel
`_meta.json` (`extra: { ...(previous && previous.extra) || {}, ...(extra || {}) }`), ma
`appProperties` **non esiste in tutto `src/`** — `[eseguito]` oggi: **0 occorrenze**.
L'unico indizio di rinomina è un commento in `driveStructure.js:857`: « `1YCR` et
`instance1` portent le MÊME `extra.id` (`t17914951876631134`) ». La macchina c'è, il
dato no.

Tre conseguenze, tutte misurate in §1/§3:

1. il legame dossier↔entità vive **solo** dentro il `<oggetto>.json` — cioè solo per gli
   oggetti che hanno un JSON, e solo per chi lo legge;
2. i 113 allarmi di ② e i 463 di ⑤ (cammini intermedi senza identità) sono la stessa
   causa vista due volte;
3. l'audit è affidabile **perché** legge i JSON: chi guarda il Drive **senza** leggerli
   — un altro poste, un umano davanti alla cartella — non ha il legame. E `pickRenamedSibling`
   (`:878`, `{ appId }`) sa già riconoscere un oggetto spostato **a patto che** il `_meta.json`
   sia lì.

**Cosa cambia.** A porta l'identità su **due canali** e su **tutti** i livelli:

* **`appProperties` su ogni dossier e su ogni file** scritti dalla struttura —
  `{ appId: 'ds_<datasetId>', objectType, objectId }` — con **un verbo in più**
  nell'adattatore `defaultDriveStructureIo` (`driveStructure.js:1257`, che oggi ne ha
  quattordici: `workspaceId, rootId, ensureFolder, findFolder, list, listDetailed,
  findFile, upload, downloadText, fileMeta, rename, move, trash, available`). Il verbo
  nuovo si aggiunge **prima** dei suoi usi, e il suo contratto lo fissa il finto Drive
  (`_harness/fake-drive.mjs` conserva già le proprietà; `_drive_contract_test.mjs` è il
  test « finto ≡ vero »).
* **`extra.id` su ogni livello del cammino**: `addLevels` riceve l'identità e la mette su
  tutti i livelli (`:639-648`), non solo sull'ultimo; i testi di sezione smettono di
  essere orfani (`:689`).
* **L'adozione al posto del doppione**: `folderOfAppIdentity` (`:974-1000`, che usa
  `pickRenamedSibling` a `:995`) continua a essere l'unica strada; A le toglie la
  dipendenza dal `_meta.json`, perché il legame sta anche sull'oggetto stesso.

**La giuntura pura.** Il piano è **già** puro: A lo estende, non lo sposta. Gli effetti
(struttura + `PATCH` delle proprietà) restano nell'IO: `driveUpload.js` e `driveMirror.js`.

**Test.** `_drive_plan_identity_test.mjs` (esistente) + `_drive_contract_test.mjs`
(esistente) + un caso nuovo nel piano: *ogni* livello del cammino porta l'`id`.

**Prova d'accettazione.** `node _drive_plan_identity_test.mjs --strict` → **0**. Oggi
`[eseguito]` esce **1**, e il suo rapporto dice da solo qual è il rimedio: « *il difetto
è dichiarato nel rapporto: `docs/DRIVE-SYNC-FASE0.md` §8.2 (causa:
`driveStructure.js:643-646`) e la sua correzione è la FASE 1, punto A. MODE STRICT:
exit 1 — l'identità manca ancora sul dossier dell'esperienza* ». Poi: `node
_drive_contract_test.mjs` invariato e — `[aperto]` — **un giro d'audit in sola lettura**
(`node scripts/drive-audit-live.mjs`, §3c-bis): ② e ⑤ devono **scendere**. Il numero lo
dirò dopo averlo visto, non prima.

**Rischio e ritorno.** Il primo giro scrive una proprietà su ~509 dossier e ~2007 file:
sono dei `PATCH`, una volta sola (dopo, è memoria). Nessun contenuto si tocca, nessun file
si sposta: si annulla togliendo la proprietà, e il commit da annullare è quello di A.

### 5.2 — B — I nomi di nascita: due oggetti nuovi non nascono con lo stesso nome

**Cosa dice il codice d'oggi** `[letto]`. Il nome di un oggetto nuovo non è mai *scelto*:
è **contato**. La fabbrica è una sola — `createEmptyTest(id, num, customType =
'plate-96')` (`App.jsx:1142`), nome `name: \`Test ${num}\`` (`:1145`) — e `num` lo passano
i chiamanti come **dimensione della collezione**:

| Chiamante | Riga | `num` passato |
|---|---|---|
| `testsModule.jsx` | `:259` | `createEmptyTest(id, tests.length + 1, type)` |
| `projectDetailModule.jsx` | `:1816` | `createEmptyTest(id, tests.length + 1, type)` |
| `activeTestModule.jsx` | `:350` | `createEmptyTest(id, siblingTests.length + 1, activeTest.type)` |
| `Storage.jsx` | `:505` | `createEmptyTest(id, tests.length + 1, 'plate-9x9box')` |

(la fabbrica serve anche agli stati iniziali dentro `App.jsx`: `:1915`, `:5117`, `:5583`,
sempre `createEmptyTest('t1', 1, 'plate-96')`).

Il difetto ha due facce, entrambe **derivabili** dal codice, non solo osservate:

1. **La collisione banale.** `length + 1` non è un contatore, è una *dimensione*. Con
   `Test 1` e `Test 3` in elenco (due elementi, perché `Test 2` è stato cancellato),
   l'oggetto nuovo si chiama `Test 3`: un **secondo** `Test 3`. Stessa cosa se due onglet
   creano nello stesso momento, ognuno sul proprio `siblingTests.length`.
2. **La collisione di cammino.** Il nome diventa il dossier: `sanitizeSlug(name)`
   (`driveStructure.js:662`) e il piano tiene i dossier in una `Map` **chiavata sul
   cammino** — `addFolder` (`:605-625`): `if (folders.has(key)) { prev.extra = { ...(prev.extra
   || {}), ...extra }; return prev; }` (`:607-612`). Due oggetti con lo stesso nome **nello
   stesso progetto** prendono lo **stesso** ingresso: **un dossier, due oggetti** — ed è
   la forma esatta che l'audit conta in ②/⑨ (§1, §3c-bis).

**Cosa cambia.** Il pezzo puro esce da `App.jsx` e diventa un modulo —
`src/utils/emptyTest.js`:

* `emptyTest({ id, name, type, operator })` — l'oggetto vuoto, come oggi, senza dipendere
  dallo stato del componente (`currentUser?.name` diventa un **parametro**);
* `nextFreeName(existing = [], base = 'Test')` — **pura**: scorre i nomi presenti e rende
  il primo `Test N` **libero** (poi `Test N (2)`, …). A parità d'ingresso, stesso risultato:
  si prova senza browser;
* i quattro chiamanti passano `nextFreeName(namesOf(tests))` al posto di `tests.length + 1`.

**Limite dichiarato.** B rende i nomi liberi **dentro un dataset, su un poste**. Non è una
garanzia globale: due oggetti creati su due posti nello stesso minuto possono ancora
volere lo stesso cammino. Quel caso si chiude con **A** (identità sull'oggetto, adozione
al posto del doppione) e, per il residuo, con una regola di disambiguazione **scritta**
(§5.10, `[aperto]`). B non finge di risolverlo: lo **restringe**.

**La giuntura pura.** `src/utils/emptyTest.js`, sul modello di `driveNaming.js` e
`experimentTombstones.js`: nessun `fetch`, nessun DOM, nessun orologio implicito.
`createEmptyTest` resta in `App.jsx` come **involucro** di poche righe che chiama il
modulo — gli stati iniziali (`'t1', 1`) non cambiano comportamento.

**Test.** nuovo `_empty_test_naming_test.mjs` (puro, `node`):
`nextFreeName([], 'Test') === 'Test 1'` · `nextFreeName(['Test 1','Test 3']) === 'Test 2'`
(**oggi** darebbe `Test 3`: è il difetto, messo in un caso) · `nextFreeName(['Test 1','Test
2']) === 'Test 3'` (il caso normale **non** cambia) · due chiamate con lo stesso elenco
danno lo stesso nome (determinismo) · e un test di **forma**: `emptyTest` produce le stesse
chiavi del `baseTest` d'oggi (`App.jsx:1143-1169`), perché B non deve cambiare *cosa* è un
oggetto nuovo, solo *come si chiama*. Poi `node _drive_rename_test.mjs --strict` deve
restare **0** (`[eseguito]` oggi: **0**).

**Prova d'accettazione.** `_empty_test_naming_test.mjs` → 0; e un giro d'uso (a mano, in
due onglet) — `[aperto]` —: cancellare un oggetto intermedio, crearne uno nuovo, e
verificare che il nome **non** ripeta uno esistente.

**Rischio e ritorno.** Il caso normale (`Test 1`, `Test 2` → `Test 3`) dà **lo stesso
nome di oggi**: nulla cambia per chi non ha mai avuto una collisione. Ritorno: il commit
di B. Nessun dato del Drive è toccato: **B non rinomina** niente di ciò che esiste.

### 5.3 — C — La cancellazione: la conferma **elenca**, e l'esito si **dice**

**Cosa dice il codice d'oggi** `[letto]`. In `src/` ci sono **59** `confirm(` fuori
dall'amministrazione (`[eseguito]`). Quelli della cancellazione di un oggetto stanno in
`testsModule.jsx` e sono tre **domande senza inventario**:

| Riga | Testo d'oggi |
|---|---|
| `testsModule.jsx:684` | `Approve deletion of "${test.name}"?` |
| `testsModule.jsx:686` | `Delete "${test.name}" definitively?` |
| `testsModule.jsx:688` | `Request supervisor approval to delete "${test.name}"?` |

Poi, detto sì, gli **effetti** partono — e il loro esito **non si dice**:

```
testsModule.jsx:138-142
  markAttachmentsDeleted(t).catch(() => {});
  deleteTestDriveFolder(t).catch(() => {});
  removeTestFcsBlobs(t).catch(() => {});
```

Tre `catch(() => {})` in fila: se il dossier sul Drive non va in corbeille, se gli allegati
non si marcano, se i blob FCS non partono — **silenzio**. La corbeille è l'unica modalità
prevista (`deleteTestDriveFolder`, `driveUpload.js:1204`; `mirrorDeleteProject`,
`driveMirror.js:313`; `markAttachmentsDeleted`, `driveUpload.js:3121`) e l'app **non
emette nessuna cancellazione definitiva**: è proprio ciò che il banco d'identità mette
nero su bianco (« nessuna cancellazione DEFINITIVA emessa (corbeille solo, o nulla) »,
`[eseguito]`). La tomba dell'oggetto è un **dato**, non un'assenza:
`DELETED_EXPERIMENTS_KEY = 'labWorkspace_deletedExperiments'` e
`REVIVED_EXPERIMENTS_KEY = 'labWorkspace_revivedExperiments'`
(`experimentTombstones.js:53-54`), applicate da `withoutDeletedExperiments` (`:216`) e
`withoutRevivedExperiments` (`:185`), riadottate da una copia remota a `App.jsx:2071-2075`
e riassunte a `:2062`.

Il buco, in una riga: la conferma **chiede** senza dire *cosa* sparisce — un dossier sul
Drive? quanti file? gli allegati? si può tornare indietro? — e dopo il gesto **non dice**
se è andata o no.

**Cosa cambia.** Un pezzo puro calcola l'**impatto** *prima* di chiedere, e la conferma lo
**stampa**. Nasce `src/utils/deletionImpact.js`:

* **entrata**: l'oggetto da cancellare, ciò che il piano (`datasetMirrorPlan`) o l'ultima
  lettura sanno di lui, le tombe;
* **uscita**: `{ mode: 'corbeille' | 'definitive', folders: [...], files: [...],
  attachments: n, blobs: n, recoverable: true|false, note: '' }`;
* la domanda diventa: *« Archiviare in corbeille “ Test 3 ” ? — 1 dossier sul Drive, 7 file,
  2 allegati. Ritorno dalla corbeille: sì. »* — e la riga finale cambia tono **solo** se
  l'impatto è grave (molti file, o modo definitivo);
* e l'esito si **dice**: i tre `catch(() => {})` diventano un rapporto verso lo stato
  d'invio (§5.6), con lo stesso vocabolario già in uso in `App.jsx:4385-4386`
  (`state: 'error' | 'skip'` + messaggio).

**Il vocabolario, fissato una volta.** *Corbeille* (reversibile: è l'unica cosa che l'app
fa oggi) e *definitiva* (oggi non esiste) sono due parole diverse, e non si usa la seconda
per la prima. C **non aggiunge** la cancellazione definitiva: rende leggibile quella che
c'è, e mette il cancello perché la parola « definitively » (`testsModule.jsx:686`) resti
vera il giorno in cui una cancellazione definitiva esisterà davvero.

**La giuntura pura.** `deletionImpact.js`: entra un albero, esce una descrizione. Nessun
`confirm`, nessun `fetch`, nessuna cancellazione: la funzione **non parla all'utente** e
non tocca il Drive — dice solo *cosa* cadrebbe, e *se* si rientra. I `window.confirm`
restano nei moduli, ma con un testo **costruito dal modulo puro** (quindi provabile).

**Test.** nuovo `_deletion_impact_test.mjs` (puro):
* 1 dossier + 7 file → `{ mode: 'corbeille', files: 7, recoverable: true }`;
* con allegati → `attachments` conta e compare nel testo;
* albero **ignoto/vuoto** → `note` dichiara « impatto non calcolabile » (non si finge di
  sapere: si dice che non si sa — è la lezione di §3c-bis);
* il **testo** della conferma contiene il nome, il numero di file e la parola *corbeille*,
  e **non** contiene « definitively ».
Più: i banchi di cancellazione già presenti (inventario §3d) devono restare verdi, e il
banco d'identità deve continuare a poter dire « nessuna cancellazione DEFINITIVA ».

**Prova d'accettazione.** `_deletion_impact_test.mjs` → 0, e — `[aperto]` — un giro a mano:
cancellare un oggetto, leggere la conferma, e verificare che i **numeri** detti coincidano
con ciò che l'audit vede sul Drive prima e dopo.

**Rischio e ritorno.** Rischio: una conferma più lunga (una riga in più) e il costo di
calcolare l'impatto (una lettura già in memoria: il piano è puro e la sidebar lo ha già).
Ritorno: il commit di C. Il gesto d'oggi **non cambia**: si continua a mettere in
corbeille, e la corbeille si può svuotare a mano.

### 5.4 — D — Il nome entra nel modello alla conferma, non a ogni battuta

**Cosa dice il codice d'oggi** `[letto]`. L'effetto d'autosalvataggio è **uno solo** (§3a, seconda
riga) e le sue dipendenze sono **ventinove** (`App.jsx:4233-4239`): `tests, datasetTitle,
datasetSubtitle, customCmpds, customCellLines, customConc, cmpColors, testCategories,
protocolCategories, datasetProtocols, customFields, operators, molecules, compoundMeta,
calculationEntries, cellLineMeta, plasmidMeta, storages, solvents, buffers, additives, nmrInstruments,
nmrProbes, nmrExperiments, isCloudReady, appView, currentDatasetId, activeDatasetKind, user,
authSettings`. **Qualunque** cambi di queste riarma il timer (`saveTimeoutRef.current =
setTimeout(runSave, 1500)`, `:4199`) e dopo 1,5 s fa partire `runSave`, che a `:4147` pubblica la
struttura — con `datasetName: datasetTitle || ''` (`:4149`), cioè **leggendo il nome in quel
momento**. Non c'è una seconda pubblicazione da nessun'altra parte: D ha un bersaglio solo.

Che il danno sia reale lo dice **il codice stesso**, in un commento di `activeTestModule.jsx:565-567`:
« …chaque lettre) qu'on range ses photos sous ce nom — **un dossier par nom intermédiaire restait
sinon sur le Drive (j, ja, jac)** ». La lezione era già stata imparata **per le foto di uno storage**:
là il nome entra nel modello solo all'uscita dal campo (`testNameBeforeEditRef`, `:590`), e poi si
rinomina (`:574-587`), si riordina (`tidyStorageFiles`, `:568-572`). D **generalizza quella lezione al
resto del modello**: il titolo del dataset (`datasetTitle`), il nome del progetto
(`projectDetailModule.jsx:4617-4632`), il protocollo, lo storage.

**Cosa cambia.** Due pezzi, uno puro e uno di collegamento:

1. nasce `src/utils/nameCommit.js` — puro: `settleName(draft, committed)` → `{ changed, value }` (il
   cancello della conferma); `structureSignature(state)` → una stringa **canonica** di ciò da cui
   dipende la *struttura* (il dataset con il suo id e il suo nome, i progetti con gli id, le
   esperienze con gli id e i nomi, gli storage, i protocolli, l'agenda) e `sameStructure(a, b)`;
2. l'effetto non dipende più dai nomi **in battuta** ma dai nomi **confermati**: il campo tiene una
   bozza locale e la riversa nello stato a Invio/uscita dal campo — il gesto già in uso
   nell'esperienza — e la pubblicazione parte solo se `structureSignature` è **cambiata**.

Così « j, ja, jac » non può più nascere: una battuta cambia una **bozza**, non la firma. E la firma
serve anche a un secondo scopo, dichiarato qui perché non venga riscoperto a metà lavoro: è la stessa
grandezza che il banco a due posti dovrà contare (§5.5, §5.7) per dire « **una** pubblicazione per
nome », invece di « N ».

**La giuntura pura.** `nameCommit.js` non tocca React, non tocca il Drive, non guarda l'orologio: entra
uno stato, esce una firma; entrano due nomi, esce `changed`. È la parte che si prova **senza browser**.

**Test.** nuovo `_name_commit_test.mjs` (puro, `node`):

* firma **stabile** quando due stati differiscono solo per una **bozza** (una chiave `*Draft`): è la
  difesa contro la regressione che rimetterebbe la bozza dentro la firma;
* firma **cambiata** quando cambia un nome **confermato** (`datasetTitle: 'A'` → `'B'`): la
  pubblicazione segue la conferma, non la battuta;
* firma cambiata su aggiunta / rimozione / rinomina di un'esperienza, su aggiunta di uno storage o di
  un protocollo, e su un cambio di `id`;
* firma **uguale** per due stati strutturalmente uguali ma non identici (due oggetti ricostruiti): è
  la difesa contro la ripartenza dell'effetto a ogni render;
* determinismo: due chiamate con lo stesso stato danno la stessa stringa (niente `Date.now()`, niente
  casuale — la lezione di §3c-bis: un numero che non si sa rifare non è una misura);
* `settleName`: `settleName('jacques', 'jacques')` → `{ changed: false }`; `settleName('', 'jacques')`
  → `changed: true` **e** `value: ''` (un campo svuotato è una conferma, non un silenzio — è la regola
  d'oggi nell'esperienza).

**Prova d'accettazione.** `_name_commit_test.mjs` → 0; `_drive_rename_test.mjs --strict` resta **0**
(`[eseguito]` oggi: 0); e — `[aperto]` — il gesto **contato** nel banco a due posti
(`_harness/two-pc.mjs`): battere un nome lettera per lettera e contare le pubblicazioni. Oggi il
*meccanismo* è provato (`:4199` + `:4147`, e il commento « j, ja, jac » che ne è la traccia), il
**numero** no: lo fissa chi mette il gesto nel banco, e quel numero è la misura d'accettazione di D
(atteso: **una**).

**Il confine con A, e il banco dei cinque difetti.** `_drive_sync_repro_test.mjs --strict` esce **1**
con cinque difetti dichiarati (`DÉFAUTS : Q4, Q6, Q7, Q8, R`, `[eseguito]`), fra cui « session neuve +
republication : dossier au nouveau nom = **true**, ancien dossier disparu = **false** ». Quei casi
toccano **due** punti — l'**adozione** di un dossier che ha cambiato nome (A) e la **una sola
pubblicazione** per nome (D) — e la ripartizione fra i due la fissa chi implementa, leggendo i casi uno
per uno. Non la invento qui: sarebbe la cosa peggiore da scrivere in un documento che pretende `[letto]`
e `[eseguito]`. Quello che il documento **pretende** è: dopo A **e** D quel banco esce **0**, e i suoi
cinque difetti restano elencati nel rapporto finché non lo fa.

**Limite dichiarato.** D **non** cambia il gesto di rinomina, che resta quello di §3a: rinomina in
place, e se il nome d'arrivo è preso, il contenuto va nel dossier esistente e il vecchio (svuotato) in
corbeille. D cambia **quando** il nome entra nel modello, non **cosa** la rinomina fa sul Drive.

**Rischio e ritorno — e una dipendenza che va detta.** Il rischio di D, preso da solo, è **nuovo**: chi
scrive un nome e chiude l'onglet **senza uscire dal campo** perderebbe quella battuta (oggi, brutta ma
salva, la battuta viene pubblicata subito). Per non scambiare un difetto con un altro, D porta con sé
**la riga di svuotamento dei campi aperti**: `flushPendingSave` (`:4205-4216`, già agganciato a
`pagehide` e a `visibilitychange: hidden` a `:4217-4221`) conferma le bozze **prima** di salvare. È la
stessa riga che §5.5 userà per l'ordine di scrittura: se D si consegna da solo, quella riga si consegna
con lui. Ritorno: il commit di D. Nessun dato del Drive è toccato: **D non rinomina** niente di ciò che
esiste, smette solo di rinominarlo a ogni battuta.

### 5.5 — G-min — L'ordine di scrittura (la prima metà di G, consegnata subito)

**Perché qui e non in fondo.** §3c lo dice con una cifra sola: *« Chiusura anticipata dell'onglet:
**20/20** esperienze perse **anche in locale**. Non è un problema di rete: è **ordine di scrittura** »*
(`[eseguito]`). Se la causa è un **ordine**, la metà leggera di G costa poco e chiude una perdita già
misurata: si consegna dopo D (che le dà il nome confermato da scrivere) e **prima** di E (che le dà la
voce). La metà pesante — coda persistente, `keepalive` — resta in fondo, dopo F: è quella che **promette**
qualcosa, e una promessa va fatta sull'ordine già giusto.

**Cosa dice il codice d'oggi** `[letto]`. Dentro `runSave` (`App.jsx:4083-4197`) le quattro scritture
partono in **quest'ordine**:

| # | Gesto | Riga | Come parte |
|---|---|---|---|
| 1 | carica compressa + **ticket** di scrittura | `:4122-4133` | sincrono, in memoria |
| 2 | **copia** del dataset su Drive (`_workspace/datasets/ds_<id>.json`) | `:4134` `mirrorDatasetContent(...)` | **programmata** (~8 s, `datasetCopyMirror.js`), non attesa |
| 3 | **pubblicazione della struttura** (cartelle, `_meta.json`, file) | `:4147` `publishDatasetStructure({...})` | **non attesa** (`.then(...)`): l'esito va solo in `driveMirrorMsg` (`:4153`, `:4156`) |
| 4 | **documento** (Firestore) — o, **solo se `db` manca**, `localStorage` | `:4158-4173` / `:4174-4191` | **atteso**; è lui che scrive `saved` (`:4165`, `:4189`) |

Due cose si vedono leggendo quelle righe, e nessuna delle due è « un problema di rete »:

1. **`localStorage` è il ramo `else` del cloud** — `if (db) { await docRef.set(...) } else { …localStorage… }`
   (`:4158`, `:4174`). Su un poste collegato, la copia **sincrona** (l'unica che un onglet che si chiude
   **non può interrompere**) **non viene mai scritta**: l'unica scrittura attesa è quella di rete. Un
   onglet che muore dentro un `await` di rete non ha lasciato **niente** in locale — ed è esattamente
   ciò che §3c misura (« perse **anche in locale** »);
2. **le due scritture differite non sono sorvegliate** — la copia (`:4134`) e la struttura (`:4147`)
   partono e nessuno le aspetta: quando il `flushPendingSave` (`:4205-4216`) le rilanci urgenti a
   `pagehide` (`:4214` chiama `runSave(true)`, `:4215` svuota la copia), la struttura riparte **di
   nuovo senza essere attesa**, e la pagina può sparire durante il percorso del piano
   (`datasetMirrorPlan`). Il lucchetto d'ordine c'è già — `holdsLatestWriteTicket` (`:4133`) — ma
   protegge la **copia**, non la pubblicazione.

E il **`saved`** che l'utente legge (`appSidebar.jsx:127-139`) parla **solo** della scrittura #4:
quando dice `saved`, la #2 e la #3 possono essere ancora in volo o già fallite.

**L'ordine che serve.** Uno solo, dichiarato in un posto solo (il modulo puro), e non negoziabile:

| # | Scrittura | Perché lì |
|---|---|---|
| 1 | **istantanea locale sincrona** (`localStorage`, `setItem`) | è l'unica **non interrompibile**: un onglet che si chiude non può perderla. È la rete sotto tutto il resto |
| 2 | **documento** (Firestore `set(…, { merge: true })`, `await`) | è la **verità** (§4): senza di lui un altro poste non vede niente |
| 3 | **struttura** (`publishDatasetStructure`, **`await`**) | è ciò che **le spedizioni successive leggono per decidere dove scrivere** (§3, Q2/Q5): se manca, la spedizione dopo di lui ricrea cartelle |
| 4 | **copia** del dataset (differita ~8 s) | è un **ripiego** per un poste nuovo, non una fonte: può aspettare — ma ora è **sorvegliata**, e il suo esito si dice |

E il **`saved`** si dice solo dopo la #2 **e** la #3 (§5.6 lo mostra all'utente mentre sono in volo).

**Cosa cambia.** Nasce `src/utils/unsentChanges.js` — puro, nessun `fetch`, nessun DOM, nessun orologio
(nel senso di §3c-bis: i tempi arrivano dall'esterno, non sono letti dentro):

* `WRITE_ORDER = ['local', 'document', 'structure', 'copy']` — l'ordine qui sopra, come **dato**, così
  che nessun chiamante possa inventarne uno diverso;
* `unsentChanges({ local, document, structure, copy })` — ogni voce è
  `{ state: 'pending' | 'in-flight' | 'done' | 'failed', at }`; l'uscita è la lista **ordinata** di ciò
  che non è ancora arrivato;
* `countOf(unsent)` → `{ pending, failed, label }` (es. `« 3 modifiche da inviare »`) — **la stessa
  cifra** che §5.6 mette nella sidebar e che §5.7 conta nel banco: una sola funzione, non tre conteggi;
* `decideOnClose(unsent)` → `'flush' | 'warn'` — la metà **pura** di E(ii): si avverte **solo** se
  qualcosa è davvero in sospeso;
* `reportOf(results)` → il testo del rapporto, con lo stesso vocabolario già in uso in
  `App.jsx:4385-4386` (`state: 'error' | 'skip'` + messaggio).

E l'effetto (`:4071-4199`) cambia in tre punti: (i) l'istantanea locale esce dal ramo `else` e diventa
il **passo 1**; (ii) la pubblicazione è **attesa** e il suo esito entra nel conteggio; (iii) `saveStatus`
non dice più `saved` con due scritture in volo.

**La giuntura pura.** `unsentChanges.js` decide **cosa resta da inviare e in che ordine** — nient'altro:
non scrive, non parla, non ritenta. È la parte provabile senza browser, ed è la stessa che il banco a due
posti userà per **contare**.

**Test.** nuovo `_unsent_changes_test.mjs` (puro, `node`):

* l'ordine è **totale e stabile**: qualunque permutazione delle stesse quattro voci produce la stessa
  sequenza, e `local` precede sempre `document`, che precede `structure`, che precede `copy`;
* `countOf` conta **pending + failed** e **non** conta `done`; a lista vuota la `label` è vuota (niente
  « 0 modifiche » a schermo: è rumore);
* `decideOnClose` → `'flush'` con lista vuota, `'warn'` con una voce in sospeso — la prova che l'avviso
  di E(ii) non può accendersi per niente;
* il caso che oggi mente: **locale `done`, struttura `failed`** → `countOf` lo dice (« 1 modifica da
  inviare ») e la funzione **non** produce nessun « saved »: è la difesa contro la bugia del badge;
* `unsentChanges` **non muta** l'oggetto che riceve (due chiamate con lo stesso ingresso → stesso
  risultato);
* determinismo: nessun `Date.now()` letto dentro (i tempi sono passati come dati).

**Prova d'accettazione.** `_unsent_changes_test.mjs` → 0. E poi la misura che conta, già **eseguita**
oggi come punto di partenza (§3c): il gesto « scrivi, poi **chiudi l'onglet** entro il ritardo » nel
banco a due posti — `[aperto]` sulla forma esatta del gesto da aggiungere, ma **la cifra di partenza è
nota: 20/20 perse**. G-min è consegnato quando quel numero è **0/20**, e non « migliorato ». Il banco
`_save_in_background_test.mjs` (inventario §3d) resta verde: è il posto dove il gesto va messo.

**Limite dichiarato — la metà che G-min *non* è.** G-min **non** promette che una scrittura **di rete**
partita a onglet chiuso arrivi: un `pagehide` non può attendere, e nessuno può. Promette tre cose più
piccole e verificabili: (i) il **lavoro** non si perde, perché il passo 1 è sincrono e non
interrompibile; (ii) lo **stato** non dice `saved` mentre qualcosa è in volo; (iii) le due scritture
differite sono **sorvegliate e raccontate** invece che mute. La promessa « arriva comunque » è di **G**,
con la coda persistente e `keepalive` (§5.8) — ed è il motivo per cui G-min viene prima: una coda che
riprova nello stesso ordine sbagliato riproverebbe l'errore.

**Rischio e ritorno.** Rischio: un `setItem` sincrono in più su ogni salvataggio (c'è già, ramo
`else`: cambia **quando**, non **quanto**), e un `saved` che arriva **dopo** la pubblicazione — quindi
più tardi e più vero. Ritorno: il commit di G-min; il Drive non si tocca, e l'ordine è una proprietà
del codice, non dei dati.

### 5.6 — E — Vedere, avvertire, riparare

Tre cose distinte, tenute distinte (Fase 0 le elenca come E-i, E-ii, E-iii) perché hanno tre luoghi
diversi: la **sidebar** per E(i), il **gestore di chiusura** per E(ii), il **ripristino** per E(iii).
Nessuna delle tre tocca il formato dei dati su Drive: sono le tre in cui il piano *si fa vedere*.

#### 5.6.1 — E (i) — Lo stato visibile: « N modifiche da inviare »

**Cosa dice il codice d'oggi** `[letto]`. Il posto esiste già: la sidebar ha una riga `Status:`
(`appSidebar.jsx:123-141`) con tre facce — `saving` → « Saving… » (`:127`), `saved` → **ambra** « Local
only » con il tooltip *« Saved on THIS device only — the cloud (Firestore) was not reachable. It will sync
as soon as the connection is back. »* quando `saveTarget === 'local'` (`:129-131`), **verde** « Cloud
Sync » altrimenti (`:133`), `error` → rosso con il messaggio (`:135-137`) — e subito sotto una riga
**già dedicata al Drive**: `driveMirrorMsg` (`:143-148`), con il tooltip *« Lab Workspace/\<dataset\>/projects/…
— the Drive copy of this dataset is not complete yet. The next save retries what is missing. »*.
Lo stato nasce da `useState('idle')` (`App.jsx:1535`) con `saveErrorMsg` (`:1536`) e `saveTarget`
(`:1537`), e arriva alla sidebar (`App.jsx:7351`, `:7353`) e all'amministrazione
(`adminModule.jsx:177` → `<SaveBadge status={saveStatus} />`, `:266-268`).

Quello che **non** c'è: la parola « `saved` » copre **una** scrittura su quattro (§5.5), e nessun posto sul
Drive dice **quante modifiche restano da inviare**. `driveMirrorMsg` dice *che* qualcosa manca, non
*quanto*. Le due cose sono **la stessa misura** — `countOf(unsent)` di `unsentChanges.js` (§5.5) — vista in
due posti.

**Cosa cambia.** Nasce `src/utils/pendingOps.js` (puro): è la metà **di visualizzazione** di ciò che
`unsentChanges.js` **conta**. `opsLabel({ pending, failed, target })` → la frase; `priorityOf(...)` → chi
vince sullo schermo (`failed` > `pending` > `saving`/`saved` > `idle`); `toneOf(...)` →
`'neutral' | 'amber' | 'red'`. La riga della sidebar mostra il **conteggio** (« 3 modifiche da inviare »)
e passa al rosso **solo** se una scrittura è fallita davvero; il tooltip di `driveMirrorMsg`
(`appSidebar.jsx:145`) resta dov'è, ma la cifra arriva dal conteggio.

Con la quarta faccia, `saved` **con qualcosa in volo** non è più rappresentabile: è la fine della bugia
del badge (§5.5, punto 3).

**La giuntura pura.** `pendingOps.js` non conosce React né il Drive: entra il conteggio, escono una frase
e un tono. Il confine è dichiarato: **là** (§5.5) la contabilità e l'ordine, **qui** come si mostra.
Nessuno dei due scrive, nessuno dei due legge l'ora.

**Test.** nuovo `_pending_ops_test.mjs` (puro, `node`):

* **priorità totale**: `failed` batte `pending`, `pending` batte `saved` — su qualunque permutazione
  dell'ingresso (la priorità è una relazione d'ordine, non l'ordine di arrivo delle chiavi);
* `{ pending: 0, failed: 0 }` → nessuna frase con lo zero (un « 0 modifiche » a schermo è rumore, e
  nasconde il caso vero);
* `target: 'local'` → la frase continua a dire « questo poste soltanto »: il testo *esiste già*
  (`appSidebar.jsx:131`) ed è la metà onesta che c'è da tenere, non da reinventare;
* `pending: 3` → la frase **contiene** il 3: una cifra che non si legge non è una cifra;
* **una sola** frase per stato: nessuna coppia di etichette contraddittorie nella stessa riga.

**Prova d'accettazione.** `_pending_ops_test.mjs` → 0. Più un giro a mano, `[aperto]` finché non è fatto:
rete staccata, tre gesti, si legge « 3 modifiche da inviare »; rete rimessa, la cifra scende a zero.

**Rischio e ritorno.** Rischio: una riga di testo in più nella sidebar (spazio, non comportamento) e
l'onestà che costa — un `saved` che arriva **più tardi** perché aspetta la pubblicazione (§5.5). Ritorno:
il commit di E(i). Nessun dato toccato, nessuna scrittura su Drive.

#### 5.6.2 — E (ii) — L'avviso di chiusura: parlare **solo** se c'è qualcosa da perdere

**Cosa dice il codice d'oggi.** `[eseguito]` La ricerca esauriente su `src/` per `beforeunload` ritorna
**0 righe** (`_z_beforeunload.txt`): l'app **non chiede mai niente** alla chiusura. Quello che ha, invece,
sono **due** coppie di ascoltatori, entrambe su `pagehide` + `visibilitychange` — mai su `beforeunload`:

* `App.jsx:4205-4221` — `flushPendingSave()` (`:4205-4216`): annulla il minuto (`:4207-4210`), rilanci
  `runSave(true)` **urgente** (`:4214`) e poi spinge la copia (`:4215`);
* `App.jsx:5435-5448` — solo la copia (`flushDatasetCopy`, `:5436-5438`), con dipendenze vuote.

Il commento di `:5432-5434` è la memoria di un difetto già riparato **a metà**: *« un calcolo registrato e
un onglet chiuso negli 8 s non raggiungeva mai il Drive, e la pagina sembrava vuota sull'altro poste »*.
La rete aggiunta allora prende **una** scrittura su quattro: la **copia** — che §5.5 mette per ultima
perché è un ripiego, non una fonte. La **struttura** (ciò che il lettore legge per trovare le cartelle) e
l'**istantanea locale** (l'unica non interrompibile) restano senza rete. Ecco perché la cifra di §3c non
si è mossa.

**Cosa cambia — e cosa non cambia.** Non si sostituisce niente: `pagehide` e `visibilitychange` restano,
sono loro a **spingere**. Si **aggiunge** un `beforeunload` che chiama `preventDefault()` e
`event.returnValue = ''` **soltanto** quando `decideOnClose(unsent) === 'warn'`, cioè quando il conteggio
di §5.5 dice che qualcosa non è ancora arrivato. Il resto del tempo l'ascoltatore **non fa nulla** —
letteralmente: nessun `preventDefault`, nessun ritorno di valore.

**I due limiti, detti adesso.** (i) Il **testo** dell'avviso non è nostro: dal 2016 i browser ignorano la
stringa personalizzata e mostrano la loro; il piano promette il *gesto* di avviso, non la frase. (ii) Il
browser mostra il dialogo **solo** dopo un'interazione dell'utente e decide lui se mostrarlo: E(ii) è una
**voce**, non una garanzia — la garanzia è l'ordine (§5.5) e poi la coda (§5.8). Un avviso che non
compare non è un difetto di questa consegna; una scrittura persa **senza** che l'avviso sia stato chiesto
sì.

**Perché non avvisare sempre.** Un avviso che si accende a ogni chiusura è un avviso che nessuno legge
(ci si abitua, e lo si chiude per riflesso): è la stessa regola di §5.0 — si allarma quando si è
**provato** che c'è qualcosa da perdere. La cifra è il criterio, e `decideOnClose` è pura proprio perché
questo criterio si possa **provare** invece di sperare.

**La giuntura pura.** Non c'è una funzione nuova: E(ii) *usa* `decideOnClose` di `unsentChanges.js`
(§5.5). L'effetto (`App.jsx:4205-4231`) guadagna la registrazione dell'ascoltatore e la sua rimozione nel
`return` di pulizia (`:4222-4230`, dove già si tolgono gli altri due). Niente altro: **nessuna** scrittura
nuova a onglet chiuso, nessun `sendBeacon`, nessuna coda — quella è G (§5.8), e confonderla qui
significherebbe promettere due volte la stessa cosa.

**Test.** nuovo `_close_warning_test.mjs`, sul modello di `_save_in_background_test.mjs`:

* con `unsentChanges` **vuoto**, il gestore di `beforeunload` **non** chiama `preventDefault` (si
  intercetta l'evento con un finto `Event` e si guarda `defaultPrevented`);
* con **una** voce in sospeso, `preventDefault` viene chiamato **e** `returnValue` è impostato;
* il gestore **non** ferma gli altri ascoltatori (nessun `stopPropagation`, nessun `stopImmediatePropagation`);
* `pagehide` continua a fare il suo mestiere: il test esistente `_save_in_background_test.mjs` resta
  verde — è la prova che l'avviso è un'**aggiunta**, non un rimpiazzo.

**Prova d'accettazione.** `_close_warning_test.mjs` → 0 **e** `_save_in_background_test.mjs` → 0. Poi il
gesto a mano, `[aperto]`: un gesto, chiusura immediata → il browser chiede; nessun gesto → chiude senza
chiedere.

**Rischio e ritorno.** Rischio: un dialogo di troppo (guardato dal conteggio, non dal timer) e la
sensazione di essere « trattenuti » — per questo l'avviso **non** blocca il `flush`, che parte comunque.
Ritorno: il commit di E(ii). Il Drive non si tocca.

#### 5.6.3 — E (iii) — Il ripristino: la riparazione c'è, ma **non si vede** — e la guardia misura la frase sbagliata

**Cosa dice il codice d'oggi** `[letto]`. La riparazione esiste, ed è in **due metà** che non si
parlano.

*Metà 1 — le copie di riferimento dei dati* (`src/utils/driveRestore.js`). `restoreJsonFor` (`:375-390`)
e `restoreRawFileFor` (`:606-620`) cercano una copia in **tre posti, nell'ordine giusto** — il
**puntatore** scritto nel dataset, il **registro locale** del poste (`:296`), la **ricerca per nome** sul
Drive (`:300-319`) — e la scaricano con `downloadCloudFile` (`:327`). Un file in **corbeille viene
rimesso a posto prima di leggerlo**: `:339-342` e, se la lettura fallisce, di nuovo `:348` — è il gesto
del FCS, generalizzato. Il **dichiaratore automatico** è `useDriveAutoRestore.js`: portillon `hasCloudAccess()`,
**una sola riserva per esperienza e per sessione** (`claimRestore`), evento `lab:drive-connected`,
liberazione su un tentativo manuale. Sei moduli lo usano — NMR 1D, ssNMR, CD, docking, MD, microscopia —
e ognuno tiene un **bottone manuale** (es. `NMRSections.jsx:279`, « ⬇️ Restore from Drive »).

*Metà 2 — l'inventario della radice* (`src/utils/workspaceResync.js`). « ☀ RESYNC FROM DRIVE », in
**sola lettura** per dichiarazione: enumera tutto (paginazione compresa), confronta il Drive con ciò che
il poste conosce, **dice** ciò che manca o è mal riposto, e rende i contenuti recuperabili
(`recoverable.copyIds`). Il suo commento enuncia la regola: *« la réparation est un geste explicite, ce
module n'en prend aucun »*.

**Quattro cose che mancano, misurate.**

| # | Cosa manca | Prova di oggi |
|---|---|---|
| 1 | la riparazione **non si dice**: `downloadCloudFile` rende il file (o `null`), mai « era in corbeille » | `driveRestore.js:339-342`, `:357`; `restoreJsonFor` rende `{ data, file, id, name, source }` (`:386`) — `source` è la **provenienza**, non la **riparazione** |
| 2 | **32** operazioni Drive inghiottite da un `catch` vuoto | misure di oggi (`_z_catch_count.txt`): **73** `.catch(() => {})` in `src/`; **32** portano « Drive / dossier / … » sulla stessa riga; **24** `.catch(() => false)` **rendono già** un valore |
| 3 | il ripristino **non rimette a posto un dossier**: le ricerche di cartella escludono la corbeille (`… and trashed=false`, `driveUpload.js:784, 824, 906, 1806, 2844`) e un id fissato in corbeille **solleva** `PATH_DELETED` (`:1741`) — ma `untrashDriveFile` (`:849-865`, scritto *proprio* per « after the user deleted its old folder ») è chiamato **solo per i file** (`driveRestore.js:340, 348`; `FlowCytometrySections.jsx:2917, 2933`; `migrateTestImages.js:469`), **mai per una cartella** |
| 4 | la **guardia di E-iii è rossa per la frase sbagliata** | `node _drive_restore_test.mjs` → **1** `[eseguito]` (uscita 1), `AssertionError` a `ok (…:36:37)` sull'asserzione `:364-365` |

| 4 | la **guardia di E-iii è rossa per la frase sbagliata** | `node _drive_restore_test.mjs` → **1** `[eseguito]` (uscita 1), `AssertionError` a `ok (…:36:37)` sull'asserzione `:364-365` |

**#1 — la prova sta in ciò che la funzione *non* rende.** Il ramo `:339-342` **scrive**
(`untrashDriveFile`, `PATCH { trashed: false }`) e poi cancella la traccia (`candidate.trashed = false`):
chi chiama riceve il file e **non può sapere** che c'è stata una riparazione. L'unico messaggio che
l'utente vede oggi è il bottone che ha premuto: la riparazione più preziosa del sistema — un file che
*era* stato cancellato — è quella che si vede di meno.

**#2 — le 32, e cosa si perde.** Sono le scritture che lasciano il Drive incompleto **mentre l'utente
crede di aver salvato**, cioè lo stato che `driveMirrorMsg` denuncia in generale e che nessuno sa
contare in particolare. Le famiglie, con gli esempi peggiori:

| Famiglia | Righe | Cosa resta non detto |
|---|---|---|
| **invii** (struttura, traiettoria, energia, cariche) | `NMRMoleculeViewer.jsx:21373, 21382, 21392, 21440`; `MDSections.jsx:2931, 3861, 4063, 4267, 5049`; `RichTextEditor.jsx:212`; `TestShellRenderer.jsx:1013` | un file importato **non arriva** e la pagina non lo dice |
| **albero di cartelle di un invio singolo** | `driveUpload.js:660, 687` (`ensureDatasetFolderStructure`) | una spedizione « riuscita » senza il suo dossier |
| **rinomine** | `projectDetailModule.jsx:4622` (`renameDriveFilesFor`); `protocolsModule.jsx:227`; `Storage.jsx:128` | i nomi sul Drive restano i vecchi — **la gemella di D**, e la materia di ⑨ |
| **cancellazioni** | `testsModule.jsx:138, 140`; `activeTestModule.jsx:689, 691, 1020, 1021, 1022`; `projectDetailModule.jsx:1850, 1893, 5337`; `projectsModule.jsx:1276`; `protocolsModule.jsx:1174, 1175`; `Storage.jsx:646` | un dossier che *doveva* sparire resta, o viceversa |
| **igiene della radice** | `App.jsx:3729` (`cleanupWorkspaceRootFolders`); `UsefulFilesSection.jsx:126`; `DockingSections.jsx:350, 882` | un riordino che non è avvenuto |

Quattro righe vicine a questa tabella sono **continuazioni** (`.catch(() => {});` da sola sulla riga,
senza la parola « Drive ») e perciò **non** entrano nelle 32 contate: `DockingSections.jsx:350, :882`,
`testsModule.jsx:142`, `activeTestModule.jsx:693`. La misura è quindi un **limite inferiore** — 32 contate
+ 4 note a mano — e il test di (c) le elenca tutte a mano, una per una.

**#3 — il commento dice « completa », il codice fa « metà ».** `restoreDeletedProject` (`App.jsx:3470-3497`)
porta scritto *« 3° LE DOSSIER DRIVE AUSSI … la restauration est complète, pas à moitié »* (`:3478-3482`) —
e leva infatti le **tombe di percorso** (`withoutDrivePathTombstones`, `:3487`), cosa che nessun altro
faceva. Ma il dossier di `projects/<progetto>` resta **nella corbeille di Google**: la prima scrittura
successiva lo cerca per nome con `trashed=false` (`driveUpload.js:784, 824`) e non lo trova, quindi ne
**crea uno nuovo, con un id nuovo**. Due conseguenze, entrambe materia di ⑨: (i) un id letto altrove
designa un dossier che non si vede più; (ii) il registro del miroir lo dichiara « assente »
(`driveMirror.js:86, 131, 269, 276` → `!meta.trashed`), e un percorso **fissato** su quell'id solleva
`PATH_DELETED` — « The target folder is gone. » (`driveUpload.js:1741`). Il pezzo che manca **esiste già**
e non si sta usando: `untrashDriveFile` (`:849-865`), da chiamare **prima** di ricreare, **per id**.

**#4 — la guardia di E-iii, riga per riga.** L'asserzione esige:

```
import { archiveRestoreJson, downloadCloudFile, placeRestorePointer, restoreJsonFor, restoreStems,
         takePendingRestorePointer } from '../utils/driveRestore';         (_drive_restore_test.mjs:364)
```

e il modulo oggi dichiara (`DockingSections.jsx:20`) **la stessa riga più un nome** — `isRestoreFileName`,
aggiunto dal ripiego dei **file dichiarati** (`:536`), cioè il meccanismo **generale**
(`isRestoreFileName` vive nel noyau, `driveRestore.js:130`). L'asserzione confronta la **lista intera dei
nomi** con `includes()`: **un nome in più la fa fallire anche quando la proprietà difesa è rispettata**.
Le gemelle sono `:257` (NMR 1D), `:293` (ssNMR), `:329` (CD): verdi oggi **solo perché** nessuno ha ancora
aggiunto un nome. Una guardia che si rompe quando il codice *migliora* non è una guardia: è un ostacolo —
ed è per questo che i « 5 difetti » di §3d non si aggiustano da soli.

**Cosa cambia** — tre cose, in quest'ordine. Nessuna aggiunge una scrittura sul Drive.

**(a) La riparazione si dice — e il dossier torna dalla corbeille.** `untrashDriveFile` esiste, e
`downloadCloudFile` lo chiama **già** (`:340`, `:348`): non si aggiunge né una chiamata di rete né una
scrittura — si **conserva il fatto**. `candidate.untrashed = true` accanto al `trashed = false` di `:341`;
`restoreJsonFor` / `restoreRawFileFor` lo portano accanto a `source` (`:386`). Il testo esce da un modulo
**puro**, nuovo: `src/utils/restoreOutcome.js`.

| funzione | resa |
|---|---|
| `restoreLabel({ source, untrashed, name })` | « ripristinato da Drive: <nome> » / « … (era in corbeille: rimesso a posto) » |
| `restoreTone(outcome)` | `repair` per una riparazione, `note` per una semplice rilettura |

La riga di E(i) (`pendingOps.js`) mostra la riparazione con **priorità**: `failed` > `repair` > `pending`.
La stessa regola applicata al **dossier**: in `restoreDeletedProject` (`App.jsx:3470`), **prima** delle
tombe di percorso, si legge l'id dal registro del miroir e si chiama `untrashDriveFile(id)`; **solo se**
l'id non esiste più si lascia fare alla creazione (`resolveDrivePathFromNames`). Così il commento di
`App.jsx:3478-3482` (« completa, pas à moitié ») diventa vero, e un id letto altrove (⑨) continua a
designare **il** dossier del progetto invece di uno nuovo creato accanto a quello in corbeille.

**(b) La guardia misura la proprietà, non la frase.** In `_drive_restore_test.mjs` le quattro asserzioni
`includes('<importo letterale>')` (`:257`, `:293`, `:329`, `:364`) diventano un aiutante unico
`usesSharedRestore(src, needed)`, che verifica tre cose: (i) il modulo importa da `../utils/driveRestore`;
(ii) **ogni** nome che chiede esiste davvero fra gli export del noyau — si confronta con `driveRestore.js`
letto all'istante, non con una stringa scritta a mano; (iii) il percorso di ripristino del modulo non
contiene `fetch(`, né `/drive/v3`, né `getDriveToken` — il criterio già in uso a `:378` e `:741-742`. Un
modulo può così **guadagnare un nome** senza mentire su di sé, e un modulo che si fabbrica la restaurazione
in casa **fallisce come prima**. `src/` non si tocca: la guardia passa da **1 → 0** e smette di essere un
ostacolo per la consegna successiva — il noyau resta uno solo, che è ciò che conta.

**(c) Le scritture sorvegliate — un aiutante, una riga per sito.** Nuovo modulo **puro**
`src/utils/driveOps.js`: `reportDriveOutcome({ what, ok, err })` accumula gli esiti Drive della sessione,
`driveOpsLines()` rende le righe « ⚠ non è stato possibile <gesto> » — la stessa forma delle righe di C.
I **32** `catch` vuoti diventano una riga ciascuno,
`.catch((err) => reportDriveOutcome({ what: 'la figura del progetto', ok: false, err }))`, dove il `what`
**nomina il gesto in chiaro**. La consegna si divide, e si dichiara quale metà viene adesso.

- **(c1) adesso — 15 siti**, la famiglia degli **invii**, quella che lascia il Drive incompleto mentre
  l'utente crede di aver salvato: `NMRMoleculeViewer.jsx:21373, 21382, 21392, 21440`;
  `MDSections.jsx:2931, 3861, 4063, 4267, 5049`; `RichTextEditor.jsx:212`; `TestShellRenderer.jsx:1013`;
  `UsefulFilesSection.jsx:126`; `driveUpload.js:660, 687`; `App.jsx:3729`.
- **(c2) con C/D — 21 siti** (17 contate + le 4 continuazioni), la famiglia **rinomine e cancellazioni**:
  `projectDetailModule.jsx:1850, 1893, 4622, 5337`; `protocolsModule.jsx:227, 1174, 1175`;
  `testsModule.jsx:138, 140, 142`; `activeTestModule.jsx:689, 691, 693, 1020, 1021, 1022`;
  `projectsModule.jsx:1276`; `Storage.jsx:128, 646`; `DockingSections.jsx:350, 882`. Va **contata adesso**
  e riparata là, perché vuole il canale di C: il caso peggiore è `projectDetailModule.jsx:4622` —
  `renameDriveFilesFor` dopo la rinomina di un progetto, cioè la **stessa funzione che D governa** e la
  stessa materia di ⑨. `[aperto]`: l'elenco esatto dei chiamanti di `renameDriveFilesFor` (e di
  `renameTestFolderOnDrive`) lo chiudo con il giro di rinomina manuale dell'utente, che è anche la prova
  di D.

15 + 21 = **36** = 32 contate + 4 continuazioni: nessun sito misurato resta fuori dall'elenco.

**Test.** Un solo file nuovo, `_drive_repair_test.mjs` (in sola lettura, come i fratelli
`_unsent_changes_test.mjs` e `_close_warning_test.mjs`):

| tipo | cosa prova |
|---|---|
| **puro** | `restoreLabel` nei quattro casi (`source` = puntatore / registro / nome × `untrashed` sì/no); `restoreTone`; `reportDriveOutcome` + `driveOpsLines` (accumulo, ordine, stesso gesto ripetuto) |
| **statico** | (i) la lista **fissata** dei 15 siti di (c1) non deve più contenere `.catch(() => {})` né `.catch(() => false)` — il test legge `src/**` e **fallisce se uno ricompare**; (ii) `usesSharedRestore` per i sei moduli consumatori, con i nomi **presi dagli export reali** di `driveRestore.js`; (iii) in `restoreDeletedProject` l'`untrashDriveFile` viene **prima** di `withoutDrivePathTombstones` (prova d'**ordine**, non di presenza) |
| **d'invariante** | `_drive_restore_test.mjs` non confronta più i nomi importati come stringhe; il conteggio dei `catch` muti di `src/` scende **73 → 58** (i 15 di (c1)), numero fissato nel test come i « 5 difetti » di §3d |
| `[aperto]` manuale | (a) mettere una copia in corbeille, aprire la pagina in un profilo vergine → il dato torna **e la riga dice « era in corbeille »**; (b) cancellare un progetto e ripristinarlo → **lo stesso id** di dossier di prima (oggi: id nuovo, il vecchio in corbeille) |

**Accettazione.** `_drive_restore_test.mjs` → **0** (oggi **1** `[eseguito]`); `_drive_repair_test.mjs` →
**0**; `_workspace_resync_test.mjs` → **0** (il file non si tocca: è la prova che la riparazione non è
diventata un gesto automatico); `_unsent_changes_test.mjs` e `_close_warning_test.mjs` → **0** (E(i)/E(ii)
non toccati). **Fuori consegna, dichiarato:** i 21 siti di (c2) restano da sorvegliare con C/D — i quattro
della rinomina si riparano con D, perché è la stessa riga di codice.

**Rischio e ritorno.** *Rischio 1:* (a) rende **visibile** una scrittura che c'è già da sempre (l'uscita
dalla corbeille nel percorso di lettura, `driveRestore.js:340, 348`); un utente prudente potrebbe temere
che l'app tocchi la corbeille di Google — la risposta è che lo fa già, due volte per lettura, e che (a) le
mette soltanto un nome. *Rischio 2:* 15 siti toccati di una riga, in moduli diversi: la consegna si divide
in (c1)/(c2) e ognuna ha il suo elenco **fissato nel test**, così un `catch` che ricompare si vede subito.
*Rischio 3:* (b) **sembra** indebolire la guardia (non confronta più la frase esatta) — ma il confronto con
gli export **reali** del noyau è *più* severo di una stringa scritta a mano: si accorge anche di un nome
**inesistente**, cosa che l'`includes()` di oggi non fa. *Ritorno:* la riparazione più preziosa del sistema
diventa una frase che si legge; il Drive incompleto smette di essere silenzioso in 15 punti; il commento
« completa, pas à moitié » di `App.jsx:3478-3482` diventa vero; e la guardia di E-iii smette di essere un
ostacolo per la prossima consegna.

**Cosa E(iii) non fa.** Non introduce `appProperties` (è A), non sposta alcun dato esistente, non crea
nessun file sul Drive, non cambia il formato di `_meta.json`, non ricostruisce la copia mancante (la
**dice**), e non costruisce la coda: (c) accumula gli esiti della **sessione**, la **coda persistente** e il
`keepalive` sono G (§5.8).

### 5.7 — F — La prova severa: il verdetto diventa rosso **da sé**, e il conteggio smette di essere mozzato

**Cosa dice il codice d'oggi** `[eseguito]`. I due banchi della Fase 0 sanno dire la verità, ma la
dicono **solo a chi la chiede**. Rieseguiti su questo albero (15–16/10/2026), danno **lo stesso corpo**
con e senza bandiera: cambia **soltanto** il codice d'uscita.

| banco | riga di verdetto | `EXIT=` | con `--strict` |
|---|---|---|---|
| `_drive_sync_repro_test.mjs` | `MODE : BASELINE — défaut(s) constaté(s) : 5` · `DÉFAUTS : Q4, Q6, Q7, Q8, R` | `0` | **`1`**, corpo identico |
| `_drive_two_pc_random_test.mjs --seeds=20` | `MODE : BASELINE — facteurs sales (hors contrôle) : 9/9` | `0` | **`1`**, corpo identico |

Il meccanismo sta in tre righe, ed è esplicito: `const STRICT = process.argv.includes('--strict')`
(`_drive_sync_repro_test.mjs:36`, `_drive_two_pc_random_test.mjs:41`) e `process.exit(STRICT && difetti ? 1 : 0)`
(`:515`, `:372`). La suite non chiede **mai** quella bandiera: `_run_all.cjs:15` lancia ogni file con
`execFileSync(process.execPath, [f])`, **senza argomenti**, e nessuno script di `package.json` ne passa.
Ne segue l'inventario di ieri (`righe=164 | BAD=8`): i due banchi Drive più importanti risultano **`OK exit=0`**
(2 s e 17 s) mentre uno stampa `5 difetti` e l'altro `9/9 fattori sporchi`. Peggio: la sintesi che la suite
registra per il primo (`_z_suite_drive.txt:12`) è **una riga di log della pubblicazione**, non il verdetto,
perché il filtro di `_run_all.cjs:21` cerca `passed|PASS|FAIL|✗|error|Error` e nessuna di quelle parole compare
in `MODE : … / DÉFAUTS : …`.

**Cosa fa F.** Quattro righe di prova, nessuna di `src/`:

1. **Il modo documentato diventa quello severo.** `:36` e `:41` diventano
   `const STRICT = !process.argv.includes('--baseline')`: chi vuole il vecchio comportamento lo **scrive**.
   Le due intestazioni che spiegano i modi (`_drive_sync_repro_test.mjs:5-9`, `_drive_two_pc_random_test.mjs:5-11`)
   si aggiornano **nello stesso commit**, altrimenti il prossimo lettore prende `exit 1` per un ambiente rotto.
2. **La suite si assume il modo, di nome.** `_run_all.cjs` riceve una tavola esplicita: i due banchi ricevono
   `--strict` **esplicito** (cintura e bretelle: default severo *e* bandiera) e i seed fissi (`--seeds=20`,
   come il `:42` di oggi), così il numero del report è riproducibile; la sintesi (`:21`) impara le due parole
   dei banchi (`MODE :`, `DÉFAUTS :`), perché un `exit 1` deve arrivare in `BAD` **con la sua frase**, non muto.
3. **L'arruolamento** `[eseguito]`. La convenzione è dichiarata da un test: `_experiment_folder_files_test.mjs:590-592`
   pretende che il **proprio nome** sia dentro `probe_tests.txt`. Il file c'è — **134 righe** nella radice, tutte nomi
   di test (letto per nome: non compare in una ricerca sull'albero, quindi non si trova « a naso ») — e i due banchi
   della Fase 0 **non sono fra loro**: gli unici tre nomi che rispondono ai test Drive/ripristino sono
   `_canvas_file_restore_test.mjs` (riga 20), `_drive_restore_test.mjs` (riga 40), `_library_restore_test.mjs`
   (riga 54). F iscrive i due banchi **e** i due file di prova nuovi di §5 — `_drive_repair_test.mjs` (§5.6.3) e
   `_pending_queue_test.mjs` (§5.8) — così nascono arruolati: la glob di `_run_all.cjs:6-8` resta il motore,
   `probe_tests.txt` è la dichiarazione, e nessuna delle due è più una congettura.
4. **Il conteggio mozzato (⑧/⑨).** `scripts/drive-audit-live.mjs` legge con un tetto:
   `EXP_JSON_MAX = Number(ARGS.get('exp-json') || 40)` (`:334`) e `TWIN_JSON_MAX = Number(ARGS.get('twin-json') || 40)`
   (`:431`), e legge `idCandidates.slice(0, TWIN_JSON_MAX)` (`:436`) su **364** e **448** candidati (i due
   denominatori del run di §3c). L'audit è onesto a metà: la riga di ⑨ porta il rapporto
   (`:449`, `idRead/idCandidates.length`), ma il **verdetto finale** (`:455-457`) somma cinque liste **senza
   denominatore**, quindi « aucun jumeau » può voler dire « nessun jumeau fra i 40 letti ». F passa i due limiti
   al valore vero nel run di riferimento e mette il rapporto **dentro il verdetto**; e riallinea l'intestazione,
   che per i jumeaux annuncia `défaut 20` (`:41`) mentre il codice applica `40` (`:431`, come ripete il commento
   a `:430`).

**Il conto che tiene F e §3d insieme.** F **non ripara** i 5 difetti: li rende **rossi**. La sua accettazione
è quindi l'ultima della consegna, e si legge come la tabella di §5.6.3:

- `node _drive_sync_repro_test.mjs` → `DÉFAUTS : aucun`, `EXIT=0` (oggi: `5` difetti, `EXIT=0`);
- `node _drive_two_pc_random_test.mjs` → `facteurs sales … : 0/9` e `chiusura-precoce` `locali persi 0/20`
  (oggi `9/9` e `20/20`);
- suite: `BAD` da **8** a **7** (E(iii) chiude `_drive_restore_test.mjs`, `_z_suite_drive.txt:9`) e i due banchi
  `OK exit=0` **senza alcuna bandiera**;
- `[aperto]` manuale: nessuno nuovo — F non chiude i gesti a mano di §5.2–§5.6.

**Rischio e ritorno.** *Rischio 1:* F rende la suite rossa **finché A–E non sono dentro** — per questo è
**l'ultimo** punto di §5 (o si consegna con le due righe messe in quarantena, nominate e contate come fa §5.6.3).
*Rischio 2:* 17 s × 20 seed dentro una suite da 164 righe con `timeout: 180000` (`_run_all.cjs:15`): i seed vanno
**fissati**, non aumentati. *Rischio 3:* cambiare il default di un banco cambia il significato di « verde » per
tutti — l'intestazione aggiornata nello stesso commit è parte della consegna, non un extra. *Ritorno:* i due banchi
Fase 0 smettono di essere due stampe d'inchiostro e diventano la **prova di non-regressione** di tutta la Fase 1;
e la riga di verdetto dell'audit dice finalmente su **quanti** dossier ha guardato.

**Cosa F non fa.** Non ripara Q4, Q6, Q7, Q8, R (sono A–E) né i 9 fattori sporchi (C / D / E(iii) / G); non tocca
`src/`; non cambia il corpo dei banchi (le domande restano quelle di §3d); non alza i limiti dell'audit senza
scrivere nel report il numero e la bandiera usati; non chiude ⑦.

### 5.8 — G (seconda metà) — La coda che sopravvive alla pagina, e i 64 KiB che possono ancora partire

**Dove ci eravamo fermati.** §5.5 (G-min) è la **prima** metà di G, consegnata subito dopo D: scrivere il
magazzino locale **prima** delle attese di `runSave` (la rilettura della copia condivisa e la compressione,
`App.jsx:4110` e `4116`; §3a, §3c). Quella metà chiude `chiusura-precoce` **20/20 → 0/20**. La seconda metà —
questa — è tutto il resto del §3c: ciò che è **già partito** verso il Drive quando la pagina muore, e ciò che
**aspetta** in coda. Nessuna delle due tocca il formato dei dati.

**Il misurato** `[eseguito]`. `node _drive_two_pc_random_test.mjs --seeds=20` (BASELINE e STRICT, stesso corpo):
`esperienze perdute ANCHE nel magazzino LOCALE : 20/20`, e il banco dichiara da sé la lettura — « se la perdita è
n/n, la chiusura entro 1,5 s NON è riparata da `pagehide` » (`:353-354`). Il gesto è letterale (`:227-234`):
`armed = true` → `addExperiment()` → attesa di 25 ms (il minuteur di 5 ms è passato, la sauvegarde est parquée) →
`s.auto.killDuringSave()` → `openGate()`. La pagina muore **durante le attese**: niente è stato ancora scritto,
né magazzino locale né copia del dataset né albero.

**Cosa esiste già — e perché non basta** `[letto]`. Tre pezzi ci sono, ognuno con un motivo diverso;
**nessuno guarda la chiusura dell'onglet**:

- **la coda**: `pendingUploads.js` — `MAX_QUEUE_ITEMS = 60` (`:25`), `MAX_SINGLE_BYTES = 250 MB` (`:26`),
  `MAX_PENDING_AGE_MS = 30 giorni` (`:27`); `enqueuePendingUpload` (`:173`) scrive su IndexedDB
  (`idbPut` `:73`, che risolve su `tx.oncomplete` `:79`) e solo per i record `dataUrl` cade su `localStorage`
  (`:162`); `listPendingUploads` (`:230`) rilegge l'indice con la riserva `localStorage` (`:237-241`).
  **Ma ci entra solo ciò che ha già fallito**: l'unico `enqueuePendingUpload` del percorso d'invio è in
  `uploadLocalFile:2000-2010`, sotto `if (!last && !skipQueue && !deletedTarget)` — « ogni copia di cartella è
  fallita » (Drive irraggiungibile). Ciò che stava **aspettando** non ci entra mai.
- **il replay**: `flushPendingUploads` (`driveUpload.js:2052`) — una sola esecuzione per volta (`:2053`, e nessuna
  se il fornitore è `nextcloud`), token o rinnovo silenzioso (`:2060-2063`), scarta i record oltre i 30 giorni
  (`:2077`), **pretende che il dataset aperto sia lo stesso** (`:2082`), rispetta il back-off (`:2085`,
  `pendingRetryDelayMs` `:2040`), ripete con `skipQueue: true` (`:2097`), **cancella il record solo dopo il
  successo** (`:2099-2101`), poi annuncia `lab:pending-uploaded` (`:2103`). Tre inneschi, tutti « all'avvio »:
  al caricamento del modulo (`:2646`), su `lab:drive-connected` + 700 ms (`:2654`), dopo 3,5 s (`:2659`).
  **Nessuno alla chiusura.**
- **i ganci di chiusura**: esistono, ma solo per la **copia del dataset** tenuta in memoria — `App.jsx:4220`
  `pagehide → flushPendingSave`, `App.jsx:5442` `pagehide → flushDatasetCopy`, i tre punti che la spingono
  (`:4215`, `:5303`, `:5437`), `workspaceDrive.js:528-529` (e `:541-542` allo smontaggio), più
  `ImageBuilder.jsx:3422-3426` e `NMRMoleculeViewer.jsx:8114, 8127` per conto loro. I `pagehide|visibilitychange`
  di `src/` sono **21 linee reali in 4 file**: **nessuna** chiama `flushPendingUploads`.
- **e il filo verso la rete non è protetto**: `driveFetch` monta un `AbortController` con timeout
  (`driveUpload.js:263-264`) e passa `{...rest, signal, headers}` a `fetch` (`:267-271`). La parola **`keepalive`
  non compare in `src/`** (0 occorrenze su tutto l'albero): nessuna richiesta sopravvive alla morte della pagina,
  e a morire con lei è proprio la **scrittura piccola** — il `<oggetto>.json` / `_meta.json` della pubblicazione.
  Due percorsi la producono: `uploadDriveFileToFolderOnce` (`:1845-1852`, il multipart in una sola richiesta) e
  `uploadWorkspaceFile` (`:2873-2876`). Il resto (le copie grosse) ha una sessione « resumable » a parte
  (`:1828-1835`) e non è materia di questa consegna.

**Il progetto — tre pezzi, in quest'ordine, e nessuno cambia il formato dei dati.**

**G1 — `src/utils/pendingQueue.js` (nuovo, puro, caricabile in node).** La *decisione* della coda, senza I/O:
`KEEPALIVE_MAX_BYTES = 64 * 1024` (il limite dei browser per `fetch(…, { keepalive: true })`: oltre, la richiesta è
**rifiutata**, non troncata); `planDispatch({ bytes, online })` → `'keepalive' | 'queue' | 'drop'` **con la ragione**,
specchio fedele dei tre cap di `pendingUploads.js:25-27`; `nextAttemptDelay(attempts)` con **la stessa** formula di
`pendingRetryDelayMs` (`driveUpload.js:2040`), così prova e runtime non possono divergere; `dropOldest(records, extra)`
per il cap dei 60. Perché un file **nuovo** e non `pendingUploads.js`: quello fa I/O (IndexedDB, `localStorage`) e non
si carica in un test node, e la parte che sbaglia è proprio la **decisione**. La consegna **corregge la tabella di
§5.0**: `pendingQueue.js` non è « la coda » (esiste già), è la sua decisione.

**G2 — `keepalive` dove può servire, e il timer che non deve abortirlo.** `driveFetch` spreadda `...rest`
(`:250`, `:267-271`): `keepalive` **passa già** a `fetch` se un chiamante lo mette negli `opts` — quindi la firma non
si tocca: si **decide** (G1) e si **passa** nei due multipart piccoli (`:1851`, `:2876`), e **solo** ≤ 64 KiB. Una
riga obbligatoria in `driveFetch:263-264`: `const timeout = controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;`
— oggi `timeout: 0` abortirebbe **all'istante**, e una richiesta `keepalive` non deve portare addosso il **nostro**
timer (quello del browser è un altro, ed è il solo che conta quando la pagina muore).

**G3 — la quarta sorgente di replay, e l'arruolamento di ciò che non è partito.** In `driveUpload.js`, accanto a
`:2646-2659`: `pagehide` (e `visibilitychange → hidden`) chiamano `flushPendingUploads()` **una volta**, senza `await`
nell'handler — il drain è già protetto da `flushPendingInFlight` (`:2053`) e il replay è già idempotente perché il
record si cancella **solo dopo il successo** (`:2099-2101`). Dentro il replay, la stessa `planDispatch` ammette
`keepalive` per i record piccoli (i `dataUrl` e i JSON di metadati) e lascia i file grossi « al prossimo avvio », che è
ciò che la coda promette già oggi. E l'**arruolamento**: ciò che E dichiara non inviato ha già la sua copia locale
(§5.6.3, gruppo (a)); G aggiunge che, se `planDispatch` dice `'queue'`, quel record entra **anche** in coda
(`enqueuePendingUpload`, `:173`) — due copie, e la coda lo ripesca al prossimo avvio. Il guardiano
`item.datasetId === currentAnchor.datasetId` (`:2082`) **non si allenta**: un record di un altro dataset aspetta,
perché l'alternativa è scrivere nel dossier sbagliato (stessa materia di D2 in §5.6.3).

**Test.** Due prove, e una sola è nuova:

- **puro** — `_pending_queue_test.mjs` (nuovo, node, nessun browser) su `pendingQueue.js`: 63 999 byte → `keepalive`,
  65 536 → `queue`; cap dei 60 record e dei 250 MB; `nextAttemptDelay` confrontato con i valori di
  `pendingRetryDelayMs` per 0…5 tentativi; `dropOldest`. **Statico**: il test legge `pendingUploads.js` e verifica che
  i tre cap letti là (`:25-27`) siano **gli stessi letterali** di `pendingQueue.js`, così le due copie non possono
  divergere in silenzio.
- **misura** — `_drive_two_pc_random_test.mjs` deve guadagnare il **secondo** gesto che oggi non ha: la chiusura
  **dopo** la scrittura locale. Oggi `chiusura-precoce` uccide la pagina durante le attese (`:227-234`) e il banco
  stesso dice che così `pagehide` non c'entra; il gesto di G è `killDuringSave()` **dopo** l'`await` del magazzino
  locale ma **prima** della pubblicazione. La réplica va in `_harness/two-pc.mjs` come tutto il resto (il banco
  dichiara di replicare **letteralmente** l'autosauvegarde): nuovo contatore `ripresiDallaCoda` (n/20), con i numeri
  che esistono già riusati come misura — `lostLocal` (`:449`) e `earlyClose.localIds` (`:236-244`, `:418`).

**Accettazione.** `_pending_queue_test.mjs` → **0** asserzioni fallite; `_drive_two_pc_random_test.mjs` →
`locali persi 0/20` con `ripresiDallaCoda 20/20` (il numero esatto lo **fissa** la consegna, come i `5 difetti` di
§3d e il `73 → 58` di §5.6.3); `_drive_sync_repro_test.mjs --strict` → exit 0 (Q4/Q6/Q7/Q8/R sono A–E); suite: i due
banchi `OK exit=0` **senza bandiera** (è F, §5.7). `[aperto]` **manuale, e il banco dice da sé perché**: la chiusura
vera la prova l'utente — aprire l'app, rinominare, chiudere l'onglet entro ~1 s, riaprire: la rinomina c'è e la
console dice che la coda è stata ripescata. (Il banco non può dimostrarlo: `pagehide` lo decide il **navigatore**.)

**Rischio e ritorno.** *Rischio 1:* un corpo `keepalive` oltre i 64 KiB è **rifiutato** — per questo la decisione è una
funzione pura provata (G1) e i file grossi restano fuori. *Rischio 2:* una quarta sorgente di replay potrebbe spedire
due volte: le tre guardie già presenti (`flushPendingInFlight` `:2053`, `skipQueue: true` `:2097`, cancellazione solo
dopo il successo `:2099-2101`) rendono il replay idempotente **per costruzione**, e il test puro lo verifica sui
record. *Rischio 3:* `visibilitychange → hidden` scatta anche al semplice cambio di scheda — l'handler **non** fa
`await` e chiama la stessa funzione protetta, quindi il costo è quello di un drain già in corso. *Ritorno:* la perdita
`20/20` prende la sua seconda linea di difesa (il magazzino locale è la prima, §5.5) e `lab:pending-uploaded` (`:2103`)
dice all'app ciò che è tornato.

**Cosa G non fa.** Non rende atomica la copia del Drive e non introduce `updatedAt`/revisioni (è la **FASE 3**); non
cambia il formato di `_meta.json` (A); non riapre E(i)/E(ii); non promette che una richiesta **grossa** già partita
muoia consegnata — quella si **accoda prima** e si riprende al prossimo avvio; non allenta il guardiano del dataset
(`:2082`); non tocca il percorso Gmail (`:3282-3285`); non chiude i gesti a mano di C e D.
