# Le Drive est le miroir du programme

Ce document décrit ce qui fait qu'aujourd'hui **tous les postes voient la même
chose**, où cela vit sur Google Drive (ou Nextcloud), et pourquoi **ce qui est
supprimé ne revient pas**.

## Le dépôt sur le Drive

```
Lab Workspace/
├── _workspace/                      ← la mémoire de l'application (jamais vos données brutes)
│   ├── state.json                   ← liste des datasets, des projets, suppressions, dossiers
│   ├── keys.json                    ← tout ce qui vivait dans le navigateur (publications, figures…)
│   └── datasets/
│       └── ds_<dataset>.json        ← le CONTENU d'un dataset (charge compressée comprise)
├── <dataset>/                       ← nommé d'après le titre du dataset (le dossier est RENOMMÉ avec lui)
│   ├── projects/<projet>/           ← expériences, figures, <projet>_document.json, useful_files
│   ├── protocols/<protocole>/
│   ├── backups/                     ← instantanés HTML du dataset
│   ├── storage/
│   └── publications/
└── ...
```

`_workspace` est réservé à l'application : vos dossiers de datasets ne sont
jamais mélangés à cette mémoire.

## Ce qui se passe quand vous agissez

| Geste dans le programme | Sur le Drive |
| --- | --- |
| Supprimer un dataset | son dossier `<dataset>/` part à la **corbeille** (fichiers compris) et une **pierre tombale** est écrite dans `_workspace/state.json` |
| Supprimer un projet | `<dataset>/projects/<projet>/` part à la corbeille + pierre tombale du chemin |
| Renommer un dataset | `<ancien titre>/` est **renommé** en `<nouveau titre>/` (jamais un second dossier) |
| Renommer un projet | le dossier du projet **et** son `<projet>_document.json` sont renommés |
| Supprimer une expérience / un protocole | le dossier de l'expérience / du protocole part à la corbeille |
| Créer ou modifier un dataset | son contenu est déposé dans `_workspace/datasets/ds_<id>.json` (différé, ~8 s après la dernière frappe) |
| Modifier un texte, une figure, une liste | `_workspace/state.json` / `_workspace/keys.json` sont réécrits (différé) |

## Pourquoi rien ne « ressuscite »

Une suppression laisse une **pierre tombale** (`src/utils/driveMirrorStore.js`) :
`{ id du dataset | nom, chemin, date }`. Elle est écrite dans ce navigateur **et**
dans `_workspace/state.json`, donc elle voyage vers les autres postes.

Toute lecture l'applique :

* la liste des datasets écarte tout dataset qui a une tombe (`App.jsx`,
  `withoutDeletedDatasets`) — même si Firestore ou le cache du navigateur en
  garde encore une copie ;
* la couche Drive **ne recrée jamais** un dossier supprimé :
  `ensureDriveFolder` (dataset), `ensureDatasetFolderStructure` (`projects/`,
  `backups/`…) et `resolveDrivePathFromNames` (branche d'un projet) vérifient la
  tombe avant de créer quoi que ce soit.

Un dossier supprimé et recréé à l'identique par la suite est distingué par
l'**identifiant** du dataset : deux datasets peuvent porter le même titre, le
nouveau doit pouvoir créer son dossier.

## Pourquoi les lectures ne fabriquent plus de dossier

Le dossier d'images d'un projet est **dérivé de son nom**
(`projects/<slug(projet)>/images`, voir `driveNaming.projectImagesFolderPath`).
`resolveDrivePathFromNames` utilise `findOrCreateFolder` : il **crée**. Comme la
lecture de la bibliothèque (`pullLibraryFromDrive`) passait par là *pour lire*,
un dossier de projet portant un autre nom (projet renommé, dossier renommé sur le
Drive, registre `labDriveMirror` perdu parce que le navigateur a été vidé) faisait
créer un **jumeau vide** à côté des fichiers — et c'est ce jumeau vide qui était
lu : « mes figures sont sur le Drive mais le programme ne les voit plus, il y a
deux dossiers images et l'un est vide ».

`src/utils/figuresFolder.js` remplace cette résolution pour tout ce qui lit un
dossier de figures :

1. le dossier `images` **déjà retenu, par son identifiant** (`labDriveMirror` →
   `imagesId`) : une recherche par nom rend le *premier* des jumeaux, dans un
   ordre que le Drive ne garantit pas — souvent le plus récent, donc le **vide** ;
2. le **registre partagé** (`labDriveMirror` → dossier du projet par
   *identifiant*) : il survit à un renommage, le dossier étant renommé sur place ;
3. le **nom canonique** — un simple test d'existence, jamais une création ;
4. un dossier de projet **voisin dont le nom ressemble encore** (score ≥ 2 :
   même nom au séparateur près, ou l'un contient l'autre ; un simple mot commun ne
   suffit pas, ni deux candidats à égalité).

**Les jumeaux sont départagés par ce qu'ils contiennent.** Quand un dossier de
projet porte DEUX dossiers `images` (un vide créé par une version précédente,
l'autre avec les fichiers), le résolveur les compare : celui qui **porte les
figures** gagne, et il est retenu par identifiant (`imagesId`) dans le miroir.
Un miroir qui retient le dossier vide est donc corrigé de lui-même à la lecture
suivante. Le dossier trouvé est toujours **retenu par identifiant**, donc la
recherche par nom ne revient pas au coup d'après.

Quand rien n'est identifiable avec certitude (renommage complet), le geste **ne
devine pas** : il rend `candidates` (les dossiers de projet du dataset et ce que
chacun contient) et l'écran laisse choisir. Le dossier désigné est retenu pour le
projet (`fromFolderName`), donc les lectures **et** les envois suivants visent
celui-là.

Les gestes qui écrivent (publier une figure, déposer son sidecar éditable)
utilisent le même résolveur **et visent le dossier par identifiant**
(`uploadLocalFile({ folderId })`, y compris par la file de reprise) : une
résolution par nom écrirait dans le jumeau que personne ne lit. Une nouvelle
figure rejoint donc le dossier existant au lieu d'ouvrir un dossier parallèle, et
l'emplacement canonique n'est créé que s'il n'existe vraiment aucun dossier pour
ce projet.

## Pourquoi un dataset n'a qu'UN `projects/` et qu'UN `protocols/`

Les **conteneurs canoniques** d'un dataset (`projects`, `backups`, `protocols`,
`storage`, `publications`, voir `driveNaming.DATASET_FOLDER_DIRS`) avaient le
même défaut que les dossiers `images`, un étage plus haut — constaté sur le
Drive réel le 19/09/2026 (dataset « GEC-UPJV-projects ») :

* deux `projects/` à la racine du dataset : celui du 11/09 (4 sous-dossiers :
  `bianca`, `p53H`, `tests`, `unassigned`) et un **jumeau** créé le 19/09 à
  11:42 (2 sous-dossiers) ;
* deux `protocols/`, tous les deux vides ;
* la bibliothèque d'images du projet `p53H` **éparpillée** entre les deux :
  les figures jusqu'à 11:29 dans l'ancien, **38 fichiers** de 13:48 à 17:55 dans
  le nouveau — donc « mes figures sont sur le Drive mais le programme ne les voit
  plus ».

La cause est une **recherche confondue avec une absence** : `findOrCreateFolder`
créait quand `findFolderByName` rendait `''`, or ce `''` valait aussi bien pour
« le dossier n'existe pas » que pour « le Drive n'a pas répondu » (quota 403,
5xx, délai) — un `catch` unique rendait les deux identiques. Un `projects/`
parfaitement présent passait donc pour absent, et un second était créé à côté.

Ce qui a changé (`src/utils/driveUpload.js`) :

1. **`listFoldersByName`** rend TOUS les dossiers d'un même nom (les jumeaux) et
   **remonte l'échec** : plus aucun `catch` ne transforme une panne en « pas
   trouvé » ;
2. **`findOrCreateFolder`** cherche STRICTEMENT (`listFoldersByName`) : si la
   recherche échoue, l'erreur remonte et **rien n'est créé** ;
3. **`canonicalDatasetDirId(dir)`** est le résolveur unique d'un conteneur
   canonique : l'identifiant **retenu** dans le registre partagé
   (`labDriveMirror` → `datasetDirs`, donc `_workspace/state.json`) s'il est
   encore vivant, sinon les jumeaux sont **départagés par ce qu'ils contiennent**
   (`src/utils/datasetDirTwins.js` : celui qui porte du contenu gagne, à contenu
   égal le plus ancien — l'arborescence d'origine), le gagnant est retenu par
   identifiant, et un jumeau **connu vide** part à la corbeille. Un contenu
   *inconnu* (Drive muet) ne fait jamais perdre un conteneur et n'autorise jamais
   sa mise à la corbeille ; un conteneur supprimé dans le programme n'est jamais
   recréé (`create:false` = lecture seule) ;
4. ce résolveur est utilisé partout où un conteneur canonique est visé :
   `ensureDatasetFolderStructure` (ouverture du dataset),
   `resolveDrivePathFromNames` (premier segment d'un envoi), lecture des
   sauvegardes, liaison d'un test à un projet, `figuresFolder` (le `projects/`
   d'une bibliothèque d'images) et `driveMirror` (renommer / supprimer un projet).

**Réparer un Drive déjà abîmé** — `_repair_drive_twins.mjs` (lecture seule sans
argument, `--apply` pour exécuter) : il retient le conteneur canonique, **déplace**
(jamais ne copie ni n'écrase) les éléments des jumeaux dedans — un dossier de même
nom est fusionné récursivement, un fichier de même nom déjà présent est laissé en
place et signalé —, range à la corbeille les dossiers vidés par la fusion puis le
jumeau s'il ne reste rien, et vérifie qu'il ne reste qu'un conteneur par nom. Le
19/09/2026 il a remis 38 figures dans `projects/p53H/images` (119 fichiers au
total) + 1 dans `projects/unassigned/images`, et mis les deux jumeaux à la
corbeille (récupérables). Vérifié par `_dataset_dir_twins_test.mjs`.

## Pourquoi un nom de fichier ne s'allonge plus tout seul

Le nom d'une figure sur le Drive porte, après le libellé, une **empreinte courte
de l'identité** de la figure (`1D_Histogram…-1j0o9d1.svg`, voir
`figuresLibrary.figureFileName`) : sans elle, deux figures du même libellé
seraient le même fichier.

Le défaut venait du **libellé** : quand la liste des figures est reconstruite
depuis le Drive, le libellé d'une entrée est déduit du *nom du fichier*
(`labelFromDriveFileName`) — donc empreinte comprise. L'écriture suivante
ajoutait l'empreinte à ce libellé qui la portait déjà, et ainsi de suite :

```
Fig2-1b5tpha-1b5tpha-1b5tpha-1b5tpha-1b5tpha.jpg.meta.json
```

Deux corrections :

* `figureFileName` est **idempotent** : une empreinte déjà présente à la fin du
  libellé n'est jamais répétée, et un nom déjà abîmé est **ramené au bon** dès la
  prochaine écriture (l'empreinte est stable pour une même figure), sidecar
  `.meta.json` compris ;
* une entrée **découverte** par une lecture prend son libellé du **sidecar**
  (`<image>.meta.json` → `label`), qui est le nom vrai de la toile. Une entrée
  déjà connue de ce poste garde le sien — l'utilisateur a pu la renommer.

## Quelle copie fait vivre une figure

Une figure sur le Drive, c'est **deux fichiers** dans le même dossier
`projects/<projet>/images` :

* `<image>.jpg|png|svg` — l'image : c'est **elle** que la bibliothèque liste
  (les fichiers `.meta.json` sont ignorés comme images) ;
* `<image>.<ext>.meta.json` — la **copie éditable** : composition du canvas
  (panneaux, légendes, flèches, grille) et origine d'une capture. Sans elle,
  l'image revient comme une simple image : visible, mais **non rouvrable** dans
  l'Image Builder. C'est ce que compte `noComposition` dans le compte-rendu de
  « ⬇ Add missing from Drive ».

La bibliothèque se reconstruit depuis le Drive avec « ⬇ Add missing figures from
Drive » (page projet) ou « ⬇ Add missing from Drive » (fenêtre 🖼 Library) ; un
sidecar isolé se réimporte par « 📥 Restore a canvas file ». Les deux copies
vivent ensemble : renommer une figure renomme le sidecar juste à côté.

## Pourquoi les renommages suivent sur tous les postes

Le nom d'un dossier ne suffit pas à le retrouver après un renommage : le
registre de `_workspace/state.json` retient l'**identifiant Drive** de chaque
dossier (dataset et projet). Un poste qui n'a jamais ouvert ce dataset sait donc
quel dossier renommer ou supprimer — c'est ce qui manquait, et qui faisait créer
un **second dossier** à côté du premier.

## Les clés du navigateur

`_workspace/keys.json` porte les listes qui ne vivaient que dans le navigateur
(publications des scientifiques, bibliothèque de figures, éléments étoilés,
presets…). Règles de sécurité (`src/utils/workspaceKeyStore.js`) :

* **jamais** de secret : jetons Google/Nextcloud, sessions et mots de passe sont
  exclus, et un secret présent dans le fichier n'est jamais importé ;
* une clé absente en local est adoptée ; une clé présente n'est remplacée que si
  la copie du Drive est **plus récente** (horodatage par clé) ;
* rien n'est jamais supprimé du navigateur.

## Déplacer une image d'une bibliothèque à l'autre (et ce qui partait de travers)

Une image vit dans **une** portée, et chaque portée a **son dossier** :

| portée | liste (navigateur, miroir `_workspace/keys.json`) | dossier Drive |
| --- | --- | --- |
| bibliothèque commune | `labFiguresLibrary` | `projects/unassigned/images` |
| bibliothèque d'un projet | `labFiguresLib_<idProjet>` | `projects/<slug>/images` |

Le nom CANONIQUE du seau commun est `_unassigned` (`driveNaming.projectImagesFolderPath`,
le nom que portent les chemins Nextcloud et la documentation), mais **la création
d'un dossier sur Google Drive sanitise chaque segment**
(`driveUpload.resolveDrivePathFromNames`) et `sanitizeSlug('_unassigned')` vaut
`unassigned` : le dossier qui existe vraiment sur le Drive s'appelle donc
`unassigned`. Les deux noms sont acceptés en LECTURE (`figuresFolder.unassignedFolderNames`,
le réel d'abord), et l'écran affiche celui du Drive. **Ne supprimez pas ce
dossier** : il porte les figures de la bibliothèque commune (celles enregistrées
sans projet ouvert) ; sans lui, « ⬇ Add missing from Drive » n'a plus rien à
relire et les images ne reviennent que par la copie restée dans un navigateur.

Ce que la recherche de ce dossier faisait de travers (corrigé le 20/09/2026) : une
LECTURE ne cherchait que `_unassigned` — donc jamais le dossier réel — et la
bibliothèque commune n'était retrouvée que sur un poste où le miroir
`labDriveMirror` l'avait déjà retenue (« sur l'autre navigateur, ⬇ Add missing
from Drive ne trouve rien »). Pire, quand aucun dossier n'était identifié, la
portée commune pouvait adopter le dossier `images` PEUPLÉ d'un **projet** voisin :
la bibliothèque générale se mettait alors à lire — et à écrire — les figures d'un
projet. Désormais : les deux noms du seau sont cherchés (le réel d'abord), le seau
commun est reconnu à son nom (jamais un projet), et le `images` d'un projet n'est
jamais retenu pour la portée commune.

Le geste « ⇄ » (et le lâcher sur l'autre onglet) change **la liste** ET, pour une
image déjà sur le Drive, **le dossier du fichier** — image et sidecar ensemble
(`figuresLibrary.moveLibraryItemOnDrive`). Une image dont les pixels ne sont
encore que dans le navigateur n'a rien à déplacer : « ☁ Save to Drive » l'envoie
ensuite dans le dossier de sa nouvelle portée.

Ce que le geste fait d'autre, et pourquoi c'est nécessaire
(`figuresLibrary.moveLibraryItem` → `rememberLibraryTrash` / `forgetLibraryTrash`) :

* la liste de la portée **quittée** note l'identifiant de l'entrée *et* celui de
  son fichier (`d:<idFichier>`), exactement comme une suppression. Sans cette
  note, la fusion des clés — qui est une **union** — ramenait l'image depuis la
  copie de l'autre poste : « j'ai déplacé mes images dans la bibliothèque du
  projet, et sur l'autre ordinateur elles sont ENCORE dans la bibliothèque
  générale » (constaté sur le Drive réel le 19/09/2026 : trois images présentes à
  la fois dans `labFiguresLibrary` et dans deux bibliothèques de projet, même id
  et même fichier) ;
* la portée **rejointe** voit sa note effacée : on peut donc déplacer en sens
  inverse, et « ⬇ Add missing from Drive » peut relire le dossier de la nouvelle
  portée (c'est lui qui porte désormais le fichier) ;
* la note arrivant du Drive est lue **dans la fusion elle-même**
  (`figuresLibrary.effectiveLibraryTrash`, `workspaceKeyStore.mergedKeyValue`) :
  un poste qui reçoit un déplacement pour la première fois ne republie pas une
  fois de plus l'ancienne liste avant de respecter la note ;
* le déplacement est **idempotent** : rejouer le geste sur une image restée dans
  deux bibliothèques ne fabrique pas de doublon, et la copie en trop dans la
  portée quittée repart avec sa note.

Deux autres défauts du même incident, corrigés en même temps :

* les listes **adoptées du Drive n'atteignaient pas l'écran** tant que la page
  n'était pas rechargée, le miroir mémoire de `figuresLibrary` n'étant jamais
  relu du magasin après une adoption (`refreshLibraryFromStorage`, appelé par
  `App.jsx` dès que des clés ont été adoptées) ;
* les métadonnées d'un fichier (`getDriveFileMeta`) portent maintenant ses
  **dossiers parents** : c'est ce qui permet de retrouver le sidecar resté dans
  l'ancien dossier pour le faire suivre.

**Réparer une image déjà déplacée de travers** (état laissé par l'ancien
comportement) : la rejouer depuis la bibliothèque où elle est en trop. L'onglet
« Dataset » → « ⇄ » sur l'image (« Move into » vers le projet) écrit la note dans
la commune ET déplace le fichier ; les copies restées dans une autre bibliothèque
de projet se retirent avec 🗑 dans la bibliothèque de CE projet. Rien n'est
perdu : une copie retirée se note comme une suppression (elle ne revient pas), et
le fichier, lui, ne bouge que lors d'un déplacement.

Le diagnostic correspondant est `_diag_library_move.mjs` (lecture seule : où
vit chaque entrée, par portée, dans `_workspace/keys.json`), vérifié par
`_library_move_test.mjs`.

## Ce qui reste propre à un appareil (volontairement)

* les jetons d'accès et la session de connexion ;
* la file d'attente des envois (`pendingUploads`) ;
* les fichiers bruts volumineux (`.fcs`, `.xtc`…) gardés dans IndexedDB, qui sont
  déjà sur le Drive ;
* les identifiants de dossiers du navigateur (`labDriveFolderId`) — désormais
  doublés par le registre partagé.

## Vérifier soi-même

* `node _drive_mirror_test.mjs` — suppressions / renommages / rien ne ressuscite.
* `node _workspace_drive_test.mjs` — l'espace de travail écrit, relu, fusionné.
* `node _workspace_keys_test.mjs` — les clés du navigateur, et les secrets exclus.

Sur le Drive, après un renommage de dataset, il ne doit y avoir **qu'un seul**
dossier portant ce titre ; après une suppression, le dossier doit être dans la
**corbeille** et ne jamais réapparaître à l'ouverture suivante.
