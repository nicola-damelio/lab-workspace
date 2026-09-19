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
│   ├── storage/<storage>/images/<fichier>          ← image de référence du storage
│   ├── storage/<storage>/boxes/<boîte>/images/<f>  ← photos de la boîte
│   ├── storage/<storage>/boxes/<boîte>/label.pdf   ← étiquette de la boîte (automatique)
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
| Renommer un storage / une boîte | son dossier Drive (`storage/<storage>`, `storage/<storage>/boxes/<boîte>`) est **renommé** — une boîte ne garde jamais le « Test 74 » de sa création |
| Modifier le contenu d'une boîte | `storage/<storage>/boxes/<boîte>/label.pdf` est réécrit (différé, ~2 s après la dernière modification) |
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

## Le rangement d'un storage et de ses boîtes

Une **boîte de stockage n'est pas une expérience** : c'est un emplacement. Elle
n'a donc ni niveau « instance » ni « section », et son dossier porte le **nom de
la boîte** — jamais le « Test 74 » de sa création. Le rangement est :

```
<dataset>/storage/<storage>/images/<fichier>          ← image de référence du storage
<dataset>/storage/<storage>/boxes/<boîte>/images/<f>  ← photos de la boîte (Box Photo, Inside Photo)
<dataset>/storage/<storage>/boxes/<boîte>/label.pdf   ← étiquette de la boîte, réécrite automatiquement
```

Ce que cela change, geste par geste (`Storage.jsx`, `utils/storageDrive.js`,
`utils/driveNaming.js`, `utils/boxLabel.js`) :

* **les fichiers gardent leur nom** (`file1.jpg`, `file2.jpg`) : seul le dossier
  est imposé par l'application (`DriveUploadButton nameFor`) ;
* **renommer une boîte renomme son dossier** (`renameStorageBoxDriveFolder`) —
  photos et `label.pdf` suivent le dossier, donc les liens déjà enregistrés dans
  la boîte continuent de fonctionner ; renommer un storage renomme
  `storage/<storage>` (`renameStorageDriveFolder`) ;
* **l'étiquette est fabriquée et déposée toute seule** (`components/BoxLabelFile.jsx`,
  `utils/boxLabelPdf.js`) : ~2 s après la dernière modification de la boîte,
  `label.pdf` remplace le précédent. Rien n'est envoyé si le contenu n'a pas
  changé (la boîte garde la signature du dernier envoi) ni si le Drive ne répond
  pas — le bouton « Save to Drive now » réessaie à la demande. Le bouton
  « Print Label » imprime, lui, la **sélection** de puits ; l'étiquette archivée
  est la table complète des puits **remplis** (même table, même code) ;
* **l'ancienne arborescence est rapatriée** (`tidyStorageFiles`) : à l'ouverture
  d'un storage ou d'une boîte, les fichiers déjà envoyés sous
  `storage/<boîte>/<instance>/image/…` ou `storage/<storage>/image/…` sont
  **déplacés** — par identifiant de fichier, donc le lien enregistré ne change
  pas — vers les dossiers ci-dessus. Un fichier déjà bien rangé n'est jamais
  touché, et rien n'est déplacé quand le Drive est injoignable.

Le diagnostic correspondant est `_storage_drive_layout_test.mjs` (chemins,
contenu de l'étiquette, renommages et rangement, sur un faux Drive).

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

## Ce qui reste propre à un appareil (volontairement)

* les jetons d'accès et la session de connexion ;
* la file d'attente des envois (`pendingUploads`) ;
* les fichiers bruts volumineux (`.fcs`, `.xtc`…) gardés dans IndexedDB, qui sont
  déjà sur le Drive ;
* les identifiants de dossiers du navigateur (`labDriveFolderId`) — désormais
  doublés par le registre partagé.

## Vérifier soi-même

* `node _drive_mirror_test.mjs` — suppressions / renommages / rien ne ressuscite.
* `node _storage_drive_layout_test.mjs` — le rangement `storage/<storage>/boxes/<boîte>`
  (chemins, étiquette automatique, renommages, rapatriement de l'ancienne arborescence).
* `node _experiment_drive_root_test.mjs` — l'archive d'une expérience (import
  Bruker NMR 1D / ssNMR, migration des images) atterrit sous `projects/`, jamais
  dans un dossier de projet posé à la racine du dataset.
* `node _workspace_drive_test.mjs` — l'espace de travail écrit, relu, fusionné.
* `node _workspace_keys_test.mjs` — les clés du navigateur, et les secrets exclus.

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

### Modules branchés

* **NMR 1D** — `NMRSections.jsx` (`applyNmrBruker` + l'import dossier) archive la
  copie de référence du spectre complet ; la page la restaure seule. Le pointeur
  d'un import arrivé pendant un changement d'onglet est posé sur la bonne
  instance dès qu'elle est ouverte (`nmr1dPendingRefs`).
* **Flow Cytometry** — avait déjà ce comportement (`handleRestoreFromDrive`) :
  il reste le modèle, rien n'a régressé.
* **MD** — `MDSections.jsx` rapatrie déjà structure et trajectoire du Drive
  quand la cache locale est vide (`downloadArchivedMDFile`).
* Restent à brancher sur le même mécanisme : **ssNMR**, **CD (Jasco)**,
  **docking** (structures / molécules / CAPRI) et **microscopie** (vidéos).
  La mécanique ne change pas : archiver une copie JSON au moment de l'import,
  poser le pointeur sur le test, appeler `useDriveAutoRestore` dans la page.

### Vérifier soi-même

* `node _drive_restore_test.mjs` — la logique pure (marqueurs, noms, portillon,
  refus des types croisés) et le cycle archivage → restauration sur un faux
  Drive, y compris un pointeur périmé, un fichier mis à la corbeille et un autre
  poste sans registre local ; puis le câblage du NMR 1D.

