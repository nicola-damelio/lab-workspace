# Fase 1 — una pagina sola (16/10/2026)

Niente nomi di file: solo quello che cambia per te. **Non ho toccato il codice
dell'app.** L'unica cosa modificata è **l'audit**, al quale ho aggiunto: un limite di
velocità (una richiesta ogni 200 ms), una ripresa automatica se il Drive risponde
«troppo traffico» (429/403/5xx, attesa crescente) e, per **ogni** controllo, la
dichiarazione di **quanti** elementi sono stati letti su quanti esistono.

---

## 1) Audit vero, sul Drive vero — cosa c'è davvero

**Copertura:** percorso completo del dataset `GEC-UPJV-projects` = **509 cartelle e
2 007 file** letti, senza tetti raggiunti. **872 richieste, tutte in lettura, 0
scritture**, una ogni 200 ms, **0 riprese** (il Drive non ha mai protestato). Eseguito
il 16/10/2026 fra le 15:53 e le 16:03.

| Controllo | Letti / esistono | Cosa ho trovato |
|---|---|---|
| Cartelle con lo stesso nome | 509 / 509 (287 gruppi «genitore») | **0** |
| Cartelle fuori piano **con file dentro** | 349 cartelle contengono file, su 509 lette | **113** — sono cartelle di sezione che contengono file (il piano le prevede vuote) |
| Doppioni di rinomina sotto i progetti | 466 cartelle confrontate a due a due | **0** |
| Esperienze senza progetto | 364 cartelle di esperienza | **0** |
| File «vecchio nome».json senza cartella viva | 620 file letti | **463 segnalati — numero da rifare** (vedi note) |
| Progetti cancellati il cui dossier c'è ancora | **0 tombe pubblicate** | **0 su 0**: niente da confrontare |
| Copie del dataset | 10 copie, tutte lette e decompresse | tabella sotto |
| Esperienze dell'albero mancanti dalla copia | **364 / 364** cartelle lette (completo) | per la copia **del tuo dataset**: **20 mancanti** su 109 riconoscibili; **255** cartelle senza identificativo leggibile |
| Un oggetto in più cartelle | **448 / 448** cartelle esaminate (179 con id leggibile) | **54 oggetti** stanno in più cartelle: uno in **11**, uno in **10**, uno in **9** |

**Quello che NON posso affermare (e perché):**

- **255** delle 364 cartelle non portano un identificativo leggibile: su quelle non dico
  né presente né assente. Sono il **70 %** delle cartelle di esperienza: è il limite più
  grande di questo audit.
- Il controllo sui 463 file conta solo le cartelle di esperienza di quarto livello, quindi
  **non riconosce** quelle di terzo livello (progetto → esperienza). Gli esempi mostrano
  file che hanno la loro cartella proprio lì: **463 non è un elenco di residui**, è un
  numero da rifare con una regola corretta (una riga di audit, non un cambiamento dell'app).
- Il controllo sulle tombe non ha copertura: oggi non c'è **nessun** progetto in tomba.
- Il controllo sulle copie confronta l'albero del tuo dataset con **tutte** le copie
  presenti, comprese quelle di **altri** dataset (amministrazione): per quelle il «109
  mancanti» non significa nulla. Conta solo la riga del tuo dataset (20 mancanti).
  Ho aggiunto all'audit una riga che stampa il nome del dataset di ogni copia: oggi
  **nessuna** copia lo porta dentro di sé (vedi la nota alla tabella).

### Le 10 copie presenti

| Copia | Peso | Compressa | Esperienze | Progetti | Di chi è | Mancanti dall'albero |
|---|---|---|---|---|---|---|
| 1788541255238 | 0,22 MB | sì | 0 | 0 | amministrazione | 109 * |
| **1788383774488** | **0,92 MB** | **sì** | **88** | **15** | **il tuo dataset** | **20** (su 109) |
| 1791542543845 | 0,23 MB | sì | 0 | 0 | amministrazione | 109 * |
| 1791477871371 | 0,69 MB | sì | 81 | 0 | altro dataset | 45 * |
| 1791537955393 | 0,23 MB | sì | 0 | 0 | amministrazione | 109 * |
| 1791477979386 | 0,69 MB | sì | 81 | 0 | altro dataset | 45 * |
| 1791477845403 | 13 kB | sì | 1 | 0 | altro dataset | 109 * |
| 1788713576525 | 47 kB | sì | 4 | 1 | altro dataset | 109 * |
| 1791285646162 | 19 kB | sì | 1 | 1 | altro dataset | 109 * |
| 1789649121758 | 13 kB | sì | 1 | 0 | altro dataset | 109 * |

\* riga **senza significato**: il tuo albero confrontato con la copia di un altro dataset.
L'attribuzione «di chi è» è dedotta dai numeri di dataset scritti nei nomi dei backup
locali: **la carica delle copie non porta il nome del dataset** (verificato: nessuna delle
10 lo contiene), quindi il nome del file resta l'unica traccia. La riga che ho aggiunto
all'audit stampa quel nome quando c'è — e dice quando manca.
Prova incrociata che la copia da 0,92 MB è la tua: 109 − 20 = **89** identificativi
presenti, e la copia contiene **88** esperienze — i due numeri coincidono.

### «L'albero ha centinaia di esperimenti, la copia pesa poco»: cosa è vero e cosa no

- **Non pesa poco**: la copia del tuo dataset pesa **0,92 MB** e contiene **88 esperienze
  e 15 progetti**. La copia è **compressa** (circa 5 volte più piccola del testo che
  rappresenta): è questo il motivo della differenza di peso, non una perdita di dati.
- **«Centinaia di esperimenti» è la misura a essere gonfiata**: le 364 sono cartelle a
  profondità ≥ 4 sotto i progetti — istanze, sezioni, sottosezioni comprese — non
  esperimenti. Il numero vero sta nella copia: **88 esperienze in 15 progetti**.
- Le copie da 13-239 kB con 0-1 esperienze sono copie di **altri** dataset, fra cui i tre
  dataset di **amministrazione**, che per definizione non contengono esperienze.

---

## 2) Piano A–G, tre righe per punto

**A — la cartella sa chi è.** *Per te:* niente da vedere; da qui in poi, se una cartella
viene rinominata, l'app la **riconosce** invece di crearne una seconda (è la causa dei 54
oggetti in più cartelle). *Rischio:* una scrittura in più per cartella, un po' più lenta;
si tocca *come* si scrive, non i dati. *Ritorno + tua prova (2 min, due finestre):*
commit; crea un'esperienza → rinomina **a mano** la sua cartella sul Drive (aggiungi una
«x») → riapri l'app: deve restare **quella** esperienza, senza doppioni.

**B — i nomi alla nascita.** *Per te:* un oggetto nuovo non nasce più con il nome di uno
già esistente («Test 3» → «Test 4»); cambia **solo** nei casi di collisione. *Rischio:*
quando c'è un omonimo, il nome che ti aspetti può arrivare diverso. *Ritorno + prova
(1 min):* commit; crea un'esperienza dove ne esiste già una con quel nome → il nome non
si ripete; cancellane una di mezzo e creane una nuova → niente nome ripetuto.

**C — la cancellazione.** *Per te:* prima di cancellare leggi **cosa** sparisce (cartelle,
file, allegati, se è recuperabile) e dopo **vedi** se è andata o no; l'unico modo resta il
cestino. *Rischio:* basso — nessuna cancellazione definitiva nuova, cambia il testo della
domanda. *Ritorno + prova (1 min):* commit; cancella un'esperienza → leggi l'elenco nella
domanda → conferma → leggi l'esito e guarda il cestino del Drive: la cartella è lì.

**D — il nome entra nel modello alla conferma.** *Per te:* la struttura si pubblica
quando **esci dal campo** del nome (o premi Invio), non a ogni battuta. *Rischio:* se
scrivi e chiudi la finestra **senza uscire dal campo**, quella battuta si perde (resta il
nome vecchio). *Ritorno + prova (1 min):* commit; scrivi un nome senza uscire dal campo →
sul Drive non compare niente di nuovo; esci dal campo → compare.

**G-min — scrivere per prima la copia locale.** *Per te:* chiudere la finestra non perde
più il lavoro (oggi perde **20 volte su 20**) e alla riapertura l'app ripubblica da sola.
*Rischio:* «salvato» arriva un po' più tardi (aspetta la pubblicazione). *Ritorno + prova
(2 min, due finestre su un PC):* commit; modifica in una finestra → **chiudi subito** →
riapri: la modifica c'è.

**E(i) — la riga di stato permanente (il «banner»).** *Per te:* vedi sempre quante
modifiche restano da inviare («3 modifiche da inviare») e «salvato» non mente più.
*Rischio:* una riga di testo in più; nessuna scrittura nuova. *Ritorno + prova (1 min):*
commit; stacca la rete → tre gesti → leggi la cifra → rimetti la rete: la cifra va a zero.

**E(ii) — l'avviso di chiusura.** *Per te:* il browser chiede conferma **solo** se c'è
davvero qualcosa di non inviato. *Rischio:* un dialogo di troppo; il testo dell'avviso lo
sceglie il browser, non noi (è una voce, non una garanzia). *Ritorno + prova (1 min):*
commit; un gesto e chiudi subito → il browser chiede; nessun gesto e chiudi → non chiede.

**E(iii) — il ripristino.** *Per te:* dopo un guasto (file perso o nel cestino) la
riparazione **si vede** e si propone. *Rischio:* proporre un ripristino sbagliato se la
guardia misura la frase sbagliata (è il difetto individuato). *Ritorno + prova (1 min):*
commit; cancella un file dentro un'esperienza → riapri → l'app propone di rimetterlo.
Prima di consegnare E serve la prova sul Drive vero.

**F — il verdetto severo.** *Per te:* i banchi dicono **rosso da soli** e l'audit non
mozza più i conteggi (364/448 invece di 40/40). *Rischio:* la suite resta rossa finché i
difetti attesi ci sono — è voluto. *Ritorno + prova (1 min):* commit; lanci il banco →
oggi rosso, con l'elenco dei difetti **attesi per fase**; verde solo quando i difetti
presenti sono esattamente quelli attesi e nessuno di nuovo.

**G (completo) — coda e invio all'ultimo istante.** *Per te:* le modifiche non inviate si
ritentano alla riapertura; l'ultimo invio tenta di partire anche mentre chiudi. *Rischio:*
l'invio all'ultimo istante **dipende dal browser** (è un extra, non la garanzia); una coda
scritta male riproverebbe gli errori nello stesso ordine sbagliato. *Ritorno + prova:* si
consegna **solo se**, dopo G-min, resta una perdita dimostrata; prova = la stessa prova di
G-min, ma con la rete staccata.

---

## 3) Le decisioni che servono da te (con la mia raccomandazione)

1. **Le lettere.** Le tue fette usano le lettere con un contenuto diverso dal documento:
   nel documento **B** = nomi alla nascita, **C** = cancellazione, **D** = nome alla
   conferma; «niente errori ingoiati + ritentativi» **non** è D (quel difetto sta dentro C
   e dentro G). *Raccomando:* Fetta 1 = **A + B + C** del documento; i ritentativi su
   403/429/5xx in una voce separata **«D-bis»**, dentro la stessa fetta (non tocca i dati,
   sono solo riprove dopo un guasto di rete). Dimmi **sì** o correggi le lettere.
2. **Le fette come le hai scritte.** *Raccomando:* Fetta 1 = A + B + C (+ D-bis);
   Fetta 2 = **G-min + E(i)** (nel documento il «banner» è E(i), non B); Fetta 3 =
   E(ii) + E(iii), e **solo per i casi confermati** dalla prova sul Drive vero; **G
   completo** solo se dopo la Fetta 2 resta una perdita dimostrata.
3. **I 463 file** segnalati dal controllo ⑤ vanno rifatti con la regola corretta
   **prima** di toccare qualsiasi cosa sul Drive? *Raccomando sì*: è lavoro di audit (una
   riga), non un cambiamento dell'app, e senza quello non sappiamo quanti residui veri ci
   sono.
4. **Le soglie 0,2 s e 0,5 s.** Non esistono nel banco: esprime 0 s, 1 s e 10 s. Non le
   lascio «aperte» senza motivo. *Raccomando:* aggiungere i due fattori brevi al banco
   (poco lavoro, e finalmente quelle due cifre misurano qualcosa) **oppure** toglierle dal
   documento. Scegli tu quale delle due.
5. **La suite prima di dire «verde».** Nei 448 file raccolti ci sono anche una ventina
   delle mie sonde di lavoro e ci sono **13 processi rimasti appesi** dalle prove
   precedenti. *Raccomando:* escludere le sonde dalla raccolta e chiudere i processi
   adesso, prima di dichiarare qualsiasi cosa «verde» a fine fase.

## 4) Le cose chieste, una riga ciascuna (se non già consegnate)

- **Firestore:** contiene il **contenuto** del dataset (esperienze, progetti, chiavi,
  tombe), compresso; scritto 1,5 s dopo l'ultima modifica e svuotato alla chiusura della
  pagina. Può essere la fonte di verità **del contenuto**, **non** del legame con le
  cartelle del Drive: quel legame oggi non esiste (l'app non scrive nessuna proprietà di
  identità). E non protegge dalla chiusura anticipata: quella è G-min.
- **Test di contratto del finto Drive:** consegnato e **verde** — 32 richieste su 32
  identiche al Drive vero (ordine compreso), 4 dichiarate non confrontabili; il finto
  Drive **non lascia passare nulla in silenzio**: rifiuta e conta.
- **Tabella operazione → percorso:** consegnata (10 gesti, con il gesto che tocca più
  percorsi in una volta).
- **Semantica del cestino:** consegnata — tre gesti distinti, e **uno solo** cancella
  senza che tu lo chieda (la riparazione di un nome già occupato, con il conteggio dei
  figli spostati dichiarato).
- **Soglie di ritardo 0,2/0,5 s:** non consegnate (vedi decisione 4).
- **Esito della suite intera:** **448 file raccolti, 28 falliti**. Dentro: 5 test veri
  dell'app che falliscono (uno è il guardiano del ripristino: va tenuto, non ammorbidito),
  11 sonde raccolte senza argomenti, 3 sonde rotte per costruzione, 1 guardia che esce «1»
  di proposito; il resto sono mie sonde di lavoro. La suite **non è verde**, e non lo sarà
  finché i difetti non sono classificati per fase (è esattamente ciò che F mette in atto).

---

**Mi fermo qui: aspetto il tuo OK** prima di toccare il codice. Dopo l'OK: Fetta 1
(A + B + C + D-bis) con commit, test e la tua prova manuale prima di passare alla
Fetta 2.


