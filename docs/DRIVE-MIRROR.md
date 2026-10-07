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
(elles gardaient alors leur sélecteur 2D / 3D — **la même organisation leur a
depuis été donnée**, voir « Pages MD et Docking : la même organisation que la page
NMR » plus bas).

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


## Viewer : pendant une ▶ MD, l'ombre vivante suit la MOLÉCULE (03/10/2026)

**Défaut signalé.** « *the shadow created by ray is now solved but when I start a MD run the
shadow detaches from the molecule and remains detached.* »

Le « maintenant résolu » est l'ombre portée de l'image fixe (✨ Ray) : elle se pose bien sur le
dessin. Ce qui se décrochait, c'est la **couche vivante** (◐) — la même ombre, mais peinte dans
une toile 2D posée au-dessus de la vue, à chaque image.

**La cause, en une phrase :** le pilote de cette couche ne reconnaissait un GESTE que par la
**pose de la caméra** et par la **signature de la scène** (`sceneSignatureOf` : les groupes de
la vue, la visibilité d'un composant, son `currentFrame`, sa matrice, le nombre de ses
représentations) — et **aucune des deux ne contient les coordonnées des atomes**. Une ▶ MD,
elle, n'ÉCRIT que des coordonnées (`writeStructurePositions`, le chemin d'une ✏️ torsion) :
l'image qu'elle demande était donc jugée « rendue pour rien ». Le filet du pilote finissait bien
par la voir (la signature des entrées du masque, positions comprises), mais **au plus une fois
par `staleMs`** (400 ms) — et la DERNIÈRE écriture d'un geste tombe presque toujours dans cette
fenêtre. Après elle, plus rien n'est rendu (NGL ne rend que sur demande) : la couche restait
accrochée à la géométrie d'avant, **définitivement**. C'est le « remains detached », et il est
maintenant mesuré.

**Ce qui a changé — un mot, dit par celui qui ÉCRIT :**

* `viewerRayShadowLive.js` expose **`moved()`** : il ne peint rien, il MARQUE l'image rendue qui
  suit — celle que l'écriture a elle-même demandée — pour qu'elle soit jugée comme un GESTE
  (brouillon tout de suite, passe nette à l'arrêt) au lieu d'une image rendue pour rien. Le
  drapeau est **consommé par cette image**, donc dix écritures entre deux images affichées ne
  coûtent **qu'un masque** — et il est bâti sur les coordonnées les plus récentes ;
* `moved()` **arme aussi la passe nette** (`armRefine`) : si plus rien n'est rendu après la
  dernière écriture — le cas exact du rapport — la **minuterie** d'`idleMs` peint quand même
  l'ombre nette, sur la géométrie d'ARRIVÉE ;
* le viewer dit le mot dans **`rayShadowMoleculeMoved()`**, appelée par les **trois écrivains de
  coordonnées** et par eux seuls, à côté de `refreshScenePlates()` / `refreshHydrogenBonds()` :
  `writeStructurePositions` (chaque image d'un ▶ MD, d'un ⚒ Minimise, d'un 🧬 calcul de
  structure, d'une ✏️ torsion, du 📥 PDB de l'écran), `applyPartMove` (un glisser de molécule) et
  `restorePartMoves` (le ↺). Une image de TRAJECTOIRE n'a pas besoin du mot : NGL écrit ses
  coordonnées sans nous et son `currentFrame` EST dans la signature de la scène.

Ce qui n'a **pas** changé : la souris qui passe ne repeint toujours **rien** (40 images rendues,
0 reconstruction : la mesure de la session précédente), les trois régimes `auto` / `sharp` /
`draft` et le `off`, la parité de la couche avec le PNG, la trajectoire, et l'ombre de l'image
fixe ✨ Ray. Le filet garde son travail pour ce qui n'est PAS une écriture (une représentation
qui se construit, un atome glissé à la main).

**Mesuré, dans un vrai Chrome** (`_viewer_ray_shadow_idle_test.cjs`, toile 900×600, peptide de
12 résidus en licorice — la scène des autres sondes), sur une dynamique de 20 pas :

* **avec le mot** : 19 images rendues, **19 brouillons** (la couche suit chaque image
  affichée), la passe nette arrive **340 ms après la dernière écriture** (≥ `idleMs` = 220 :
  c'est la minuterie, pas la frame qui suit une image), et l'écart entre le centre de gravité du
  **dernier masque peint** et celui du masque de la géométrie d'ARRIVÉE tombe à **0,0 px** —
  l'ombre est POSÉE sur la molécule ;
* **sans le mot — le témoin négatif, le même geste** : **0 brouillon**, et l'écart reste à
  **16,2 px** : la couche garde la géométrie d'avant, à côté. C'est le défaut du rapport,
  reproduit et chiffré.

*Vérifier :* `node _viewer_ray_shadow_live_test.mjs` — **166 assertions** (contre 149) : la
politique mesurée sans navigateur (les cinq faits du mot du geste — la même image rendue ne
repeint RIEN sans lui, un brouillon puis la passe nette avec lui, la passe nette de la dernière
image **sans qu'aucune autre image ne soit rendue**, dix écritures pour un seul masque, et
`moved()` inerte sur un pilote arrêté), plus le câblage (trois appels, dans les trois écrivains,
et nulle part ailleurs). `node _viewer_ray_shadow_idle_test.cjs` — **24/24** en images et en
pixels réels (contre 15), avec les chiffres ci-dessus. `node _verify.cjs` — **40 suites, 1
échec** : le seul rouge est `_viewer_rings_gradient_test.mjs`, déjà rouge AVANT cette retouche
(la sonde elle-même meurt sur « Cannot access 'HF' before initialization », ligne 603 contre
710 — vérifié en remettant `HEAD` le temps d'un essai), et rien de cette session n'y touche.
`node _torsion_drive_test.mjs` — **652 assertions**, dont le banc qui EXÉCUTE le vrai
`writeStructurePositions` : il reçoit maintenant ses quatre dépendances (`refreshScenePlates`,
`requestSceneRepaint`, `refreshHydrogenBonds` — qu'il ne passait plus depuis la session 💧 — et
`rayShadowMoleculeMoved`). `node _structure_calculation_test.mjs` (768),
`node _viewer_hbonds_test.mjs` (184), `node _viewer_molecule_moves_test.mjs` (131),
`node _ramachandran_test.mjs` (234) et `node _viewer_ray_shadows_test.mjs` (333) restent verts.
`npx vite build` — ✓ 6,4 s. `npx oxlint` sur les deux fichiers touchés — **0 erreur**, et
**62 avertissements avant comme après** (mesuré sur `HEAD` remis le temps d'un essai).

---

## 🎨 Le style du viewer voyage avec l'expérience (snapshot, sinon cumulatif)

La demande : *« when an experiment opens, after bringing back to live its files (pdb,
trajectory etc) it should remember also the style file (called snapshot or in its absence
the cumulative) of the viewer and apply it automatically. »*

Ce qui manquait : les deux styles du viewer — 🎨 **Cumulative** (un dictionnaire de styles par
**classe** moléculaire) et 📷 **Snapshot** (la photographie d'**une** scène, clé par section) —
ne vivaient que dans le **navigateur** (`labViewerThemes` / `labViewerSnapshots`, localStorage).
Les fichiers, eux, revenaient du Drive (nom déclaré + pointeur) : la même expérience rouverte sur
un autre poste rendait l'image **brute** — bon `.pdb`, bon `.xtc`, style perdu.

### Ce que le viewer dépose maintenant

Le style voyage donc **comme un fichier**, dans le dossier de l'expérience, à côté des `.pdb` et
des `.xtc` :

| Geste du viewer | Ce qui est écrit |
| --- | --- |
| 💾 Save (mode 📷 Snapshot) | la mémoire du poste **et** `<dossier>/…/viewer-style-snapshot.json` |
| 💾 Save (mode 🎨 Cumulative) | la mémoire du poste **et** `…/viewer-style-cumulative.json` |
| 📂 Load (l'un ou l'autre) | la mémoire du poste **et** le fichier du mode appliqué |
| ⬆ Import d'un fichier de style | la mémoire du poste **et** le fichier du mode importé |
| 📂 Load d'une **trajectoire** / `currentFrame`, une image de film | rien (aucun style ne change) |

* **Le nom est canonique et FIXE**, un par mode : `viewer-style-snapshot.json` /
  `viewer-style-cumulative.json`. Un ré-enregistrement **remplace** le contenu — `uploadLocalFile`
  ne fabrique pas de doublon — et le mode se choisit en **lisant la liste**, sans rien télécharger.
* **Le contenu est celui du ⬇ Export du viewer** (`{ mode, name, entry }`), plus
  `app: 'lab-viewer-style'`, une `version`, l'`instance` (la condition qui l'a déposé, pour un
  humain qui ouvre le dossier) et la date. Le ⬆ Import le relit donc tel quel.
* **Le dossier est celui de la page** : `ctx = driveNaming` (`projects/<projet>/<expérience>/
  <condition>/Data/Structure`) — le **même contexte** que les `.pdb` que le viewer archive déjà
  (`archiveFileToDrive({ file, ctx: driveNaming })`), donc le même dossier que les fichiers.

### À l'ouverture — la règle de la demande, dans cet ordre

1. **Ce que ce poste a retenu** (`labViewerStyle::<projet|expérience>`, puis la condition, puis la
   clé générale) : appliqué **sans aucune requête**. Une mémoire qui désigne un style **supprimé
   depuis** ne rappelle rien et laisse la place à l'étape suivante.
2. **Le fichier du dossier de l'expérience** (lecture du dossier, `utils/driveExperimentFiles.js`)
   quand la mémoire ne suffit pas — autre poste, navigateur vidé. **LE SNAPSHOT GAGNE, LE
   CUMULATIF S'APPLIQUE EN SON ABSENCE** ; dans un même mode, le plus récent.
3. **Rien** quand l'expérience n'a aucun style : aucun fichier lu, aucun message, le viewer garde
   son style de base — exactement comme avant cette demande.

L'entrée lue est **adoptée** dans son magasin (l'écriture du ⬆ Import, sans le geste) puis
appliquée par le **même lecteur** que 📂 Load (`applySnapshotEntry` / `applyThemeEntry`) ; la
mémoire est écrite au passage, donc la **prochaine** ouverture ne touche plus le Drive. Un `.json`
**étranger** du dossier n'est jamais appliqué (le lecteur refuse tout ce qui ne porte pas de
style), et un style que l'utilisateur vient de charger ou d'enregistrer **n'est jamais écrasé**
par le rappel (`styleTouchedRef`).

Le rappel attend que les fichiers soient **là** (`status === 'ready'`, « after bringing back to
live its files ») et que la scène ait ses **sections** (un snapshot se rejoue sur elles), laisse la
scène **se poser 400 ms** (les molécules annexes — un ligand, une eau — arrivent après le fichier
principal) et n'a lieu qu'**une fois par montage** : la page remonte le viewer à chaque changement
d'instance (`key={activeTest.id}`), donc « une fois par montage » = « une fois par expérience
ouverte ».

### Le mécanisme vit en UN endroit

`src/utils/viewerStyleFile.js` (PUR, **aucun import** — donc importable et exécutable par la
sonde) porte les règles : les deux noms canoniques, la reconnaissance d'un nom renommé à la main,
**la préférence** (`VIEWER_STYLE_PREFERENCE = ['snapshot', 'theme']`), le format du fichier
(écriture et relecture, tolérante comme le ⬆ Import, stricte sur ce qui n'est PAS un style), la
mémoire par instance (`labViewerStyle::<slug>`, la règle du slug restant celle de la session 🧪,
`pymolSessionInstanceSlug`) et `viewerStyleEntryOf` (une mémoire ne rappelle que ce qui existe
encore). Le viewer ne fait plus que **trois gestes** : `rememberViewerStyle` (mémoire + fichier),
`recallViewerStyle` (mémoire d'abord, dossier ensuite) et l'effet d'ouverture.

Le style d'une expérience ne peut pas glisser dans une autre : la mémoire est **clé par
expérience** (projet · nom, ses conditions la partagent), les clés sont **figées au montage**, et
la page remonte le viewer à chaque changement d'instance.

### Le ⬆ Import réparé au passage

`importActiveEnvFile` appliquait le fichier importé par `loadTheme(name)` / `loadSnapshot(name)` —
des lecteurs qui relisent le **magasin**, lequel n'a pas encore ce nom dans cet état
(`setViewerThemes` / `setViewerSnaps` sont asynchrones) : un ⬆ Import annonçait donc « no such
theme » et n'appliquait **rien**. Il applique maintenant l'entrée qui vient d'arriver
(`applyThemeEntry` / `applySnapshotEntry`, le corps extrait des deux lecteurs) — et la retient pour
l'expérience ouverte, comme 💾.

### Vérifier

* `node _viewer_style_recall_test.mjs` — **119 assertions**, tout exécuté : les règles du fichier
  (noms, préférence, format), la mémoire (sur un `localStorage` de poche), puis **les deux gestes
  du viewer sortis de la source** avec des doublures — `rememberViewerStyle` (le nom déposé, le
  contexte de dossier, le contenu exact du fichier, le message qui dit VRAI, et le cas « Drive
  éteint » qui n'envoie rien mais retient) et `recallViewerStyle` sur un faux Drive (mémoire
  d'abord **sans aucune requête**, snapshot gagnant sur un cumulatif plus récent, cumulatif seul,
  `.json` étranger jamais téléchargé, style de l'utilisateur jamais écrasé).
* `node _verify.cjs` — **41 suites, 1 échec** : le seul rouge reste `_viewer_rings_gradient_test.mjs`,
  déjà rouge avant cette retouche.
* `npx vite build` — ✓ ; `npx oxlint` sur les deux fichiers touchés — **0 erreur**.

*Reste à faire à la main* (c'est un geste de Drive, pas un calcul) : ouvrir une expérience MD,
charger un style, le 💾 enregistrer, fermer, rouvrir — le style doit revenir tout seul ; puis le
même essai sur un autre poste (ou après un nettoyage du navigateur), où c'est le **fichier du
dossier** qui le ramène.

## Pages MD et Docking : la même organisation que la page NMR — la formule 2D dans « Sequence and structure », le viewer 3D repliable (03/10/2026)

Demandé mot pour mot : « You did not apply the same structure of the NMR page to
the other pages of the viewer (MD and docking). use the same separation and
organization of 2D formula and 3D viewer. and the same compressible windows that
you used in NMR page. »

La page NMR avait reçu cette organisation le 02/10/2026 (voir « Page NMR : la
formule 2D dans “Sequence and structure”, le viewer 3D repliable… »), les pages
**MD et Docking** gardaient le vieux **sélecteur 2D ⇄ 3D**. Elles ont maintenant
exactement la même structure :

* **le sélecteur 2D ⇄ 3D a disparu** des deux pages : plus de boutons
  « 2D Formula » / « 3D Viewer », et plus aucun volet masqué par un `display: none`
  ou un `aria-hidden` piloté par ce mode. `activeTest.structureMode` reste
  seulement *lu* (`openWhen`) pour les conditions déjà remplies ;
* **la FORMULE 2D vit DANS la sous-section « Sequence and structure »** — celle
  qui porte la peinture 🖌️ et sa bande de séquence —, qui est désormais **OUVERTE
  par défaut** (c'est là que la formule se voit ; `CollapsibleSection` mémorise le
  choix par expérience) ;
  * sur **MD**, la formule est écrite **UNE fois** (`formulaBlock`, dans
    `MDExperimentSetupSection` : `OrganicViewer` pour un SMILES, `StructureSVGView`
    pour une séquence / un sucre / un lipide) et rendue par les DEUX cartes qui
    portent ce titre — celle des protéines / petites molécules et celle des acides
    nucléiques (formes A/B/Z). Leurs conditions s'excluent
    (`!isNucleic && (show2DFormula || showProteinStrip)` d'un côté,
    `isNucleic && (show2DFormula || showNucleicStrip)` de l'autre) : **une seule
    carte est à l'écran, la formule ne se montre jamais deux fois** ;
  * sur **Docking**, `formulaBlock` porte la formule ET le rappel
    « No structure to display yet » de l'ancien volet 2D (un récepteur encore vide
    garde son repère, et le texte renvoie à la case de séquence qui est **au-dessus**
    — il disait « below », ce qui n'était plus vrai) ;
* **le VIEWER 3D a SA PROPRE sous-section repliable** (« 🧬 3D viewer »), juste
  après, dans le **même empilement** (`<div className="flex flex-col">`) : aucun
  grand blanc ne les sépare ;
  * `defaultOpen={false}` (il reste replié, comme sur la page NMR) ;
  * `openWhen={structureMode === '3d'}` — une condition restée en mode 3D la
    rouvre toute seule, et **les structures de cluster d'un docking importé
    restent visibles sans un clic** (son mode par défaut est 3D dès qu'il y a des
    structures) ;
  * `keepMounted` — **replier ne DÉMONTE PAS le viewer** : le contenu n'est créé
    qu'à la première ouverture, reste monté (masqué en CSS) et le dépliage ne
    relit donc pas la structure ;
  * `onToggle={setViewerOpen}` — la page est prévenue de chaque repli / dépliage
    pour recaler le viewer (et les tracés MD) sur la largeur réelle : replier /
    déplier n'émet **aucun** « resize » du navigateur ;
* **plus de montage conditionnel** : `hasOpened3D` a disparu des deux pages —
  c'est `everOpened` de `CollapsibleSection` qui monte le contenu à sa première
  ouverture ;
* sur **MD**, le **🔍 Focus** et le **✖ Deselect** sont passés **dans l'en-tête de
  la carte 3D** (comme sur la page NMR : ils restent accessibles même repliée,
  sans occuper une rangée), et le **📓 Formula → Notebook** vit avec la formule
  qu'il exporte ; les commandes de fichiers du dossier de l'expérience
  (**📂 Topology / 📂 Trajectory from Drive folder**) et le viewer sont DANS la
  carte du viewer ;
* sur **Docking**, le champ **« Receptor topology (PDB ID / URL) »** — qui
  n'apparaissait QU'en mode 3D — vit lui aussi DANS la carte du viewer, avec le
  choix de la structure de cluster (8_seletopclusts) et son lien ☁️ Drive.

Ce qui n'a **pas** changé : la peinture 🖌️ et ses deux bandes de séquence (avec
le résolveur de numéros 🔢, le feuillet déclaré et le 💡 « Select a brush… »), le
SMILES du ligand, le champ de séquence et sa lecture 🧬, l'ordre des cartes de
résultats, les restaurations Drive (topologie, trajectoire, structures de
docking), le contexte de nommage des sélections PyMOL, le bouton 📥 Download 3D
PDB File, et le comportement de `CollapsibleSection` pour les AUTRES sections
(montées / démontées).

*Vérifier :* `node _structure_windows_test.mjs` — 97 assertions : plus aucun
bouton ne réécrit le mode 2D / 3D, plus aucun volet n'est masqué par ce mode,
plus aucun `hasOpened3D` ; la formule est dans la carte « Sequence and structure »
(ouverte par défaut, `{formulaBlock}` dedans pour MD **et** Docking, une seule
définition de la formule, un 💡 et un 📓 avec elle) ; la carte « 3D viewer » vient
après, dans le même empilement, avec `defaultOpen={false}` / `openWhen` /
`keepMounted` / `onToggle={setViewerOpen}` ; le 🔍 Focus, le ✖ Deselect, les 📂 du
dossier, le viewer MD et le champ « Receptor topology » du Docking sont DANS cette
carte ; `viewerOpen` ne sert qu'au recalage, et le geste replié / déplié de
`ui.jsx` est vérifié aussi. `node _residue_numbering_panels_test.mjs` (79),
`node _nmr_nuclei_table_test.mjs` (67), `node _ss_dihedral_test.mjs` (128),
`node _ss_sheet_test.mjs` (143), `node _compact_sections_test.mjs` (211),
`node _condition_page_test.mjs` (123), `node _cysteine_panel_layout_test.mjs`
(50) — les invariants des trois pages tiennent. `node _verify.cjs` — **41 suites,
1 échec** : le seul rouge reste `_viewer_rings_gradient_test.mjs`, déjà rouge
avant cette retouche. `npx vite build` — ✓ ; `npx oxlint` sur les deux fichiers
touchés — **10 avertissements `exhaustive-deps`, 0 erreur** : exactement le
compte d'avant la retouche, aucun symbole nouveau nommé.




## Le feuillet déclaré 🧵 sur les TROIS pages : une seule définition de séquence, et le modèle replié servi par le viewer (04/10/2026)

La demande, mot pour mot : **« I am still missing the second part of the section
sequence and structure where with the brush I define elements of secondary structure to
impose in the 3D viewer »**, puis, à la question « quelle page ? », la réponse : **« the
pairing should be present in all three pages (NMR, MD and Docking). »**

La **seconde moitié** de la définition de séquence — le panneau 🧵 qui apparie deux brins
**E** peints, parallèles ou antiparallèles — n'existait que sur la page **NMR**. Les pages
**MD** et **Docking** connaissaient la déclaration, mais seulement pour **marquer la
bande** (`sheetOf`, `sheetMarkAt`) : on pouvait y peindre deux brins, pas les apparier.
C'est ce qui manquait.

**1 · UNE SEULE LECTURE DE LA DÉFINITION — `useSequenceStructureModel`.**

Le crochet neuf **`useSequenceStructureModel({ activeTest, d, univTestMode })`** vit dans
**`src/components/NMRSections.jsx`**, avec le bâtisseur PDB dont il se sert, et il est
appelé par les **trois** pages (ré-exporté par `MDData.jsx` et `DockingData.jsx`, donc
importé exactement comme les autres blocs partagés) :

* il **relit** la déclaration (`activeTest.betaSheets`, en positions de séquence — la clé
  commune, comme `cysDisulfides`) : `betaSheetRead` rend les brins peints et les paires
  VALIDES, et compte (`rejected`) tout ce qui ne correspond plus à la séquence ;
* il **replie** le modèle (`sheetFold`, la recherche locale de `utils/betaSheetFold.js`) et
  rend le rapport RÉELLEMENT obtenu (échelons CA–CA, ponts N–H···O=C, convergence) — le
  panneau l'affiche sous ses puces, sur les trois pages ;
* il **fabrique** le texte PDB (`sequenceStructure`) avec les torsions du repliement, les
  **records `SHEET`** et les `REMARK 950 / 951` écrits par le MÊME écrivain que le fichier
  téléchargé.
* ⚠ le mode 🎓 **University test** n'en replie AUCUN et n'en peint AUCUNE (le modèle dirait
  la réponse) — et le panneau 🧵 n'est pas montré dans ce mode, sur aucune des trois pages.

La page NMR, elle, ne relit plus rien : elle appelle le crochet et reçoit les trois mêmes
choses (le refactor déplace son code **tel quel** — les suites qui lisent ses lignes
« `const sheetFold = useMemo(() => {` », `sheets: activeTest.betaSheets,` ×3,
`torsions: sheetFold ? sheetFold.torsions : null` ×2 restent vraies, par construction).

**2 · LE PANNEAU 🧵 DANS LES TROIS « Sequence and structure ».**

Les pages **MD** et **Docking** branchent le MÊME composant (`BetaSheetEditor`, partagé par
`NMRData.jsx`) sous leur bande de séquence, avec la même déclaration et la même écriture
(`sheets={activeTest.betaSheets}` / `onChange={(next) => updateActiveTest({ betaSheets: next })}`) :
apparier un feuillet sur une page l'apparie donc sur les trois (c'est le même test), et la
bande de chaque page le marque par le même lecteur. La page Docking, qui n'avait aucun 💡
sous son pinceau, reçoit la MÊME phrase que les deux autres (« Paint two runs of β-strand
(E) … then pair them as a β-sheet below. »).

**3 · LE FEUILLET S'IMPOSE DANS LE VIEWER 3D — sur les trois pages.**

Le modèle replié (`sequenceStructure`) part désormais au viewer des pages **MD** et
**Docking** (`sequenceStructureText` / `sequenceStructureExt`), exactement comme sur la
page NMR : le viewer le sert **dès que RIEN n'est chargé sur la page** — et « 🧬 Structure
from sequence » le reconstruit à la demande, ce que ces deux pages ne savaient pas faire
(le bouton répondait « No sequence on this page »). Ce qui était chargé garde la priorité,
inchangé : un PDB (📂 / PDB ID · URL / la topologie d'un dossier Drive), la structure de
cluster choisie sur la page Docking. C'est ce qui rend la définition **visible en 3D** :
la peinture 🖌️ ET le feuillet déclaré 🧵 sont le modèle que le viewer montre.

*Ce qui n'a **pas** changé :* la déclaration reste additive (aucun PDB chargé n'est
réécrit), le repliement ne touche QUE la fenêtre des deux brins et de leur boucle, la
bande de séquence et le résolveur de numéros 🔢, les cartes de résultats, les
restaurations Drive, et le mode 🎓 University test.

*Vérifier :* **`node _ss_sheet_test.mjs` — 163 assertions** (143 + les 20 neuves) : le
crochet partagé existe et rend `{ betaSheetRead, sheetFold, sequenceStructure }`, les trois
pages l'appellent, les trois branchent `BetaSheetEditor` dans « Sequence and structure »,
les trois reçoivent `sequenceStructureText` / `sequenceStructureExt`, et le repliement
reste MESURÉ sur le vrai bâtisseur (pont C7 du tour γ, feuillets parallèle ET
antiparallèle, records `SHEET` relus). `node _structure_windows_test.mjs` (108),
`node _residue_numbering_panels_test.mjs` (79), `node _condition_page_test.mjs` (123),
`node _ss_dihedral_test.mjs` (128), `node _compact_sections_test.mjs` (211),
`node _viewer_render_smoke_test.mjs` (23) — les invariants des trois pages tiennent, et les
comptes de tests qui DISAIENT « le panneau n'existe que sur la NMR » ont été mis à jour
(le résolveur 🔢 part à 7 endroits : les 4 bandes + les 3 panneaux 🧵). `node _verify.cjs` —
**1 échec** : `_viewer_rings_gradient_test.mjs`, déjà rouge avant cette retouche.
`npx vite build` ✓. `npx oxlint` sur les cinq fichiers touchés — **42 avertissements,
0 erreur** (aucun symbole nouveau nommé, les mêmes `exhaustive-deps` préexistants).

*Rouge AVANT cette retouche, et pas à cause d'elle :* `node _cysteine_panel_layout_test.mjs`
cherche la case de séquence de la page NMR par un `<textarea value={d.rawSequence}` qui
n'existe plus **dans HEAD non plus** (0 occurrence dans les deux arbres) depuis que la case
est le composant `SequenceField` : la sonde a une aiguille périmée.


## Le viewer MD : la phrase en trop retirée, les deux 📂 du dossier sur la ligne des fichiers (03/10/2026)

**Deux demandes, mot pour mot.** « *in the viewer remove the sentence “Click an atom in the
3D viewer to highlight its cell in the atom table.” so that we save a line.* » — et, dans le
même message, « *the “topology from Drive folder” and “trajectory from drive folder”
buttons should be in the same line as “PDB file” and “trajectory” buttons.* »

### ① Le 💡 de la formule a disparu (une ligne de gagnée)

La formule 2D de la page MD fermait son bloc par une rangée `flex flex-wrap
justify-between` : la phrase « 💡 Click an atom in the formula (or in the 3D viewer below) to
highlight its cell in the atom table. » d'un côté, le 📓 **Formula → Notebook** de l'autre.
Elle était trop longue pour tenir à côté du bouton : la rangée coûtait donc **DEUX lignes**.
Elle est RETIRÉE, et le 📓 reste seul dans sa rangée, à droite (`flex justify-end`, la place
qu'il occupait déjà).

Ce qui ne change **pas** : piquer un atome — dans la formule 2D comme dans la vue 3D —
souligne toujours sa cellule du tableau d'atomes ; seul le texte qui le disait est parti.
(Sur la page NMR, la pastille équivalente de la carte 3D avait déjà été retirée ; la ligne
de la formule y reste, la demande ne portait pas sur elle.)

### ② Les deux 📂 du dossier de l'expérience sont passés DANS la rangée des fichiers

Les boutons **📂 Topology from Drive folder** et **📂 Trajectory from Drive folder**
(`utils/driveExperimentFiles.js`) faisaient une rangée à eux, au-dessus du viewer : deux
lignes de commandes de fichiers. Ils n'en font plus qu'**UNE** :

* leur définition est écrite **une seule fois** — `folderFilePickers`, dans la page MD ;
* elle part au viewer par une prop **nouvelle**, `fileRowExtra` — **`null` par défaut**,
  donc les pages NMR et Docking ne voient **aucun** changement ;
* le viewer la rend dans sa **rangée §1 General** : c'est LA MÊME LIGNE que 📂 **PDB file(s)** et
  📂 **Trajectory** — celle des deux fichiers du poste, exactement ce que la demande décrit.
  ⚠ **Sa place dans cette rangée a changé depuis** (04/10/2026 : les commandes du dossier ferment
  la rangée, après ⬇ PDB et 🗑 Clear — voir « L'ordre de la rangée des fichiers » plus bas).
* la phrase qui les accompagnait (« *Choosing a file here opens it AND declares it: this
  condition will reopen it by default, on every computer. Nothing is uploaded again.* »)
  est passée **dans leurs infobulles** : l'information n'est pas perdue, elle ne coûte plus
  une ligne à elle seule.

Le geste lui-même est **inchangé** : c'est toujours une **LECTURE** du dossier canonique de
l'expérience (rien n'y est envoyé, rien n'y est créé — `{ create: false }`), et le fichier
choisi devient celui que la condition rouvre par défaut, ici et sur les autres postes.

*Vérifier :* `node _structure_windows_test.mjs` — **107 assertions** : le 💡 de la formule
MD n'existe plus (le 📓 reste seul, `flex justify-end`), les deux 📂 du dossier n'ont qu'UNE
définition et partent au viewer par `fileRowExtra={folderFilePickers}`, la rangée des
fichiers du viewer accepte les commandes de la page (`fileRowExtra = null,` par défaut,
rendu ENTRE 📂 Trajectory et ⬇ PDB), et **aucune** page NMR / Docking ne passe cette prop.
`node _viewer_ui_layout_test.mjs` — **494 assertions** : la prop et son site de rendu sont
dans §1 General, à côté de 📂 PDB file(s) / 📂 Trajectory.

## Les peaux de l'interface (Settings → « Interface skin ») (03/10/2026)

**La demande.** « *in settings implement different skins for the program interface* » — un
choix, dans ⚙️ Settings, qui repeint **tout** le programme.

### ① Pourquoi c'était possible sans toucher un seul composant

Tailwind v4 **n'écrit pas ses couleurs en dur** : `bg-slate-800` est compilé en
`background-color: var(--color-slate-800)`, `text-white` en `color: var(--color-white)`, et
ces variables vivent dans `@layer theme` (`:root, :host`). Il suffit donc de **redire** ces
variables sous un attribut pour que **chaque page, chaque modale, chaque pastille, chaque
bouton, chaque tableau** change de palette — sans éditer une classe, sans toucher un
composant. C'est la même famille de mécanisme que l'échelle d'affichage : **une seule
décision globale au lieu de 13 476 utilitaires de couleur recopiés**.

Trois propriétés ont été mises à profit, et chacune est vérifiée dans un vrai navigateur :

* les blocs de `src/index.css` sont **NON calqués sur une `@layer`** — une règle hors couche
  gagne toujours sur une règle de couche, donc `[data-skin="dim"]` bat `@layer theme` sans un
  seul `!important` ;
* ils sont posés sur `[data-skin="…"]` et **non sur `:root`** : les propriétés personnalisées
  sont **héritées**, donc l'attribut peut aussi bien être posé sur `<html>` (tout le
  programme, par `main.jsx`, **avant la première peinture**) que sur un simple `<div>` ;
* c'est ce dernier point qui donne la **miniature vivante** de Settings : chaque bouton
  contient une carte dessinée avec les **vraies classes** de l'interface (barre de chrome
  `bg-slate-800`, carte `bg-white`, légende `text-slate-400`, bouton `bg-blue-600
  text-white`) et porte `data-skin="…"` — ce que le bouton montre **est** ce que le
  programme sera, pas une vignette dessinée à la main.

### ② Les sept peaux, et la règle qui les rend sûres

Une peau n'invente **aucune** couleur : elle **échange deux rampes de Tailwind** ou **redit
une rampe cran par cran**. C'est ce qui garantit que les 1 340 `bg-white`, les 479
`text-white` et les 7 281 `slate-*` du programme restent lisibles sans les relire un par un.

| peau | ce qu'elle fait | source des valeurs |
| --- | --- | --- |
| **Slate & blue** | la référence : **aucun bloc** (`applyUiSkin` retire l'attribut) | la palette livrée |
| **Graphite** | l'échelle neutre devient **Zinc** : gris pur, le bleu de slate disparaît | Zinc, cran par cran |
| **Warm paper** | l'échelle neutre devient **Stone** : encre et bordures chaudes | Stone, cran par cran |
| **Indigo** | les **deux bleus s'échangent** : l'accent principal devient indigo (un cran plus sombre, donc tous les libellés blancs y gagnent) et les accents indigo du programme deviennent bleus | les deux rampes, échangées cran par cran |
| **Violet** | le même échange, un ton plus loin | idem (1,7 point d'écart de clarté au pire) |
| **Dimmed** | le blanc **#fff** devient **#f1f4f6**, la page passe **sous** les cartes (slate-50 plus sombre que le blanc), l'accent perd de la chroma, bordures et légendes **gagnent** un cran : le même écran, sans éblouissement | rampe redessinée |
| **High contrast** | toutes les encres et toutes les bordures font un pas vers le noir (la légende qui était à **2,63:1** passe à **6,82:1**), l'accent s'assombrit, et les encres des pastilles d'état (succès · danger · alerte) descendent de **6 points de clarté OKLCH** | rampe redessinée + 10 familles d'état |

### ③ Le garde-fou : les maths, pas l'œil

`_ui_skin_test.cjs` relit **les rampes de Tailwind elles-mêmes**
(`node_modules/tailwindcss/theme.css` — c'est la référence, jamais recopiée), applique les
redirections de chaque peau, puis **recalcule en OKLCH → sRGB → WCAG** les neuf couples que
le programme écrit réellement (`text-700` sur `bg-50`, `text-800` sur `bg-100`, blanc sur
`bg-600`, `text-600/700/500/400` sur blanc, `border-300` sur blanc, blanc sur `bg-800`)
**famille par famille** (16 familles : slate, les 8 accents, les 7 états). Une peau est
refusée si **un seul** de ces couples perd plus de **1,5 cran de contraste** par rapport à la
palette livrée, si une rampe cesse d'être **strictement monotone** en clarté (des crans qui
se croisent rendraient un survol invisible), ou si un **échange de teinte** déplace un cran
de plus de **4 points de clarté OKLCH**. Mesures de cette session : le pire écart toutes
peaux confondues est **−1,25** (indigo, blanc sur `indigo-800` devenu `blue-800`), `dim` et
`contrast` **améliorent** tous les couples qu'elles touchent, et les deux échanges de teinte
restent à 3,8 et 1,7 point du pire cran.

### ④ Le verdict en pixels (et ce qu'il a appris)

`_ui_skin_pixel_test.cjs` sert le **CSS compilé de l'application** (`dist/assets/index-*.css`,
celui de `npx vite build`) à Chrome en `--headless=new`, pose les vraies classes de
l'interface, et demande au moteur ce qu'il a calculé — puis va jusqu'au **pixel** : une toile
1×1 remplie de la couleur relue en `ImageData` (le moteur rend la couleur calculée **dans son
espace d'origine**, un `oklch(…)` pour tout ce qui vient des variables, et le canvas la
redonne telle quelle — d'où la lecture au pixel plutôt qu'à la chaîne). 44 vérifications,
dont les plus utiles :

* pour **les sept peaux**, la couleur de `bg-slate-800` est **exactement** celle de
  `var(--color-slate-800)` — et idem pour `bg-white` / `--color-white` et `bg-blue-600` /
  `--color-blue-600` : c'est toute la chaîne « classe → variable → bloc » qui est prouvée, pas
  seulement la présence du bloc dans la feuille ;
* la **référence** rend la palette livrée au pixel : `#ffffff`, `#155dfc` (blue-600),
  `#1d293d` (slate-800) ;
* chaque peau **change ce qu'elle annonce** : `dim` est la seule à reprendre le blanc
  (`#ffffff` → `#f1f4f6`) et le fond de page (`#f8fafc` → `#e8ebef`), `graphite` et `warm` ne
  touchent pas au blanc, `indigo` et `violet` ne touchent pas à l'échelle neutre, et
  `contrast` fonce la légende du programme de **35 % à 10 % de luminance** ;
* les trois **identités** de couleur sont mesurées : le chrome « graphite » est bien neutre
  (39/39/42), « warm » est bien chaud (41/37/36), et l'accent violet porte largement plus de
  rouge que le bleu livré ;
* la **miniature** ne fuit pas : sous les sept peaux, la carte du `<div data-skin="dim">` est
  toujours `#f1f4f6` et son chrome toujours `#172336`, tandis que le frère **sans** attribut
  suit, lui, la peau de `<html>` — c'est exactement l'invariant dont dépend la page Settings.

### ⑤ Ce que ça ne fait pas (dit franchement)

**Pas de vrai mode sombre.** Le programme porte **1 775 couleurs écrites en dur** dans 62
fichiers — 264 dans `utils/chartStyle.js` à lui seul, puis les modules de tracés
(`MDMembraneContacts.js`, `NMRSections.jsx`, `CDSections.jsx`, `ssNMRSections.jsx`…). Ce sont
les encres des **graphiques, spectres, profils et cartes** : une peau qui inverse la
luminosité laisserait une encre sombre sur une carte sombre, c'est-à-dire des figures
illisibles. Un vrai mode sombre demande donc **d'abord** que ces modules lisent les jetons
(`var(--color-…)`) au lieu de leurs hexadécimaux — c'est un chantier à part, et c'est pour
cela que les peaux livrées ici restent **claires** (la plus sombre, `dim`, abaisse le blanc et
les bordures sans jamais inverser). Les figures, les documents imprimés/exportés et le
presse-papiers gardent leurs propres réglages : une peau est un réglage d'**écran**, gardé
**par OPÉRATEUR** dans le navigateur (`localStorage` — la clé du POSTE lui sert de repli et de
valeur de départ, voir « La peau appartient à l'OPÉRATEUR » plus bas), jamais dans le dataset ni
dans le Doc, et **chaque** utilisateur la voit — et choisit **la sienne** (pas seulement le
superutilisateur).

*Vérifier :* `node _ui_skin_test.cjs` — **91 vérifications** : le registre (7 peaux, ids
uniques, 4 pastilles), le repli sur la référence pour un nom inconnu, l'attribut posé sur
`<html>` et **retiré** pour la référence, `main.jsx` qui l'applique **avant**
`ReactDOM.createRoot`, la section et la miniature dans Settings (avant le bloc réservé au
superutilisateur), un bloc CSS **par** peau (aucun pour la référence, aucun orphelin, formes
complètes — 11 crans, ou les 4 crans d'état), **aucun `!important`**, aucun `html[data-skin]`
(la miniature en dépend), puis les maths de contraste décrites au ③.
`node _ui_skin_pixel_test.cjs` — **44 vérifications dans Chrome** sur le CSS compilé
(SAUTÉE, exit 0, sans Chrome/Edge ou sans `npx vite build`).
Régressions relancées : `_ui_scale_test.cjs` **61/61** (le voisin de la section),
`_chart_dblclick_test.cjs` **124/124** (seule autre suite à lire `index.css`),
`_figure_style_test.mjs` **71/71** (elle lit `settingsModule.jsx`), `_tdz_scan_test.mjs`
**18 assertions** (247 fichiers). `npx vite build` — ✓ ; `npx oxlint` sur les trois fichiers
touchés — **0 avertissement, 0 erreur**.




## Le fond du viewer : une rampe de deux couleurs, et son panneau (03/10/2026)

**La demande.** « *in the background of the viewer allow gradients of two colors and their
direction (clicking on background should display the options underneath and disappear when
background is clicked again)* ».

### ① Le fait NGL qui rend la rampe presque gratuite

NGL 2.4 ne sait peindre **qu'une** couleur de fond, et son `setBackground`
(`viewer.setBackground`, `_ngl_src/viewer__viewer.ts:842`) fait exactement trois choses :

```ts
this.setFog(p.backgroundColor)
this.renderer.setClearColor(p.backgroundColor, 0)                     // ALPHA ZÉRO
this.renderer.domElement.style.backgroundColor = p.backgroundColor.getStyle()
```

Le fond que l'on **voit** à l'écran n'est donc pas dans la toile WebGL : c'est la **couleur CSS
du canvas**, vue **à travers** une toile transparente — le fait que le film 🎬 avait déjà dû
contourner (`filmBackdropColor`, voir la section du film). Une `background-image` posée sur ce
même canvas se peint donc **par-dessus** la couleur, et elle est composée par le moteur : le
dégradé vit dans le CSS, **aucune représentation n'est reconstruite**, aucune surface n'est
recalculée, la caméra ne bouge pas. C'est ce que la sonde mesure (voir ④) : `clearAlpha = 0`,
`style.backgroundColor = rgb(255,0,0)`, et la rampe calculée par le moteur est
`linear-gradient(rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)`.

**Un seul module, `src/utils/viewerBackground.js`**, porte toute la mécanique — les deux couleurs
validées (`#rrggbb` ou le secours, jamais du noir), l'angle normalisé dans `[0, 360[`, la
**spécification** `{ on, from, to, angle }`, le CSS de l'écran, les maths de la ligne de rampe
(la règle CSS : la ligne passe par le **centre**, sa direction est `(sin θ, −cos θ)` — l'axe Y
d'un canvas descend — et sa longueur est `|W·sin θ| + |H·cos θ|`), la peinture d'une toile 2D, et
la composition de la still du ✨ Ray.

### ② Le panneau, et le clic qui l'ouvre (puis le referme)

Le clic sur le fond n'est **pas** un geste à nous : NGL dispatche `clicked` **même quand rien
n'a été piqué** (`PickingControls._onClick` fait `stage.signals.clicked.dispatch(pickingProxy)`
sans condition, ngl 2.4). Un `pickingProxy` **sans atome** est donc un clic sur le fond — et
c'est la branche du viewer qui **bascule un seul état** (`setBgPanelOpen((v) => !v)`) : le clic
suivant, n'importe où sur le fond, referme le panneau. La sonde le mesure deux fois : deux clics
dans un coin vide d'une scène **chargée**, deux fois reçus, **zéro** atome piqué.

Deux garde-fous :

* **un seul des deux gestes à la fois** — pendant un piquage (⌖ la paire, ✏️ la torsion,
  📏 Measure, ✎ Rename) les clics appartiennent au piquage, même quand ils tombent **à côté**
  d'un atome (c'est justement ainsi qu'on vise le fond sans piquer l'atome voisin) : aucun
  d'eux n'ouvre le panneau ;
* **le panneau ne prend aucun clic destiné à la scène** — il vit **à côté** du div d'NGL, pas
  dedans, et son ⇤ le referme aussi.

Le panneau (`id="viewer-background"`, posé **dans la vue**, en bas du fond) porte : l'interrupteur
**⬚ Gradient** (`aria-pressed`), les **deux couleurs** — **A**, qui *est* la couleur de la
scène, et **B** — le bouton **⇄** qui les échange, les **huit directions** d'un clic (↓ ↑ → ←
et les quatre diagonales, rendues depuis `BG_DIRECTIONS`, jamais recopiées), le **curseur
d'angle** (0–360°, nommé), **↺** (la rampe d'origine, dégradé éteint) et **⇤**. La ligne du bas
**nomme** la direction choisie (« from the top to the bottom »), ou dit ses degrés quand l'angle
est libre. Le bouton **⬚** de **§2 Toolbar → 🌫 Scene** fait le même geste depuis la barre (donc
au clavier, et sans viser le fond) : `aria-expanded` + `aria-controls`.

### ③ Un seul fond dans le viewer : A **est** la couleur de la scène

Le piège aurait été de tenir **deux** fonds — la couleur du 🎨 et celle de la rampe — et de les
laisser diverger. Il n'y en a qu'un : la **première** couleur de la rampe **est** `bgColor`,
c'est-à-dire la couleur que le 🎨 de §2 Scene écrit, que le panneau 🧪 PyMOL écrit, que le
brouillard prend pour cible (`setBackground` fait `setFog(couleur)`), et que les ⚙️ setups et les
thèmes emportent sous la clé `background`. `backgroundGradient` (`{ on, to, angle }`, sous
`localStorage['labViewerBgGradient']`) transporte **le reste**, et il a rejoint `THEME_GLOBAL_KEYS` :
une figure enregistrée revient avec **sa** rampe, comme elle revient avec son brouillard et ses
ombres. Un fichier écrit **avant** cette fonctionnalité n'a pas le champ : il ne change donc
rien au fond (le lecteur ne touche pas à l'état), et un objet bricolé (une couleur nommée, un
angle infini) est revalidé par `bgGradientOf` — jamais un fond cassé.

Le panneau est **fermé au chargement** : la demande dit « un clic l'ouvre, un clic le referme »,
et un panneau qui se rouvrirait tout seul au rechargement irait contre ça. La **rampe**, elle,
est persistante (par navigateur, comme la couleur qu'elle prolonge).

### ④ Les trois consommateurs, et ce que les pixels disent

| consommateur | ce qu'il fait | la preuve |
| --- | --- | --- |
| **l'écran** | `backgroundImage` du canvas NGL, posée **après** `stage.setParameters({ backgroundColor })` (sinon NGL la recouvrirait) ; éteinte, la chaîne vide rend la main à la couleur d'NGL | sonde : `clearAlpha = 0`, `css = rgb(255, 0, 0)`, la rampe calculée à 180° **et** à 90° (Chrome omet l'angle quand c'est son défaut, il l'écrit sinon), deux arrêts, `none` quand elle est éteinte |
| **les films 🎬🎞** | la toile de film, qui n'a pas d'alpha, peint la **couleur** puis la **rampe** (comme le CSS empile `backgroundImage` sur `backgroundColor`), **avant** la scène | sonde : haut `254,0,0` → bas `1,0,255`, milieu `126,0,128` ; à 90° gauche `254,0,0` → droite `0,0,254` ; sans rampe, la toile reste **vidée** (alpha 0 — le film d'avant, au pixel près) |
| **la still ✨ Ray** | NGL rend le still d'un seul tenant avec un fond **opaque** et d'**une** couleur (`makeImage` fait `setClearAlpha(s?0:1)`) : la still est donc rendue **transparente** quand la rampe est allumée (jamais contre le choix « ⬚ alpha » de l'utilisateur), et `underlayBackdrop` peint la rampe **sous** elle (`destination-over`) ; le nom du fichier est refait sans « _transparent », puisque le fond est de nouveau opaque | sonde : la « molécule » garde `0,255,0`, le fond prend `254,0,0` en haut et `1,0,255` en bas ; sans rampe, la composition ne fait **rien** |

Un navigateur sans toile 2D garde la still **telle quelle** (jamais un rendu perdu), et le
rapport du rendu ajoute « · gradient background » à côté de « · transparent ».

### ⑤ Ce que ça ne fait pas (dit franchement)

* **Ce n'est pas un dégradé de SCÈNE.** Le brouillard (🌫) continue de tendre vers **une**
  couleur — celle de A, la même que le 🎨 — parce que NGL n'en connaît qu'une ; un halos
  dégradé dans la profondeur demanderait un `fogColor` par fragment, c'est-à-dire un shader.
* **La rampe ne voyage pas dans un fichier.** Un `.pdb`, un `.cif`, une capture PNG d'un autre
  outil ne portent rien de tout cela : c'est un réglage d'**image**, gardé par navigateur et
  emporté par les ⚙️ setups/photographies du viewer.
* **Elle n'est peinte QUE là où le canvas est transparent.** Une molécule qui remplit la vue
  laisse donc voir peu de rampe — c'est le fond, pas un calque par-dessus la scène (rien n'est
  assombri, aucun pixel de la molécule n'est touché).


### ⑥ Le panneau ne peut plus sembler inerte, et le REGARD suit la molécule

Deux rapports de la même session, mot pour mot :

* « The gradient options for the background of the viewer window appear in the viewer but they do not
  work. the background remains of the same color. » — La rampe s'ouvre **éteinte** (le défaut voulu) et
  ses contrôles écrivaient bien leur champ… mais la **spécification** ne peint rien tant que `on` est
  faux (`gradientSpecOf` rend `null`) : B, C, les huit flèches, le curseur et ⇄ n'avaient donc **aucun
  effet visible**, et le panneau entier semblait mort. **Toucher l'un d'eux ALLUME désormais la rampe du
  même geste** (`patchBgGradient({ on: true, … })`) ; l'interrupteur **⬚ Gradient** et **↺** restent les
  deux gestes qui l'éteignent, et quand elle est éteinte la ligne du bas le **dit** au lieu de se taire.
  La sonde du navigateur le mesure : la rampe éteinte, changer B allume la rampe (`on: true`) et le
  canvas porte `linear-gradient(rgb(248, 250, 252) 0%, rgb(0, 255, 0) 100%)`.
* « when I change the molecule not only the zoom must be conserved but also the style (style of the
  molecule, the background etc.) » — Le **point de vue** était déjà tenu (voir le §7 de
  `_docking_viewer_restore_test.mjs`) ; le **regard** ne l'était pas : une section ne retrouvait son
  arbre de la barre que si le fichier suivant lui donnait le **même id global** (`main::protein|A`), et
  un fichier qui nomme autrement ses chaînes, ses molécules ou ses ligands repartait des défauts du
  **type**. Le viewer photographie donc, au même moment que la caméra, les trois choses qu'un geste de
  la barre écrit — l'arbre de chaque section, son **✔** et ses **étiquettes 🏷** (`captureSwitchLook`)
  — et les repose sur la molécule chargée (`applySwitchLook`), avec le lecteur des poses de film
  (`poseStylesForSections`, qui retrouve une section par son id **puis par sa clé locale**). Le **fond**
  n'a jamais bougé : ce n'est pas un réglage d'une molécule mais du viewer (A *est* la couleur de la
  scène, la rampe vit sous `labViewerBgGradient`), et un chargement qui n'est pas un switch ne touche à
  rien (le vœu est consommé : `null`).

*Vérifier :* `node _viewer_background_test.mjs` — **168 assertions** : les deux couleurs et
l'angle (validation : `#rrggbb`, l'angle ramené dans `[0, 360[`, `on` strictement vrai), ce que
localStorage et un ⚙️ setup rendent (chaîne JSON, objet, magasin illisible), le CSS exact de la
rampe, les **maths de la ligne** (↓ → ↑ ← et une diagonale — la ligne est plus longue que la
boîte, c'est la règle CSS), la **peinture** d'une toile 2D (les deux arrêts, le rectangle, et
RIEN pour une simple couleur), les **huit directions** nommées (`bgDirectionOf`), le film qui lit
la spécification (`filmBackdropColor` accepte l'objet **et** l'ancienne chaîne, inchangée), et
tout le **câblage du viewer** : l'état, le magasin, le CSS du canvas posé **après** NGL, le clic
sans atome et son garde-fou de piquage, le panneau (une seule fois, `aria-*`, les deux couleurs,
⇄, les huit boutons, l'angle, ↺, ⇤, la ligne qui nomme la direction), le bouton ⬚ de §2, les
⚙️ setups et `THEME_GLOBAL_KEYS`, la toile de film (couleur puis rampe, **avant** la scène) et la
recomposition de la still du ✨ Ray. Son **§9** ajoute la promesse du dernier rapport : les **six**
contrôles de la rampe l'**ALLUMENT** (comptés un par un : aucune écriture muette ne subsiste), et la
ligne du bas a désormais **deux** états — allumée, elle décrit la rampe ; éteinte, elle dit l'état et
que rien dans ce panneau n'est inerte.

`node _viewer_background_pixels_test.cjs` — **34/34 assertions dans Chrome** (`--headless=new`,
SwiftShader), sur **le module servi comme module** et un **vrai** canvas NGL : la rampe peinte
dans une toile 2D (les deux bords, le milieu, la direction), le fond CSS à travers une toile
d'alpha zéro, le clic de fond reçu **deux fois sans atome**, et la still du ✨ Ray (la molécule
intacte, la rampe dessous). Les deux PNG de la sonde restent sur le disque
(`_tmp_bg_probe_film.png`, `_tmp_bg_probe_still.png`). SAUTÉE (exit 0) sans Chrome/Edge.

Régressions relancées (`node _verify.cjs`, les 44 suites du viewer) : **44 suites, 1 seule
rouge** — `_viewer_rings_gradient_test.mjs`, déjà rouge **avant** cette fonctionnalité
(zone morte HF) et sans rapport avec le fond. Les suites qui touchent les lignes modifiées ont
été **mises à jour** sur la vérité nouvelle de la source, et rien d'autre n'a bougé :
`_viewer_ray_test.mjs` **189 assertions** (le nom de la still passe par `stillLabel` — le ✨ Ray
REPREND ce nom quand la rampe recompose l'image — et le résultat part vers l'aperçu par
`showRayPreview(still)`), `_viewer_film_match_test.mjs` **79 assertions** (les deux enregistreurs
passent la **spécification** du fond ; ses deux aiguilles sur `filmCanvasFor` étaient **déjà
périmées** par la couche d'ombre vivante, elles sont revenues sur la vérité d'aujourd'hui),
`_viewer_ray_shadow_live_test.mjs` **166 assertions** (le 🎬 et le 🎞 des poses, même
spécification), `_viewer_theme_snapshot_test.mjs` **67 assertions** (`backgroundGradient` dans
l'environnement global), `_viewer_style_controls_test.mjs` **494** et `_viewer_ui_layout_test.mjs`
**494** (le réglage 🎨 et la rangée 🌫 Scene n'ont pas bougé d'un caractère).
`npx vite build` — ✓ ; `npx oxlint` sur les trois fichiers touchés — **0 erreur** (62
avertissements, tous préexistants dans le viewer).



## Le bouton qui crée le dossier de l'expérience : sur la ligne de 📂 PDB file(s), et le chemin ENTIER (04/10/2026)

**Les demandes, mot pour mot.** « *the "create experiment folder on drive" must be placed in the
same line of "PDB file" button always. to save space you can rename it "Create drive folder".
This button did not create the folder and the description on where it would do it it is not
complete. for a trajctory it must be datasetname/projects/projectname/experimentname/instancename/
subsection/file where subsection is experiment_setup/trajectory for trajectory files and
experiment_setup/Structure for pdb files.* »

### ① Une seule place, et c'est le VIEWER qui la donne

`DriveExperimentFolderCreator` était monté par la page MD (dans `folderFilePickers`, à côté des
deux 📂) et par la page NMR (dans sa propre rangée, au-dessus du viewer). La place dépendait donc
d'une page — et sur NMR le bouton voisinait « 📂 PDB from Drive folder », pas le bouton
**📂 PDB file(s)** du viewer.

Désormais **c'est le viewer qui le rend**, dans sa rangée §1 General :

```jsx
{driveNaming ? <DriveExperimentFolderCreator ctx={driveNaming} /> : null}
{fileRowExtra}
```

⚠ **L'ordre EXACT a été fixé depuis** (04/10/2026) : le geste de création vient APRÈS ⬇ PDB et
🗑 Clear, et `fileRowExtra` (les 📂 de la page) le suit — voir « L'ordre de la rangée des
fichiers » plus bas.

Donc sur **MD, NMR et Docking** — les trois pages qui passent un `driveNaming` — le bouton est
TOUJOURS sur la même ligne que 📂 PDB file(s) / 📂 Trajectory, et aucune page ne peut l'oublier ni
le déplacer. Le libellé est **court** (« 📁 Create drive folder ») parce qu'il partage une rangée
étroite, et les deux pages ont **perdu** leur import du composant.

### ② « This button did not create the folder » — chaque segment est maintenant VÉRIFIÉ

Le geste appelait `resolveDrivePathFromNames(..., { create: true })` et ne regardait que
`leafId` : une chaîne créée **à moitié** (dossier du dataset indisponible, `projects/` non résolu)
rendait un `leafId` vide — ou pire, un identifiant de dossier **au mauvais niveau** — et l'échec se
lisait « Google Drive did not create the folder » sans dire **où**. Ce qui change :

* `firstMissingSegment(resolved, path)` rend le **premier cran sans identifiant**, et
  `driveCreateError` le NOMME tel qu'il est écrit sur le Drive (« Google Drive did not create
  “experiment_setup” on the way to … »), avec ce qu'il faut faire ;
* un chemin supprimé dans le programme (code `PATH_DELETED`, voir `driveMirrorStore`) est
  expliqué — un dossier effacé n'est **jamais** recréé — au lieu d'un « failed » muet ;
* `ok:false` ne porte **jamais** d'entrée : rien n'est annoncé comme créé tant que la chaîne n'est
  pas complète.

### ③ Le chemin créé est celui où les fichiers se déposent VRAIMENT

Le geste ne créait que la tête (`projects/<projet>/<expérience>/<instance>`). La demande est
explicite — `<dataset>/projects/<projet>/<expérience>/<instance>/experiment_setup/<Structure|trajectory>`
— donc `createExperimentFolder({ ctx, subsections })` crée **la chaîne entière**, par défaut les
**deux** sous-sections que l'envoi utilise déjà (section `Setup`, voir `MDSections` : sous-section
`Structure` / `Trajectory`) :

    <dataset>/projects/<projet>/<expérience>/<instance?>/experiment_setup/Structure
    <dataset>/projects/<projet>/<expérience>/<instance?>/experiment_setup/Trajectory

Deux helpers PURS portent la règle, une seule fois : **`experimentFileFolderPathOf(ctx, sub)`** (le
dossier d'un TYPE de fichier — il réutilise `canonicalPageSection('Setup')`, donc la section créée
et celle que les 📂 cherchent sont **la même liste**) et **`fullDrivePathText(datasetName, path)`**
(le chemin COMPLET, dossier du dataset compris, slugué comme le Drive le nomme).

⚠ Deux choses dites franchement :

* la sous-section des trajectoires s'écrit **`Trajectory`** (majuscule), parce que c'est le nom que
  l'archive de la page MD écrit depuis toujours (`subsection: 'Trajectory'`) — créer `trajectory`
  en plus aurait semé deux dossiers jumeaux. `sanitizeSlug` ne change pas la casse, et le lecteur
  cherche exactement ce nom ;
* la description est **dite AVANT le clic** : l'infobulle du bouton porte les deux chemins complets
  (dataset compris), et le message de succès les répète avec **un lien par dossier**.

*Vérifier :* `node _experiment_folder_files_test.mjs` — **178 assertions** (contre 139) : les deux
cibles créées et leur ordre, l'idempotence (deux appels, zéro dossier de plus), le fichier déposé
dans `experiment_setup/Structure` retrouvé par les 📂, `fullDrivePathText` qui préfixe le dataset,
`firstMissingSegment`/`driveCreateError` sur une chaîne à moitié créée et sur un chemin supprimé
(code `PATH_DELETED`), Nextcloud et Drive éteint, puis le câblage : **aucune** page ne monte plus le
bouton (`eq(...length, 0)` pour MD et NMR) et c'est le viewer qui le rend, **juste après**
`fileRowExtra` et seulement avec un `driveNaming`. Régressions relancées :
`_structure_windows_test.mjs` **107**, `_viewer_ui_layout_test.mjs` **494**, `_drive_restore_test.mjs`,
`_drive_mirror_test.mjs`, `_compact_sections_test.mjs` **211**, `_condition_page_test.mjs` **123**,
`_viewer_render_smoke_test.mjs` **23** (build Vite + montage réel des 11 pages) — tout vert.
`npx vite build` — ✓ ; `npx oxlint` sur les fichiers touchés — **0 erreur**, aucun avertissement ne
nomme un symbole nouveau.

## Le style d'une expérience : le fichier EXPORTÉ est ramené tout seul, et on peut CHOISIR lequel lire (04/10/2026)

**La demande, mot pour mot.** « *when I open an experiment still the styles file is not read
automatically nor I have the possibility to define which file must be read (but it could be simply
the last that was used).* »

### ① Pourquoi le rappel automatique ne lisait rien

Le rappel (`recallViewerStyle`) existait et fonctionnait — mais il ne reconnaissait que les noms
**canoniques** (`viewer-style-snapshot.json`, `viewer-style-cumulative.json`) et ceux qui les
commencent. Or le **⬇ Export** de la bande 🎨 Styles nomme ses fichiers
`viewer-snapshot-<nom>.json` / `viewer-theme-<nom>.json` (voir `exportActiveEnv`) : un style
EXPORTÉ puis déposé dans le dossier de l'expérience n'était donc **jamais** reconnu — exactement le
défaut signalé. `VIEWER_STYLE_EXPORT_STEMS` (dans `src/utils/viewerStyleFile.js`, PUR) déclare ces
deux noms, et `viewerStyleModeOfName` les reconnaît à côté des canoniques. Le refus du reste ne
bouge pas : un `.json` étranger n'est ni téléchargé ni deviné.

### ② Choisir LEQUEL lire — et « simplement le dernier utilisé »

⚠ **CE QUI SUIT A ÉTÉ RETIRÉ LE 04/10/2026** — la demande : « *Style from folder should not be
there. The last file style should be read automatically.* » Le **bouton** 📂 Style from folder et
son geste (`pickStyleFileFromFolder`) n'existent plus : c'est le **rappel automatique** de ① qui
est le seul lecteur du style du dossier, et il lit bien le DERNIER UTILISÉ, puisque chaque geste
qui retient un style (💾 Save, 📂 Load, ⬆ Import) réécrit le fichier canonique de son mode dans le
dossier. Ce paragraphe reste ici parce qu'il dit ce que la picker faisait, et pourquoi sa
suppression ne perd rien.

La rangée des fichiers du viewer (celle de 📂 PDB file(s), qui porte déjà le bouton de création)
gagne un **📂 Style from folder** : c'est le **même composant** que les 📂 Topology / PDB
(`DriveExperimentFilePicker`, une seule définition), sur les `.json` de l'expérience, avec les deux
branches de dossier que le rappel regarde (Data et Setup). Le fichier désigné est **appliqué PUIS
RETENU** (`rememberViewerStyle` : mémoire du poste **et** fichier canonique du dossier) : c'est donc
bien « simplement le dernier utilisé » que la prochaine ouverture appliquera, ici comme sur un autre
poste. Un `.json` qui n'est pas un style est refusé **en le disant** (jamais un écran qui ne bouge
pas sans explication).

*Vérifier :* `node _viewer_style_recall_test.mjs` — **130 assertions** (contre 119) : les deux noms
d'export reconnus (`viewer-theme-…` → `theme`), l'assertion inverse de la session précédente
retournée, puis le câblage du geste (`pickStyleFileFromFolder`, la lecture du texte, l'adoption,
l'application, la mémoire + l'archive, le refus d'un `.json` étranger, la picker sur
`exts={[VIEWER_STYLE_EXT]}` et les deux branches `Data`/`Setup`). Régressions relancées :
`_viewer_style_controls_test.mjs` **494**, `_viewer_style_coverage_test.mjs` **738**,
`_viewer_ui_layout_test.mjs` **494**, `_viewer_render_smoke_test.mjs` **23**.

## Les peaux : trois accents de plus, et une peau que l'utilisateur POSSÈDE (04/10/2026)

**La demande, mot pour mot.** « *the skins in the setup are all too similar and not
customizable.* »

### ① Trois accents de plus — la règle de la maison d'abord

`indigo` et `violet` échangeaient l'accent ; on ajoute **`purple`, `red` et `rose`**, chacun
restituant **cran pour cran** le dégradé que Tailwind livre (relevé dans son thème, jamais inventé).
Ces trois familles sont les seules, avec indigo et violet, à rester **à moins de 4 points de
luminosité OKLCH** du bleu livré : c'est la garde que `_ui_skin_test.cjs` fait respecter à un échange
de teinte, et c'est pour cela que `teal` / `emerald` / `amber` (franchement plus clairs au même cran)
n'entrent PAS dans la liste fixe — ils sont en revanche accessibles par la peau personnalisée, où la
garde est le contraste.

### ② « Custom… » : l'accent ET la famille neutre

`UI_SKIN_CUSTOM` (`custom`) n'a **pas** de dégradé dans `index.css` : ses onze crans dépendent d'une
couleur choisie, donc `src/utils/uiSkin.js` les écrit **en ligne sur `<html>`** — et les retire dès
qu'une autre peau est choisie (sinon ils survivraient au choix). Le réglage est gardé, comme la peau
elle-même, **par OPÉRATEUR** (`labWorkspace_uiSkinCustom_<propriétaire>`, la clé du POSTE servant de
repli et de valeur de départ — voir « La peau appartient à l'OPÉRATEUR » plus bas), et il porte :

* **l'accent** : huit propositions (les hexadécimaux exacts des crans 600 de Tailwind) **et une
  pipette libre** — n'importe quelle couleur ;
* **la famille neutre** : celle du programme, le gris pur (les valeurs de Graphite) ou le chaud
  (celles de Warm paper), empruntées par `data-tone` — les deux blocs portent DEUX attributs
  (`[data-skin="custom"][data-tone="…"]`).

`uiSkinCustomRamp(accent)` (PUR, donc exécutable par la sonde) convertit le hex en OKLCH
(`hexToOklch`, l'inverse exact de ce qu'`index.css` écrit) et recolore la **forme** du dégradé livré :
le cran 600 **est** la couleur choisie, les dix autres gardent l'écart de luminosité du bleu. Une peau
personnalisée ne peut donc pas casser la palette — et la garde est mesurée, pas promise : pour les huit
propositions, le libellé blanc du cran 600 reste ≥ 3.5 (le seuil de la maison pour l'accent) et le
dégradé ne se déplace jamais de plus de 12 points de luminosité. Dans ⚙ Settings, le panneau n'apparaît
**que** pour cette peau, et la miniature vivante reçoit les mêmes variables en ligne — ce que le bouton
montre **est** ce que le programme sera.

*Vérifier :* `node _ui_skin_test.cjs` — **143/143** (contre **91**) : le registre à **10 peaux** plus la
référence, un bloc complet par peau (11 crans), les maths de contraste inchangées pour les peaux
livrées, puis la section 6 — les deux blocs neutres comparés **valeur par valeur** aux blocs
Graphite / Warm paper, la dérivation (le 600 est la couleur choisie, les onze crans descendent,
contraste et déplacement de luminosité bornés pour chaque proposition), `hexToOklch` sur blanc et noir,
un réglage illisible nettoyé, l'aller-retour `localStorage`, les onze variables écrites en ligne puis
**retirées** au changement de peau. Régressions relancées : `_ui_scale_test.cjs` **61/61**,
`_chart_dblclick_test.cjs` **124/124** (seule autre suite à lire `index.css`), `_figure_style_test.mjs`
(elle lit `settingsModule.jsx`), `_tdz_scan_test.mjs` **18 assertions** (250 fichiers).
`npx vite build` — ✓ ; `npx oxlint` — **0 erreur, 0 avertissement** sur `uiSkin.js` et
`settingsModule.jsx`.

⚠ Ce que cette section ne disait pas encore, à ce moment-là : **pas de vrai mode sombre** (les raisons
sont celles de la section « Les peaux de l'interface » plus haut — 1 775 couleurs écrites en dur dans les
modules de tracés), et la sonde au pixel gardait sa liste de **sept** peaux, la peau personnalisée n'étant
couverte que par `_ui_skin_test.cjs`. **C'est fait depuis** — voir « La nuit — quand la peau retourne la
page, l'encre suit », en fin de fichier : `night` et `carbon`, le fond du document qui suit enfin la peau,
et la sonde au pixel portée à **neuf** peaux mesurées.






---

## La peau de l'interface appartient à l'OPÉRATEUR, plus au navigateur (04/10/2026)

**La demande, mot pour mot.** « *the skin must be associated to the operator as each operator must
be able to choose his own preferred skin* ».

### ① Le défaut : une palette par POSTE

La peau vivait dans **une** clé du navigateur (`labWorkspace_uiSkin`). Sur un poste partagé — la
paillasse, le PC de la salle — la palette était donc celle du **dernier** qui avait cliqué : le
suivant retrouvait les couleurs d'un autre, et devait les refaire. Deux postes n'avaient pas non
plus les mêmes couleurs pour un même scientifique.

### ② Deux étages, parce qu'il y a deux échelles

`src/utils/uiSkin.js` distingue maintenant :

| clé | à qui elle appartient | quand elle sert |
| --- | --- | --- |
| `labWorkspace_uiSkin_<propriétaire>` | à UN OPÉRATEUR | dès qu'il est connecté |
| `labWorkspace_uiSkin` | au POSTE | écran d'entrée, session fermée — **et valeur de départ** d'un opérateur qui n'a jamais rien choisi |

`<propriétaire>` est l'**identifiant** de l'opérateur (`currentUser.id`, celui de la liste des
comptes — le même que celui du profil d'administration et du magasin de courbes par utilisateur de
`budgetPage`) ou, tant qu'il n'en a pas, son **nom replié** (`opNameKey` : accents retirés, casse et
ordre des mots ignorés). C'est déjà la règle d'appariement des identités du programme
(`operatorForName`, `memberIdentity`), donc ce repli désigne le **même** opérateur d'un chemin de
connexion à l'autre. `uiSkinOwnerOf` et `uiSkinKeyOf` sont **PURS** (donc exécutés par la sonde, pas
seulement relus).

L'accent personnalisé suit **exactement** la même règle (`labWorkspace_uiSkinCustom_<propriétaire>`) :
deux opérateurs peuvent avoir chacun SON accent et SA famille neutre, sans se marcher dessus.

### ③ Qui pose la peau, et quand

* **`main.jsx` — avant la première peinture.** `applyStoredUiSkinForSession()` lit l'identité que
  l'application a mémorisée pour CET onglet (`sessionStorage.labCurrentUser`, la clé que remplit
  déjà `adoptIdentity`) et pose **sa** peau. Un rechargement ne montre donc pas un éclair de la
  palette du poste avant de revenir à la sienne.
* **`App.jsx` — un effet sur `currentUser`** (`applyStoredUiSkin(currentUser)`) suit les
  CHANGEMENTS : connexion, fermeture de session, passage d'un opérateur à un autre. Sur un poste
  partagé, se connecter suffit à repeindre le programme ; l'écran d'entrée revient à la peau du
  poste.
* **`settingsModule.jsx` — ⚙ Settings** écrit la clé de l'opérateur connecté
  (`saveUiSkin(id, operator)` / `saveUiCustomSkin(raw, operator)`), **relit** la sienne si
  l'identité change pendant que le panneau est ouvert, et **dit** à qui la peau appartient (le nom
  de l'opérateur, ou « this computer » quand personne n'est connecté).

### ④ Ce qui n'a pas changé

* **Jamais dans le dataset ni dans le Doc** : c'est toujours un réglage d'écran (localStorage) ;
* la **peau du poste** existe toujours — celle de l'écran d'entrée, et celle dont part un nouvel
  opérateur (un poste ne change donc pas de couleur sous les yeux de celui qui s'assied devant) ;
* l'**échelle d'affichage** (`utils/uiScale.js`) reste, elle, **par navigateur** : la taille d'un
  écran est une propriété de la machine, pas d'une personne ;
* les **dix peaux** et leurs blocs `index.css` : rien à toucher — une peau ne change qu'**une clé**.

### ⑤ Elles voyagent (sans Firestore)

`labWorkspace_uiSkin_<propriétaire>` commence par « lab » et n'est pas un secret : le miroir des
clés (`_workspace/keys.json`, voir `workspaceKeyStore.js`) la dépose donc sur le Drive **avec les
autres**, et la fusion par horodatage — par clé — garantit qu'un opérateur ne peut pas écraser la
peau d'un autre. Résultat : chacun retrouve sa palette **sur n'importe quel poste**, sans compte
supplémentaire et sans une ligne de Firestore en plus.

*Vérifier :* `node _ui_skin_test.cjs` — **158/158** : la section 7 **exécute** l'appartenance (le
propriétaire est l'id, sinon le nom replié — accents, casse et ordre des mots) ; deux opérateurs
écrivent et relisent des peaux **DIFFÉRENTES** ; une lecture ne rend **jamais** celle d'un autre ;
le poste garde la sienne ; un nouvel opérateur **part** de celle du poste ; deux accents
personnalisés distincts ; la peau de la session posée **avant le premier rendu**, et celle du poste
quand la session est vide. `node _workspace_keys_test.mjs` — **39** : les deux clés d'opérateur
sont acceptées par le miroir. Régressions : `_ui_scale_test.cjs` **61/61**,
`_auth_identity_test.mjs` **39 assertions** (l'identité et l'onglet n'ont pas bougé),
`_tdz_scan_test.mjs` **18 assertions** (250 fichiers). `npx vite build` — ✓ ; `npx oxlint` sur les
quatre fichiers touchés (`uiSkin.js`, `App.jsx`, `main.jsx`, `settingsModule.jsx`) — **0 erreur, 0
avertissement**.

⚠ Ce que ce découpage ne fait pas, dit franchement : la peau n'est **pas** dans Firestore — elle
voyage par le Drive, donc elle manque tant que le miroir n'a pas parlé (le poste garde alors sa
propre copie, et le choix reste dans ce navigateur) ; et un opérateur **renommé** dont le nom n'a
pas encore d'id change de clé — il retombe sur la peau du poste jusqu'à son premier clic.
## La nuit — quand la peau retourne la page, l'encre suit (04/10/2026)

**La demande, mot pour mot.** « *the skins do not change the background color. for dark color the writing
must change color to allow visibility* ».

**Le constat, d'abord : c'était exact, et pour deux raisons distinctes.**

| ce qu'on voyait | pourquoi |
| --- | --- |
| le fond de page restait clair sous **toutes** les peaux | les dix peaux livrées déplacent la **teinte** (Graphite, Warm paper), l'**accent** (Indigo, Violet, Red…) ou l'**encre** (Dimmed, High contrast) — aucune ne déplace la **lumière**. Et le `<body>` était peint en dur (`background-color: #f8fafc` dans `index.html`) : la page restait claire **sous chaque peau**, écran d'entrée et premier rendu compris |
| aucune encre ne suivait un fond sombre | il n'y avait pas de fond sombre à suivre : l'échelle neutre livrée est claire par construction |

### ① Deux peaux sombres, et un retournement plutôt qu'un cas par cas

`night` (les gris de Slate) et `carbon` (les gris purs de Zinc, plus profonds). Elles ne se contentent pas
de repeindre la page : elles **retournent la palette** — et c'est le retournement qui fait suivre l'encre,
sans qu'aucun composant n'ait à s'en occuper. La recette, écrite dans `src/index.css` (« NUIT ») et
**rejouée valeur par valeur** par la sonde :

* chaque famille garde sa teinte et son chroma — ramené dans le gamut sRGB, comme le fait le moteur
  (CSS Color 4) — et sa **luminosité** est rejouée sur les deux segments que le programme sépare
  lui-même : les **surfaces** (crans 50–300 : le fond, les panneaux, les bordures) et les **encres**
  (crans 400–950 : les légendes, les libellés, les titres) ;
* la rampe livrée de chaque famille est **normalisée** sur la bande voulue — de son cran 50 à son 300,
  puis de son 400 à son 950. Une famille garde donc l'**écart de luminosité** qu'elle avait entre ses
  crans : c'est ce qui fait tenir, après le retournement, les paires que le programme écrit (une puce
  `bg-blue-50` + `text-blue-700`, un libellé blanc sur `bg-blue-600`, un filet `border-slate-200` sur une
  carte) ;
* `--color-white` (la carte) prend la valeur de la recette, `color-scheme: dark` suit (contrôles natifs,
  barres de défilement), et les deux blocs sont dans `@media screen` : **le papier reste clair** au tirage
  (`window.print`, les documents, les figures ont de toute façon leur propre encre et leur propre fond).

### ② Le fond du document suit enfin la peau

`index.html` portait deux couleurs en dur (`#f8fafc` pour le fond, `#334155` pour l'encre de secours) : le
`<body>` restait donc clair quoi qu'on choisisse — c'est la moitié du constat. Il lit maintenant
`var(--color-slate-50)` et `var(--color-slate-700)`, les variables que les blocs de peau restituent, avec
les valeurs littérales en **filet** (le premier instant, avant que la feuille soit là). La barre de
défilement fine suit la même règle (`var(--color-slate-300)`).

### ③ Ce que la sonde exige d'une peau sombre

Une peau `night` ne peut pas être jugée « contre la palette livrée » — elle l'échange, donc une paire n'y
garde pas son contraste, elle le **mirroite**. Elle répond à deux règles, toutes deux mesurées.

* **La recette** (`_ui_skin_test.cjs` §5o–5t) : chacun des **176** crans doit **être** la recette
  appliquée à la rampe de Tailwind — L, C et H, la carte comprise. Changer la feuille sans changer la
  recette fait échouer la vérification : aucune valeur n'est inventée. La rampe doit **monter** (le cran
  50 est la surface, le 950 l'encre : l'inverse de la rampe livrée), et aucune paire ne doit tomber sous
  **75 %** de ce que la palette claire lui donnait.
* **Les planchers** : les neuf paires que le programme écrit vraiment gardent, **pour chaque famille**, le
  plancher de lisibilité d'une page sombre — 1.25:1 pour un filet, 2.4:1 pour une date, 3.5:1 pour le
  libellé d'un accent, 4:1 pour un lien, 4.5:1 pour une puce et pour une encre. L'encre a suivi le fond,
  et elle reste lisible : c'est la réponse mesurée à la seconde moitié de la demande.
* **Au pixel** (`_ui_skin_pixel_test.cjs`, Chrome, sur le CSS compilé) : la sonde mesure désormais **neuf**
  peaux. Pour `night` et `carbon`, elle vérifie sur les couleurs que le moteur a réellement rendues que le
  fond de page et les cartes sont **sombres**, que l'encre est **claire**, et calcule les contrastes sur
  ces pixels — encre sur le fond **10.2:1**, encre sur la carte **9.7:1**, une date sur la carte
  **3.2:1**, le libellé d'un bouton **6.6:1**, le libellé d'un bandeau sombre **12.6:1** (chiffres de
  `night` ; `carbon` est du même ordre).

*Vérifier :* `node _ui_skin_test.cjs` — **196/196** (contre **158**), `node _ui_skin_pixel_test.cjs` —
**69** vérifications OK (contre **44**), `npx vite build` ✓, `npx oxlint` sur les fichiers touchés —
0 erreur, 0 avertissement.

⚠ Ce que ces peaux ne font pas, dit franchement : **les graphiques et les figures écrivent leur encre
eux-mêmes**. Les options de Chart.js et les tracés SVG portent des couleurs **littérales** (le gris
`#64748b` des graduations, le bleu nuit `#334155` de certains titres d'axe) que la palette ne touche pas :
sur une carte sombre la graduation reste lisible (**4.0:1**, mesuré au pixel) mais le titre d'axe le plus
sombre tombe à **1.9:1**. Le corriger demande de **résoudre l'encre à l'affichage** (lire la variable de
thème au moment du rendu) sans toucher aux exports — les documents et les figures ont leur propre papier
blanc, et c'est *cette* encre-là qui doit rester. La sonde chiffre désormais les deux cas, pour que la
suite soit mesurable. Les autres peaux, elles, ne changent pas d'un pixel : une peau n'est qu'un bloc de
variables.

## L'ordre de la rangée des fichiers du viewer, et le style lu TOUT SEUL (04/10/2026)

**La demande, mot pour mot.** « *pdb from drive button should stay in the same line as PDB files, and
in the following order: PDB files, URL, Load, Trajectory, download pdb, clear, Create drive folder,
Pdb from folder, trajectory from folder. Style from folder should not be there. The last file style
should be read automatically.* »

### ① Une seule rangée, et son ordre est celui-là

Rien n'a été retiré de la rangée §1 General du viewer : elle a été **réordonnée**, et les commandes
du **dossier de l'expérience** l'ont rejointe en fin de ligne (elles y étaient déjà pour la page MD,
mais AVANT ⬇ PDB et 🗑 Clear). Ce qui reste vrai : c'est le viewer qui rend le geste de création et
`fileRowExtra` (les 📂 de la page), donc **aucune page** ne peut les oublier ni les déplacer.

| # | Commande | Ce qu'elle fait |
|---|----------|-----------------|
| 1 | 📂 **PDB file(s)** | le fichier principal (+ les molécules annexes) du poste |
| 2 | **PDB ID or URL** + **Load** | la même chose, par code ou par lien |
| 3 | 📂 **Trajectory** | la trajectoire du poste |
| 4 | ⬇ **PDB** | ce qui est à l'écran, dans UN fichier (la frame affichée) |
| 5 | 🗑 **Clear** | vide la vue |
| 6 | 🗑 **Delete PDB ⇄ ↩ Restore PDB** | met le PDB de côté / le ressuscite (conditionnel) |
| 7 | 📁 **Create drive folder** | le seul geste qui FABRIQUE l'arborescence de l'expérience |
| 8 | `{fileRowExtra}` | les 📂 de la PAGE : 📂 Topology / 📂 Trajectory from Drive folder (MD), rien sur NMR / Docking |

*(Depuis la session du **04/10/2026** — « Le 📂 PDB du dossier rejoint la rangée des fichiers, et 🔄
fait tourner la molécule », en fin de document — la page **NMR** passe elle aussi son 📂 de la PAGE,
le « 📂 PDB from Drive folder », sur cette même ligne : la ligne 8 ci-dessus ne vaut donc plus que
pour la page **Docking**.)*

⚠ **« 📂 Style from folder » a disparu** (« *Style from folder should not be there* ») et son geste
`pickStyleFileFromFolder` avec lui : aucun code mort, et le viewer n'importe même plus
`DriveExperimentFilePicker` (la seule définition qui reste est celle des pages).

### ② Le style du dossier se lit TOUT SEUL — et c'est bien le dernier utilisé

La seconde moitié de la demande était déjà là (session 🧪) : à l'ouverture d'une expérience, le
spectateur applique **la mémoire de ce poste**, et si elle ne suffit pas (autre poste, navigateur
vidé), il **lit le dossier** de l'expérience et applique son fichier de style. Ce qui a changé ici,
c'est que ce rappel automatique est désormais le **SEUL** lecteur : plus de bouton pour désigner un
fichier à la main.

Pourquoi « the last file style » est tout de même respecté : **chaque geste qui retient un style
réécrit le fichier CANONIQUE de son mode** dans le dossier (`rememberViewerStyle` → `archiveViewerStyle`,
un fichier par mode, réécrit et non dupliqué) — 💾 Save, 📂 Load d'un nom du magasin, ⬆ Import, et
l'ancien 📂 Style from folder. Le dossier porte donc **toujours le dernier utilisé**, et la règle de
préférence du module pur reste celle de la demande d'origine (`pickViewerStyleFile` : le snapshot de
l'expérience, sinon le cumulatif, le plus récent du mode).

*Vérifier :* `node _viewer_ui_layout_test.mjs` — **501 assertions** (contre 494) : l'ordre demandé est
mesuré comme une **suite de positions** (📂 PDB file(s) < URL < Load < 📂 Trajectory < ⬇ PDB <
🗑 Clear < 📁 Create drive folder < les 📂 de la page), et ni « Style from folder » ni
`pickStyleFileFromFolder` n'existent plus. `node _structure_windows_test.mjs` — **108** (contre 107) :
le même ordre, vu du viewer. `node _experiment_folder_files_test.mjs` — **181** : c'est bien le
viewer qui rend les deux commandes du dossier, la création AVANT les 📂 de la page, et sur la ligne
de §1 General. `node _viewer_style_recall_test.mjs` — **131** (contre 130) : le rappel automatique
reste seul lecteur, il refuse un `.json` qui n'est pas un style, il adopte le nom lu, il écrit la
mémoire du poste et il le DIT. Régressions : `node _viewer_general_row_test.mjs` **189**,
`node _viewer_render_smoke_test.mjs` **23**, `node _viewer_row_bridges_test.mjs` **69**,
`node _viewer_style_controls_test.mjs` **494**.

## Viewer : l'ombre ne se détache plus quand le CADRE change de taille (04/10/2026)

**Le défaut signalé.** « *As for the ray shadows, as soon as I click on the MD window (without
running it) or "structure calculation" (without even running it), this strange shadow detached from
the molecule appears.* »

**La cause, en une phrase :** ouvrir une **fenêtre de gauche** (🧬 Structure calculation, ▶ MD, 🪢
Ramachandran) RÉTRÉCIT la vue — la rangée du viewer partage sa largeur avec ces docks (« la colonne de
gauche prend sa place, la vue prend le RESTE ») — mais **NGL ne l'apprenait pas** : sa toile gardait
ses 900 px, donc la molécule ne bougeait pas d'un pixel, tandis que la **couche de l'ombre vivante**
(`absolute inset-0 w-full h-full`) était étirée en CSS sur la nouvelle boîte. Un masque bâti pour 900
affiché sur 700, c'est l'ombre **décalée** de ~105 px : « detached from the molecule ». Seul
`ramaDock` prévenait NGL (un effet dédié, écrit quand le dock 🪢 est né) ; `calcDock` et `mdDock`,
non.

### Le remède, en DEUX moitiés (l'une sans l'autre ne suffit pas)

1. **Le viewer dit à NGL de reprendre ses mesures.** Un **`ResizeObserver`** observe la boîte de la
   vue et appelle `stage.handleResize()` + une image à CHAQUE changement de taille — un dock, la
   poignée de hauteur, la fenêtre, la barre latérale, un repli de la rangée des résidus — au lieu des
   trois effets qui devinaient lesquels (`viewH`, `viewerCollapsed`, `ramaDock` : ils restent, ils
   agissent AVANT le navigateur, l'observateur ne peut plus rien oublier). Une vue **repliée** (0 px)
   n'est pas mesurée : NGL garde sa dernière taille et le 🔎 « Expand viewer » recale par son effet.
2. **Le pilote de l'ombre lit la TAILLE comme il lit la pose.** `viewerRayShadowLive.js` expose
   `canvasSizeOf`, retient la taille du dernier masque peint (`builtSize`) et la compare à **chaque
   image rendue**, AVANT la pose et la signature (un redimensionnement n'est ni l'un ni l'autre :
   l'aspect vit dans la matrice de PROJECTION, pas dans `matrixWorldInverse`). Une taille nouvelle
   fait donc **repeindre tout de suite**, dans le régime du repos (aucun brouillon : la qualité ne
   clignote pas) — au lieu d'attendre `staleMs`, après quoi, souvent, plus rien n'est rendu du tout
   (NGL ne rend que sur demande). Un masque impossible (`failBuild`) l'oublie, comme la signature : le
   filet continue de se soigner tout seul.

### Ce qui est MESURÉ (et comment)

`_viewer_ray_shadow_resize_test.cjs` joue la scène dans un vrai Chrome : une rangée avec un dock qui
s'ouvre, la vraie toile NGL 2.4, **le vrai pilote** et une mesure en **pixels affichés** — le centre
de gravité de la MOLÉCULE (les atomes projetés par `camera.clip`, la même matrice que le masque) contre
celui de l'OMBRE (le dernier masque peint, ramené par la taille CSS de la couche). Leur écart est un
décalage de projection : constant tant que la couche tombe juste.

| instant | boîte | toile | masque | couche étirée | écart ombre − molécule |
|---------|-------|-------|--------|---------------|------------------------|
| la scène posée | 900 | 900 | 900 | non (1,00) | **+22,0 px** |
| le dock s'ouvre, **NGL est prévenu** | 700 | **700** | **700** | non (1,00) | **+14,6 px** (la pénombre, ≤ 10 px) |
| le dock se referme | 900 | 900 | 900 | non (1,00) | **+22,0 px** (au pixel près) |
| le dock s'ouvre, **sans rien dire à NGL** | 700 | **900** | 900 | **oui (0,78)** | **−83,2 px** → **105 px de côté** |

Et le témoin négatif prouve le « detached » sans discussion : la **boîte projetée de la molécule est
identique au pixel près** (même centre, même taille : elle n'a pas bougé) pendant que l'ombre, elle,
glisse de plus de **100 px** — exactement le décalage qu'impose l'étirement 700/900.

*Vérifier :* `node _viewer_ray_shadow_resize_test.cjs` — **20/20** assertions dans un vrai Chrome
(≈20 s) : la couche n'est jamais étirée (facteur 1), la toile suit la boîte quand on le lui dit, le
masque est refait POUR la taille observée, la molécule ne change ni de taille ni de place, l'écart ne
bouge que de la poignée de pixels de la pénombre (≤ 10 px) — et le témoin négatif, lui, mesure les
105 px du défaut rapporté. `node _viewer_ray_shadow_live_test.mjs` — **183 assertions** (contre 175) :
la politique du pilote, sans navigateur, avec le quatrième témoin (`resize` → un masque pour la
nouvelle taille, en passe nette, une seule fois, et le retour à l'ancienne taille aussi).
`node _viewer_ui_layout_test.mjs` — **501** : le `ResizeObserver`, son garde-fou (0 px) et son
`observe` sont dans le viewer. Régressions : `node _viewer_ray_shadows_test.mjs`,
`node _viewer_light_rig_test.mjs`, `node _viewer_render_smoke_test.mjs` **23**, `npx vite build` ✓,
`npx oxlint` sur les deux fichiers touchés — **0 erreur**, et **exactement les mêmes 62
avertissements qu'à HEAD** (vérifié sur la version de `HEAD`).

## « Changer la couleur de fond ou le motif n'a aucun effet » (04/10/2026)

**La demande, mot pour mot.** « *changing the background color or pattern does not have any effect* »,
précisée ensuite : « *if I click on your predefined styles they work but if I click on custom and change
the colors nothing happens* ».

**Le constat, mesuré avant toute correction.** Le mécanisme n'était pas en cause. Dans Chrome, sur le
build réel, un réglage enregistré (`bg: #22c55e` + motif `grid`) **peint bien les pages** : `<html>` porte
`data-skin="custom" data-tone="stone" data-pattern="grid"`, les deux crans de page sont écrits en ligne
(`--color-slate-50: oklch(95.5% 0.030 149.6)`), le cadre de page du programme calcule
`background-color: oklch(0.955 0.03 149.6)` **et** `background-image: linear-gradient(…)` sur `24px 24px`,
et le `<body>` suit. Deux captures (`_bg_shot_custom.png` / `_bg_shot_none.png`) le montrent côte à côte.
Le défaut était donc dans le **clic** — et la seconde phrase de l'utilisateur le désignait déjà : les
peaux livrées marchent, le custom non.

**Pourquoi les deux chemins ne se ressemblent pas.** `saveUiSkin` (peau livrée) applique **toujours** ce
qu'on vient de cliquer : elle n'a rien à relire. `saveUiCustomSkin` (accent, famille neutre, couleur de
page, motif) décidait d'appliquer ou non en **relisant le stockage** (`readUiSkin(operator) === 'custom'`).
Or cette relecture peut ne pas répondre « custom » : `localStorage.setItem` peut être **refusé** (quota
dépassé, navigation privée) ; la clé peut porter une valeur que le module ne reconnaît pas (écrite par une
autre version, ou passée par la synchronisation des clés entre postes) ; la clé d'**opérateur** peut n'être
pas la même au moment du clic. Dans les trois cas le réglage tout juste choisi restait sans effet, **en
silence** — la miniature, elle, bougeait (elle lit l'objet rendu, pas le stockage), ce qui donnait très
exactement l'impression que rien ne se passe.

### ① La peau « en service », plutôt qu'une relecture

`uiSkin.js` retient maintenant la peau qu'`applyUiSkin` a réellement posée (`appliedSkinId`, exposé par
`appliedUiSkinId()`), et `saveUiCustomSkin` applique le réglage si **cette** peau est la personnalisée —
le stockage n'est plus consulté pour décider. Mieux : c'est **l'objet qui vient d'être choisi** qui est
posé (`applyUiSkin(id, operator, custom)`), jamais une valeur relue : un stockage qui refuse d'écrire ne
peut donc plus annuler un clic.

*Vérifier :* `node _ui_bg_apply_test.cjs` — **9/9** (contre **6/9** avant correction : « le stockage
refuse d'écrire » et « la clé d'opérateur a changé » échouaient). La sonde ouvre le vrai module servi par
Vite dans Chrome, joue les clics (`saveUiSkin('custom')` puis `saveUiCustomSkin(…)`) et lit `<html>` après
chacun ; elle porte aussi le **témoin négatif** — sur une peau livrée, un réglage custom ne repeint rien.
`node _ui_bg_live_test.cjs custom` — **12/12** et `… none` — **7/7** : le build réel, ce que le moteur
peint sur les pages réelles, avec et sans réglage. `node _ui_skin_test.cjs` — **229/229**,
`node _workspace_keys_test.mjs` — **39**, `node _tdz_scan_test.mjs`, `node _ui_scale_test.cjs`,
`node _auth_identity_test.mjs` — inchangés ; `npx vite build` ✓.

⚠ Ce que cela ne fait pas, dit franchement : si le navigateur **refuse d'écrire** dans son stockage, le
choix s'applique mais n'est **pas retenu** après un rechargement — un réglage d'écran n'a pas d'autre
mémoire (hors dataset et hors Doc, par construction). Et la **bande de lisibilité** reste ce qu'elle est :
une couleur franche est peinte en pastel (`#22c55e` → `#e3f6e6`), les trois teintes neutres offertes
(Slate, Zinc, Stone) sont à un ou deux points du blanc livré, `Slate` **est** la teinte livrée, et le
premier motif de la liste est `none` — donc les toutes premières pastilles essayées ne peuvent, par
construction, rien changer.


## « tutta la pagina é nera » : les motifs passent de quatre à vingt, et la nuit prend de la profondeur (04/10/2026)

**La demande, mot pour mot.** « *adesso reagisce ma mente nello stile preselezionato nero tutta la pagina
é nera, nel custom posso regolare solo la pagina di sfondo. inoltre i patterns sono davvero pochi. sono
convinto che puoi fare molto meglio!* » — trois reproches, et le premier n'était pas une impression :
il se mesure.

### ① La nuit n'était qu'un seul noir — mesuré sur le build réel

`night` posait une page à **13 %** de luminosité OKLCH, un panneau à **15,4 %** et une carte à **17 %** :
quatre points entre le fond et les cartes, deux et demi entre le fond et les panneaux. À ces luminosités
l'œil ne sépare plus rien, et la capture de l'écran d'entrée montrait exactement ce que la demande décrit :
deux dalles noires à peine distinctes.

Les deux peaux sombres ont donc été RECALCULÉES avec les mêmes règles qu'avant (la recette « NUIT » : la
rampe livrée de chaque famille est normalisée sur deux bandes, surfaces et encres) mais avec des bandes
ÉTALÉES — et, dans le même geste, des encres PLUS CLAIRES, parce qu'une carte qui monte mange le contraste
de ce qui s'écrit dessus :

| | fond | panneau | carte | filet | cran fort | encre 700 |
|---|---|---|---|---|---|---|
| `night` avant | 13 | 15,4 | 17 | 21,1 | 30 | 78,3 |
| `night` après | **15** | **18,5** | **22** | **27** | **40** | **81,3** |
| `carbon` avant | 11 | 13,7 | 15 | 20,7 | 28 | 78,7 |
| `carbon` après | **13** | **16,8** | **19** | **26,7** | **37** | **79,1** |

L'écart fond→carte passe de **4 à 7 points** (et de 8,1 à 12 pour le filet) ; au pixel, sur le build réel,
la carte porte maintenant **3,3 ×** la luminance du fond (`night` : carte 1,10 % · page 0,33 %). La sonde
EXIGE désormais ce rapport (≥ 2 ×) et que la page ne soit pas le noir pur. Les neuf planchers de
lisibilité des peaux sombres, la part de 75 % du contraste clair et les paires de la maison restent tenus :
c'est la recette, rejouée cran par cran par la sonde, qui l'affirme.

**Le seul plancher qui bouge, dit franchement.** Les graduations des graphiques sont écrites EN DUR
(`#64748b`, dans les options de Chart.js et les tracés SVG — la palette ne peut pas les repeindre) : sur
une carte éclaircie elles tombent à **3,62:1** (`night`) et **3,87:1** (`carbon`), sous l'ancien plancher de
4. C'est la SEULE paire que ces peaux ne savent pas replier, et 3,5 est le plancher d'un OBJET GRAPHIQUE
(WCAG 1.4.11) : c'est donc là, et nulle part ailleurs, que la sonde a été ajustée. Le titre d'axe le plus
sombre (`#334155`, 1,66:1) reste la limite connue qu'elle signale déjà.


### ② Les motifs : de quatre à vingt — douze trames, huit dessins

`UI_BG_PATTERNS` en compte désormais **vingt**, en deux familles (`UI_BG_PATTERN_GROUPS`) :

* **douze TRAMES de papier** — `none`, `grid`, `fine`, `graph` (papier millimétré : trame fine et filet
  marqué tous les cinq), `dots`, `dense`, `rules`, `diagonal`, `cross`, `weave`, `herringbone`,
  `triangles` — des filets et des points, des repères pour écrire ;
* **huit MOTIFS DESSINÉS** — `waves` (vagues : des arcs de cercle décalés d'une demi-période, la ligne
  court en ondulant), `scales` (écailles bicolores), `zigzag` (chevrons), `honeycomb` (nid d'abeille),
  `bubbles` (bulles de trois tailles et de trois couleurs), `confetti` (semis multicolore), `checker`
  (damier, en `repeating-conic-gradient`) et `plaid` (tartan : les croisements des deux alpha font la
  troisième couleur).

Tous sont des dégradés CSS répétés : aucun octet à charger, et leurs règles vivent dans `@media screen` —
un document imprimé garde sa page blanche. Ils ont maintenant **trois variables de plus** : la
**position** d'une famille d'arcs (`--lab-page-position`, décalée par l'échelle comme le reste) et les
**trois encres** des motifs dessinés.

**Les trois encres ne sont pas un catalogue de plus : elles se dérivent de l'accent choisi**, exactement
comme les onze crans de la peau — le filet neutre (slate-900 au jour, slate-200 de nuit), la teinte de
l'accent, et son complémentaire (+150°, le *split complement* des nuanciers), les deux teintes posées à la
MÊME lumière que le filet et ramenées dans le gamut sRGB. Changer d'accent change donc les couleurs du
motif sans changer son poids sur la page : c'est mesuré, à l'alpha près.

Chaque motif a deux réglages de plus, dans le MÊME objet que l'accent et la couleur de page :

* **la force de l'encre** — `faint` 0.035, `standard` 0.06, `bold` 0.11 — écrite EN LIGNE
  (`--lab-page-alpha`) ; l'encre elle-même (le filet, et le filet marqué du papier millimétré, au double)
  est écrite une seule fois, dans la feuille ;
* **l'échelle de la trame** — `fine` ×0.6, `standard` ×1, `broad` ×1.6 — écrite EN LIGNE
  (`--lab-page-scale`) et **multipliée par la feuille à ses propres pas**
  (`calc(24px * var(--lab-page-scale, 1))`) : aucun nombre n'est écrit deux fois, et changer l'échelle ne
  demande aucun nombre au JavaScript.

**Les pastilles de ⚙ Settings sont des pages en miniature**, pas des illustrations : elles portent la classe
d'une page et l'attribut du motif, donc c'est la MÊME règle de index.css qui les peint — avec la couleur de
page CHOISIE, ramenée dans la bande. La sonde au pixel compare les deux, image par image : elles sont
identiques. Et la pastille « None » reste nue même sous une page qui porte un motif, parce qu'elle remet le
motif à zéro avant — une variable s'hérite, un attribut non.

### ③ La page peut être SOMBRE — « la pagina resta molto chiara »

La peau personnalisée ne savait peindre que des pages CLAIRES : un réglage de plus, `pageMode`, et
`data-pagemode="night"` retourne la palette. Il n'invente rien, et c'est là toute sa force : **le bloc de la
peau `night` et celui de `carbon` portent un SECOND sélecteur**

```css
[data-skin="night"],
[data-skin="custom"][data-pagemode="night"] { /* 176 crans, une seule source */ }
[data-skin="carbon"],
[data-skin="custom"][data-tone="zinc"][data-pagemode="night"] { /* idem, pour la famille GRISE */ }
```

Donc une page de nuit personnalisée **EST** la peau livrée correspondante — mêmes nombres, une seule
source, l'accent de l'opérateur par-dessus (écrit en ligne, il l'emporte sur le bleu de repli). La famille
CHAUDE, que ces deux peaux n'ont pas, rejoue la MÊME recette sur la rampe de Stone (onze crans neutres :
15 la page contre 15 pour Night, 18,2 le panneau contre 18,5, 99 la dernière encre) — et la sonde relit les
quatre bornes dans le bloc de `night` au lieu de les croire.

Ce qui change pour le motif, et pourquoi rien n'a été réécrit : la même couleur de page tombe dans une
**bande sombre** (12–16 %, l'écart de 3,5 de la peau Night pour le cran 100 — la page livrée y atterrit à
**15,3 % contre 15,0**, mesuré), et `uiBgInkRgb` écrit alors les trois encres **CLAIRES**. La géométrie des
vingt motifs, elle, ne bouge pas d'un pixel : elle lit `--lab-page-ink`, qui a seulement changé de côté.

⚠ **Le seul endroit où une page choisie pourrait partir sur le papier** : la couleur, l'accent et les
encres sont écrits EN LIGNE (ils dépendent du réglage), donc aucune règle d'écran ne peut les défaire — sauf
la seule qu'un auteur puisse opposer à du style en ligne, `!important`. Un garde `@media print` rend donc au
papier les deux crans CLAIRS de chaque famille (six déclarations, pas une de plus) ; le motif, lui, ne
s'imprime de toute façon jamais. Ce qui reste imprimé du réglage de nuit, c'est l'accent et l'échelle de sa
rampe : c'est écrit dans ⚙ Settings.

### ④ Ce qui est vérifié, et ce qui ne l'est pas

* **Que le motif ne discute jamais avec le texte** : le filet le plus appuyé, composé sur toutes les pages
  qu'un utilisateur peut obtenir (les 72 teintes saturées du cercle, les extrêmes, les huit pages
  proposées), **et pour les trois encres des huit accents**, coûte au pire **1,12:1** de la page claire
  qu'il décore ; sur la page verte `#22c55e` essayée dans cette session : 1,034 / 1,060 / 1,115 pour les
  trois forces. Un repère de papier, jamais une gêne.
* **Que la nuit ne cache pas le motif non plus** : sur une page sombre, le même filet clair coûte **1,63:1 à
  Standard et 2,71:1 à Bold** — il se VOIT —, et il reste sous les **4,2:1** de la légende la plus pâle que
  le programme y écrit. Ce sont deux mesures, pas deux espérances.
* **Que l'accent retourné est la recette** : au bleu livré, `uiSkinCustomRamp(accent, 'night')` redonne le
  bleu de la peau `night` **lumière pour lumière** (onze crans, 29,0 → 100,0), et il reste dans le gamut
  sRGB au millième d'écriture près ; les trois paires que le programme écrit gardent le plancher d'une page
  sombre **pour chacun des huit accents** (le pire cas est mesuré, pas supposé).
* **Que l'échelle multiplie vraiment** : dans Chrome, sur la feuille compilée, la tuile de `grid` passe de
  24 px à **48 px** (`--lab-page-scale: 2`) et à **12 px** (`0.5`) ; sur l'application réelle, la page de
  `graph` à `broad` calcule `12.8px 12.8px, 12.8px 12.8px, 64px 64px, 64px 64px`.
* **Que la page de nuit est bien celle des peaux livrées** : dans Chrome, sur le CSS compilé, la page
  personnalisée de nuit vaut `#0a0b0c` (Night), `#070707` (Carbon pour la famille grise) et `#0b0b0b`
  (Stone) ; dans l'application réelle, la page de `#4f46e5` de nuit se peint en `oklch(0.12 0.06 277)` avec
  le motif `confetti` composé en `rgba(145, 219, 208, 0.11)` — les encres claires de l'accent teal.
* **Que rien ne s'écrit sans motif** : sans motif choisi, `--lab-page-alpha`, `--lab-page-scale` ET les trois
  `--lab-page-ink*` ne sont PAS sur `<html>` (mesuré dans le vrai programme), et la page garde son motif à
  zéro.

⚠ Les limites, dites franchement : **les motifs se peignent aussi sur une page sombre désormais** — c'est ce
que la bande sombre et les encres claires viennent de régler —, mais les Trames de papier n'y sont pas
inversées : ce sont les mêmes filets, simplement clairs. Le chrome d'une peau sombre reste CLAIR (c'est le
retournement de la palette, pas un oubli), ce qui reste imprimé d'une page de nuit personnalisée est
l'accent, et si le navigateur refuse d'écrire dans son stockage, un réglage s'applique mais n'est pas retenu
après rechargement.

*Vérifier :* `node _ui_skin_test.cjs` — **271/271** (contre **229** : la section 9 mesure les vingt motifs,
les deux familles, les trois encres, la page de nuit, la recette retournée et les planchers des huit
accents) ; `node _ui_skin_pixel_test.cjs` — **93** vérifications OK dans Chrome sur le CSS compilé (les 20
motifs peints, la pastille qui ne ment pas, et la page de nuit : `#0a0b0c` contre celle de Night) ;
`node _ui_bg_live_test.cjs custom` — **17/17**, `… night` — **18/18** et `… none` — **11/11** (le build
réel, ce que le moteur peint sur les pages réelles) ; `node _ui_bg_apply_test.cjs` — **9/9** ;
`node _ui_scale_test.cjs` — **61/61** ; `node _workspace_keys_test.mjs` — **39** ;
`node _auth_identity_test.mjs` — **39** ; `node _tdz_scan_test.mjs` — **18** (250 fichiers) ;
`npx oxlint` sur les trois fichiers touchés — **0 avertissement** ; `npx vite build` ✓.

## Le 📂 PDB du dossier rejoint la rangée des fichiers, et 🔄 fait tourner la molécule (04/10/2026)

**Les deux demandes, mot pour mot.** « *in the viewer "pdb from drive folder" should fit in the
same line as "create drive folder"* » et « *Next to the movie button add a button to rotate
uniformly the molecule in x, y and z direction* ».

### ① Le 📂 PDB du dossier de la page NMR vit sur la ligne de 📁 Create drive folder

Le bouton de la page NMR était le **dernier** à se payer une **rangée à lui tout seul**, au-dessus
du viewer (il portait en plus la phrase « *Choosing a file here opens it AND declares it…* »). Il a
donc fait le déménagement que les deux 📂 de la page MD avaient déjà fait : il part **AU VIEWER**
par la prop `fileRowExtra` — sous une définition UNIQUE, `nmrStructureFromFolder`, écrite avant le
rendu de la page — et le viewer le rend **à la fin de sa rangée §1 General**, c'est-à-dire sur la
ligne même de 📂 PDB file(s), de 📂 Trajectory et de 📁 Create drive folder (« *the same line as
"create drive folder"* »).

| Ce qui a changé | Ce qui n'a pas changé |
|---|---|
| l'**endroit** du bouton : une rangée à lui au-dessus du viewer → la fin de la rangée des fichiers, sur la ligne de 📁 Create drive folder | le **composant** (`DriveExperimentFilePicker`), sa **lecture** (le dossier canonique de l'expérience, sous-section `Structure`), son **installation** (`pickNmrStructureFromFolder` : nom déclaré, pointeur Drive, blob du poste) et son **libellé** |

⚠ Rien n'est perdu : la phrase qui accompagnait le bouton est passée **dans son infobulle**
(« …and open one of them as this condition's structure. Choosing a file here opens it AND declares
it: this condition will reopen it by default, on every computer. Nothing is uploaded again. ») —
exactement le déménagement des deux 📂 de la page MD. La page ne fait donc plus qu'**un seul** rendu
de ce composant, et le viewer reste le SEUL à poser le geste de création (📁 Create drive folder),
juste avant lui.

*(Conséquence sur le tableau de « L'ordre de la rangée des fichiers du viewer », plus haut : sa
ligne 8 — « rien sur NMR / Docking » — vaut maintenant pour la page **Docking** seule, la page NMR
passant elle aussi un 📂 de la page.)*

### ② 🔄 Spin x·y·z — le tournoiement uniforme, juste après 🎞 Movie

Le bouton vit dans la boîte 🎨 Styles, **immédiatement après 🎞 Movie** (donc entre 🌫 Scene et
✏️ Modify, comme le Movie lui-même), et il ne fait qu'une chose de plus que lui : **il tourne**.

* **« uniformly » = le MÊME angle sur les TROIS axes.** Chaque image compose
  `dq = Rx(ω·dt) · Ry(ω·dt) · Rz(ω·dt)`, puis **pré-multiplie** la rotation de la scène
  (`q ← dq · q`). La pré-multiplication exprime le tour dans le repère de l'**écran** (x vers la
  droite, y vers le haut, z vers le spectateur) : c'est bien ce qu'on VOIT qui tourne, d'où le même
  geste quelle que soit l'orientation d'où l'on regarde — et aucun axe ne prend le dessus (jamais le
  va-et-vient droite / gauche d'un simple plateau). `SPIN_RAD_PER_S = 0.6` : un tour complet sur
  chaque axe en ~10,5 s.
* **`dt` est MESURÉ**, pas supposé : c'est l'horloge que le navigateur donne à
  `requestAnimationFrame`, donc le tour est le même à 30, 60 ou 144 Hz, et un pas est **plafonné à
  0,1 s** pour qu'un onglet resté longtemps en arrière-plan ne fasse pas un bond au retour.
* **C'est un geste de VUE, jamais un contenu.** L'orientation tournée est
  `viewer.rotationGroup.quaternion` — celle qu'un glisser de souris écrit et que la pose de caméra
  lit et repose (`applyCameraPose`), et celle que 🎞 capture dans son `q`. Donc : la souris reprend
  le tour **où il en est**, une pose capturée **garde l'orientation qu'elle montre**, le fondu d'un
  film la mélange, ⬇ PDB continue d'écrire la **place des molécules** (jamais où la caméra regarde)
  et ↺ ne l'annule pas (il remet des *positions*, pas la vue).
* **Il s'efface devant un film.** Pendant qu'une pose se vérifie (`kfPreview`) ou qu'un film s'écrit
  (`kfBusy`), la boucle s'arrête — deux mains sur la même rotation ne donneraient qu'un tremblement
  — et le bouton, lui, **reste allumé** : le tour reprend tout seul à la fin, sans un second clic.

⚠ Les deux constructeurs d'objets (`Quaternion`, `Vector3`) sont **LUS** sur les objets de la scène,
comme partout dans ce fichier : une version de NGL qui ne les exposerait pas ne tourne simplement
pas, et l'exception ne remonte jamais au bouton. Rien n'est tenu dans un quaternion à nous — le seul
objet fabriqué est l'**incrément d'une image**.

*Vérifier :* `node _viewer_ui_layout_test.mjs` — **517 assertions** (contre **501**) : le bouton est
mesuré DANS la boîte 🎨 Styles **immédiatement après** 🎞 Movie, l'état (`spinOn`, `aria-pressed`), la
constante de vitesse, les trois axes du pas, la pré-multiplication, le `dt` mesuré, la boucle qui
s'efface devant le film, et la liste des commandes de §2 qui nomme le nouveau bouton ;
`node _structure_windows_test.mjs` — **112** (contre **108**) : la page NMR passe **UN**
`fileRowExtra` (`nmrStructureFromFolder`, défini une seule fois, avec le MÊME `ctx`, le MÊME
`onPick` et le MÊME libellé), la phrase passée dans son infobulle, et **un seul** 📂 PDB du dossier
dans le fichier — sa rangée à lui a disparu. Régressions : `node _viewer_render_smoke_test.mjs` —
**23** (le vrai build du viewer, qui rend le nouveau bouton et sa boucle),
`node _viewer_style_controls_test.mjs` — **494**, `node _viewer_general_row_test.mjs` — **189**,
`node _viewer_row_bridges_test.mjs` — **69**, `node _compact_sections_test.mjs` — **211**,
`node _condition_page_test.mjs` — **123**, `node _residue_numbering_panels_test.mjs` — **79**,
`node _ss_sheet_test.mjs` — **163**, `node _nmr_nuclei_table_test.mjs` — **67** ;
`npx oxlint` — **322 avertissements / 0 erreur** (inchangé) ; `npx vite build` ✓.
Rouges AVANT cette session, et sans rapport : `node _viewer_keyframes_test.mjs` (sa sonde cherche
encore l'ancienne ligne d'import de `viewerRayImage`, déjà remplacée à HEAD) et
`node _experiment_folder_files_test.mjs` (le module importe `archiveFileDriveName`, absent à HEAD).


---

## ⑦ Une page de docking neuve est vierge, et une instance garde SON style

La demande de cette session, en trois points : (1) « when I create a docking page it is never
virgin because there are example data but I would prefer it to be empty » ; (2) « I would like to
have a button with which I define the style of the viewer for each instance of each experiment.
Clicking on this button will define its style based on what is shown at that moment in the viewer.
next to this button there must be another button to revert to the defined style if in the meantime
the style was changed. Most importantly, whenever I open that instance of that experiment this
style must be applied automatically. For example I had two protein that I colored in different
colors then I changed the page (went to another instance) and went back to it and both protein had
the same colors. this cannot be. »

### ① La page de docking ne s'invente plus de poses

Le crochet `useDockingDerived` de `DockingSections.jsx` lisait `activeTest.dockingPoses` et, **quand
la liste était vide**, fabriquait des poses de démonstration — douze si le programme était HADDOCK,
neuf sinon. Toute la moitié « Data » de la page (table des scores, nuage « énergie vs. écart à la
référence », cartes de métriques) était donc remplie de nombres qui n'existent nulle part, et rien
à l'écran ne les distinguait d'un vrai import. Le crochet ne lit plus **que** `activeTest.dockingPoses`,
et l'absence de liste veut dire « rien à montrer » : les deux générateurs ne sont plus ni importés ni
appelés depuis la page (le module `DockingData.jsx` les garde exportés — `_docking_scatter_card_test.mjs`
s'en sert comme sonde).

### ② Le style appartient à l'INSTANCE

`styleMemoryKeysRef` (`NMRMoleculeViewer.jsx`) mettait **l'expérience d'abord**
(`pymolSessionExperimentSlug`), la condition ensuite : une seule mémoire — et un seul fichier de
style — servait donc **toutes** les conditions d'un même essai. C'est exactement le défaut rapporté :
le style enregistré sur une condition s'appliquait à sa voisine, et les deux protéines de celle-ci se
retrouvaient habillées pareil. L'ordre est **inversé** : l'INSTANCE (projet · nom · condition — c'est
l'`instanceKey` que la page donne au viewer) vient EN PREMIER, l'expérience entière ensuite (une
mémoire écrite avant ce correctif reste donc lisible), la clé générale en dernier recours.
Deux boutons accompagnent la bande 🎨 Styles :

* **📌 Define style** — photographie ce qui est À L'ÉCRAN **maintenant** et en fait le style de CETTE
  instance. C'est **toujours un snapshot** (par section, « protein · chain A » …) : un thème fusionne
  par CLASSE moléculaire et confondrait deux protéines colorées autrement — le défaut même. Il est
  retenu comme n'importe quel autre style (mémoire du poste **et** `viewer-style-snapshot.json` dans
  le dossier de la condition), donc l'ouverture suivante l'applique **toute seule** : c'est le rappel
  automatique déjà en place (`recallViewerStyle`), il n'y a rien de plus à croire sur parole.
* **↩ Revert to defined** — repose ce même snapshot si des couleurs ont changé entre-temps, et le
  **dit** quand rien n'a encore été défini au lieu de rester muet.

*Vérifier :* `node _viewer_style_recall_test.mjs` — **132** (l'ordre des clés INSTANCE-puis-expérience,
le nom réservé du style défini) ; `node _viewer_style_controls_test.mjs` — **502** (📌 et ↩ existent,
sont branchés DANS la bande avant 💾 Save, et 📌 écrit bien un SNAPSHOT) ;
`node _docking_viewer_restore_test.mjs` — **60** (la page ne connaît plus les générateurs de poses
d'exemple et ne lit que `activeTest.dockingPoses`) ; `node _viewer_ui_layout_test.mjs` — **517** ;
`node _viewer_background_test.mjs` — **168** ; `npx oxlint` — **0 erreur** ; `npx vite build` ✓.
Rouge **avant** cette session, sans rapport : `node _docking_scatter_card_test.mjs` (sa liste de
doublures est en retard sur les imports actuels de `NMRSections.jsx` — `useShowAssignedFlag`,
`canonicalExperimentPath`, `sanitizeSlug` ; vérifié en remettant les deux fichiers touchés de côté,
le rouge est identique) et `node _viewer_keyframes_test.mjs` (sonde d'import périmée).

### ③ « Le programme est devenu très lent » — la page gardée ne se re-rend plus

Ce qui a été **mesuré dans le code** (et non deviné) : la page GARDÉE (`pageSlot`, `App.jsx` — un
`display: none` mais **montée**) était **re-rendue à chaque rendu d'App** — `render()` était rappelé
pour les DEUX places à chaque fois — et le contenu d'une page d'expérience (ses sections, sa scène
WebGL) repassait donc par le réconciliateur pendant qu'on travaillait ailleurs : changer de page
coûtait ce travail invisible.

Le correctif : **l'ÉLÉMENT de la page gardée est retenu** (`parkedElRef`) et redonné **tel quel** tant
qu'elle est cachée. React saute un sous-arbre dont l'élément reçu est identique (mêmes props ⇒ aucun
travail). Ce qui ne change pas : la page gardée **vit toujours** (ses chargements continuent, ses
propres `setState` la re-rendent elle-même — mesuré : son compteur est passé de 9 à 17 pendant qu'elle
était cachée), la page **affichée** rend toujours frais, et le cache est **jeté** dès que la place
gardée change, donc une page qui redevient visible repart d'un rendu frais avec les props d'App à jour.

*Vérifier :* `node _page_parking_test.mjs` — **54** (l'élément retenu, la page affichée sans cache, le
cache jeté quand la place change) ; **et le `display: none` réel mesuré par Chrome** :
`node _page_parking_render_test.cjs` — **19/19** (mêmes nœuds DOM au retour, compteur de la page gardée
qui continue d'avancer).


### ④ « Define style » ne gardait ni la lumière ni le fond — et une instance volait le style de sa voisine

Le rapport, mot pour mot : « *define style does not take the background color in consideration. If I
select a certain light orientation in one instance and click on define style, then I go to another
instance of the same experiment and I change the direction of the light and I click define style,
when I go back to the first instance the direction of the light is like in the second instance ; the
gradient of the background still does not work. »*

**La cause, dans le code.** La mémoire de style était bien par instance (§②), mais le **magasin** des
snapshots est, lui, **commun à tout le poste** : `labViewerSnapshots`, UNE clé localStorage
(`VIEWER_SNAPSHOT_KEY`, `NMRMoleculeViewer.jsx`). Le 📌 écrivait sous un nom **fixe** —
`'Defined style'` — donc les conditions d'un même essai se partageaient **la même entrée** : la
seconde écrasait la première, et la mémoire de la première (juste, elle) reposait le style de la
seconde. Tout partait avec, parce que l'**environnement global** d'un snapshot emporte la **lampe**
(◐ Shadows : azimut, élévation, noirceur, couleur), le **fond** (`background` : la couleur A) **et sa
rampe** (`backgroundGradient` : B, le milieu, l'angle, l'interrupteur) en même temps que les couleurs
des molécules — tous sont dans `THEME_GLOBAL_KEYS`. D'où les deux moitiés du rapport : la lumière
d'une instance revenait dans l'autre, et le dégradé défini ne se retrouvait plus.

**Le correctif.**

* **Le nom du style défini porte le SLUG de l'instance** — `Defined style · <slug>` (`DEFINED_STYLE_NAME`),
  le slug étant celui de sa **mémoire** de style (`pymolSessionInstanceSlug(instanceKey, driveNaming)`,
  voir `styleMemoryKeysRef`) : le nom, la mémoire et le fichier du dossier de la condition parlent de
  la même instance, et deux conditions ne peuvent plus se rencontrer. Hors expérience (aucun slug), le
  nom réservé reste seul : c'est la mémoire GÉNÉRALE qui le désigne, et il n'y a qu'un viewer.
* **Une mémoire qui nomme l'ANCIEN nom nu est ignorée** (`recallViewerStyle`) : une instance ne peut pas
  savoir à quelle condition il appartenait, donc elle ne le rejoue pas — la mémoire suivante puis le
  **fichier du dossier de CETTE condition** ont la parole, et le prochain 📌 écrit le nom propre à
  l'instance. Le poste d'avant ce correctif ne peut donc plus rejouer la faute.

**Une deuxième fuite, de la même famille : le magasin est commun, la copie d'un viewer non.** Chaque
page garde son dictionnaire dans un `useState` depuis son montage, et les pages quittées **restent
montées** (le « page parking » d'`App.jsx`, §③) : le 💾 d'une page écrasait donc ce qu'une autre venait
d'y déposer — deux conditions qui définissent chacun leur style dans la même séance se volaient une
entrée au geste suivant, et un poste **hors ligne** (sans le fichier du Drive pour rattraper) la perdait
pour de bon. **Toute écriture d'un nom passe maintenant par `writeNamedEntry`** : le magasin est **relu
du stockage** et le geste s'y fusionne (💾 Save d'un snapshot et d'un thème, ⬆ Import, l'adoption d'un
style du Drive, 🗑 Delete — dont l'existence se lit elle aussi dans le magasin du poste), et la « regola
aurea » d'un thème cumulatif se lit sur ce magasin, jamais sur une copie en retard.

**Ce qu'il reste à faire UNE fois, sur un poste qui a déjà servi.** Le nom nu d'avant est ignoré (voir
ci-dessus) : une instance qui a défini son style AVANT ce correctif ne le rejoue plus depuis sa mémoire —
mais elle ne rejoue pas non plus celui de sa voisine ; le 📌 une fois suffit à écrire le nom propre à
l'instance, et tout ce qui suit est instantané et hors ligne.

*Vérifier :* `node _viewer_style_recall_test.mjs` — **156** (le nom propre à l'instance, **EXÉCUTÉ** avec
la vraie règle de slug ; deux instances, un seul magasin : chacune repose **sa** lampe et **son** fond ;
la mémoire de l'ancien nom nu est ignorée au profit du fichier de la condition ; hors expérience, le nom
nu reste légitime) ; `node _viewer_style_controls_test.mjs` — **504** (📌 et ↩ toujours branchés dans la
bande, avant 💾 Save, et le nom du style défini est celui de l'instance) ;
`node _viewer_theme_snapshot_test.mjs` — **73** (`writeNamedEntry` **EXÉCUTÉ** : le nom d'une page survit
à l'écriture d'une autre, `null` ne supprime que ce nom) ; `node _viewer_background_test.mjs` — **168** et
`node _viewer_ui_layout_test.mjs` — **517** (le panneau du fond et la bande 🎨 Styles n'ont pas bougé d'un
caractère) ; `node _viewer_light_rig_test.mjs` — **385** ; `npx oxlint` — **0 erreur** ; `npx vite build` ✓.
`node _verify.cjs` — **44 suites, 0 échec** — dont les PIXELS réels du fond
(`_viewer_background_pixels_test.cjs`, **34/34** : la rampe est bien peinte). Le fond n'a jamais été le
problème : c'est le STYLE qui ne la portait pas.

