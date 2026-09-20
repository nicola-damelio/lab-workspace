/* =========================================================================
   src/utils/figuresFolder.js
   LE DOSSIER D'IMAGES D'UN PROJET : le TROUVER — jamais en fabriquer un second.

   L'emplacement canonique d'une figure est

       <dataset>/projects/<slug(projet)>/images        (figure d'un PROJET)

   et, pour une figure qui n'appartient à AUCUN projet, le dossier de la
   bibliothèque COMMUNE — un dossier de PREMIER NIVEAU du dataset, qui porte les
   figures DIRECTEMENT :

       <dataset>/general_library_images

   Le dossier d'un projet est donc DÉRIVÉ DU NOM du projet (voir
   driveNaming.projectImagesFolderPath) ; le dossier commun, lui, n'est pas un
   dossier de projet. Son ancien emplacement — `projects/unassigned/images` — est
   encore LU le temps de la migration (voir utils/commonLibraryMigrate.js). Un
   projet renommé, un dossier renommé à la main sur le Drive, ou un miroir perdu
   (navigateur vidé, magasin plein — `labDriveMirror` n'est pas synchronisé)
   laissent les fichiers dans l'ANCIEN dossier pendant que le programme cherche le
   nouveau. Et comme la résolution CRÉAIT le dossier manquant
   (driveUpload.resolveDrivePathFromNames), elle fabriquait un jumeau VIDE :

       « j'ai deux dossiers images sur le Drive et l'un est vide, et le
         programme ne voit plus mes figures »  —  le dossier lu n'était pas
         celui où les fichiers sont.

   Ce module corrige la cause : il CHERCHE et ne crée RIEN.

     1. le MIROIR PARTAGÉ (`labDriveMirror` → dossier du projet par identifiant
        Drive) : il survit à un renommage, le dossier étant renommé sur place ;
     2. le nom CANONIQUE (projects/<slug>/images) — un simple test d'existence ;
     3. un dossier de projet VOISIN dont le nom ressemble encore (renommage
        léger : « Canvas 18/09 » → « Canvas 18-09-2026 »).

   Quand aucun dossier ne peut être identifié AVEC CERTITUDE (renommage complet :
   « Canvas 1 » → « Fig 1 »), il ne devine pas — il LISTE les dossiers de projet
   du dataset avec ce que chacun contient, et l'écran laisse choisir
   (voir pullLibraryFromDrive({ fromFolderName })).

   Les gestes qui ÉCRIVENT (publication d'une figure, dépôt du sidecar éditable)
   passent par le même résolveur : une nouvelle figure rejoint le dossier qui
   existe déjà au lieu d'ouvrir un dossier parallèle — c'est ce qui remet un
   projet sur UN seul dossier d'images.
   ========================================================================= */

import {
  getDriveToken, getDriveRootId, getDriveRootName, ensureDriveFolder,
  findFolderByName, listDriveChildren, getDriveFileMeta, canonicalDatasetDirId
} from './driveUpload';
import {
  readDriveMirror, writeDriveMirror, findProjectFolderId, findDatasetFolderId,
  findProjectImagesId, rememberProjectFolder
} from './driveMirrorStore';
import { GENERAL_LIBRARY_DIR, sanitizeSlug } from './driveNaming';

/* ── Comparaison de noms (PUR, testable) ───────────────────────────────────── */

/** Clé de comparaison d'un nom de dossier : minuscules, sans séparateurs — donc
 *  « Canvas 18/09 » et « Canvas_18-09 » se comparent. PUR. */
export const folderNameKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Les noms que portait le SEAU COMMUN d'avant (« aucune figure de projet ») —
 *  encore LUS, jamais écrits : le dossier commun vit maintenant à la racine du
 *  dataset (voir commonLibraryFolderName).
 *
 *  Le nom CANONIQUE était `_unassigned` — celui des docs et celui de Nextcloud
 *  (les segments passés à WebDAV ne sont pas re-slugés) —, mais une ÉCRITURE sur
 *  Google Drive passe par `resolveDrivePathFromNames`, qui sanitise CHAQUE
 *  segment : `sanitizeSlug('_unassigned')` vaut `unassigned` (le `_` de tête
 *  tombe). Les deux noms sont donc acceptés (le réel d'abord). PUR. */
export const legacyCommonFolderNames = () => ['unassigned', '_unassigned'];

/** Le nom du dossier de la bibliothèque COMMUNE : `<dataset>/general_library_images`
 *  (un dossier de PREMIER NIVEAU du dataset, à côté de `projects/`). PUR. */
export const commonLibraryFolderName = () => GENERAL_LIBRARY_DIR;

/** Les noms que peut porter le dossier de la bibliothèque COMMUNE : celui
 *  d'aujourd'hui d'abord (`general_library_images`), puis les anciens
 *  (`unassigned`, `_unassigned`) — c'est l'ordre dans lequel il faut chercher. PUR. */
export const commonLibraryFolderNames = () => [GENERAL_LIBRARY_DIR, ...legacyCommonFolderNames()];

/** Ce nom est-il celui de la bibliothèque COMMUNE — le nom d'aujourd'hui ou un
 *  ancien ? C'est ce qui distingue « les figures sans projet » d'un dossier de
 *  PROJET : sans cette reconnaissance, la portée commune lirait (puis écrirait)
 *  les figures d'un projet. PUR. */
export const isCommonLibraryName = (name) =>
  commonLibraryFolderNames().some((n) => folderNameKey(n) === folderNameKey(name));

/** Ce nom est-il celui de l'ANCIEN seau commun (`unassigned` = `_unassigned`) —
 *  un dossier qui n'a plus lieu d'exister, et que la migration vide ? PUR. */
export const isLegacyCommonFolderName = (name) => {
  const key = folderNameKey(name);
  return legacyCommonFolderNames().some((n) => folderNameKey(n) === key);
};

/** Le chemin (noms de dossiers, relatif au dossier du dataset) du dossier
 *  d'images d'une portée, tel qu'il EXISTE sur le Drive :
 *      projects/<slug(projet)>/images      pour une figure de ce projet,
 *      general_library_images              pour la bibliothèque COMMUNE.
 *  Le dossier commun vit À LA RACINE du dataset et porte les figures
 *  DIRECTEMENT (ce dossier EST le dossier d'images) : c'est le nom que l'écran
 *  doit MONTRER, celui que le Drive affiche. PUR. */
export const imagesFolderPathOnDrive = (projectName) => (sanitizeSlug(projectName)
  ? `projects/${sanitizeSlug(projectName)}/images`
  : GENERAL_LIBRARY_DIR);

/** Le nom cherché correspond-il à celui de CE projet / de cette portée ? PUR. */
export const folderNameIsWanted = (name, projectName) =>
  (sanitizeSlug(projectName) ? String(name) === sanitizeSlug(projectName) : isCommonLibraryName(name));

/** Les mots d'un nom (pour un renommage qui garde la moitié du titre). PUR. */
const folderNameWords = (name) => sanitizeSlug(name).toLowerCase().split(/[_-]+/).filter(Boolean);

/** Deux noms désignent-ils le MÊME dossier de projet ?
 *  3 = même nom au séparateur/casse près (« Canvas_18_09 » = « canvas 18 09 »),
 *  2 = l'un contient l'autre (« Figure_p53H » ⊃ « Figure_p53H_old »),
 *  1 = ils partagent des mots (« Canvas 18/09 » ↔ « Canvas 19/09 »),
 *  0 = rien en commun (un vrai renommage : à l'utilisateur de trancher). PUR. */
export const projectFolderNameScore = (folderName, projectName) => {
  const a = folderNameKey(folderName);
  const b = folderNameKey(projectName);
  if (!a || !b) return 0;
  if (a === b) return 3;
  if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return 2;
  const wordsA = folderNameWords(folderName);
  const wordsB = folderNameWords(projectName);
  return wordsA.some((w) => wordsB.indexOf(w) !== -1) ? 1 : 0;
};

/** Le dossier qui est SÛREMENT celui de ce projet, sinon `null`.
 *  Un score ≥ 2 (nom identique ou contenu) suffit ; un score de 1 (mots communs)
 *  ne suffit PAS — deux projets peuvent partager des mots — et deux candidats à
 *  égalité ne suffisent pas non plus : dans ces cas l'appelant montre la liste
 *  au lieu de choisir à l'aveugle. PUR. */
export const pickFiguresFolder = (candidates, projectName) => {
  const list = (Array.isArray(candidates) ? candidates : []).filter((c) => c && c.name && c.imagesId);
  if (!list.length) return null;
  /* Portée COMMUNE (aucun projet) : le dossier attendu est la BIBLIOTHÈQUE
     COMMUNE — son nom d'aujourd'hui (`general_library_images`) ou celui du bac
     historique (`unassigned`). Son nom est une CONVENTION, pas une supposition —
     le reconnaître vaut donc 3 au lieu de 0 (`projectFolderNameScore(x, '')`
     vaut toujours 0, si bien que la bibliothèque commune ne pouvait JAMAIS être
     retrouvée par ce chemin). */
  const scoreOf = (name) => (sanitizeSlug(projectName)
    ? projectFolderNameScore(name, projectName)
    : (isCommonLibraryName(name) ? 3 : 0));
  const scored = list
    .map((c) => ({ c, score: scoreOf(c.name), files: Number(c.files || 0) }))
    .sort((x, y) => (y.score - x.score) || (y.files - x.files));
  const best = scored[0];
  if (!best || best.score < 2) return null;
  if (scored[1] && scored[1].score === best.score) return null;
  return best.c;
};

/* ── Les JUMEAUX d'un dossier (PUR) ─────────────────────────────────────────── */

/** « J'ai deux dossiers images sur le Drive et l'un est vide » : deux dossiers du
 *  MÊME nom, au MÊME endroit, existent — et `findFolderByName` rend le PREMIER,
 *  que le Drive choisit sans ordre garanti (souvent le plus récent, donc le vide).
 *  Le classement des jumeaux est PUR : celui qui CONTIENT des figures gagne, puis
 *  celui qui en contient le plus, puis le nom (deux dossiers vides sont
 *  interchangeables, mais leur ordre doit rester stable). */
export const rankFiguresLeaves = (leaves) => (Array.isArray(leaves) ? leaves : [])
  .filter((l) => l && l.imagesId)
  .map((l) => ({ ...l, files: Number(l.files || 0) }))
  .sort((a, b) => (b.files - a.files)
    || String(a.imagesName || '').localeCompare(String(b.imagesName || '')));

/** Le dossier `images` à retenir parmi des jumeaux (`null` si aucun). PUR. */
export const bestFiguresLeaf = (leaves) => rankFiguresLeaves(leaves)[0] || null;

/* ── Lecture du Drive (aucun dossier créé) ─────────────────────────────────── */

/** La racine du dataset : l'identifiant retenu dans le miroir s'il existe
 *  encore, sinon le dossier du dataset (seul endroit où l'on accepte une
 *  création : sans lui, il n'y a rien à lire). */
const datasetRootId = async () => {
  try {
    const remembered = findDatasetFolderId(readDriveMirror(), {
      id: getDriveRootId(), name: getDriveRootName()
    });
    if (remembered) {
      const meta = await getDriveFileMeta(remembered);
      if (meta && meta.id && !meta.trashed) return remembered;
    }
  } catch { /* miroir illisible → dossier du dataset */ }
  return await ensureDriveFolder();
};

const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
/** Un dossier du Drive (et non un fichier). */
const isFolderNode = (f) => !!f && !!f.id && String(f.mimeType || '') === DRIVE_FOLDER_MIME;
/** Le dossier s'appelle-t-il `images` ? Un jumeau fabriqué à côté porte souvent
 *  un nom dérivé (« Images », « images_2 ») : on les prend tous. */
const isImagesFolderNode = (f) => isFolderNode(f) && folderNameKey(f.name).indexOf('images') === 0;
/** Les sous-dossiers d'un parent dont le nom (au séparateur/casse près) est `key`. */
const childFoldersNamed = async (parentId, key) =>
  (await listDriveChildren(parentId).catch(() => []))
    .filter((f) => isFolderNode(f) && folderNameKey(f.name) === String(key || ''));

/** Le meilleur dossier `images` d'un dossier de projet : un seul → lui, sans
 *  aucun appel de plus ; PLUSIEURS (des jumeaux) → on compare ce qu'ils
 *  contiennent, sans quoi la lecture tombe sur le premier du nom — le vide. */
const bestLeafOfProjectFolder = async (projectFolderId) => {
  const leaves = (await listDriveChildren(projectFolderId).catch(() => [])).filter(isImagesFolderNode);
  if (!leaves.length) {
    /* La liste n'a rien donné (Drive muet, ou faux Drive d'une sonde qui
       n'énumère pas les dossiers) : on retombe sur la recherche par nom — le
       chemin d'avant, qui rend « le premier du nom ». Mieux vaut lire un dossier
       que plus rien du tout. */
    const byName = await findFolderByName('images', projectFolderId).catch(() => '');
    return byName ? { imagesId: String(byName), imagesName: 'images' } : null;
  }
  if (leaves.length === 1) {
    return { imagesId: String(leaves[0].id), imagesName: String(leaves[0].name || 'images') };
  }
  const counted = [];
  for (const leaf of leaves) {
    const files = await listDriveChildren(leaf.id).catch(() => []);
    counted.push({ imagesId: String(leaf.id), imagesName: String(leaf.name || 'images'), files: files.length });
  }
  return bestFiguresLeaf(counted);
};

/** Combien de fichiers porte un dossier `images` (`null` = on n'a pas pu
 *  compter : on ne conclut alors RIEN — un dossier qu'on ne peut pas lire n'est
 *  pas un dossier vide). */
const leafFileCount = async (leafId) => {
  try { return (await listDriveChildren(leafId)).length; } catch { return null; }
};

/** Le nom RÉEL du dossier du projet, lu au miroir (il est renommé SUR PLACE) —
 *  sinon le nom canonique. Sert à AFFICHER le bon chemin : le dossier `images`,
 *  lui, est toujours visé par son identifiant (voir findProjectFiguresFolder). */
const projectFolderNameOf = async (scope, fallback) => {
  const folderId = findProjectFolderId(readDriveMirror(), scope);
  if (!folderId) return fallback;
  const meta = await getDriveFileMeta(folderId).catch(() => null);
  if (!meta || !meta.id || meta.trashed || !meta.name) return fallback;
  return String(meta.name);
};

/** LE JUMEAU QUI PORTE LES FIGURES, quand le dossier résolu n'en a AUCUNE :
 *  au même endroit, un dossier du même nom (ou d'un autre conteneur `projects`,
 *  ou d'un autre dossier du nom du projet) contient les fichiers — c'est
 *  exactement l'état « deux dossiers images dont un vide » où le programme ne
 *  voyait plus rien. Le jumeau peuplé est retenu pour ce projet : il est lu ET
 *  écrit ensuite. `null` quand il n'y a rien de mieux à lire (le dossier vide
 *  est bien le seul). */
const preferPopulatedTwin = async (projectName, leafId) => {
  const count = await leafFileCount(leafId);
  if (count !== 0) return null;
  return recoverFiguresFolderWithFiles(projectName, { exceptLeafId: leafId });
};

/** Une entrée de la portée COMMUNE, dans la MÊME forme que celle d'un projet
 *  (`name`, `folderId`, `imagesId`, `files`, `sidecars`), PLUS `folder` : le
 *  chemin réel à MONTRER. Le dossier commun d'aujourd'hui vit à la racine du
 *  dataset et porte les figures DIRECTEMENT — son `imagesId` est lui-même, et
 *  `folderId` est la racine où il est rangé ; le bac historique, lui, avait un
 *  dossier `images` à l'intérieur (`projects/unassigned/images`). */
const commonLeafEntry = async ({ leaf, folderId, folderName, via }) => {
  const files = await listDriveChildren(leaf.id).catch(() => []);
  const leafName = String((leaf && leaf.name) || GENERAL_LIBRARY_DIR);
  return {
    name: via === 'legacy' ? String(folderName || '') : leafName,
    folderName: String(folderName || ''),
    folderId: String(folderId || ''),
    containerId: String(folderId || ''),
    imagesName: leafName,
    imagesId: String(leaf.id),
    folder: via === 'legacy' ? `projects/${folderName}/images` : leafName,
    via,
    files: files.length,
    sidecars: files.filter((f) => /\.meta\.json$/i.test(String((f && f.name) || ''))).length
  };
};

/** TOUS les dossiers d'images de la portée COMMUNE : le nom d'aujourd'hui, à la
 *  racine du dataset (`<dataset>/general_library_images`), PUIS les emplacements
 *  historiques (`projects/unassigned/images` et `_unassigned`) encore présents —
 *  c'est ce qui permet de continuer à lire la bibliothèque commune tant que la
 *  migration ne l'a pas déplacée.
 *  LECTURE SEULE : rien n'est créé, même quand la bibliothèque n'existe pas. */
const scanCommonLeaves = async () => {
  const out = [];
  if (!getDriveToken()) return out;
  try {
    const root = await datasetRootId();
    if (!root) return out;
    /* Le dossier du nouveau nom : ÉNUMÉRÉ d'abord (il peut y avoir des jumeaux),
       puis, s'il n'apparaît pas — lecture muette, ou faux Drive d'une sonde qui
       n'énumère pas les dossiers — cherché PAR SON NOM, le chemin d'avant. */
    const todayLeaves = new Map();
    for (const leaf of await childFoldersNamed(root, folderNameKey(GENERAL_LIBRARY_DIR))) {
      todayLeaves.set(String(leaf.id), leaf);
    }
    if (!todayLeaves.size) {
      const byName = await findFolderByName(GENERAL_LIBRARY_DIR, root).catch(() => '');
      if (byName) todayLeaves.set(String(byName), { id: String(byName), name: GENERAL_LIBRARY_DIR });
    }
    for (const leaf of todayLeaves.values()) {
      out.push(await commonLeafEntry({ leaf, folderId: root, folderName: '', via: 'name' }));
    }
    for (const container of await childFoldersNamed(root, 'projects')) {
      for (const bucketName of legacyCommonFolderNames()) {
        for (const bucket of await childFoldersNamed(container.id, folderNameKey(bucketName))) {
          const leaves = (await listDriveChildren(bucket.id).catch(() => [])).filter(isImagesFolderNode);
          for (const leaf of leaves) {
            out.push(await commonLeafEntry({ leaf, folderId: bucket.id, folderName: bucket.name, via: 'legacy' }));
          }
        }
      }
    }
  } catch { /* pas de Drive / pas de jeton : liste vide, jamais une erreur */ }
  return out;
};

/** TOUS les dossiers `images` du dataset vus par tous les chemins possibles —
 *  plusieurs conteneurs `projects`, plusieurs dossiers du nom du projet, et
 *  JUMEAUX d'un même dossier `images` — avec ce que chacun contient. Pour la
 *  portée COMMUNE (aucun projet), les dossiers de la bibliothèque commune sont
 *  ajoutés : elle n'est PAS sous `projects/`, donc la boucle ci-dessous ne les
 *  voit pas (et les jumeaux déjà vus ne sont pas comptés deux fois).
 *  LECTURE SEULE : rien n'est créé, même quand le dossier n'existe pas. */
const scanFiguresLeaves = async (projectName = '') => {
  const out = [];
  if (!getDriveToken()) return out;
  const key = sanitizeSlug(projectName) ? folderNameKey(projectName) : '';
  try {
    const root = await datasetRootId();
    if (!root) return out;
    for (const container of await childFoldersNamed(root, 'projects')) {
      const projectFolders = key
        ? await childFoldersNamed(container.id, key)
        : (await listDriveChildren(container.id).catch(() => [])).filter(isFolderNode);
      for (const folder of projectFolders) {
        const imagesFolders = (await listDriveChildren(folder.id).catch(() => [])).filter(isImagesFolderNode);
        for (const leaf of imagesFolders) {
          const files = await listDriveChildren(leaf.id).catch(() => []);
          out.push({
            name: String(folder.name || ''),            // nom du dossier de PROJET
            folderName: String(folder.name || ''),
            folderId: String(folder.id),
            containerId: String(container.id),
            imagesName: String(leaf.name || 'images'),  // nom du dossier `images`
            imagesId: String(leaf.id),
            folder: `projects/${folder.name}/${leaf.name}`,
            via: 'project',
            files: files.length,
            sidecars: files.filter((f) => /\.meta\.json$/i.test(String((f && f.name) || ''))).length
          });
        }
      }
    }
    if (!key) {
      const seen = new Set(out.map((l) => l.imagesId));
      for (const leaf of await scanCommonLeaves()) {
        if (seen.has(leaf.imagesId)) continue;
        seen.add(leaf.imagesId);
        out.push(leaf);
      }
    }
  } catch { /* pas de Drive / pas de jeton : liste vide, jamais une erreur */ }
  return out;
};

/** Les dossiers `images` d'un projet — jumeaux compris (voir scanFiguresLeaves). */
export const listProjectFiguresLeaves = (projectName = '') => scanFiguresLeaves(projectName);

/** TOUS les dossiers de projet du dataset, avec ce que leur dossier `images`
 *  contient (`files` = fichiers, `sidecars` = compositions éditables).
 *  `imagesId` est celui du dossier RETENU quand plusieurs portent ce nom.
 *  LECTURE SEULE : rien n'est créé, même quand le dossier n'existe pas. */
export const listProjectFiguresFolders = async () => {
  const leaves = await scanFiguresLeaves('');
  const byFolder = new Map();
  leaves.forEach((leaf) => {
    const current = byFolder.get(leaf.folderId) || {
      name: leaf.name, folderId: leaf.folderId, imagesId: '', imagesName: '', files: 0, sidecars: 0, leaves: []
    };
    current.leaves.push(leaf);
    current.files += leaf.files;
    current.sidecars += leaf.sidecars;
    byFolder.set(leaf.folderId, current);
  });
  return Array.from(byFolder.values()).map((c) => {
    const best = bestFiguresLeaf(c.leaves);
    return {
      ...c,
      imagesId: (best && best.imagesId) || '',
      imagesName: (best && best.imagesName) || ''
    };
  });
};

/** Retenir ce dossier `images` pour ce projet : le miroir partagé le garde, donc
 *  les lectures ET les envois suivants visent celui-là. */
const rememberFiguresLeaf = (projectName, leaf) => {
  try {
    writeDriveMirror(rememberProjectFolder(readDriveMirror(), {
      datasetId: getDriveRootId(),
      datasetName: getDriveRootName(),
      projectName,
      folderId: leaf.folderId,
      imagesId: leaf.imagesId
    }));
  } catch { /* registre local indisponible : la lecture reste possible */ }
};

/** Retenir le dossier `images` que la résolution vient de TROUVER — sans bruit.
 *
 *  C'est ce qui remplace définitivement la recherche par nom : la prochaine
 *  lecture (et le prochain envoi) visent l'IDENTIFIANT retenu, donc plus jamais
 *  « le premier dossier du nom » quand deux jumeaux coexistent.
 *
 *  Si le miroir connaît déjà ce dossier `images`, RIEN n'est écrit : une lecture
 *  ne doit pas faire réécrire le fichier d'état du Drive à chaque fois. */
const rememberFiguresLeafOnce = (projectName, { folderId = '', imagesId = '' } = {}) => {
  if (!folderId || !imagesId) return;
  const scope = { datasetId: getDriveRootId(), datasetName: getDriveRootName(), projectName };
  if (findProjectImagesId(readDriveMirror(), scope) === String(imagesId)) return;
  rememberFiguresLeaf(projectName, { folderId, imagesId });
};

/** LE JUMEAU QUI PORTE LES FIGURES.
 *
 *  Le dossier résolu était VIDE : au même endroit, un dossier du MÊME nom (ou
 *  d'un autre conteneur `projects`, ou d'un autre dossier du nom du projet)
 *  porte les fichiers — c'est exactement l'état « deux dossiers images dont un
 *  vide » où le programme ne voyait plus rien. On les COMPARE, on retient celui
 *  qui a des figures et on le note dans le miroir : plus rien ne sépare ensuite
 *  les lectures des envois.
 *
 *  @returns {Promise<null | { leafId:string, name:string, folder:string,
 *                             files:number, candidates:Array }>}
 *           `null` = aucun jumeau peuplé (le dossier vide est bien le seul). */
export const recoverFiguresFolderWithFiles = async (projectName, { exceptLeafId = '' } = {}) => {
  const skip = String(exceptLeafId || '');
  /* Portée COMMUNE : seuls les dossiers de la BIBLIOTHÈQUE COMMUNE sont
     candidats (le nom d'aujourd'hui, à la racine du dataset, ou le bac
     historique `projects/unassigned/images`). Sans ce filtre, le « dossier
     peuplé » choisi pouvait être celui d'un PROJET et la bibliothèque commune se
     mettait à lire — puis à écrire — les figures d'un projet. */
  const leaves = sanitizeSlug(projectName)
    ? await scanFiguresLeaves(projectName)
    : await scanCommonLeaves();
  const best = bestFiguresLeaf(leaves.filter((l) => l.imagesId !== skip && l.files > 0));
  if (!best) return null;
  rememberFiguresLeaf(projectName, best);
  return {
    name: best.name,
    leafId: best.imagesId,
    exact: folderNameIsWanted(best.name, projectName),
    via: 'twin',
    folder: String(best.folder || `projects/${best.name}/${best.imagesName}`),
    files: best.files,
    candidates: leaves.filter((l) => l.imagesId !== best.imagesId)
  };
};

/** LA bibliothèque COMMUNE — le dossier d'images des figures sans projet —
 *  cherchée SANS RIEN CRÉER.
 *
 *   1. le dossier DÉJÀ RETENU, par son identifiant : c'est la seule source qui
 *      survit à un renommage fait à la main sur le Drive ;
 *   2. le nom d'aujourd'hui, à la racine du dataset :
 *      <dataset>/general_library_images ;
 *   3. les emplacements historiques (`projects/unassigned/images`) : la
 *      bibliothèque commune reste LISIBLE — et les envois y entrent — tant que la
 *      migration ne l'a pas déplacée (voir utils/commonLibraryMigrate.js), donc
 *      aucune figure ne se perd entre les deux dossiers.
 *
 *  Le dossier du nouveau nom existe mais est VIDE tandis qu'un ancien porte les
 *  figures : c'est l'ancien qui gagne (le jumeau peuplé), sans quoi la
 *  bibliothèque paraîtrait vide juste avant la migration.
 *
 *  @returns {Promise<{ name:string, leafId:string, exact:boolean, via:string,
 *                      folder:string, candidates:Array }>} */
const findCommonFiguresFolder = async () => {
  const scope = { datasetId: getDriveRootId(), datasetName: getDriveRootName(), projectName: '' };
  const none = {
    name: '', leafId: '', exact: false, via: '', folder: GENERAL_LIBRARY_DIR, candidates: []
  };
  try {
    const remembered = findProjectImagesId(readDriveMirror(), scope);
    if (remembered) {
      const meta = await getDriveFileMeta(remembered).catch(() => null);
      if (meta && meta.id && !meta.trashed) {
        const leaf = (await scanCommonLeaves()).find((l) => l.imagesId === String(remembered));
        const name = String(meta.name || (leaf && leaf.imagesName) || GENERAL_LIBRARY_DIR);
        return {
          name, leafId: String(remembered), exact: true, via: 'remembered',
          folder: (leaf && leaf.folder) || name, candidates: []
        };
      }
    }
    const leaves = await scanCommonLeaves();
    if (!leaves.length) return none;
    const today = leaves.find((l) => l.via === 'name') || null;
    const chosen = (today && today.files > 0) ? today : (bestFiguresLeaf(leaves) || today);
    if (!chosen) return none;
    rememberFiguresLeafOnce('', { folderId: chosen.folderId, imagesId: chosen.imagesId });
    return {
      name: chosen.name,
      leafId: chosen.imagesId,
      exact: isCommonLibraryName(chosen.name),
      via: chosen.via,
      folder: chosen.folder,
      files: chosen.files,
      candidates: leaves.filter((l) => l.imagesId !== chosen.imagesId)
    };
  } catch { return none; }
};

/**
 * Le dossier d'images de CE projet, cherché sans rien créer.
 *
 * @returns {Promise<{ name:string, leafId:string, exact:boolean, via:string,
 *                     folder:string, candidates:Array }>}
 *   `name`       nom RÉEL du dossier du projet sur le Drive (peut différer du
 *                nom du projet : c'est tout l'intérêt) ;
 *   `leafId`     identifiant du dossier `images` — '' quand on n'a rien trouvé ;
 *   `via`        'mirror' | 'name' | 'similar' | '' (comment il a été trouvé) ;
 *   `candidates` ce qui a été vu (renseigné quand rien n'est certain, pour que
 *                l'écran puisse proposer le bon dossier au lieu de deviner).
 */
export const findProjectFiguresFolder = async (projectName) => {
  /* Le dossier cherché est celui du PROJET, sous son nom slugé. La portée
     COMMUNE est traitée à part (voir findCommonFiguresFolder) : sa bibliothèque
     n'est pas un dossier de projet, elle vit à la racine du dataset. */
  const wanted = sanitizeSlug(projectName);
  const scope = { datasetId: getDriveRootId(), datasetName: getDriveRootName(), projectName };
  const none = {
    name: '', leafId: '', exact: false, via: '',
    folder: imagesFolderPathOnDrive(projectName), candidates: []
  };
  if (!getDriveToken()) return none;
  if (!wanted) return findCommonFiguresFolder();
  try {
    // 0. LE DOSSIER `images` DÉJÀ RETENU, par son IDENTIFIANT. Une recherche par
    //    NOM rend le PREMIER des jumeaux, dans un ordre que le Drive ne garantit
    //    pas — souvent le plus récent, donc le VIDE : c'est ce chemin-là qui
    //    relisait un dossier vide pendant que les figures étaient à côté. Un
    //    identifiant, lui, ne se trompe jamais (et suit un renommage).
    const remembered = findProjectImagesId(readDriveMirror(), scope);
    if (remembered) {
      const meta = await getDriveFileMeta(remembered).catch(() => null);
      if (meta && meta.id && !meta.trashed) {
        const twin = await preferPopulatedTwin(projectName, remembered);
        if (twin) return twin;
        const name = await projectFolderNameOf(scope, wanted);
        return {
          name, leafId: remembered, exact: folderNameIsWanted(name, projectName), via: 'remembered',
          folder: `projects/${name}/images`, candidates: []
        };
      }
    }
    // 1. LE MIROIR : l'identifiant Drive du dossier du projet. Il est renommé SUR
    //    PLACE quand le projet est renommé, donc il reste juste — c'est la seule
    //    source qui survit à un renommage complet. Son dossier `images` est
    //    choisi parmi les JUMEAUX (`bestLeafOfProjectFolder`), pas « le premier
    //    du nom ».
    const folderId = findProjectFolderId(readDriveMirror(), scope);
    if (folderId) {
      const meta = await getDriveFileMeta(folderId).catch(() => null);
      if (meta && meta.id && !meta.trashed) {
        const name = String(meta.name || wanted);
        const leaf = await bestLeafOfProjectFolder(folderId);
        if (leaf) {
          const twin = await preferPopulatedTwin(projectName, leaf.imagesId);
          if (twin) return twin;
          // Le dossier est trouvé : on le RETIENT par identifiant, pour que la
          // prochaine lecture ne repasse pas par la recherche par nom.
          rememberFiguresLeafOnce(projectName, { folderId, imagesId: leaf.imagesId });
          return { name, leafId: leaf.imagesId, exact: folderNameIsWanted(name, projectName), via: 'mirror', folder: `projects/${name}/images`, candidates: [] };
        }
      }
    }
    // 2. LE NOM CANONIQUE — existence seulement : c'est ici que l'ancien code
    //    créait un jumeau vide quand le dossier portait un autre nom.
    const root = await datasetRootId();
    /* `projects` est un CONTENEUR CANONIQUE : il est résolu par son identité
       (registre partagé, jumeaux départagés par leur contenu — voir
       datasetDirTwins.js), car une recherche par nom rend « le premier du nom »
       dans un ordre que le Drive ne garantit pas — donc souvent le jumeau VIDE.
       LECTURE SEULE : rien n'est créé ici. */
    const projectsId = root
      ? (await canonicalDatasetDirId('projects', { rootId: root, create: false }).catch(() => ''))
        || await findFolderByName('projects', root)
      : '';
    if (projectsId) {
      /* Le dossier du projet, PAR SON NOM : celui qui existe gagne, et c'est son
         nom réel qui est rendu — l'écran affiche donc ce que le Drive montre. */
      const exactId = await findFolderByName(wanted, projectsId);
      if (exactId) {
        const leaf = await bestLeafOfProjectFolder(exactId);
        if (leaf) {
          const twin = await preferPopulatedTwin(projectName, leaf.imagesId);
          if (twin) return twin;
          // Retenu par identifiant : la recherche par nom ne revient plus (c'est
          // elle qui, dans l'ordre non garanti du Drive, tombait sur le jumeau
          // vide).
          rememberFiguresLeafOnce(projectName, { folderId: exactId, imagesId: leaf.imagesId });
          return { name: wanted, leafId: leaf.imagesId, exact: true, via: 'name', folder: `projects/${wanted}/images`, candidates: [] };
        }
      }
    }
    // 3. UN DOSSIER VOISIN qui ressemble encore au nom du projet. Le dossier
    //    `images` retenu est déjà le PEUPLÉ quand ce dossier en porte deux (voir
    //    listProjectFiguresFolders).
    const all = await listProjectFiguresFolders();
    const picked = pickFiguresFolder(all, projectName);
    if (picked) {
      rememberFiguresLeafOnce(projectName, { folderId: picked.folderId, imagesId: picked.imagesId });
      return { name: picked.name, leafId: picked.imagesId, exact: false, via: 'similar', folder: `projects/${picked.name}/images`, candidates: all };
    }
    return { ...none, candidates: all };
  } catch { return none; }
};

/**
 * Faire de ce dossier LE dossier du projet : l'identité est retenue dans le
 * miroir partagé (clé `labDriveMirror`), donc les lectures ET les envois suivants
 * visent ce dossier-là — c'est le geste qui remet un projet sur un seul dossier
 * d'images quand le renommage a été total.
 * @returns {Promise<string>} l'identifiant du dossier `images` ('' si introuvable).
 */
export const adoptProjectFiguresFolder = async ({ projectName = '', folderName = '' } = {}) => {
  const wanted = sanitizeSlug(folderName);
  if (!wanted) return '';
  const all = await listProjectFiguresFolders();
  const found = all.find((c) => sanitizeSlug(c.name) === wanted);
  if (!found) return '';
  try {
    writeDriveMirror(rememberProjectFolder(readDriveMirror(), {
      datasetId: getDriveRootId(), datasetName: getDriveRootName(), projectName,
      folderId: found.folderId,
      /* Le dossier `images` RETENU, par identifiant : deux dossiers du même nom
         peuvent coexister, et c'est l'identifiant — pas le nom — qui dit lequel
         porte les figures (voir findProjectFiguresFolder). */
      imagesId: found.imagesId
    }));
  } catch { /* registre local indisponible : la lecture de ce dossier reste possible */ }
  return found.imagesId;
};
