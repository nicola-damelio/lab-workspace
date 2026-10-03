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
│   ├── projects/<projet>/           ← expériences, figures, documents de SECTION
│   │                                    (Background…), <projet>_document.json, useful_files
│   ├── general_library_images/      ← figures de la bibliothèque COMMUNE (celles d'aucun projet)
│   ├── protocols/<protocole>/
│   ├── backups/                     ← instantanés HTML du dataset
│   ├── storage/<storage>/images/<fichier>          ← image de référence du storage
│   ├── storage/<storage>/boxes/<boîte>/images/<f>  ← photos de la boîte
│   ├── storage/<storage>/boxes/<boîte>/<date>_<propriétaire>_boxlabel.pdf   ← étiquette de la boîte (automatique)
│   └── publications/
└── ...
```

`_workspace` est réservé à l'application : vos dossiers de datasets ne sont
jamais mélangés à cette mémoire.

## Ce qui se passe quand vous agissez

| Geste dans le programme | Sur le Drive |
| --- | --- |
| Supprimer un dataset | son dossier `<dataset>/` part à la **corbeille** (fichiers compris) et une **pierre tombale** est écrite dans `_workspace/state.json` |
| Supprimer un projet | `<dataset>/projects/<projet>/` part à la corbeille + pierre tombale du chemin (et, sur un Drive d'avant le 25/09/2026, l'éventuel dossier `<projet>` de la racine aussi) |
| Renommer un dataset | `<ancien titre>/` est **renommé** en `<nouveau titre>/` (jamais un second dossier) |
| Envoyer un document dans une section de la page projet | il va dans `<dataset>/projects/<projet>/<section>/` — jamais dans un dossier au nom du projet posé à la racine du dataset |
| Renommer un projet | le dossier du projet **et** son `<projet>_document.json` sont renommés |
| Supprimer une expérience / un protocole | le dossier de l'expérience / du protocole part à la corbeille |
| Renommer un storage / une boîte | son dossier Drive (`storage/<storage>`, `storage/<storage>/boxes/<boîte>`) est **renommé** — une boîte ne garde jamais le « Test 74 » de sa création |
| Modifier le contenu d'une boîte | `storage/<storage>/boxes/<boîte>/<date>_<propriétaire>_boxlabel.pdf` est réécrit (différé, ~2 s après la dernière modification) — et l'ancienne étiquette `label.pdf` part à la corbeille |
| Enregistrer une figure sans projet | elle est écrite et relue dans `<dataset>/general_library_images/` — la bibliothèque COMMUNE n'est pas un projet |
| Ouvrir un dataset (une seule fois) | le bac `projects/unassigned/` est vidé : son `images` devient `general_library_images/`, **à la racine du dataset**, ses expériences vont dans `projects/test/`, et le bac vidé part à la corbeille |
| Créer ou modifier un dataset | son contenu est déposé dans `_workspace/datasets/ds_<id>.json` (différé, ~8 s après la dernière frappe — et **tout de suite** quand on quitte la page) |
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

Les **conteneurs canoniques** d'un dataset (`projects`, `general_library_images`
— à la racine, c'est lui qui porte les figures communes —, `backups`,
`protocols`, `storage`, `publications`, voir `driveNaming.DATASET_FOLDER_DIRS`)
avaient le même défaut que les dossiers `images`, un étage plus haut — constaté sur
le Drive réel le 19/09/2026 (dataset « GEC-UPJV-projects ») :

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
corbeille (récupérables). Vérifié par `_dataset_dir_twins_test.mjs`. Ces deux
emplacements-là n'ont plus cours : `projects/unassigned/images` a depuis été
déménagé en `general_library_images/`, à la racine du dataset (voir « Le
déménagement du bac `unassigned` »).

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
| bibliothèque commune | `labFiguresLibrary` | `general_library_images` — à la RACINE du dataset |
| bibliothèque d'un projet | `labFiguresLib_<idProjet>` | `projects/<slug>/images` |

Le dossier commun est un **conteneur de PREMIER NIVEAU du dataset**
(`driveNaming.GENERAL_LIBRARY_DIR`, `projectImagesFolderPath('')`, et il fait
partie de `DATASET_FOLDER_DIRS`) : une figure sans projet n'appartient à aucun
projet, donc elle ne vit pas dans le conteneur des projets — et ce dossier porte
les figures **directement** (il EST le dossier d'images, contrairement à
`projects/<projet>/images`). L'écran affiche donc
« My_dataset / general_library_images » (`projectImagesFolderLabel`).
**Ne supprimez pas ce dossier** : il porte les figures enregistrées sans projet
ouvert ; sans lui, « ⬇ Add missing from Drive » n'a plus rien à relire et les
images ne reviennent que par la copie restée dans un navigateur.

### Le déménagement du bac `unassigned` (une seule fois par dataset)

Le dossier commun vivait avant dans un **bac** `projects/unassigned/` — qui
portait aussi les **expériences sans projet**, à côté de son `images/`.
`unassigned` a disparu du vocabulaire : tout fichier appartient à un projet (à
défaut au projet `test`, voir `driveNaming.DEFAULT_PROJECT_NAME`), et les figures
communes ne sont pas un projet. `utils/commonLibraryMigrate.js` range donc chaque
dataset la première fois qu'il est ouvert avec le Drive prêt (`App.jsx`, juste
après `ensureDriveFolder()`) :

| avant | après |
| --- | --- |
| `projects/unassigned/images/…` | `general_library_images/…` — le dossier est **DÉPLACÉ** à la racine, puis **renommé** |
| `projects/unassigned/<expérience>/` | `projects/test/<expérience>/` |
| `projects/unassigned/` (vidé) | corbeille (récupérable) |

Un **déplacement** et un **renommage** gardent l'identifiant Drive : les liens
déjà enregistrés dans la bibliothèque (et l'index des figures) continuent de
viser les mêmes fichiers, sans réenvoi. Ce qui n'est jamais fait, en revanche :
**rien n'est écrasé** — une expérience dont le nom est déjà pris dans
`projects/test` est LAISSÉE en place et **annoncée** (`kept` du rapport), un bac
qui porte encore quelque chose n'est pas mis à la corbeille, et un dossier vide du
nouveau nom n'est pas une bibliothèque (les figures de l'ancien emplacement y sont
alors **rapatriées**, fichier par fichier — `merged`).

Tout est « au mieux », et rien n'est bloquant : sans Drive (`cloud-off`) ou sans
dossier de dataset (`no-dataset`), le rapport le dit et le geste repart au
démarrage suivant — et une fois le geste abouti, le drapeau
`labCommonLibraryMigrated::<datasetId>` épargne toute lecture du Drive de plus.
Entre-temps la LECTURE continue de fonctionner sur les anciens emplacements :
`figuresFolder.commonLibraryFolderNames()` cherche `general_library_images`
d'abord, puis `unassigned`, puis `_unassigned` — le nom canonique des chemins
Nextcloud, que Google Drive ne peut pas porter (`sanitizeSlug('_unassigned')` vaut
`unassigned`, le `_` de tête tombe). Et quand le dossier du nouveau nom existe
mais est **vide** tandis qu'un ancien porte les figures, c'est **l'ancien qui
gagne** (le jumeau peuplé) : la bibliothèque ne paraît jamais vide juste avant la
migration.

### Ce que la recherche de ce dossier faisait de travers (corrigé le 20/09/2026)

Une LECTURE ne cherchait que `_unassigned` — donc jamais le dossier réel — et la
bibliothèque commune n'était retrouvée que sur un poste où le miroir
`labDriveMirror` l'avait déjà retenue (« sur l'autre navigateur, ⬇ Add missing
from Drive ne trouve rien »). Pire, quand aucun dossier n'était identifié, la
portée commune pouvait adopter le dossier `images` PEUPLÉ d'un **projet** voisin :
la bibliothèque générale se mettait alors à lire — et à écrire — les figures d'un
projet. Désormais : les noms du seau sont cherchés dans l'ordre (celui
d'aujourd'hui d'abord), le seau commun est reconnu à son nom (jamais un projet),
et le `images` d'un projet n'est jamais retenu pour la portée commune —
`findCommonFiguresFolder` ne regarde QUE les dossiers de la bibliothèque commune.

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

## Le rangement d'un storage et de ses boîtes

Une **boîte de stockage n'est pas une expérience** : c'est un emplacement. Elle
n'a donc ni niveau « instance » ni « section », et son dossier porte le **nom de
la boîte** — jamais le « Test 74 » de sa création. Le rangement est :

```
<dataset>/storage/<storage>/images/<fichier>          ← image de référence du storage
<dataset>/storage/<storage>/boxes/<boîte>/images/<f>  ← photos de la boîte (Box Photo, Inside Photo)
<dataset>/storage/<storage>/boxes/<boîte>/<date>_<propriétaire>_boxlabel.pdf   ← étiquette de la boîte, réécrite automatiquement
```

Ce que cela change, geste par geste (`Storage.jsx`, `utils/storageDrive.js`,
`utils/driveNaming.js`, `utils/boxLabel.js`) :

* **les fichiers gardent leur nom** (`file1.jpg`, `file2.jpg`) : seul le dossier
  est imposé par l'application (`DriveUploadButton nameFor`) ;
* **renommer une boîte renomme son dossier** (`renameStorageBoxDriveFolder`) —
  photos et étiquette `boxlabel.pdf` suivent le dossier, donc les liens déjà enregistrés dans
  la boîte continuent de fonctionner ; renommer un storage renomme
  `storage/<storage>` (`renameStorageDriveFolder`) ;
* **l'étiquette est fabriquée et déposée toute seule** (`components/BoxLabelFile.jsx`,
  `utils/boxLabelPdf.js`) : ~2 s après la dernière modification de la boîte,
  `<date>_<propriétaire>_boxlabel.pdf` remplace la précédente. Rien n'est envoyé si le contenu n'a pas
  changé (la boîte garde la signature du dernier envoi) ni si le Drive ne répond
  pas — le bouton « Save to Drive now » réessaie à la demande. Le bouton
  « Print Label » imprime, lui, la **sélection** de puits ; l'étiquette archivée
  est la table complète des puits **remplis** (même table, même code) ;
* **le NOM de l'étiquette dit de quelle boîte il s'agit**
  (`driveNaming.boxLabelFileName`) : `<date>_<propriétaire>_boxlabel.pdf`, bâti
  avec les deux champs OBLIGATOIRES de la boîte (« Date » et « Box Owner », à
  défaut l'opérateur). Un PDF sorti de son dossier s'identifie donc tout seul, et
  changer la date ou le propriétaire RÉÉCRIT l'étiquette (les deux entrent dans la
  signature, avec les commentaires). Une étiquette qui portait l'ancien nom
  `label.pdf` part à la corbeille dès que la nouvelle est déposée
  (`storageDrive.clearLegacyBoxLabels`) : un dossier de boîte ne porte jamais
  deux étiquettes ;
* **les NOTES sont reprises EN CALCE** (`boxLabel.boxLabelNotes`,
  `boxLabelPdf.writeNotesBlock`) : la colonne « Notes » de la table ne tient
  qu'une ligne d'une dizaine de mm — elle recevait même une largeur NÉGATIVE
  (109 mm de colonnes fixes sur 108 mm utiles), donc jsPDF ne la dessinait pas du
  tout. Chaque note est donc reprise en bas du PDF, EN ENTIER, rappelée par la
  POSITION du puits auquel elle se rapporte (« B7: … ») ; le commentaire général
  de la boîte (« General Box Notes ») ferme le bloc, rappelé par sa position.
  L'en-tête du PDF porte désormais le propriétaire (« Box Owner: … ») et la date
  de la boîte, à côté de la date de fabrication. La fenêtre « Print Label », elle,
  garde sa table large, où les notes sont déjà entières ;
* **l'ancienne arborescence est rapatriée** (`tidyStorageFiles`) : à l'ouverture
  d'un storage ou d'une boîte, les fichiers déjà envoyés sous
  `storage/<boîte>/<instance>/image/…` ou `storage/<storage>/image/…` sont
  **déplacés** — par identifiant de fichier, donc le lien enregistré ne change
  pas — vers les dossiers ci-dessus. Un fichier déjà bien rangé n'est jamais
  touché, et rien n'est déplacé quand le Drive est injoignable ;
* **un geste de rangement ne FABRIQUE rien** : le dossier visé est d'abord
  seulement CHERCHÉ (`resolveDrivePathFromNames(names, { create: false })`), et
  il n'est créé que si un fichier a vraiment besoin d'y entrer. Le nom d'une
  boîte change à chaque frappe : recalculer son dossier pendant la saisie — le
  nom était une dépendance de l'effet de rangement — laissait `boxes/j`,
  `boxes/ja`, `boxes/jac` (un dossier par lettre, parfois déjà rempli de photos).
  Le rangement suit donc l'**ouverture** de la boîte (et ses photos), et le
  renommage est un geste du **dossier**, une seule fois, à la fin de la saisie
  (`renameStorageBoxDriveFolder`, puis un rangement unique avec le nom définitif).

Le diagnostic correspondant est `_storage_drive_layout_test.mjs` (chemins,
contenu de l'étiquette, renommages et rangement, sur un faux Drive).

## Une boîte de stockage ne reste jamais invisible (ni sans meuble)

La grille d'un storage ne dessine que ses `rows × cols` cases. Une boîte dont
l'emplacement est **absent** (`storageIndex: null`), **hors** de la grille
(meuble réduit après coup, boîte arrivée d'un autre poste) ou dont le **meuble
n'existe plus** (fichier importé, synchronisation) n'était plus dessinée nulle
part — alors que sa fiche continuait d'être comptée, d'où le message
« ⚠ 2 boxes missing required data (test31, test31) » parlant de boîtes que
personne ne voit. Ce qui le rend impossible (`src/utils/storageBoxes.js`,
vérifié par `_storage_boxes_test.mjs`) :

* **`storageRows` / `storageCols` ne valent jamais 0** et la grille dessine
  `storageSlotCount` cases — exactement la valeur que comptent les règles : un
  meuble sans dimensions montre une case au lieu d'aucune ;
* **`repairBoxPlacements`** (appelé au **chargement d'un dataset** —
  `migrateLoadedDataset` dans `src/App.jsx` — et à l'**enregistrement d'un
  meuble** dont la grille a été réduite) rend une place RÉELLE à chaque boîte :
  la sienne si elle est valide, la première place libre sinon, et l'empilement
  quand le meuble est plein. Une boîte qu'aucun meuble ne porte reçoit le
  premier meuble du dataset : **une boîte ne reste jamais sans meuble** tant
  qu'un meuble existe ;
* l'écran **liste ce qu'il ne peut pas dessiner** : « boxes without a visible
  slot » dans la fiche d'un meuble (bouton « ⇊ Place »), « boxes without a
  storage » sur la page Storage, et le message de complétude nomme chaque boîte
  avec son emplacement (« test31 · slot 3 »), de sorte que deux boîtes du même
  nom restent distinguables ;
* **supprimer un meuble déplace d'abord ses boîtes** vers un autre meuble (une
  par emplacement libre, puis empilées) : la suppression est refusée quand il ne
  reste aucun meuble d'accueil, et l'ancienne action « Take out » — qui laissait
  une boîte sans meuble — n'existe plus ;
* le champ **« Instance » n'est plus proposé sur une boîte** (une boîte n'a pas
  de niveau instance : son dossier porte son nom). La page d'une boîte dit
  seulement OÙ elle vit — meuble et emplacement, cliquables.

Dans la page d'une boîte, **« Apply to all »** écrit les trois champs partagés
d'une sélection — propriétaire de l'échantillon, solvant, date — sur **tous les
puits sélectionnés** en une seule écriture ; un champ laissé vide ne touche à
rien (on peut donc appliquer le solvant sans changer les propriétaires).

## Pourquoi une expérience ne sème plus de dossier à la racine du dataset

L'import Bruker d'un spectre 1D (NMR) ou d'un spectre solide (ssNMR) archive
l'expérience entière sur le Drive. Il construisait le chemin visé avec
`driveFolderPath`, c'est-à-dire l'ancienne forme

```
<projet>/<expérience>/<instance>/Data/…
```

qui n'a **pas** le conteneur `projects/`. Comme un `path` explicite est utilisé
tel quel par `uploadLocalFile`, l'envoi créait

```
<dataset>/<projet>/…          ← ce qui arrivait : un dossier de projet À CÔTÉ de projects/
```

au lieu de

```
<dataset>/projects/<projet>/<expérience>/<instance>/data/Bruker_1r/<expno>/…
```

Conséquence visible (constatée le 19/09/2026) : « l'expérience n'appartient à
aucun projet » sur le Drive — une seconde arborescence de projet poussait à la
racine du dataset, dans un dossier que le registre partagé ne connaissait pas
(donc pas de renommage / suppression cohérents pour ces fichiers).

Ce qui a été corrigé :

* `driveNaming.canonicalizeExperimentPath(path, ctx)` — **pur** : un chemin
  d'expérience explicite reçoit la tête canonique `projects/<projet>`, l'ancienne
  forme `<projet>/<expérience>/…` étant reconnue puis re-préfixée ; le nom du
  projet est remplacé par celui du projet visé à chaque copie, donc un fichier
  partagé entre plusieurs projets est déposé sous **chacun** d'eux. Un chemin
  non-expérimental (bibliothèque, protocole, document de projet, storage) n'est
  jamais touché ;
* `driveUpload.uploadLocalFile` applique ce normalisateur à tout `path`
  explicite : plus aucun appelant ne peut semer un dossier d'expérience à la
  racine du dataset ;
* les deux importateurs Bruker partent du chemin canonique
  (`canonicalExperimentPath`), donc l'archive se range désormais au même endroit
  que les envois du bouton « ⬆ Archive spectra to Drive » — y compris le niveau
  `<data>/Bruker_1r` que l'ancienne forme omettait ;
* `migrateTestImages.js` (« ⬆ Import test images from Drive ») visait lui aussi
  l'ancienne forme : il passe par le même `folderPathOf`.

L'import CD (Jasco) et les boutons « ⬆ Archive… » passaient déjà `ctx` seul —
donc par `canonicalExperimentPath` — et n'ont jamais eu ce défaut.

Réparer un Drive déjà touché : le dossier du projet posé à la racine du dataset
n'a qu'à être **glissé dans `projects/`** (même nom). La résolution suivante le
retrouve par son nom et enregistre son identifiant (`projects/<projet>`, voir
`resolveDrivePathFromNames`) : aucun fichier à re-téléverser.

## Déplacer une expérience d'un projet à un autre (28/09/2026)

Demandé tel quel : « allow me to move an experiment from one project to another ».
Une expérience **est** un test — avec ses instances de condition — et un projet ne
la « contient » pas : il la **lie**, par une entrée par instance
(`project.experiments[]`), tandis que le test lui-même porte la liste des projets
auxquels il appartient (`projectNames`). Déplacer, c'est donc écrire dans **deux**
projets d'un seul geste, et faire suivre le test.

Le geste : dans « 🧪 Experiments in this project », la ligne d'une expérience porte
un **⇄** qui ouvre « ⇄ Move to project: ». La liste ne propose que les **autres**
projets de la page, et seulement ceux que l'utilisateur a le droit de **modifier**
(`projectAccessFor(p, …) === 'modify'` — un déplacement écrit chez eux). Rien n'est
déplacé à l'aveugle : le volet dit ce qui part, « Cancel » referme, et la carte
affiche le compte rendu du dernier déplacement.

Ce que le geste fait, et pourquoi dans cet ordre :

| étape | ce qui est écrit | pourquoi |
| --- | --- | --- |
| 1 | **toutes** les entrées de ce TEST quittent le projet d'origine | une expérience = un test : déplacer une instance et laisser les autres derrière produirait deux demi-expériences, et le dossier Drive (un par nom de test) ne saurait plus où il vit |
| 2 | ces entrées rejoignent le projet visé, avec leur **identifiant**, leur coche « Include » et leur `addedAt` | c'est un déplacement, pas une expérience neuve ; les entrées dont le test est **déjà** lié là-bas ne sont pas ajoutées (aucun doublon d'entrée) |
| 3 | le test passe au projet visé, **en tête** de `projectNames`, le nom du projet quitté étant retiré | le premier projet de la liste est le projet PRINCIPAL : c'est lui qui décide des droits sur l'expérience (`testProjectAccess`) et de la tête du chemin Drive (`canonicalExperimentPath`) ; un test encore lié à d'autres projets les garde (le modèle est many-to-many) |

Le tout passe par la règle **pure** `experimentRules.moveExperimentBetweenProjects`
(entrées, liste des tests, et le compte rendu `moved` / `arrivals` / `duplicates`) :
la page écrit son résultat **en une fois** — les deux projets dans la MÊME écriture,
jamais un état intermédiaire où l'expérience n'appartiendrait à personne — puis le
magasin (`saveProjects`) et `setTests`. Un refus (expérience inconnue, projet
inconnu, projet identique) rend les listes **telles quelles** : rien n'est écrit.

Le dossier du Drive **migre** sous le projet visé : `moveTestFolderBetweenProjects`
(driveUpload.js) reçoit les DEUX projets et fait le trajet en un seul geste. Côté
Drive il n'existe qu'un `files.update` avec `addParents` + `removeParents` : le
dossier est **déplacé par son identifiant**, jamais recopié — l'ancien chemin
disparaît, et le dossier devenu vide du projet quitté part à la corbeille.

Ce geste ramasse *tout* ce qui porte le nom de l'expérience, car ce nom est le seul
repère de son dossier (`projects/<projet>/<expérience>`, voir
`canonicalExperimentPath`) : le dossier du projet quitté, un exemplaire resté dans
le bac `projects/test`, dans l'ancien bac `projects/_unassigned`, à la racine du
dataset — et les **jumeaux** d'un même emplacement. Un seul dossier resté derrière
suffirait à ce que `findFolderByName` continue de le rendre : l'expérience vivrait
à deux endroits.

Si un dossier du **même nom** est déjà dans le projet visé (l'expérience y était
déjà liée), son contenu est **fusionné** dedans — deux dossiers frères du même nom
éparpilleraient les fichiers de l'expérience (le défaut des « jumeaux d'INSTANCE »,
voir plus bas). Un **fichier** homonyme, lui, n'est jamais écrasé : il reste où il
est, et le dossier qui le porte est compté dans le compte rendu pour que
`_repair_drive_twins.mjs` puisse en décider.

Le registre des fichiers suit (`ctx.project` devient le projet visé, chemin refait
en `projects/<projet visé>/<expérience>/…`) : les envois suivants de l'expérience
visent le même dossier. Rien n'est bloquant : sans Drive connecté, ou si le dossier
n'existe pas encore, le geste ne fait rien — et il ne sème **aucun** dossier dans le
projet visé ; les fichiers envoyés plus tard arrivent directement au bon endroit,
puisque le chemin se calcule à partir de `projectNames`.

Ce qui ne change PAS, volontairement : le ✕ (« Remove from project ») reste le
geste pour **retirer** une expérience d'un projet (ses deux gestes de liaison,
`moveTestFolderIntoProject` / `moveTestFolderOutOfProject`, sont intacts) ; les
copies Drive des projets restés liés ne sont pas touchées ; et l'expérience garde
son identifiant d'entrée, donc l'historique de ses figures ⭐ et de son texte suit.

### Vérifier soi-même

```bash
node _project_experiment_move_test.mjs      # 77 assertions : la règle + la page + les contrats Drive
node _experiment_move_drive_test.mjs        # 62 assertions : le dossier MIGRE (faux Drive fidèle)
```

Le premier fabrique deux projets (A avec deux instances d'une même expérience, B
vide, C qui partage une autre expérience), déplace, et vérifie l'arrivée **à
l'identique** (identifiant, « Include », date), l'ordre de `projectNames`, l'absence
de doublon quand le projet visé est déjà lié, et les trois refus qui ne touchent à
rien.

Le second branche le **vrai** `driveUpload.js` sur un faux Drive qui tient les
parents de chaque nœud : après le déplacement, le dossier de l'expérience n'a plus
**qu'un parent** (le projet visé) et garde son identifiant — c'est la preuve du
« déplacé, pas copié » ; les instances, sections et fichiers suivent ; le dossier
vidé du projet quitté part à la corbeille ; un dossier du même nom est fusionné (et
un homonyme signalé) ; les exemplaires du bac, de l'ancien bac et de la racine sont
ramassés ; sans Drive connecté ou sans dossier à déplacer, **rien** n'est écrit.

## Les jumeaux d'INSTANCE (deux fois le même dossier d'expérience)

Constaté sur le Drive réel le 20/09/2026 (expérience NMR du projet p53H) :

```
<dataset>/projects/p53H/NMR_p53H/
    Exp_7/     Exp_7/     ← le même dossier, deux fois
    Exp_19/    Exp_19/
    .../Exp_19/data/Structure/  +  .../Exp_19/data/Structure/
```

Les **dates de création** le disent : 73 ms, 221 ms et 245 ms d'écart. Deux
chaînes de dossiers avançaient EN MÊME TEMPS sur le même chemin. `findOrCreateFolder`
faisait « chercher puis créer » : les deux ont donc CHERCHÉ avant que l'un ait
créé, et le Drive a reçu deux dossiers du même nom sous le même parent.

Qui courait : l'**import Bruker** archive les fichiers bruts
(`projects/<projet>/<expérience>/<instance>/data/Bruker_1r/…`) pendant que la
**copie de référence du spectre** part vers le MÊME dossier — `NMRSections.jsx`
lance ce second envoi sans l'attendre (`void (async () => archiveNmr1dSpectrum…)`),
et `nmr1dDriveCtx` vise la même sous-section `Bruker 1r`. Les deux dossiers du
NMR réel portaient d'ailleurs chacun un `data/` vide : personne n'avait encore
rien écrit dedans.

Ce qui a été corrigé :

* `src/utils/folderRace.js` — **pur** : `oncePerFolder(store, key, work)` fait
  qu'une seule opération est en vol par `(parent, nom)`, les appelants concurrents
  **partageant la même promesse** (donc le même identifiant). Le point capital :
  c'est la RECHERCHE **ET** la création qui sont uniques, pas la seule création —
  sinon la fenêtre « chercher avant que l'autre ait créé » resterait ouverte. Un
  échec n'est jamais mémorisé (l'appelant suivant réessaie pour de vrai) ;
* `driveUpload.findOrCreateFolder` passe par là, et la racine « Lab Workspace »
  aussi (deux envois simultanés sur une installation neuve en fabriquaient deux) ;
* **départage des jumeaux DÉJÀ présents** (`canonicalTwinOf`) : entre plusieurs
  dossiers du même nom, c'est celui qui **porte du contenu** qui est rendu (à
  contenu égal le plus ancien — même règle que `datasetDirTwins.pickCanonicalFolder`).
  Sans cela, « le premier du nom » était rendu dans un ordre que le Drive ne
  garantit pas : les fichiers d'une expérience se rangeaient tantôt dans un
  jumeau, tantôt dans l'autre. `findFolderByName` (lecture) vise le même dossier.

Réparer un Drive déjà touché : `node _repair_drive_twins.mjs --deep` (SANS
`--apply` : lecture seule, le plan est affiché) descend dans `projects/` et
fusionne tout couple de dossiers **frères** de même nom — contenu DÉPLACÉ par
identifiant de fichier dans le dossier retenu, puis jumeau devenu vide à la
corbeille. Aucun fichier n'est écrasé ni supprimé ; un homonyme est signalé et
laissé en place. Une fusion peut réunir deux jumeaux de même nom dans le dossier
retenu (deux `Structure` d'instance) : l'exécution repasse alors jusqu'à ce
qu'il n'y ait plus rien (4 passes au plus).

Vérifié hors navigateur par `_folder_race_test.mjs` (46 assertions) : logique
pure, deux `findOrCreateFolder` simultanés → **une seule** création sur un faux
Drive, la chaîne `projects/<projet>/<expérience>/<instance>/data/Bruker_1r`
résolue deux fois en parallèle → aucun dossier en double, et le jumeau qui porte
du contenu qui gagne.

## Ce qui reste propre à un appareil (volontairement)

* les jetons d'accès et la session de connexion ;
* la file d'attente des envois (`pendingUploads`) ;
* les fichiers bruts volumineux (`.fcs`, `.xtc`…) gardés dans IndexedDB, qui sont
  déjà sur le Drive ;
* les identifiants de dossiers du navigateur (`labDriveFolderId`) — désormais
  doublés par le registre partagé.

## Ce qui vit dans le dataset (et donc sur tous les postes)

Tout état **du dataset** — expériences, définitions, bibliothèque de composés,
fiches (composés, lignées, plasmides, instruments RMN), stockage, protocoles,
**calculs de solution** — fait partie de la charge du dataset : il part sur
Firestore *et* dans `_workspace/datasets/ds_<id>.json`. Rien à faire de plus
pour le retrouver sur un autre PC ; en revanche, deux pièges d'**affichage** ont
déjà fait croire à des données perdues, et sont désormais verrouillés.

### Les calculs de solution (page *Calculations*)

Signalé le 19/09/2026 : des calculs enregistrés sur un poste étaient **absents**
sur le second. Les données, elles, étaient bien arrivées — c'est la page qui ne
les montrait pas :

1. la page ouvrait le calcul du **premier composé de la liste alphabétique**.
   Les calculs existaient, mais pour un autre composé : l'écran annonçait
   « No saved calculation data for … ». Un calcul enregistré **sans compte
   connecté** (`operator: 'unknown'`) ou par un autre scientifique était, lui,
   **masqué sans le dire** par le filtre par scientifique — un filtre que seuls
   les superutilisateurs pouvaient voir et changer.
2. Conséquence : une donnée présente, invisible, et aucune explication.

Ce qui existe maintenant (`src/utils/calculationEntries.js`, testé pur) :

* un **inventaire du dataset** toujours affiché — « Saved in this dataset » —
  avec un composé cliquable par ligne (`Pepper · 3`), le nombre de scientifiques
  et la marque `⚠` quand un calcul n'a pas de nom. C'est ce cadre qui, sur un
  poste neuf, **montre** ce que le dataset contient au lieu de laisser conclure
  à une absence ;
* la page ouvre d'abord le composé du calcul **le plus récent** (pas le premier
  de l'alphabet) ;
* le filtre par scientifique est disponible pour **tout le monde** (dont « My
  calculations » et « Saved without a name »), et ce qu'il masque est **compté
  et annoncé** (« 2 saved calculations hidden by this filter — show all ») ;
* une règle de sécurité : **une identité inconnue ne cache jamais une donnée**
  (sans nom de compte, ou quand « mes » calculs ne sont pas identifiables, la
  page montre tout), et un calcul sans nom reste visible dans tous les filtres ;
* la page dit **où** ce qu'elle enregistre est déposé
  (`_workspace/datasets/ds_<id>.json`), pour que « est-ce bien enregistré ? » se
  vérifie de l'œil.

### La copie Drive ne perd plus la dernière minute

Le contenu du dataset est écrit sur le Drive **en différé** (~8 s de calme : une
requête, pas cinquante). Un calcul enregistré puis un onglet fermé dans cet
intervalle n'atteignait jamais le Drive — l'autre poste ne voyait rien. La
mécanique est maintenant isolée dans `src/utils/datasetCopyMirror.js` :

* `schedule(id, charge)` regroupe les écritures et ignore une charge
  **identique** (empreinte) ;
* `flush()` envoie **immédiatement** ce qui attend, et `App.jsx` l'appelle sur
  `pagehide` (fermeture de l'onglet) et `visibilitychange` (arrière-plan) ;
* un dépassement de taille (`MAX_DATASET_COPY_BYTES`) ou un envoi qui échoue est
  désormais **dit** dans la console : une copie Drive manquante n'est jamais
  silencieuse.

## Vérifier soi-même

* `node _calculation_entries_test.mjs` — l'inventaire, les filtres et le fait
  qu'aucune donnée ne soit masquée sans être comptée, plus le câblage de la page.
* `node _dataset_copy_mirror_test.mjs` — le dépôt différé du contenu du dataset
  sur le Drive, l'empreinte, et le vidage forcé à la fermeture de l'onglet.
* `node _drive_mirror_test.mjs` — suppressions / renommages / rien ne ressuscite.
* `node _storage_drive_layout_test.mjs` — le rangement `storage/<storage>/boxes/<boîte>`
  (chemins, étiquette automatique, renommages, rapatriement de l'ancienne arborescence).
* `node _common_library_folder_test.mjs` — la bibliothèque commune à la racine du
  dataset, le déménagement du bac `unassigned` (déplacement, expériences →
  `projects/test`, bac vidé à la corbeille) et ce qui reste lisible entre-temps.
* `node _dataset_dir_twins_test.mjs` — un seul conteneur par nom dans un dataset
  (dont `general_library_images`), les jumeaux départagés par leur contenu.
* `node _experiment_drive_root_test.mjs` — l'archive d'une expérience (import
  Bruker NMR 1D / ssNMR, migration des images) atterrit sous `projects/`, jamais
  dans un dossier de projet posé à la racine du dataset.
* `node _workspace_drive_test.mjs` — l'espace de travail écrit, relu, fusionné.
* `node _workspace_keys_test.mjs` — les clés du navigateur, et les secrets exclus.
* `node _nmr1d_processing_test.mjs` — le réglage du spectre 1D NMR (calibration +
  phase) vit à PART des tableaux du spectre : il survit à la compression du
  document du dataset, aucune écriture de la page ne passe plus par la copie
  d'affichage, la restauration Drive ne remet plus le réglage à zéro, et la page
  dessine encore le spectre quand seule la copie plein format est dans la cache.

Sur le Drive, après un renommage de dataset, il ne doit y avoir **qu'un seul**
dossier portant ce titre ; après une suppression, le dossier doit être dans la
**corbeille** et ne jamais réapparaître à l'ouverture suivante.

## Restauration automatique : le Drive est la copie de référence

### Le défaut

Une donnée trop grosse pour le document du dataset (spectre 1D complet,
événements FCS, trajectoire MD, structures de docking, vidéo…) n'était **pas
perdue** : elle vivait dans la cache du navigateur (IndexedDB / localStorage) et
les fichiers bruts sur le Drive. Mais la cache est **par navigateur et par
poste** : sur un autre ordinateur, ou après un nettoyage, la page affichait
« vide » alors que les données existaient. Pire, `compressDatasetForSave`
(App.jsx) retire les valeurs lourdes qui dépassent le budget Firestore et les
remplace par un marqueur texte
(`[nmr1dSpectrum omitted — kept in browser cache / Drive or re-uploadable]`) :
le marqueur n'est pas une donnée, c'est un aveu d'absence.

Rien ne doit donc **dépendre** de la cache : la cache ne sert qu'à éviter un
téléchargement, jamais à justifier une absence.

### Une valeur ne doit pas dépendre d'un fichier

Un cas signalé le 19/09/2026 : sur un autre poste, la page NMR n'avait plus le
PDB, la trajectoire, **ni la séquence** — et donc pas les tables de déplacements,
qui se construisent à partir d'elle. La chaîne était : le PDB n'existait que dans
la base du navigateur du poste qui l'avait importé → le viewer 3D, seul à savoir
en **déduire** la séquence 1 lettre, ne la déduisait plus → la séquence n'étant
pas remplie, `parsedSeq` était vide et les déplacements stockés (eux bien dans le
dataset) n'avaient plus de ligne où s'afficher. Deux garde-fous en découlent :

* le fichier de structure (et la trajectoire MD) est **restaurable** du Drive —
  voir « Structure 3D du viewer » ci-dessous — donc la séquence se redéduit toute
  seule, puis est **réécrite sur la condition** (elle voyage ensuite comme
  n'importe quelle valeur) ;
* si des déplacements existent sans séquence, la page NMR le **dit** à l'écran
  (« N chemical shift value(s) are stored … but the sequence is empty ») : une
  valeur invisible à cause d'un fichier manquant n'est jamais présentée comme une
  valeur perdue.

### Le réglage du spectre suit le dataset, pas la copie d'affichage

Un cas signalé le 20/09/2026 : phaser / calibrer un spectre 1D NMR (et saisir des
déplacements dans la table) puis quitter la page et revenir → le spectre
**revenait non phasé** ; en navigation privée, il n'était pas phasé non plus. La
calibration et la phase étaient écrites DANS la copie d'affichage
(`nmr1dSpectrum.calibration / phaseDeg / phase1Deg`). Or cette copie est une
« unité lourde » pour `compressDatasetForSave` (trois tableaux de 4 000 nombres,
plus de 50 Ko) : Stage 5 la remplace **entièrement** par le marqueur
`[nmr1dSpectrum omitted …]` dès que le document du dataset doit maigrir — phase,
calibration, titre et drapeau `fullStore` avec elle. À la réouverture, la copie
manquante déclenchait la restauration automatique, qui réinjectait l'archive
**figée à l'import** (`calibration: 0, phaseDeg: 0`). Trois règles en découlent :

* le réglage (calibration, PH0, PH1) vit dans **son propre champ**, fait de
  quelques **nombres** — `nmr1dProcessing = { calibration, phaseDeg, phase1Deg,
  at }`. Aucune règle de compression ne touche un scalaire : il voyage donc avec
  le dataset d'un poste à l'autre, et il est là aussi en navigation privée ;
* **aucune écriture d'interface** ne passe plus par la copie d'affichage (y
  écrire quand elle a été remplacée par un marqueur recréerait un spectre en
  texte), et la restauration Drive **ne remet jamais** ce réglage à zéro :
  l'archive est plus ancienne que le travail de l'utilisateur ;
* la copie d'affichage absente n'**empêche plus d'afficher** le spectre quand la
  version plein format est encore dans la cache du navigateur : la page le
  dessine et dit d'où vient la copie (« full copy from this browser ») au lieu de
  rester vide en attendant le Drive.

### Le mécanisme (un seul, pour tous les modules)

`src/utils/driveRestore.js` (logique + entrées/sorties) et
`src/components/useDriveAutoRestore.js` (déclencheur React) :

1. **ÉCRITURE** — au moment où la donnée est produite, le module en archive une
   copie JSON gzip sur le Drive, dans le dossier canonique de l'instance
   (`projects/<projet>/<expérience>/<instance>/data/…`), sous un nom
   **déterministe** : `<instance>_<type>_restore.json.gz`
   (`Sample_1_nmr1d_restore.json.gz`). Le test ne garde qu'un **pointeur**
   minuscule (`nmr1dDrive = { id, name, stems }`) qui voyage avec le dataset,
   donc d'un poste à l'autre.
2. **LECTURE** — à l'ouverture de la page, si la donnée manque (absente, vide,
   remplacée par un marqueur, ou présente sans sa copie plein format), la copie
   est re-téléchargée **toute seule** puis réinjectée dans le test et dans la
   cache. Le portillon habituel s'applique : **une tentative par expérience et
   par session**, plus une reprise automatique dès que le Drive est connecté
   (`lab:drive-connected`), plus un bouton « ⬇️ Restore from Drive » comme repli
   explicite.

La copie de référence a deux formes, selon la **nature** de la donnée : une
archive **JSON gzip** quand c'est une *valeur* (spectre, colonnes de spectres,
textes PDB) — `archiveRestoreJson()` / `restoreJsonFor()` — et le **fichier
lui-même** quand c'est un *fichier* (vidéos et clips de microscopie, structure
3D du viewer, topologie et trajectoire MD) — `restoreRawFileFor()`, qui cherche
un fichier brut par pointeur, registre local puis nom. Dans les deux cas c'est
le Drive qui fait foi ; la cache ne fait qu'éviter un téléchargement.

L'écriture est **asynchrone** : un pointeur qui arrive après un changement
d'onglet / de condition est mis en attente et posé sur **sa** page quand elle
revient (`placeRestorePointer` / `takePendingRestorePointer`, dans le noyau) —
jamais sur la page devenue active entre-temps. Si le pointeur est perdu, la
recherche par nom retrouve quand même le fichier : aucun pointeur n'est une
donnée perdue.

### Où le fichier est cherché (dans cet ordre)

| # | Source | Marche sur un autre poste ? |
|---|--------|-----------------------------|
| a | le pointeur du test (id exact) | oui (il voyage dans le dataset) |
| b | le registre local des envois | non (il est dans `localStorage`) |
| c | une recherche par **nom** sur le Drive | **oui** — c'est elle qui sauve un poste vierge |

Le même nom sert de clé : `isRestoreFileName()` n'accepte que
`<stem>_<type>_restore.json(.gz)`, donc le spectre d'une autre condition
(`Sample_10`) ou d'un autre type de mesure (ssNMR) n'est jamais restauré à la
place d'un spectre 1D. Un fichier tombé dans la **corbeille** Drive est d'abord
remis en place (ses octets sont intacts). Un fichier dont le `kind` ne
correspond pas est **refusé**. La lecture ne résout (donc ne crée) aucun
dossier : une page ouverte ne sème pas d'arborescence fantôme.

Pour un **média** (vidéo de microscope, clip), la clé n'est pas un nom d'archive
mais le nom du fichier déposé : `matchesRawName()` compare le **radical**
(slugifié comme les noms Drive) et l'**extension** quand les deux en ont une —
un média consommé depuis un autre poste n'est donc jamais remplacé par le `.wmv`
d'origine quand c'est le `.mp4` converti qu'on cherche, ni par le clip d'une
autre expérience.

### Modules branchés

* **NMR 1D** — `NMRSections.jsx` (`applyNmrBruker` + l'import dossier) archive la
  copie de référence du spectre complet ; la page la restaure seule. Le pointeur
  d'un import arrivé pendant un changement d'onglet est posé sur la bonne
  instance dès qu'elle est ouverte.
* **ssNMR** — `ssNMRSections.jsx` archive la **section de colonnes**
  (`spectraColumns` + l'axe des déplacements) sous l'instance, au nom de la
  condition importée (`<instance>_ssnmr1d_restore.json.gz`), dans le même
  dossier `Data/Bruker 1r` que les fichiers bruts. L'import compose désormais
  ses conditions clonées hors de l'updater d'état : chacune part sur le Drive.
  Les colonnes vivant sur la **condition** (pas sur l'expérience), la clé du
  portillon et le pointeur (`ssnmrDrive`) suivent la condition affichée.
* **CD (Jasco)** — `CDSections.jsx` archive la même chose pour un spectre CD
  (`<instance>_cdspectra_restore.json.gz`, pointeur `cdDrive`), dans le dossier
  `Data/Spectra` des fichiers `.jws` importés — avec la sauvegarde mdeg de la
  conversion [θ] quand elle existe. Les conditions clonées par l'import
  multiple sont construites hors de l'updater d'état, donc archivées elles
  aussi.
* **Docking (HADDOCK / AutoDock)** — `DockingSections.jsx` archive les textes
  PDB du docking — structures `8_seletopclusts` **et** molécules de
  `raw_input.toml` (`<instance>_docking_restore.json.gz`, pointeur
  `dockingDrive`, dossier `Data/pdb files`) au moment où un répertoire de calcul
  est importé : ces textes vivent dans la base du navigateur (IndexedDB), pas
  dans le document, donc ils n'existaient que sur le poste qui a importé. La
  page Data réapprovisionne cette base depuis l'archive avant de rendre la main
  au viewer 3D.
* **Flow Cytometry** — avait déjà ce comportement (`handleRestoreFromDrive`) :
  il reste le modèle, rien n'a régressé.
* **MD** — `MDSections.jsx` rapatrie déjà structure et trajectoire du Drive
  quand la cache locale est vide (`downloadArchivedMDFile`). Depuis, les deux
  envois de l'import (topologie `.gro/.pdb/.cif`, trajectoire `.xtc/.trr/.dcd`)
  passent par `archiveFileToDriveWithPointer()` : le nom Drive et le **pointeur**
  (`structureDrive` / `trajectoryDrive = { id, name, url }`) restent sur la
  condition, donc l'**id exact** passe avant le registre local (qui vit dans le
  `localStorage` de chaque poste) et avant le nom. La recherche historique
  (« le nom Drive CONTIENT le radical déclaré ») reste le repli des datasets
  enregistrés avant que le pointeur ne voyage : rien n'est perdu.
* **Structure 3D du viewer (NMR, MD)** — le PDB choisi dans le viewer
  (`📂 PDB file(s)`) n'entrait PAS dans le dataset : seuls son nom
  (`structureFileName`) et, s'il était minuscule, son data URL y vivaient ; les
  octets restaient dans la base du navigateur du poste qui les avait importés.
  La page qui possède le fichier l'archive désormais **avec son pointeur**
  (`structureDrive`, dossier canonique `Data/Structure` pour le NMR,
  `Setup/Structure` pour le MD) et le re-télécharge seule à l'ouverture
  (`NMR_STRUCT_KIND = 'nmrstruct'`), puis le remet dans IndexedDB. Conséquence
  directe : le viewer 3D se recharge, **la séquence 1 lettre qu'il en déduit** est
  réécrite sur la condition (elle alimente toutes les tables de déplacements) —
  une page ouverte sur un autre poste ne montre donc plus une séquence vide avec
  des déplacements orphelins. Le viewer n'envoie plus lui-même le fichier
  principal quand la page le fait (sinon le même PDB partait deux fois et
  pouvait se dupliquer sur le Drive) ; il continue d'envoyer le fichier principal
  des pages sans handler (Docking) et les molécules supplémentaires.
* **Microscopie (vidéos de microscope et clips)** — `MicroscopySections.jsx` suit
  le même mécanisme avec une différence de **nature** : un média n'est pas une
  série de nombres, c'est un **fichier**. Rien à archiver en JSON (un clip de
  plusieurs centaines de Mo en base64 serait absurde) : la copie de référence est
  **le fichier envoyé au Drive à l'import**, et chaque entrée de `msVideos` /
  `msMovies` ne garde qu'un pointeur minuscule (`drive = { id, name, url }`) plus
  le nom déclaré à l'envoi (`driveName`, retenu même quand l'envoi part en file de
  reprise). Le noyau sait donc aussi lire un fichier **brut**
  (`restoreRawFileFor`), en comparant les noms par **radical + extension** — le
  `.mp4` converti n'est pas pris pour le `.wmv` d'origine. À l'ouverture de la
  page Data (vidéos) et de Data Analysis (clips), un média absent de la base du
  navigateur est re-téléchargé tout seul et remis dans `blobStore` ; les vignettes
  relisent alors leur blob (`cacheEpoch`). Les deux pages gardent un bouton
  « ⬇️ Restore from Drive » comme repli explicite.

### Vérifier soi-même

* `node _drive_restore_test.mjs` — la logique pure (marqueurs, noms, portillon,
  pointeurs en attente, refus des types croisés) et le cycle archivage →
  restauration sur un faux Drive, y compris un pointeur périmé, un fichier mis à
  la corbeille et un autre poste sans registre local ; puis le câblage des
  modules branchés : NMR 1D, ssNMR, CD, docking, microscopie — et, pour les
  **fichiers** (structure 3D du viewer, topologie et trajectoire MD), le pointeur
  qui voyage avec le dataset, le nom déposé qui sauve un poste vierge et la
  remise du fichier dans la base du navigateur (aucun doublon d'envoi).

## Une page d'expérience est celle d'UNE condition (et suit la condition affichée)

Signalé le 20/09/2026 : « la page MD ne s'actualise pas — j'ai chargé un PDB et
une trajectoire, supprimé une instance, et dans une fenêtre de navigation privée
les données étaient différentes ».

Cause : changer de condition (onglets **Date / Conditions**) ne **remonte** pas
la page d'expérience — seul `activeTest` change. Les états *propres à une
condition* gardaient donc la valeur de la condition précédente :

* la page MD annonçait `✓ Trajectory: <fichier de l'autre condition>` et le
  viewer 3D rendait l'autre système (`structureFile` / `trajectoryFile`) ;
* surtout, la **restauration** de la nouvelle condition ne partait JAMAIS : les
  deux effets de `MDSections.jsx` sortent tôt dès qu'un fichier est déjà « en
  main » (`if (trajectoryFile || …) return;`) — un PDB ou un `.xtc` présent sur le
  Drive n'était donc pas re-téléchargé pour cette condition ;
* une fenêtre neuve (navigation privée, autre poste) part de zéro, relit ses
  fichiers et montrait donc **autre chose pour la même condition** — d'où
  l'impression que « c'est sauvegardé dans la cache et jamais relu du Drive ».

Ce qui existe maintenant :

* `MDSections.jsx` retient l'identifiant de la condition affichée
  (`mdSetupIdRef`) : quand il change, l'état des fichiers est **remis à celui de
  la condition** (cache de session de CETTE condition, ou rien) et un jeton
  (`fileEpoch`) **relance** les deux restaurations (base du navigateur puis
  Drive). Une condition déjà visitée revient donc sans requête ; une condition
  jamais ouverte est restaurée du Drive comme sur un poste neuf.
* Même remise à niveau pour le **viewer 3D NMR** (`nmrStructPageIdRef` +
  `structFileEpoch`), et le portillon du Drive (`nmrStructDriveMissing`) ne
  considère plus le fichier de la condition précédente comme « déjà en main »
  (`nmrConditionChanged`) : la structure déclarée était, elle aussi, jamais
  re-téléchargée après un changement de condition.

### Un calcul long écrit sur la condition qu'il a MESURÉE

Une analyse MD (RMSD / RMSF / Rg / SASA, cartes de contacts, profils de membrane,
DSSP) dure plusieurs minutes : elle est lancée sur la condition affichée, et
l'utilisateur peut passer à une autre condition — ou en supprimer une — avant la
fin. L'écriture passait par `updateActiveTest(… )`, qui vise la condition
**affichée** : les valeurs d'une simulation atterrissaient donc sur la page
devenue active (des résultats calculés sur un autre système apparaissaient là, et
« les données différaient » d'une fenêtre à l'autre). Le funnel d'écriture accepte
maintenant une **cible** — `updateActiveTest(updates, targetTestId)`
(`activeTestModule.jsx`) — et la page MD la renseigne avec l'identifiant de la
condition qu'elle a mesurée : le tableau per-atome (`storeAnalysisToAtomTable`),
les courbes générales, les cartes de contacts et les profils de membrane
reviennent à **leur** condition. Sans cible, le comportement ne change pas : c'est
la condition affichée qui est écrite.

Côté **affichage**, la même règle s'applique (`shownTestIdRef` /
`onMeasuredPage`) : les courbes, les cartes de contacts, les profils et le DSSP
**ne se peignent que sur leur page**. Une analyse terminée alors que l'utilisateur
regarde une autre condition n'affiche donc rien ici (ni un échec qui ne la
concerne pas) ; ses résultats réapparaissent en revenant sur leur condition — la
copie locale et la fiche du test les portent.


## La dernière modification ne dépend plus d'un minuteur qui ne se déclenchera jamais

La sauvegarde Firestore d'un dataset est **en différé** (~1,5 s de calme) ; seul
le **contenu** déposé sur le Drive (`_workspace/datasets/ds_<id>.json`) était
vidé à la fermeture de l'onglet. Une modification suivie d'une fermeture — ou
d'un simple passage en arrière-plan — dans cet intervalle n'atteignait donc
jamais le cloud : l'autre fenêtre, ou l'autre poste, voyait encore l'état
d'AVANT. Cela se manifeste exactement comme « une condition supprimée qui
revient » ou « le fichier ajouté n'est pas là ».

`App.jsx` tient maintenant dans `pendingDatasetSaveRef` la sauvegarde qui attend
son délai, et `flushPendingSave()` — branché sur `pagehide` **et**
`visibilitychange` (arrière-plan) — l'envoie **tout de suite**, puis pousse la
copie Drive (`datasetCopyMirrorRef.flush()`) dans la foulée : la charge
(re)programmée ne reste pas dans son propre délai de 8 s. Ce qui attend n'est
donc plus perdu quand la page s'en va.

### Vérifier soi-même

* `node _condition_page_test.mjs` — la remise à niveau par condition (MD et NMR),
  le relancement des restaurations et l'envoi immédiat de la dernière sauvegarde.




## Le fichier DÉCLARÉ fait foi (un pointeur périmé ne reprend pas la main)

**Défaut signalé.** « J'ai chargé un PDB et une XTC dans un navigateur ; dans une
fenêtre de navigation privée, la même expérience essaie de charger `step7.gro` —
qui n'est pas ce que j'avais chargé. »

La condition ne porte que des **pointeurs** minuscules (`structureDrive`,
`trajectoryDrive` = `{ id, name, url }`) et les noms déclarés ; les octets vivent
sur le Drive. Trois règles se liguaient contre le fichier qu'on venait de choisir :

1. **L'id exact passait AVANT tout le reste.** Un pointeur resté de l'ancien
   fichier (l'ancien `.gro` d'une condition réutilisée) était téléchargé — et la
   page l'installait comme si c'était celui qu'on venait de charger.
2. **Un nouveau fichier n'effaçait pas l'ancien pointeur.** `handleStructureFile`
   / `handleTrajectoryFile` n'écrivaient le nouveau pointeur qu'à la fin de
   l'envoi : jusque-là — et pour toujours si l'envoi échouait (Drive non
   connecté) — la condition continuait d'annoncer le fichier PRÉCÉDENT comme sa
   copie de référence, donc l'autre fenêtre le ramenait.
3. Même famille : la recherche « historique » de `downloadArchivedMDFile`
   retombait sur « l'entrée la plus récente de cette expérience » dès qu'aucun nom
   ne correspondait — encore un fichier sans rapport, installé sans le dire.

Règles appliquées (noyau partagé, puis pages MD et NMR) :

* `driveRestore.pointerStillWanted` — un pointeur n'est placé **en tête** que
  s'il décrit encore le fichier voulu (même radical, `sameRawStemFor`). Sinon il
  est **essayé en dernier** : un fichier renommé sur le Drive reste retrouvé, mais
  il ne prend jamais la place du fichier déclaré. Les pages qui manipulent des
  fichiers lourds (trajectoire MD, structure NMR) passent `strictNames: true` :
  là, le pointeur périmé n'est **même pas téléchargé** — on ne rapatrie pas des Go
  pour les refuser ensuite.
* `driveRestore.wantedRawNames` — les noms cherchés sont ceux du **fichier
  déclaré** ; le nom déposé et le nom porté par le pointeur ne sont gardés que
  s'ils décrivent le même fichier (chercher les noms d'un ancien choix ramenait
  l'ancien fichier par la recherche par nom, `downloadArchivedMDFile` compris :
  ses deux étapes comparent maintenant par `sameRawFileFor`).
* Les pages **effacent le pointeur de l'ancien fichier dès qu'on en choisit un
  autre** (MD et NMR) : l'envoi pose le nouveau pointeur quand il aboutit, sans
  laisser de fenêtre pendant laquelle la condition annonce l'ancien.
* Une copie téléchargée qui **n'est pas** le fichier déclaré n'est plus installée
  en silence : la page le dit (`⚠️ … is not on Google Drive under that name — the
  archived copy found is “…”`) et laisse l'utilisateur re-sélectionner — mieux
  vaut « introuvable » qu'un autre système affiché sous le bon nom.
* Un pointeur d'envoi qui arrive **après** le choix d'un autre fichier (l'échange
  asynchrone avec le Drive) est ignoré de la même façon.

### Vérifier soi-même

* `node _drive_restore_test.mjs` — l'ordre des pistes (nom déclaré avant pointeur
  périmé, pointeur renommé encore retrouvé en dernier recours), les noms cherchés,
  et le câblage des deux pages.

## La copie locale ne prend pas le pas sur ce qui voyage (page MD)

Les courbes calculées sur une trajectoire (RMSD / RMSF / Rg / SASA) sont
conservées **deux fois** : dans la fiche de la condition (`mdAnalysisResult`, qui
part sur Firestore et dans la copie Drive) et dans une copie locale du navigateur
(`localStorage`), qui ne sert qu'à réafficher les graphes instantanément, sans
attendre la synchronisation. La page lisait la copie locale **en premier** :

* un calcul refait sur un autre poste laissait donc l'écran de celui-ci sur les
  anciennes courbes ;
* une fenêtre neuve (navigation privée, autre poste), qui n'a aucune copie
  locale, affichait celles de la fiche — **deux fenêtres, deux résultats pour la
  même condition**, exactement le « les données étaient différentes » signalé.

`preferAnalysisCopy(local, stored)` (dans `src/utils/mdAnalysisCache.js`, testé
pur) tranche par `savedAt` : la **fiche du test gagne** dès qu'elle est aussi
récente ou plus récente, la copie locale ne couvrant que les secondes qui
séparent un calcul de son enregistrement. Quand la fiche ne porte rien, la copie
locale s'affiche seule (l'affichage hors ligne reste possible).

### Vérifier soi-même

* `node _md_analysis_cache_test.mjs` — la règle des deux copies (dont le cas
  « recalcul fait ailleurs ») et le câblage de la page MD.




## « Le fichier revient de la base du navigateur » — la page dit enfin où elle cherche

Signalé le 20/09/2026 : *« dans la page en navigation privée le message dit que le
fichier est ramené de la base locale du navigateur, donc il ne le reprend pas du
Drive ; les deux fenêtres ont des données différentes pour la même expérience »*.

La phrase était **écrite en dur** sous le nom du fichier :

> ♻️ Restoring protein.xtc… — The file is being brought back from this browser's
> local storage. If it does not reappear (e.g. you're on a different browser/PC),
> re-select it…

Elle s'affichait dès qu'un nom de fichier était déclaré sur la condition, **avant
même** de savoir s'il y avait quelque chose à reprendre : dans une fenêtre de
navigation privée (base du navigateur vide) elle annonçait donc une restauration
locale qui n'avait pas lieu, pendant que la copie de référence dormait sur le
Drive. Quatre corrections, toutes dans `MDSections.jsx` (+ `driveRestore.js`) :

1. **Où en est la recherche, pour de vrai.** Deux états (`trajPhase`,
   `structPhase`) portent le texte affiché : `browser` (on interroge la base du
   navigateur), `drive` (pas là → requête sur Google Drive), `nocloud` (le Drive
   n'est **pas connecté dans ce navigateur** : il n'y a rien à tenter, on le dit
   et on dit quoi faire), `notfound` (ni ici ni sur le Drive), `done` (ramené, en
   précisant d'où : `brought back from this browser` vs `restored from Google
   Drive`). Plus aucune phrase ne promet un téléchargement qui n'a pas lieu.
2. **Un geste, pas une promesse.** Un bouton **⬇️ Bring it back from Google
   Drive** (trajectoire *et* topologie) relance la recherche à la demande, par
   exactement la même fonction que la tentative automatique
   (`restoreTrajectoryFromDrive` / `restoreStructureFromDrive`) : la page ne peut
   pas annoncer une chose et en faire une autre. Sans lui, un utilisateur dont la
   tentative automatique n'a rien trouvé (pointeur d'un ancien dataset, fichier
   renommé sur le Drive, connexion arrivée après coup) n'avait **aucun** moyen de
   forcer la reprise depuis le Drive.
3. **La copie de la base du navigateur est reconnue sous son nom Drive.** Les
   octets sont rangés sous une clé **par condition** (`traj_<id>`,
   `ms_struct_<id>`) mais sous le nom **déposé** sur le Drive
   (`<radical>_<scientifique>.<ext>`), plus long que le nom resté dans le
   dataset. Le test d'égalité stricte (`blob.name === activeTest.trajectoryFileName`)
   rejetait donc une copie parfaitement valable : la trajectoire entière était
   re-téléchargée à chaque rechargement, et sur un poste dont le Drive n'est pas
   connecté le fichier **ne revenait jamais** alors qu'il était dans la base.
   `sameRawFileFor(cachedName, wantedName)` (noyau partagé, testé pur) compare les
   **radicaux** — identiques, ou l'un préfixe de l'autre (`<radical>_…`) — et
   exige la même extension quand les deux en déclarent une (un `.trr` re-sélectionné
   à la place d'un `.xtc` est bien re-téléchargé). Le fichier ramené du Drive est
   renommé au nom **déclaré** sur la condition, pour que deux postes affichent et
   mémorisent la même chose.
4. **Un dataset qui arrive après l'affichage relance la recherche.** Les deux
   effets de restauration ne dépendaient que de `[activeTest.id, fileEpoch,
   driveConnectedAt]` : sur une fenêtre neuve, si la page s'affichait **avant** que
   le dataset ne soit relu du cloud, le premier passage sortait sans nom — et ne
   repassait plus jamais. La page restait alors sur « ♻️ Restoring… » **sans
   jamais interroger le Drive** : c'est le défaut tel qu'il a été vu. Les noms et
   pointeurs déclarés (`trajectoryFileName`, `trajectoryDriveName`, id du
   pointeur, idem topologie) font désormais partie des dépendances. Côté NMR 3D,
   le portillon du Drive ne se referme que sur une donnée déclarée : un nom de
   structure qui arrive après coup déclenche une tentative (`attempt('data-arrived')`).

Une restauration qui se termine **après** un changement de condition continue de
viser la condition qu'elle a lue : le fichier est rangé sous la clé de *cette*
condition et l'écran n'est repeint que si c'est encore elle qui est affichée
(`restoreTargetStillShown`). Comme pour les calculs longs : on écrit pour la
condition qu'on a mesurée, on ne peint que sur la page affichée.

### Vérifier soi-même

* `node _condition_page_test.mjs` — les textes d'état, le bouton de reprise, les
  dépendances « nom + pointeur » et la reprise NMR déclenchée par le nom.
* `node _drive_restore_test.mjs` — `sameRawFileFor` (copie du navigateur vs nom
  déposé sur le Drive) et le câblage des modules.

## La barre de lecture appartient à la CONDITION, pas seulement au fichier en main

Signalé le 20/09/2026, juste après la remise à niveau ci-dessus : « le viewer 3D
est bien affiché, mais il n'a ni bouton ▶ Play ni curseur Frame ».

Deux défauts se cumulaient — et tous les deux faisaient disparaître la barre
alors que la trajectoire EXISTAIT.

1. **La reprise exigeait un NOM DÉCLARÉ.** L'effet sortait tout de suite quand
   `activeTest.trajectoryFileName` était vide :

   ```js
   if (trajectoryFile || !activeTest.trajectoryFileName) return;
   ```

   Or un dataset dont la sauvegarde en différé a perdu le nom (voir « la dernière
   modification ne dépend plus d'un minuteur… ») garde pourtant soit ses octets
   dans la base du navigateur — rangés sous la clé **de la condition**
   (`traj_<id>`, `ms_struct_<id>`) — soit le **pointeur** de la copie de
   référence (`trajectoryDrive`, `structureDrive`). La page ne cherchait donc
   nulle part alors que le fichier était à portée : le viewer 3D restait sans
   trajectoire, donc sans barre de lecture. Le bouton « ⬇️ Bring it back from
   Google Drive » avait exactement le même portillon (`if (!wantedName) return`).

   Maintenant : la **base du navigateur est toujours interrogée** (la clé déjà
   rangée par condition dit que la copie est la bonne), puis le Drive est
   interrogé dès qu'un **nom**, un **nom déposé** ou un **pointeur** existe. Le
   seul cas où rien n'est tenté est « ni l'un, ni l'autre, ni l'autre » — la
   ligne invite alors à re-sélectionner le fichier. Quand le fichier revient
   alors que le nom déclaré manquait, ce nom est **réécrit sur SA condition**
   (`updateActiveTest({ trajectoryFileName: restored.name }, testId)`), donc il
   voyage à nouveau vers les autres postes.

2. **La barre n'était rendue que pour un fichier EN MAIN** —
   `{(trajFile || trajectoryFile || trajectorySrc) && (…)}` : tant que la copie
   de référence n'avait pas fini de descendre (un `.xtc` peut peser des
   centaines de Mo), l'écran ne montrait ni barre, ni état, rien. Le viewer 3D
   reçoit désormais le **nom déclaré**
   (`trajectoryName={activeTest.trajectoryFileName || activeTest.trajectoryDriveName || ''}`) :
   la barre apparaît dès qu'une trajectoire existe pour la condition, avec l'état
   honnête

   > ⏳ “<nom>” is declared on this experiment but is not loaded in this browser
   > yet — press “⬇️ Bring it back from the cloud” (the reference copy) in the
   > playback bar just below, or pick the file here with 📂 Trajectory. ▶ turns on
   > as soon as the frames are read.

   et ▶ ne s'active que lorsque les images sont réellement lues
   (`trajStatus === 'ready'`) : aucune barre qui promet une lecture inexistante.

Dans les deux cas, la ligne « System files » — juste au-dessus du viewer — dit
désormais l'état des **deux** fichiers (topologie *et* trajectoire), avec le
même bouton de reprise, et elle les tient pour **déclarés** dès qu'un nom OU un
pointeur en parle (`trajDeclared`, `structDeclared`) : un dataset dont la
sauvegarde a perdu le nom ne ressemble plus à un dataset qui n'a jamais eu de
fichier.

Enfin, **retirer un fichier le retire pour de vrai** : « ✕ »/« Remove this
trajectory » efface le nom **et** le pointeur (`trajectoryDrive`,
`trajectoryDriveName` — idem topologie), sinon la reprise ramenait aussitôt, par
le pointeur ou par la base du navigateur, le fichier que l'utilisateur venait de
retirer.

### Vérifier soi-même

* `node _condition_page_test.mjs` — les portillons « nom, nom déposé OU
  pointeur », la réécriture du nom déclaré quand il a été perdu, l'effacement du
  pointeur au retrait, le nom déclaré passé au viewer et la ligne « déclarée mais
  pas encore là ».
* `node _drive_restore_test.mjs` — `sameRawFileFor` et le câblage des modules
  (le pointeur de la condition est toujours ce que la page envoie au noyau).

## La barre « 🧬 System files » a été RETIRÉE (20/09/2026)

Demandé tel quel : « la section *System files — loaded with the 3D viewer buttons
below* peut être entièrement supprimée ». Elle regroupait, juste au-dessus du
viewer 3D de la page MD : l'état des deux fichiers, les deux boutons **⬇️ Bring
it back from Google Drive**, les sélecteurs **Topology format / Atom labels /
Trajectory format**, le champ **🎞️ Trajectory online link** et **⬆ Archive
trajectory to Drive**. Tout cela a disparu : les fichiers se chargent et se
règlent désormais uniquement par les commandes du viewer 3D — 📂 PDB file(s) /
PDB ID · URL / 📂 Trajectory / ⬇ PDB (frame) / 🗑 Delete PDB ⇄ ↩ Restore PDB /
🗑 Clear / 📷 Figure (voir §1 General).

Ce qui n'a **pas** changé :

* **Le format reste reconnu TOUT SEUL.** Le viewer reçoit toujours
  `structureFormat={activeTest.structureFormat || 'auto'}` (NGL déduit le format
  du fichier lui-même) et `trajectoryFormat={d.trajectoryFormat}`
  (`detectTrajectoryFormat` suit le nom du fichier ou de l'URL) : rien à régler
  pour un `.xtc`, `.trr`, `.dcd`, `.gro`, `.pdb` ou `.cif`.
* **Les deux reprises automatiques restent branchées**, par les mêmes fonctions
  (`restoreTrajectoryFromDrive` / `restoreStructureFromDrive`) et dans le même
  ordre : base du navigateur → Google Drive. Le geste **à la demande**, lui, est
  revenu avec sa phrase, renommé (voir le § suivant).
* Les états de la recherche : `trajPhase` et `trajDriveMsg` sont de nouveau LUS
  (la barre de lecture affiche le constat de la reprise) ; `structPhase` et
  `structRestoreMsg` restent **écrits** mais privés (`_`) : la reprise de la
  topologie reste automatique et sa recherche n'est affichée nulle part.

*Vérifier :* `node _condition_page_test.mjs` — la barre est absente
(`🧬 System files`), le format reste auto-détecté, les deux reprises
automatiques sont toujours appelées, et le bouton « ⬇️ Bring it back from the
cloud » est rendu par le viewer (voir le § suivant).

## Le geste de reprise à la demande est revenu — renommé « ⬇️ Bring it back from the cloud » (25/09/2026)

Signalé : *« quand j'ouvre une page MD la trajectoire n'est pas chargée et je vois
le message “… is declared on this experiment but is not loaded in this browser yet —
press “⬇️ Bring it back from Google Drive” …”, mais ce bouton n'existe pas. Si tu le
réinstalles, change son nom en “bring back from the cloud”.»*

La phrase était juste sur le fait, fausse sur le geste : le bouton nommé a bel et
bien existé — **jusqu'à ce que la barre 🧬 System files soit retirée**, les deux
gestes à la demande vivant dedans. La phrase du viewer était restée à l'ancien monde
et envoyait donc presser un bouton disparu : une tentative automatique manquée
(pointeur d'un ancien dataset, fichier renommé sur le Drive, Drive connecté après
coup) n'avait plus **aucun** recours — exactement le cas signalé.

Le geste est revenu **là où la phrase le demande**, et **renommé** :

* le bouton **⬇️ Bring it back from the cloud** est rendu par le viewer, dans la
  barre **▶ Trajectory playback**, juste après la phrase qui le demande. La phrase
  n'envoie plus « sur la page » et ne nomme plus Google Drive : le cloud du poste
  peut être Nextcloud. Quand la page ne fournit aucune fonction de reprise, aucun
  bouton n'est rendu (aucune promesse creuse) ;
* la page ne fournit que **sa fonction de reprise** et **l'état de sa recherche** :
  `onBringTrajectoryBack` = `bringTrajectoryBack` → `restoreTrajectoryFromDrive`,
  **la même fonction que la tentative automatique** (un seul essai à la fois, refusé
  tant que le précédent tourne) ; `bringTrajectoryNote` = son constat mot pour mot ;
  `bringTrajectoryBusy` = une recherche tourne, auquel cas le bouton est inerte. Un
  seul chemin de code : rien ne peut dire une chose et en faire une autre ;
* le constat de la recherche s'affiche **sous la phrase** — sans lui, un clic alors
  que le cloud n'est pas connecté ne produirait rien de visible — et seulement pour
  une recherche en cours (phase `drive`) ou son échec (`nocloud`, `notfound`, y
  compris une erreur inattendue, qui est alors écrite au lieu d'être avalée) :
  `done` et `browser` n'affichent rien, pour qu'une reprise réussie, ou un envoi, ne
  laisse pas sa phrase sous une ligne qui dit « pas encore là » ;
* les deux états de la **trajectoire** (`trajPhase`, `trajDriveMsg`) redeviennent
  donc visibles ; ceux de la **topologie** restent privés (`_structPhase`,
  `_structRestoreMsg`) : sa reprise reste automatique et n'a pas de ligne dédiée.

*Vérifier :* `node _condition_page_test.mjs` — le bouton existe et porte le nouveau
nom, l'ancien nom a disparu de la phrase, et le geste comme la tentative automatique
passent par la même fonction.

## Le champ « PDB ID / URL / local file » a été RETIRÉ (page NMR, volet 3D)

Demandé tel quel : « nel molecular viewer elimina la sezione *PDB ID / URL /
local file* ». Ce champ vivait dans la page NMR (`MolecularStructureSection`),
juste au-dessus du viewer 3D, sous le sélecteur **2D Formula / 3D Viewer** et le
🔍 **Focus** ; il recopiait dans `activeTest.structureSrc` ce que les commandes
du viewer écrivent déjà (📂 PDB file(s) / « PDB ID or URL » → `onStructureSrc`).
Deux champs pour une même adresse finissent par diverger, et c'est celui du
viewer qui est RÉELLEMENT chargé. Partis avec lui : son état de frappe
« découplé » (`localPdbInput`, celui qui évitait de re-rendre le WebGL à chaque
touche) et son bouton **Load**.

Ce qui n'a **pas** changé :

* **La source reste multiple, et se donne au même endroit.** Un code PDB (1UBQ…),
  une URL, un fichier déposé sur le viewer ou un PDB fourni par la page : tout
  passe par le viewer, seul auteur de `activeTest.structureSrc`.
* **La structure affichée ne bouge pas.** Le champ ne faisait qu'écrire
  `structureSrc`, qui est toujours recalculé dans la section à partir de
  `activeTest.structureSrc || activeTest.pdbId` : les conditions déjà remplies
  montrent exactement la même structure.
* Le sélecteur **2D Formula / 3D Viewer**, le 🔍 **Focus**, la sélection d'atome
  dans la séquence, le viewer (et son §1 General) et le bouton **📥 Download 3D
  PDB File** sont inchangés.

*Vérifier :* `node _compact_sections_test.mjs` — l'étiquette JSX et son invite
ont disparu, l'état de frappe et le handler aussi, et le viewer reste le seul à
écrire `structureSrc` ; `node _viewer_ui_layout_test.mjs` — le champ **PDB ID or
URL** du viewer répond toujours présent (c'est désormais la seule porte).

## « 🔄 Refresh » relit la source partagée avant de reconstruire la page (20/09/2026)

Rapporté tel quel : « ho su due schermi lo stesso esperimento ma uno è in una
finestra normale del browser e l'altra su una finestra in incognito. se su una
tabella dell'esperimento normale scrivo un numero e clicco refresh su quella in
incognito non succede niente; se invece ricarico il programma il numero appare ».

Le bouton ne se contentait de **re-monter** le contenu de la page (clé React) :
les sections repartaient des données **en mémoire**. Or une fenêtre de navigation
privée ne partage **ni** `localStorage` **ni** la mémoire du programme : tout ce
qu'une *autre* fenêtre venait d'enregistrer n'existait pour elle qu'après un
**rechargement complet** (F5) — qui, lui, relit la source partagée. Le bouton
faisait donc bien quelque chose, mais sur les données d'**avant** : d'où le
symptôme exact « Refresh ne fait rien, F5 oui ».

`App.jsx` fait maintenant deux choses, **dans cet ordre** :

1. **Il relit la source partagée et l'adopte** — `readSharedDatasetRecord()` lit
   le **document du dataset dans le cloud** (Firestore,
   `artifacts/<appId>/public/data/datasets/<id>`), et si le cloud ne répond pas
   (règles, hors ligne) sa **copie sur le Drive**
   (`_workspace/datasets/ds_<id>.json`, la même que `openDatasetFromDrive`) : le
   cloud d'abord parce qu'il est écrit ~1,5 s après le calme, la copie Drive
   ~8 s. Rien n'est lu dans `localStorage`, qui n'est justement pas partagé entre
   deux fenêtres ;
2. **puis il re-monte le contenu** (clé React), pour que chaque section, graphe,
   tableau et viewer 3D reparte des données qui viennent d'être adoptées.

L'adoption passe par **un seul chemin**, celui d'une ouverture :
`openDataset(record, { keepPlace: true })` (`App.jsx`). `keepPlace` empêche
seulement de **déplacer l'utilisateur** — `keepPlace` garde le module courant,
la page d'administration ouverte, l'historique de navigation et **l'expérience
regardée** (rafraîchir la 3ᵉ condition d'un essai ne ramène plus sur la
première ; on n'y retombe que si elle a disparu de la copie relue). Tout le
reste est le chemin d'ouverture déjà éprouvé, donc aucune divergence entre
« ouvrir » et « rafraîchir ».

Le résultat est **dit** dans la barre fine, à côté de « ✓ page refreshed » :
« ⟳ re-reading the shared data… » pendant la relecture, puis « shared data
re-read » / « re-read from the Drive copy », ou, en **orange**, la raison de
l'échec (« shared data not re-read (cloud / Drive unreachable) — rebuilt from
this browser ») : un rafraîchissement muet est précisément le défaut corrigé ici.

Ce qui n'a **pas** changé : le bouton est toujours **un** entonnoir
(`refreshTestPage`, seule la clé `test-page-${testPageNonce}` re-monte la page),
l'utilisateur ne quitte jamais sa page, et une sauvegarde en attente n'est ni
vidée ni interrompue par la relecture (adopter le contenu repris re-pose la
sauvegarde sur ce contenu).

*Vérifier :* `node _refresh_shared_read_test.mjs` — la relecture (cloud puis
copie Drive, rien du `localStorage`), l'ordre « relire **avant** de re-monter »,
`openDataset(…, { keepPlace: true })`, les deux navigations gardées, l'expérience
conservée et la note (busy / succès / échec orange) ; `node _ui_scale_test.cjs` —
le bouton, son entonnoir et la confirmation « ✓ page refreshed ».

## Un dataset créé sur un poste manquait à la liste des AUTRES (20/09/2026)

Signalé le 20/09/2026 : *« une expérience DOSY créée sur un PC est absente dans la
fenêtre de navigation privée ; l'expérience **et ses données** doivent être
visibles indépendamment du poste. »* À l'examen, ce n'est pas seulement
l'expérience qui manquait : **le dataset entier** était absent de la liste.

Trois trous, tous sur la LISTE (le CONTENU, lui, avait déjà ses deux copies) :

* `lab_datasets_local_v2` n'était écrit QUE par le mode « sans Firestore », alors
  qu'`App.jsx` le **relit** toujours (au démarrage, et quand Firestore ne répond
  pas) : une fenêtre neuve n'avait donc rien à lire ;
* une écriture Firestore peut être acquittée **localement** (le SDK « compat »
  garde ses écritures en attente jusqu'à la synchronisation) ou refusée (session
  expirée) : le dataset créé n'existait alors que pour ce poste, et `newDataset`
  ne le disait pas — la barre latérale annonçait « Cloud Sync » ;
* `_workspace/state.json` n'était écrit qu'après 2,5 s de calme et **n'était pas
  vidé** à la fermeture de l'onglet (la copie du contenu, elle, l'était) : un
  dataset créé juste avant de fermer n'entrait jamais dans l'index partagé.

Désormais (`src/utils/datasetListIndex.js`, `App.jsx`, `workspaceDrive.js`) :

* la liste a **sa propre copie** dans le navigateur, écrite à CHAQUE changement,
  en mode Firestore aussi. C'est un **index** (jamais `payload` : sinon
  `keys.json` dépasse son plafond de 8 Mo et son écriture est refusée EN BLOC,
  donc plus rien ne voyage). Seule exception : le mode sans Firestore, où cette
  liste **est** le contenu (`{ keepContent: !db }`) ;
* elle voyage par `_workspace/keys.json` et y est fusionnée **par contenu**
  (union par identifiant, la fiche la plus récente gagne) : le « [] » d'un
  navigateur neuf ne peut plus effacer la liste des autres postes — même règle
  que les bibliothèques de figures ;
* après `adoptKeysFromDrive`, la liste adoptée est **relue** et complétée dans la
  liste affichée (comme `refreshLibraryFromStorage()` pour les images) ;
* la création d'un dataset inscrit sa fiche **tout de suite** (liste + copie du
  navigateur) et **vérifie** que le serveur l'a reçue (`waitForPendingWrites`) :
  sans confirmation, la barre latérale le DIT au lieu de laisser croire que tout
  est dans le cloud ;

## « Color by : atom charge » dans la fenêtre de styling (02/10/2026)

Demandé mot pour mot : « In the “molecule styling” window add a “color by” option:
atom charge. »

La fenêtre « Molecules · styling » tire déjà ses colorations d'UN seul endroit — le
vocabulaire `COLOR_LABELS` et les listes `COLORS` (une par type de molécule) — donc la
nouvelle lecture n'a été écrite qu'UNE fois, et elle apparaît sur **chaque rangée** :
protéine (General · Backbone · Side chains), acide nucléique (General · Backbone ·
bases · ribose), lipide (General · headgroups · heads (N · O) · P · chaînes acyle ·
glycérol), sucre, ligand, eau, ion. La barre des SÉLECTIONS et celle de la membrane,
qui DÉRIVENT leur menu du même vocabulaire, l'offrent du même coup.

Ce qu'elle peint :

* **la charge PARTIELLE de chaque atome**, lue dans la table que le ⚡ ESP construit
  déjà pour la structure (`espChargesFor`, un parcours par structure, mis en cache) :
  la charge du FICHIER quand il en porte une (PQR · MOL2 / SDF chargés), **le modèle de
  charges de la PAGE** pour une protéine (`partialChargesOf` sur le graphe de la
  structure — PEOE plus les groupes formels que le graphe montre : la lecture même du
  panneau ⚙ ; depuis le 03/10/2026 il remplace la table CHARMM de NGL, qui laissait un
  hydrogène de squelette et l'`OXT` à **zéro**), la charge FORMELLE d'un ion
  (Na⁺ +1, Cl⁻ −1…), et
  l'estimation par électronégativité des autres hétéro-atomes (décalée pour que le
  résidu somme à zéro). Les deux colorations ne peuvent donc pas se contredire ;
* sur **les trois pastilles éditables de « Charge »** de la roue ⚙ (négatif · neutre
  · positif), et non sur une palette en plus : une couleur changée là repeint la
  coloration. Le NEUTRE est la couleur d'une charge nulle, et |q| fait marcher
  l'atome vers le pôle de son signe ;
* **échelle pleine ±1 e** (`ATOM_CHARGE_DOMAIN`) : un atome à −1 e (un chlorure, un
  carboxylate) est AU pôle négatif, un sodium AU pôle positif, et une charge formelle
  de ±2 e (un magnésium) s'écrase sur son pôle au lieu d'inventer une quatrième
  couleur ;
* **le repli est le `partialcharge` de NGL lui-même** — le colormaker natif de la
  même grandeur (rouge → blanc → bleu sur `atom.partialCharge`, domaine ±1 e) — et non
  un aplat d'éléments : sans le schéma maison, une molécule est peinte quand même.

Deux garde-fous DANS le schéma, nés des mesures de cette session :

* un schéma instancié **sans structure** (la sonde du registre NGL) peint le NEUTRE
  de la roue, jamais du noir ;
* un atome **absent** — `atomChargeOf(null, structure)` — rend 0 et non la charge de
  l'atome 0 : `Number(null)` vaut 0, donc la première version du garde faisait peindre
  à un atome inexistant la charge du premier atome de la molécule. C'est la nouvelle
  suite qui l'a attrapé — comme, avant lui, une rampe qui partait du mauvais bout (le
  pôle, `t = 1`, rendait le NEUTRE au lieu de la pastille du signe).

Ce qui n'a **pas** changé : « Charge » (le SIGNE, trois valeurs, offert sur un ion
seul), « Electrostatic potential » (une surface ajoutée à la rangée), les palettes et
la roue ⚙ (aucun second ⚙ dans une rangée : la rangée se contente d'ÉCRIRE que les
trois pastilles de « Charge » sont les ancres de sa rampe), les listes de styles, et
tous les autres vocabulaires.

*Vérifier :* `node _viewer_atom_charge_test.mjs` — la rampe EXTRAITE puis EXÉCUTÉE
(charge nulle = pastille neutre, ±1 e = les pôles, ±2 e écrasés au pôle, une charge
illisible = neutre, les deux moitiés du signe), les pastilles de la roue VIVANTES
(changer le pôle négatif déplace la rampe, le pôle opposé ne bouge pas), la MÊME table
que le ⚡ ESP (l'oxygène d'un ligand est négatif, un sodium vaut +1, un atome sans
structure / sans index / hors table vaut 0), et le schéma enregistré dans le VRAI
NGL 2.4 puis instancié sur une structure réellement parsée (chaque atome prend la
couleur de SA charge, un sodium prend EXACTEMENT la pastille positive, une molécule
sans structure le neutre) ; `node _viewer_ui_layout_test.mjs` — « Atom charge »
offert ET libellé sur chaque liste de chaque type (la liste est lue dans la source
puis parcourue), le câblage des deux barres, l'infobulle du menu et la phrase de la
rangée ; `node _viewer_color_settings_test.mjs` — le schéma maison d'abord, le
`partialcharge` natif en repli ; `node _viewer_style_coverage_test.mjs` — la matrice
« Color by » (la scène n'est jamais vide) passe la nouvelle coloration ;
`node _verify.cjs` — les 36 suites vertes ; `node _viewer_render_smoke_test.mjs` —
le rendu réel (SSR) ne jette pas ; `npx oxlint
src/components/NMRMoleculeViewer.jsx` — 0 erreur.

* l'index du Drive est vidé sur `pagehide` et au passage en arrière-plan.

*Vérifier :* `node _dataset_index_test.mjs` — l'index sans contenu, l'union qui
n'oublie jamais un dataset (ni n'efface la liste partagée), le fusionneur
enregistré pour `lab_datasets_local_v2`, la copie écrite à chaque changement, le
vidage de `state.json` à la fermeture, et le câblage réel dans `App.jsx` ;
`node _workspace_drive_test.mjs` — l'index du Drive complète toujours la liste du
poste.


## Une trajectoire de plusieurs Go n'arrivait pas sur le Drive (25/09/2026)

Signalé : « hier j'ai chargé une trajectoire dans une image MD et l'analyse a marché ;
aujourd'hui, sur un autre poste, la trajectoire ne se charge plus — et sur le Drive
je trouve tout le chemin où elle devrait être, mais pas le fichier ». Le fichier était
très gros.

Ce qui se passait : **tout envoi partait en UNE seule requête** (`uploadType=multipart`),
et deux choses rendaient l'échec invisible :

* **la chaîne de dossiers se crée AVANT les octets** (`resolveDrivePathFromNames`) —
  un envoi qui échoue laisse donc EXACTEMENT ce qui était vu : le chemin existe, le
  fichier est absent ;
* **l'échec était muet** : `archiveFileToDriveWithPointer` ne faisait qu'un
  `console.warn` et rendait `{ name, pointer: null }` — impossible de distinguer
  « archivée » de « restée dans ce navigateur ». Pire : au-delà de
  `pendingUploads.MAX_SINGLE_BYTES` (250 Mo), le fichier n'entrait même pas dans la
  file de reprise (`reason: 'too_large'`), donc les seuls octets existants étaient
  ceux de la cache du navigateur **de ce poste**.

Désormais (`src/utils/driveChunkUpload.js`, branché dans `driveUpload.js`) :

* au-delà de `RESUMABLE_MIN_BYTES` (**5 Mio**, la limite annoncée de l'envoi en une
  requête), le fichier part par **SESSION « resumable »** : ouverture (`POST`, ou
  `PATCH` du fichier remplacé), puis des morceaux de **8 Mio** (multiple de 256 Kio,
  exigence de l'API) avec leur `Content-Range` ; Drive répond **308 + `Range`** tant
  que le fichier est incomplet, puis la ressource au dernier morceau ;
* **un morceau qui tombe est rejoué** : la session est d'abord interrogée
  (`bytes */<total>`) pour savoir où elle en est — rien n'est renvoyé deux fois pour
  rien, rien n'est perdu, et `sent` ne recule jamais ;
* le nom, le type, le dossier (`parents`) et le remplacement d'un fichier existant
  sont **exactement** ceux de l'envoi en une requête : seule la façon de transporter
  les octets change (l'arborescence ne bouge pas d'un iota) ;
* `driveFetch` accepte un **chemin absolu** (l'URL de session porte un `upload_id`,
  elle ne se reconstruit pas) et un `accept` de statuts non-ok (**308**) ;
* **l'échec se dit** : `archiveFileToDriveWithPointer` rend `{ name, pointer, error }`
  et la page MD écrit la raison (« trop gros pour la file de reprise (250 Mo max) »,
  réseau, session, permission) au lieu d'un succès trompeur ;
* la page MD affiche l'**avancement** (`⬆️ Archiving … 42%`) : une attente de
  plusieurs minutes ne peut plus ressembler à une perte ;
* une session REFUSÉE (`Location` illisible, p. ex. réponse CORS sans l'en-tête
  exposé) rend `null` : l'envoi en une seule requête reste le repli, donc rien ne
  régresse si l'environnement ne permet pas la session.

*Vérifier :* `node _drive_big_upload_test.mjs` — calculs de morceaux (bornes incluses,
dernier plus court, en-têtes `Range`), seuil, session complète sur un faux Drive
(fichier **assemblé octet par octet**), morceau en échec rejoué, session qui reste
ouverte (la ressource vient de l'« ack »), session refusée (repli), et le câblage
réel dans `driveUpload.js` / `MDSections.jsx`.


## Un dossier au nom d'un projet n'existe plus à la racine du dataset (25/09/2026)

Signalé : « je trouve des dossiers au nom d'un projet **en dehors du dossier
`projects`** ».

Ils venaient des **documents de section** de la page projet : chaque section
(Scientific background, Discussion, Conclusions…) envoyait ses fichiers dans
`<dataset>/<projet>/<section>` — donc un **second dossier de projet**, posé à la
racine du dataset, à côté de `projects/` (la structure déclarée d'un dataset
n'admet que `projects`, `general_library_images`, `backups`, `protocols`,
`storage`, `publications`). Un projet renommé laissait même l'ancien dossier
orphelin. Le programme connaissait ce doublon (il le mettait à la corbeille à la
suppression d'un projet), mais il le **créait** lui-même.

Désormais :

* la route est `projects/<projet>/<section>` — `driveNaming.projectSectionFolderPath`
  et `driveFolderPath({ project, section })` (document de projet SANS expérience) :
  le document d'une section vit **dans le dossier du projet**, comme ses expériences,
  ses figures (`images`), son document de texte (`<projet>_document.json`) et ses
  `useful_files`. L'étiquette « 📁 Drive location » et l'envoi ne peuvent pas diverger :
  elles passent par la même fonction ;
* **le Drive déjà touché est rangé tout seul**, une fois par dataset, quand le Drive
  est prêt (`src/utils/projectRootMigrate.js`, appelé par `App.jsx` juste après
  `migrateCommonLibraryOnce`) :
  `<dataset>/<projet>/<section>/<doc>` → `<dataset>/projects/<projet>/<section>/<doc>` ;
* ce qui est **reconnu** : un dossier de la racine dont le nom est celui d'un dossier
  déjà présent dans `projects/`, ou dont le contenu est fait de dossiers de section de
  projet (`driveNaming.isProjectSectionFolderName`). Un dossier incompris est
  **laissé** et annoncé (`kept`) — on ne range pas ce qu'on ne comprend pas, et un
  conteneur partagé n'est jamais candidat ;
* la **fusion** ne perd rien : un dossier de section dont le nom est déjà pris dans le
  projet reçoit seulement les **fichiers** de l'autre ; un **fichier** dont le nom est
  déjà pris est **laissé** (on n'écrase jamais un document) et son dossier ne peut donc
  pas partir à la corbeille ;
* un dossier vidé part à la corbeille, et son **chemin est mis en pierre tombale**
  (`labDriveMirror`) : plus aucun envoi ne le recrée ;
* un chemin **déjà supprimé** dans le programme n'est pas « réparé » : la migration
  l'ignore (c'est ce qui empêche de ressusciter le dossier d'un projet supprimé) ;
* la suppression d'un projet continue de mettre à la corbeille **les deux** chemins
  (`projects/<projet>` et le `<projet>` historique) : un Drive d'avant ce correctif
  n'a donc pas besoin d'être rangé pour être supprimé proprement.

*Vérifier :* `node _project_root_migrate_test.mjs` — la route et l'étiquette, la
reconnaissance (dossier de projet vs conteneur partagé vs inconnu), le déménagement
sur un faux Drive (déplacement, **fusion**, non-écrasement d'un fichier en double,
corbeille + pierre tombale du chemin abandonné, dossier incompris laissé), et le
câblage réel dans `App.jsx` ; `node _library_restore_test.mjs` et
`node _storage_drive_layout_test.mjs` — les chemins déclarés du rangement des
documents de projet.

## Page NMR : la formule 2D dans « Sequence and structure », le viewer 3D repliable, et les cases 🎯 Target nuclei (02/10/2026)

Demandé mot pour mot : « remove the empty lines between the "sequence and
structure" section and the viewer. Make the 3D Viewer section collapsible and
independent of the 2D formula. Include the 2D formula in the "sequence and
structure" section. the insert "target nuclei" does not act on the table as it
should. Move its atom ticks in horizontal before the button "publication table".
If ticked the corresponding nuclei must appear in the table. »

Ce qui a changé (page NMR, `MolecularStructureSection` et `DataSection` de
`src/components/NMRSections.jsx`) :

* **Le sélecteur 2D ⇄ 3D a disparu** et personne ne cache plus personne :
  * la **formule 2D** (l'ancien volet « 2D Formula » : `StructureSVGView` pour une
    séquence, `OrganicViewer` pour un SMILES) vit maintenant **dans la
    sous-section « Sequence and structure »** — celle qui porte la peinture 🖌️ et
    sa bande de séquence —, qui est **ouverte par défaut** (c'est là que la
    formule se voit ; `CollapsibleSection` mémorise le choix par expérience) ;
  * le **viewer 3D a SA propre sous-section repliable** (« 🧬 3D viewer »), plus
    bas, juste après. Une condition restée en mode 3D (`structureMode: '3d'`) la
    rouvre toute seule : rien n'est perdu pour les expériences déjà remplies ;
* **replier le viewer 3D ne le DÉMONTE pas** (`keepMounted` sur
  `CollapsibleSection`, `src/components/ui.jsx`) : le contenu n'est créé qu'à la
  première ouverture, reste monté ensuite (masqué en CSS) et la page est prévenue
  de chaque repli / dépliage (`onToggle`) pour recaler le viewer et les tracés sur
  la largeur — replier / déplier n'émet aucun « resize » du navigateur ;
* **plus de grand blanc** entre la bande de séquence et le viewer : le bloc
  `mt-6 border-t … pt-6` qui séparait la sous-section du volet 2D/3D est parti, les
  deux sous-sections sont empilées côte à côte ;
* le **🔍 Focus** et le **✖ Deselect** (le résidu suivi par la table 🔢, les tracés
  et la bande de séquence) sont passés **dans l'en-tête de la sous-section 3D** :
  ils restent accessibles même repliée, sans occuper une rangée ;
* les cases **🎯 Target nuclei** (H / N / C / P) ont quitté leur encadré vertical du
  haut de la page pour la **barre de la table 🔢, à l'horizontale, JUSTE AVANT le
  bouton « 📄 Publication Table »** ;
* **et elles agissent enfin sur la table** : une case cochée fait APPARAÎTRE les
  lignes de ce noyau dans la table des déplacements, la décocher les retire (la
  cellule « Residue » s'étend sur les lignes restantes). Le noyau est lu sur
  l'étiquette que la colonne « Nucleus / Atom » affiche (`(¹H)`, `(¹³C)`, `(¹⁵N)`,
  `(³¹P)`) par la règle `atomInSelectedNuclei` — une étiquette sans noyau reconnu
  n'est jamais cachée, et une condition sans sélection (avant cette demande) ne
  perd aucune ligne. Le même état `activeTest.selectedNuclei` commande toujours les
  spectres simulés correspondants (³¹P, HSQC ¹⁵N), exactement comme avant.

Ce qui n'a **pas** changé : la table des déplacements (Backbone / All Atoms,
✨ Fill Estimated, 🗑 Empty all, 📥 Import Fitted Parameters, la sélection de
cellules, la table de publication et sa fenêtre d'export avec ses propres cases
« Include Nuclei »), le viewer 3D et son §1 General, le bouton **📥 Download 3D
PDB File**, la reprise Drive du fichier de structure, et les pages MD / Docking
(elles gardent leur sélecteur 2D / 3D).

*Vérifier :* `node _nmr_nuclei_table_test.mjs` — la règle du filtre est extraite
de la source et EXÉCUTÉE (les quatre étiquettes de noyau, cocher / décocher ³¹P
et ¹⁵N, une étiquette sans noyau jamais cachée, une sélection absente qui ne cache
rien), les cases sont bien dans la barre AVANT « 📄 Publication Table », l'ancien
encadré vertical a disparu, la table filtre ses lignes avant de les dessiner, la
formule 2D et la bande de séquence sont dans la MÊME sous-section, le viewer 3D a
la sienne (avec `keepMounted` / `onToggle`) et plus aucun blanc ne les sépare ;
`node _residue_numbering_panels_test.mjs`, `node _compact_sections_test.mjs`,
`node _ss_dihedral_test.mjs`, `node _viewer_ui_layout_test.mjs` — les invariants
des trois pages et du viewer 3D tiennent toujours.

## Page NMR : « Cysteine states » à côté de la case de séquence, un quart de la page au plus (02/10/2026)

Demandé mot pour mot : « Move teh "cysteine state" panel next to the "Protein
Sequence (1-letter code)" panel. Its width shuld not be larger that 1/4 teh page
width. »

Ce qui a changé (page NMR, « Set Up » de `MolecularStructureSection`,
`src/components/NMRSections.jsx`) :

* la case **« Sequence (1-letter code) »** (son en-tête est `{d.typeLabel}` :
  Protein, DNA ou RNA) et le panneau **« Cysteine states »** (les états −SH /
  S−S / auto de chaque cystéine, les ponts ⚭ et la couleur de chaque pont) sont
  désormais **côte à côte**, dans UNE SEULE rangée (`flex flex-col md:flex-row` :
  empilés en dessous de `md`, comme avant, et côte à côte au-dessus). C'est la
  case de séquence qui garde toute la place restante (`flex-1 min-w-0`) ;
* le panneau est **la colonne de droite de cette rangée** et **porte lui-même sa
  largeur** : `md:w-1/4` borné par `md:max-w-[25%]` (un quart de la page au
  plus, jamais plus), `shrink-0` (la rangée ne peut pas l'élargir) et `min-w-0`
  (c'est son contenu qui se replie, pas la colonne qui s'élargit). Sous `md`, il
  reprend toute la largeur, empilé sous la case ;
* **aucune colonne vide** : la largeur est portée par le NŒUD RENDU du panneau,
  qui n'existe que pour une **protéine** ayant au moins une cystéine (l'IIFE
  écrit `if (cysPositions.length === 0) return null`). En DNA / RNA, ou pour une
  protéine sans Cys, la case de séquence reprend donc toute la rangée — ni
  colonne fantôme, ni « gap » de flex ;
* plus de `mt-2` de superposition : l'espacement entre la case et le panneau est
  celui de la rangée (`gap-6`), comme entre deux colonnes normales.

Ce qui n'a **pas** changé : le contenu même du panneau (défauts Reduced /
Oxidized, les états par Cys, la définition des ponts ⚭ et leur retrait, les
couleurs de pont, la note « oxidized Cys ¹³Cβ ≈ 39.6 ppm · reduced ≈ 28.0 ppm »,
la numérotation 🔢 qui suit le viewer 3D, et les états comme les ponts toujours
rangés par POSITION de séquence) ; la case de séquence (longueur, note de nature,
avertissement « sequence is empty ») ; le SMILES d'une molécule organique ; les
sucres et les phospholipides ; la formule 2D dans « Sequence and structure » ; le
viewer 3D ; les pages MD et Docking.

*Vérifier :* `node _cysteine_panel_layout_test.mjs` — la rangée et l'ordre des
deux colonnes (le panneau est un FRÈRE de la case, pas dedans), la largeur lue
dans la source puis **calculée** pour des pages de 768 à 2560 px (jamais plus
d'un quart pour le panneau, jamais moins de trois quarts pour la case), la règle
qui repère les cystéines extraite de la source et **exécutée** (aucune colonne
vide sans Cys, rien en DNA / RNA), et tout ce qui n'a pas bougé ;
`node _viewer_render_smoke_test.mjs` — le rendu réel de la page NMR (SSR) ne
jette pas, la nouvelle rangée comprise.

## Page d'expérience : « Compounds & Biological Models » à côté de « Classification » (02/10/2026)

Demandé mot pour mot : « move teh "compounds and biological models" panel nxt to
teh "classification" panel ».

Ce qui a changé (bloc GENERAL de `src/components/TestShellRenderer.jsx`) :

* les deux sous-sections COURTES **« Classification »** et **« Compounds &
  Biological Models »** vivaient déjà dans la MÊME grille, mais la grille ne
  s'ouvrait en deux colonnes qu'au palier **`xl`**. Or un palier Tailwind est en
  **rem**, et l'application écrit la taille racine (échelle d'affichage,
  `src/utils/uiScale.js` — **15 px par défaut**) : `xl` valait donc **1200 px**
  (et jusqu'à 1440 px si l'échelle était agrandie). Sur un écran de portable les
  deux volets restaient EMPILÉS l'un sous l'autre alors que la page avait la
  place. La grille passe au palier **`md`** (`md:grid-cols-2 md:gap-x-4`), soit
  **720 px** au grossissement par défaut et **768 px** quand le navigateur
  reprend son 16 px : « Classification » reste la colonne de GAUCHE,
  « Compounds & Biological Models » celle de DROITE, et sous `md` (téléphone)
  elles s'empilent comme avant ;
* les deux colonnes font EXACTEMENT la moitié : `grid-cols-2` vaut
  `repeat(2, minmax(0, 1fr))`, donc aucun contenu ne peut élargir la sienne ;
* `min-w-0` sur les DEUX boîtes (`CollapsibleSection … className="min-w-0"`)
  garantit la même chose du côté du contenu : une boîte ne peut pas être poussée
  plus large que sa colonne, et passer sous sa voisine ;
* **aucune colonne vide** : la grille n'ouvre ses deux colonnes que si la
  sous-section « Compounds & Biological Models » est RENDUE
  (`(showCompoundsSection || CompoundsSection)`) — sans elle, la grille reste
  `grid-cols-1` et Classification occupe toute la largeur, sans « gap » de
  grille.

Ce qui n'a **pas** changé : le contenu des deux sous-sections (le classement
primaire / secondaire et la liste de catégories de la Library ; les listes
« Compound / Sample Label(s) » et « Cell Lines / Biological Models », avec la
`CompoundsSection` propre à certaines pages), leur ORDRE, leur état
replié/déplié mémorisé par expérience, et la grille interne des deux listes
déroulantes (`lg:grid-cols-2`).

*Vérifier :* `node _compact_sections_test.mjs` — les deux sous-sections
partagent la grille à deux colonnes, Classification en premier, les deux boîtes
en `min-w-0`, plus aucun palier `xl:grid-cols-2`, la grille ne s'ouvre que si le
volet Compounds est rendu, et le palier est lu dans la source puis CONVERTI en
pixels pour les deux tailles racine possibles (720 px au grossissement par
défaut, 768 px au 16 px du navigateur) : le remettre à `xl` remonte le seuil à
1200 px et le test échoue. `node _viewer_render_smoke_test.mjs` — le rendu réel
des onze pages ne jette pas, la rangée comprise.


## « Under the sequence field » : la lecture d'une séquence, sous LES DEUX cases (02/10/2026)

Demandé mot pour mot : « Under the sequence field please write the number of each
type of aminoacids, the total charge at pH 7 and the estimated molar extinction
coefficient. Keep this information compact utilising as much horizontal space.
In the library the compound are defined with their modification, like acetylation
or amidation. the charge should keep this into account. If the sequence is
written directly into the sequence space, assume free termini. »

**Où l'on ne la voyait pas.** La ligne (composition · charge à pH 7 · ε₂₈₀)
avait été écrite UNE fois, dans la fiche du composé de la Librairie
(`AppModules/compoundDefinitionSection.jsx`). Mais l'application a **deux cases
de séquence**, et c'est la seconde que l'on remplit tous les jours : la case
**« … Sequence (1-letter code) »** de la page NMR
(`NMRSections.jsx`, sous-section « Molecular structure and visualization »),
sous laquelle il n'y avait que « Length: N residues (valid: …) ». Rien à voir
avec un bug de calcul : la ligne n'existait tout simplement pas là.

Ce qui a changé :

* **UN SEUL RENDU** — `src/components/SequenceReadingLine.jsx` porte la ligne
  (les trois choses de la demande, la mise en page compacte `flex flex-wrap`
  « utilising as much horizontal space », ses deux terminus dits en mots et sa
  bulle d'aide). La fiche de la Librairie **et** la case de séquence de la page
  NMR rendent CE composant : deux copies du JSX ne peuvent plus diverger ;
* la page NMR calcule sa lecture avec **le même module pur**
  (`utils/sequenceCharge.js` — le pKa de CHAQUE chaîne latérale, les deux
  terminus), **le même texte de modifications** (`activeTest.modifications`,
  celui que la fiche du composé sème dans la condition juste au-dessus) et
  **le même pH 7** : la ligne de la Librairie, celle de la page et la charge du
  ⚙ « Params & Constraints » ne peuvent pas se contredire. Seule une protéine a
  une composition d'acides aminés : pour un ADN / ARN, un sucre, un lipide ou
  une molécule organique il n'y a rien à dire, et **rien n'est rendu** ;
* **un vrai bug corrigé dans la fiche de la Librairie** : sa case de séquence est
  un `RichTextEditor`, donc du **HTML**. La lecture lui passait le texte BRUT, et
  `analyzeProteinSequence` ne garde que les lettres A–Z : les lettres des
  **balises** (« div », « br »…) se comptaient comme des acides aminés dès que la
  case contenait un retour à la ligne ou du texte collé. Elle lit maintenant
  `stripHtml(sequence)`, comme le calcul du poids moléculaire juste à côté.

Ce qui n'a **pas** changé : la table des pKa et Henderson–Hasselbalch
(`utils/sequenceCharge.js`), la règle des terminus (libres par défaut, retirés
par Acetylation / Acylation / Formylation et Amidation), l'ε₂₈₀ de Pace
(`analyzeProteinSequence`), la ligne elle-même et le ⚙ « Params &
Constraints ». Aucune seconde roue, aucun second calcul : c'est le même modèle,
montré à un endroit de plus.

*Vérifier :* `node _sequence_charge_test.mjs` — 112 assertions : le module
(+3,00 e pour le peptide du rapport), la ligne partagée, et les DEUX cases qui
l'appellent. `node _sequence_line_render_test.mjs` — **la ligne RENDUE pour de
vrai** (SSR) : « 31 aa · A 1 · F 1 · … V 2 · net +3.00 e at pH 7 · free N-term ·
free C-term · ε₂₈₀ 0 M⁻¹cm⁻¹ », les capuchons dits, et RIEN pour une lecture
absente. `node _viewer_render_smoke_test.mjs` — la page NMR monte et rend son
HTML. `npx oxlint src/components/SequenceReadingLine.jsx` — 0 erreur.

---

## « all pages » : la même lecture sous CHAQUE case de séquence — et le calcul descend dans la ligne (02/10/2026)

Demandé mot pour mot, en deux temps : « Show the sequence reading line (per-AA
counts · net charge at pH 7 · ε₂₈₀) under the sequence field **on all pages** —
not just NMR, but MD and Docking too. »

**Où l'on ne la voyait pas encore.** L'entrée précédente croyait l'application
servie : elle parlait de « LES DEUX cases de séquence » (la fiche du composé de la
Librairie et la case de la page NMR). L'application en a **quatre** : le même
panneau « … Sequence (1-letter code) », écrit par `{d.typeLabel}`, vit dans
**trois** modules de page — `NMRSections.jsx`, `MDSections.jsx` et
`DockingSections.jsx` —, et seule la première était câblée. Un balayage du
dossier (`grep 'Sequence (1-letter code)'`) donne la liste ; c'est ce balayage qui
a révélé les deux cases oubliées, pas un rapport de bug.

Ce qui a changé :

* **LE CALCUL DESCEND DANS LA LIGNE** — `SequenceReadingLine` accepte maintenant
  les **ingrédients** (`sequence` · `modifications` · `moleculeType`, pH 7 par
  défaut) et fait la lecture lui-même (`useMemo`, module pur
  `utils/sequenceCharge.js`) ; il accepte toujours un `reading` déjà fait (la
  fiche de la Librairie, dont la case est du HTML, lui passe
  `stripHtml(sequence)`). Conséquence : **une case de séquence s'écrit en une
  ligne**, et elle ne peut ni oublier les modifications du composé, ni prendre un
  autre pH, ni oublier que seules les protéines ont une composition d'acides
  aminés. Les deux `useMemo` `seqReading` des appelants — et leurs imports du
  module — ont disparu : une seule porte d'entrée, un seul calcul ;
* **MD et Docking rendent la ligne** sous leur case, au même endroit que NMR :
  juste après « Length: N residues » et avant la note de nature, avec les mêmes
  ingrédients (`d.rawSequence`, `d.moleculeType`, `activeTest.modifications`) ;
* **une garde pour la prochaine case** — la suite exige désormais : tout fichier
  qui écrit « Sequence (1-letter code) » doit rendre `<SequenceReadingLine>`, et
  **une seule fois**. Ajouter un cinquième panneau de séquence sans sa ligne
  fera échouer `_sequence_charge_test.mjs` ;

Ce qui n'a **pas** changé : le modèle (le pKa de chaque chaîne latérale, les
terminus libres par défaut puis capuchonnés), le pH 7, l'ε₂₈₀ de Pace, la bulle
d'aide, et le ⚙ « Params & Constraints » (qui, lui, lit ce modèle-là au pH de sa
case). Ni la règle « rien pour un ADN / ARN / sucre / lipide » : la nature du
composé est la porte d'entrée des DEUX façons d'appeler la ligne.

*Vérifier :* `node _sequence_charge_test.mjs` — **138 assertions** : les QUATRE
cases (Librairie, NMR, MD, Docking) et une seule porte d'entrée pour le calcul.
`node _sequence_line_render_test.mjs` — **32 assertions, 12 cas rendus pour de
vrai** (SSR) : les deux façons d'appeler la ligne donnent **le même texte** ; une
séquence coupée par un retour à la ligne donne les mêmes nombres ; le **piège du
HTML** est montré (« 37 aa » au lieu de 31 quand on passe la séquence brute d'un
`RichTextEditor` — d'où `stripHtml` côté Librairie) ; **rien** pour un ADN, un
sucre, une case vide ou des espaces seuls. Et les voisins : `_sequence_natures_test.mjs`
(155), `_compact_sections_test.mjs` (211), `_condition_page_test.mjs` (123),
`_cysteine_panel_layout_test.mjs` (50), `_residue_numbering_panels_test.mjs` (78),
`_md_analysis_cache_test.mjs` (78), `_md_axis_cfg_test.mjs` (73),
`_docking_scatter_card_test.mjs` (19), `_docking_sanity.cjs`,
`_docking_scatter_test.cjs`. `node _verify.cjs` — 36 suites, **0 échec**.
`npx oxlint` sur les 5 fichiers touchés — 0 erreur (et **0 avertissement** sur la
ligne elle-même).

## Viewer : 💧 H-bonds dans 📏 Analysis, et la charge de l'atome au survol (02/10/2026)

Deux demandes, deux gestes dans la fenêtre 3D : « in the section analysis of the
viewer, add a button to display H-bonds. » et « when hovering on an atom display
not only the name but also the charge. »

Ce qui a changé :

* **UN BOUTON 💧 H-bonds dans le groupe 📏 Analysis**, à côté de 📏 Measure et de
  ⚡ ESP. Il **dessine** les liaisons hydrogène de la molécule choisie dans la barre
  des Molecules : **une seule** représentation NGL `distance` porte TOUS les couples
  donneur → accepteur (jamais une représentation par pont), les lignes s'allument en
  ambre et chaque ligne écrit sa distance tant qu'elles sont peu nombreuses (40) —
  au-delà, les lignes seules, un mur de chiffres cachant la structure qu'on regarde.
  Le bouton **dit toujours ce qu'il a fait** : « 132 H-bonds on ‹ chain A › — donor
  N/O/S with its hydrogen: r(H···A) ≤ 2.5 Å and angle D–H···A ≥ 120° · solvent left
  out », ou « no H-bond found on … » quand la géométrie n'en donne aucun. Il se
  reclique pour retirer ses lignes, et **rien n'est écrit dans la molécule** : ni le
  texte PDB, ni le graphe de liaisons, ni un style — c'est une LECTURE, comme
  📏 Measure juste à côté ;
* **LA RÈGLE EST UN MODULE PUR** (`utils/hydrogenBonds.js`, testable sans NGL).
  Avec les hydrogènes de la structure : donneur = N·O·S qui porte un H, accepteur =
  N·O·S qui n'en porte **aucun** (un groupe qui a gardé son hydrogène donne, il
  n'accepte pas), r(H···A) ≤ **2,5 Å** ET angle D–H···A ≥ **120°**. Sans aucun
  hydrogène (un PDB de rayons X, un ligand nu) : donneurs et accepteurs sont tous les
  N·O·S et le critère retombe sur les lourds, r(D···A) ≤ **3,5 Å** — le repli
  classique, et le mode appliqué est **écrit à l'écran**. Sont écartés : la paire
  déjà liée (1-2), la paire 1-3 (le N–CA–C=O d'un peptide, à 2,4 Å), deux atomes
  d'un **même résidu**, et le **solvant** (une coquille d'eau fait plus de ponts que
  toute la protéine : la note le dit). Un couple donneur/accepteur ne compte qu'**une
  fois**, et le dessin est plafonné à **600** ponts (les plus courts, tri croissant)
  — `capped` le dit. Les accepteurs sont rangés dans une **grille de 3,5 Å**, donc
  un donneur ne compare qu'aux 27 cellules autour de lui : sans cela, un système
  solvaté ou une membrane (des milliers de N·O·S) ferait un balayage **quadratique**
  — plusieurs secondes d'arrêt au clic. La grille est une optimisation, et une suite
  le **prouve** : sur 600 atomes tirés au sort, elle rend exactement la liste d'un
  balayage exhaustif, à cheval sur les frontières de cellules compris ;
* **les lignes meurent avec leur molécule** : `clearHydrogenBonds()` accompagne
  **chaque** `clearMeasurements()` du viewer (nouveau chargement, ⏹ Abort, PDB rangé,
  🗑 Clear) — une suite le vérifie appel par appel ;
* **LE SURVOL DIT LA CHARGE** : l'infobulle de survol écrit le nom **puis** ce que
  l'atome porte — `ALA A 1 CB · q = −0.256 e`. La charge vient de la **même table**
  que le ⚡ ESP et la coloration « Atom charge » (`espChargesFor`, un seul parcours
  par structure) : le survol ne peut donc pas annoncer autre chose que ce que la
  surface peint. (⚠ La moitié protéique de cette table est devenue, le 03/10/2026, le
  modèle de charges de la page : un hydrogène de squelette et l'`OXT` du terminus C,
  que NGL laissait à 0, y portent enfin une charge — voir la section du 03/10/2026.)
  La mise en forme est pure (`utils/viewerAtomReadout.js`) : millième
  d'électron, **vrai signe moins** (−, U+2212), aucun signe sur le zéro, et **rien**
  pour une molécule dont ni le fichier ni NGL ne décrivent les charges —
  `atomHoverChargeOf` rend `null` là où `atomChargeOf` rend 0, parce que peindre en
  neutre et écrire « 0 » ne disent pas la même chose.

Ce qui n'a **pas** changé : 📏 Measure et ⚡ ESP (mêmes boutons, mêmes états,
mêmes représentations), la table de charges du ⚡ ESP, les styles, les sélections, et
le fichier PDB — le bouton H-bonds n'écrit rien. Le groupe Analysis gagne une
infobulle à jour et la ligne du §2 les annonce tous les trois
(`📏 Measure · 💧 H-bonds · 🟢 Assigned`).

*Vérifier :* `node _viewer_hbonds_test.mjs` — **131 assertions** : la règle
**exécutée** sur des géométries construites à la main (linéaire / trop loin / couché
à 100° / paire 1-2 / paire 1-3 / même résidu / atomes **sans** résidu / eau / mode
« lourds » / plafond et tri) et la **preuve de la grille** (un pont à cheval sur deux
cellules, puis l’égalité exacte avec un balayage exhaustif sur 600 atomes), le tout
puis appliqué à une **vraie structure parsée par NGL 2.4** (le fichier, le mode, les
indices, l'angle, et la lecture de la structure seule comme du composant) ; le bouton
lu dans la source (une seule représentation, le plafond d'étiquetage, la note, le
bouton désactivé sans structure) ; et le survol, formateur pur exécuté **et** helpers
extraits du viewer puis exécutés sur la même structure. La suite est entrée dans
`node _verify.cjs` — **37 suites, 0 échec**.
`npx oxlint` sur les fichiers touchés — 0 erreur et **aucun nouvel avertissement**
(62 avant, 62 après sur `NMRMoleculeViewer.jsx`) ; `node _viewer_render_smoke_test.mjs`
— 23 assertions, le viewer (et sa nouvelle barre) montés pour de vrai.

## Viewer : la charge de la PROTÉINE (H explicites · `OXT`) et le réseau de 💧 qui suit la géométrie (03/10/2026)

Deux défauts constatés à l'usage, dans la continuité de la session précédente :

1. « explicit protein H and OXT read 0 » — le survol annonçait `q = 0.000 e` sur un
   hydrogène de squelette et sur l'`OXT` d'un terminus C, et la surface ⚡ ESP y était
   **blanche** : les atomes qui portent justement les pôles amide et carboxylate ;
2. « the H-bonds should follow the geometry during MD » — le réseau de 💧 était calculé
   **une fois au clic** : les lignes suivaient bien leurs deux atomes (c'est NGL qui les
   place), mais le CHOIX des couples restait gelé — un pont qui se forme pendant une
   dynamique n'apparaissait jamais, un pont qui casse restait dessiné.

Ce qui a changé :

* **la table de charges de la PROTÉINE est celle de la PAGE, plus celle de NGL.** La
  cause était dans le bundle : la table CHARMM de NGL (`electrostatic-colormaker.ts`)
  n'a que les atomes LOURDS du squelette et des chaînes latérales — ni `H`, ni `OXT` :
  `chargeForAtom` y rend **0**. `espChargesFor` lit maintenant, pour tout atome
  protéique, **`partialChargesOf`** (utils/forceFieldKcal : PEOE sur le graphe, plus la
  charge des groupes formels que le graphe montre) — la fonction qui donne ses charges
  au champ et dont le panneau ⚙ lit sa charge nette, appliquée au graphe lu sur la
  structure (`geometryOfStructure`). Mesuré sur une alanine N/C-terminale complète : les
  trois H de l'ammonium passent de 0 à **+0.113 e**, l'`OXT` de 0 à **−0.736 e**,
  l'azote du terminus prend la charge du groupe **ammonium** (+0.659 e) et le carboxyle
  celle du **carboxylate** — la somme de la molécule reste nulle. Ce que NGL dit
  encore : le fichier d'abord (PQR · MOL2 / SDF — rien ne l'écrase), les **hydrogènes
  d'amide placés** par NGL (`hHash` / `hCharges`, son potentiel de surface, gardés tels
  quels), les ions (charge formelle) et l'estimation d'électronégativité des
  hétéro-atomes d'un ligand (décalée pour que le résidu somme à zéro : un ligand n'est
  pas un ion). Le coût est **mesuré** — 27 ms à 2 000 atomes, 193 ms à 40 000 — et il
  est payé **une fois** par structure et par modèle (la table est mise en cache), au
  premier lecteur : le survol, la rampe « Atom charge » ou ⚡ ESP ;
* **le modèle est DÉPOSÉ, pas deviné** : `espChargesFor` vit au niveau du **module**
  (les schémas NGL enregistrés une fois le lisent) et ne peut donc pas voir l'état React
  du ⚙. D'où `espChargeModelStore` — un magasin du module, le **jumeau de
  `chargeColorStore`** — que le viewer remplit dans un effet, avec le lecteur du graphe
  et **le pH de la case ⚙**. Conséquences voulues : la table est **celle du panneau**
  (mêmes charges à la même chimie), l'entrée de cache porte **le modèle et le pH**
  (changer le pH refait le parcours au lieu de resservir la table d'avant), et **sans
  modèle la table de NGL revient telle quelle** — le repli, jamais un vide ;
* **le réseau de 💧 est RELU là où les coordonnées arrivent** (`refreshHydrogenBonds`,
  à côté de `refreshScenePlates`), et nulle part ailleurs : les trois écritures de
  coordonnées du viewer (`writeStructurePositions` — chaque image d'un ▶ MD, d'un
  ⚒ Minimise, d'un 🧬 calcul de structure, d'une ✏️ torsion, d'un glisser d'atome —,
  `applyPartMove`, `restorePartMoves`) et l'**écouteur du signal `refreshed`** (une image
  de TRAJECTOIRE, que NGL écrit sans passer par nous). Une seule représentation NGL est
  **reconstruite en place** (`atomPair` est déclaré `{ rebuild: true }` dans
  distance-representation.ts), jamais une seconde ;
* **le rythme est réglé par le coût, pas par une horloge fixe** : 200 ms entre deux
  balayages (≈5 Hz), l'intervalle **double** quand un balayage coûte plus de 8 ms
  (jusqu'à 1 s) et retombe au minimum quand il redevient bon ; éteindre 💧 remet tout à
  zéro. Et avant toute écriture NGL, l'**EMPREINTE** du réseau (son mode, son nombre de
  ponts et une somme roulante FNV-1a des couples donneur → accepteur) est comparée : une
  image qui ne change pas un seul pont ne coûte **ni reconstruction NGL, ni rendu
  React** — la phrase du bouton, elle, n'est réécrite que si son TEXTE change ;
* **le réseau n'appartient qu'à UNE molécule** : `refreshHydrogenBonds(comp)` compare la
  molécule qui vient de bouger à celle du bouton — la boîte de solvant d'un ▶ MD ou une
  molécule extra qui bougent ne le touchent pas.

Ce qui n'a **pas** changé : 📏 Measure, ⚡ ESP (mêmes boutons, mêmes surfaces : ⚡ ESP
partage la table, il n'a jamais été gelé), les styles, les sélections, le fichier PDB —
💧 n'écrit toujours rien. Le ligand et l'ion gardent exactement leurs charges d'avant
(vérifié : le résidu du ligand somme à zéro, le sodium vaut +1).

*Vérifier :* `node _viewer_hbonds_test.mjs` — **184 assertions** (contre 131) : le
rafraîchissement est **exécuté** sur une vraie structure NGL avec une fausse
représentation qui enregistre ce que NGL recevrait — 💧 éteint ne balaie pas, une autre
molécule non plus, un réseau qui change est écrit **dans la même** représentation, deux
images identiques n'écrivent rien (empreinte), deux appels rapprochés ne balaient qu'une
fois (rythme), un balayage lent fait doubler l'intervalle jusqu'au plafond puis un
balayage redevenu bon le ramène au minimum, un pont qui casse voit ses lignes partir
(`atomPair: []`) — et l'empreinte vérifiée à part (même réseau ⇔ même empreinte).
`node _viewer_style_gaps_test.mjs` — **267 assertions** (contre 240) : la table de la
protéine est comparée **atome par atome** à `partialChargesOf` sur le même graphe, la
table de NGL n'est plus qu'un **repli** (retiré le modèle, elle revient telle quelle), le
pH est dans la clé du cache, et l'alanine N/C-terminale **prouve** le défaut corrigé
(NGL : `0` sur H1 · H2 · H3 · OXT ; le modèle : +0.113 / −0.736, ammonium et carboxylate
reconnus, somme nulle). `node _viewer_atom_charge_test.mjs` — 135 assertions.
`node _verify.cjs` — **37 suites, 0 échec** (`_viewer_rings_gradient_test.mjs` inclus :
son écouteur du signal `refreshed` exécute le VRAI `refreshHydrogenBonds`, qui sort sur
son premier garde — 💧 est éteint dans une suite de plaques).
`npx oxlint src/components/NMRMoleculeViewer.jsx` — **0 erreur** et **aucun nouvel
avertissement** (62 avant, 62 après : l'effet qui dépose le modèle est annoté comme les
onze autres effets de palettes du fichier).



## Définition de séquence : le TOUR imposé (lettre T) et les FEUILLETS β déclarés, parallèles ou antiparallèles (03/10/2026)

La demande, mot pour mot : **« In the sequence definition, beyond, alpha helix right and
left, coil and beta strands, add the possibility to impose turns and to associate beta
strands to make a beta sheet, parallel or antiparallel. »** Les deux moitiés sont faites,
et chacune a sa mesure.

**1 · LE TOUR — une lettre de plus dans la définition (`T`).**

* `SS_META.T = { label: 'γ-Turn (C7)', color: '#14b8a6' }` : le pinceau 🖌️ l'affiche
  après C · H · L · E, dans les **trois** pages (NMR, MD, Docking), et la page NMR et la
  page MD ont le bouton « All γ-Turn » ;
* `SS_TORSIONS.T = φ +75° / ψ −65°` (la géométrie CONSTRUITE) et
  `SS_DIHEDRALS.T = { phi: 75, psi: -65 }` (la contrainte de dihèdre) portent **le même
  couple** : un tour peint tombe à 0° de la cible que « ⛓ SS → φ/ψ » lui impose — la
  règle déjà tenue pour E. C'est le **tour γ de la littérature** (Rose–Matthews), la
  seule conformation de tour qu'UN résidu puisse imposer ;
* il **fait** quelque chose, et c'est mesuré sur le modèle de la page : le carbonyle d'un
  résidu T vient à **2,72 Å** de l'amide du résidu i+2 — le pont C7 du tour γ lui-même,
  que le réseau 💧 du viewer trouve alors tout seul — contre 3,77 Å pour une pelote, et
  il **courbe** la chaîne (CA(i)–CA(i+2) = 5,52 Å contre 6,55 Å pour la pelote) ;
* `getSSAt` (les trois pages) accepte la lettre (`'HESLT'`), et les corrections de
  déplacements chimiques l'envoient sur la ligne `coil` : un tour n'est ni une hélice ni
  un feuillet, c'est le choix que fait déjà la 2° structure à trois couleurs du viewer.

**2 · LE FEUILLET — deux brins E appariés, parallèles ou antiparallèles.**

Le module neuf et pur **`src/utils/betaSheetFold.js`** est la seconde moitié :

* il **relit** la déclaration (`{ a: [3, 5], b: [8, 13], sense }`, en **positions de
  séquence** 1-based comme `cysDisulfides`) : les brins sont les suites de `E` de la
  peinture, et tout ce qui ne correspond plus (fourchette hors séquence, brin d'un
  résidu, deux fourchettes qui se recouvrent, sens inconnu, doublon) est **compté**
  (`rejected`) au lieu d'être deviné ;
* il **replie** le modèle de séquence : une recherche locale déterministe (graine fixe,
  bibliothèque des tours β, budget d'évaluations) sur les φ/ψ des deux brins et de la
  boucle qui les sépare, avec un objectif qui ne demande AUCUN registre écrit en dur —
  chaque résidu doit trouver un partenaire CA à 4,85 Å, un pont N···O à 2,9 Å, les deux
  axes doivent être opposés (antiparallèle) ou de même sens (parallèle), et l'alignement
  des deux brins est trouvé par **programmation dynamique** (un feuillet cisaillé coûte
  donc cher). Ce qu'il ne peut pas faire, il le DIT : `converged`, ou `best-effort` avec
  les chiffres réellement obtenus ;
* `sheetGeometryOf` est le **lecteur partagé** : l'écrivain PDB s'en sert pour les REMARK,
  la sonde, le panneau et le repliement lisent donc tous la MÊME géométrie ;
* le **fichier** l'écrit : un record `SHEET` par brin (identifiant en colonne 10, chaîne
  en 14, nombre de brins en 16, fourchettes, et le **sens signé** +1 / −1), `REMARK 950`
  (combien de feuillets, combien de déclarations devenues invalides) et un `REMARK 951`
  par paire **avec les élongations CA–CA et le nombre de ponts mesurés sur les
  coordonnées écrites** ;
* l'**interface** est un panneau 🧵 dans « Sequence and structure » de la page NMR : les
  brins peints y sont proposés par leurs numéros du 🔢, on en apparie deux, on choisit le
  sens, et la note sous les puces dit ce que le modèle a donné (échelons, ponts,
  convergence). La bande de séquence marque les résidus appariés (un petit repère du
  glyphe et du rang du brin) — dans les **trois** pages, par le même lecteur.

Ce qui n'a pas changé : sans déclaration, le modèle sort exactement comme avant (les deux
brins à plus de 8 Å l'un de l'autre), `proteinSequenceToPdbText` reste **extractible**
(le bloc du feuillet est inerte quand une sonde reconstruit la fabrique par
`new Function`), et le mode 🎓 University test ne replie **aucun** feuillet (le modèle
dirait la réponse, comme il ne peint déjà aucune structure secondaire).

Les limites, dites franchement : une boucle de **deux** résidus entre les brins ne suffit
pas toujours à les refermer (`best-effort`, avec les ponts obtenus annoncés), et une
déclaration qui ne correspond plus à la séquence ne replie rien — elle est comptée dans
le panneau **et** dans le fichier, jamais cachée. Le repliement d'un feuillet ne touche
QUE la fenêtre des deux brins et de leur boucle : une hélice qui vit ailleurs garde ses
φ/ψ au bit près.

*Vérifier :* `node _ss_sheet_test.mjs` — **143 assertions**, la neuvième suite de la
session : les quatre tables de la lettre T et les trois pages, le tour γ **mesuré** sur
le vrai bâtisseur (pont C7 ≤ 2,9 Å, courbure, cible de dihèdre exécutée), la relecture de
la déclaration (les sept refus comptés), le repliement antiparallèle ET parallèle
(convergence, échelons, ponts, cosinus des axes), la **déterminisme** (deux appels
identiques), l'hélice hors fenêtre **intacte au bit près**, les trois raisons honnêtes
(`no-pair`, `no-model`, `already-sheeted` avec une seule évaluation), et le fichier
**relu** : deux records `SHEET` dont le second porte −1 (ou +1), et les chiffres des
`REMARK 951` comparés à ceux mesurés sur les coordonnées ÉCRITES (et, sans déclaration,
aucun record et les deux brins à plus de 8 Å). Les **treize suites touchées par la
session** passent toutes (`EXIT=0`, 0 échec) — dont les **sept sondes** qui
reconstruisent la fabrique PDB par extraction (`new Function`), qui n'ont eu besoin
d'AUCUNE retouche : le bloc du feuillet y est inerte. `node _viewer_render_smoke_test.mjs`
(23 assertions, le rendu SSR des pages) et `npx vite build` (✓ 4,5 s) : les pages
montent. `npx oxlint` sur les six fichiers touchés — **0 erreur** (45 avertissements de
style, tous préexistants).
*Reste rouge, et ce n'est PAS cette session :* `_verify.cjs` rend **36/37** — l'unique
échec est `_viewer_rings_gradient_test.mjs`, dont l'édition NON COMMITÉE de la session
précédente a déplacé `const HF = buildHelpers(…)` (et `fakeComp` · `before` ·
`screenPos`) APRÈS leur premier usage (le fichier meurt sur « Cannot access 'HF' before
initialization » ligne 603, sa déclaration étant ligne 710) : ses 37 assertions
d'origine n'ont jamais été exécutées depuis. Aucun fichier de cette session n'y touche
— cette sonde n'extrait que `NMRMoleculeViewer.jsx`, qu'elle n'importe même pas.


## Un fichier DÉPOSÉ À LA MAIN dans le dossier de l'expérience est enfin lisible (03/10/2026)

**Défaut signalé.** « *Il y a des expériences qui existent en Drive et dans le programme mais
elles ne chargent pas la trajectoire même si je mets le fichier de trajectoire dans le bon
dossier.* »

C'était exact, et ce n'était pas un problème de dossier : **la reprise automatique ne sait pas
LIRE un dossier**. Elle ne cherche un fichier brut que par ce qui est ÉCRIT quelque part —
le nom déclaré sur la condition (`trajectoryFileName`), le nom porté par le pointeur
(`trajectoryDrive = { id, name, url }`), le nom déposé à l'envoi
(`<radical>_<scientifique>.<ext>`), ou le registre local des envois
(`utils/driveRestore.js` : pointeur → registre → recherche `name contains '<radical>'`).
Un fichier **posé à la main** dans le dossier canonique n'a **aucun** de ces noms :
son identifiant n'est dans aucun pointeur, aucun registre local ne l'a jamais vu, et son
radical ne ressemble à rien de déclaré. La page annonçait donc, à juste titre mais à tort,
« *pas dans ce navigateur ni sur Google Drive* » — alors que le fichier était là, exactement
où il fallait.

Le second symptôme (« *des expériences existent dans le programme mais pas dans Drive, et
pourtant elles s'ouvrent, même la trajectoire* ») dit la même mécanique vue de l'autre bout :
ce qui voyage dans le dataset, c'est la **description** de l'expérience (elle vit dans le
document du dataset et dans son miroir `_workspace/datasets/ds_<id>.json`) ; ses **fichiers**,
eux, ne sont nulle part ailleurs que là où ils ont été déposés. Quand l'envoi n'a pas abouti
(Drive non connecté au moment de l'import), les octets restent dans la base de CE navigateur
(IndexedDB / file de reprise) — c'est pour cela que la page les rouvre ici et pas ailleurs, et
c'est pourquoi l'ordre « base du navigateur → Drive » reste ce qu'il est. Un **dossier
d'expérience n'existe sur le Drive que parce qu'un fichier y est entré** : rien ne le fabrique
à l'avance.



### Le geste ajouté : LIRE LE DOSSIER DE L'EXPÉRIENCE

Nouveau module **`src/utils/driveExperimentFiles.js`**, et son interface
**`src/components/DriveExperimentFiles.jsx`** (`DriveExperimentFilePicker`). Les deux boutons
📂 **Topology from Drive folder** et 📂 **Trajectory from Drive folder** vivent dans le volet
3D de la page MD (au-dessus du viewer) ; la page NMR a le même, pour son PDB (📂 **PDB from
Drive folder**, sous la vue 3D).

Ce que la lecture fait, et ce qu'elle ne fait pas :

* elle part du dossier **canonique** de l'expérience — celui que l'archivage fabrique
  (`canonicalExperimentPath` : `projects/<projet>/<expérience>/<instance?>/<section?>/<sous-section?>`)
  — puis **remonte d'un cran à la fois** : la sous-section, la section, l'instance, le dossier
  de l'expérience. Un fichier posé « un peu plus haut » (dans le dossier de la section, ou
  celui de la condition) est donc trouvé lui aussi ;
* **rien n'est créé** : le dossier est CHERCHÉ (`resolveDrivePathFromNames(path, { create: false })`,
  la règle de tous les gestes de rangement du dépôt) ;
* **on ne sort jamais de l'expérience** : le conteneur `projects/` et la racine du dataset ne
  sont jamais lus, et une expérience VOISINE ne l'est pas non plus — la limite est vérifiée par
  la suite ;
* les **dossiers** ne sont pas des fichiers : seuls les enfants de type fichier dont
  l'extension correspond (topologie `.pdb/.gro/.cif/…`, trajectoire `.xtc/.trr/.dcd/.nc/…`,
  structure `.pdb/.cif/…` — les listes du module) sont proposés ;
* le résultat dit **où** chaque fichier a été vu (le chemin réel sur le Drive), donc
  l'utilisateur sait où déposer les suivants ; la lecture s'arrête au premier dossier qui porte
  une correspondance (une requête dans le cas normal) ;
* **Google Drive uniquement** : Nextcloud n'a pas de lecture de dossier par identifiant dans
  l'application, et on ne fait pas semblant (`getCloudProvider() === 'nextcloud'` ⇒ liste vide).

### « Quel fichier doit s'ouvrir par défaut, pour CETTE instance » — c'est le geste qui le dit

Choisir un fichier dans la liste l'OUVRE **et le DÉCLARE** : la page écrit le **nom déclaré**
(`structureFileName` / `trajectoryFileName`) **et le pointeur** (`structureDrive` /
`trajectoryDrive` = `{ id, name, url }`) sur **la condition affichée** — celle de l'instance
ouverte. C'est exactement ce que lit la reprise automatique au prochain affichage, ici comme
sur un autre poste : **le fichier choisi devient donc le fichier par défaut de cette
expérience et de cette instance**, sans nouvelle règle. Trois détails qui comptent :

* **rien n'est renvoyé au Drive** : le fichier y est déjà — on l'ouvre (le geste ne
  re-téléverse pas, ne renomme pas, ne déplace pas) ;
* l'ancien **data URL** de la condition (`structureFileData`) et l'ancienne **source texte**
  (`structureSrc` / `pdbId` — un code PDB ou une URL d'hier) sont **écartés** : ils ne décrivent
  plus le fichier déclaré, et sans cela l'ancienne source pouvait l'emporter à l'écran ;
* le nom déclaré devient **celui du fichier choisi** (pas celui d'hier) : c'est ce nom qui

*Vérifier :* `node _experiment_folder_files_test.mjs` — **92 assertions**, la suite de cette
retouche : la logique pure (extensions, chemins candidats du plan canonique et des DEUX
branches de nommage `Setup` / `Data`, tri du plus récent, pointeur), puis la LECTURE sur un
faux Drive — le fichier du dossier exact, celui posé UN CRAN plus haut, la trajectoire déposée
à la main sous un nom qui ne ressemble à rien (le défaut signalé : `driveFetch` du faux Drive
ne rend JAMAIS rien par nom), les sous-dossiers et les autres fichiers écartés, `create: false`
à chaque résolution (aucun dossier fabriqué), la limite de l'expérience (jamais `projects/`,
jamais l'expérience voisine), Drive éteint / aucune extension / Nextcloud ⇒ liste vide sans
requête, le doublon d'un même fichier vu dans deux dossiers, et le câblage des deux pages
(les deux boutons de la page MD, celui de la page NMR, les deux gestionnaires qui écrivent nom
+ pointeur, et la reprise automatique inchangée). `node _condition_page_test.mjs` (123),
`node _drive_restore_test.mjs` (250), `node _workspace_drive_test.mjs` (58),
`node _drive_mirror_test.mjs` (78) et `node _experiment_drive_root_test.mjs` (41) restent
verts ; `npx oxlint` — **0 erreur**, et exactement les mêmes avertissements qu'avant sur
`MDSections.jsx` + `NMRSections.jsx` (41 contre 41, vérifié sur les copies de `HEAD`).

  repart vers les autres postes et qui fait correspondre la copie de la base du navigateur.
