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
