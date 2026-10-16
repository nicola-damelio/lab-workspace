/* =========================================================================
   _harness/README.md — CE QUE VAUT LE FAUX DRIVE, ET CE QU'IL NE VAUT PAS.

   ⚠ EN FRANÇAIS commequ le reste du dépôt ; le rapport de la FASE 0
   (docs/DRIVE-SYNC-FASE0.md) est en italien, pour toi.

   ## Ce qui tourne ici

   `_harness/two-pc.mjs` monte un faux Drive en mémoire (`fake-drive.mjs`) et
   deux postes (« PC A », « PC B ») qui ont chacun leur magasin local. Le CODE
   RÉEL de l'app est exécuté : le crochet `real-upload-hook.mjs` charge
   `src/utils/driveUpload.js` TEL QUEL (là où `_esm_test_hook.mjs`, lui, le
   remplace par un bouchon). Seuls sont faux : `fetch` (le Drive), `localStorage`
   (le magasin du poste), `window`/`document` (minimaux) et le serveur de jetons.

   Ce qui est donc VRAI dans ces tests : les requêtes (`q`, `fields`, `pageSize`,
   `pageToken`), la reprise sur 401, le retry réseau, la création/renommage/
   déplacement/corbeille, les empreintes, le miroir, la copie du dataset.

   ⚠ **16/10/2026 — un défaut du faux Drive a été corrigé** (`splitClauses` :
   `i += String(longueur - 1)` faisait de `i` la CHAÎNE « 174 », la boucle
   s'arrêtait et **toutes les clauses après la première étaient perdues** : une
   recherche `name='x' and '<dossier>' in parents` ignorait le dossier, donc
   « le premier du nom » n'importe où était rendu — et l'adoption par identité
   lisait la description d'un AUTRE dossier). Les résultats d'avant cette date
   sont donc refaits. `createAutosaveReplica` sait maintenant ce qui précède
   l'écriture LOCALE (`hooksBeforeWrite`, `killDuringSave`, `reopenSession`,
   `localExperiments`, `storeKey` — App.jsx:4110/4116/4177-4185), et la copie du
   dataset s'écrit DANS le contexte du poste (sinon sa temporisation rendait les
   globaux et la copie partait « not connected »).

   ## Usage

   ```js
   import { createHarness, createAutosaveReplica } from './_harness/two-pc.mjs';
   const h = await createHarness({ seed: 1, datasetName: 'MON DATASET', datasetId: 'ds1' });
   const A = h.pcs[0];
   await A.do((M) => M.structure.publishDatasetStructure({ datasetId: 'ds1', datasetName: 'MON DATASET', data }));
   h.drive.live(); h.drive.twins(); h.drive.pathOf(id); h.drive.stats;
   ```

   ## Les limites, dites franchement

   1. **Un seul poste à la fois.** Un processus Node n'a qu'un couple
      (`localStorage`, `fetch`) : `pc.do()` passe donc par une FILE GLOBALE
      (`queued`) et attend son tour. La « simultanéité » de deux postes est
      reproduite par la FENÊTRE DE COHÉRENCE (l'un ne voit pas encore l'écriture
      de l'autre) — c'est le mécanisme réel du défaut des jumeaux, mais ce n'est
      pas deux requêtes en parallèle.
   2. **Pas d'imbrication** : un `pc.do()` appelé à l'intérieur d'un autre
      attendrait sa propre fin. Les tests n'imbriquent jamais.
   3. **Le jeton n'expire pas par le temps** : c'est `pc.expire()` qui le dit
      (`drive.expireToken`). Le renouvellement passe par le serveur de jetons
      simulé ; `drive.setTokenServer('down')` le coupe.
   4. **Un harnais neuf = une session neuve** : `createHarness` vide les caches
      de module de `driveStructure` (empreintes, `_meta.json`, chemins). Sans
      cela, un scénario « héritait » du précédent (constaté).
   5. **La réplique de l'autosave attend sa publication** alors qu'App.jsx ne
      l'attend pas : dans un navigateur il n'y a rien à attendre, ici les globaux
      du poste seraient rendus trop tôt. Ce n'est PAS un changement de
      comportement de l'app (c'est commenté sur place).
   6. **`pagehide` n'est pas déclenchable ici** : on prouve que la fonction que
      l'événement appelle écrit vraiment ; le déclenchement réel appartient au
      navigateur (à vérifier à la main).
   7. Le faux Drive REFUSE une requête qu'il ne comprend pas (`unsupportedQueries`)
      et une route inconnue (`unrouted`) au lieu de répondre à côté. Les tests
      l'exigent : un harness qui devine rendrait tous les résultats faux.
