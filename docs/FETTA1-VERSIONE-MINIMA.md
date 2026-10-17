# Fetta 1 — blocco delle pagine vecchie (5 minuti di lavoro, 3 giorni di osservazione)

Scopo: **nessuna pagina aperta prima di una correzione può più scrivere**. È la
pagina del 16/10 (aperta prima dell'8/10 18:01) che alle 15:22:03 ha scritto
23.117 byte sull'indice, dopo il logout.

## Cosa è già nel codice (fatto, non ancora distribuito)

1. **La pagina dichiara la sua età.** `vite.config.js` fissa `__APP_BUILD_AT__`
   (ms) al momento della compilazione; `src/utils/labAuth.js` lo manda a ogni
   accesso (`build`) insieme all'impronta del commit (`commit`).
2. **Il server rifiuta le pagine troppo vecchie.**
   `server/token-server.js` confronta `build` con la variabile d'ambiente
   `MIN_APP_BUILD_AT` (0 = nessun rifiuto, comportamento di oggi) e risponde
   `426 client_too_old` con un messaggio che dice di ricaricare.
3. **Il gettone porta la versione.** La pretesa (`claim`) `appBuild` /
   `appCommit` è firmata dal server: le regole Firestore possono esigerla senza
   chiedere nulla al browser (una pagina vecchia non può mentire sulla sua età).

## Ordine di distribuzione (importante)

1. Distribuisci **prima** la pagina nuova (`npm run build` + deploy come sempre).
2. Apri l'app, accedi, e verifica nei log del server che `build` arrivi
   (`[auth] page trop ancienne…` compare solo quando la soglia è attiva).
3. Solo allora imposta `MIN_APP_BUILD_AT` = l'istante del deploy, in
   millisecondi (es. `1760770000000`), e riavvia il servizio.
4. Facoltativo ma decisivo (vedi sotto): pubblica la regola Firestore.

Se sbagli la soglia e nessuno entra più, riporta `MIN_APP_BUILD_AT` a `0`:
è l'unico interruttore.

## Perché la regola Firestore è quella che chiude davvero

Un gettone Firebase già emesso vale **1 ora** e si rinnova da solo: bloccare
l'accesso non spegne una pagina già connessa. La regola, invece, viene
applicata a ogni scrittura:

```
match /artifacts/{appId}/public/data/datasets/{datasetId} {
  allow read, write: if request.auth != null
    && request.auth.token.lab == true
    && request.auth.token.appBuild >= 1760770000000;  // = MIN_APP_BUILD_AT
}
```

Pubblica la regola **dopo** aver verificato che la pagina nuova porta un
`appBuild` maggiore o uguale alla soglia. Da quel momento la pagina del 15/10
non può più scrivere: il suo gettone non ha la pretesa, e non può inventarla.

## Come si verifica che ha funzionato

- La sorveglianza (`watch-writer.mjs`, log fuori repo) non deve più vedere
  scritture con l'utente di quella pagina dopo l'ora della soglia.
- Nella barra laterale la versione mostrata (`build <commit>`) deve essere
  quella del deploy: se è diversa, la pagina è vecchia.
- `node server/self-test.js` → 31/31 (il rifiuto è spento per difetto, quindi
  il test resta verde).
